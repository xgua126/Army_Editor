/* ============================================================
   hex-map-editor.js —— 六角格地图编辑器（纯手绘 · 不用 5m 光栅）
   ------------------------------------------------------------
   玩家：\"要出一个六角格的地图编辑器\"
   ------------------------------------------------------------
   产物（localStorage `mil_hex_maps_v1`）：
     { id, name, cols, rows, w, h,
       hexData: { cols, rows,
                  terr:   ['empty','forest',...],  // 每格地形（长度 cols*rows）
                  road:   [0,1,...],               // 公路（叠加属性）
                  obj:    [-1,0,-1,...],           // 据点编号（-1 = 没有）
                  deploy: ['','blue','red',...] }, // 部署区
       objectives: [{ id, name, x, y, r }] }
   兵棋（wargame.html）启动时把这份数据读进 GRID_MAPS，
   `bakeHexMap()` 见到 `hexData` 就**直接照抄每格**（不采样、不投票）
   ⇒ 编辑器里画的每一格 = 打起来的每一格。

   依赖：
     · hex-core.js：HEX_EDGE / hexCenter / hexCorners / hexMapSize
       （**几何唯一真相**：本页不许自己算六角格坐标，否则和兵棋对不上）
     · grid-maps.js：GRID_PALETTE（**地形 id / 名称 / 颜色唯一真相**）
   ============================================================ */

const HM_KEY = 'mil_hex_maps_v1';
const $ = (id) => document.getElementById(id);

/* 地形：公路（onRoad）是**叠加属性**，不进地形选择器 */
const HM_TERRAIN = GRID_PALETTE.filter(p => !p.onRoad)
  .map(p => ({ id: p.id, name: p.name, color: p.color }));

/* 工具表（key 只用来显示快捷键） */
const HM_TOOLS = [
  { k: 'terrain', name: '🖌 地形',        key: '1', tip: '左键涂地形（右侧选一种）' },
  { k: 'road',    name: '🛣 公路',        key: '2', tip: '叠加/取消公路（不影响地形）' },
  { k: 'obj',     name: '🎯 据点',        key: '3', tip: '放/撤据点（胜利判定数这个）' },
  { k: 'deployB', name: '🔵 蓝方部署区',  key: '4', tip: '蓝方只在这些格子里开局' },
  { k: 'deployR', name: '🔴 红方部署区',  key: '5', tip: '红方只在这些格子里开局' },
  { k: 'erase',   name: '🧽 清空该格',    key: '6', tip: '地形/公路/据点/部署一起清' },
];

/* ★ R10.35：**画法**（怎么画）—— 和上面的"画什么"正交
   像普通地图编辑器一样支持直线 / 矩形 / 圆 / 填充 / 吸管 */
const HM_SHAPES = [
  { k: 'brush',  name: '✏ 画笔',  key: 'b', tip: '按住拖动，按笔刷大小一刷一片（默认）' },
  { k: 'line',   name: '／ 直线', key: 'l', tip: '按下拖一条直线，沿线的格子一次刷完' },
  { k: 'rect',   name: '▭ 矩形',  key: 'r', tip: '按下拖一个矩形，框里的格子一次刷完' },
  { k: 'circle', name: '◯ 圆',   key: 'c', tip: '按下拖一个圆，圆里的格子一次刷完' },
  { k: 'fill',   name: '🪣 填充', key: 'g', tip: '点一下：把相连的同一种地形整片换掉' },
  { k: 'pick',   name: '💧 吸管', key: 'i', tip: '点一格，把它的地形设为当前地形' },
];

/* 编辑器状态（数据都在这里，保存时才序列化） */
const S = {
  id: null,
  name: '新六角地图',
  cols: 29,
  rows: 17,
  terr: [], road: [], obj: [], deploy: [],
  tool: 'terrain',       // 画什么（terrain / road / obj / deployB / deployR / erase）
  shapeTool: 'brush',    // ★ R10.35：怎么画（brush / line / rect / circle / fill / pick）
  brush: 0,              // ★ R10.35：画笔笔刷半径（格），0 = 单格
  terrId: 'empty',
  cam: { x: 0, y: 0, k: 0.6 },
  hover: null,
  paint: null,          // 正在画 { erase }
  shape: null,          // ★ 正在拖的形状 { a, b, erase }
  pan: null,            // 正在右键平移
  overlay: { img: null, dataUrl: '', alpha: 0.55, visible: true },   // ★ 参考底图
  undo: [],             // ★ 撤销栈（一次"按下→抬起"算一步）
  dirty: false,
};

let cv = null, CTX = null, DPR = 1;

/* ---------- 小工具 ---------- */
function sizeOf() { return hexMapSize(S.cols, S.rows); }
function cellCount() { return S.cols * S.rows; }
function terrColor(id) {
  const t = HM_TERRAIN.find(x => x.id === id);
  return t ? t.color : '#a8c585';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function toast(msg) {
  const info = $('hm-info');
  if (!info) return;
  const line = document.createElement('div');
  line.className = 'toast';
  line.textContent = msg;
  info.insertBefore(line, info.firstChild);
  setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 3200);
}

