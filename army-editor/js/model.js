/* ============================================================
   model.js — 数据模型、序列化、撤销、自动保存、统计、编号
   依赖 data.js（用到 TYPES、ECHELONS、AUX_TYPES、DEFAULT_VERT_ECHELONS）
   ============================================================ */

let uid = 0;
let root = null, selectedId = null, nodeById = {};

/* ---------- 节点构造 ---------- */
function newNode(type, echelon, name) {
  return { id:'n'+(++uid), type, echelon,
    name:name||'', customName:!!name, remark:'',
    children:[], collapsed:false,
    layout: DEFAULT_VERT_ECHELONS.has(echelon) ? 'v' : 'h',
    personnel:0, personnelMax:0, equipment:[],
    custom: null };
}

/* ---------- 遍历工具 ---------- */
function forEachNode(node, fn) { fn(node); for (const c of node.children) forEachNode(c, fn); }
function forEachVisibleNode(node, fn) {
  fn(node);
  if (!node.collapsed) for (const c of node.children) forEachVisibleNode(c, fn);
}
function findParent(node) {
  if (node === root) return null;
  let found = null;
  forEachNode(root, n => { if (n.children.includes(node)) found = n; });
  return found;
}
function isInSubtree(node, ancestor) {
  let found = false;
  forEachNode(ancestor, n => { if (n === node) found = true; });
  return found;
}

/* ---------- 工具函数 ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function fmtNum(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  if (n < 1e9) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
}
/* 区间显示：若 max > min 显示 "min-max"，否则显示单值 */
function fmtRange(min, max) {
  const a = min || 0, b = max || 0;
  if (b > a) return fmtNum(a) + '-' + fmtNum(b);
  return fmtNum(a);
}

/* ---------- 子树克隆 ---------- */
function cloneSubtree(node) {
  const c = newNode(node.type, node.echelon, node.name);
  c.customName = !!node.customName;
  c.remark = node.remark || '';
  c.collapsed = !!node.collapsed;
  c.layout = node.layout || 'h';
  c.personnel = node.personnel || 0;
  c.personnelMax = node.personnelMax || 0;
  c.equipment = JSON.parse(JSON.stringify(node.equipment || []));
  c.custom = node.custom ? JSON.parse(JSON.stringify(node.custom)) : null;
  c.children = node.children.map(cloneSubtree);
  return c;
}

function countDescendants(node) {
  let n = 0;
  for (const c of node.children) n += 1 + countDescendants(c);
  return n;
}

/* ---------- 序列化 / 反序列化 ---------- */
const HISTORY_LIMIT = 30;
const historyStack = [];

function serializeOrg(node) {
  const { id, ...rest } = node;
  return { ...rest, children: node.children.map(serializeOrg) };
}
function deserializeOrg(data) {
  const n = newNode(data.type, data.echelon, data.name);
  n.customName = !!data.customName;
  n.remark = data.remark || '';
  n.collapsed = !!data.collapsed;
  n.layout = data.layout || (DEFAULT_VERT_ECHELONS.has(data.echelon) ? 'v' : 'h');
  n.personnel = data.personnel || 0;
  n.personnelMax = data.personnelMax || 0;
  n.equipment = JSON.parse(JSON.stringify(data.equipment || []));
  n.custom = data.custom || null;
  n.children = (data.children || []).map(deserializeOrg);
  return n;
}

/* ---------- 撤销 ---------- */
function pushHistory() {
  if (!root) return;
  historyStack.push(JSON.stringify(serializeOrg(root)));
  if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
  updateUndoBtn();
  scheduleAutoSave();
}

function updateUndoBtn() {
  const btn = document.getElementById('btn-undo');
  if (!btn) return;
  btn.disabled = historyStack.length === 0;
  btn.style.opacity = historyStack.length === 0 ? '.4' : '1';
  btn.style.cursor = historyStack.length === 0 ? 'not-allowed' : 'pointer';
}

function undo() {
  if (!historyStack.length) { toast('没有可撤销的操作', true); return; }
  const snapshot = historyStack.pop();
  try {
    root = deserializeOrg(JSON.parse(snapshot));
    uid = 0;
    forEachNode(root, n => {
      const num = parseInt(n.id.slice(1), 10);
      if (num > uid) uid = num;
    });
    selectedId = null;
    render(); emptyPanel(); renderStats();
    updateUndoBtn();
    toast('已撤销');
  } catch (e) {
    toast('撤销失败：' + e.message, true);
  }
}

/* ---------- 自动保存 ---------- */
const AUTOSAVE_KEY = 'mil_autosave_v1';
const AUTOSAVE_DISMISS_KEY = 'mil_autosave_dismiss_v1';
let autosaveTimer = null;

function scheduleAutoSave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (!root) return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
        data: serializeOrg(root),
        time: Date.now(),
      }));
    } catch (e) { /* 存储满，忽略 */ }
  }, 2000);
}

function formatTimeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return '刚刚';
  if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前';
  if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前';
  return Math.floor(sec / 86400) + ' 天前';
}

function checkAutosave() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null'); } catch (e) {}
  if (!saved || !saved.data || !saved.time) return;

  try {
    const dismissed = localStorage.getItem(AUTOSAVE_DISMISS_KEY);
    if (dismissed && Number(dismissed) >= saved.time) return;
  } catch (e) {}

  if (Date.now() - saved.time > 7 * 24 * 3600 * 1000) {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
    return;
  }

  document.getElementById('restore-text').textContent =
    '检测到 ' + formatTimeAgo(saved.time) + ' 的自动存档，是否恢复？';
  document.getElementById('restore-bar').classList.add('show');
}

