/* ============================================================
   map-editor.js — 地图编辑器 v4（支持建筑放置）
   ============================================================ */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

const $ = id => document.getElementById(id);

let currentMap = null;
let currentTool = 'brush';
/* ★ 正在绘制的出生区多边形：{ side:'blue'|'red', pts:[{x,y},…] }（见"出生区"一节）
   —— 提到文件顶部声明：render()/selectTool() 都会读它，避免 let 的 TDZ 隐患 */
let spawnDraw = null;
/* ★ 绘制中的光标世界坐标（供主画布覆盖层用；见 render() 末尾） */
let spawnCursorW = null;
/* ★ 正在绘制的公路（矢量折线 + 宽度）：与路线同一套"点顶点"交互 */
let roadDraw = null;
let roadCursorW = null;
let roadCells = 2;                  // 面板滑杆：路宽按「格」给（1 格 = 格边长，默认 5 米）
let roadWidth = 10;                 // 派生值：米（= roadCells × 格边长）
let lastRoadMsg = '';
/* ★ 指针手势：区分"单击"与"拖动"（拖动=平移画布 / 拖动拐点=移动它） */
let routePress = null;
let rightPress = null;
let currentTerrain = 1;
let brushSize = 8;
let showGridLines = false;
let showObjectives = true;

let currentBuildingType = 'cottage';
let currentBuildingVariant = 'cottage_yellow';

let activeLayerIdx = 0;

let overlayImage = null;
let overlayOpacity = 0.5;
let overlayVisible = true;

let camera = { x: 0, y: 0, zoom: 0.1 };
let canvas, ctx, previewCanvas, pctx, wrap;
let isPanning = false, panStart = null;
let isDrawing = false, drawStart = null;
let previewEnd = null;

const MAX_HISTORY = 20;
let undoStack = [];
let redoStack = [];

let _renderPending = false;
function requestRender() {
  if (_renderPending) return;
  _renderPending = true;
  requestAnimationFrame(() => {
    _renderPending = false;
    render();
  });
}

/* ---------- 建筑图像缓存 ---------- */
const _buildingImgCache = new Map();

function getBuildingImage(b) {
  const state = getBuildingState(b);
  const def = BUILDING_TYPES[b.type];
  if (!def) return null;
  const key = b.type + '|' + b.variant + '|' + state;
  if (_buildingImgCache.has(key)) return _buildingImgCache.get(key);

  const ox = def.dhPx * 0.5;
  const oy = def.dhPx;
  const imgW = def.pxW + ox;
  const imgH = def.pxH + oy;

  let svg;
  try { svg = renderBuildingSVG(b, imgW, imgH); }
  catch (e) { return null; }

  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  img.loaded = false;
  img.onload = () => {
    img.loaded = true;
    requestRender();
  };
  img.onerror = () => { console.warn('建筑 SVG 加载失败'); };
  img.src = url;
  _buildingImgCache.set(key, img);
  return img;
}

/* ---------- 建筑绘制（严格对齐底面格子） ---------- */
function drawBuildings() {
  if (!currentMap.buildings || !currentMap.buildings.length) return;

  const z = camera.zoom;

  for (const b of currentMap.buildings) {
    const def = BUILDING_TYPES[b.type];
    if (!def) continue;

    // 底面在屏幕上的左上角 + 尺寸
    const p1 = w2s(b.x, b.y);
    const bScreenW = b.w * z;
    const bScreenH = b.h * z;
    if (bScreenW < 1.5 || bScreenH < 1.5) continue;

    // SVG 内部像素：底面 = pxW × pxH，按底面屏幕宽度计算全局缩放
    const scale = bScreenW / def.pxW;

    const ox = def.dhPx * 0.5;
    const oy = def.dhPx;

    // SVG 完整绘制矩形的左上角（往左上偏移 ox, oy）
    const sx = p1.sx - ox * scale;
    const sy = p1.sy - oy * scale;
    const drawW = (def.pxW + ox) * scale;
    const drawH = (def.pxH + oy) * scale;

    const img = getBuildingImage(b);
    if (img && img.loaded) {
      ctx.drawImage(img, sx, sy, drawW, drawH);
    } else {
      // 占位
      ctx.fillStyle = 'rgba(120, 120, 130, 0.5)';
      ctx.fillRect(p1.sx, p1.sy, bScreenW, bScreenH);
    }
  }
}

/* ---------- 初始化 ---------- */
window.addEventListener('DOMContentLoaded', () => {
  canvas = $('editor-canvas');
  ctx = canvas.getContext('2d');
  previewCanvas = $('preview-canvas');
  pctx = previewCanvas.getContext('2d');
  wrap = $('canvas-wrap');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  buildPalette();
  buildBuildingPanel();
  bindTools();
  bindViewToggles();
  bindRoadPanel();              // ★ 公路面板（矢量公路：宽度滑杆 / 清空 / 列表）
  bindActions();
  bindCanvas();
  bindNewModal();
  bindMobileUI();               // ★ R9.6.13：手机端工具抽屉（桌面无影响）
  refreshToolHighlights();      // ★ 初始化时统一一次高亮（含建筑面板 armed 状态、状态栏工具名）

  if (Object.keys(GRID_MAPS).length > 0) {
    const firstKey = Object.keys(GRID_MAPS)[0];
    loadMap(GRID_MAPS[firstKey]);
  } else {
    openNewModal();
  }
});

function loadMap(gm) {
  currentMap = gm;
  activeLayerIdx = 0;
  undoStack = [];
  redoStack = [];
  if (!currentMap.buildings) currentMap.buildings = [];
  $('map-name-display').textContent = gm.name;
  const sps = $('soldiers-per-side');
  if (sps) sps.value = gm.soldiersPerSide || '';
  clearOverlay();
  refreshLayerList();
  refreshBuildingList();
  ensureSpawns(currentMap);
  setSpawnFields();
  ensureRoads(currentMap);
  refreshRoadList();          // ★ 换地图后刷新公路面板
  syncRoadWidth($('road-width-label'));   // ★ 路宽标签跟随本图格边长（格 ↔ 米）
  centerCamera();
  render();
}

