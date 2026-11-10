/* ============================================================
   ui.js — 面板、弹窗、拖拽、事件绑定
   依赖 data.js, model.js, render.js
   ============================================================ */

const panelEl = document.getElementById('panel');

/* ---------- 剪贴板 ---------- */
let clipboardNode = null;

function copySelected() {
  if (!selectedId || !nodeById[selectedId]) { toast('未选中任何单位', true); return; }
  const node = nodeById[selectedId];
  /* ★ R10.33：复制「整个子树」—— 当前单位 + 全部下属，粘贴时一起带过去 */
  clipboardNode = serializeOrg(node);
  const n = countDescendants(node);
  toast('已复制：' + node.name + (n ? '（含 ' + n + ' 个下属）' : ''));
}

function pasteClipboard() {
  if (!clipboardNode) { toast('剪贴板为空，先按 Ctrl+C 复制', true); return; }
  pushHistory();
  const parent = (selectedId && nodeById[selectedId]) ? nodeById[selectedId] : root;
  const copy = cloneSubtree(clipboardNode);
  parent.children.push(copy);
  if (parent.collapsed) parent.collapsed = false;
  renumber(root, false);
  render();
  selectNode(copy);
  toast('已粘贴到：' + parent.name);
}

/* ---------- 拖拽 ---------- */
let dropInfo = null;
const libEl = document.querySelector('aside.lib');

