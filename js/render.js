/* ============================================================
   render.js — 画布渲染、兵牌符号、缩放
   依赖 data.js（TYPES、ICON_PARTS、buildXxx 常量）
   依赖 model.js（forEachVisibleNode、forEachNode、computeStats 等）
   ============================================================ */

/* 全局开关：兵牌上是否显示人数/装备角标（唯一权威声明，其它脚本读它） */
let SHOW_NODE_STATS = true;

/* ---------- 主题颜色 ---------- */
function getThemeColors() {
  const isDark = document.body.classList.contains('dark');
  return isDark
    ? { ink: INK_DARK, paper: PAPER_DARK }
    : { ink: INK_LIGHT, paper: PAPER_LIGHT };
}

/* ---------- 兵牌符号绘制（★ R10.25：全部交给 MIL-STD-2525 库） ----------
   · 图形 / 框 / 梯队 全部由 milsymbol 画（见 js/milsymbol-bridge.js）
   · 这里只剩一个入口 + 一个"库没加载"的兜底空框
   · 旧的手绘片段（ICON_PARTS 那套）已删除 */
function buildSymbol(type, echelon, custom) {
  if (typeof symbolSvg === 'function') {
    try {
      const svg = symbolSvg(type, echelon, custom, { w: SYM_W, h: SYM_H });
      if (svg && svg.indexOf('<svg') === 0) return svg;
    } catch (e) { /* 落到兜底 */ }
  }
  /* 兜底：只画一个空框（保证界面永远不崩） */
  const { ink, paper } = getThemeColors();
  return '<svg viewBox="0 0 ' + SYM_W + ' ' + SYM_H + '" width="' + SYM_W + '" height="' + SYM_H +
    '" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="' + (FRAME_Y + 1.5) + '" width="' +
    (FRAME_W - 3) + '" height="' + (FRAME_H - 3) + '" rx="2.5" fill="' + paper + '" stroke="' +
    ink + '" stroke-width="' + BORDER_SW + '"/></svg>';
}

/* ---------- 画布元素引用 ---------- */
const wrapEl   = document.getElementById('wrap');
const canvasEl = document.getElementById('canvas');
const svgEl    = document.getElementById('links');
const nodesEl  = document.getElementById('nodes');
const statsEl  = document.getElementById('stats');

/* ---------- 缩放 ---------- */
let zoomLevel = 1;
let lastRenderState = null;
const ZOOM_MIN = 0.4, ZOOM_MAX = 2.5, ZOOM_STEP = 0.15;

function applyZoom() {
  const layerEl = document.getElementById('zoom-layer');
  const indEl   = document.getElementById('zoom-indicator');
  if (!canvasEl || !layerEl) return;

  const w = parseFloat(canvasEl.style.width) || canvasEl.offsetWidth;
  const h = parseFloat(canvasEl.style.height) || canvasEl.offsetHeight;

  canvasEl.style.transform = `scale(${zoomLevel})`;
  layerEl.style.width  = (w * zoomLevel) + 'px';
  layerEl.style.height = (h * zoomLevel) + 'px';

  if (indEl) indEl.textContent = Math.round(zoomLevel * 100) + '%';
}

function setZoom(v) {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
  applyZoom();
}

/* ---------- 布局常量 ---------- */
const NODE_W = 120, NODE_H = 120, HGAP = 10, VGAP = 20;
const VGAP_V = 16;
const PAD_X = 240, PAD_Y = 180;