/* ---------- 画布 ---------- */
function resizeCanvas() {
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  previewCanvas.width = rect.width * dpr;
  previewCanvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function centerCamera() {
  if (!currentMap) return;
  camera.x = currentMap.w / 2;
  camera.y = currentMap.h / 2;
  const rect = wrap.getBoundingClientRect();
  const zx = rect.width / (currentMap.w * 1.1);
  const zy = rect.height / (currentMap.h * 1.1);
  camera.zoom = Math.max(0.02, Math.min(zx, zy));
  updateZoomLabel();
}

function updateZoomLabel() {
  $('status-zoom').textContent = (camera.zoom * 100).toFixed(0) + '%';
}

function w2s(x, y) {
  const rect = wrap.getBoundingClientRect();
  return {
    sx: (x - camera.x) * camera.zoom + rect.width / 2,
    sy: (y - camera.y) * camera.zoom + rect.height / 2,
  };
}
function s2w(sx, sy) {
  const rect = wrap.getBoundingClientRect();
  return {
    x: (sx - rect.width / 2) / camera.zoom + camera.x,
    y: (sy - rect.height / 2) / camera.zoom + camera.y,
  };
}

/* ---------- 渲染 ---------- */
function render() {
  const rect = wrap.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!currentMap) return;

  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, rect.width, rect.height);

  const topLeft = w2s(0, 0);
  const botRight = w2s(currentMap.w, currentMap.h);
  const dw = botRight.sx - topLeft.sx;
  const dh = botRight.sy - topLeft.sy;

  // 草地底色
  ctx.fillStyle = GRID_PALETTE[0].color;
  ctx.fillRect(topLeft.sx, topLeft.sy, dw, dh);

  // 参考图（草地之上、图层之下）
  if (overlayImage && overlayVisible) {
    ctx.globalAlpha = overlayOpacity;
    ctx.drawImage(overlayImage, topLeft.sx, topLeft.sy, dw, dh);
    ctx.globalAlpha = 1;
  }

  // 逐层渲染
  const layers = currentMap.layers;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (!L.visible) continue;
    const layerCanvas = bakeLayerCanvas(L, currentMap);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layerCanvas, topLeft.sx, topLeft.sy, dw, dh);
    ctx.imageSmoothingEnabled = true;
  }

  // ★ 矢量公路（图层之上、建筑之下）：圆角粗线 —— 永远没有锯齿
  drawRoadOverlay(ctx);

  // 建筑（在图层之上、网格之下）
  drawBuildings();

  // 网格线
  if (showGridLines && camera.zoom > 0.05) {
    const cellPx = currentMap.cellSize * camera.zoom;
    if (cellPx > 6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      const x0 = Math.max(0, Math.floor(s2w(0, 0).x / currentMap.cellSize));
      const x1 = Math.min(currentMap.gw, Math.ceil(s2w(rect.width, 0).x / currentMap.cellSize));
      const y0 = Math.max(0, Math.floor(s2w(0, 0).y / currentMap.cellSize));
      const y1 = Math.min(currentMap.gh, Math.ceil(s2w(0, rect.height).y / currentMap.cellSize));
      for (let gx = x0; gx <= x1; gx++) {
        const p = w2s(gx * currentMap.cellSize, 0);
        ctx.beginPath();
        ctx.moveTo(p.sx, Math.max(0, topLeft.sy));
        ctx.lineTo(p.sx, Math.min(rect.height, botRight.sy));
        ctx.stroke();
      }
      for (let gy = y0; gy <= y1; gy++) {
        const p = w2s(0, gy * currentMap.cellSize);
        ctx.beginPath();
        ctx.moveTo(Math.max(0, topLeft.sx), p.sy);
        ctx.lineTo(Math.min(rect.width, botRight.sx), p.sy);
        ctx.stroke();
      }
    }
  }

  // ★ R9.2 补给点（画在据点之下，两者不抢视觉）
  if (currentMap.supplies && currentMap.supplies.length) {
    for (const s of currentMap.supplies) {
      const p = w2s(s.x, s.y);
      const r = s.r * camera.zoom;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.fill();
      ctx.setLineDash([10, 7]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = (s.id === selectedSupplyId) ? '#38bdf8' : 'rgba(56, 189, 248, 0.75)';
      ctx.stroke();
      ctx.setLineDash([]);
      if (r > 16) {
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeText('📦 ' + s.name, p.sx, p.sy);
        ctx.fillStyle = '#bae6fd';
        ctx.fillText('📦 ' + s.name, p.sx, p.sy);
      }
    }
  }

  // 据点
  if (showObjectives && currentMap.objectives) {
    for (const o of currentMap.objectives) {
      const p = w2s(o.x, o.y);
      const r = o.r * camera.zoom;
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.15)';
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeText(o.name, p.sx, p.sy);
      ctx.fillStyle = '#facc15';
      ctx.fillText(o.name, p.sx, p.sy);
    }
  }

  // 出生区（矩形 或 ★多块多边形）
  if (currentMap.spawns) {
    for (const side of ['blue', 'red']) {
      const sp = currentMap.spawns[side];
      if (!spawnIsValid(sp)) continue;
      const isBlue = side === 'blue';
      const polys = spawnPolysOf(sp);
      ctx.fillStyle = isBlue ? 'rgba(59, 130, 246, 0.14)' : 'rgba(239, 68, 68, 0.14)';
      ctx.strokeStyle = isBlue ? 'rgba(96, 165, 250, 0.95)' : 'rgba(248, 113, 113, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);

      if (polys.length) {
        for (const p of polys) {
          ctx.beginPath();
          p.forEach((v, i) => {
            const q = w2s(v.x, v.y);
            if (i === 0) ctx.moveTo(q.sx, q.sy);
            else ctx.lineTo(q.sx, q.sy);
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else {
        const p0 = w2s(sp.x, sp.y);
        const p1 = w2s(sp.x + sp.w, sp.y + sp.h);
        ctx.fillRect(p0.sx, p0.sy, p1.sx - p0.sx, p1.sy - p0.sy);
        ctx.strokeRect(p0.sx, p0.sy, p1.sx - p0.sx, p1.sy - p0.sy);
      }
      ctx.setLineDash([]);

      // 标签放在质心（多边形）/ 左上角（矩形）
      const c = spawnCenter(sp);
      const pc = w2s(c.x, c.y);
      const label = (isBlue ? '🚩 蓝方出生区' : '🚩 红方出生区') +
                    (polys.length > 1 ? ` (${polys.length} 块)` : '');
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = polys.length ? 'center' : 'left';
      ctx.textBaseline = polys.length ? 'middle' : 'top';
      const lx = polys.length ? pc.sx : pc.sx - (sp.w / 2) * camera.zoom + 6;
      const ly = polys.length ? pc.sy : pc.sy - (sp.h / 2) * camera.zoom + 6;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeText(label, lx, ly);
      ctx.fillStyle = isBlue ? '#bfdbfe' : '#fecaca';
      ctx.fillText(label, lx, ly);

      // 正在画这一方时，把已有顶点也点出来（便于接着画/对齐）
      if (spawnDraw && spawnDraw.side === side && polys.length) {
        ctx.fillStyle = isBlue ? '#93c5fd' : '#fca5a5';
        for (const p of polys) {
          for (const v of p) {
            const q = w2s(v.x, v.y);
            ctx.beginPath();
            ctx.arc(q.sx, q.sy, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  // 地图边界
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(topLeft.sx, topLeft.sy, dw, dh);

  // ★ 出生区绘制中的覆盖层（画在主画布最上层 ⇒ 随缩放/平移自动同步、画完自动消失）
  drawSpawnOverlay(ctx);
}


/* 单层 canvas 缓存 */
const _layerCanvasCache = new WeakMap();
function bakeLayerCanvas(layer, gm) {
  if (_layerCanvasCache.has(layer) && layer._cacheKey === layer.grid) {
    return _layerCanvasCache.get(layer);
  }
  const c = document.createElement('canvas');
  c.width = gm.gw; c.height = gm.gh;
  const cctx = c.getContext('2d');
  const img = cctx.createImageData(gm.gw, gm.gh);
  const d = img.data;
  const grid = layer.grid;
  const GW = gm.gw;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v === 0) {
      d[i*4] = 0; d[i*4+1] = 0; d[i*4+2] = 0; d[i*4+3] = 0;
    } else {
      /* ★ R9.6.10：与战场底图**同一份**纹理实现（树林/沼泽/山丘有花纹，其余纯色） */
      const px = terrainPixel(v, i % GW, (i / GW) | 0);
      d[i*4]   = px[0];
      d[i*4+1] = px[1];
      d[i*4+2] = px[2];
      d[i*4+3] = 255;
    }
  }
  cctx.putImageData(img, 0, 0);
  layer._cacheKey = layer.grid;
  _layerCanvasCache.set(layer, c);
  return c;
}

function invalidateLayerCache(layer) {
  layer._cacheKey = null;
  _layerCanvasCache.delete(layer);
}

/* ★ 地形写入后：把【所有图层】的烘焙缓存都作废，并重算合成图
   —— 编辑器是按层烘焙缓存的（bakeLayerCanvas），只失效"活动层"的话，
      一旦写入落到了别的层（_genActiveIdx 与 activeLayerIdx 不一致）就完全看不见 */
function invalidateAllLayers() {
  if (!currentMap) return;
  (currentMap.layers || []).forEach(L => invalidateLayerCache(L));
  gmRecomposeAll(currentMap);
}

/* ★ 把编辑器的"活动层"同步给底层绘制函数
   —— gLine/gRect/gCircle/gFloodFill 是通过 gm._genActiveIdx 挑图层的
      （见 grid-maps.js 兼容层），而编辑器用的是 activeLayerIdx。
      两者不同步 = 形状画进 A 层、缓存却只失效 B 层 ⇒ 界面上"什么都没画出来" */
function syncGenActiveLayer() {
  if (currentMap) currentMap._genActiveIdx = activeLayerIdx;
}

/* ---------- 调色板 ---------- */
function buildPalette() {
  const el = $('palette');
  el.innerHTML = '';
  GRID_PALETTE.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'palette-item' + (i === currentTerrain ? ' active' : '');
    item.dataset.idx = i;
    item.innerHTML = `<span class="dot" style="background:${p.color}"></span><span>${p.name}</span>`;
    item.addEventListener('click', () => {
      currentTerrain = i;
      el.querySelectorAll('.palette-item').forEach(x =>
        x.classList.toggle('active', +x.dataset.idx === i));
      /* ★ 点地形颜色 = "我要刷地形"：如果当前工具不是地形类工具
         （放建筑/删建筑/据点/出生区/吸管…），自动切回画笔
         —— 否则工具还停在 place-building，一画就变成放楼 */
      if (!TERRAIN_TOOLS.has(currentTool)) selectTool('brush');
    });
    el.appendChild(item);
  });
}

/* ---------- 建筑面板 ---------- */
function buildBuildingPanel() {
  const typeEl = $('building-types');
  const varEl = $('building-variants');
  typeEl.innerHTML = '';
  varEl.innerHTML = '';

  Object.keys(BUILDING_TYPES).forEach(typeId => {
    const def = BUILDING_TYPES[typeId];
    const btn = document.createElement('button');
    btn.className = 'building-type-btn';   // 高亮由 refreshToolHighlights() 统一判定（只有一个 source of truth）
    btn.dataset.type = typeId;
    btn.innerHTML = `<span>${def.icon}</span><span>${def.name}</span>`;
    btn.addEventListener('click', () => {
      currentBuildingType = typeId;
      currentBuildingVariant = def.variants[0];
      buildBuildingVariantRow();
      // 切到放置工具（高亮由 refreshToolHighlights 统一处理）
      selectTool('place-building');
    });
    typeEl.appendChild(btn);
  });

  buildBuildingVariantRow();
}

function buildBuildingVariantRow() {
  const varEl = $('building-variants');
  varEl.innerHTML = '';
  const def = BUILDING_TYPES[currentBuildingType];
  if (!def) return;

  def.variants.forEach(vk => {
    const pal = BUILDING_PALETTE[vk];
    if (!pal) return;
    const btn = document.createElement('button');
    btn.className = 'building-variant-btn';   // 高亮由 refreshToolHighlights() 统一判定
    btn.dataset.variant = vk;
    btn.innerHTML = `<span class="building-variant-swatch" style="background:${pal.top}"></span><span>${vk.replace(/^[a-z]+_/, '')}</span>`;
    btn.addEventListener('click', () => {
      currentBuildingVariant = vk;
      refreshToolHighlights();
    });
    varEl.appendChild(btn);
  });

  // 颜色行重建后统一刷一次高亮（只有"放建筑"工具激活时才亮）
  refreshToolHighlights();
}

/* ---------- 建筑列表 ---------- */
function refreshBuildingList() {
  const el = $('building-list');
  if (!currentMap) { el.innerHTML = ''; return; }
  el.innerHTML = '';
  const bldgs = currentMap.buildings || [];
  bldgs.forEach((b, idx) => {
    const def = BUILDING_TYPES[b.type];
    if (!def) return;
    const item = document.createElement('div');
    item.className = 'building-list-item';
    const state = getBuildingState(b);
    item.innerHTML = `
      <span class="nm">${def.icon} ${def.name}</span>
      <span class="hp">${Math.round(b.hp)}/${b.hpMax}</span>
      <button class="del" title="删除">✕</button>
    `;
    item.addEventListener('click', ev => {
      if (ev.target.closest('.del')) return;
      // 居中相机到该建筑
      camera.x = b.x + b.w / 2;
      camera.y = b.y + b.h / 2;
      render();
    });
    item.querySelector('.del').addEventListener('click', ev => {
      ev.stopPropagation();
      pushHistory();
      currentMap.buildings.splice(idx, 1);
      _buildingImgCache.clear();
      refreshBuildingList();
          render();
    });
    el.appendChild(item);
  });
}

/* ---------- 工具 ---------- */
/* 会用到"当前地形"的工具（在这些工具下点调色板只换颜色，不换工具） */
const TERRAIN_TOOLS = new Set(['brush', 'line', 'rect', 'circle', 'fill']);

const TOOL_NAMES = {
  'brush': '✏ 画笔', 'line': '／ 直线', 'rect': '▭ 矩形', 'circle': '◯ 圆',
  'fill': '🪣 填充', 'pick': '💧 吸管', 'objective': '🎯 据点',
  'erase-objective': '🗑 删据点', 'place-building': '🏢 放建筑',
  'erase-building': '🗑 删建筑', 'spawn-blue': '🚩 画蓝方区',
  'spawn-red': '🚩 画红方区', 'erase-spawn': '🗑 清出生区',
  'supply': '📦 补给点', 'erase-supply': '🗑 删补给点',   // ★ R9.2
};

function bindTools() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });
  bindSpawnPanel();
  bindSupplyPanel();              // ★ R9.2 补给点面板（半径滑杆 / 应用到全部 / 列表）
  const dig = $('btn-dig-trenches');
  if (dig) dig.addEventListener('click', digTrenchesAtObjectives);
}

/* ★ 唯一的高亮入口：谁"正在生效"谁才亮
   —— 旧代码里 selectTool 只刷 .tool-btn，而建筑面板的类型/颜色按钮自带 .active
      且永远不清 ⇒ 换成画笔后"建筑"那一排还是亮的（让人以为还在放建筑），
      更糟的是"先点建筑类型 → 再点地形颜色"时工具其实还是 place-building，
      于是画地形变成了放楼。 */
function refreshToolHighlights() {
  const buildingArmed = (currentTool === 'place-building');
  /* ★ 按当前工具显隐面板（data-tools="road,route,…"）：
     只在"真的要用它"的时候才出现 ⇒ 侧栏不再一股脑堆满 */
  document.querySelectorAll('[data-tools]').forEach(el => {
    const set = String(el.dataset.tools || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!set.length) return;
    el.style.display = set.indexOf(currentTool) >= 0 ? '' : 'none';
  });
  document.querySelectorAll('.tool-btn').forEach(x =>
    x.classList.toggle('active', x.dataset.tool === currentTool));
  document.querySelectorAll('.building-type-btn').forEach(x =>
    x.classList.toggle('active', buildingArmed && x.dataset.type === currentBuildingType));
  document.querySelectorAll('.building-variant-btn').forEach(x =>
    x.classList.toggle('active', buildingArmed && x.dataset.variant === currentBuildingVariant));

  const panel = $('building-panel');
  if (panel) panel.classList.toggle('armed', buildingArmed);
  const hint = $('building-panel-hint');
  if (hint) {
    const def = BUILDING_TYPES[currentBuildingType];
    hint.textContent = buildingArmed
      ? `已在摆放：${def ? def.name : currentBuildingType}（在地图上点一下放置）`
      : '点上面的类型即可开始摆放';
  }
  const statusTool = $('status-tool');
  if (statusTool) statusTool.textContent = '工具: ' + (TOOL_NAMES[currentTool] || currentTool);
}

function selectTool(tool) {
  const sameTool = (tool === currentTool);
  currentTool = tool;
  // ★ 切走出生工具、或"再点一次同一个工具" → 取消未完成的绘制
  if (spawnDraw && (sameTool || (tool !== 'spawn-blue' && tool !== 'spawn-red'))) {
    spawnDraw = null;
    spawnCursorW = null;
  }
  if (roadDraw && (sameTool || tool !== 'road')) { roadDraw = null; roadCursorW = null; }
  refreshToolHighlights();
  render();
}

function bindViewToggles() {
  $('chk-grid').addEventListener('change', e => { showGridLines = e.target.checked; render(); });
  $('chk-objectives').addEventListener('change', e => { showObjectives = e.target.checked; render(); });
  $('brush-size').addEventListener('input', e => {
    brushSize = parseInt(e.target.value) || 1;
    $('brush-size-label').textContent = brushSize + ' 格';
  });
}

/* ---------- 图层管理 ---------- */
function refreshLayerList() {
  const el = $('layer-list');
  if (!currentMap) { el.innerHTML = ''; return; }
  el.innerHTML = '';
  for (let i = currentMap.layers.length - 1; i >= 0; i--) {
    const L = currentMap.layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (i === activeLayerIdx ? ' active' : '');
    item.dataset.idx = i;
    item.innerHTML = `
      <span class="layer-vis ${L.visible ? 'on' : 'off'}" title="显示/隐藏">${L.visible ? '👁' : '⊘'}</span>
      <span class="layer-name" title="${escapeHtml(L.name)}">${escapeHtml(L.name)}</span>
      <span class="layer-actions">
        <button class="up" data-idx="${i}" title="上移">▲</button>
        <button class="down" data-idx="${i}" title="下移">▼</button>
        <button class="ren" data-idx="${i}" title="重命名">✎</button>
        <button class="del" data-idx="${i}" title="删除">✕</button>
      </span>
    `;
    el.appendChild(item);
  }

  el.querySelectorAll('.layer-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      const i = parseInt(item.dataset.idx);
      activeLayerIdx = i;
      refreshLayerList();
    });
  });
  el.querySelectorAll('.layer-vis').forEach(v => {
    v.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(v.parentNode.dataset.idx);
      currentMap.layers[i].visible = !currentMap.layers[i].visible;
      gmRecomposeAll(currentMap);
      invalidateLayerCache(currentMap.layers[i]);
      refreshLayerList();
      requestRender();
    });
  });
  el.querySelectorAll('button.up').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(b.dataset.idx);
      if (i >= currentMap.layers.length - 1) return;
      const layers = currentMap.layers;
      [layers[i], layers[i+1]] = [layers[i+1], layers[i]];
      if (activeLayerIdx === i) activeLayerIdx = i + 1;
      else if (activeLayerIdx === i + 1) activeLayerIdx = i;
      gmRecomposeAll(currentMap);
      refreshLayerList();
      requestRender();
    });
  });
  el.querySelectorAll('button.down').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(b.dataset.idx);
      if (i <= 0) return;
      const layers = currentMap.layers;
      [layers[i], layers[i-1]] = [layers[i-1], layers[i]];
      if (activeLayerIdx === i) activeLayerIdx = i - 1;
      else if (activeLayerIdx === i - 1) activeLayerIdx = i;
      gmRecomposeAll(currentMap);
      refreshLayerList();
      requestRender();
    });
  });
  el.querySelectorAll('button.ren').forEach(b => {
    b.addEventListener('click', async e => {
      e.stopPropagation();
      const i = parseInt(b.dataset.idx);
      const newName = await Dlg.prompt('图层名', currentMap.layers[i].name);
      if (!newName) return;
      currentMap.layers[i].name = newName.slice(0, 20);
      refreshLayerList();
    });
  });
  el.querySelectorAll('button.del').forEach(b => {
    b.addEventListener('click', async e => {
      e.stopPropagation();
      const i = parseInt(b.dataset.idx);
      if (currentMap.layers.length <= 1) { Dlg.alert('至少保留一层'); return; }
      if (!(await Dlg.confirm(`删除图层「${currentMap.layers[i].name}」？`))) return;
      currentMap.layers.splice(i, 1);
      if (activeLayerIdx >= currentMap.layers.length) {
        activeLayerIdx = currentMap.layers.length - 1;
      }
      gmRecomposeAll(currentMap);
      refreshLayerList();
      requestRender();
    });
  });
}