function isOverLib(x, y) {
  const r = libEl.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function startDrag(e, node, el) {
  if (e.button !== 0) return;
  const draggable = node !== root;
  const startX = e.clientX, startY = e.clientY;
  let ghost = null, started = false;

  const onMove = ev => {
    if (!draggable) return;
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!started && Math.hypot(dx, dy) > 6) {
      started = true;
      el.classList.add('dragging');
      ghost = el.cloneNode(true);
      ghost.classList.add('ghost');
      ghost.classList.remove('selected', 'dragging');
      ghost.querySelectorAll('.collapse-btn, .layout-btn, .badge, .remark-icon').forEach(b => b.remove());
      document.body.appendChild(ghost);
    }
    if (!started) return;
    ghost.style.left = (ev.clientX - NODE_W/2) + 'px';
    ghost.style.top  = (ev.clientY - NODE_H/2) + 'px';

    if (isOverLib(ev.clientX, ev.clientY)) {
      libEl.classList.add('drag-over-delete');
      clearDropClasses();
      dropInfo = null;
    } else {
      libEl.classList.remove('drag-over-delete');
      updateDropTarget(ev.clientX, ev.clientY, node);
    }
  };

  const onUp = ev => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (ghost) ghost.remove();
    el.classList.remove('dragging');
    clearDropClasses();
    libEl.classList.remove('drag-over-delete');

    if (!started) {
      selectNode(node);
    } else if (ev && isOverLib(ev.clientX, ev.clientY) && node !== root) {
      pushHistory();
      const p = findParent(node);
      if (p) {
        p.children.splice(p.children.indexOf(node), 1);
        if (selectedId === node.id) selectedId = null;
        renumber(root, false);
        render();
        if (!selectedId) emptyPanel();
        renderStats();
        toast('已删除：' + node.name);
      }
    } else if (dropInfo) {
      performDrop(node, dropInfo.node, dropInfo.mode);
    }
    dropInfo = null;
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function updateDropTarget(x, y, draggedNode) {
  clearDropClasses(); dropInfo = null;
  const hit = document.elementFromPoint(x, y);
  const targetEl = hit ? hit.closest('.node') : null;
  if (!targetEl) return;
  const target = nodeById[targetEl.dataset.id];
  if (!target) return;
  if (draggedNode && (target === draggedNode || isInSubtree(target, draggedNode))) return;
  const r = targetEl.getBoundingClientRect();
  const rel = (y - r.top) / r.height;
  let mode;
  if (rel < 0.3) mode = 'before';
  else if (rel > 0.7) mode = 'after';
  else mode = 'child';
  if (target === root) mode = 'child';
  targetEl.classList.add('drop-' + mode);
  dropInfo = { node: target, mode };
}

function clearDropClasses() {
  nodesEl.querySelectorAll('.drop-before, .drop-after, .drop-child')
    .forEach(el => el.classList.remove('drop-before','drop-after','drop-child'));
}

function insertUnitAt(unit, target, mode) {
  pushHistory();
  if (mode === 'child') {
    target.children.push(unit);
    target.collapsed = false;
  } else {
    const tp = findParent(target);
    if (!tp) target.children.push(unit);
    else {
      const i = tp.children.indexOf(target);
      tp.children.splice(mode === 'before' ? i : i+1, 0, unit);
    }
  }
  renumber(root, false);
  render();
  selectNode(unit);
}

function performDrop(node, target, mode) {
  const parent = findParent(node);
  if (!parent) return;
  pushHistory();
  parent.children.splice(parent.children.indexOf(node), 1);
  insertUnitAtRaw(node, target, mode);
  renumber(root, false);
  render();
  selectNode(node);
}

function insertUnitAtRaw(unit, target, mode) {
  if (mode === 'child') {
    target.children.push(unit);
    target.collapsed = false;
  } else {
    const tp = findParent(target);
    if (!tp) target.children.push(unit);
    else {
      const i = tp.children.indexOf(target);
      tp.children.splice(mode === 'before' ? i : i+1, 0, unit);
    }
  }
}

/* ---------- 兵牌库 ---------- */
const libGrid = document.getElementById('lib-grid');
const libEchelonSel = document.getElementById('lib-echelon');

ECHELON_ORDER.forEach(k => {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = ECHELONS[k].name;
  libEchelonSel.appendChild(o);
});
libEchelonSel.value = 'battalion';

/* ---------- 兵牌库（★ R10.31：按标准库目录，两级显示：大类 → 子类） ---------- */
/* ★ R10.32：目录里只剩「陆地单位」一个大类，所以标签只有两个：
     常用（原来那 26 个手挑兵种）+ 陆地单位（标准库里按兵种分的 20 组）
   老存档里的 type 键还带着 maneuver/fire/air/support 分类，LEGACY_CATS 仍用于「常用」筛选 */
const LEGACY_CATS = ['maneuver', 'fire', 'air', 'support'];

const CATS = [{ k: 'core', zh: '常用' }].concat(
  ((typeof TYPES_CAT !== 'undefined') ? TYPES_CAT : []).map(c => ({ k: c.id, zh: c.n }))
);

const libTabs = document.getElementById('lib-tabs');
const libSearch = document.getElementById('lib-search');
let libCat = 'core';
let libQuery = '';

CATS.forEach(c => {
  const b = document.createElement('button');
  b.className = 'cat-tab' + (c.k === libCat ? ' active' : '');
  b.dataset.cat = c.k;
  b.textContent = c.zh;
  b.addEventListener('click', () => {
    libCat = c.k;
    libTabs.querySelectorAll('.cat-tab').forEach(x =>
      x.classList.toggle('active', x.dataset.cat === c.k));
    buildLibGrid();
  });
  libTabs.appendChild(b);
});

libSearch.addEventListener('input', () => {
  libQuery = libSearch.value.trim().toLowerCase();
  buildLibGrid();
});

/* 一次不用画太多（标准库单个大类就有 300+ 个），分批放出来 */
const LIB_BATCH = 120;
let libQueue = [];        // [{ type, head }]
let libLastHead = '';

function libItemEl(type, ech) {
  const item = document.createElement('div');
  item.className = 'lib-item';
  item.dataset.type = type;
  item.title = TYPES[type].name;
  item.innerHTML = '<div class="sym">' + buildSymbol(type, ech) + '</div><span>' + TYPES[type].name + '</span>';
  item.addEventListener('pointerdown', e => startLibraryDrag(e, type, item));
  item.addEventListener('click', () => {
    if (item.dataset.dragged === '1') { item.dataset.dragged = ''; return; }
    quickAdd(type);
  });
  return item;
}

function appendLibBatch(n) {
  const ech = libEchelonSel.value;
  const slice = libQueue.splice(0, n || LIB_BATCH);
  const moreBtn = libGrid.querySelector('.lib-more');
  if (moreBtn) moreBtn.remove();
  slice.forEach(row => {
    if (row.head && row.head !== libLastHead) {
      libLastHead = row.head;
      const h = document.createElement('div');
      h.className = 'lib-sub';
      h.textContent = row.head;
      libGrid.appendChild(h);
    }
    libGrid.appendChild(libItemEl(row.type, ech));
  });
  if (libQueue.length) {
    const more = document.createElement('button');
    more.className = 'lib-more';
    more.textContent = '显示更多（还有 ' + libQueue.length + ' 个）';
    more.addEventListener('click', () => appendLibBatch());
    libGrid.appendChild(more);
  }
}

function buildLibGrid() {
  libGrid.innerHTML = '';
  libQueue = [];
  libLastHead = '';

  const cat = String(libCat || 'core');
  const catDef = ((typeof TYPES_CAT !== 'undefined') ? TYPES_CAT : []).find(c => c.id === cat);
  const q = libQuery;

  if (catDef && !q) {
    /* ★ R10.32：一个兵种就是一个页签 —— 只有一个同名子类时不画小标题 */
    const flat = catDef.subs.length === 1 && catDef.subs[0].n === catDef.n;
    catDef.subs.forEach(sub => {
      sub.keys.forEach(k => libQueue.push({ type: k, head: flat ? '' : sub.n }));
    });
  } else {
    const keys = Object.keys(TYPES).filter(k => {
      const t = TYPES[k] || {};
      if (catDef) { if (t.cat !== cat) return false; }
      else if (cat === 'core') { if (LEGACY_CATS.indexOf(t.cat) < 0) return false; }
      else if (t.cat !== cat) return false;
      if (!q) return true;
      return String(t.name || '').toLowerCase().indexOf(q) >= 0 ||
             k.toLowerCase().indexOf(q) >= 0;
    });
    keys.forEach(k => libQueue.push({ type: k, head: '' }));
  }

  if (!libQueue.length) {
    libGrid.innerHTML = '<div class="lib-empty">这个分类下没有匹配的兵牌</div>';
    return;
  }
  appendLibBatch(LIB_BATCH);
}

function refreshLibSymbols() {
  libGrid.querySelectorAll('.lib-item').forEach(item => {
    const t = item.dataset.type;
    const box = item.querySelector('.sym');
    if (box) box.innerHTML = buildSymbol(t, libEchelonSel.value);
  });
}

buildLibGrid();
libEchelonSel.addEventListener('change', refreshLibSymbols);


/* ---------- 从库拖到画布 ---------- */
function startLibraryDrag(e, type, item) {
  if (e.button !== 0) return;

  const isMobile = window.innerWidth <= 900;

  const echelon = libEchelonSel.value;
  const preview = `${TYPES[type].name}${ECHELONS[echelon].name}`;
  const startX = e.clientX, startY = e.clientY;
  let ghost = null, started = false;
  let longPressTimer = null;
  let longPressReady = false;

  let preventScrollHandler = null;

  const beginDrag = () => {
    started = true;
    if (isMobile && document.body.classList.contains('mobile-lib-open')) {
      closeMobileDrawers();
    }
    if (isMobile) {
      preventScrollHandler = (ev) => { if (ev.cancelable) ev.preventDefault(); };
      document.addEventListener('touchmove', preventScrollHandler, { passive: false });
    }
    ghost = document.createElement('div');
    ghost.className = 'node ghost';
    ghost.innerHTML = `<div class="sym">${buildSymbol(type, echelon)}</div><div class="label">${escapeHtml(preview)}</div>`;
    document.body.appendChild(ghost);
  };

  if (isMobile) {
    item.classList.add('long-pressing');
    longPressTimer = setTimeout(() => {
      longPressReady = true;
      item.classList.remove('long-pressing');
      if (navigator.vibrate) navigator.vibrate(20);
      beginDrag();
      if (ghost) {
        ghost.style.left = (startX - NODE_W/2) + 'px';
        ghost.style.top  = (startY - NODE_H/2) + 'px';
      }
    }, 450);
  }

  const onMove = ev => {
    const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);

    if (isMobile && !longPressReady) {
      if (dist > 8 && longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        item.classList.remove('long-pressing');
      }
      return;
    }

    if (!isMobile && !started && dist > 6) {
      started = true;
      beginDrag();
    }

    if (!started || !ghost) return;
    ghost.style.left = (ev.clientX - NODE_W/2) + 'px';
    ghost.style.top  = (ev.clientY - NODE_H/2) + 'px';
    updateDropTarget(ev.clientX, ev.clientY, null);
  };

  const onUp = ev => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    if (preventScrollHandler) {
      document.removeEventListener('touchmove', preventScrollHandler);
      preventScrollHandler = null;
    }
    item.classList.remove('long-pressing');
    if (ghost) ghost.remove();
    clearDropClasses();

    if (started) {
      item.dataset.dragged = '1';
      if (dropInfo) {
        const unit = newNode(type, echelon);
        insertUnitAt(unit, dropInfo.node, dropInfo.mode);
      } else {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        if (el && wrapEl.contains(el)) {
          pushHistory();
          const unit = newNode(type, echelon);
          root.children.push(unit);
          root.collapsed = false;
          renumber(root, false);
          render();
          selectNode(unit);
        }
      }
    }
    dropInfo = null;
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function quickAdd(type) {
  pushHistory();
  const unit = newNode(type, libEchelonSel.value);
  const parent = (selectedId && nodeById[selectedId]) ? nodeById[selectedId] : root;
  parent.children.push(unit);
  if (parent.collapsed) parent.collapsed = false;
  renumber(root, false);
  render();
  selectNode(unit);
}

/* ---------- 选中节点 ---------- */
function selectNode(node) {
  selectedId = node.id;
  render();
  fillPanel(node);
  renderStats();
  const el = nodesEl.querySelector(`.node[data-id="${node.id}"]`);
  if (el && el.scrollIntoView) el.scrollIntoView({ block:'nearest', inline:'nearest' });
}

/* ★ R10.33：上传的徽章图先缩到 128px 以内再存（localStorage 只有 ~5MB） */
function pickBadgeImage(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const raw = String(fr.result || '');
    const img = new Image();
    img.onload = () => {
      try {
        const max = 128;
        const w = img.width || max, h = img.height || max;
        const k = Math.min(1, max / Math.max(w, h));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * k));
        cv.height = Math.max(1, Math.round(h * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        let out = cv.toDataURL('image/png');
        if (out.length > 120000) out = cv.toDataURL('image/jpeg', 0.82);
        cb(out);
      } catch (e) { cb(raw); }
    };
    img.onerror = () => cb(raw);
    img.src = raw;
  };
  fr.onerror = () => cb('');
  fr.readAsDataURL(file);
}