/* ---------- 主渲染 ---------- */
function render() {
  if (!wrapEl || !canvasEl || !svgEl || !nodesEl) return;
  function computeBox(node) {
    const visible = visibleChildren(node);
    if (visible.length === 0) { node._boxW = NODE_W; node._boxH = NODE_H; return; }
    for (const c of visible) computeBox(c);

    if (node.layout === 'v') {
      let maxW = NODE_W, totalH = NODE_H;
      for (const c of visible) { maxW = Math.max(maxW, c._boxW); totalH += VGAP_V + c._boxH; }
      node._boxW = maxW; node._boxH = totalH;
    } else {
      let totalW = 0, maxH = 0;
      for (const c of visible) { totalW += c._boxW; maxH = Math.max(maxH, c._boxH); }
      totalW += (visible.length - 1) * HGAP;
      node._boxW = Math.max(NODE_W, totalW);
      node._boxH = NODE_H + VGAP + maxH;
    }
  }
  computeBox(root);

  function assignPos(node, left, top) {
    const visible = visibleChildren(node);
    node.cx = left + node._boxW / 2;
    node.y = top;
    if (visible.length === 0) return;

    if (node.layout === 'v') {
      let childTop = top + NODE_H + VGAP_V;
      for (const c of visible) {
        assignPos(c, node.cx - c._boxW / 2, childTop);
        childTop += c._boxH + VGAP_V;
      }
    } else {
      const totalW = visible.reduce((s, c) => s + c._boxW, 0) + (visible.length - 1) * HGAP;
      let childLeft = node.cx - totalW / 2;
      const childTop = top + NODE_H + VGAP;
      for (const c of visible) {
        assignPos(c, childLeft, childTop);
        childLeft += c._boxW + HGAP;
      }
    }
  }
  assignPos(root, 0, 0);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  forEachVisibleNode(root, n => {
    minX = Math.min(minX, n.cx - NODE_W/2);
    maxX = Math.max(maxX, n.cx + NODE_W/2);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + NODE_H);
  });

  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const wrapW = wrapEl.clientWidth;
  const wrapH = wrapEl.clientHeight;
  const offsetX = Math.max(PAD_X, (wrapW - contentW) / 2);
  const offsetY = Math.max(PAD_Y, (wrapH - contentH) / 2);
  const X = n => n.cx - minX + offsetX;
  const Y = n => n.y - minY + offsetY;

  const canvasW = Math.max(contentW + PAD_X * 2, wrapW);
  const canvasH = Math.max(contentH + PAD_Y * 2, wrapH);
  canvasEl.style.width = canvasW + 'px';
  canvasEl.style.height = canvasH + 'px';
  svgEl.setAttribute('width', canvasW);
  svgEl.setAttribute('height', canvasH);
  svgEl.setAttribute('viewBox', `0 0 ${canvasW} ${canvasH}`);

  const linkColor = getComputedStyle(document.documentElement).getPropertyValue('--link-color').trim() || '#9db4d4';
  let d = '';
  forEachVisibleNode(root, n => {
    const kids = visibleChildren(n);
    if (!kids.length) return;
    const px = X(n), pyBottom = Y(n) + NODE_H;
    if (n.layout === 'v') {
      for (const c of kids) d += `M${px} ${pyBottom} L${px} ${Y(c)} `;
    } else {
      const midY = pyBottom + VGAP / 2;
      const first = kids[0], last = kids[kids.length - 1];
      d += `M${px} ${pyBottom} L${px} ${midY} `;
      d += `M${X(first)} ${midY} L${X(last)} ${midY} `;
      for (const c of kids) d += `M${X(c)} ${midY} L${X(c)} ${Y(c)} `;
    }
  });
  svgEl.innerHTML = `<path d="${d}" fill="none" stroke="${linkColor}" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/>`;

  nodeById = {};
  forEachNode(root, n => nodeById[n.id] = n);

  /* ★ R10.33：这一格代表几个"完全一样"的兄弟（堆叠时 >1） */
  const stackSizes = new Map();
  forEachNode(root, p => {
    if (!p.stack || p.collapsed || p.children.length < 2) return;
    const m = groupSignatureCounts(p);
    for (const c of p.children) {
      const cnt = m.get(nodeSignature(c)) || 1;
      if (cnt > 1) stackSizes.set(c.id, cnt);
    }
  });

  const frag = document.createDocumentFragment();
  forEachVisibleNode(root, n => {
    const el = document.createElement('div');
    el.className = 'node' + (n.id === selectedId ? ' selected' : '');
    el.dataset.id = n.id;
    el.style.left = X(n) + 'px';
    el.style.top  = Y(n) + 'px';

    let badgeHTML = '';
    if (SHOW_NODE_STATS) {
      const local = computeStats(n);
      const equipTotal = Object.values(local.equipment).reduce((a,b)=>a+b,0);
      const equipTotalMax = Object.values(local.equipmentMax).reduce((a,b)=>a+b,0);
      const showP = local.personnel > 0 || local.personnelMax > 0;
      const showE = equipTotal > 0 || equipTotalMax > 0;
      const pStr = fmtRange(local.personnel, local.personnelMax);
      const eStr = fmtRange(equipTotal, equipTotalMax);
      let rows = '';
      if (showP) rows += `<span class="b-row">👤 ${pStr}</span>`;
      if (showE) rows += `<span class="b-row equip">🔧 ${eStr}</span>`;
      if (rows) badgeHTML = `<div class="badge">${rows}</div>`;
    }

    const hasCh = n.children.length > 0;
    const cBtn = hasCh ? `<div class="collapse-btn${n.collapsed ? ' collapsed' : ''}" title="${n.collapsed ? '展开下属' : '折叠下属'}">${n.collapsed ? '+' : '−'}</div>` : '';
    const lBtn = hasCh ? `<div class="layout-btn${n.layout === 'v' ? ' v' : ''}" title="${n.layout === 'v' ? '当前纵向，点击切换横向' : '当前横向，点击切换纵向'}">${n.layout === 'v' ? '⇆' : '⇅'}</div>` : '';
    const rIcon = n.remark ? `<div class="remark-icon" title="${escapeHtml(n.remark)}">📝</div>` : '';

    /* ★ R10.33/34：合并显示（省空间） · 加强减弱 · 叠起来的真实兵牌 */
    const stackable = hasStackableChildren(n);
    const sBtn = stackable ? `<div class="stack-btn${n.stack ? ' on' : ''}" title="${n.stack ? '展开显示（把相同的下属分开）' : '合并显示（相同的下属叠成一格，省空间）'}">${n.stack ? '⧉' : '⧈'}</div>` : '';
    const stackN = stackSizes.get(n.id) || 0;
    const th = getThemeColors();
    const symHtml = buildSymbol(n.type, n.echelon, n.custom);
    const stackHTML = stackN > 1
      ? `<div class="stack-layer l2">${symHtml}</div>` +
        `<div class="stack-layer l1">${symHtml}</div>`
      : '';
    const countHTML = stackN > 1 ? `<div class="stack-count">×${stackN}</div>` : '';
    const modHTML = n.mod
      ? `<div class="mod-mark ${n.mod === '+' ? 'plus' : 'minus'}" style="color:${th.ink};text-shadow:0 0 3px ${th.paper},0 0 2px ${th.paper};">${n.mod === '+' ? '+' : '−'}</div>`
      : '';

    el.innerHTML =
      `<div class="sym-wrap">${stackHTML}<div class="sym">${symHtml}</div>${countHTML}${modHTML}</div>` +
      `<div class="label">${escapeHtml(n.name)}</div>` +
      badgeHTML +
      rIcon + sBtn + lBtn + cBtn;

    el.addEventListener('pointerdown', e => startDrag(e, n, el));
    el.addEventListener('dblclick', e => {
      if (e.target.closest('.collapse-btn') || e.target.closest('.layout-btn') || e.target.closest('.stack-btn')) return;
      renameNode(n);
    });
    /* 移动端：双击（300ms 内两次点击）打开属性栏 */
    let _lastTap = 0;
    el.addEventListener('pointerup', e => {
      if (e.target.closest('.collapse-btn') || e.target.closest('.layout-btn') || e.target.closest('.stack-btn')) return;
      if (window.innerWidth > 900) return;
      const now = Date.now();
      if (now - _lastTap < 320) {
        _lastTap = 0;
        e.preventDefault();
        e.stopPropagation();
        selectNode(n);
        if (document.body.classList.contains('mobile-props-open')) return;
        document.body.classList.add('mobile-props-open');
        document.body.classList.remove('mobile-lib-open');
        document.getElementById('mobile-mask').classList.add('show');
      } else {
        _lastTap = now;
      }
    }, { passive: false });

    const cbtn = el.querySelector('.collapse-btn');
    if (cbtn) {
      cbtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
      cbtn.addEventListener('click', e => {
        e.stopPropagation();
        n.collapsed = !n.collapsed;
        render();
        if (n.id === selectedId) fillPanel(n);
      });
    }
    const lbtn = el.querySelector('.layout-btn');
    if (lbtn) {
      lbtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
      lbtn.addEventListener('click', e => {
        e.stopPropagation();
        n.layout = n.layout === 'v' ? 'h' : 'v';
        render();
        if (n.id === selectedId) fillPanel(n);
      });
    }
    const sbtn = el.querySelector('.stack-btn');
    if (sbtn) {
      sbtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
      sbtn.addEventListener('click', e => {
        e.stopPropagation();
        n.stack = !n.stack;
        render();
        if (n.id === selectedId) fillPanel(n);
      });
    }

    frag.appendChild(el);
  });
  nodesEl.innerHTML = '';
  nodesEl.appendChild(frag);

  const nodePos = {};
  forEachVisibleNode(root, n => { nodePos[n.id] = { x: X(n), y: Y(n) }; });
  lastRenderState = { canvasW, canvasH, nodePos };

  applyZoom();
}