/* ---------- 新建 Modal ---------- */
function bindNewModal() {
  document.querySelectorAll('.preset-sizes button').forEach(btn => {
    btn.addEventListener('click', () => {
      $('new-w').value = btn.dataset.w;
      $('new-h').value = btn.dataset.h;
      updateSizeInfo();
    });
  });
  $('new-w').addEventListener('input', updateSizeInfo);
  $('new-h').addEventListener('input', updateSizeInfo);
}

function updateSizeInfo() {
  const w = parseInt($('new-w').value) || 0;
  const h = parseInt($('new-h').value) || 0;
  if (w <= 0 || h <= 0) {
    $('cell-count').textContent = '—';
    $('size-warning').style.display = 'none';
    return;
  }
  const gw = Math.ceil(w / 5), gh = Math.ceil(h / 5);
  const cells = gw * gh;
  $('cell-count').textContent = cells.toLocaleString() + ` （${gw} × ${gh}）`;
  const sizeSoldiers = $('size-soldiers');
  if (sizeSoldiers) sizeSoldiers.textContent = recommendedSoldiers(w, h).toLocaleString() + '（自动）';

  const warn = $('size-warning');
  const warnText = $('size-warning-text');
  let msg = '';
  if (w > 30000) msg = `宽度 ${w}m 超过上限 30000m，请缩小。`;
  else if (h > 20000) msg = `高度 ${h}m 超过上限 20000m，请缩小。`;
  else if (w < 2000) msg = `宽度 ${w}m 低于下限 2000m，请扩大。`;
  else if (h < 2000) msg = `高度 ${h}m 低于下限 2000m，请扩大。`;
  else if (cells > 12000000) msg = `格子数 ${cells.toLocaleString()} 过大（超过 1200 万），可能导致编辑器严重卡顿。`;
  else if (cells > 6000000) msg = `格子数 ${cells.toLocaleString()} 偏大，编辑器可能略有卡顿。`;
  if (msg) {
    warn.style.display = 'block';
    warnText.textContent = msg;
    if (w > 30000 || h > 20000 || w < 2000 || h < 2000) {
      warn.style.background = 'rgba(239,68,68,.15)';
      warn.style.borderColor = 'rgba(239,68,68,.4)';
      warn.style.color = '#fca5a5';
    } else {
      warn.style.background = 'rgba(245,158,11,.12)';
      warn.style.borderColor = 'rgba(245,158,11,.35)';
      warn.style.color = '#fcd34d';
    }
  } else {
    warn.style.display = 'none';
  }
}

function openNewModal() {
  $('new-modal').classList.add('show');
  updateSizeInfo();
}

async function createNewMap() {
  const name = $('new-name').value.trim() || '未命名地图';
  const w = parseInt($('new-w').value) || 0;
  const h = parseInt($('new-h').value) || 0;
  if (w < 2000 || w > 30000) { Dlg.alert('宽度必须在 2000 ~ 30000 米之间'); return; }
  if (h < 2000 || h > 20000) { Dlg.alert('高度必须在 2000 ~ 20000 米之间'); return; }
  const gw = Math.ceil(w / 5), gh = Math.ceil(h / 5);
  if (gw * gh > 12000000) {
    if (!(await Dlg.confirm(`格子数 ${(gw*gh).toLocaleString()} 超过 1200 万，编辑器可能严重卡顿。确定继续？`))) return;
  }
  const gm = makeGridMap(w, h, 5);
  gm.name = name;
  gm._isUserMap = true;
  const soldiersVal = parseInt($('new-soldiers').value, 10);
  if (soldiersVal > 0) gm.soldiersPerSide = soldiersVal;
  $('new-modal').classList.remove('show');
  loadMap(gm);
}