/* ---------- 属性面板 ---------- */
function fillPanel(node) {
  const typeOpts = Object.keys(TYPES).map(k => `<option value="${k}"${k===node.type?' selected':''}>${TYPES[k].name}</option>`).join('');
  const echOpts = ECHELON_ORDER.map(k => `<option value="${k}"${k===node.echelon?' selected':''}>${ECHELONS[k].name}</option>`).join('');
  const hasCh = node.children.length > 0;
  const cBtn = hasCh ? `<button id="btn-toggle-collapse" class="${node.collapsed?'warn':''}">${node.collapsed?'＋ 展开下属':'－ 折叠下属'}</button>` : '';
  const lBtn = hasCh ? `<button id="btn-toggle-layout" class="${node.layout==='v'?'sync':''}">${node.layout==='v'?'⇆ 改为横向排列':'⇅ 改为纵向排列'}</button>` : '';

  const parent = findParent(node);
  let siblingCount = 0;
  if (parent) {
    siblingCount = parent.children.filter(c => c !== node && c.type === node.type && c.echelon === node.echelon).length;
  }
  const syncBtn = siblingCount > 0
    ? `<button id="btn-sync" class="sync">⇄ 同步到 ${siblingCount} 个同级同类单位</button>`
    : '';
  /* ★ R10.34：合并显示（相同下属叠成一格，省空间） */
  const stackBtn = hasStackableChildren(node)
    ? `<button id="btn-toggle-stack" class="${node.stack ? 'sync' : ''}">${node.stack ? '⧈ 展开显示（不合并）' : '⧉ 合并显示（省空间）'}</button>`
    : '';
  /* ★ R10.33：加强 / 减弱（兵牌框外右上角 ±） */
  const modBtn = (v, label) =>
    `<button class="mod-opt${(node.mod || '') === v ? ' active' : ''}" data-mod="${v}">${label}</button>`;

  panelEl.innerHTML = `
    <div class="field">
      <label>部队番号</label>
      <input id="f-name" type="text" value="${escapeHtml(node.name)}" placeholder="输入番号">
    </div>
    <div class="field">
      <label>部队徽章</label>
      <div class="badge-row">
        ${node.badge ? `<img class="unit-badge" src="${escapeHtml(node.badge)}" alt="部队徽章">` : ''}
        <div class="badge-btns">
          <button id="btn-badge-up">${node.badge ? '更换图片' : '上传图片'}</button>
          ${node.badge ? '<button id="btn-badge-del">移除徽章</button>' : ''}
          <input type="file" id="f-badge" accept="image/*" style="display:none;">
        </div>
      </div>
    </div>
    <div class="field">
      <label>部队情况</label>
      <div class="mod-row">
        ${modBtn('', '正常')}
        ${modBtn('+', '加强 ＋')}
        ${modBtn('-', '减弱 －')}
      </div>
    </div>
    <div class="field">
      <label>兵种</label>
      <select id="f-type">${typeOpts}</select>
    </div>
    <div class="field">
      <label>编制层级</label>
      <select id="f-echelon">${echOpts}</select>
    </div>
    <div class="field">
      <label>备注</label>
      <textarea id="f-remark" placeholder="添加备注...">${escapeHtml(node.remark || '')}</textarea>
    </div>
    <div class="field">
      <label>本级人数（区间：最低 - 加强）</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <input id="f-personnel" type="number" min="0" step="1" value="${node.personnel || 0}" placeholder="最低" style="flex:1;min-width:0;">
        <span style="color:var(--fg-dim);">—</span>
        <input id="f-personnel-max" type="number" min="0" step="1" value="${node.personnelMax || 0}" placeholder="加强（可空）" style="flex:1;min-width:0;">
      </div>
    </div>
    <div class="field">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <label style="margin:0;">本级装备</label>
        <div style="display:flex;gap:6px;">
          <button id="btn-equip-pick" style="font-size:11px; padding:3px 8px; border-radius:4px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; width:auto; margin:0;">＋ 添加</button>
          <button id="btn-bulk-rename-equip" style="font-size:11px; padding:3px 8px; border-radius:4px; border:1px solid var(--accent); background:var(--panel-bg); color:var(--accent); cursor:pointer; width:auto; margin:0;">一键改名</button>
        </div>
      </div>
      <div id="equip-list" class="equip-list"></div>
    </div>
    <div class="btns">
      <button id="btn-add" class="primary">＋ 添加下属单位</button>
      ${syncBtn}
      ${stackBtn}
      ${lBtn}
      ${cBtn}
      <button id="btn-del" class="danger"${node === root ? ' disabled style="opacity:.4;cursor:not-allowed"' : ''}>删除该单位</button>
    </div>
    <div class="legend">
      <b>快捷键</b><br>
      <span class="k">Space</span>折叠 / 展开选中单位<br>
      <span class="k">Del</span>删除选中单位<br>
      <span class="k">N</span>新建下属单位<br>
      <span class="k">↵</span>重命名选中单位<br>
      <span class="k">Ctrl+C</span>复制选中单位（含下属）<br>
      <span class="k">Ctrl+V</span>粘贴到选中单位下<br>
      <span class="k">Ctrl+Z</span>撤销上一步操作<br>
      <span class="k">Esc</span>取消选中<br>
      <span class="k">Tab</span>下一个 / <span class="k">⇧Tab</span> 上一个<br>
      <span class="k">←→</span>同级切换 &nbsp; <span class="k">↑</span>上级 &nbsp; <span class="k">↓</span>下级<br>
      <span class="k">Ctrl+R</span>自动重新编号
    </div>
  `;

  const nameInput = document.getElementById('f-name');
  const typeSel   = document.getElementById('f-type');
  const echSel    = document.getElementById('f-echelon');
  const remarkIn  = document.getElementById('f-remark');
  const persInput = document.getElementById('f-personnel');

  nameInput.addEventListener('input', e => {
    node.name = e.target.value;
    node.customName = true;
    updateNodeLabel(node);
    renderStats();
  });
  typeSel.addEventListener('change', e => {
    pushHistory();
    node.type = e.target.value;
    node.custom = null;
    renumber(root, false);
    render(); fillPanel(node); renderStats();
  });
  echSel.addEventListener('change', e => {
    pushHistory();
    node.echelon = e.target.value;
    renumber(root, false);
    render(); fillPanel(node); renderStats();
  });
  remarkIn.addEventListener('input', e => {
    node.remark = e.target.value;
    const el = nodesEl.querySelector(`.node[data-id="${node.id}"]`);
    if (el) {
      let icon = el.querySelector('.remark-icon');
      if (node.remark) {
        if (!icon) {
          icon = document.createElement('div');
          icon.className = 'remark-icon';
          icon.textContent = '📝';
          el.appendChild(icon);
        }
        icon.title = node.remark;
      } else if (icon) icon.remove();
    }
  });
  const persMaxInput = document.getElementById('f-personnel-max');
  persInput.addEventListener('input', e => {
    node.personnel = Math.max(0, parseInt(e.target.value, 10) || 0);
    refreshNodeBadges();
    renderStats();
  });
  persMaxInput.addEventListener('input', e => {
    node.personnelMax = Math.max(0, parseInt(e.target.value, 10) || 0);
    refreshNodeBadges();
    renderStats();
  });

  renderEquipEditor(node);

  document.getElementById('btn-equip-pick').addEventListener('click', () => {
    openEquipmentPicker(eq => {
      if (!node.equipment) node.equipment = [];
      const existing = node.equipment.find(e => e.eqId === eq.id);
      if (existing) {
        existing.count = (existing.count || 0) + 1;
      } else {
        node.equipment.push({
          eqId: eq.id,
          name: eq.name,
          count: 1,
          countMax: 0
        });
      }
      renderEquipEditor(node);
      refreshNodeBadges();
      renderStats();
    });
  });

  document.getElementById('btn-add').addEventListener('click', () => addChild(node));

    // 绑定一键改名按钮
  const bulkRenameBtn = document.getElementById('btn-bulk-rename-equip');
  if (bulkRenameBtn) {
    bulkRenameBtn.addEventListener('click', () => showBulkRenameDialog(node));
  }

  const syncEl = document.getElementById('btn-sync');
  if (syncEl) syncEl.addEventListener('click', () => syncToSiblings(node));

  /* ★ R10.33：加强 / 减弱（存到 node.mod，兵牌右上角画 ± ） */
  panelEl.querySelectorAll('.mod-opt').forEach(b => {
    b.addEventListener('click', () => {
      if ((node.mod || '') === (b.dataset.mod || '')) return;
      pushHistory();
      node.mod = b.dataset.mod || '';
      render();
      fillPanel(node);
      toast(node.mod === '+' ? '已标记：加强' : node.mod === '-' ? '已标记：减弱' : '已取消加强/减弱');
    });
  });

  /* ★ R10.33：部队徽章（上传图片 → 缩到 128px 存成 dataURL） */
  const badgeUp = document.getElementById('btn-badge-up');
  const badgeFile = document.getElementById('f-badge');
  if (badgeUp && badgeFile) {
    badgeUp.addEventListener('click', () => badgeFile.click());
    badgeFile.addEventListener('change', () => {
      const f = badgeFile.files && badgeFile.files[0];
      if (!f) return;
      pickBadgeImage(f, dataUrl => {
        if (!dataUrl) { toast('读取图片失败', true); return; }
        pushHistory();
        node.badge = dataUrl;
        fillPanel(node);
        toast('已添加部队徽章');
      });
    });
  }
  const badgeDel = document.getElementById('btn-badge-del');
  if (badgeDel) badgeDel.addEventListener('click', () => {
    pushHistory();
    node.badge = '';
    fillPanel(node);
    toast('已移除徽章');
  });

  /* ★ R10.33：堆叠 / 展开"完全一样"的下属单位 */
  const stackEl = document.getElementById('btn-toggle-stack');
  if (stackEl) stackEl.addEventListener('click', () => {
    node.stack = !node.stack;
    render();
    fillPanel(node);
  });

  const toggleBtn = document.getElementById('btn-toggle-collapse');
  if (toggleBtn) toggleBtn.addEventListener('click', () => {
    node.collapsed = !node.collapsed;
    render(); fillPanel(node);
  });

  const layoutBtn = document.getElementById('btn-toggle-layout');
  if (layoutBtn) layoutBtn.addEventListener('click', () => {
    node.layout = node.layout === 'v' ? 'h' : 'v';
    render(); fillPanel(node);
  });

  const delBtn = document.getElementById('btn-del');
  if (node !== root) delBtn.addEventListener('click', () => deleteNode(node));
}

