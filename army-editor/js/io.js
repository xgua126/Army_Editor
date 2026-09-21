/* ============================================================
   io.js — 保存、加载、导出图片、预设切换、更新日志
   依赖 data.js, model.js, render.js, ui.js
   ============================================================ */

/* ---------- 存档 ---------- */
const STORAGE_KEY = 'mil_org_saves_v1';

function getSaves() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch (e) { return {}; }
}
function setSaves(saves) { localStorage.setItem(STORAGE_KEY, JSON.stringify(saves)); }

const saveModal = document.getElementById('save-modal');
const saveNameInput = document.getElementById('save-name-input');

document.getElementById('btn-save').addEventListener('click', () => {
  saveNameInput.value = root.name + ' ' + new Date().toLocaleDateString();
  saveModal.classList.add('show');
  setTimeout(() => saveNameInput.select(), 50);
});
document.getElementById('save-cancel').addEventListener('click', () => saveModal.classList.remove('show'));
document.getElementById('save-confirm').addEventListener('click', () => {
  const name = saveNameInput.value.trim();
  if (!name) { saveNameInput.focus(); return; }
  const saves = getSaves();
  const global = computeStats(root);
  saves[name] = {
    data: serializeOrg(root),
    time: Date.now(),
    personnel: global.personnel,
    equipTotal: Object.values(global.equipment).reduce((a,b)=>a+b,0),
  };
  try {
    setSaves(saves);
    saveModal.classList.remove('show');
    toast('已保存：' + name);
  } catch (e) {
    alert('保存失败：' + e.message);
  }
});
saveNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('save-confirm').click();
  if (e.key === 'Escape') saveModal.classList.remove('show');
});

const loadModal = document.getElementById('load-modal');
const loadList = document.getElementById('load-list');
document.getElementById('btn-load').addEventListener('click', () => {
  refreshLoadList();
  loadModal.classList.add('show');
});
document.getElementById('load-cancel').addEventListener('click', () => loadModal.classList.remove('show'));

function refreshLoadList() {
  const saves = getSaves();
  const keys = Object.keys(saves).sort((a,b) => (saves[b].time||0) - (saves[a].time||0));
  if (!keys.length) {
    loadList.innerHTML = '<div class="modal-empty">还没有任何存档</div>';
    return;
  }
  loadList.innerHTML = keys.map(k => {
    const s = saves[k];
    const date = new Date(s.time || Date.now());
    const meta = `${date.toLocaleString('zh-CN')} · 👤${(s.personnel||0).toLocaleString()} · 🔧${(s.equipTotal||0).toLocaleString()}`;
    return `<div class="modal-item" data-key="${escapeHtml(k)}">
      <div class="info">
        <div class="name">${escapeHtml(k)}</div>
        <div class="meta">${meta}</div>
      </div>
      <button class="del-btn" data-del="${escapeHtml(k)}" title="删除存档">✕</button>
    </div>`;
  }).join('');

  loadList.querySelectorAll('.modal-item').forEach(item => {
    item.addEventListener('click', ev => {
      if (ev.target.closest('.del-btn')) return;
      const key = item.dataset.key;
      const s = getSaves()[key];
      if (!s) return;
      showConfirmDialog(
        '加载存档',
        `确定加载「<b>${escapeHtml(key)}</b>」？<br>当前编制将被替换。`,
        function() {
          try {
            pushHistory();
            root = deserializeOrg(s.data);
            uid = 0;
            forEachNode(root, n => {
              const num = parseInt(n.id.slice(1), 10);
              if (num > uid) uid = num;
            });
            selectedId = null;
            render(); emptyPanel(); renderStats();
            loadModal.classList.remove('show');
            toast('已加载：' + key);
          } catch (e) {
            toast('加载失败：' + e.message, true);
          }
        }
      );
    });
  });
  loadList.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const key = btn.dataset.del;
      showConfirmDialog(
        '删除存档',
        `确定删除「<b>${escapeHtml(key)}</b>」？此操作不可恢复。`,
        function() {
          const saves = getSaves();
          delete saves[key];
          setSaves(saves);
          refreshLoadList();
        }
      );
    });
  });
}