/* ---------- 顶栏动作 ---------- */
function bindActions() {
  $('btn-new').addEventListener('click', openNewModal);
  $('btn-load').addEventListener('click', openLoadModal);
  $('btn-save').addEventListener('click', saveCurrentMap);
  $('btn-export').addEventListener('click', exportMap);
  $('btn-import').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', importMap);

  const sps = $('soldiers-per-side');
  if (sps) sps.addEventListener('change', () => {
    if (!currentMap) return;
    const v = parseInt(sps.value, 10);
    if (v > 0) currentMap.soldiersPerSide = v;
    else delete currentMap.soldiersPerSide;
  });

  $('btn-add-layer').addEventListener('click', () => {
    if (!currentMap) return;
    const idx = currentMap.layers.length;
    currentMap.layers.push({
      id: 'L' + Date.now().toString(36) + '_' + idx,
      name: '图层 ' + (idx + 1),
      visible: true,
      opacity: 1.0,
      grid: new Uint8Array(currentMap.gw * currentMap.gh),
    });
    activeLayerIdx = idx;
    gmRecomposeAll(currentMap);
    refreshLayerList();
    requestRender();
  });

  $('btn-import-overlay').addEventListener('click', () => $('overlay-input').click());
  $('overlay-input').addEventListener('change', handleOverlayUpload);
  $('overlay-visible').addEventListener('change', e => { overlayVisible = e.target.checked; render(); });
  $('overlay-opacity').addEventListener('input', e => {
    overlayOpacity = parseInt(e.target.value) / 100;
    $('overlay-opacity-label').textContent = e.target.value + '%';
    render();
  });
  $('overlay-remove').addEventListener('click', clearOverlay);

  $('new-cancel').addEventListener('click', () => $('new-modal').classList.remove('show'));
  $('new-confirm').addEventListener('click', createNewMap);
  $('load-cancel').addEventListener('click', () => $('load-modal').classList.remove('show'));
  $('obj-cancel').addEventListener('click', () => $('obj-modal').classList.remove('show'));
  $('obj-confirm').addEventListener('click', confirmAddObjective);

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    const k = e.key.toLowerCase();
    // ★ 出生区绘制中：只响应绘制相关按键，避免误触工具切换
    if (roadDraw) {
      if (e.key === 'Escape') { roadDraw = null; roadCursorW = null; render(); return; }
      if (e.key === 'Enter') { finishRoadDraw(); return; }
      if (e.key === 'Backspace') {
        e.preventDefault();
        roadDraw.pop();
        if (!roadDraw.length) roadDraw = null;
        render();
        return;
      }
      return;
    }
    if (spawnDraw) {
      if (e.key === 'Escape') { spawnDraw = null; spawnCursorW = null; render(); return; }
      if (e.key === 'Enter') { finishSpawnDraw(); return; }
      if (e.key === 'Backspace') {
        e.preventDefault();
        spawnDraw.pts.pop();
        if (!spawnDraw.pts.length) { spawnDraw = null; spawnCursorW = null; }
        render();
        return;
      }
      return;
    }
    if (k === 'b') selectTool('brush');
    else if (k === 'l') selectTool('line');
    else if (k === 'r') selectTool('rect');
    else if (k === 'c') selectTool('circle');
    else if (k === 'f') selectTool('fill');
    else if (k === 'p') selectTool('pick');
    else if (k === 'g') selectTool('place-building');
  });
}