/* ---------- 装备编辑器 ---------- */
function renderEquipEditor(node) {
  const list = document.getElementById('equip-list');
  if (!list) return;

  // 自动升级旧数据（给没有 eqId 的装备补关联）
  if (node.equipment && node.equipment.some(e => !e.eqId)) {
    upgradeNodeEquipmentReferences(node);
  }

  const eqs = node.equipment || [];
  if (!eqs.length) {
    list.innerHTML = '<div class="stats-empty">尚未添加装备</div>';
    return;
  }

  list.innerHTML = eqs.map((e, i) => {
    // 从装备库取权威名字
    const lib = getEquipmentLibrary();
    const libEq = lib[e.eqId];
    const displayName = libEq ? libEq.name : (e.name || '（已删除）');
    const missing = !libEq;

    return `
      <div class="equip-item" data-idx="${i}"${missing ? ' style="opacity:.5;"' : ''}>
        <span class="name" title="${escapeHtml(displayName)}${missing ? '（装备库中已删除）' : ''}">
          ${escapeHtml(displayName)}
        </span>
        <input type="number" min="0" step="1" value="${e.count}" data-idx="${i}" class="equip-count-input" placeholder="最低">
        <span style="color:var(--fg-dim);font-size:11px;">—</span>
        <input type="number" min="0" step="1" value="${e.countMax || ''}" data-idx="${i}" class="equip-countmax-input" placeholder="加强">
        <button class="edit-eq" data-eqid="${e.eqId || ''}" title="编辑装备数值" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:13px;padding:0 3px;">📝</button>
        <button class="del" data-idx="${i}" title="删除">✕</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.equip-count-input').forEach(inp => {
    inp.addEventListener('input', ev => {
      const idx = parseInt(ev.target.dataset.idx, 10);
      node.equipment[idx].count = Math.max(0, parseInt(ev.target.value, 10) || 0);
      refreshNodeBadges(); renderStats();
    });
  });
  list.querySelectorAll('.equip-countmax-input').forEach(inp => {
    inp.addEventListener('input', ev => {
      const idx = parseInt(ev.target.dataset.idx, 10);
      const v = parseInt(ev.target.value, 10) || 0;
      if (v > 0) node.equipment[idx].countMax = v;
      else delete node.equipment[idx].countMax;
      refreshNodeBadges(); renderStats();
    });
  });
  list.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', ev => {
      const idx = parseInt(ev.target.dataset.idx, 10);
      node.equipment.splice(idx, 1);
      renderEquipEditor(node); refreshNodeBadges(); renderStats();
    });
  });
  list.querySelectorAll('.edit-eq').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const eqId = btn.dataset.eqid;
      if (!eqId) { toast('此装备未关联装备库', true); return; }
      openEquipmentEditor(eqId, () => {
        renderEquipEditor(node);
        refreshNodeBadges();
        renderStats();
      });
    });
  });
}

/* ---------- 空面板 ---------- */
function emptyPanel() {
  panelEl.innerHTML = `<div class="empty-tip">
    点击任意兵牌查看 / 编辑其属性。<br><br>
    从左侧<b>兵牌库</b>拖动单位到树中即可新增编制；<br>
    拖动已有兵牌到其他单位上可调整归属。<br><br>
    <b>Ctrl+C</b> 复制选中单位（含下属）<br>
    <b>Ctrl+V</b> 粘贴到选中单位下<br>
    <b>Ctrl+Z</b> 撤销上一步结构操作<br>
    <b>同步按钮</b>可复制人数装备或完整编制到同级同类<br>
    将单位<b>拖到左侧兵牌库</b>即可快速删除
  </div>`;
}

/* ---------- 单位操作 ---------- */
function addChild(node) {
  pushHistory();
  const idx = ECHELON_ORDER.indexOf(node.echelon);
  const childEchelon = ECHELON_ORDER[Math.min(idx+1, ECHELON_ORDER.length-1)];
  const child = newNode(node.type, childEchelon);
  node.children.push(child);
  if (node.collapsed) node.collapsed = false;
  renumber(root, false);
  render();
  selectNode(child);
}

function deleteNode(node) {
  const p = findParent(node);
  if (!p) return;
  pushHistory();
  p.children.splice(p.children.indexOf(node), 1);
  renumber(root, false);
  selectedId = null;
  render(); emptyPanel(); renderStats();
}

function renameNode(node) {
  showInputDialog({
    title: '重命名部队',
    label: '输入部队番号',
    defaultValue: node.name,
    maxLength: 40
  }, function(v) {
    if (v !== null && v.trim()) {
      node.name = v.trim();
      node.customName = true;
      updateNodeLabel(node);
      if (node.id === selectedId) { fillPanel(node); renderStats(); }
    }
  });
}

/* ---------- 同步到同级同类 ---------- */
const syncModal = document.getElementById('sync-modal');
const syncModalBody = document.getElementById('sync-modal-body');
let syncPendingNode = null;

function syncToSiblings(node) {
  const parent = findParent(node);
  if (!parent) { toast('根节点无法同步', true); return; }
  const siblings = parent.children.filter(c =>
    c !== node && c.type === node.type && c.echelon === node.echelon
  );
  if (!siblings.length) { toast('未找到同级同类单位', true); return; }

  const desc = countDescendants(node);
  const body = '找到 <b>'+siblings.length+'</b> 个同级同类单位：<br>'
    + siblings.map(function(s){ return '· ' + escapeHtml(s.name); }).join('<br>')
    + '<br><br>选择同步方式：<br>'
    + '· <b>仅同步本级</b>：只同步人数和装备，不改变它们的下属部队<br>'
    + '· <b>含下属完整同步</b>：把「'+escapeHtml(node.name)+'」的完整编制（含 <b>'+desc+'</b> 个下属单位）覆盖过去，兄弟单位的下属部队会被替换';

  // 直接使用 index.html 中预定义好的 sync-modal
  syncModalBody.innerHTML = body;
  syncPendingNode = node;
  syncModal.classList.add('show');
}
function doSyncToSiblings(includeChildren) {
  const node = syncPendingNode;
  syncPendingNode = null;
  if (!node) return;

  const parent = findParent(node);
  if (!parent) return;
  const siblings = parent.children.filter(c =>
    c !== node && c.type === node.type && c.echelon === node.echelon
  );
  if (!siblings.length) return;

  pushHistory();

  for (const s of siblings) {
    s.personnel = node.personnel;
    s.equipment = JSON.parse(JSON.stringify(node.equipment || []));
    s.mod = node.mod || '';          // ★ R10.33：加强/减弱 也跟着同步（徽章各自保留）
    if (includeChildren) {
      const keepName = s.name;
      const keepCustom = s.customName;
      s.children = node.children.map(cloneSubtree);
      s.collapsed = node.collapsed;
      s.layout = node.layout;
      s.name = keepName;
      s.customName = keepCustom;
    }
  }
  render();
  if (selectedId && nodeById[selectedId]) fillPanel(nodeById[selectedId]);
  renderStats();
  toast(includeChildren
    ? `已同步完整编制到 ${siblings.length} 个单位`
    : `已同步数据到 ${siblings.length} 个单位`);
}

document.getElementById('sync-cancel').addEventListener('click', () => {
  syncModal.classList.remove('show');
  syncPendingNode = null;
});
document.getElementById('sync-self').addEventListener('click', () => doSyncToSiblings(false));
document.getElementById('sync-all').addEventListener('click', () => doSyncToSiblings(true));

/* ---------- Toast ---------- */
function toast(msg, isErr) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:60px;left:50%;transform:translateX(-50%);
    background:${isErr ? '#dc2626' : '#16a34a'};color:#fff;padding:8px 18px;border-radius:8px;
    font-size:13px;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,.25);
    opacity:0;transition:opacity .2s;`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.style.opacity = '1');
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 250);
  }, 1600);
}