/* ---------- 数据模型 ---------- */
function blankData(cols, rows) {
  const n = Math.max(1, cols | 0) * Math.max(1, rows | 0);
  return {
    terr: new Array(n).fill('empty'),
    road: new Array(n).fill(0),
    obj: new Array(n).fill(0),
    deploy: new Array(n).fill(''),
  };
}
/* 改格数：按行列**重叠拷贝**，原来的东西不丢（超出的截掉） */
function resizeData(cols, rows) {
  const old = { cols: S.cols, rows: S.rows, terr: S.terr, road: S.road, obj: S.obj, deploy: S.deploy };
  const fresh = blankData(cols, rows);
  for (let row = 0; row < Math.min(rows, old.rows); row++) {
    for (let col = 0; col < Math.min(cols, old.cols); col++) {
      const a = row * old.cols + col, b = row * cols + col;
      fresh.terr[b] = old.terr[a] || 'empty';
      fresh.road[b] = old.road[a] || 0;
      fresh.obj[b] = old.obj[a] || 0;
      fresh.deploy[b] = old.deploy[a] || '';
    }
  }
  S.cols = cols; S.rows = rows;
  S.terr = fresh.terr; S.road = fresh.road; S.obj = fresh.obj; S.deploy = fresh.deploy;
  S.hover = null;
}

function newMap(cols, rows) {
  S.id = null;
  S.cols = Math.max(4, Math.min(80, cols | 0 || 29));
  S.rows = Math.max(4, Math.min(60, rows | 0 || 17));
  const d = blankData(S.cols, S.rows);
  S.terr = d.terr; S.road = d.road; S.obj = d.obj; S.deploy = d.deploy;
  S.hover = null;
  S.undo = [];                     // ★ 新图 = 新的撤销起点
  applyOverlay(null);              // ★ 新图 = 没有参考图
  S.dirty = true;
  fitCamera();
  draw();
  refreshInfo();
  refreshUndoUI();
  toast('新建空白地图：' + S.cols + '×' + S.rows + ' 格 ≈ ' +
        Math.round(sizeOf().w / 1000) + '×' + Math.round(sizeOf().h / 1000) + 'km');
}

/* 数据 → 可保存的地图对象（把"有据点"的格子编成 0,1,2… 供 objectiveTally 用） */
function buildMapObject() {
  const size = sizeOf();
  const objIdx = new Array(cellCount()).fill(-1);
  const objectives = [];
  for (let i = 0; i < cellCount(); i++) {
    if (!S.obj[i]) continue;
    const col = i % S.cols, row = Math.floor(i / S.cols);
    const c = hexCenter(col, row);
    objIdx[i] = objectives.length;
    objectives.push({
      id: 'o' + (objectives.length + 1),
      name: '据点 ' + (objectives.length + 1),
      x: Math.round(c.x), y: Math.round(c.y),
      r: Math.round(HEX_EDGE * 1.1),
      rHex: 1,          // ★ R10.23：兵棋里据点半径改成**格**（编辑器画的 1 格 = rHex 1）
    });
  }
  return {
    id: S.id || ('hx' + Date.now().toString(36)),
    name: S.name || '未命名六角地图',
    cols: S.cols, rows: S.rows, w: size.w, h: size.h,
    hexData: {
      cols: S.cols, rows: S.rows,
      terr: S.terr.slice(),
      road: S.road.map(v => (v ? 1 : 0)),
      obj: objIdx,
      deploy: S.deploy.slice(),
    },
    objectives,
    /* ★ R10.35：参考底图（可选，跟着地图一起存） */
    overlay: S.overlay.dataUrl
      ? { dataUrl: S.overlay.dataUrl, alpha: S.overlay.alpha, visible: S.overlay.visible }
      : null,
    _v: 1,
  };
}

/* 地图对象 → 编辑器状态 */
function applyMapObject(m) {
  const hd = m.hexData || {};
  S.id = m.id || null;
  S.name = m.name || '未命名六角地图';
  S.cols = Math.max(4, Math.min(80, (hd.cols || m.cols || 29) | 0));
  S.rows = Math.max(4, Math.min(60, (hd.rows || m.rows || 17) | 0));
  const n = cellCount();
  S.terr = new Array(n).fill('empty');
  S.road = new Array(n).fill(0);
  S.obj  = new Array(n).fill(0);
  S.deploy = new Array(n).fill('');
  for (let i = 0; i < n; i++) {
    if (hd.terr && hd.terr[i]) S.terr[i] = hd.terr[i];
    if (hd.road && +hd.road[i]) S.road[i] = 1;
    if (hd.obj && hd.obj[i] != null && hd.obj[i] >= 0) S.obj[i] = 1;
    if (hd.deploy && hd.deploy[i]) S.deploy[i] = hd.deploy[i];
  }
  S.terrId = 'empty';
  S.tool = 'terrain';
  S.shapeTool = 'brush';
  S.shape = null;
  S.hover = null;
  applyOverlay(m.overlay);          // ★ R10.35：把参考底图也恢复出来
  S.undo = [];                     // ★ 换了一张图：撤销栈不能跨图
  S.dirty = false;
  $('hm-name').value = S.name;
  $('hm-cols').value = S.cols;
  $('hm-rows').value = S.rows;
  fitCamera();
  draw();
  refreshInfo();
  refreshToolUI();
  refreshTerrUI();
  refreshUndoUI();
}