/* ---------- 参考图层 ---------- */
function handleOverlayUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  if (!file.type.startsWith('image/')) { Dlg.alert('请选择图片文件'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      overlayImage = img;
      overlayVisible = true;
      $('overlay-visible').checked = true;
      $('overlay-empty').style.display = 'none';
      $('overlay-controls').style.display = 'block';
      render();
    };
    img.onerror = () => Dlg.alert('图片加载失败');
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function clearOverlay() {
  overlayImage = null;
  $('overlay-empty').style.display = 'block';
  $('overlay-controls').style.display = 'none';
  render();
}

/* ---------- 加载 / 保存 / 导出 / 导入 ---------- */
function openLoadModal() {
  const list = $('load-list');
  list.innerHTML = '';
  const items = Object.values(GRID_MAPS);
  if (!items.length) {
    list.innerHTML = '<div style="color:#64748b;font-size:13px;padding:20px;text-align:center;">还没有地图</div>';
  } else {
    for (const gm of items) {
      const el = document.createElement('div');
      el.className = 'load-item';
      const tag = gm._isUserMap ? '📁 用户地图' : '★ 预设';
      el.innerHTML = `
        <div class="info">
          <div class="name">${escapeHtml(gm.name)}</div>
          <div class="meta">${tag} · ${gm.w}×${gm.h}m · 建议 ${(gm.soldiersPerSide || recommendedSoldiers(gm.w, gm.h)).toLocaleString()} 人/侧 · ${(gm.layers||[]).length}层 · ${(gm.objectives || []).length}据点 · ${(gm.buildings || []).length}建筑</div>
        </div>
        ${gm._isUserMap ? `<button class="del-btn" data-id="${gm.id}">✕</button>` : ''}
      `;
      el.addEventListener('click', e => {
        if (e.target.closest('.del-btn')) return;
        $('load-modal').classList.remove('show');
        loadMap(gm);
      });
      const delBtn = el.querySelector('.del-btn');
      if (delBtn) {
        delBtn.addEventListener('click', async ev => {
          ev.stopPropagation();
          if (await Dlg.confirm(`删除「${gm.name}」？`)) {
            deleteUserMapFromStorage(gm.id);
            delete GRID_MAPS[gm.id];
            openLoadModal();
          }
        });
      }
      list.appendChild(el);
    }
  }
  $('load-modal').classList.add('show');
}

async function saveCurrentMap() {
  if (!currentMap) return;
  const name = await Dlg.prompt('地图名称', currentMap.name);
  if (!name) return;
  currentMap.name = name;
  currentMap._isUserMap = true;
  const ok = saveUserMapToStorage(currentMap);
  if (ok) {
    GRID_MAPS[currentMap.id] = currentMap;
    $('map-name-display').textContent = name;
    Dlg.alert('已保存：' + name);
  } else {
    Dlg.alert('保存失败：可能超出 localStorage 容量限制');
  }
}

function exportMap() {
  if (!currentMap) return;
  const data = serializeGridMap(currentMap);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = currentMap.name + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importMap(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const gm = deserializeGridMap(data);
      gm._isUserMap = true;
      GRID_MAPS[gm.id] = gm;
      saveUserMapToStorage(gm);
      loadMap(gm);
      Dlg.alert('已导入：' + gm.name);
    } catch (err) {
      Dlg.alert('导入失败：' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/* ============================================================
   ★★★ R9.2：**补给点**（编辑器侧）
   ------------------------------------------------------------
   · 「📦 补给点」工具：点地图空白 = 放一个（半径用滑杆，默认 120m）；
     **点在已有圈内** = 选中它（右侧列表会高亮，方便改半径）
   · 「🗑 删补给点」工具：点在圈内 = 删掉
   · 右侧面板：半径滑杆（有选中就只改它，没选中就改全部）+ 半径应用到全部 + 列表
   · 数据 `gm.supplies = [{id,name,x,y,r}]`：序列化 / 撤销历史都带上，老地图兼容
   ============================================================ */
let selectedSupplyId = null;

function supplyAtPoint(wx, wy, slack) {
  const list = (currentMap && currentMap.supplies) || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (Math.hypot(s.x - wx, s.y - wy) <= s.r + (slack || 0)) return s;
  }
  return null;
}

function supplyRadiusSel() {
  const el = $('supply-radius');
  return el ? (parseInt(el.value, 10) || SUPPLY_DEFAULT_RADIUS) : SUPPLY_DEFAULT_RADIUS;
}

/* 面板顶部那行提示（放/删/选中的即时反馈都写这里） */
let _supplyHintTimer = null;
function setSupplyHint(msg) {
  const el = $('supply-panel-hint');
  if (!el) return;
  el.textContent = msg;
  if (_supplyHintTimer) clearTimeout(_supplyHintTimer);
  _supplyHintTimer = setTimeout(() => { refreshSupplyPanel(); }, 2600);
}

function placeSupplyAt(wx, wy) {
  if (!currentMap) return;
  if (!currentMap.supplies) currentMap.supplies = [];
  const hit = supplyAtPoint(wx, wy);
  if (hit) {                                   // 点已有 ⇒ 选中（改半径用）
    selectedSupplyId = hit.id;
    const el = $('supply-radius');
    if (el) el.value = Math.round(hit.r);
    const lab = $('supply-radius-label');
    if (lab) lab.textContent = Math.round(hit.r) + 'm';
    refreshSupplyPanel();
    render();
    setSupplyHint('已选中「' + hit.name + '」（半径 ' + Math.round(hit.r) + 'm）');
    return;
  }
  const s = makeSupply(wx, wy, supplyRadiusSel(), '补给点 ' + (currentMap.supplies.length + 1));
  if (!s) return;
  currentMap.supplies.push(s);
  selectedSupplyId = s.id;
  refreshSupplyPanel();
  render();
  setSupplyHint('已放置「' + s.name + '」r=' + Math.round(s.r) + 'm · 可在右侧列表改名/删除');
}

function eraseSupplyAt(wx, wy) {
  if (!currentMap) return;
  const list = currentMap.supplies || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (Math.hypot(s.x - wx, s.y - wy) <= s.r) {
      list.splice(i, 1);
      if (selectedSupplyId === s.id) selectedSupplyId = null;
      refreshSupplyPanel();
      render();
      setSupplyHint('已删「' + s.name + '」');
      return;
    }
  }
  setSupplyHint('这里没有补给点（要删就点在圈内）');
}

function refreshSupplyPanel() {
  const listEl = $('supply-list');
  const hint = $('supply-panel-hint');
  if (!listEl) return;
  const list = (currentMap && currentMap.supplies) || [];
  if (hint) {
    hint.textContent = list.length
      ? ('共 ' + list.length + ' 个 · 点名字=选中 · ✕=删除')
      : '还没有补给点：选「📦 补给点」工具后点地图';
  }
  listEl.innerHTML = '';
  for (const s of list) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;' +
      'padding:2px 4px;border-radius:4px;margin-bottom:2px;' +
      (s.id === selectedSupplyId ? 'background:rgba(56,189,248,.18);' : '');
    const nm = document.createElement('span');
    nm.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;';
    nm.textContent = '📦 ' + s.name + ' · ' + Math.round(s.r) + 'm';
    nm.title = '点击选中（右侧半径滑杆会切到它的半径）';
    nm.addEventListener('click', () => {
      selectedSupplyId = s.id;
      const el = $('supply-radius');
      if (el) el.value = Math.round(s.r);
      const lab = $('supply-radius-label');
      if (lab) lab.textContent = Math.round(s.r) + 'm';
      refreshSupplyPanel();
      render();
    });
    const del = document.createElement('button');
    del.className = 'mini-btn';
    del.textContent = '✕';
    del.title = '删除这个补给点';
    del.addEventListener('click', ev => {
      ev.stopPropagation();
      pushHistory();
      currentMap.supplies = (currentMap.supplies || []).filter(x => x.id !== s.id);
      if (selectedSupplyId === s.id) selectedSupplyId = null;
      refreshSupplyPanel();
      render();
      setSupplyHint('已删「' + s.name + '」');
    });
    row.appendChild(nm);
    row.appendChild(del);
    listEl.appendChild(row);
  }
}

function bindSupplyPanel() {
  const rad = $('supply-radius'), lab = $('supply-radius-label');
  if (rad) {
    rad.addEventListener('input', () => { if (lab) lab.textContent = rad.value + 'm'; });
    rad.addEventListener('change', () => {
      if (!currentMap) return;
      pushHistory();
      const r = supplyRadiusSel();
      const list = currentMap.supplies || [];
      const sel = list.find(s => s.id === selectedSupplyId);
      for (const s of (sel ? [sel] : list)) s.r = r;   // 有选中就只改它，否则全改
      refreshSupplyPanel();
      render();
      setSupplyHint(sel ? ('「' + sel.name + '」半径 → ' + r + 'm') : ('全部补给点半径 → ' + r + 'm'));
    });
  }
  const all = $('supply-apply-all');
  if (all) all.addEventListener('click', () => {
    if (!currentMap || !(currentMap.supplies || []).length) { setSupplyHint('还没有补给点'); return; }
    pushHistory();
    const r = supplyRadiusSel();
    for (const s of currentMap.supplies) s.r = r;
    refreshSupplyPanel();
    render();
    setSupplyHint('全部补给点半径 → ' + r + 'm');
  });
  refreshSupplyPanel();
}

/* ---------- 撤销 / 重做 ---------- */
function snapshotCurrent() {
  return {
    layers: currentMap.layers.map(L => ({
      id: L.id, name: L.name, visible: L.visible, opacity: L.opacity,
      rle: encodeRLE(L.grid),
    })),
    activeLayerIdx,
    objectives: JSON.parse(JSON.stringify(currentMap.objectives || [])),
    buildings: JSON.parse(JSON.stringify(currentMap.buildings || [])),
    spawns: JSON.parse(JSON.stringify(currentMap.spawns || null)),
    roads: JSON.parse(JSON.stringify(currentMap.roads || [])),     // ★ 矢量公路也进撤销历史
    supplies: JSON.parse(JSON.stringify(currentMap.supplies || [])),   // ★ R9.2 补给点
  };
}

function applySnapshot(snap) {
  currentMap.layers = snap.layers.map(L => ({
    id: L.id, name: L.name, visible: L.visible, opacity: L.opacity,
    grid: decodeRLE(L.rle, currentMap.gw * currentMap.gh),
  }));
  activeLayerIdx = Math.min(snap.activeLayerIdx, currentMap.layers.length - 1);
  currentMap.objectives = JSON.parse(JSON.stringify(snap.objectives || []));
  currentMap.buildings = JSON.parse(JSON.stringify(snap.buildings || []));
  currentMap.spawns = JSON.parse(JSON.stringify(snap.spawns || null));
  currentMap.roads = normalizeRoads(snap.roads || []);
  currentMap.supplies = normalizeSupplies(snap.supplies || []);   // ★ R9.2
  invalidateRoadGrid(currentMap);
  ensureSpawns(currentMap);
  setSpawnFields();
  gmRecomposeAll(currentMap);
  _buildingImgCache.clear();
  currentMap.layers.forEach(L => invalidateLayerCache(L));
  refreshLayerList();
  refreshBuildingList();
  render();
}

function pushHistory() {
  if (!currentMap) return;
  undoStack.push(snapshotCurrent());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (!undoStack.length) return;
  const current = snapshotCurrent();
  const snap = undoStack.pop();
  redoStack.push(current);
  applySnapshot(snap);
}

function redo() {
  if (!redoStack.length) return;
  const current = snapshotCurrent();
  const snap = redoStack.pop();
  undoStack.push(current);
  applySnapshot(snap);
}

/* ---------- 画布交互 ---------- */
function bindCanvas() {
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    if (e.button === 2) {
      // ★ 出生区绘制中：右键 = 取消绘制（不进平移，否则会误以为"取消不了"）
      if (spawnDraw) {
        spawnDraw = null;
        spawnCursorW = null;
        render();
        return;
      }
      rightPress = { x: e.clientX, y: e.clientY, moved: false };
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, camX: camera.x, camY: camera.y };
      wrap.classList.add('panning');
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (e.button !== 0 || !currentMap) return;

    const rect = wrap.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = s2w(sx, sy);

    if (currentTool === 'objective') { openObjectiveModal(w.x, w.y); return; }
    if (currentTool === 'spawn-blue') { spawnClick('blue', w.x, w.y); return; }
    if (currentTool === 'spawn-red')  { spawnClick('red',  w.x, w.y); return; }
    if (currentTool === 'erase-spawn') { eraseSpawnAt(w.x, w.y); return; }
    if (currentTool === 'road') {
      /* 公路："点顶点"交互（要改就删掉重画） */
      routePress = { x: e.clientX, y: e.clientY, moved: false, mode: 'point', wx: w.x, wy: w.y, tool: currentTool };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (currentTool === 'erase-objective') {
      pushHistory();
      eraseObjectiveAt(w.x, w.y);
      return;
    }
    if (currentTool === 'place-building') {
      placeBuilding(w.x, w.y);
      return;
    }
    if (currentTool === 'erase-building') {
      eraseBuildingAt(w.x, w.y);
      return;
    }
    if (currentTool === 'supply') {
      pushHistory();
      placeSupplyAt(w.x, w.y);
      return;
    }
    if (currentTool === 'erase-supply') {
      pushHistory();
      eraseSupplyAt(w.x, w.y);
      return;
    }
    if (currentTool === 'pick') {
      const t = getGridTerrain(currentMap, w.x, w.y);
      const idx = GRID_PALETTE.findIndex(p => p.id === t.id);
      if (idx >= 0) {
        currentTerrain = idx;
        document.querySelectorAll('.palette-item').forEach(x =>
          x.classList.toggle('active', +x.dataset.idx === idx));
      }
      return;
    }

    pushHistory();
    isDrawing = true;
    drawStart = w;
    previewEnd = w;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}

    if (currentTool === 'brush') {
      paintAt(w.x, w.y);
      requestRender();
    } else if (currentTool === 'fill') {
      const gx = Math.floor(w.x / currentMap.cellSize);
      const gy = Math.floor(w.y / currentMap.cellSize);
      syncGenActiveLayer();                    // ★ 写进编辑器当前活动层
      gFloodFill(currentMap, gx, gy, GRID_PALETTE[currentTerrain].id);
      invalidateAllLayers();                   // ★ 旧代码只 gmRecomposeAll（合成图），
                                               //   而编辑器是按层烘焙渲染的 ⇒ 画面永远不变
      requestRender();
      isDrawing = false;
    }
  });

  canvas.addEventListener('pointermove', e => {
    const rect = wrap.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = s2w(sx, sy);
    updateStatus(w);

    /* ★ 公路手势：拖动 = 平移画布（旧版左键一拖就多出一个点） */
    if (routePress) {
      if (!routePress.moved && Math.hypot(e.clientX - routePress.x, e.clientY - routePress.y) > 5) {
        routePress.moved = true;
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY, camX: camera.x, camY: camera.y };
        wrap.classList.add('panning');
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      }
    }
    if (isPanning) {
      if (rightPress && Math.hypot(e.clientX - rightPress.x, e.clientY - rightPress.y) > 6) rightPress.moved = true;
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      camera.x = panStart.camX - dx / camera.zoom;
      camera.y = panStart.camY - dy / camera.zoom;
      requestRender();
      return;
    }

    if (isDrawing && currentMap) {
      if (currentTool === 'brush') {
        paintAt(w.x, w.y);
        requestRender();
      } else if (currentTool === 'line' || currentTool === 'rect' || currentTool === 'circle') {
        previewEnd = w;
        drawShapePreview();
      }
    }

    // 出生区绘制中的实时预览：只记录光标位置，真正的绘制在 render() 里
    // ★ 旧写法把预览画在独立的 preview 画布上且只在 pointermove 时重画 ⇒
    //    缩放/平移后线不跟着走、画完后还残留。改为主画布覆盖层后，随每次 render 自动同步。
    if (roadDraw && currentMap) {
      roadCursorW = { x: w.x, y: w.y };
      requestRender();
    } else if (roadCursorW) {
      roadCursorW = null;
    }
    if (spawnDraw && currentMap) {
      spawnCursorW = w;
      requestRender();
    } else if (spawnCursorW) {
      spawnCursorW = null;
    }
  });

  canvas.addEventListener('pointerup', e => {
    /* ★ 公路：只有"单击"（没拖动）才算加顶点；拖动是平移 */
    if (routePress) {
      const rp = routePress;
      routePress = null;
      if (!rp.moved && rp.mode === 'point') roadClick(rp.wx, rp.wy);
    }
    if (isPanning) {
      isPanning = false;
      wrap.classList.remove('panning');
      /* ★ 右键：单击（没拖）才取消绘制；拖动过 ⇒ 只当平移，不取消 */
      if (rightPress && !rightPress.moved) {
        /* ★ R8 删掉「🛣 路线」工具时，把它那一支 if 分支一起删了，却漏删后面的 else if
           ⇒ SyntaxError: Unexpected token 'else'（整份编辑器脚本不执行、编辑器全哑）。
           这里把首个分支改回 if：右键单击取消「公路 / 出生区」绘制（与旧版行为一致）。 */
        if (roadDraw) { roadDraw = null; roadCursorW = null; setRoadStatus(lastRoadMsg, false); render(); }
        else if (spawnDraw) { spawnDraw = null; spawnCursorW = null; render(); }
      }
      rightPress = null;
      return;
    }
    if (!isDrawing || !currentMap) return;

    if (currentTool === 'line' || currentTool === 'rect' || currentTool === 'circle') {
      const rect = wrap.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const w = s2w(sx, sy);
      applyShape(currentTool, drawStart, w);
      gmRecomposeAll(currentMap);
      clearShapePreview();
    }

    isDrawing = false;
    drawStart = null;
    previewEnd = null;
    render();
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = s2w(sx, sy);
    let nz = camera.zoom * (e.deltaY < 0 ? 1.15 : 1/1.15);
    nz = Math.max(0.01, Math.min(4, nz));
    camera.zoom = nz;
    camera.x = w.x - (sx - rect.width / 2) / camera.zoom;
    camera.y = w.y - (sy - rect.height / 2) / camera.zoom;
    updateZoomLabel();
    render();
    if (isDrawing && currentTool !== 'brush' && currentTool !== 'fill') {
      drawShapePreview();
    }
  }, { passive: false });

  /* ★★★ R9.6.13：**手机端画布手势**（双指平移 + 双指捏合缩放）
     —— 手机上既没有滚轮也没有右键，所以这两件事必须由**双指**接管；
        单指仍然 = "用当前工具"（与桌面左键走同一条路径）。
        锚点法：抓住按下瞬间双指中点下的那个世界点，之后无论缩放还是移动中点，
        都让这个世界点始终贴在当前中点下面 ⇒ 平移与缩放天然合成、互不打架。 */
  let tst = null;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) return;
    const rect = wrap.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
    const w = s2w(mx, my);
    tst = {
      dist: Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                       e.touches[0].clientY - e.touches[1].clientY) || 1,
      zoom: camera.zoom, wx: w.x, wy: w.y,
    };
    isDrawing = false;                       // 双指开始 ⇒ 停掉单指绘制（避免边缩放边刷地形）
    requestRender();
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !tst) return;
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                            e.touches[0].clientY - e.touches[1].clientY) || 1;
    camera.zoom = Math.max(0.01, Math.min(4, tst.zoom * dist / tst.dist));
    camera.x = tst.wx - (mx - rect.width / 2) / camera.zoom;
    camera.y = tst.wy - (my - rect.height / 2) / camera.zoom;
    updateZoomLabel();
    requestRender();
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    if (e.touches.length < 2) tst = null;
  }, { passive: true });
  /* 触摸被系统打断时（来电/手势）复位，避免"画笔一直按着"的状态残留 */
  canvas.addEventListener('pointercancel', () => {
    isDrawing = false; isPanning = false;
    routePress = null; rightPress = null;
  });
}