/* ---------- 弹窗工具 ---------- */
/* ---------- 通用输入弹窗（替代 prompt）---------- */
function showInputDialog(opts, onConfirm) {
  /* ★ R9.6.11：统一走 `dialog.js` 的 Dlg（同一套外观、非阻塞）——这里只保留旧的回调风格壳 */
  var o = opts || {};
  Dlg.prompt(o.label || o.title || '输入', o.defaultValue == null ? '' : o.defaultValue,
             { title: o.title || '输入' })
    .then(function (v) { if (v !== null && v !== undefined) onConfirm(v); });
}

/* ---------- 通用确认弹窗（替代 confirm）---------- */
function showConfirmDialog(title, message, onConfirm) {
  /* ★ R9.6.11：同上 —— 统一到 Dlg（原来是第二份几乎一样的实现） */
  Dlg.confirm(message, { title: title || '请确认' })
    .then(function (ok) { if (ok) onConfirm(); });
}

/* ---------- 移动端 ---------- */
const mobileMask = document.getElementById('mobile-mask');

function closeMobileDrawers() {
  document.body.classList.remove('mobile-lib-open', 'mobile-props-open');
  mobileMask.classList.remove('show');
}

document.getElementById('mobile-open-lib').addEventListener('click', () => {
  document.body.classList.add('mobile-lib-open');
  document.body.classList.remove('mobile-props-open');
  mobileMask.classList.add('show');
});