document.getElementById('save-file-btn').addEventListener('click', () => {
  const name = saveNameInput.value.trim() || root.name || '军队编制';
  const data = serializeOrg(root);
  const str = JSON.stringify(data, null, 2);
  const blob = new Blob([str], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  saveModal.classList.remove('show');
  toast('已导出文件：' + name + '.json');
});

document.getElementById('load-file-btn').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data || !data.type || !data.echelon) throw new Error('文件格式不正确，缺少必要字段');

      pushHistory();
      root = deserializeOrg(data);
      uid = 0;
      forEachNode(root, n => {
        const num = parseInt(n.id.slice(1), 10);
        if (num > uid) uid = num;
      });
      selectedId = null;
      render(); emptyPanel(); renderStats();
      loadModal.classList.remove('show');
      toast('已导入文件：' + file.name);
    } catch (err) {
      alert('导入失败：' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------- 预设 ---------- */
const presetModal = document.getElementById('preset-modal');
const presetConfirmBtn = document.getElementById('preset-confirm');
let pendingPreset = null;

function resetPresetModal() {
  pendingPreset = null;
  document.querySelectorAll('#preset-modal .preset-item').forEach(x => x.classList.remove('active'));
  presetConfirmBtn.disabled = true;
}

document.getElementById('btn-preset').addEventListener('click', () => {
  resetPresetModal();
  presetModal.classList.add('show');
});

document.getElementById('preset-cancel').addEventListener('click', () => {
  resetPresetModal();
  presetModal.classList.remove('show');
});

presetConfirmBtn.addEventListener('click', () => {
  if (!pendingPreset) return;
  const builder = PRESETS[pendingPreset];
  if (!builder) return;
  pushHistory();
  root = builder();
  selectedId = null;
  render(); emptyPanel(); renderStats();
  presetModal.classList.remove('show');
  resetPresetModal();
  toast('已加载预设');
});

document.querySelectorAll('#preset-modal .preset-item').forEach(item => {
  const pick = () => {
    const key = item.dataset.preset;
    if (!PRESETS[key]) return;
    pendingPreset = key;
    document.querySelectorAll('#preset-modal .preset-item').forEach(x => {
      x.classList.toggle('active', x === item);
    });
    presetConfirmBtn.disabled = false;
  };
  item.addEventListener('pointerdown', pick);
  item.addEventListener('click', pick);
});

/* ---------- 更新日志弹窗 ---------- */
function showChangelogModal(){
  const modal = document.getElementById('changelog-modal');
  const bodyEl = document.getElementById('changelog-body');

  if (!modal || !bodyEl) return;

  // 重新渲染日志内容（防止因修改 CHANGELOG 而没有刷新）
  bodyEl.innerHTML = CHANGELOG.map(v => `
    <div class="changelog-version">
      <h4>v${v.version}<span>${v.date}</span></h4>
      <ul>${v.changes.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    </div>
  `).join('');

  modal.classList.add('show');
}

document.getElementById('btn-changelog').addEventListener('click', showChangelogModal);

// 绑定关闭按钮
document.getElementById('changelog-close').addEventListener('click', () => {
  document.getElementById('changelog-modal').classList.remove('show');
});

/* ---------- 版本检测（进入页面弹更新日志） ---------- */
const VERSION_SEEN_KEY = 'mil_last_seen_version_v1';

function checkVersionUpdate() {
  let seen = null;
  try { seen = localStorage.getItem(VERSION_SEEN_KEY); } catch (e) {}

  if (seen === VERSION) return;
  try { localStorage.setItem(VERSION_SEEN_KEY, VERSION); } catch (e) {}

  if (!seen) return;
  showChangelogModal();
}

/* ---------- 导出 JPG ---------- */
function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function extractSvgInner(svgStr) {
  const m = svgStr.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  return m ? m[1] : svgStr;
}
function wrapText(s, maxChars) {
  if (!s) return [''];
  const lines = [];
  for (let i = 0; i < s.length; i += maxChars) {
    lines.push(s.slice(i, i + maxChars));
  }
  return lines.slice(0, 2);
}

function exportAsImage() {
  if (!root || !lastRenderState) { toast('画布为空', true); return; }

  const isDark = document.body.classList.contains('dark');
  const bg   = isDark ? '#0b1220' : '#f8fafc';
  const fg   = isDark ? '#e2e8f0' : '#1e293b';
  const linkColor = isDark ? '#475569' : '#9db4d4';
  const fontFamily = "system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif";

  const { canvasW, canvasH, nodePos } = lastRenderState;
  const parts = [];
  parts.push(`<rect width="${canvasW}" height="${canvasH}" fill="${bg}"/>`);

  /* 连接线 */
  let d = '';
  forEachVisibleNode(root, n => {
    if (n.collapsed || !n.children.length) return;
    const p = nodePos[n.id];
    const px = p.x;
    const pyBottom = p.y + NODE_H;
    if (n.layout === 'v') {
      for (const c of n.children) {
        d += `M${px} ${pyBottom} L${px} ${nodePos[c.id].y} `;
      }
    } else {
      const midY = pyBottom + VGAP / 2;
      const first = n.children[0], last = n.children[n.children.length - 1];
      d += `M${px} ${pyBottom} L${px} ${midY} `;
      d += `M${nodePos[first.id].x} ${midY} L${nodePos[last.id].x} ${midY} `;
      for (const c of n.children) {
        d += `M${nodePos[c.id].x} ${midY} L${nodePos[c.id].x} ${nodePos[c.id].y} `;
      }
    }
  });
  parts.push(`<path d="${d}" fill="none" stroke="${linkColor}" stroke-width="2" stroke-linecap="square"/>`);

  /* 节点 */
  forEachVisibleNode(root, n => {
    const p = nodePos[n.id];
    const left = p.x - NODE_W / 2;
    const top  = p.y;
    const symX = left + (NODE_W - SYM_W) / 2;
    const symY = top + 16;

    const symSvg = buildSymbol(n.type, n.echelon, n.custom);
    parts.push(`<svg x="${symX}" y="${symY}" width="${SYM_W}" height="${SYM_H}" viewBox="0 0 ${SYM_W} ${SYM_H}">${extractSvgInner(symSvg)}</svg>`);

    /* 名称（最多两行，每行 8 字符） */
    const nameY = symY + SYM_H + 7;
    const lines = wrapText(n.name, 8);
    lines.forEach((line, i) => {
      parts.push(`<text x="${left + NODE_W/2}" y="${nameY + i * 14}" text-anchor="middle" font-family="${fontFamily}" font-size="12" font-weight="500" fill="${fg}">${escapeXml(line)}</text>`);
    });

    /* 角标 */
    if (SHOW_NODE_STATS) {
      const local = computeStats(n);
      const equipTotal = Object.values(local.equipment).reduce((a,b)=>a+b,0);
      const equipTotalMax = Object.values(local.equipmentMax).reduce((a,b)=>a+b,0);
      const showP = local.personnel > 0 || local.personnelMax > 0;
      const showE = equipTotal > 0 || equipTotalMax > 0;
      const pStr = fmtRange(local.personnel, local.personnelMax);
      const eStr = fmtRange(equipTotal, equipTotalMax);
      let yOff = top + 2;
      if (showP) {
        const text = `👤 ${pStr}`;
        const bw = text.length * 7 + 12;
        parts.push(`<rect x="${left + 2}" y="${yOff}" width="${bw}" height="14" rx="7" fill="rgba(10,61,145,0.92)"/>`);
        parts.push(`<text x="${left + 2 + bw/2}" y="${yOff + 10.5}" text-anchor="middle" font-family="${fontFamily}" font-size="9" font-weight="600" fill="#fff">${escapeXml(text)}</text>`);
        yOff += 16;
      }
      if (showE) {
        const text = `🔧 ${eStr}`;
        const bw = text.length * 7 + 12;
        parts.push(`<rect x="${left + 2}" y="${yOff}" width="${bw}" height="14" rx="7" fill="rgba(120,60,10,0.92)"/>`);
        parts.push(`<text x="${left + 2 + bw/2}" y="${yOff + 10.5}" text-anchor="middle" font-family="${fontFamily}" font-size="9" font-weight="600" fill="#fff">${escapeXml(text)}</text>`);
      }
    }
  });

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">${parts.join('')}</svg>`;

  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const out = document.createElement('canvas');
    out.width = canvasW;
    out.height = canvasH;
    const ctx = out.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    out.toBlob(blob => {
      if (!blob) { toast('导出失败', true); return; }
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = (root.name || '军队编制') + '.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);
      toast('已导出图片');
    }, 'image/jpeg', 0.9);
  };
  img.onerror = () => {
    toast('导出失败，请重试', true);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

document.getElementById('btn-export-img').addEventListener('click', exportAsImage);