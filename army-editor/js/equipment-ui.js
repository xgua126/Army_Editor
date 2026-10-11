/* ============================================================
   equipment-ui.js — 装备库管理弹窗 + 装备选择器 + 装备编辑器
   依赖 equipment.js、ui.js 中的 showConfirmDialog / toast
   ============================================================ */

/* ---------- 工具：读取 CSS 变量 ---------- */
function _eqColors() {
  const cs = getComputedStyle(document.body);
  const g = k => cs.getPropertyValue(k).trim();
  return {
    panel:  g('--panel-bg')  || '#fff',
    fg:     g('--fg')        || '#1e293b',
    border: g('--border')    || '#e2e8f0',
    legend: g('--legend-bg') || '#eef2f7',
    input:  g('--input-border') || '#cbd5e1',
    inputBg:g('--input-bg')  || '#fff',
    accent: g('--accent')    || '#2563eb',
    muted:  g('--fg-muted')  || '#64748b',
    dim:    g('--fg-dim')    || '#94a3b8'
  };
}

/* ---------- 通用弹窗外壳 ---------- */
function _openEqModal(id, title, bodyHTML, buttonsHTML) {
  const old = document.getElementById(id);
  if (old) old.remove();
  const c = _eqColors();
  const L = document.createElement('div');
  L.id = id;
  L.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;
    background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;
    z-index:2147483647;padding:16px;`;
  const B = document.createElement('div');
  B.style.cssText = `background:${c.panel};color:${c.fg};border:1px solid ${c.border};
    border-radius:12px;width:min(560px,94vw);max-height:90vh;
    display:flex;flex-direction:column;overflow:hidden;
    box-shadow:0 20px 40px rgba(0,0,0,.3);`;
  B.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid ${c.border};
      display:flex;align-items:center;justify-content:space-between;">
      <h3 style="margin:0;font-size:15px;font-weight:700;color:${c.fg};">${title}</h3>
      <button id="${id}_close" style="background:none;border:none;color:${c.muted};
        font-size:22px;cursor:pointer;line-height:1;padding:0 4px;">×</button>
    </div>
    <div style="flex:1;overflow-y:auto;padding:16px 20px;">${bodyHTML}</div>
    ${buttonsHTML ? `<div style="padding:12px 20px;border-top:1px solid ${c.border};
      display:flex;gap:8px;justify-content:flex-end;">${buttonsHTML}</div>` : ''}
  `;
  L.appendChild(B);
  document.documentElement.appendChild(L);
  B.querySelector(`#${id}_close`).addEventListener('click', () => L.remove());
  L.addEventListener('click', e => { if (e.target === L) L.remove(); });
  return { root: L, body: B };
}

/* ============================================================
   1) 装备库管理弹窗
   ============================================================ */