/* ★★★ R9.6.13：**手机端工具抽屉**
   —— 侧栏在手机上变成底部抽屉（CSS 里 `body.mobile-tools-open`）：
      点顶栏「🛠 工具」开关；**选完工具/颜色自动收起**（不然一直挡着画布）。 */
function bindMobileUI() {
  const btn = $('btn-mobile-tools');
  if (btn) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.body.classList.toggle('mobile-tools-open');
    });
  }
  const side = document.querySelector('.sidebar');
  if (side) {
    side.addEventListener('click', e => {
      if (window.innerWidth > 900) return;
      if (e.target.closest('button, .palette-item')) {
        document.body.classList.remove('mobile-tools-open');
      }
    });
  }
}

function updateStatus(w) {
  if (!currentMap) return;
  // ★ 状态栏"当前工具"：绘制出生区时显示绘制进度与操作提示
  const statusTool = $('status-tool');
  if (statusTool) {
    if (spawnDraw) {
      const nm = spawnDraw.side === 'blue' ? '蓝' : '红';
      statusTool.textContent = `画${nm}方出生区 · 顶点 ${spawnDraw.pts.length} · 点起点/回车 闭合 · ⌫ 撤点 · Esc/右键 取消`;
    } else {
      statusTool.textContent = '工具: ' + (TOOL_NAMES[currentTool] || currentTool);
    }
  }
  const gx = Math.floor(w.x / currentMap.cellSize);
  const gy = Math.floor(w.y / currentMap.cellSize);
  if (gx < 0 || gx >= currentMap.gw || gy < 0 || gy >= currentMap.gh) {
    $('status-coord').textContent = '—';
    $('status-terrain').textContent = '—';
    return;
  }
  $('status-coord').textContent = `${Math.round(w.x)}, ${Math.round(w.y)} m  (${gx}, ${gy})`;
  const t = getGridTerrain(currentMap, w.x, w.y);
  $('status-terrain').textContent = `地形: ${t.name}`;
}

/* ---------- 建筑放置/删除 ---------- */
function placeBuilding(wx, wy) {
  const def = BUILDING_TYPES[currentBuildingType];
  if (!def) return;

  // 以点击位置为建筑中心
  const bx = wx - def.w / 2;
  const by = wy - def.h / 2;

  // 边界检查
  if (bx < 0 || by < 0 || bx + def.w > currentMap.w || by + def.h > currentMap.h) {
    Dlg.alert('建筑超出地图边界');
    return;
  }

  pushHistory();
  const b = createBuilding(currentBuildingType, bx, by, currentBuildingVariant);
  if (!b) return;
  currentMap.buildings.push(b);
  refreshBuildingList();
  render();
}

function eraseBuildingAt(wx, wy) {
  if (!currentMap.buildings || !currentMap.buildings.length) return;
  // 倒序找（上层优先）
  for (let i = currentMap.buildings.length - 1; i >= 0; i--) {
    const b = currentMap.buildings[i];
    if (isPointInBuilding(b, wx, wy)) {
      pushHistory();
      currentMap.buildings.splice(i, 1);
      _buildingImgCache.clear();
      refreshBuildingList();
          render();
      return;
    }
  }
}

/* ---------- 战场整备：在据点周围挖堑壕 ---------- */
/* 真实战场在交战区一定会挖壕（任务区里那些大开阔地不真实）。
   这里给每个据点套一圈壕沟：外圈刷 trench、内部恢复空旷。 */
function digTrenchesAtObjectives() {
  if (!currentMap) return;
  const objs = currentMap.objectives || [];
  if (!objs.length) { Dlg.alert('这张地图还没有据点。先放据点，再挖壕。'); return; }
  pushHistory();
  syncGenActiveLayer();
  for (const o of objs) {
    const outer = Math.max(80, o.r * 0.95);
    const inner = Math.max(50, o.r * 0.72);
    gCircle(currentMap, o.x, o.y, outer, 'trench');   // 壕沟环
    gCircle(currentMap, o.x, o.y, inner, 'empty');    // 内部保持空旷（便于展开）
  }
  invalidateAllLayers();
  render();
}

/* ---------- 绘制（写入活动层） ---------- */
function getActiveLayer() {
  if (!currentMap) return null;
  return currentMap.layers[activeLayerIdx] || currentMap.layers[0];
}

function paintAt(wx, wy) {
  if (!currentMap) return;
  syncGenActiveLayer();                 // ★ 与 gLine/gRect/gCircle/gFloodFill 用同一个层
  const gm = currentMap;
  const layer = getActiveLayer();
  if (!layer) return;
  const grid = layer.grid;
  const cx = Math.floor(wx / gm.cellSize);
  const cy = Math.floor(wy / gm.cellSize);
  const rad = Math.ceil(brushSize / 2);
  const tIdx = currentTerrain;

  for (let dx = -rad; dx <= rad; dx++) {
    for (let dy = -rad; dy <= rad; dy++) {
      if (dx*dx + dy*dy > rad*rad) continue;
      const gx = cx + dx, gy = cy + dy;
      if (gx < 0 || gx >= gm.gw || gy < 0 || gy >= gm.gh) continue;
      grid[gy * gm.gw + gx] = tIdx;
      gmUpdateComposedCell(gm, gx, gy);
    }
  }
  invalidateLayerCache(layer);
}

function applyShape(tool, start, end) {
  if (!currentMap) return;
  if (!start || !end) return;
  syncGenActiveLayer();                       // ★ 让底层写进"编辑器当前活动层"
  const t = GRID_PALETTE[currentTerrain].id;
  const cs = currentMap.cellSize;
  if (tool === 'line') gLine(currentMap, start.x, start.y, end.x, end.y, brushSize * cs, t);
  else if (tool === 'rect') {
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    gRect(currentMap, x, y, w, h, t);
  } else if (tool === 'circle') {
    const cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2;
    const r = Math.hypot(end.x - start.x, end.y - start.y) / 2;
    gCircle(currentMap, cx, cy, r, t);
  }
  invalidateAllLayers();                      // ★ 必须作废所有层的烘焙缓存，否则画面不变
}

/* ---------- 形状预览 ---------- */
function drawShapePreview() {
  const rect = wrap.getBoundingClientRect();
  pctx.clearRect(0, 0, rect.width, rect.height);
  if (!drawStart || !previewEnd) return;

  const p1 = w2s(drawStart.x, drawStart.y);
  const p2 = w2s(previewEnd.x, previewEnd.y);
  const col = GRID_PALETTE[currentTerrain].color;

  pctx.strokeStyle = col;
  pctx.fillStyle = col;
  pctx.globalAlpha = 0.55;
  pctx.lineWidth = Math.max(2, brushSize * currentMap.cellSize * camera.zoom);
  pctx.lineCap = 'round';

  if (currentTool === 'line') {
    pctx.beginPath();
    pctx.moveTo(p1.sx, p1.sy);
    pctx.lineTo(p2.sx, p2.sy);
    pctx.stroke();
  } else if (currentTool === 'rect') {
    pctx.strokeRect(p1.sx, p1.sy, p2.sx - p1.sx, p2.sy - p1.sy);
  } else if (currentTool === 'circle') {
    const cx = (p1.sx + p2.sx) / 2, cy = (p1.sy + p2.sy) / 2;
    const r = Math.hypot(p2.sx - p1.sx, p2.sy - p1.sy) / 2;
    pctx.beginPath();
    pctx.arc(cx, cy, r, 0, Math.PI * 2);
    pctx.stroke();
  }
  pctx.globalAlpha = 1;
}

function clearShapePreview() {
  const rect = wrap.getBoundingClientRect();
  pctx.clearRect(0, 0, rect.width, rect.height);
}