/* ---------- 本机存储 ---------- */
function loadAllMaps() {
  try { return JSON.parse(localStorage.getItem(HM_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveAllMaps(all) {
  try { localStorage.setItem(HM_KEY, JSON.stringify(all)); return true; }
  catch (e) { toast('保存失败：' + e.message); return false; }
}
function refreshMapSelect() {
  const sel = $('hm-maps');
  const all = loadAllMaps();
  const ids = Object.keys(all).sort((a, b) => (all[b].savedAt || 0) - (all[a].savedAt || 0));
  sel.innerHTML = '<option value="">（未保存的新地图）</option>' + ids.map(id =>
    '<option value="' + esc(id) + '">' + esc(all[id].name || id) + '</option>').join('');
  sel.value = (S.id && all[S.id]) ? S.id : '';
}
function saveMap() {
  /* 名字 / 格数以输入框为准（改了格数按行列重叠保留内容） */
  S.name = ($('hm-name').value || '').trim() || '未命名六角地图';
  const cols = Math.max(4, Math.min(80, parseInt($('hm-cols').value, 10) || S.cols));
  const rows = Math.max(4, Math.min(60, parseInt($('hm-rows').value, 10) || S.rows));
  if (cols !== S.cols || rows !== S.rows) resizeData(cols, rows);
  const m = buildMapObject();
  m.savedAt = Date.now();
  const all = loadAllMaps();
  all[m.id] = m;
  if (!saveAllMaps(all)) return;
  S.id = m.id;
  S.dirty = false;
  refreshMapSelect();
  draw();
  refreshInfo();
  toast('已保存「' + m.name + '」：' + m.cols + '×' + m.rows + ' 格 · ' +
        m.objectives.length + ' 个据点（兵棋「地图」下拉框 → 我的地图）');
}
function deleteMap() {
  if (!S.id) { toast('这张还没保存过，没什么可删的'); return; }
  const all = loadAllMaps();
  if (!all[S.id]) { S.id = null; refreshMapSelect(); toast('本机存储里已经没有这张'); return; }
  if (!confirm('删除地图「' + (all[S.id].name || S.id) + '」？\n（只删本机保存的这张，当前画布不动）')) return;
  delete all[S.id];
  saveAllMaps(all);
  S.id = null;
  refreshMapSelect();
  draw();
  refreshInfo();
  toast('已删除');
}

/* ---------- 相机（和兵棋同一套：世界坐标 ⇄ 屏幕坐标） ---------- */
function w2s(x, y) { return { x: (x - S.cam.x) * S.cam.k, y: (y - S.cam.y) * S.cam.k }; }
function s2w(x, y) { return { x: x / S.cam.k + S.cam.x, y: y / S.cam.k + S.cam.y }; }
function fitCamera() {
  const size = sizeOf();
  const pad = 16;
  const kx = (cv.width / DPR - pad * 2) / Math.max(1, size.w);
  const ky = (cv.height / DPR - pad * 2) / Math.max(1, size.h);
  S.cam.k = Math.max(0.05, Math.min(3, Math.min(kx, ky)));
  S.cam.x = (size.w - (cv.width / DPR) / S.cam.k) / 2;
  S.cam.y = (size.h - (cv.height / DPR) / S.cam.k) / 2;
}
function zoomAt(sx, sy, factor) {
  const before = s2w(sx, sy);
  S.cam.k = Math.max(0.05, Math.min(4, S.cam.k * factor));
  const after = s2w(sx, sy);
  S.cam.x += before.x - after.x;
  S.cam.y += before.y - after.y;
}
function hexAtScreen(sx, sy) {
  const w = s2w(sx, sy);
  const p = worldToHex(w.x, w.y);
  if (p.col < 0 || p.row < 0 || p.col >= S.cols || p.row >= S.rows) return null;
  return { col: p.col, row: p.row, x: hexCenter(p.col, p.row).x, y: hexCenter(p.col, p.row).y };
}

/* ---------- 画布 ---------- */
function resizeCanvas() {
  const stage = $('hm-stage');
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const r = stage.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * DPR));
  cv.height = Math.max(1, Math.round(r.height * DPR));
}
function hexPath(ctx, cx, cy, r) {
  const cs = hexCorners(cx, cy, r);
  ctx.beginPath();
  ctx.moveTo(cs[0].x, cs[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(cs[i].x, cs[i].y);
  ctx.closePath();
}

/* ---------- ★ R10.35：参考底图 + 绘制预览 ---------- */
function drawOverlay(ctx) {
  const o = S.overlay;
  if (!o || !o.img || !o.visible || !o.dataUrl) return;
  const size = sizeOf();
  const a = w2s(0, 0), b = w2s(size.w, size.h);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
  try { ctx.drawImage(o.img, a.x, a.y, b.x - a.x, b.y - a.y); } catch (e) { /* 图片还没解码好 */ }
  ctx.restore();
}

function drawPreview(ctx) {
  const k = S.cam.k, r = HEX_EDGE * k;
  const mark = (cells, fill, stroke) => {
    if (!cells.length) return;
    ctx.beginPath();
    for (const c of cells) {
      const w = hexCenter(c.col, c.row), p = w2s(w.x, w.y);
      hexPath(ctx, p.x, p.y, r);
    }
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, 2 * k);
      ctx.stroke();
    }
  };
  if (S.shape) {                              // 正在拖的形状
    mark(shapeCells(S.shape.a, S.shape.b), 'rgba(59,130,246,.45)', '#bfdbfe');
    return;
  }
  if (!S.hover) return;
  if (S.shapeTool === 'brush' || S.shapeTool === 'fill') {
    mark(brushCells(S.hover), 'rgba(255,255,255,.16)', 'rgba(255,255,255,.5)');
  } else if (S.shapeTool === 'pick') {
    mark([S.hover], 'rgba(250,204,21,.32)', '#fde68a');
  }
}

function draw() {
  if (!CTX) return;
  const ctx = CTX;
  const W = cv.width / DPR, H = cv.height / DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  /* 背景（地图外的"桌面"） */
  ctx.fillStyle = '#070c17';
  ctx.fillRect(0, 0, W, H);

  /* ★ R10.35：参考底图（半透明垫在格子下面，照着描） */
  drawOverlay(ctx);

  const k = S.cam.k;
  const r = HEX_EDGE * k;
  const tl = s2w(0, 0), br = s2w(W, H);
  const rowMin = Math.max(0, Math.floor((tl.y - HEX_EDGE) / HEX_ROW_STEP) - 1);
  const rowMax = Math.min(S.rows - 1, Math.ceil((br.y + HEX_EDGE) / HEX_ROW_STEP) + 1);
  const colMin = Math.max(0, Math.floor((tl.x - HEX_W) / HEX_W) - 1);
  const colMax = Math.min(S.cols - 1, Math.ceil((br.x + HEX_W) / HEX_W) + 1);

  /* ① 地形 + 公路 + 部署区 */
  ctx.lineWidth = Math.max(0.6, Math.min(1.6, 0.9 * k + 0.3));
  ctx.strokeStyle = 'rgba(8,14,26,.55)';
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const i = row * S.cols + col;
      const c = hexCenter(col, row);
      const p = w2s(c.x, c.y);
      hexPath(ctx, p.x, p.y, Math.max(1, r));
      ctx.fillStyle = terrColor(S.terr[i]);
      ctx.fill();
      /* 部署区：半透明底色（先铺，公路压在上面） */
      if (S.deploy[i]) {
        ctx.fillStyle = (S.deploy[i] === 'blue')
          ? 'rgba(59,130,246,.34)' : 'rgba(239,68,68,.34)';
        ctx.fill();
      }
      ctx.stroke();
    }
  }

  /* ② 公路：**相邻格子要连起来**（玩家："编辑器里的道路不会自动连接起来"）
     ------------------------------------------------------------
     旧画法：每格自己画一条横带 ⇒ 拐弯/上下相邻的地方是断的。
     现在：从格心画到"两个格心连线的中点"（= 两格共用边的中点），
          邻居也有路就画一段 ⇒ 连续的一条路；孤立的一格画个圆点。
     深色路面 + 中间虚线分道，再统一叠一次，看起来才像公路。 */
  const roadSegs = [];
  const roadDots = [];
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      if (!S.road[row * S.cols + col]) continue;
      const c = hexCenter(col, row);
      const p = w2s(c.x, c.y);
      let links = 0;
      for (const q of hexNeighbors(col, row)) {
        if (q.col < 0 || q.row < 0 || q.col >= S.cols || q.row >= S.rows) continue;
        if (!S.road[q.row * S.cols + q.col]) continue;
        const c2 = hexCenter(q.col, q.row);
        const m = w2s((c.x + c2.x) / 2, (c.y + c2.y) / 2);     // 共用边的中点
        roadSegs.push([p, m]);
        links++;
      }
      if (!links) roadDots.push(p);
    }
  }
  if (roadSegs.length || roadDots.length) {
    ctx.save();
    ctx.lineCap = 'round';
    /* 路面 */
    ctx.strokeStyle = 'rgba(26,32,44,.94)';
    ctx.lineWidth = Math.max(2, r * 0.30);
    for (const [a, b] of roadSegs) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(26,32,44,.94)';
    for (const p of roadDots) {
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, r * 0.16), 0, Math.PI * 2); ctx.fill();
    }
    /* 中间的虚线（同一条带子，显得是条路而不是一根线） */
    if (r > 7) {
      ctx.strokeStyle = 'rgba(214,220,232,.55)';
      ctx.lineWidth = Math.max(0.8, r * 0.055);
      ctx.setLineDash([Math.max(2, r * 0.30), Math.max(2, r * 0.24)]);
      for (const [a, b] of roadSegs) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ② 据点（画在公路之后，保证看得见） */
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const i = row * S.cols + col;
      if (!S.obj[i]) continue;
      const c = hexCenter(col, row);
      const p = w2s(c.x, c.y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, r * 0.42), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(252,211,77,.22)';
      ctx.fill();
      ctx.lineWidth = Math.max(1.2, r * 0.09);
      ctx.strokeStyle = '#fcd34d';
      ctx.stroke();
      if (r > 9) {
        ctx.fillStyle = '#fde68a';
        ctx.font = '900 ' + Math.round(Math.min(r * 0.8, 18)) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚑', p.x, p.y + r * 0.03);
      }
      ctx.restore();
    }
  }

  /* ③ 鼠标所在格：高亮 + 行列号 */
  if (S.hover) {
    const p = w2s(S.hover.x, S.hover.y);
    hexPath(ctx, p.x, p.y, Math.max(1, r * 0.97));
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = '#93c5fd';
    ctx.stroke();
    ctx.fillStyle = '#dbeafe';
    ctx.font = '700 ' + Math.round(Math.max(10, Math.min(r * 0.55, 15))) + 'px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(S.hover.col + ',' + S.hover.row, p.x - r * 0.8, p.y - r * 0.95);
  }

  /* ④ 每 5 格标一次坐标（放大时才画，别糊成一片） */
  if (k >= 0.55) {
    ctx.fillStyle = 'rgba(15,23,42,.55)';
    ctx.font = '700 ' + Math.round(Math.max(9, Math.min(r * 0.42, 13))) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        if (col % 5 !== 0 || row % 5 !== 0) continue;
        const c = hexCenter(col, row);
        const p = w2s(c.x, c.y);
        ctx.fillText(col + ',' + row, p.x, p.y - r * 0.42);
      }
    }
  }

  /* ★ R10.35：形状 / 笔刷预览（画在最上层） */
  drawPreview(ctx);
}