function updateNodeLabel(n) {
  if (!nodesEl) return;
  const el = nodesEl.querySelector(`.node[data-id="${n.id}"] .label`);
  if (el) el.textContent = n.name;
}

/* ---------- 节点角标刷新（属性面板改动后调用） ---------- */
function refreshNodeBadges() {
  if (!nodesEl) return;
  forEachVisibleNode(root, n => {
    const el = nodesEl.querySelector(`.node[data-id="${n.id}"]`);
    if (!el) return;
    el.querySelectorAll('.badge').forEach(b => b.remove());
    if (!SHOW_NODE_STATS) return;
    const local = computeStats(n);
    const equipTotal = Object.values(local.equipment).reduce((a,b)=>a+b,0);
    const equipTotalMax = Object.values(local.equipmentMax).reduce((a,b)=>a+b,0);
    const showP = local.personnel > 0 || local.personnelMax > 0;
    const showE = equipTotal > 0 || equipTotalMax > 0;
    const pStr = fmtRange(local.personnel, local.personnelMax);
    const eStr = fmtRange(equipTotal, equipTotalMax);
    let rows = '';
    if (showP) rows += `<span class="b-row">👤 ${pStr}</span>`;
    if (showE) rows += `<span class="b-row equip">🔧 ${eStr}</span>`;
    if (rows) {
      const b = document.createElement('div');
      b.className = 'badge';
      b.innerHTML = rows;
      el.appendChild(b);
    }
  });
}