/* ★ 出生区多边形：绘制中的覆盖层（画在【主画布】上，随 render() 一起刷新）
   —— 这样缩放/平移/窗口变化时它自动跟着走，画完（spawnDraw 置空）也自动消失；
      旧版画在 preview 画布上只在 pointermove 重画 ⇒ 不跟缩放 + 画完残留。 */
function drawSpawnOverlay(c) {
  if (!spawnDraw || !spawnDraw.pts.length) return;
  const isBlue = spawnDraw.side === 'blue';
  const col = isBlue ? '#60a5fa' : '#f87171';
  const pts = spawnDraw.pts.map(p => w2s(p.x, p.y));

  c.save();
  // 已落的边（实线）
  c.strokeStyle = col;
  c.lineWidth = 2;
  c.setLineDash([]);
  c.beginPath();
  c.moveTo(pts[0].sx, pts[0].sy);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].sx, pts[i].sy);
  c.stroke();

  // 到光标的虚线（下一条边）+ 闭合示意
  if (spawnCursorW) {
    const q = w2s(spawnCursorW.x, spawnCursorW.y);
    c.setLineDash([8, 6]);
    c.globalAlpha = 0.85;
    c.beginPath();
    c.moveTo(pts[pts.length - 1].sx, pts[pts.length - 1].sy);
    c.lineTo(q.sx, q.sy);
    if (pts.length >= 2) c.lineTo(pts[0].sx, pts[0].sy);   // 再从光标连回首点 → 提示闭合后的形状
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
  }

  // 顶点 + 首顶点高亮（提示"点这里闭合"）
  const verts = pts.slice();
  if (spawnCursorW) verts.push(w2s(spawnCursorW.x, spawnCursorW.y));
  verts.forEach((p, i) => {
    c.beginPath();
    c.arc(p.sx, p.sy, i === 0 ? 6 : 4, 0, Math.PI * 2);
    c.fillStyle = i === 0 ? '#fde047' : col;
    c.fill();
    c.strokeStyle = 'rgba(15,23,42,.9)';
    c.lineWidth = 1.5;
    c.stroke();
  });
  c.restore();
}

/* ---------- 据点 ---------- */
let pendingObjective = null;

function openObjectiveModal(x, y) {
  pendingObjective = { x, y };
  $('obj-modal').classList.add('show');
  setTimeout(() => $('obj-name').select(), 50);
}

function confirmAddObjective() {
  if (!pendingObjective || !currentMap) return;
  const name = $('obj-name').value.trim() || '据点';
  const r = parseInt($('obj-r').value) || 500;
  pushHistory();
  currentMap.objectives.push({ x: pendingObjective.x, y: pendingObjective.y, r, name });
  pendingObjective = null;
  $('obj-modal').classList.remove('show');
  render();
}

function eraseObjectiveAt(wx, wy) {
  if (!currentMap) return;
  for (let i = currentMap.objectives.length - 1; i >= 0; i--) {
    const o = currentMap.objectives[i];
    if (Math.hypot(o.x - wx, o.y - wy) <= o.r) {
      currentMap.objectives.splice(i, 1);
      render();
      return;
    }
  }
}

/* ---------- 出生区 ---------- */
/* 交互：左键落顶点 → 点在起点附近/回车 闭合成圈 → 圈内即出生区
         可以连续画多块（不相连也支持）；⌫ 撤销顶点；Esc 取消
   （绘制状态 spawnDraw 声明在文件顶部） */

function clampSpawnPoint(wx, wy) {
  return {
    x: Math.max(0, Math.min(currentMap.w, Math.round(wx))),
    y: Math.max(0, Math.min(currentMap.h, Math.round(wy))),
  };
}

/* 两线段是否相交（用于拒绝自交多边形：射线法在自交多边形上结果会乱） */
function _segCross(a, b, c, d) {
  const cr = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = cr(a, b, c), o2 = cr(a, b, d), o3 = cr(c, d, a), o4 = cr(c, d, b);
  return (o1 * o2 < 0) && (o3 * o4 < 0);
}
function polySelfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if ((i + 1) % n === j || (j + 1) % n === i) continue;   // 相邻边不算
      if (_segCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/* 选中出生工具后在地图上点一下 */
function spawnClick(side, wx, wy) {
  if (!currentMap) return;
  ensureSpawns(currentMap);
  const p = clampSpawnPoint(wx, wy);

  if (!spawnDraw || spawnDraw.side !== side) {
    spawnDraw = { side, pts: [p] };        // 开始画新的一块
    spawnCursorW = p;                      // 立刻有一个"起点"可显示
    render();
    return;
  }
  const first = spawnDraw.pts[0];
  const closeR = Math.max(50, 26 / (camera.zoom || 1));   // 屏幕 26px 换算成世界距离
  if (spawnDraw.pts.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) <= closeR) {
    finishSpawnDraw();
    return;
  }
  spawnDraw.pts.push(p);
  render();
}

/* 闭合成圈 → 追加为该方的一块出生区（支持多块） */
function finishSpawnDraw() {
  const d = spawnDraw;
  spawnDraw = null;
  if (!d || d.pts.length < 3) { render(); return; }
  if (polySelfIntersects(d.pts)) {
    Dlg.alert('这条边界自己交叉了 —— 请重新画（出生区边界不能交叉）');
    render();
    return;
  }
  pushHistory();
  const sp = currentMap.spawns[d.side];
  const polys = spawnPolysOf(sp).map(p => p.map(v => ({ x: v.x, y: v.y })));
  polys.push(d.pts);
  setSpawnPolys(sp, polys);
  setSpawnFields();
  render();
}

/* 🗑 清出生区 = 点谁清谁：点在多边形的某一块里 → 只删那一块；点在矩形里 → 该方重置为默认矩形 */
function eraseSpawnAt(wx, wy) {
  if (!currentMap) return;
  ensureSpawns(currentMap);
  for (const side of ['blue', 'red']) {
    const sp = currentMap.spawns[side];
    const polys = spawnPolysOf(sp);
    if (polys.length) {
      for (let i = 0; i < sp.polys.length; i++) {
        const p = sp.polys[i];
        if (!Array.isArray(p) || p.length < 3) continue;
        if (!pointInPoly(wx, wy, p)) continue;
        pushHistory();
        sp.polys.splice(i, 1);
        if (!spawnPolysOf(sp).length) {
          currentMap.spawns[side] = makeDefaultSpawn(currentMap, side);   // 一块都不剩 → 回到默认矩形
        } else {
          refreshSpawnBBox(sp);
        }
        setSpawnFields();
        render();
        return;
      }
    } else if (spawnIsValid(sp) &&
               wx >= sp.x && wx <= sp.x + sp.w && wy >= sp.y && wy <= sp.y + sp.h) {
      pushHistory();
      currentMap.spawns[side] = makeDefaultSpawn(currentMap, side);
      setSpawnFields();
      render();
      return;
    }
  }
}

function setSpawnFields() {
  if (!currentMap) return;
  ensureSpawns(currentMap);
  for (const side of ['blue', 'red']) {
    const sp = currentMap.spawns[side];
    if (spawnHasPolys(sp)) refreshSpawnBBox(sp);
    const set = (k, v) => { const el = $('spawn-' + side + '-' + k); if (el) el.value = Math.round(v); };
    set('x', sp.x); set('y', sp.y); set('w', sp.w); set('h', sp.h);
    const capEl = $('spawn-' + side + '-cap');
    if (capEl) {
      const n = spawnPolysOf(sp).length;
      capEl.textContent = (n ? `多边形 ${n} 块 · ` : '矩形 · ') +
        '面积 ' + (spawnArea(sp) / 1e6).toFixed(2) + ' km² · 约可容纳 ' +
        spawnCapacity(sp) + ' 个单位';
    }
  }
}

/* 面板里改 X/Y/W/H：X/Y = 整体平移；W/H = 按包围盒整体缩放（比例保持） */
function readSpawnFields(side) {
  if (!currentMap) return;
  const sp = currentMap.spawns[side];
  const v = k => {
    const n = parseInt($('spawn-' + side + '-' + k).value);
    return isFinite(n) ? n : Math.round(sp[k]);
  };
  const nx = Math.max(0, Math.min(currentMap.w - 100, v('x')));
  const ny = Math.max(0, Math.min(currentMap.h - 100, v('y')));
  const nw = Math.max(100, Math.min(currentMap.w, v('w')));
  const nh = Math.max(100, Math.min(currentMap.h, v('h')));

  if (spawnHasPolys(sp)) {
    const kx = sp.w > 0 ? nw / sp.w : 1, ky = sp.h > 0 ? nh / sp.h : 1;
    for (const p of sp.polys) {
      for (const pt of p) {
        pt.x = Math.round(Math.max(0, Math.min(currentMap.w, nx + (pt.x - sp.x) * kx)));
        pt.y = Math.round(Math.max(0, Math.min(currentMap.h, ny + (pt.y - sp.y) * ky)));
      }
    }
    refreshSpawnBBox(sp);
    return;
  }
  sp.x = nx; sp.y = ny;
  sp.w = Math.max(100, Math.min(currentMap.w - sp.x, nw));
  sp.h = Math.max(100, Math.min(currentMap.h - sp.y, nh));
}

function bindSpawnPanel() {
  ['blue', 'red'].forEach(side => {
    ['x', 'y', 'w', 'h'].forEach(k => {
      const el = $('spawn-' + side + '-' + k);
      if (!el) return;
      el.addEventListener('change', () => {
        if (!currentMap) return;
        pushHistory();
        readSpawnFields(side);
        setSpawnFields();
        render();
      });
    });
  });
  const reset = $('spawn-reset');
  if (reset) reset.addEventListener('click', () => {
    if (!currentMap) return;
    pushHistory();
    currentMap.spawns = {};
    ensureSpawns(currentMap);
    setSpawnFields();
    render();
  });
}


/* ============================================================
   ★ R4：矢量公路（折线 + 宽度）—— 地图编辑
   ------------------------------------------------------------
   为什么：5m 栅格手刷的路，斜着画必然是台阶锯齿（"两侧锯齿太多"）。
   现在作者画折线：画面描圆角粗线（永远锐利），导航按宽度栅格化 ⇒ 两全。
   顺带得到中心线（pts）与宽度（w）⇒ 以后的车道 / 路网图直接用。
   ============================================================ */
const ROAD_COLORS = {
  base: 'rgba(18,24,34,0.6)',       // 路基（深色略宽，边缘利落）
  live: 'rgba(125,211,252,0.95)',   // 绘制中的预览
};
function roadFill() { return GRID_PALETTE[GRID_IDX[ROAD_TILE_ID]].color; }