/* ---------- 侧栏：工具 / 地形 / 统计 ---------- */
function buildToolUI() {
  const box = $('hm-tools');
  box.innerHTML = HM_TOOLS.map(t =>
    '<button class="tool-btn" data-tool="' + t.k + '" title="' + esc(t.tip) + '">' +
      '<span>' + esc(t.name) + '</span><span class="key">' + t.key + '</span></button>').join('');
  box.querySelectorAll('button[data-tool]').forEach(b => {
    b.addEventListener('click', () => { S.tool = b.getAttribute('data-tool'); refreshToolUI(); });
  });
  refreshToolUI();
}
function refreshToolUI() {
  document.querySelectorAll('#hm-tools button[data-tool]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tool') === S.tool);
  });
}

/* ---------- ★ R10.35：画法（形状）UI ---------- */
function buildShapeUI() {
  const box = $('hm-shapes');
  if (!box) return;
  box.innerHTML = HM_SHAPES.map(t =>
    '<button class="tool-btn" data-shape="' + t.k + '" title="' + esc(t.tip) + '">' +
      '<span>' + esc(t.name) + '</span><span class="key">' + t.key.toUpperCase() + '</span></button>').join('');
  box.querySelectorAll('button[data-shape]').forEach(b => {
    b.addEventListener('click', () => { S.shapeTool = b.getAttribute('data-shape'); refreshShapeUI(); });
  });
  refreshShapeUI();
}
function refreshShapeUI() {
  document.querySelectorAll('#hm-shapes button[data-shape]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-shape') === S.shapeTool);
  });
}
function refreshBrushUI() {
  const lab = $('hm-brush-label');
  if (lab) lab.textContent = S.brush ? ('半径 ' + S.brush + ' 格') : '单格';
}