document.getElementById('mobile-open-props').addEventListener('click', () => {
  document.body.classList.add('mobile-props-open');
  document.body.classList.remove('mobile-lib-open');
  mobileMask.classList.add('show');
});

mobileMask.addEventListener('click', closeMobileDrawers);

window.addEventListener('resize', () => {
  if (window.innerWidth > 900) closeMobileDrawers();
});

/* ---------- ★ R10.34：顶栏「更多」下拉 ---------- */
(function () {
  const btn = document.getElementById('btn-more');
  const panel = document.getElementById('more-panel');
  if (!btn || !panel) return;
  const close = () => panel.classList.remove('open');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!panel.classList.contains('open')) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  /* 点完里面的功能就收起（主题 / 显示统计 想连点，留着） */
  panel.addEventListener('click', e => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.id === 'btn-theme' || t.id === 'btn-toggle-stats') return;
    close();
  });
})();

/* ---------- 移动端"更多"弹窗 ---------- */
function openMobileMore() {
  var old = document.getElementById('_mmpop');
  if (old) old.remove();

  var L = document.createElement('div');
  L.id = '_mmpop';
  L.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:2147483647;';

  var cs = getComputedStyle(document.body);
  var cPanel  = cs.getPropertyValue('--panel-bg').trim()  || '#fff';
  var cFg     = cs.getPropertyValue('--fg').trim()        || '#1e293b';
  var cBorder = cs.getPropertyValue('--border').trim()    || '#e2e8f0';
  var cLegend = cs.getPropertyValue('--legend-bg').trim() || '#eef2f7';
  var cInput  = cs.getPropertyValue('--input-border').trim() || '#cbd5e1';

  var B = document.createElement('div');
  B.style.cssText = 'background:'+cPanel+';color:'+cFg+';border:1px solid '+cBorder+';border-radius:12px;padding:18px 20px;width:88vw;max-width:360px;max-height:80vh;overflow:auto;box-shadow:0 20px 40px rgba(0,0,0,.3);';

  var html = '<h3 style="margin:0 0 14px;font-size:15px;border-bottom:1px solid '+cBorder+';padding-bottom:10px;color:'+cFg+';">更多功能</h3>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
  var defs = [
    ['btn-save','💾 保存（到文件）'],
    ['btn-theme','🌙 主题切换'],
    ['btn-undo','↶ 撤销'],
    ['btn-collapse-all','全部折叠'],
    ['btn-expand-all','全部展开'],
    ['btn-load','📂 加载存档'],
    ['btn-preset','🗂 切换预设'],
    ['btn-toggle-stats','👁 显示统计'],
    ['btn-changelog','📜 更新日志'],
    ['btn-export-img','🖼 导出图片'],
    ['btn-renumber','🔢 自动编号'],
    /* ★ R10.38：存档改用文件，「全部数据」一键备份/恢复也放进手机菜单 */
    ['btn-export-all','📦 导出全部'],
    ['btn-import-all','📥 导入全部']
  ];
  defs.forEach(function(d){
    html += '<button data-act="'+d[0]+'" style="font:inherit;font-size:13px;padding:12px 8px;border-radius:8px;border:1px solid '+cInput+';background:'+cLegend+';color:'+cFg+';cursor:pointer;text-align:center;">'+d[1]+'</button>';
  });
  html += '</div>';
  /* ★ R10：把「回合制兵棋」放进手机端"更多功能"里（顶栏在手机上放不下） */
  html += '<a href="wargame.html" style="display:block;text-align:center;text-decoration:none;font:inherit;font-size:13px;font-weight:700;padding:12px 8px;margin-top:8px;border-radius:8px;border:1px solid #3b82f6;background:rgba(59,130,246,.22);color:'+cFg+';">🎲 回合制兵棋（新）</a>';
  html += '<div style="margin-top:14px;text-align:right;"><button id="_mmpop_close" style="font:inherit;font-size:13px;padding:8px 14px;border-radius:6px;border:1px solid '+cInput+';background:'+cLegend+';color:'+cFg+';cursor:pointer;">关闭</button></div>';

  B.innerHTML = html;
  L.appendChild(B);
  document.documentElement.appendChild(L);

  L.addEventListener('click', function(e){ if (e.target === L) L.remove(); });
  B.querySelector('#_mmpop_close').addEventListener('click', function(){ L.remove(); });

  B.querySelectorAll('button[data-act]').forEach(function(b){
    b.addEventListener('click', function(){
      var act = b.dataset.act;
      L.remove();
      setTimeout(function(){
        switch(act){
          case 'btn-theme':
            var isDark = document.body.classList.toggle('dark');
            document.getElementById('btn-theme').textContent = isDark ? '🌙 暗黑' : '☀ 正常';
            refreshLibSymbols(); render(); break;
          case 'btn-undo': undo(); break;
          case 'btn-collapse-all':
            forEachNode(root, function(n){ if(n.children.length) n.collapsed=true; });
            root.collapsed=false; render();
            if (selectedId && nodeById[selectedId]) fillPanel(nodeById[selectedId]); break;
          case 'btn-expand-all':
            forEachNode(root, function(n){ n.collapsed=false; }); render();
            if (selectedId && nodeById[selectedId]) fillPanel(nodeById[selectedId]); break;
          case 'btn-load': refreshLoadList(); loadModal.classList.add('show'); break;
          case 'btn-preset': presetModal.classList.add('show'); break;
          case 'btn-toggle-stats':
            SHOW_NODE_STATS = !SHOW_NODE_STATS;
            document.getElementById('btn-toggle-stats').textContent = SHOW_NODE_STATS ? '👁 显示统计' : '👁 隐藏统计';
            render(); break;
          case 'btn-changelog': showChangelogModal(); break;
          case 'btn-renumber':
            renumber(root, true); render();
            if (selectedId && nodeById[selectedId]) fillPanel(nodeById[selectedId]);
            renderStats(); break;
          case 'btn-export-img': exportAsImage(); break;
          /* ★ R10.38：直接点真实按钮（桌面/手机走同一套逻辑，不重复实现） */
          case 'btn-save':
          case 'btn-export-all':
          case 'btn-import-all': {
            var real = document.getElementById(act);
            if (real) real.click();
            break;
          }
        }
      }, 100);
    });
  });
}