/* ---------- 统计面板渲染 ---------- */
function renderEquipStats(equipment, equipmentMax) {
  equipmentMax = equipmentMax || {};
  const keys = Object.keys(equipment).filter(k => equipment[k] > 0 || (equipmentMax[k]||0) > 0).sort();
  if (!keys.length) return '<div class="stats-empty">无装备</div>';
  return `<div class="stats-equip">${
    keys.map(k => {
      const a = equipment[k] || 0, b = equipmentMax[k] || 0;
      const txt = b > a ? a + ' - ' + b : String(a);
      return `<div class="stats-equip-item"><span>${escapeHtml(k)}</span><span>×${txt}</span></div>`;
    }).join('')
  }</div>`;
}

function renderStats() {
  if (!statsEl) return;
  let html = '';
  if (selectedId && nodeById[selectedId]) {
    const node = nodeById[selectedId];
    const local = computeStats(node);
    html += `<div class="stats-block highlight">
      <div class="stats-title">选中：${escapeHtml(node.name)}（含下属）</div>
      <div class="stats-row personnel"><span>人数</span><b>${local.personnelMax > local.personnel ? local.personnel.toLocaleString()+' - '+local.personnelMax.toLocaleString() : local.personnel.toLocaleString()}</b></div>
      ${renderEquipStats(local.equipment, local.equipmentMax)}
    </div>`;
  }
  if (root) {
    const global = computeStats(root);
    html += `<div class="stats-block">
      <div class="stats-title">全军总计</div>
      <div class="stats-row personnel"><span>人数</span><b>${global.personnelMax > global.personnel ? global.personnel.toLocaleString()+' - '+global.personnelMax.toLocaleString() : global.personnel.toLocaleString()}</b></div>
      ${renderEquipStats(global.equipment, global.equipmentMax)}
    </div>`;
  }
  statsEl.innerHTML = html || '<div class="empty-tip">暂无数据</div>';
}