/* ---------- ★ R10.35：参考底图 UI ---------- */
function refreshOverlayUI() {
  const has = !!S.overlay.dataUrl;
  const vis = $('hm-overlay-visible'), alp = $('hm-overlay-alpha');
  const lab = $('hm-overlay-label'), clr = $('hm-overlay-clear'), hint = $('hm-overlay-state');
  if (vis) { vis.checked = !!S.overlay.visible; vis.disabled = !has; }
  if (alp) { alp.value = Math.round(S.overlay.alpha * 100); alp.disabled = !has; }
  if (lab) lab.textContent = Math.round(S.overlay.alpha * 100) + '%';
  if (clr) clr.disabled = !has;
  if (hint) hint.textContent = has ? '已导入参考图（保存后跟着地图一起存）' : '还没导入参考图';
}
function applyOverlay(o) {
  S.overlay.dataUrl = (o && o.dataUrl) || '';
  S.overlay.alpha = (o && typeof o.alpha === 'number') ? o.alpha : 0.55;
  S.overlay.visible = !(o && o.visible === false);
  S.overlay.img = null;
  if (S.overlay.dataUrl) {
    const img = new Image();
    img.onload = () => { S.overlay.img = img; draw(); };
    img.src = S.overlay.dataUrl;
  }
  refreshOverlayUI();
}
/* 上传的图先缩到 1600px 以内再存（localStorage 有限） */
function setOverlayFromFile(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    const raw = String(fr.result || '');
    const img = new Image();
    img.onload = () => {
      let url = raw;
      try {
        const max = 1600;
        const k = Math.min(1, max / Math.max(img.width || max, img.height || max));
        const c2 = document.createElement('canvas');
        c2.width = Math.max(1, Math.round((img.width || max) * k));
        c2.height = Math.max(1, Math.round((img.height || max) * k));
        c2.getContext('2d').drawImage(img, 0, 0, c2.width, c2.height);
        url = c2.toDataURL('image/jpeg', 0.82);
      } catch (e) { /* 跨域/画布受限就用原图 */ }
      S.overlay.dataUrl = url;
      S.dirty = true;
      applyOverlay({ dataUrl: url, alpha: S.overlay.alpha, visible: true });
      toast('参考图已导入：半透明垫在格子下面（记得保存）');
    };
    img.onerror = () => toast('这张图片读不出来');
    img.src = raw;
  };
  fr.readAsDataURL(file);
}
function buildTerrUI() {
  const box = $('hm-terr');
  box.innerHTML = '<div class="terr-grid">' + HM_TERRAIN.map(t =>
    '<button class="terr-btn" data-terr="' + t.id + '" title="' + esc(t.name) + '">' +
      '<span class="terr-swatch" style="background:' + t.color + '"></span>' +
      esc(t.name) + '</button>').join('') + '</div>';
  box.querySelectorAll('button[data-terr]').forEach(b => {
    b.addEventListener('click', () => {
      S.terrId = b.getAttribute('data-terr');
      S.tool = 'terrain';                 // 点地形自动切回"涂地形"工具
      refreshTerrUI(); refreshToolUI();
    });
  });
  refreshTerrUI();
}
function refreshTerrUI() {
  document.querySelectorAll('#hm-terr button[data-terr]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-terr') === S.terrId);
  });
}
function refreshInfo() {
  const el = $('hm-info');
  if (!el) return;
  const cnt = {};
  let roads = 0, objs = 0, blue = 0, red = 0;
  for (let i = 0; i < cellCount(); i++) {
    cnt[S.terr[i]] = (cnt[S.terr[i]] || 0) + 1;
    if (S.road[i]) roads++;
    if (S.obj[i]) objs++;
    if (S.deploy[i] === 'blue') blue++;
    else if (S.deploy[i] === 'red') red++;
  }
  const size = sizeOf();
  const rowsT = HM_TERRAIN.filter(t => cnt[t.id]).map(t =>
    '<div>' + '<span class="terr-swatch" style="display:inline-block;vertical-align:-2px;background:' +
    t.color + '"></span> ' + esc(t.name) + ' <b>' + cnt[t.id] + '</b></div>').join('');
  el.innerHTML =
    '<div><b>' + esc(S.name) + (S.dirty ? ' *' : '') + '</b></div>' +
    '<div>S ' + S.cols + '×' + S.rows + ' = ' + cellCount() + ' 格 · ' +
      Math.round(size.w) + '×' + Math.round(size.h) + 'm（每格 ' + HEX_EDGE + 'm）</div>' +
    '<div>公路 <b>' + roads + '</b> · 据点 <b>' + objs + '</b> · 部署 蓝 <b>' + blue + '</b> / 红 <b>' + red + '</b></div>' +
    '<div style="margin-top:6px;border-top:1px solid #1e293b;padding-top:5px">' + (rowsT || '（全是草地）') + '</div>' +
    '<div style="margin-top:6px;border-top:1px solid #1e293b;padding-top:5px;color:#64748b">' +
      '左键画 · 右键拖动平移 · 滚轮缩放 · Shift+左键 = 擦<br>' +
      '1~6 画什么 · B画笔 / L直线 / R矩形 / C圆 / G填充 / I吸管<br>' +
      '📷 参考图：导入卫星图/老地图垫在下面描<br>' +
      '保存后：兵棋「地图」下拉框 → 📁 我的地图' +
    '</div>';
}