/* ---------- 全局快捷键 ---------- */
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const isForm = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (isForm) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (typeof saveModal !== 'undefined' &&
      (saveModal.classList.contains('show') ||
       loadModal.classList.contains('show') ||
       presetModal.classList.contains('show') ||
       (typeof welcomeModal !== 'undefined' && welcomeModal.classList.contains('show')))) return;

  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); undo(); return; }
    if (k === 'c') { e.preventDefault(); copySelected(); return; }
    if (k === 'v') { e.preventDefault(); pasteClipboard(); return; }
    if (k === 'r') {
      e.preventDefault();
      renumber(root, true);
      render();
      if (selectedId && nodeById[selectedId]) fillPanel(nodeById[selectedId]);
      renderStats();
      return;
    }
    return;
  }

  const sel = selectedId ? nodeById[selectedId] : null;

  if (e.key === ' ' || e.code === 'Space') {
    if (sel && sel.children.length) {
      e.preventDefault();
      sel.collapsed = !sel.collapsed;
      render();
      fillPanel(sel);
    }
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (sel && sel !== root) { e.preventDefault(); deleteNode(sel); }
    return;
  }

  if (e.key === 'n' || e.key === 'N') {
    if (sel) { e.preventDefault(); addChild(sel); }
    return;
  }

  if (e.key === 'Enter') {
    if (sel) { e.preventDefault(); renameNode(sel); }
    return;
  }

  if (e.key === 'Escape') {
    if (selectedId) { selectedId = null; render(); emptyPanel(); renderStats(); }
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    const all = [];
    forEachVisibleNode(root, n => all.push(n));
    if (!all.length) return;
    let idx = all.findIndex(n => n.id === selectedId);
    if (e.shiftKey) idx = (idx <= 0) ? all.length - 1 : idx - 1;
    else            idx = (idx + 1) % all.length;
    selectNode(all[idx]);
    return;
  }

  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault();
    if (!sel) { selectNode(root); return; }
    const parent = findParent(sel);
    let target = null;
    if (e.key === 'ArrowDown') {
      if (!sel.collapsed && sel.children.length) target = sel.children[0];
      else if (sel.collapsed && sel.children.length) {
        sel.collapsed = false; render(); fillPanel(sel); return;
      }
    } else if (e.key === 'ArrowUp') {
      if (parent) target = parent;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (parent) {
        const i = parent.children.indexOf(sel);
        if (e.key === 'ArrowLeft'  && i > 0) target = parent.children[i - 1];
        if (e.key === 'ArrowRight' && i < parent.children.length - 1) target = parent.children[i + 1];
      }
    }
    if (target) selectNode(target);
    return;
  }
});