function openEquipmentLibrary() {
  const c = _eqColors();
  const lib = getEquipmentLibrary();

  // 按类型分组
  const grouped = {};
  Object.values(lib).forEach(eq => {
    if (!grouped[eq.category]) grouped[eq.category] = [];
    grouped[eq.category].push(eq);
  });

  let listHTML = '';
  if (!Object.keys(lib).length) {
    listHTML = `<div style="text-align:center;padding:40px 20px;color:${c.dim};font-size:13px;">
      装备库还是空的<br>点下面的"新建装备"开始添加吧
    </div>`;
  } else {
    Object.keys(EQUIP_CATEGORIES).forEach(catKey => {
      const items = grouped[catKey];
      if (!items || !items.length) return;
      const cat = EQUIP_CATEGORIES[catKey];
      listHTML += `
        <div style="margin-bottom:18px;">
          <div style="font-size:12px;font-weight:700;color:${c.muted};
            text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;
            display:flex;align-items:center;gap:6px;">
            <span>${cat.icon}</span>${cat.name}
            <span style="color:${c.dim};font-weight:400;font-size:11px;">(${items.length})</span>
          </div>
          ${items.map(eq => {
            const statsLine = (cat.fields || []).map(f =>
              `${f.name} ${eq.stats[f.key] ?? f.default}${f.unit}`
            ).join(' · ');
            return `
              <div class="eq-lib-item" data-eqid="${eq.id}"
                style="display:flex;align-items:center;gap:10px;
                  padding:10px 12px;margin-bottom:6px;
                  background:${c.legend};border:1px solid ${c.border};
                  border-radius:8px;transition:.15s;cursor:pointer;">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:${c.fg};
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${escapeHtml(eq.name)}
                  </div>
                  ${statsLine ? `<div style="font-size:11px;color:${c.muted};margin-top:2px;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${statsLine}</div>` : ''}
                </div>
                <button class="eq-edit-btn" data-eqid="${eq.id}"
                  title="编辑数值"
                  style="background:none;border:none;color:${c.accent};
                    font-size:14px;cursor:pointer;padding:4px 8px;border-radius:4px;">
                  📝
                </button>
                <button class="eq-del-btn" data-eqid="${eq.id}"
                  title="删除装备"
                  style="background:none;border:none;color:#dc2626;
                    font-size:14px;cursor:pointer;padding:4px 8px;border-radius:4px;">
                  ✕
                </button>
              </div>`;
          }).join('')}
        </div>`;
    });
  }

  const bodyHTML = `
    <input type="text" id="eq-lib-search" placeholder="🔍 搜索装备名..."
      style="width:100%;font:inherit;font-size:13px;padding:8px 12px;margin-bottom:14px;
        border:1px solid ${c.input};background:${c.inputBg};color:${c.fg};
        border-radius:6px;outline:none;box-sizing:border-box;">
    <div id="eq-lib-list">${listHTML}</div>
  `;
  const btnsHTML = `
    <button id="eq-lib-new" style="font:inherit;font-size:13px;padding:8px 14px;
      border-radius:6px;cursor:pointer;border:1px solid ${c.accent};
      background:${c.accent};color:#fff;font-weight:600;">＋ 新建装备</button>
  `;
  const { root } = _openEqModal('_eq_lib_modal', '装备库', bodyHTML, btnsHTML);

  // 绑定事件
  root.querySelector('#eq-lib-new').addEventListener('click', () => openEquipmentEditor(null, () => {
    root.remove();
    openEquipmentLibrary();
  }));

  root.querySelectorAll('.eq-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openEquipmentEditor(btn.dataset.eqid, () => {
        root.remove();
        openEquipmentLibrary();
      });
    });
  });

  root.querySelectorAll('.eq-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const eqId = btn.dataset.eqid;
      const lib2 = getEquipmentLibrary();
      const eq = lib2[eqId];
      if (!eq) return;
      // 检查引用
      let refCount = 0;
      // 当前编制里检查引用（★ 这里原来是 `if (typeof root_node !== 'undefined' || true)`：
      //   root_node 全项目都没有 ⇒ 靠 typeof 才没抛错；条件恒真，直接去掉）
      try {
        forEachNode(root, n => {
          if (n.equipment) {
            n.equipment.forEach(x => { if (x.eqId === eqId) refCount++; });
          }
        });
      } catch (e2) {}
      const msg = refCount > 0
        ? `确定删除「<b>${escapeHtml(eq.name)}</b>」？<br>当前编制里有 <b>${refCount}</b> 处引用，删除后这些引用将变为无效。`
        : `确定删除「<b>${escapeHtml(eq.name)}</b>」？`;
      showConfirmDialog('删除装备', msg, () => {
        delete lib2[eqId];
        saveEquipmentLibrary(lib2);
        root.remove();
        openEquipmentLibrary();
        if (typeof renderEquipEditor === 'function' && selectedId && nodeById[selectedId]) {
          fillPanel(nodeById[selectedId]);
        }
        if (typeof renderStats === 'function') renderStats();
        toast('已删除：' + eq.name);
      });
    });
  });

  // 搜索
  const searchInp = root.querySelector('#eq-lib-search');
  searchInp.addEventListener('input', () => {
    const q = searchInp.value.trim().toLowerCase();
    root.querySelectorAll('.eq-lib-item').forEach(item => {
      const name = item.querySelector('div > div').textContent.toLowerCase();
      item.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
  });
}

/* ============================================================
   2) 单个装备编辑器
   ============================================================ */
function openEquipmentEditor(eqId, onSaved) {
  const c = _eqColors();
  const isNew = !eqId;
  let eq;
  if (isNew) {
    eq = createEquipment('small_arms', '', {});
  } else {
    const lib = getEquipmentLibrary();
    eq = lib[eqId];
    if (!eq) { toast('装备不存在', true); return; }
  }

  const catOptions = Object.keys(EQUIP_CATEGORIES).map(k =>
    `<option value="${k}"${k === eq.category ? ' selected' : ''}>${EQUIP_CATEGORIES[k].icon} ${EQUIP_CATEGORIES[k].name}</option>`
  ).join('');

  const bodyHTML = `
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;color:${c.muted};margin-bottom:6px;">装备类型</label>
      <select id="_eq_cat" style="width:100%;font:inherit;font-size:13px;padding:8px 10px;
        border:1px solid ${c.input};background:${c.inputBg};color:${c.fg};
        border-radius:6px;outline:none;box-sizing:border-box;">
        ${catOptions}
      </select>
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:12px;color:${c.muted};margin-bottom:6px;">装备名称（自定义）</label>
      <input type="text" id="_eq_name" value="${escapeHtml(eq.name)}"
        placeholder="例如：ZTZ-99A 主战坦克" maxlength="30"
        style="width:100%;font:inherit;font-size:13px;padding:8px 10px;
          border:1px solid ${c.input};background:${c.inputBg};color:${c.fg};
          border-radius:6px;outline:none;box-sizing:border-box;">
    </div>
    <div id="_eq_stats"></div>
  `;

  const btnsHTML = `
    <button id="_eq_cancel" style="font:inherit;font-size:13px;padding:8px 14px;
      border-radius:6px;cursor:pointer;border:1px solid ${c.input};
      background:${c.legend};color:${c.fg};">取消</button>
    <button id="_eq_save" style="font:inherit;font-size:13px;padding:8px 14px;
      border-radius:6px;cursor:pointer;border:1px solid ${c.accent};
      background:${c.accent};color:#fff;font-weight:600;">保存</button>
  `;

  const { root } = _openEqModal('_eq_edit_modal', isNew ? '新建装备' : '编辑装备', bodyHTML, btnsHTML);

  function renderStats() {
    const catKey = root.querySelector('#_eq_cat').value;
    const cat = EQUIP_CATEGORIES[catKey];
    const statsBox = root.querySelector('#_eq_stats');
    /* ★ R9：一次性武器（如单兵火箭筒）**不需要“射击间隔”**（数值仍保留，不破坏数据） */
    const fields = (cat.fields || []).filter(f =>
      !(f.key === 'fireInterval' && eq.stats.disposable === 'yes'));
    if (!fields.length) {
      statsBox.innerHTML = `<div style="padding:14px;background:${c.legend};border-radius:6px;
        text-align:center;font-size:12px;color:${c.muted};">
        此类型无需额外数值
      </div>`;
      return;
    }
    statsBox.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:${c.muted};
        text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">数值</div>
      ${fields.map(f => {
        if (f.type === 'select') {
          const curVal = eq.stats[f.key] ?? f.default;
          return `
            <div style="margin-bottom:10px;">
              <label style="display:block;font-size:12px;color:${c.muted};margin-bottom:5px;">
                <span>${f.name}</span>
              </label>
              <select data-field="${f.key}" style="width:100%;font:inherit;font-size:13px;
                padding:7px 10px;border:1px solid ${c.input};background:${c.inputBg};
                color:${c.fg};border-radius:6px;outline:none;box-sizing:border-box;">
                ${(f.options || []).map(o =>
                  `<option value="${o.value}"${o.value === curVal ? ' selected' : ''}>${o.label}</option>`
                ).join('')}
              </select>
            </div>
          `;
        }
        return `
          <div style="margin-bottom:10px;">
            <label style="display:flex;justify-content:space-between;align-items:baseline;
              font-size:12px;color:${c.muted};margin-bottom:5px;">
              <span>${f.name}</span>
              <span style="font-size:10px;color:${c.dim};">建议 ${f.min} ~ ${f.max}${f.unit ? ' ' + f.unit : ''}</span>
            </label>
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="number" data-field="${f.key}"
                 value="${eq.stats[f.key] ?? f.default}"
                 step="any"
                style="flex:1;font:inherit;font-size:13px;padding:7px 10px;
                  border:1px solid ${c.input};background:${c.inputBg};color:${c.fg};
                  border-radius:6px;outline:none;box-sizing:border-box;">
              ${f.unit ? `<span style="font-size:11px;color:${c.dim};min-width:36px;">${f.unit}</span>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    `;
    statsBox.querySelectorAll('input[data-field]').forEach(inp => {
      // 检查越界并更新视觉提示
      const checkRange = () => {
        const v = parseFloat(inp.value);
        const f = fields.find(x => x.key === inp.dataset.field);
        if (!f || isNaN(v)) { inp.style.borderColor = ''; inp.style.boxShadow = ''; return; }
        if (v < f.min || v > f.max) {
          inp.style.borderColor = '#f59e0b';
          inp.style.boxShadow = '0 0 0 2px rgba(245,158,11,.25)';
          inp.title = `⚠ 建议范围 ${f.min} ~ ${f.max}${f.unit ? ' ' + f.unit : ''}`;
        } else {
          inp.style.borderColor = '';
          inp.style.boxShadow = '';
          inp.title = '';
        }
      };
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!isNaN(v)) eq.stats[inp.dataset.field] = v;
        checkRange();
      });
      checkRange();
    });
    statsBox.querySelectorAll('select[data-field]').forEach(sel => {
      sel.addEventListener('change', () => {
        eq.stats[sel.dataset.field] = sel.value;
        /* ★ R9：切成“一次性”立即重绘（隐藏“射击间隔”） */
        if (sel.dataset.field === 'disposable') renderStats();
      });
    });
  }

  root.querySelector('#_eq_cat').addEventListener('change', e => {
    const newCat = e.target.value;
    const cat = EQUIP_CATEGORIES[newCat];
    // 迁移现有数值，缺失的用默认
    const newStats = {};
    cat.fields.forEach(f => {
      newStats[f.key] = (typeof eq.stats[f.key] === 'number') ? eq.stats[f.key] : f.default;
    });
    eq.category = newCat;
    eq.stats = newStats;
    renderStats();
  });

  renderStats();

  root.querySelector('#_eq_cancel').addEventListener('click', () => root.remove());
  root.querySelector('#_eq_save').addEventListener('click', () => {
    const name = root.querySelector('#_eq_name').value.trim();
    if (!name) {
      root.querySelector('#_eq_name').focus();
      toast('请输入装备名称', true);
      return;
    }
    eq.name = name;
    // 读取数值
    root.querySelectorAll('input[data-field]').forEach(inp => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) eq.stats[inp.dataset.field] = v;
    });
    // 保存
    const lib = getEquipmentLibrary();
    lib[eq.id] = eq;
    saveEquipmentLibrary(lib);
    root.remove();
    toast(isNew ? '已添加：' + eq.name : '已保存：' + eq.name);
    if (typeof onSaved === 'function') onSaved(eq);
    if (typeof renderEquipEditor === 'function' && selectedId && nodeById[selectedId]) {
      fillPanel(nodeById[selectedId]);
    }
    if (typeof renderStats === 'function') renderStats();
  });
}

/* ============================================================
   3) 装备选择器（从库里挑装备添加到节点）
   ============================================================ */
function openEquipmentPicker(onPicked) {
  const c = _eqColors();
  const lib = getEquipmentLibrary();
  const entries = Object.values(lib);

  let listHTML = '';
  if (!entries.length) {
    listHTML = `<div style="text-align:center;padding:30px 20px;color:${c.dim};font-size:13px;">
      装备库是空的<br>先去「🎖️ 装备库」添加一些装备吧
    </div>`;
  } else {
    Object.keys(EQUIP_CATEGORIES).forEach(catKey => {
      const items = entries.filter(e => e.category === catKey);
      if (!items.length) return;
      const cat = EQUIP_CATEGORIES[catKey];
      listHTML += `
        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;color:${c.muted};
            text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">
            ${cat.icon} ${cat.name}
          </div>
          ${items.map(eq => `
            <div class="eq-pick-item" data-eqid="${eq.id}"
              style="padding:8px 12px;margin-bottom:4px;
                background:${c.legend};border:1px solid ${c.border};
                border-radius:6px;cursor:pointer;transition:.15s;font-size:13px;color:${c.fg};">
              ${escapeHtml(eq.name)}
            </div>
          `).join('')}
        </div>`;
    });
  }

  const bodyHTML = `
    <input type="text" id="_eq_pick_search" placeholder="🔍 搜索..."
      style="width:100%;font:inherit;font-size:13px;padding:8px 12px;margin-bottom:12px;
        border:1px solid ${c.input};background:${c.inputBg};color:${c.fg};
        border-radius:6px;outline:none;box-sizing:border-box;">
    <div id="_eq_pick_list">${listHTML}</div>
  `;
  const btnsHTML = `
    <button id="_eq_pick_new" style="font:inherit;font-size:12px;padding:7px 12px;
      border-radius:6px;cursor:pointer;border:1px dashed ${c.input};
      background:transparent;color:${c.muted};">＋ 新建装备</button>
    <button id="_eq_pick_cancel" style="font:inherit;font-size:13px;padding:8px 14px;
      border-radius:6px;cursor:pointer;border:1px solid ${c.input};
      background:${c.legend};color:${c.fg};">取消</button>
  `;
  const { root } = _openEqModal('_eq_pick_modal', '从装备库选择', bodyHTML, btnsHTML);

  root.querySelectorAll('.eq-pick-item').forEach(item => {
    item.addEventListener('click', () => {
      const eq = getEquipmentLibrary()[item.dataset.eqid];
      if (!eq) return;
      root.remove();
      onPicked(eq);
    });
  });

  root.querySelector('#_eq_pick_cancel').addEventListener('click', () => root.remove());
  root.querySelector('#_eq_pick_new').addEventListener('click', () => {
    openEquipmentEditor(null, (newEq) => {
      root.remove();
      onPicked(newEq);
    });
  });

  const search = root.querySelector('#_eq_pick_search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    root.querySelectorAll('.eq-pick-item').forEach(item => {
      const t = item.textContent.toLowerCase();
      item.style.display = (!q || t.includes(q)) ? '' : 'none';
    });
  });
}