/* ---------- 涂格子 ---------- */
/* solid=true 用于形状工具：据点/公路一律"写 1"，不像单点那样来回切 */
function applyTool(h, erase, solid) {
  const i = h.row * S.cols + h.col;
  if (S.tool === 'terrain') {
    S.terr[i] = erase ? 'empty' : S.terrId;
  } else if (S.tool === 'road') {
    S.road[i] = erase ? 0 : 1;
  } else if (S.tool === 'obj') {
    S.obj[i] = erase ? 0 : (solid ? 1 : (S.obj[i] ? 0 : 1));
  } else if (S.tool === 'deployB') {
    S.deploy[i] = erase ? '' : 'blue';
  } else if (S.tool === 'deployR') {
    S.deploy[i] = erase ? '' : 'red';
  } else if (S.tool === 'erase') {
    S.terr[i] = 'empty'; S.road[i] = 0; S.obj[i] = 0; S.deploy[i] = '';
  }
  S.dirty = true;
}

/* ★ R10.35：笔刷范围（半径内的所有格） */
function brushCells(h) {
  const r = Math.max(0, Math.min(6, S.brush | 0));
  if (!r) return [{ col: h.col, row: h.row }];
  const out = [];
  for (let row = h.row - r; row <= h.row + r; row++) {
    for (let col = h.col - r; col <= h.col + r; col++) {
      if (col < 0 || row < 0 || col >= S.cols || row >= S.rows) continue;
      if (hexDistance(h, { col, row }) > r) continue;
      out.push({ col, row });
    }
  }
  return out;
}
/* 画笔：按笔刷大小一次刷一片 */
function stamp(h, erase) {
  if (!h) return;
  for (const c of brushCells(h)) applyTool(c, erase);
}

/* ★ R10.35：形状要刷的格子（直线 / 矩形 / 圆） */
function shapeCells(a, b) {
  const out = [];
  if (!a || !b) return out;
  if (S.shapeTool === 'line') {
    out.push({ col: a.col, row: a.row });
    for (const c of hexLine(a, b)) out.push(c);
    out.push({ col: b.col, row: b.row });
  } else if (S.shapeTool === 'rect') {
    const c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
    const r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
    for (let row = r0; row <= r1; row++)
      for (let col = c0; col <= c1; col++) out.push({ col, row });
  } else if (S.shapeTool === 'circle') {
    const rad = hexDistance(a, b);
    for (let row = a.row - rad; row <= a.row + rad; row++) {
      for (let col = a.col - rad; col <= a.col + rad; col++) {
        if (hexDistance(a, { col, row }) <= rad) out.push({ col, row });
      }
    }
  }
  return out.filter(c => c.col >= 0 && c.row >= 0 && c.col < S.cols && c.row < S.rows);
}

/* ★ R10.35：填充 —— 把相连的"同一种地形"整片换成当前地形（只对地形有效） */
function fillTerrain(h, erase) {
  if (!h) return;
  const from = S.terr[h.row * S.cols + h.col];
  const to = erase ? 'empty' : S.terrId;
  if (from === to) return;
  const stack = [{ col: h.col, row: h.row }];
  const seen = new Set();
  while (stack.length) {
    const c = stack.pop();
    if (c.col < 0 || c.row < 0 || c.col >= S.cols || c.row >= S.rows) continue;
    const i = c.row * S.cols + c.col;
    if (seen.has(i)) continue;
    seen.add(i);
    if (S.terr[i] !== from) continue;
    S.terr[i] = to;
    for (const q of hexNeighbors(c.col, c.row)) stack.push(q);
  }
  S.dirty = true;
}