/* 路宽一律按「格」算 ⇒ 永远和网格对得齐（1 格 = cellSize 米） */
function roadCellSize() { return (currentMap && currentMap.cellSize) || 5; }
function snapToCellCenter(v) { const cs = roadCellSize(); return Math.round((v - cs / 2) / cs) * cs + cs / 2; }
function roadCellsOf(rd) { return Math.max(1, Math.round(((rd && rd.w) || 0) / roadCellSize())); }
function syncRoadWidth(labelEl) {
  roadWidth = roadCells * roadCellSize();
  if (labelEl) labelEl.textContent = roadCells + ' 格 · ' + roadWidth + ' 米';
}

/* 找最近的「已有公路上的点」—— 画路口时吸附到它，两条路就**真正共点**（衔接） */
function nearestRoadSnap(wx, wy, pxRadius) {
  if (!currentMap) return null;
  ensureRoads(currentMap);
  const radius = (pxRadius || 14) / (camera.zoom || 1);
  let best = null;
  for (const rd of currentMap.roads) {
    if (!rd.pts || rd.pts.length < 2) continue;
    for (let i = 1; i < rd.pts.length; i++) {
      const a = rd.pts[i - 1], b = rd.pts[i];
      const vx = b.x - a.x, vy = b.y - a.y;
      const L2 = vx * vx + vy * vy;
      if (L2 < 1) continue;
      let t = ((wx - a.x) * vx + (wy - a.y) * vy) / L2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const cx = a.x + vx * t, cy = a.y + vy * t;
      const d = Math.hypot(wx - cx, wy - cy);
      if (d <= radius && (!best || d < best.d)) best = { x: cx, y: cy, d };
    }
  }
  return best;
}

/* 光标位置最终落在哪：优先吸已有公路（路口），否则吸格心（和网格对齐） */
function roadCursorSnap() {
  if (!roadCursorW) return null;
  const s = nearestRoadSnap(roadCursorW.x, roadCursorW.y, 14);
  if (s) return { x: s.x, y: s.y, snapped: true };
  return { x: snapToCellCenter(roadCursorW.x), y: snapToCellCenter(roadCursorW.y), snapped: false };
}

function setRoadStatus(text, isErr) {
  lastRoadMsg = text || '';
  const el = $('road-status');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isErr ? '#f87171' : '#94a3b8';
}

/* 公路画在主画布上（随缩放/平移自动同步；与出生区覆盖层同一套路） */
function drawRoadOverlay(c) {
  if (!currentMap) return;
  ensureRoads(currentMap);
  const z = camera.zoom || 1;
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const trace = (p) => {
    c.beginPath();
    c.moveTo(p[0].sx, p[0].sy);
    for (let i = 1; i < p.length; i++) c.lineTo(p[i].sx, p[i].sy);
    c.stroke();
  };
  /* ★ 两遍：先画**所有**路基、再画**所有**路面 ——
     单条路"路基+路面"连着画，后画的路基会横切先画的路面 ⇒ 路口一道黑缝（看着"没接上"） */
  const items = [];
  for (const rd of currentMap.roads) {
    if (!rd.pts || rd.pts.length < 2) continue;
    items.push({ rd, p: rd.pts.map(q => w2s(q.x, q.y)) });
  }
  c.setLineDash([]);
  for (const pass of [0, 1]) {
    for (const it of items) {
      c.strokeStyle = (pass === 0) ? ROAD_COLORS.base : roadFill();
      c.lineWidth = Math.max(1, (pass === 0 ? (it.rd.w + 2) : it.rd.w) * z);
      trace(it.p);
    }
  }
  for (const it of items) {
    if (it.rd.w >= 8 && z >= 0.06) {         // 宽路：中心虚线（一眼看出是公路）
      c.setLineDash([10 * z, 12 * z]);
      c.strokeStyle = 'rgba(226,232,240,0.32)';
      c.lineWidth = Math.max(0.6, 0.8 * z);
      trace(it.p);
      c.setLineDash([]);
    }
    if (z >= 0.12) {                         // 顶点提示（这是折线、点在哪）
      c.fillStyle = 'rgba(226,232,240,0.55)';
      for (const q of it.p) { c.beginPath(); c.arc(q.sx, q.sy, 2.2, 0, Math.PI * 2); c.fill(); }
    }
  }
  if (roadDraw && roadDraw.length) {         // 绘制预览：宽度所见即所得
    const p = roadDraw.map(q => w2s(q.x, q.y));
    const cn = roadCursorSnap();             // ★ 光标也吸附（吸到已有公路时会画个圈）
    if (cn) p.push(w2s(cn.x, cn.y));
    c.strokeStyle = ROAD_COLORS.live;
    c.lineWidth = Math.max(1, roadWidth * z);
    c.globalAlpha = 0.32;
    trace(p);
    c.globalAlpha = 1;
    c.fillStyle = '#bae6fd';
    for (const q of roadDraw) {
      const s = w2s(q.x, q.y);
      c.beginPath(); c.arc(s.sx, s.sy, 3.4, 0, Math.PI * 2); c.fill();
    }
    if (cn && cn.snapped) {                  // 吸到已有公路上了 ⇒ 明显标出来
      const s = w2s(cn.x, cn.y);
      c.strokeStyle = '#22d3ee';
      c.lineWidth = 2;
      c.beginPath(); c.arc(s.sx, s.sy, 8, 0, Math.PI * 2); c.stroke();
    }
  }
  c.restore();
}

/* 点一个拐点（左键） */
function roadClick(wx, wy) {
  if (!currentMap) return;
  if (!roadDraw) {
    roadDraw = [];
    setRoadStatus('公路（' + roadCells + ' 格 · ' + roadWidth + ' 米）：继续点拐点…（回车/双击 结束 · ⌫ 退点 · Esc/右键 取消）');
  }
  roadCursorW = { x: wx, y: wy };
  const q = roadCursorSnap() || { x: wx, y: wy };    // ★ 吸附：优先已有公路（路口共点），否则格心
  const last = roadDraw[roadDraw.length - 1];
  if (last && Math.hypot(last.x - q.x, last.y - q.y) < currentMap.cellSize * 0.5) return;   // 防重复点
  if (q.snapped) setRoadStatus('已吸附到已有公路（路口共点）· 继续点拐点…');
  roadDraw.push({ x: q.x, y: q.y });
  render();
}

/* 回车 / 双击 ⇒ 结束这条公路（写进地图 ⇒ 立刻烙成道路格） */
function finishRoadDraw() {
  const d = roadDraw;
  roadDraw = null;
  roadCursorW = null;
  if (!d || d.length < 2 || !currentMap) { setRoadStatus('公路：至少要点两个拐点'); render(); return; }
  pushHistory();
  ensureRoads(currentMap);
  const rd = {
    id: 'rd' + Date.now().toString(36),
    name: '公路 ' + (currentMap.roads.length + 1),
    w: roadWidth,
    pts: d.map(q => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 })),   // 点已在点击时吸附（公路/格心）⇒ 这里只整理精度
  };
  currentMap.roads.push(rd);
  invalidateRoadGrid(currentMap);
  gmRecomposeAll(currentMap);        // ★ 立刻烙进 _composedGrid ⇒ 烘焙/校验马上认这条路
  refreshRoadList();
  setRoadStatus('已添加「' + rd.name + '」：' + roadCellsOf(rd) + ' 格 · ' + rd.w + ' 米 · 长 ' + Math.round(roadLength(rd)) + ' 米');
  render();
}

/* 公路列表（名称 / 宽度 / 点数 / 长度 / 删除） */
/* HTML 转义（公路列表用；R8：原「路线」UI 的同名函数改名保留 —— 列表还要转义） */
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
function refreshRoadList() {
  const el = $('road-list');
  if (!el) return;
  if (!currentMap) { el.innerHTML = ''; return; }
  ensureRoads(currentMap);
  if (!currentMap.roads.length) {
    el.innerHTML = '<div style="font-size:11px;color:#64748b;">还没有公路：选「🛤 公路」在地图上点拐点画一条</div>';
    return;
  }
  el.innerHTML = currentMap.roads.map((rd, i) =>
    '<div style="display:flex;align-items:center;gap:5px;font-size:11px;padding:2px 0;border-bottom:1px solid rgba(148,163,184,.12);">' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(rd.name) + '">' + escHtml(rd.name) + '</span>' +
      '<span style="color:#94a3b8;">' + roadCellsOf(rd) + '格 · ' + rd.w + '米 · ' + Math.round(roadLength(rd)) + '米</span>' +
      '<button class="mini-btn road-del" data-del="' + i + '" style="padding:0 5px;">✕</button></div>'
  ).join('');
  el.querySelectorAll('.road-del').forEach(btn => btn.addEventListener('click', ev => {
    ev.stopPropagation();
    const i = +btn.dataset.del;
    pushHistory();
    currentMap.roads.splice(i, 1);
    invalidateRoadGrid(currentMap);
    gmRecomposeAll(currentMap);
      refreshRoadList();
      render();
    setRoadStatus('已删除 1 条公路');
  }));
}

/* 公路面板：宽度滑杆 + 清空 */
function bindRoadPanel() {
  const sl = $('road-width'), lb = $('road-width-label');
  if (sl) {
    roadCells = Math.max(1, parseInt(sl.value, 10) || 2);
    syncRoadWidth(lb);
    sl.addEventListener('input', () => {
      roadCells = Math.max(1, parseInt(sl.value, 10) || 2);
      syncRoadWidth(lb);                       // 标签同时给「格」和「米」
      if (roadDraw) { setRoadStatus('公路（' + roadCells + ' 格 · ' + roadWidth + ' 米）：继续点拐点…'); render(); }
    });
  }
  const clr = $('btn-road-clear');
  if (clr) clr.addEventListener('click', async () => {
    if (!currentMap || !(currentMap.roads || []).length) { setRoadStatus('这张图还没有公路'); return; }
    if (!(await Dlg.confirm('清空这张图的全部公路（' + currentMap.roads.length + ' 条）？'))) return;
    pushHistory();
    currentMap.roads = [];
    invalidateRoadGrid(currentMap);
    gmRecomposeAll(currentMap);
      refreshRoadList();
      render();
    setRoadStatus('已清空全部公路');
  });
  refreshRoadList();
}