/* ---------- 装备批量改名 ---------- */
function showBulkRenameDialog(scopeNode) {
  const oldDlg = document.getElementById('_bulk_rename_dlg');
  if (oldDlg) oldDlg.remove();

  const cs = getComputedStyle(document.body);
  const cPanel  = cs.getPropertyValue('--panel-bg').trim() || '#fff';
  const cFg     = cs.getPropertyValue('--fg').trim() || '#1e293b';
  const cBorder = cs.getPropertyValue('--border').trim() || '#e2e8f0';
  const cLegend = cs.getPropertyValue('--legend-bg').trim() || '#eef2f7';
  const cInput  = cs.getPropertyValue('--input-border').trim() || '#cbd5e1';
  const cInputBg= cs.getPropertyValue('--input-bg').trim() || '#fff';
  const cAccent = cs.getPropertyValue('--accent').trim() || '#2563eb';
  const cFgMuted= cs.getPropertyValue('--fg-muted').trim() || '#64748b';

  const L = document.createElement('div');
  L.id = '_bulk_rename_dlg';
  L.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:2147483647;';

  const B = document.createElement('div');
  B.style.cssText = 'background:'+cPanel+';color:'+cFg+';border:1px solid '+cBorder+';border-radius:12px;padding:20px 22px;width:min(420px,92vw);box-shadow:0 20px 40px rgba(0,0,0,.3);';

  B.innerHTML = `
    <h3 style="margin:0 0 14px;font-size:15px;color:${cFg};padding-bottom:10px;border-bottom:1px solid ${cBorder};">🔧 一键修改装备名称</h3>
    
    <label style="display:block;font-size:12px;color:${cFgMuted};margin-bottom:6px;">原装备名称</label>
    <input type="text" id="_bulk_old" placeholder="例如：主战坦克" style="width:100%;font:inherit;font-size:13px;padding:8px 10px;margin-bottom:12px;border:1px solid ${cInput};background:${cInputBg};color:${cFg};border-radius:6px;outline:none;box-sizing:border-box;">
    
    <label style="display:block;font-size:12px;color:${cFgMuted};margin-bottom:6px;">新装备名称</label>
    <input type="text" id="_bulk_new" placeholder="例如：ZTZ-99A" style="width:100%;font:inherit;font-size:13px;padding:8px 10px;margin-bottom:12px;border:1px solid ${cInput};background:${cInputBg};color:${cFg};border-radius:6px;outline:none;box-sizing:border-box;">
    
    <label style="display:block;font-size:12px;color:${cFgMuted};margin-bottom:6px;">应用范围</label>
    <select id="_bulk_scope" style="width:100%;font:inherit;font-size:13px;padding:8px 10px;margin-bottom:16px;border:1px solid ${cInput};background:${cInputBg};color:${cFg};border-radius:6px;outline:none;box-sizing:border-box;">
      <option value="current">当前单位及下属</option>
      <option value="all">全军（整个编制）</option>
      <option value="current-only">仅当前单位</option>
    </select>

    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="_bulk_cancel" style="font:inherit;font-size:13px;padding:8px 14px;border-radius:6px;cursor:pointer;border:1px solid ${cInput};background:${cLegend};color:${cFg};">取消</button>
      <button id="_bulk_ok" style="font:inherit;font-size:13px;padding:8px 14px;border-radius:6px;cursor:pointer;border:1px solid ${cAccent};background:${cAccent};color:#fff;">确定改名</button>
    </div>
  `;

  L.appendChild(B);
  document.documentElement.appendChild(L);

  const oldField = B.querySelector('#_bulk_old');
  const newField = B.querySelector('#_bulk_new');
  const scopeField = B.querySelector('#_bulk_scope');

  setTimeout(() => oldField.focus(), 50);

  function close() { L.remove(); }

  function commit() {
    const oldVal = oldField.value.trim();
    const newVal = newField.value.trim();
    const scope = scopeField.value;
    if (!oldVal || !newVal) { Dlg.alert('请输入原装备名称和新装备名称'); return; }
    if (oldVal === newVal) { close(); return; }
    close();
    executeBulkRename(scopeNode, oldVal, newVal, scope);
  }

  B.querySelector('#_bulk_cancel').addEventListener('click', close);
  B.querySelector('#_bulk_ok').addEventListener('click', commit);

  const handleEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
  oldField.addEventListener('keydown', handleEnter);
  newField.addEventListener('keydown', handleEnter);

  L.addEventListener('click', (e) => { if (e.target === L) close(); });
}

function executeBulkRename(scopeNode, oldName, newName, scope) {
  let targetNodes = [];
  if (scope === 'all') {
    forEachNode(root, n => targetNodes.push(n));
  } else if (scope === 'current') {
    forEachNode(scopeNode, n => targetNodes.push(n));
  } else if (scope === 'current-only') {
    targetNodes.push(scopeNode);
  }

  // 先检查是否有变化，避免无意义的撤销记录
  let hasChange = false;
  for (const n of targetNodes) {
    if (n.equipment && n.equipment.some(e => e.name === oldName)) {
      hasChange = true;
      break;
    }
  }

  if (!hasChange) {
    toast('未找到匹配的装备', true);
    return;
  }

  pushHistory();
  let changedCount = 0;

  targetNodes.forEach(n => {
    if (renameInNode(n, oldName, newName)) {
      changedCount++;
    }
  });

  render();
  if (selectedId && nodeById[selectedId]) fillPanel(nodeById[selectedId]);
  renderStats();
  toast(`已为 ${changedCount} 个单位的装备改名`);
}

function renameInNode(node, oldName, newName) {
  if (!node.equipment || !node.equipment.length) return false;

  const oldItems = node.equipment.filter(e => e.name === oldName);
  if (oldItems.length === 0) return false;

  let totalCount = 0;
  let totalMax = 0;

  oldItems.forEach(e => {
    totalCount += (e.count || 0);
    totalMax += (e.countMax || 0);
  });

  // 移除旧装备
  node.equipment = node.equipment.filter(e => e.name !== oldName);

  // 查找新名称是否已存在
  const newItem = node.equipment.find(e => e.name === newName);

  if (newItem) {
    newItem.count += totalCount;
    if (totalMax > 0) {
      // 如果有区间，进行合并
      newItem.countMax = (newItem.countMax || newItem.count - totalCount) + totalMax;
    }
  } else {
    const newEq = { name: newName, count: totalCount };
    if (totalMax > totalCount) {
      newEq.countMax = totalMax;
    }
    node.equipment.push(newEq);
  }

  return true;
}