function doRestoreAutosave() {
  const bar = document.getElementById('restore-bar');
  try {
    const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY));
    if (!saved || !saved.data) throw new Error('自动存档不存在');
    pushHistory();
    root = deserializeOrg(saved.data);
    uid = 0;
    forEachNode(root, n => {
      const num = parseInt(n.id.slice(1), 10);
      if (num > uid) uid = num;
    });
    selectedId = null;
    render(); emptyPanel(); renderStats();
    toast('已恢复自动存档');
  } catch (e) {
    toast('恢复失败：' + e.message, true);
  }
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
  bar.classList.remove('show');
}

function doDismissAutosave() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
    if (saved && saved.time) {
      localStorage.setItem(AUTOSAVE_DISMISS_KEY, String(saved.time));
    }
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch (e) {}
  document.getElementById('restore-bar').classList.remove('show');
}

/* ---------- 编号 ---------- */
function isAuxSub(parent, child) {
  if (!['division','regiment','brigade'].includes(parent.echelon)) return false;
  return AUX_TYPES.includes(child.type);
}

function getParentShortName(parent) {
  const name = parent.name || '';
  if (name.includes('师')) return '师';
  if (name.includes('团')) return '团';
  if (name.includes('旅')) return '旅';
  const map = { division:'师', regiment:'团', brigade:'旅' };
  return map[parent.echelon] || '';
}

function renumber(node, force) {
  const companyCounters = {};
  const numCounters = {};

  function walk(n, ancestors) {
    for (const child of n.children) {
      if (force) child.customName = false;
      if (!child.customName) {
        if (isAuxSub(n, child)) {
          const sn = getParentShortName(n);
          const tn = TYPES[child.type] ? TYPES[child.type].name : '';
          const en = ECHELONS[child.echelon] ? ECHELONS[child.echelon].name : '';
          child.name = `${sn}直属${tn}${en}`;
        } else {
          switch (child.echelon) {
            case 'battalion': {
              const k = n.id + '_battalion';
              const x = (numCounters[k] || 0) + 1;
              numCounters[k] = x;
              child.name = `${x}营`;
              break;
            }
            case 'company': {
              let regAnc = null, bnAnc = null;
              for (let i = ancestors.length - 1; i >= 0; i--) {
                const p = ancestors[i];
                if (!regAnc && (p.echelon === 'regiment' || p.echelon === 'brigade')) regAnc = p;
                if (!bnAnc && p.echelon === 'battalion') bnAnc = p;
                if (regAnc && bnAnc) break;
              }
              const anchor = regAnc || bnAnc;
              if (anchor) {
                const k = anchor.id;
                const x = companyCounters[k] || 0;
                companyCounters[k] = x + 1;
                child.name = `${String.fromCharCode(65 + (x % 26))}连`;
              } else {
                const k = n.id + '_company';
                const x = (numCounters[k] || 0) + 1;
                numCounters[k] = x;
                child.name = `${x}连`;
              }
              break;
            }
            case 'platoon': {
              const k = n.id + '_platoon';
              const x = (numCounters[k] || 0) + 1;
              numCounters[k] = x;
              child.name = `${x}排`;
              break;
            }
            case 'squad': {
              const k = n.id + '_squad';
              const x = (numCounters[k] || 0) + 1;
              numCounters[k] = x;
              child.name = `${x}班`;
              break;
            }
            case 'section': {
              const k = n.id + '_section';
              const x = (numCounters[k] || 0) + 1;
              numCounters[k] = x;
              child.name = `${x}分队`;
              break;
            }
            case 'team': {
              const k = n.id + '_team';
              const x = (numCounters[k] || 0) + 1;
              numCounters[k] = x;
              child.name = `${x}火力组`;
              break;
            }
            case 'individual': {
              const k = n.id + '_individual';
              const x = (numCounters[k] || 0) + 1;
              numCounters[k] = x;
              const t = TYPES[child.type] ? TYPES[child.type].name : '兵';
              child.name = `${t}${x}`;
              break;
            }
            default: {
              const k = n.id + '_' + child.echelon;
              const x = (numCounters[k] || 0) + 1;
              numCounters[k] = x;
              const t = TYPES[child.type] ? TYPES[child.type].name : '';
              const e = ECHELONS[child.echelon] ? ECHELONS[child.echelon].name : '';
              child.name = `第${x}${t}${e}`;
            }
          }
        }
      }
      ancestors.push(child);
      walk(child, ancestors);
      ancestors.pop();
    }
  }
  walk(node, [node]);
}

/* ---------- 统计 ---------- */
function computeStats(node) {
  let personnel = node.personnel || 0;
  let personnelMax = node.personnelMax || 0;
  const equipment = {};
  const equipmentMax = {};
  for (const e of (node.equipment || [])) {
    equipment[e.name] = (equipment[e.name] || 0) + (e.count || 0);
    equipmentMax[e.name] = (equipmentMax[e.name] || 0) + (e.countMax || e.count || 0);
  }
  for (const c of node.children) {
    const sub = computeStats(c);
    personnel += sub.personnel;
    personnelMax += sub.personnelMax;
    for (const [k,v] of Object.entries(sub.equipment)) equipment[k] = (equipment[k] || 0) + v;
    for (const [k,v] of Object.entries(sub.equipmentMax)) equipmentMax[k] = (equipmentMax[k] || 0) + v;
  }
  return { personnel, personnelMax, equipment, equipmentMax };
}