/* ★ R10.35：吸管 —— 取这一格的地形 */
function pickTerrain(h) {
  if (!h) return;
  S.terrId = S.terr[h.row * S.cols + h.col] || 'empty';
  S.shapeTool = 'brush';
  refreshTerrUI();
  refreshShapeUI();
  const t = HM_TERRAIN.find(x => x.id === S.terrId);
  toast('取色：' + (t ? t.name : S.terrId));
  draw();
}

/* 在屏幕上某点涂一下（同一格不重复触发 ⇒ 据点不会被"连点"翻回去） */
function paintAtScreen(sx, sy, erase) {
  const h = hexAtScreen(sx, sy);
  if (!h) return;
  const key = h.row * 10000 + h.col;
  if (S.paint && S.paint.last === key) return;
  if (S.paint) S.paint.last = key;
  stamp(h, erase);
  S.hover = h;
  draw();
  refreshInfo();
}

/* ============================================================
   ★ R10.17：**撤回上一步**（按钮 + Ctrl+Z）
   ------------------------------------------------------------
   编辑器里撤的是"画布状态"：四个数组（terr/road/obj/deploy）+ 格数 + 名字。
   一次鼠标按下→抬起算**一步**（拖着画一条路也只占一步，不会撤 20 次）。
   ★ 只存这四份数组的拷贝（493 格 × 4 = 不到 2KB/步），不碰 DOM 与渲染缓存。
   ============================================================ */
const HM_UNDO_MAX = 40;
function snapshotEdit() {
  return {
    cols: S.cols, rows: S.rows, name: S.name,
    terr: S.terr.slice(), road: S.road.slice(),
    obj: S.obj.slice(), deploy: S.deploy.slice(),
  };
}
function pushEditUndo() {
  S.undo.push(snapshotEdit());
  if (S.undo.length > HM_UNDO_MAX) S.undo.shift();
  refreshUndoUI();
}
function undoEdit() {
  const s = S.undo.pop();
  if (!s) return false;
  S.cols = s.cols; S.rows = s.rows; S.name = s.name;
  S.terr = s.terr.slice(); S.road = s.road.slice();
  S.obj = s.obj.slice(); S.deploy = s.deploy.slice();
  $('hm-name').value = S.name;
  $('hm-cols').value = S.cols;
  $('hm-rows').value = S.rows;
  S.hover = null;
  S.dirty = true;
  fitCamera();
  draw();
  refreshInfo();
  refreshUndoUI();
  return true;
}
function refreshUndoUI() {
  const b = $('hm-undo');
  if (!b) return;
  b.disabled = !S.undo.length;
  b.title = S.undo.length
    ? ('撤回上一步（Ctrl+Z）· 还可撤 ' + S.undo.length + ' 步')
    : '没有可撤回的步骤（Ctrl+Z）';
}

/* ---------- 事件 ---------- */
function bindUI() {
  const stage = $('hm-stage');
  const tip = $('hm-hint');

  cv.addEventListener('pointerdown', e => {
    if (e.button === 2 || e.button === 1) {          // 右键 / 中键 = 平移
      S.pan = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y };
      cv.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const rect = cv.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const hIt = hexAtScreen(sx, sy);
    const erase = !!e.shiftKey;
    if (tip) tip.classList.add('hidden');
    cv.setPointerCapture(e.pointerId);

    /* ★ R10.35：吸管不写数据，只取色 */
    if (S.shapeTool === 'pick') { pickTerrain(hIt); return; }
    if (!hIt) return;

    if (hIt) pushEditUndo();                   // ★ 一步一快照（整条拖画只占一步）

    /* ★ R10.35：填充 —— 一次点完 */
    if (S.shapeTool === 'fill') { fillTerrain(hIt, erase); draw(); refreshInfo(); return; }

    /* ★ R10.35：画笔还是老样子（可带笔刷大小） */
    if (S.shapeTool === 'brush') {
      S.paint = { erase, last: -1 };
      paintAtScreen(sx, sy, erase);
      return;
    }

    /* ★ R10.35：直线 / 矩形 / 圆 —— 拖出预览，抬起时才落笔 */
    S.shape = { a: hIt, b: hIt, erase };
    draw();
  });

  cv.addEventListener('pointermove', e => {
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (S.pan) {
      S.cam.x = S.pan.cx - (e.clientX - S.pan.x) / S.cam.k;
      S.cam.y = S.pan.cy - (e.clientY - S.pan.y) / S.cam.k;
      draw();
      return;
    }
    if (S.paint) { paintAtScreen(mx, my, S.paint.erase); return; }
    if (S.shape) {                                   // ★ R10.35：拖形状 → 只更新预览
      const hS = hexAtScreen(mx, my);
      if (hS) { S.shape.b = hS; draw(); }
      return;
    }
    const h = hexAtScreen(mx, my);
    const same = (h && S.hover && h.col === S.hover.col && h.row === S.hover.row) || (!h && !S.hover);
    if (!same) { S.hover = h; draw(); }
  });

  const endPointer = (e) => {
    if (S.pan) { S.pan = null; return; }
    /* ★ R10.35：抬起时把形状一次刷进去（撤销只占一步） */
    if (S.shape) {
      const cells = shapeCells(S.shape.a, S.shape.b);
      const erase = !!S.shape.erase;
      for (const c of cells) applyTool(c, erase, true);
      S.shape = null;
      S.dirty = true;
      draw();
      refreshInfo();
      return;
    }
    if (S.paint) { S.paint = null; refreshInfo(); }
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerleave', () => {
    if (S.hover && !S.paint && !S.pan) { S.hover = null; draw(); }
  });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 0.89);
    draw();
  }, { passive: false });

  window.addEventListener('resize', () => { resizeCanvas(); draw(); });

  window.addEventListener('keydown', e => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const t = HM_TOOLS.find(x => x.key === e.key);
    if (t) { S.tool = t.k; refreshToolUI(); return; }
    /* ★ R10.35：B / L / R / C / G / I 切"怎么画" */
    const sh = HM_SHAPES.find(x => x.key === e.key.toLowerCase());
    if (sh) { S.shapeTool = sh.k; refreshShapeUI(); draw(); return; }
    if (e.key === 'Escape') { S.paint = null; S.pan = null; S.shape = null; draw(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveMap(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoEdit(); }
  });

  $('hm-new').addEventListener('click', () => {
    if (S.dirty && !confirm('当前改动还没保存，新建会丢掉它。继续？')) return;
    newMap(parseInt($('hm-cols').value, 10), parseInt($('hm-rows').value, 10));
    refreshMapSelect();
  });
  $('hm-save').addEventListener('click', saveMap);
  $('hm-undo').addEventListener('click', undoEdit);
  $('hm-del').addEventListener('click', deleteMap);
  $('hm-play').addEventListener('click', () => {
    saveMap();                      // 先存，再去开兵棋（兵棋只认本机存储里的图）
    if (!S.id) return;
    location.href = 'wargame.html?map=' + encodeURIComponent(S.id);
  });
  $('hm-maps').addEventListener('change', () => {
    const id = $('hm-maps').value;
    const all = loadAllMaps();
    if (!id || !all[id]) { S.id = null; return; }
    if (S.dirty && !confirm('当前改动还没保存，切换地图会丢掉它。继续？')) {
      $('hm-maps').value = S.id || '';
      return;
    }
    applyMapObject(all[id]);
    S.dirty = false;
    if (tip) tip.classList.add('hidden');
  });
  $('hm-name').addEventListener('input', () => { S.name = $('hm-name').value; S.dirty = true; });
  $('hm-zoom-in').addEventListener('click', () => {
    zoomAt(cv.width / DPR / 2, cv.height / DPR / 2, 1.25); draw();
  });
  $('hm-zoom-out').addEventListener('click', () => {
    zoomAt(cv.width / DPR / 2, cv.height / DPR / 2, 0.8); draw();
  });
  $('hm-fit').addEventListener('click', () => { fitCamera(); draw(); });
  if (stage) stage.addEventListener('pointerdown', () => { if (tip) tip.classList.add('hidden'); }, true);

  /* ★ R10.35：笔刷大小 / 参考底图 */
  const brushEl = $('hm-brush');
  if (brushEl) brushEl.addEventListener('input', () => {
    S.brush = parseInt(brushEl.value, 10) || 0;
    refreshBrushUI();
    draw();
  });
  const ovPick = $('hm-overlay-pick');
  const ovFile = $('hm-overlay-file');
  if (ovPick && ovFile) {
    ovPick.addEventListener('click', () => ovFile.click());
    ovFile.addEventListener('change', () => {
      setOverlayFromFile(ovFile.files && ovFile.files[0]);
      ovFile.value = '';
    });
  }
  const ovVis = $('hm-overlay-visible');
  if (ovVis) ovVis.addEventListener('change', () => {
    S.overlay.visible = ovVis.checked;
    S.dirty = true;
    draw();
  });
  const ovAlpha = $('hm-overlay-alpha');
  if (ovAlpha) ovAlpha.addEventListener('input', () => {
    S.overlay.alpha = Math.max(0.05, Math.min(1, (parseInt(ovAlpha.value, 10) || 0) / 100));
    S.dirty = true;
    refreshOverlayUI();
    draw();
  });
  const ovClear = $('hm-overlay-clear');
  if (ovClear) ovClear.addEventListener('click', () => {
    applyOverlay(null);
    S.dirty = true;
    draw();
    toast('参考图已移除');
  });
}

/* ---------- 启动 ---------- */
(function initEditor() {
  cv = $('hm-canvas');
  CTX = cv.getContext('2d');
  DPR = Math.min(2, window.devicePixelRatio || 1);
  resizeCanvas();

  newMap(parseInt($('hm-cols').value, 10) || 29, parseInt($('hm-rows').value, 10) || 17);
  buildToolUI();
  buildShapeUI();
  buildTerrUI();
  refreshBrushUI();
  refreshOverlayUI();
  bindUI();
  refreshMapSelect();

  /* 有存过的图就直接打开最新那张（别让玩家每次从空白开始） */
  const all = loadAllMaps();
  const ids = Object.keys(all).sort((a, b) => (all[b].savedAt || 0) - (all[a].savedAt || 0));
  if (ids.length) {
    applyMapObject(all[ids[0]]);
    refreshMapSelect();
  }

  fitCamera();
  draw();
  refreshInfo();
})();

