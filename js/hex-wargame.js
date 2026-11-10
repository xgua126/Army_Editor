/* ============================================================
   hex-wargame.js — 回合制六角格兵棋（UI / 交互 / 回合流程）
   ------------------------------------------------------------
   依赖：hex-core.js（几何 + FLV + CRT）、grid-maps.js、maps-presets.js、
         equipment.js、data.js
   ★ 一切数值都来自 hex-core.js —— 这个文件**只许动界面，不许改规则**。
   ============================================================ */

const WG_SAVES_KEY = 'mil_org_saves_v1';
const HEX_MAPS_KEY = 'mil_hex_maps_v1';   // ★ R10.13：六角格地图编辑器存的地图
/* ★ R10.18：1 回合 = 60 秒 ⇒ 30 回合 = 30 分钟战斗（徒步每回合只有 2 格，12 回合根本走不到对面） */
const WG_MAX_TURN = 30;
const WG_MAX_COUNTERS = 200;     // 单方棋子上限（超过只部署前 N 个）

const $ = (id) => document.getElementById(id);

const W = {
  gm: null, hx: null,
  counters: [],
  side: 'blue',
  turn: 1,
  sel: null,
  target: null,
  reach: null,          // Map<hexKey, mp 花费>
  reachCame: null,      // hexReachable 的父指针（回溯"走的哪条路"）
  hover: null,          // 鼠标所在格
  running: false,
  anim: null,           // 移动动画 { kind:'move', c, path, cost, t0, seg }
  fx: [],               // 一次性特效（开火曳光 / 路径残影）
  motion: true,         // 动画总开关（离线冒烟测试会关掉，保证同步完成）
  cam: { x: 0, y: 0, k: 0.25 },
  label: { blue: '蓝方', red: '红方' },
  overlay: [],          // 飘字 {hex, text, color, t0}
  log: [],
  undo: [],             // ★ R10.16：撤销栈（每一步开火/移动/换回合前存快照）
  oppOn: true,          // ★ R10.20：自动临机射击开关（调试/教学可关掉）
  /* ★ R10.23：部署阶段 / 胜利目标
     —— 玩家："部署的话由玩家手动部署，然后也可以点击按钮自动一键部署"
              "就不算分了，玩家可以设定胜利目标，比如全歼或是占领某个点，
               或是防守某个点几回合" */
  phase: 'idle',        // idle（未开局）/ deploy（部署）/ play（开打）/ over（已结束）
  view: 'tint',         // 底图显示：map（只有地图+网格）/ tint（地形色叠加）/ flat（纯色）
  deploy: null,         // { mode, defender, side, sel, zone:{blue:Set,red:Set}, bench:{blue:[],red:[]} }
  goals: { blue: null, red: null },   // 胜利目标 { kind:'annihilate'|'capture'|'hold', obj, turns }
  held: { blue: 0, red: 0 },          // 防守类目标已连续守住的回合数
  /* ★ R10.36：建筑 / 碉堡（key = row*10000+col → { side, kind, t, by }）
     kind：'building' = 地图上原有的**中立**建筑（炸不坏）；'site' = 正在修的碉堡；'bunker' = 已完工 */
  bld: new Map(),
};
const WG_VIEW_KEY = 'mil_wg_view_v1';

let cv = null, CTX = null, DPR = 1;
const TERR_COLOR = {};
const SIDE_COLOR = {
  /* 兵牌本体直接来自兵牌库（纸白 + 墨）。
     敌我不再加任何底色/边框：**把敌方的墨染成红**（APP-6 就是红蓝墨区分敌我）。
     ink: null = 用兵牌原色（我方深蓝墨）；ink: '#a01b1b' = 红墨 */
  blue: { ink: null,      text: '#dbeafe', label: '#93c5fd' },
  red:  { ink: '#a01b1b', text: '#ffe1e1', label: '#fca5a5' },
};

/* ---------- 小工具 ---------- */
function wgGetSaves() {
  /* ★ R10.38：编制存档走 store.js（IndexedDB；localStorage 只读兼容） */
  try {
    if (typeof Store !== 'undefined') return Store.get(WG_SAVES_KEY, {}) || {};
    return JSON.parse(localStorage.getItem(WG_SAVES_KEY) || '{}');
  } catch (e) { return {}; }
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function sideName(s) { return s === 'blue' ? W.label.blue : W.label.red; }

/* ★ R10.21：音效的统一入口 —— 没加载 sfx.js / 浏览器不支持 / 被静音时**静默降级**，
   任何情况下都不让一个音效把整局棋搞崩。 */
function sfxFire(kind) { try { if (typeof Sfx !== 'undefined') Sfx.fire(kind); } catch (e) {} }
function sfxMove(mob) { try { if (typeof Sfx !== 'undefined') Sfx.move(mob); } catch (e) {} }
function sfxUndo() { try { if (typeof Sfx !== 'undefined') Sfx.undo(); } catch (e) {} }

/* ============================================================
   1) 初始化：下拉框 / 事件 / 画布
   ============================================================ */
function wgInit() {
  cv = $('wg-canvas');
  CTX = cv.getContext('2d');
  GRID_PALETTE.forEach(p => TERR_COLOR[p.id] = p.color);

  loadUserHexMaps();          // ★ 六角格地图编辑器的地图（必须在填下拉框之前）
  /* ★ R10.23：底图显示模式记忆（🎨 叠加 / 🗺 地图 / ⬛ 纯色） */
  try {
    const v = localStorage.getItem(WG_VIEW_KEY);
    if (v && VIEW_LABEL[v]) W.view = v;
  } catch (e) {}
  fillMapSelect();
  fillArmySelects();
  /* ★ R10.38：IndexedDB 里的存档就绪后再填一次（老版本在 localStorage 的数据已搬过来） */
  try { window.addEventListener('store-ready', () => { fillMapSelect(); fillArmySelects(); }); } catch (e) {}
  bindUI();
  resizeCanvas();
  refreshViewBtn();           // ★ R10.23：底图显示按钮的文字跟着记忆值走
  window.addEventListener('resize', () => { resizeCanvas(); render(); });
}

/* ★ R10.13：把「六角格地图编辑器」存的地图并进 GRID_MAPS
   ------------------------------------------------------------
   地图编辑器自己一套存储键（mil_hex_maps_v1），不和战场地图编辑器（5m 光栅）混在一起；
   这里启动时读进来 ⇒ 兵棋的「地图」下拉框里会多出「📁 我的地图」一组。
   这种地图带 `hexData`（每格地形直接给定），bakeHexMap() 直接照抄，不做光栅采样。 */
function loadUserHexMaps() {
  let all = {};
  try {
    all = (typeof Store !== 'undefined') ? (Store.get(HEX_MAPS_KEY, {}) || {})
        : JSON.parse(localStorage.getItem(HEX_MAPS_KEY) || '{}');
  } catch (e) { all = {}; }
  let n = 0;
  for (const id in all) {
    const m = all[id];
    if (!m || !m.hexData) continue;
    const size = hexMapSize(m.hexData.cols, m.hexData.rows);
    m.id = id;
    m._isUserMap = true;
    m._hexOnly = true;
    m.w = m.w || size.w;
    m.h = m.h || size.h;
    if (!m.name) m.name = '六角地图 ' + id;
    GRID_MAPS[id] = m;
    n++;
  }
  return n;
}

function fillMapSelect() {
  const sel = $('wg-map');
  sel.innerHTML = '';
  const ids = Object.keys(GRID_MAPS);
  if (!ids.length) {
    sel.innerHTML = '<option value="">（无地图）</option>';
    return;
  }
  const official = ids.filter(id => !GRID_MAPS[id]._isUserMap);
  const user = ids.filter(id => GRID_MAPS[id]._isUserMap);
  const addGroup = (label, list) => {
    if (!list.length) return;
    const g = document.createElement('optgroup');
    g.label = label;
    list.forEach(id => {
      const gm = GRID_MAPS[id];
      const o = document.createElement('option');
      o.value = id;
      o.textContent = (gm.name || id) +
                      ((gm.hexData || gm._hexOnly)
                        ? '（六角 ' + gm.hexData.cols + '×' + gm.hexData.rows + ' 格）'
                        : '（' + Math.round((gm.w || 0) / 1000) + '×' +
                          Math.round((gm.h || 0) / 1000) + 'km）');
      g.appendChild(o);
    });
    sel.appendChild(g);
  };
  addGroup('★ 官方地图', official);
  addGroup('📁 我的地图', user);
  /* 默认选面积最小的一张（起手快）；带 ?map=id 时优先选它（地图编辑器「试玩」用） */
  const all = official.concat(user);
  if (all.length) {
    let best = all[0];
    for (const id of all) {
      const a = GRID_MAPS[id], b = GRID_MAPS[best];
      if ((a.w * a.h) < (b.w * b.h)) best = id;
    }
    sel.value = best;
  }
  try {
    const want = new URLSearchParams(location.search).get('map');
    if (want && GRID_MAPS[want]) sel.value = want;
  } catch (e) {}
}

/* ★ R10.39：**从文件导入编制 / 地图**
   （玩家："选择战斗双方的编制时无法选择通过文件导入，地图也是"）
   —— 文件可以是：编辑器「保存到文件」的 mil-org、地编辑器的地图 json、或「导出全部」的 mil-bundle */
async function importArmyFromFile() {
  if (typeof Store === 'undefined') { Dlg.alert('存储模块没加载（js/store.js）'); return; }
  const r = await Store.openFile();
  if (!r.ok) {
    if (r.how === 'error') Dlg.alert('文件读不出来：' + ((r.error && r.error.message) || r.error));
    return;
  }
  const d = r.data || {};
  const saves = wgGetSaves();
  let n = 0, last = '';
  const put = (name, rec) => {
    if (!rec || !rec.data || !rec.data.type) return;
    saves[name] = { data: rec.data, time: rec.time || Date.now(),
                    personnel: rec.personnel || 0, equipTotal: rec.equipTotal || 0 };
    n++; last = name;
  };
  const base = String(r.name || '编制').replace(/\.json$/i, '');
  if (d.kind === 'mil-bundle' && d.saves) { for (const k in d.saves) put(k, d.saves[k]); }
  else if (d.data && d.data.type) put(d.name || base, d);
  else if (d.type && d.echelon) put(base, { data: d });
  if (!n) { Dlg.alert('这个文件里没有编制数据。\n（要军队编制编辑器「💾 保存到文件」出来的 .json）'); return; }
  Store.set(WG_SAVES_KEY, saves);
  fillArmySelects();
  const blue = $('wg-blue'), red = $('wg-red');
  if (blue && last) { try { blue.value = last; } catch (e) {} }
  if (red && !red.value && red.options.length) red.value = red.options[0].value;
  Dlg.alert('已导入 ' + n + ' 份编制。\n在「蓝方 / 红方」下拉框里选它就能开局。');
}

async function importMapFromFile() {
  if (typeof Store === 'undefined') { Dlg.alert('存储模块没加载（js/store.js）'); return; }
  const r = await Store.openFile();
  if (!r.ok) {
    if (r.how === 'error') Dlg.alert('文件读不出来：' + ((r.error && r.error.message) || r.error));
    return;
  }
  const d = r.data || {};
  const added = [];
  const addOne = obj => {
    if (!obj || !obj.w || !obj.h || !(obj.layers || obj.rle)) return null;
    try {
      const gm = deserializeGridMap(obj);
      gm._isUserMap = true;
      GRID_MAPS[gm.id] = gm;
      saveUserMapToStorage(gm);
      added.push(gm.id);
      return gm;
    } catch (e) { return null; }
  };
  if (d.kind === 'mil-bundle' && d.maps) { for (const k in d.maps) addOne(d.maps[k]); }
  else addOne(d.map || d);
  if (!added.length) {
    Dlg.alert('这个文件里没有地图数据。\n（要地图编辑器「⬇ 导出」出来的 .json）');
    return;
  }
  fillMapSelect();
  const sel = $('wg-map');
  if (sel) { try { sel.value = added[added.length - 1]; } catch (e) {} }
  Dlg.alert('已导入 ' + added.length + ' 张地图，已经帮你选中。');
}

function fillArmySelects() {
  const saves = wgGetSaves();
  const names = Object.keys(saves).sort((a, b) => (saves[b].time || 0) - (saves[a].time || 0));
  for (const id of ['wg-blue', 'wg-red']) {
    const sel = $(id);
    sel.innerHTML = '';
    if (!names.length) {
      sel.innerHTML = '<option value="">（无编制存档）</option>';
      continue;
    }
    names.forEach(n => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n + (saves[n].personnel ? ' · ' + saves[n].personnel + '人' : '');
      sel.appendChild(o);
    });
    sel.value = names[names.length > 1 && id === 'wg-red' ? 1 : 0];
  }
}

function resizeCanvas() {
  const stage = $('wg-stage');
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const r = stage.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * DPR));
  cv.height = Math.max(1, Math.round(r.height * DPR));
}
function cssW() { return cv.width / DPR; }
function cssH() { return cv.height / DPR; }

/* ============================================================
   2) 开局：烘焙六角格 + 生成棋子 + 部署
   ============================================================ */
function echelonLabel(key) {
  if (typeof ECHELONS !== 'undefined' && ECHELONS[key] && ECHELONS[key].name) {
    return ECHELONS[key].name;          // data.js 的全量映射（团/旅/营/连/排/班…）
  }
  const m = { squad: '班', team: '火力组', section: '分队', platoon: '排', company: '连' };
  return m[key] || key || '';
}

function startGame() {
  const mapId = $('wg-map').value;
  if (!mapId || !GRID_MAPS[mapId]) { Dlg.alert('请先选择一张地图。'); return; }
  const saves = wgGetSaves();
  const bName = $('wg-blue').value, rName = $('wg-red').value;
  if (!bName || !rName) {
    Dlg.alert('需要两份编制存档才能开局。\n\n先去「军队编制编辑器」建一份编制并保存，\n再回来这里选蓝红双方。');
    return;
  }
  /* 允许镜像对局（只有一份存档时也能先跑起来看效果） */
  const mirror = (bName === rName);

  const ech = $('wg-ech').value;
  /* ★ R10.23：部署模式（遭遇 / 攻防）+ 攻防时谁是防守方 */
  const modeEl = $('wg-mode'), defEl = $('wg-defender');
  const mode = (modeEl && modeEl.value === 'attack') ? 'attack' : 'meeting';
  const defender = (defEl && defEl.value === 'blue') ? 'blue' : 'red';

  W.gm = GRID_MAPS[mapId];
  W.hx = bakeHexMap(W.gm);
  /* ★ R10.36：地图上原有的建筑 ⇒ **中立建筑**（谁都能进驻、炸不坏） */
  W.bld = initBuildings(W.hx);
  W.label.blue = '蓝·' + bName;
  W.label.red = '红·' + rName;
  W.overlay = [];
  W.log = [];
  W.undo = [];                     // ★ 新开局：撤销栈清空
  W.sel = null; W.target = null; W.reach = null; W.fire = null;
  W.side = 'blue'; W.turn = 1; W.running = true;
  W.counters = [];
  W.phase = 'deploy';              // ★ 先进部署阶段（不再自动摆好）
  W.held = { blue: 0, red: 0 };
  W.lastFire = null;

  const bc = buildCounters(saves[bName].data, 'blue', ech);
  const rc = buildCounters(saves[rName].data, 'red', ech);
  /* ★ R10.6：有装备在"当前装备库 + 内置种子"里都对不上 ⇒ 明确告诉玩家（不要静默按 0） */
  const missingEquip = (typeof takeMissingEquip === 'function') ? takeMissingEquip() : [];
  if (!bc.length || !rc.length) {
    W.phase = 'idle'; W.running = false;
    Dlg.alert('有一方生成不出棋子。\n\n可能是编制存档里没有对应层级（比如选了「班」但编制只有「营」）。\n换个「棋子粒度」再试。');
    return;
  }

  /* ★ R10.23：部署区 —— 攻防（守 80% / 攻 20%）、遭遇（各 20%）
     锚点取地图上的蓝/红出生区（gm.spawns），没画就退回地图西/东边 */
  const anchors = spawnAnchors(W.gm);
  [['blue', bc], ['red', rc]].forEach(pair => {
    if (pair[1].length > WG_MAX_COUNTERS) {
      pushLog('t', sideName(pair[0]) + ' 棋子过多（' + pair[1].length + '），只部署前 ' +
                    WG_MAX_COUNTERS + ' 个');
    }
  });
  W.deploy = {
    mode, defender, side: 'blue', sel: null,
    zone: {
      blue: deployZone(W.hx, 'blue', mode, defender, anchors),
      red:  deployZone(W.hx, 'red',  mode, defender, anchors),
    },
    bench: { blue: bc.slice(0, WG_MAX_COUNTERS), red: rc.slice(0, WG_MAX_COUNTERS) },
  };
  W.goals = defaultGoals(mode, defender);

  $('wg-hint').classList.add('hidden');
  $('wg-bar').classList.remove('hidden');
  refreshDeployUI();

  pushLog('t', '开局：' + (W.gm.name || mapId) + ' · 每格 ' + HEX_EDGE +
                'm · 每回合 ' + TURN_SECONDS + ' 秒 · 棋子粒度「' + echelonLabel(ech) + '」');
  const foe = (defender === 'blue') ? 'red' : 'blue';
  pushLog('t', '部署模式：' + (mode === 'attack'
    ? ('攻防 —— ' + sideName(defender) + ' 防守（80% 部署区）/ ' + sideName(foe) + ' 进攻（20%）')
    : '遭遇 —— 双方各 20% 部署区（中间 60% 是无人区）'));
  pushLog('t', '部署区：蓝 ' + W.deploy.zone.blue.size + ' 格 · 红 ' +
                W.deploy.zone.red.size + ' 格（全图可部署 ' + deployableCount(W.hx) + ' 格）');
  if (mirror) pushLog('t', '双方使用同一份编制（镜像对局）');
  pushLog('t', '六角格 ' + W.hx.cols + '×' + W.hx.rows + ' = ' +
                W.hx.hexes.filter(h => !!h).length + ' 格（每格 ' + HEX_EDGE + 'm）');
  /* ★ R10.36：建筑说明（中立建筑 = 掩体，工兵可以修碉堡） */
  const nNeutral = W.bld.size;
  if (nNeutral) {
    pushLog('t', '🏠 地图上有 ' + nNeutral + ' 格建筑（**中立**：双方都能进驻，守方 FLV −' + BUILDING_FLV + '，不会被炸坏）');
  }
  pushLog('t', '🏗 工兵可在空地上修碉堡（' + BUNKER_TURNS + ' 回合 · 守方 FLV −' + BUNKER_FLV +
                '）：施工期间必须在**没有敌方 ZOC、没挨打**的格子上，否则打断');
  if (missingEquip.length) {
    pushLog('hl', '⚠ 这些装备在「装备库 + 内置种子」里都找不到，火力按 0 计：' +
                  missingEquip.join('、'));
  }
  pushLog('t', '👉 ' + sideName('blue') + ' 部署：点右侧棋子 → 点部署区高亮格放下；' +
                '点自己已放下的棋子可以收回，也可以用「🎲 一键部署」');

  fitCamera();
  refreshPanels();
  refreshUndoBtn();
  render();
}

/* ============================================================
   ★ R10.23：部署（手动摆 + 一键部署）
   ------------------------------------------------------------
   玩家定案："部署的话由玩家手动部署，然后也可以点击按钮自动一键部署"
   · 部署阶段的棋子**不进** W.counters（棋盘上还没有它），放下才进去
   · 每放/收一个都 pushUndo() ⇒ Ctrl+Z 能撤回
   ============================================================ */
/* 默认胜利目标：攻防 → 攻方"占领"最深的据点 + 守方"防守该点 10 回合"；遭遇 → 双方全歼 */
function pickDeepestObjective(side) {
  const objs = (W.gm && W.gm.objectives) || [];
  if (!objs.length) return -1;
  const a = spawnAnchors(W.gm);            // 对手的出生锚点 = 最"深"的方向
  const p = (side === 'blue') ? a.red : a.blue;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < objs.length; i++) {
    const d = Math.hypot((+objs[i].x || 0) - p.x, (+objs[i].y || 0) - p.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function defaultGoals(mode, defender) {
  const hasObj = ((W.gm && W.gm.objectives) || []).length > 0;
  if (mode !== 'attack' || !hasObj) {
    return { blue: { kind: 'annihilate', obj: -1, turns: 0 },
             red:  { kind: 'annihilate', obj: -1, turns: 0 } };
  }
  const attacker = (defender === 'blue') ? 'red' : 'blue';
  const obj = pickDeepestObjective(attacker);
  return {
    blue: { kind: (defender === 'blue') ? 'hold' : 'capture', obj, turns: 10 },
    red:  { kind: (defender === 'red')  ? 'hold' : 'capture', obj, turns: 10 },
  };
}
/* "后排"棋子（车辆 / 拖炮 / 炮兵）—— 一键部署时放在离敌人远的一侧 */
function isRearCounter(c) {
  if (!c) return false;
  if (c.kind === 'veh') return true;
  if (c.mpType && c.mpType !== 'foot') return true;
  return !!(c.supports && c.supports.length);
}
/* 这一格现在能不能落子（部署阶段：区内 + 站得住 + 没人） */
function canPlaceAt(side, h) {
  if (!h || !W.deploy) return false;
  if (!W.deploy.zone[side].has(hexKey(h))) return false;
  if (!isFinite(hexMoveCost(h, 'foot'))) return false;
  return countersAt(W.counters, h).length === 0;
}
function placeCounter(c, h) {
  const st = W.deploy;
  if (!st || !c || !canPlaceAt(c.side, h)) return false;
  pushUndo();
  const bench = st.bench[c.side];
  const i = bench.indexOf(c);
  if (i >= 0) bench.splice(i, 1);
  c.hex = h;
  /* 按棋子 id 插进 W.counters（= 编制顺序）—— 别让"谁先放下"打乱兵牌顺序 */
  if (W.counters.indexOf(c) < 0) {
    const nid = parseInt(String(c.id).slice(1), 10) || 0;
    let at = W.counters.length;
    for (let k = 0; k < W.counters.length; k++) {
      const cid = parseInt(String(W.counters[k].id).slice(1), 10) || 0;
      if (nid < cid) { at = k; break; }
    }
    W.counters.splice(at, 0, c);
  }
  pushLog('t', sideName(c.side) + ' 部署「' + c.name + '」→ ' + (h.col + 1) + ',' + (h.row + 1));
  return true;
}
function unplaceCounter(c) {
  if (!c || !W.deploy) return false;
  pushUndo();
  c.hex = null;
  const i = W.counters.indexOf(c);
  if (i >= 0) W.counters.splice(i, 1);
  const bench = W.deploy.bench[c.side];
  if (bench.indexOf(c) < 0) bench.push(c);
  pushLog('t', sideName(c.side) + ' 收回「' + c.name + '」');
  return true;
}

/* 一键部署：把该方还没放的棋子铺进部署区
   —— 远敌侧放"后排"（车/炮），近敌侧放步兵；同类按番号顺序 */
function autoDeploySide(side) {
  const st = W.deploy;
  if (!st) return 0;
  const bench = st.bench[side];
  if (!bench.length) return 0;
  const cells = [];
  for (const key of st.zone[side]) {
    const col = key % 10000, row = Math.floor(key / 10000);
    const h = hexAt(W.hx, col, row);
    if (h && countersAt(W.counters, h).length === 0) cells.push(h);
  }
  if (!cells.length) return 0;
  const anchors = spawnAnchors(W.gm);
  const foe = (side === 'blue') ? anchors.red : anchors.blue;
  /* 由远到近排：先放后排棋子 */
  cells.sort((a, b) => (Math.hypot(b.x - foe.x, b.y - foe.y) - Math.hypot(a.x - foe.x, a.y - foe.y))
                     || (a.row - b.row) || (a.col - b.col));
  const rear = [], front = [];
  for (const c of bench.slice()) (isRearCounter(c) ? rear : front).push(c);
  const order = rear.concat(front);
  /* 摊开摆：优先挑"六个邻居都还没人"的格子（一堆棋子挤成一团既难看也没法机动） */
  const used = new Set();
  const pick = [];
  for (const h of cells) {
    if (pick.length >= order.length) break;
    let near = false;
    for (const nb of hexNeighbors(h.col, h.row)) {
      if (used.has(nb.row * 10000 + nb.col)) { near = true; break; }
    }
    if (near) continue;
    pick.push(h);
    used.add(hexKey(h));
  }
  if (pick.length < order.length) {           // 格子不够摊开 ⇒ 放宽，剩下的随便填
    for (const h of cells) {
      if (pick.length >= order.length) break;
      if (pick.indexOf(h) >= 0) continue;
      pick.push(h);
    }
  }
  let n = 0;
  for (let i = 0; i < order.length && i < pick.length; i++) {
    if (placeCounter(order[i], pick[i])) n++;
  }
  return n;
}
function autoDeployAll() {
  const st = W.deploy;
  if (!st) return 0;
  const n = autoDeploySide(st.side);
  pushLog('t', '🎲 ' + sideName(st.side) + ' 一键部署：放下 ' + n + ' 个棋子' +
                (st.bench[st.side].length
                  ? ('，还剩 ' + st.bench[st.side].length + ' 个（部署区放不下，先挪一挪再试）')
                  : ''));
  st.sel = null;
  refreshPanels();
  refreshDeployUI();
  render();
  return n;
}
/* 部署区里还有多少空格（判断"能不能继续放"） */
function freeZoneCells(side) {
  const st = W.deploy;
  if (!st) return 0;
  let n = 0;
  for (const key of st.zone[side]) {
    const h = hexAt(W.hx, key % 10000, Math.floor(key / 10000));
    if (h && countersAt(W.counters, h).length === 0) n++;
  }
  return n;
}
/* 本方部署完成 → 换另一方；双方都完成 ⇒ 开打
   ★ R10.39：**不要求全放**（玩家："可以不把全部单位都部署，只要点击部署完成就可以"）
   · finishDeploySide() = 直接完成（没放的留作预备队，本局不上场）
   · askFinishDeploySide() = 界面按钮走这条：还有没放的先问一句 */
function finishDeploySide() {
  const st = W.deploy;
  if (!st) return false;
  let left = st.bench[st.side].length;
  if (left) {
    pushLog('hl', '⚠ ' + sideName(st.side) + ' 有 ' + left + ' 个单位没部署（本局不上场）');
    st.bench[st.side].length = 0;
    left = 0;
  }
  pushLog('t', '✔ ' + sideName(st.side) + ' 部署完成（部署区 ' + st.zone[st.side].size + ' 格）');
  if (st.side === 'blue') {
    st.side = 'red'; st.sel = null;
    pushLog('t', '👉 ' + sideName('red') + ' 部署：点右侧棋子 → 点部署区高亮格放下');
    refreshPanels(); refreshDeployUI(); render();
    return true;
  }
  startBattle();
  return true;
}
/* ★ R10.39：界面按钮走这条 —— 还有没放下的先确认，确认后只带已部署的开打 */
async function askFinishDeploySide() {
  const st = W.deploy;
  if (!st) return;
  const left = st.bench[st.side].length;
  if (left) {
    const ok = await Dlg.confirm(
      sideName(st.side) + ' 还有 ' + left + ' 个单位没放下。\n\n' +
      '确定「只带已部署的单位」继续吗？（剩下的本局不上场）\n' +
      '点「取消」可以回去接着放。');
    if (!ok) return;
  }
  finishDeploySide();
}

function startBattle() {
  const st = W.deploy;
  W.phase = 'play';
  if (st) st.sel = null;
  W.side = 'blue'; W.turn = 1;
  W.sel = null; W.target = null; W.reach = null; W.fire = null;
  /* ★ 部署阶段的撤销记录到此为止：开打后再 Ctrl+Z 不该把棋子退回待部署列表 */
  W.undo.length = 0;
  beginSideTurn(W.counters, 'blue');
  pushLog('t', '⚔ 部署结束，开打！—— 第 1 回合 · ' + sideName(W.side) + ' ——');
  pushLog('t', '目标：蓝「' + goalLabel(W.goals.blue) + '」 / 红「' + goalLabel(W.goals.red) + '」');
  refreshPanels(); refreshDeployUI(); render(); refreshUndoBtn();
}
/* 部署阶段的点击：点自己的棋子＝收回；点区内空格＝放下选中的棋子 */
function onDeployClick(mx, my) {
  const st = W.deploy;
  if (!st || !W.hx) return;
  const wh = s2w(mx, my);
  const h = hexOfWorld(W.hx, wh.x, wh.y);
  if (!h) { st.sel = null; refreshPanels(); render(); return; }
  const mine = countersAt(W.counters, h).filter(c => c.side === st.side);
  if (mine.length) {                       // ① 收回
    unplaceCounter(mine[0]);
    st.sel = null;
    refreshPanels(); refreshDeployUI(); render();
    return;
  }
  /* ② 放下：优先用选中的；只剩一个就直接用它（少点两下） */
  let c = st.sel;
  if (!c && st.bench[st.side].length === 1) c = st.bench[st.side][0];
  if (!c) {
    pushLog('hl', '先在右侧「部署」列表里点一个棋子，再点部署区里的高亮格');
    refreshPanels(); refreshDeployUI(); render();
    return;
  }
  if (!st.zone[st.side].has(hexKey(h))) {
    pushLog('hl', '这一格不在你的部署区里（高亮的才是）');
    render();
    return;
  }
  if (!placeCounter(c, h)) {
    pushLog('hl', '这一格已经有人了');
    render();
    return;
  }
  st.sel = null;
  refreshPanels(); refreshDeployUI(); render();
}

/* ============================================================
   3) 相机（世界坐标 → 屏幕坐标）
   ============================================================ */
function w2s(x, y) { return { x: (x - W.cam.x) * W.cam.k, y: (y - W.cam.y) * W.cam.k }; }
function s2w(x, y) { return { x: x / W.cam.k + W.cam.x, y: y / W.cam.k + W.cam.y }; }
function fitCamera() {
  if (!W.gm) return;
  const pad = 12;
  const kx = (cssW() - pad * 2) / Math.max(1, W.gm.w);
  const ky = (cssH() - pad * 2) / Math.max(1, W.gm.h);
  W.cam.k = Math.max(0.02, Math.min(kx, ky));
  W.cam.x = (W.gm.w - cssW() / W.cam.k) / 2;
  W.cam.y = (W.gm.h - cssH() / W.cam.k) / 2;
}
function zoomAt(sx, sy, factor) {
  const before = s2w(sx, sy);
  W.cam.k = Math.max(0.03, Math.min(4, W.cam.k * factor));
  const after = s2w(sx, sy);
  W.cam.x += before.x - after.x;
  W.cam.y += before.y - after.y;
}

/* ============================================================
   4) 绘制
   ============================================================ */
/* 邻居方向对应的边中点角度（与 hexNeighbors 的返回顺序一致：E,NE,NW,W,SW,SE） */
const EDGE_ANGLE = [0, -60, -120, 180, 120, 60];

function hexPath(ctx, c, r) {
  const cs = hexCorners(c.x, c.y, r);
  ctx.beginPath();
  ctx.moveTo(cs[0].x, cs[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(cs[i].x, cs[i].y);
  ctx.closePath();
}
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/* ★ 注意：本页同时加载 render.js（兵牌库），它里面也有一个 `render()`（画编制树）。
   这里的同名声明**是有意的覆盖**：wargame 页只用本文件的 render()，
   编制树那套（render/updateNodeBadges/…）在本页不会被调用。 */
function render() {
  if (!CTX) return;
  const ctx = CTX;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, cssW(), cssH());
  if (!W.hx) return;

  const k = W.cam.k;
  const r = HEX_EDGE * k;                       // 屏幕上的边长
  const tl = s2w(0, 0), br = s2w(cssW(), cssH());
  const rowMin = Math.max(0, Math.floor((tl.y - HEX_EDGE) / HEX_ROW_STEP) - 1);
  const rowMax = Math.min(W.hx.rows - 1, Math.ceil((br.y + HEX_EDGE) / HEX_ROW_STEP) + 1);
  const colMin = Math.max(0, Math.floor((tl.x - HEX_W) / HEX_W) - 1);
  const colMax = Math.min(W.hx.cols - 1, Math.ceil((br.x + HEX_W) / HEX_W) + 1);

  /* ⓪ ★ R10.23：真实战场地图（与实时战斗同一张 5m 光栅底图 + 矢量公路）
     —— 玩家："地图用的是我们实时战斗里面的地图直接套上六角格来用" */
  const hasBase = drawMapBase(ctx, k);
  const view = hasBase ? (W.view || 'tint') : 'flat';

  /* ① 地形：有底图时不再盖纯色（tint = 叠一层 30% 地形色，让规则一眼可见） */
  ctx.lineWidth = Math.max(0.5, Math.min(1.6, 0.9 * k + 0.4));
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const h = hexAt(W.hx, col, row);
      if (!h) continue;
      const p = w2s(h.x, h.y);
      hexPath(ctx, p, Math.max(1, r));
      if (view === 'flat') {
        ctx.fillStyle = TERR_COLOR[h.terr] || '#a8c585';
        ctx.fill();
      } else if (view === 'tint') {
        ctx.globalAlpha = 0.30;
        ctx.fillStyle = TERR_COLOR[h.terr] || '#a8c585';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      /* 据点范围：淡淡镀一层金（半径改成"格"之后一个据点可能盖好几格） */
      if (h.obj >= 0 && view !== 'flat') {
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#fcd34d';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = hasBase ? 'rgba(8,12,20,.34)' : 'rgba(10,16,28,.28)';
      ctx.stroke();
    }
  }
  drawObjectives(ctx, r);        // 据点中心环 + 名字 + "N 格"

  /* ② 公路：格心 → 有路邻居的边中点（规则层"哪一格算有路"的可视化）
     —— 有真实底图时压得很淡，让下面真正的路面透出来 */
  if (k > 0.06) {
    ctx.strokeStyle = hasBase ? 'rgba(255,244,214,.34)' : 'rgba(38,46,58,.85)';
    ctx.lineWidth = Math.max(1, Math.min(6, 0.16 * HEX_EDGE * k));
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const h = hexAt(W.hx, col, row);
        if (!h || !h.road) continue;
        const p = w2s(h.x, h.y);
        const nbs = hexNeighbors(h.col, h.row);
        for (let i = 0; i < nbs.length; i++) {
          const nh = hexAt(W.hx, nbs[i].col, nbs[i].row);
          if (!nh || !nh.road) continue;
          const ang = EDGE_ANGLE[i] * Math.PI / 180;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(ang) * r * 0.866, p.y + Math.sin(ang) * r * 0.866);
          ctx.stroke();
        }
      }
    }
  }

  /* ②b 部署阶段：把当前部署方的部署区高亮出来 */
  drawDeployZone(ctx, r);

  /* ②c ★ R10.36：建筑 / 碉堡（在棋子下面 ⇒ 棋子"进驻"的观感） */
  drawWarBuildings(ctx, r);

  /* ③ 可移动范围 → 行走路径 → 地面特效 → 棋子 → 空中特效 → 飘字 → 悬停框 */
  drawReach(ctx, r);
  drawMovePath(ctx, r);
  drawFx(ctx, r, 'under');
  drawCorpses(ctx, r);          // ★ R10.19：尸体黑点（在兵牌下面）
  drawCounters(ctx, r);
  drawFx(ctx, r, 'over');
  drawOverlayText(ctx);
  if (W.hover && k > 0.12) {
    const p = w2s(W.hover.x, W.hover.y);
    hexPath(ctx, p, Math.max(1, r));
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

/* ★ R10.23：画**真实战场地图**（与实时战斗同一张底图）
   ------------------------------------------------------------
   · bakeGridCanvas(gm) 是 grid-maps.js 里烘焙好的 5m 像素图（含地形纹理）
   · 矢量公路（立交桥 / 卡朗唐）**不**进底图 ⇒ 这里用折线按真实路宽描一遍，
     缩放永远锐利（和 battle.js 的 drawRoads 同一套做法）
   · 六角格地图（gm.hexData，编辑器逐格手绘）没有光栅 ⇒ 返回 false，走纯色渲染
   · Node 冒烟没有真 canvas ⇒ try/catch 兜住，回退纯色，绝不让一局棋崩掉 */
function drawMapBase(ctx, k) {
  const gm = W.gm;
  /* ★ R10.36：合并后的编辑器产出的地图**同时**有 5m 光栅和 hexData ⇒ 底图照样要画。
     老六角编辑器那种"只有 hexData、没有光栅图层"的图没有 layers ⇒ 仍旧走纯色。 */
  if (!gm || !gm.layers || !gm.layers.length || !gm.w || !gm.h) return false;
  let img = null;
  try {
    if (typeof bakeGridCanvas === 'function') img = bakeGridCanvas(gm);
  } catch (e) { img = null; }
  if (!img || !img.width) return false;
  const p = w2s(0, 0);
  const prev = ctx.imageSmoothingEnabled;
  try {
    ctx.imageSmoothingEnabled = false;      // 战术图保持"像素感"（与实时战斗一致）
    ctx.drawImage(img, p.x, p.y, gm.w * k, gm.h * k);
  } catch (e) {
    ctx.imageSmoothingEnabled = prev;
    return false;
  }
  ctx.imageSmoothingEnabled = prev;
  drawVectorRoads(ctx, k);
  return true;
}
/* 底图可用吗（给冒烟/调试用；真渲染走 drawMapBase） */
function mapBaseAvailable() {
  const gm = W.gm;
  if (!gm || gm.hexData || !gm.w || !gm.h) return false;
  try {
    const img = (typeof bakeGridCanvas === 'function') ? bakeGridCanvas(gm) : null;
    return !!(img && img.width > 0 && img.height > 0);
  } catch (e) { return false; }
}
function drawVectorRoads(ctx, k) {
  const roads = (W.gm && W.gm.roads) || [];
  if (!roads.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const rd of roads) {
    const pts = rd.pts || [];
    if (pts.length < 2) continue;
    const w = Math.max(1.2, (+rd.w || 10) * k);
    /* 两遍：先深色"路肩"，再浅色路面 —— 小比例尺下也能看出是条路 */
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? 'rgba(226,214,190,.92)' : 'rgba(26,22,16,.55)';
      ctx.lineWidth = pass ? w : (w + Math.max(1.5, 3 * k));
      ctx.beginPath();
      const p0 = w2s(pts[0].x, pts[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < pts.length; i++) {
        const p = w2s(pts[i].x, pts[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}
/* ★ R10.36：建筑 / 碉堡（玩家："建筑就改为放置在格内…初始放置在地图上的为中立建筑，
   工兵可以花 3 回合修建碉堡…单位进驻碉堡时会获得防御加成"）
   —— 中立建筑 = 灰白方块；在建碉堡 = 虚线 + 进度；完工碉堡 = 修建方颜色 + 🏰 */
function drawWarBuildings(ctx, r) {
  if (!W.bld || !W.bld.size) return;
  const k = W.cam.k;
  const tl = s2w(0, 0), br = s2w(cssW(), cssH());
  const s = Math.max(6, r * 0.52);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const ent of W.bld) {
    const key = ent[0], b = ent[1];
    const col = key % 10000, row = Math.floor(key / 10000);
    const h = hexAt(W.hx, col, row);
    if (!h) continue;
    if (h.x < tl.x - HEX_W || h.x > br.x + HEX_W || h.y < tl.y - HEX_H || h.y > br.y + HEX_H) continue;
    const p = w2s(h.x, h.y);
    if (b.kind === 'building') {
      ctx.fillStyle = 'rgba(203,213,225,.30)';
      ctx.strokeStyle = 'rgba(226,232,240,.85)';
      ctx.lineWidth = Math.max(1, 1.2 * k + 0.4);
      roundRect(ctx, p.x - s / 2, p.y - s / 2, s, s, Math.max(2, s * 0.18));
      ctx.fill();
      ctx.stroke();
      if (k > 0.16) {
        ctx.font = Math.round(Math.max(9, s * 0.85)) + 'px system-ui, sans-serif';
        ctx.fillText('🏠', p.x, p.y + 0.5);
      }
    } else {
      const own = (b.side === 'blue') ? '#60a5fa' : (b.side === 'red' ? '#f87171' : '#cbd5e1');
      const done = (b.kind === 'bunker');
      ctx.fillStyle = done ? (b.side === 'blue' ? 'rgba(37,99,235,.55)' : 'rgba(185,28,28,.55)')
                           : 'rgba(148,163,184,.22)';
      ctx.strokeStyle = own;
      ctx.lineWidth = Math.max(1.2, 1.6 * k + 0.6);
      if (!done) ctx.setLineDash([Math.max(3, s * 0.28), Math.max(3, s * 0.22)]);
      roundRect(ctx, p.x - s / 2, p.y - s / 2, s, s, Math.max(2, s * 0.16));
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (k > 0.14) {
        ctx.font = Math.round(Math.max(9, s * 0.8)) + 'px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(done ? '🏰' : '🔨', p.x, p.y + 0.5);
        /* 在建：右上角写进度 t/3 */
        if (!done) {
          ctx.font = '700 ' + Math.round(Math.max(9, s * 0.62)) + 'px system-ui, sans-serif';
          ctx.fillStyle = '#e2e8f0';
          ctx.fillText((b.t | 0) + '/' + BUNKER_TURNS, p.x, p.y - s * 0.78);
        }
      }
    }
  }
  ctx.restore();
}

/* 据点：中心环 + 名字 + "N 格"（半径已经改成格数） */
function drawObjectives(ctx, r) {
  const objs = (W.gm && W.gm.objectives) || [];
  if (!objs.length) return;
  const k = W.cam.k;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    const p = w2s(+o.x || 0, +o.y || 0);
    const rHex = (o.rHex != null)
      ? Math.max(1, o.rHex | 0)
      : Math.max(1, Math.round((+o.r || 300) / HEX_EDGE));
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, r * 0.5), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(252,211,77,.95)';
    ctx.lineWidth = Math.max(1.2, 1.6 * k + 0.8);
    ctx.stroke();
    if (k > 0.08) {
      ctx.fillStyle = 'rgba(252,211,77,.95)';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText((o.name || ('据点 ' + (i + 1))) + ' ·' + rHex + '格', p.x, p.y - r * 0.95);
    }
  }
  ctx.restore();
}
/* 部署阶段：当前部署方整个部署区高亮；对方那一小块（20%）只描个浅边 */
function drawDeployZone(ctx, r) {
  const st = W.deploy;
  if (!st || W.phase !== 'deploy') return;
  const mine = st.zone[st.side];
  const otherKey = (st.side === 'blue') ? 'red' : 'blue';
  const other = st.zone[otherKey];
  ctx.save();
  ctx.fillStyle = (st.side === 'blue') ? 'rgba(96,165,250,.26)' : 'rgba(248,113,113,.26)';
  for (const key of mine) {
    const h = hexAt(W.hx, key % 10000, Math.floor(key / 10000));
    if (!h) continue;
    hexPath(ctx, w2s(h.x, h.y), Math.max(1, r * 0.98));
    ctx.fill();
  }
  if (other && other.size <= 400) {          // 20% 那块才描边（80% 描边太费）
    ctx.strokeStyle = 'rgba(148,163,184,.32)';
    ctx.lineWidth = 1;
    for (const key of other) {
      const h = hexAt(W.hx, key % 10000, Math.floor(key / 10000));
      if (!h) continue;
      hexPath(ctx, w2s(h.x, h.y), Math.max(1, r * 0.9));
      ctx.stroke();
    }
  }
  /* 选中的棋子：鼠标所在格画个"落子虚影" */
  const hv = W.hover;
  if (st.sel && hv && mine.has(hexKey(hv)) && countersAt(W.counters, hv).length === 0) {
    const p = w2s(hv.x, hv.y);
    hexPath(ctx, p, Math.max(1, r * 0.95));
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();
}

function drawReach(ctx, r) {
  if (!W.reach || !W.sel) return;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  for (const [key] of W.reach) {
    const col = key % 10000, row = Math.floor(key / 10000);
    const h = hexAt(W.hx, col, row);
    if (!h) continue;
    if (W.sel.hex && h.col === W.sel.hex.col && h.row === W.sel.hex.row) continue;
    const p = w2s(h.x, h.y);
    hexPath(ctx, p, Math.max(1, r * 0.98));
    ctx.fill();
  }
  /* 花费数字 */
  if (r > 14) {
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [key, cost] of W.reach) {
      const col = key % 10000, row = Math.floor(key / 10000);
      const h = hexAt(W.hx, col, row);
      if (!h || cost <= 0) continue;
      const p = w2s(h.x, h.y);
      ctx.fillText(String(cost), p.x, p.y + r * 0.45);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

/* ---------- 兵牌：**直接用兵牌库的北约符号**（render.js 的 buildSymbol） ----------
   玩家："场上的兵牌不要重新绘制，就用现有兵牌库里的那些。"
   ⇒ 这里只做三件事：把 SVG 转成图片、加一圈阵营色、在牌下写番号；
      兵牌本身（框架 / 兵种图标 / 梯队标记）**一个像素都不改**。 */
const _symCache = new Map();

function wgSymbolImage(type, echelon, custom, ink) {
  const key = String(type) + '|' + String(echelon) + '|' +
              (custom ? JSON.stringify(custom) : '') + '|' + (ink || '');
  if (_symCache.has(key)) return _symCache.get(key);
  if (typeof buildSymbol !== 'function' || typeof Image === 'undefined') return null;
  let svg = null;
  try {
    /* ★ R10.24：兵牌由 MIL-STD-2525 库画 ⇒ 敌方直接把"墨色"当参数传，
       不再对 SVG 做字符串替换（换到库里那套字符串根本不出现） */
    if (typeof symbolSvg === 'function' && ink) {
      svg = symbolSvg(type, echelon, custom, { ink });
    }
    if (!svg) svg = buildSymbol(type, echelon, custom);
  } catch (e) { svg = null; }
  if (!svg) return null;
  /* 旧渲染兜底时（手写 SVG），仍按老办法换墨色 */
  if (ink && svg.indexOf(ink) < 0) {
    const inks = [];
    if (typeof INK_LIGHT !== 'undefined') inks.push(INK_LIGHT);
    if (typeof INK_DARK !== 'undefined') inks.push(INK_DARK);
    for (const k of inks) svg = svg.split(k).join(ink);
  }
  const img = new Image();
  img.loaded = false;
  try {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    /* 首次加载完重绘一次（否则第一帧是空框） */
    img.onload = () => {
      img.loaded = true;
      URL.revokeObjectURL(url);
      if (W.hx) render();
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
  } catch (e) { return null; }
  _symCache.set(key, img);
  return img;
}

/* 一级的"编号"：优先数字（"第3连"→3、"2排"→2），没有就取字母（"A连"→A），
   再没有就用名字前 2 字（"步兵连"→步兵） */
function levelCode(entry) {
  const nm = String((entry && entry.name) || '').trim();
  if (!nm) return '';
  const num = nm.match(/\d+/);
  if (num) return num[0];
  const ab = nm.match(/[A-Za-z]+/);
  if (ab) return ab[0];
  return nm.slice(0, 2);
}
/* 番号：北约式的**层级链**，从大单位往小单位连写（斜杠分隔）
     第1团 → 第3连 → 第2排 → 第1班   ⇒   "1/3/2/1"
   ★ 最多取 4 级 —— 玩家定的形式："团或旅 / 连 / 排 / 班"
   withNames = true ⇒ 带级名："1团/3连/2排/1班"（侧栏用；牌面太窄放不下） */
function counterDesignation(c, withNames) {
  const p = (c.path || []).slice(-4);
  const parts = [];
  for (const e of p) {
    const code = levelCode(e);
    if (!code) continue;
    let out = code;
    if (withNames) {
      const lv = echelonLabel(e.echelon);
      if (lv && code.indexOf(lv) < 0) out = code + lv;
    }
    parts.push(out);
  }
  if (parts.length) return parts.join('/');
  const node = c.node || {};
  const nm = String(node.name || c.name || '').trim();
  return nm || '未命名';
}
/* 侧栏用：带级名的完整上级链（第1团 → 第3连 → 第2排 → 第1班） */
function pathLabel(c) {
  const p = c.path || [];
  const names = p.map(e => String((e && e.name) || '').trim()).filter(Boolean);
  return names.length ? names.join(' → ') : '—';
}
function clipText(ctx, text, maxW) {
  const wOf = (s) => {
    try {
      const m = ctx.measureText(s);
      return (m && typeof m.width === 'number') ? m.width : String(s).length * 6;
    } catch (e) { return String(s).length * 6; }
  };
  if (wOf(text) <= maxW) return text;
  let t = text;
  while (t.length > 1 && wOf(t + '…') > maxW) t = t.slice(0, -1);
  return t + '…';
}

/* ============================================================
   ★ R10.19：阵亡可视化 —— 尸体黑点
   ------------------------------------------------------------
   玩家："可以在六角格内生成一个黑点之类的模拟尸体"
   · 位置用"棋子 id + 已有点数"做种子 ⇒ 每次重画都在同一处（不闪），不同棋子不重叠；
   · 存在棋子自己的 `corpses[]` 里（世界坐标偏移，单位米）⇒ 跟着棋子走、撤销能回滚。
   ============================================================ */
function addCorpses(c, k) {
  if (!c || !(k > 0)) return;
  if (!c.corpses) c.corpses = [];
  const base = String(c.id || 'c').split('')
    .reduce((a, ch) => a + ch.charCodeAt(0), 0) * 37;
  for (let i = 0; i < k; i++) {
    const seed = base + (c.corpses.length + i + 1) * 9301;
    const ang = (seed % 360) * Math.PI / 180;
    const rad = HEX_EDGE * (0.16 + ((seed >> 3) % 55) / 100);
    c.corpses.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
  }
}

function drawCorpses(ctx, r) {
  if (r < 3.5) return;
  for (const c of W.counters) {
    if (!c.corpses || !c.corpses.length || !c.hex) continue;
    const hp = w2s(c.hex.x, c.hex.y);
    for (const b of c.corpses) {
      const x = hp.x + b.x * W.cam.k;
      const y = hp.y + b.y * W.cam.k;
      const rr = Math.max(1.1, 7 * W.cam.k);
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,12,16,.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(127,29,29,.95)';
      ctx.lineWidth = Math.max(0.5, rr * 0.34);
      ctx.stroke();
    }
  }
}

function drawCounters(ctx, r) {
  const showLabel = r > 10;
  for (const c of W.counters) {
    const pos = c.animPos || c.hex;      // 移动动画期间用插值位置
    if (!pos) continue;
    const p = w2s(pos.x, pos.y);
    if (p.x < -90 || p.y < -90 || p.x > cssW() + 90 || p.y > cssH() + 90) continue;
    const col = SIDE_COLOR[c.side] || SIDE_COLOR.blue;
    const node = c.node || {};
    const s = Math.max(4, r * 0.92);          // 兵牌边长（玩家：再缩小 0.2 左右）
    const x0 = p.x - s / 2, y0 = p.y - s / 2;
    const bw = s, bh = s;
    ctx.save();
    ctx.globalAlpha = c.dead ? 0.3 : (c.acted ? 0.58 : 1);
    if (c.dead) { try { ctx.filter = 'grayscale(1) brightness(.85)'; } catch (e) {} }

    /* 兵牌本体：兵牌库原图（SVG → 图片）。
       ★ 不再铺任何底色 —— 玩家："边框太厚了，都超出格子了，这个底色直接移除掉" */
    const img = wgSymbolImage(node.type || c.type, node.echelon || c.echelon,
                              node.custom, col.ink);
    if (img && img.loaded) {
      ctx.drawImage(img, x0, y0, s, s);
    } else {
      roundRect(ctx, x0, y0, s, s, Math.max(1, r * 0.06));
      ctx.fillStyle = '#dce8f7';
      ctx.fill();
      ctx.strokeStyle = col.ink || '#0a3d91';
      ctx.lineWidth = Math.max(0.8, r * 0.05);
      ctx.stroke();
    }
    if (c.dead) { try { ctx.filter = 'none'; } catch (e) {} }

    /* 兵种图标 / 梯队标记 / 人数都已在兵牌图里（buildSymbol 画的），这里不再重画 */
    /* 压制 */
    if (c.suppressed && !c.dead) {
      roundRect(ctx, x0 - 1, y0 - 1, bw + 2, bh + 2, Math.max(1, r * 0.1));
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = '#fcd34d';
      ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    /* 选中 / 目标 */
    if (W.sel === c) {
      roundRect(ctx, x0 - 1.5, y0 - 1.5, bw + 3, bh + 3, Math.max(1, r * 0.12));
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = Math.max(1.5, r * 0.09);
      ctx.stroke();
    }
    if (W.target === c) {
      roundRect(ctx, x0 - 2, y0 - 2, bw + 4, bh + 4, Math.max(1, r * 0.14));
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = Math.max(1.5, r * 0.1);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* ④ 番号：北约式层级链（旅/团 → 连 → 排 → 班），写在兵牌下方；★ 不再带人数/装备数 */
    if (showLabel && !c.dead) {
      const fs = Math.max(7, Math.min(12, r * 0.34));
      ctx.font = '700 ' + fs + 'px system-ui, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      const txt = clipText(ctx, counterDesignation(c), s * 3.6);
      const ty = p.y + s / 2 + Math.max(1, fs * 0.28);
      ctx.lineWidth = Math.max(2, fs * 0.32);
      ctx.strokeStyle = 'rgba(8,14,26,.92)';
      ctx.strokeText(txt, p.x, ty);
      ctx.fillStyle = col.text;
      ctx.fillText(txt, p.x, ty);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }
}

/* ============================================================
   5) 交互
   ============================================================ */
function bindUI() {
  $('wg-start').addEventListener('click', startGame);
  $('wg-end').addEventListener('click', endTurn);
  /* ★ R10.16：撤回上一步（按钮 + Ctrl+Z） */
  const undoBtn = $('wg-undo');
  if (undoBtn) undoBtn.addEventListener('click', () => undoLast());
  /* ★ R10.20 / R10.21：临机射击开关 + 音效开关 */
  const oppBtn = $('wg-opp');
  if (oppBtn) oppBtn.addEventListener('click', () => {
    W.oppOn = (W.oppOn === false);
    refreshOppBtn();
    pushLog('t', '临机射击：' + (W.oppOn ? '开（敌人移动进入视线+射程会自动挨打）' : '关'));
  });
  const sfxBtn = $('wg-sfx');
  if (sfxBtn) sfxBtn.addEventListener('click', () => {
    if (typeof Sfx !== 'undefined') Sfx.toggle();
    refreshSfxBtn();
  });
  /* ★ R10.23：部署模式 / 显示模式 / 一键部署 / 部署完成 / 目标面板 */
  const modeSel = $('wg-mode');
  if (modeSel) modeSel.addEventListener('change', () => {
    const wrap = $('wg-defender-wrap');
    if (wrap) wrap.classList.toggle('hidden', modeSel.value !== 'attack');
  });
  const viewBtn = $('wg-view');
  if (viewBtn) viewBtn.addEventListener('click', cycleView);
  const autoBtn = $('wg-auto');
  if (autoBtn) autoBtn.addEventListener('click', () => autoDeployAll());
  const okBtn = $('wg-deploy-ok');
  if (okBtn) okBtn.addEventListener('click', () => askFinishDeploySide());
  const depBox = $('wg-deploy');
  if (depBox) depBox.addEventListener('click', onDeployChipClick);
  const goalBox = $('wg-goals');
  if (goalBox) goalBox.addEventListener('change', onGoalChange);
  refreshOppBtn();
  refreshSfxBtn();
  /* 表格窗（可拖动）：完整距离火力表 + 三张 CRT */
  const sheetBtn = $('wg-sheet-btn');
  if (sheetBtn) sheetBtn.addEventListener('click', () => toggleSheet());
  const sheetClose = $('wg-sheet-close');
  if (sheetClose) sheetClose.addEventListener('click', () => toggleSheet(true));
  bindSheetDrag();
  $('wg-zoom-in').addEventListener('click', () => { zoomAt(cssW() / 2, cssH() / 2, 1.25); render(); });
  $('wg-zoom-out').addEventListener('click', () => { zoomAt(cssW() / 2, cssH() / 2, 0.8); render(); });
  $('wg-fit').addEventListener('click', () => { fitCamera(); render(); });

  const pts = new Map();
  let drag = null, pinch = null, pinched = false;

  cv.addEventListener('pointerdown', e => {
    if (e.button === 2) return;
    if (pts.size === 0) pinched = false;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = Array.from(pts.values());
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: W.cam.k };
      pinched = true;                 // 双指手势之后不要误判成"点了一下"
      drag = null;
      return;
    }
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, cx: W.cam.x, cy: W.cam.y, moved: false };
  });

  cv.addEventListener('pointermove', e => {
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    /* 双指缩放 */
    if (pts.size === 2 && pinch) {
      const [a, b] = Array.from(pts.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.d > 4) {
        const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
        const target = Math.max(0.03, Math.min(4, pinch.k * (d / pinch.d)));
        zoomAt(mid.x, mid.y, target / W.cam.k);
        render();
      }
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      W.cam.x = drag.cx - dx / W.cam.k;
      W.cam.y = drag.cy - dy / W.cam.k;
      render();
      return;
    }
    if (!W.hx) return;
    const wh = s2w(mx, my);
    const h = hexOfWorld(W.hx, wh.x, wh.y);
    if (h !== W.hover) { W.hover = h; render(); }
  });

  const endPointer = (e) => {
    const wasDrag = drag && drag.moved;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    drag = null;
    if (wasDrag || pts.size > 0 || pinched) return;
    if (e.type === 'pointercancel') return;
    const rect = cv.getBoundingClientRect();
    onLeftClick(e.clientX - rect.left, e.clientY - rect.top);
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);

  cv.addEventListener('contextmenu', e => { e.preventDefault(); deselect(); });

  /* ★ R10.39：从文件导入编制 / 地图 */
  const impA = $('wg-import-army');
  if (impA) impA.addEventListener('click', () => importArmyFromFile());
  const impM = $('wg-import-map');
  if (impM) impM.addEventListener('click', () => importMapFromFile());

  /* ★ R10.38：手机端右侧面板抽屉开关（桌面没有这个按钮） */
  const sideBtn = $('wg-side-toggle');
  if (sideBtn) {
    sideBtn.addEventListener('click', () => {
      const open = document.body.classList.toggle('wg-side-open');
      sideBtn.classList.toggle('active', open);
    });
  }


  /* ★ R10.36：选中面板里的「🏗 修建碉堡」（面板 innerHTML 每次重画 ⇒ 用事件委托） */
  const selBox = $('wg-sel');
  if (selBox) {
    selBox.addEventListener('click', e => {
      const btn = (e.target && e.target.closest) ? e.target.closest('#wg-build') : null;
      if (btn) { e.preventDefault(); startBuild(); }
    });
  }

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 0.89);
    render();
  }, { passive: false });

  window.addEventListener('keydown', e => {
    /* ★ R10.16：Ctrl+Z 撤回上一步（输入框里按不算，别抢浏览器/输入法的撤销） */
    const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undoLast();
      return;
    }
    if (e.key === 'Escape') { deselect(); }
    else if (e.code === 'Space' && W.running) { e.preventDefault(); endTurn(); }
  });
}

/* 部署清单里点一个棋子 ⇒ 选中/取消（再点棋盘落子） */
function onDeployChipClick(e) {
  const st = W.deploy;
  if (!st || !e || !e.target) return;
  const el = (e.target.closest) ? e.target.closest('.dep-chip') : null;
  if (!el || !el.getAttribute) return;
  const id = el.getAttribute('data-cid');
  const c = st.bench[st.side].find(x => String(x.id) === String(id)) || null;
  st.sel = (st.sel === c) ? null : c;
  refreshPanels();
  render();
}
/* 胜利目标下拉/数字框改动（只在部署阶段可改） */
function onGoalChange(e) {
  if (W.phase !== 'deploy' || !W.deploy) return;
  const el = e && e.target;
  if (!el || !el.getAttribute) return;
  const side = el.getAttribute('data-goal-side');
  const field = el.getAttribute('data-goal-field');
  if (!side || !field || !W.goals || !W.goals[side]) return;
  const g = W.goals[side];
  if (field === 'kind') {
    g.kind = (el.value === 'capture' || el.value === 'hold') ? el.value : 'annihilate';
    if (g.kind !== 'annihilate' && (g.obj == null || (g.obj | 0) < 0)) g.obj = 0;
    if (g.kind === 'hold' && !((g.turns | 0) > 0)) g.turns = 10;
  } else if (field === 'obj') {
    g.obj = Math.max(0, el.value | 0);
  } else if (field === 'turns') {
    g.turns = Math.max(1, Math.min(WG_MAX_TURN, (el.value | 0) || 10));
  } else return;
  pushLog('t', '🎯 ' + sideName(side) + ' 目标：' + goalLabel(g));
  refreshPanels();
}

function pickAt(mx, my) {
  if (!W.hx) return null;
  const wh = s2w(mx, my);
  const h = hexOfWorld(W.hx, wh.x, wh.y);
  if (!h) return null;
  const list = countersAt(W.counters, h);
  if (!list.length) return null;
  return list[0];
}

function onLeftClick(mx, my) {
  if (!W.running || !W.hx || W.anim) return;   // 动画期间不接受点击，避免命令打架
  /* ★ R10.23：部署阶段走另一条流程（手动摆棋子），开打后才走"选中/移动/开火" */
  if (W.phase === 'deploy') { onDeployClick(mx, my); return; }
  if (W.phase !== 'play') return;
  const wh = s2w(mx, my);
  const h = hexOfWorld(W.hx, wh.x, wh.y);
  if (!h) { deselect(); return; }
  const c = pickAt(mx, my);

  if (c) {
    /* 已选本方棋子 → 点敌方 = 开火判定 */
    if (W.sel && W.sel.side === W.side && !W.sel.dead && c.side !== W.side) {
      openFirePreview(W.sel, c);
      return;
    }
    selectCounter(c);
    return;
  }
  /* 空地：点白雾格 = 移动；点别处只取消选中（原来还有"开火模式"开关，现在纯点击，已删） */
  if (W.sel && W.sel.side === W.side) {
    const isSelf = W.sel.hex && W.sel.hex.col === h.col && W.sel.hex.row === h.row;
    if (W.reach && !isSelf && W.reach.has(hexKey(h))) {
      moveSelected(h);
      return;
    }
  }
  deselect();
}

function deselect() {
  W.sel = null; W.target = null; W.reach = null; W.fire = null;
  if (W.deploy) W.deploy.sel = null;       // ★ R10.23：部署阶段也一起取消选中
  refreshPanels();
  render();
}

function selectCounter(c) {
  W.sel = c;
  W.target = null;
  W.fire = null;
  W.reach = null;
  if (c && !c.dead && c.side === W.side && !c.acted) {
    const zoc = zocKeysFor(W.hx, W.counters, W.side);
    const r = hexReachable(W.hx, c.hex, c.mp, c.mpType, zoc);
    W.reachCame = r.came;                 // ★ 父指针留着：点目标格时回溯出"走哪条路"
    const out = new Map();
    for (const [key, cost] of r.cost) {
      const col = key % 10000, row = Math.floor(key / 10000);
      const h = hexAt(W.hx, col, row);
      if (!h) continue;
      if (countersAt(W.counters, h).length) continue;   // 一格只站一个（先保持简单）
      out.set(key, cost);
    }
    W.reach = out;
  } else {
    W.reachCame = null;
  }
  refreshPanels();
  render();
}

/* 回溯"从哪条路走过来的"：came 是 hexReachable 的父指针（hexKey → 父格） */
function buildPath(hx, came, from, to) {
  if (!from || !to) return [];
  if (!came || (from.col === to.col && from.row === to.row)) return [from, to];
  const out = [];
  let cur = to, guard = 0;
  while (cur && guard++ < 4096) {
    out.push(cur);
    if (cur.col === from.col && cur.row === from.row) break;
    cur = came.get(hexKey(cur));
  }
  out.reverse();
  /* 回溯失败 ⇒ 退化成直线，别把棋子卡在原地 */
  if (!out.length || out[0].col !== from.col || out[0].row !== from.row) return [from, to];
  return out;
}

/* 真正落子（动画播完时调用；关掉动画时立刻调用） */
function applyMove(c, h, cost) {
  c.animPos = null;
  c.hex = h;
  c.mp = Math.max(0, c.mp - cost);
  c.acted = 'move';                 // ★ 移动/攻击二选一：走完就不能再攻击
  const cls = c.side === 'blue' ? 'blue' : 'red';
  if (h.terr === 'trench' || h.terr === 'house' || h.terr === 'forest') {
    pushLog(cls, c.name + ' 进入「' + h.terr + '」掩体');
  }
  /* ★ R10.36：进驻 —— 敌方碉堡自动炸毁 / 自家碉堡与中立建筑给掩体 */
  bunkerOnEnter(c, h);
  selectCounter(c);
  pushLog(cls, c.name + ' 移动 (' + h.col + ',' + h.row + ') 花费 ' + cost +
               '，剩 ' + c.mp + ' MP');
}

/* ============================================================
   ★ R10.20：临机射击（执行）
   ------------------------------------------------------------
   判定/筛选在 hex-core 的 opportunityShotFor / opportunityTriggers（纯函数）；
   这里只负责"掷骰 → 结算 → 特效 → 战报 → 尸体"。
   `atHex` = 目标**当前所在的格**（移动途中，不是终点）——
   地形修正（FLV_TERR_PENALTY）按这一格算，所以用 ghost 副本喂给 resolveFire，
   真正挨打的还是原棋子（`applyFireResult` 只改它）。
   ============================================================ */
const OPP_HOLD_MS = 320;          // 每发临机射击让移动动画"停一下"

function opFire(shooter, mover, atHex) {
  const chk = opportunityShotFor(W.hx, shooter, atHex, mover.side, mover.kind);
  if (!chk) return null;
  const ghost = Object.assign({}, mover, { hex: atHex });
  const roll = roll2d6();
  const res = resolveFire(W.hx, shooter, ghost,
    { roll, kind: chk.kind, flvPenalty: OPP_FIRE_FLV_PENALTY,
      bld: bldAt(W.bld, atHex) });        // ★ R10.36：路过建筑/碉堡也算掩体
  const eff = applyFireResult(res, shooter, mover);
  /* ★ R10.22：临机射击同样消耗弹药 */
  const usedAmmo = consumeAmmo(shooter, res.dist, res.kind);
  sfxFire(chk.kind);
  W.fx.push({
    kind: 'shot',
    a: { x: shooter.hex.x, y: shooter.hex.y },
    b: { x: atHex.x, y: atHex.y },
    t0: nowMs(), dur: SHOT_MS, code: res.code,
  });
  W.overlay.push({
    hex: atHex, text: res.code,
    color: res.code === '—' ? '#94a3b8' : (res.code === 'S' ? '#fcd34d' : '#f87171'),
    t0: Date.now(),
  });
  pushLog(shooter.side === 'blue' ? 'blue' : 'red',
    '⚡ ' + shooter.name + ' 临机射击 → ' + mover.name + '　2D6=' + res.roll +
    ' · FLV ' + res.flv + ' ⇒ ' + res.code + '（' + res.label + '）');
  if (res.notes.length) pushLog('t', '　' + res.notes.join('；'));
  if (usedAmmo.length) {
    pushLog('t', '　🧨 消耗 ' + usedAmmo.map(a => a.name + ' 1 发（剩 ' + a.left + '）').join('、'));
    const dryA = usedAmmo.filter(a => a.left <= 0);
    if (dryA.length) pushLog('hl', '　⚠ ' + dryA.map(a => a.name).join('、') + ' 弹药耗尽');
  }
  if (eff.killed) {
    addCorpses(mover, eff.killed);
    pushLog('hl', '　' + mover.name + ' 阵亡 ' + eff.killed + ' 人，剩 ' + counterMen(mover) + ' 人');
  }
  if (eff.destroyed) pushLog('hl', '　💥 ' + mover.name + ' 在移动中被击毁');
  if (eff.suppressed) pushLog('hl', '　⚠ ' + mover.name + ' 被压制（下回合火力减半）');
  if (eff.mpCut) pushLog('hl', '　' + mover.name + ' 机动损坏（MP 减半）');
  if (eff.wpnCut) pushLog('hl', '　' + mover.name + ' 武器损坏（火力减半）');
  refreshPanels();
  return res;
}

function moveSelected(h) {
  if (W.anim) return;                        // 动画期间不接受新命令
  const c = W.sel;
  if (!c || !W.reach) return;
  const cost = W.reach.get(hexKey(h));
  if (!isFinite(cost)) return;
  pushUndo();                                // ★ R10.16：走之前存快照（位置/MP/行动权）
  const path = buildPath(W.hx, W.reachCame, c.hex, h);
  /* ★ R10.20：先算好"路上会吃到哪些临机射击"（纯函数，一次算完） */
  const trig = (W.oppOn === false) ? [] : opportunityTriggers(W.hx, W.counters, c, path, c.side);
  if (!canAnimate()) {
    /* 关动画（离线冒烟/低配机）：按顺序当场结算，再落子 */
    let at = path[path.length - 1];
    for (const tr of trig) {
      if (c.dead) break;
      at = path[tr.step] || at;
      opFire(tr.shooter, c, at);
    }
    if (c.dead) {
      c.animPos = null; c.hex = at; c.acted = 'move';
      pushLog('hl', '💀 ' + c.name + ' 在移动途中被消灭（' + at.col + ',' + at.row + '）');
      refreshPanels(); render();
      return;
    }
    applyMove(c, h, cost);
    return;
  }
  W.reach = null;                            // 动画期间收起白雾
  W.anim = { kind: 'move', c, path, cost, t0: nowMs(), seg: MOVE_SEG_MS,
             trig: trig.slice(), hold: 0 };
  sfxMove(c.mpType);
  render();
  kickAnim();
}

function drawOverlayText(ctx) {
  const now = Date.now();
  W.overlay = W.overlay.filter(o => now - o.t0 < 1600);
  for (const o of W.overlay) {
    const age = (now - o.t0) / 1600;
    const p = w2s(o.hex.x, o.hex.y);
    ctx.save();
    ctx.globalAlpha = 1 - age * age;
    ctx.fillStyle = o.color;
    ctx.font = '900 ' + Math.round(13 + 6 * (1 - age)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(o.text, p.x, p.y - HEX_EDGE * W.cam.k * (0.5 + age * 0.7));
    ctx.restore();
  }
}

/* ============================================================
   4b) 动画引擎
   ------------------------------------------------------------
   回合制平时**不跑循环**（省电），只有"移动 / 开火"时才启一次 rAF，
   播完自动停。W.motion = false 时全部同步完成（离线冒烟测试用）。
   ============================================================ */
const MOVE_SEG_MS = 150;     // 每走一格用时
const TRAIL_MS = 1100;       // 走完后的路径残影
const SHOT_MS = 460;         // 开火曳光

let _rafId = 0;

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
}
function canAnimate() {
  return W.motion !== false && (typeof requestAnimationFrame === 'function');
}
function kickAnim() {
  if (_rafId || !canAnimate()) return;
  _rafId = requestAnimationFrame(animFrame);
}
function animFrame(ts) {
  _rafId = 0;
  const busy = stepAnim(ts);
  render();
  if (busy) _rafId = requestAnimationFrame(animFrame);
}
/* 推进一帧；返回 true = 还有动画要跑 */
function stepAnim(ts) {
  let busy = false;
  const a = W.anim;
  if (a && a.kind === 'move') {
    const n = Math.max(1, a.path.length - 1);
    const seg = a.seg || MOVE_SEG_MS;
    /* ★ R10.20：临机射击时"停一下"——把动画起点往后推，视觉上就是队伍定住挨打 */
    if (a.hold > 0) {
      const dt = Math.max(0, ts - (a._ts || ts));
      a._ts = ts;
      const use = Math.min(a.hold, dt);
      a.t0 += use;
      a.hold -= use;
    } else {
      a._ts = ts;
    }
    const t = Math.max(0, ts - a.t0);

    /* ★ R10.20：走到某个触发点时结算临机射击（一帧内可能连打几发，每发各停 320ms） */
    if (a.trig && a.trig.length && !a.c.dead) {
      while (a.trig.length && (a.trig[0].step * seg) <= t) {
        const tr = a.trig.shift();
        if (a.c.dead) break;
        opFire(tr.shooter, a.c, a.path[tr.step]);
        a.hold = (a.hold || 0) + OPP_HOLD_MS;
        if (a.c.dead) break;
      }
      if (a.c.dead) {
        /* 半路被打死：就地停下（别把它"拖"到终点） */
        const at = a.path[Math.min(n, Math.floor(t / seg) + 1)] || a.c.hex;
        W.anim = null;
        a.c.animPos = null;
        a.c.hex = at;
        a.c.acted = 'move';
        pushLog('hl', '💀 ' + a.c.name + ' 在移动途中被消灭（' + at.col + ',' + at.row + '）');
        refreshPanels();
      }
    }

    if (W.anim === a) {                      // 还活着 ⇒ 继续走
      if (t >= n * seg) {
        const goal = a.path[a.path.length - 1];
        W.anim = null;
        W.fx.push({
          kind: 'trail',
          pts: a.path.map(h => ({ x: h.x, y: h.y })),
          t0: nowMs(), dur: TRAIL_MS,
        });
        applyMove(a.c, goal, a.cost);        // 落子：扣 MP、写日志、重算可移动范围
      } else {
        const k = t / seg;
        const i0 = Math.min(n - 1, Math.floor(k));
        const f = Math.min(1, k - i0);
        const A = a.path[i0], B = a.path[i0 + 1];
        a.c.animPos = { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f };
        a.done = k;
        busy = true;
      }
    }
  }
  const now = nowMs();
  if (W.fx.length) {
    W.fx = W.fx.filter(o => now - o.t0 < o.dur);
    if (W.fx.length) busy = true;
  }
  return busy;
}

/* ---------- 画：移动中的路径（走到哪、还剩几格） ---------- */
function drawMovePath(ctx, r) {
  const a = W.anim;
  if (!a || a.kind !== 'move') return;
  const pts = a.path.map(h => w2s(h.x, h.y));
  const last = pts[pts.length - 1];
  ctx.save();
  ctx.lineCap = 'round';
  /* 整条路：暗金底线（"就是从这条走的"） */
  ctx.strokeStyle = 'rgba(251,191,36,.45)';
  ctx.lineWidth = Math.max(2.5, r * 0.14);
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke();
  /* 尚未走完：亮金虚线 */
  ctx.setLineDash([Math.max(4, r * 0.42), Math.max(3, r * 0.3)]);
  ctx.strokeStyle = 'rgba(253,224,71,.98)';
  ctx.lineWidth = Math.max(1.6, r * 0.08);
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);
  /* 终点圈：告知"要停在这里" */
  ctx.beginPath();
  ctx.arc(last.x, last.y, Math.max(3, r * 0.28), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(253,224,71,.98)';
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.stroke();
  ctx.restore();
}

/* ---------- 画：一次性特效（路径残影 / 开火曳光） ----------
   layer = 'under'（在棋子下面）| 'over'（在棋子上面） */
function drawFx(ctx, r, layer) {
  const now = nowMs();
  for (const o of W.fx) {
    const age = Math.min(1, (now - o.t0) / o.dur);
    if (o.kind === 'trail' && layer === 'under') {
      const pts = o.pts.map(p => w2s(p.x, p.y));
      const last = pts[pts.length - 1];
      ctx.save();
      ctx.globalAlpha = (1 - age) * 0.85;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = Math.max(1.8, r * 0.09);
      ctx.setLineDash([Math.max(4, r * 0.38), Math.max(3, r * 0.26)]);
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(last.x, last.y, Math.max(3, r * 0.26), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (o.kind === 'shot' && layer === 'over') {
      const a = w2s(o.a.x, o.a.y), b = w2s(o.b.x, o.b.y);
      ctx.save();
      ctx.lineCap = 'round';
      /* 曳光：前 35% 飞过去，之后停在弹着点 */
      const fly = Math.min(1, age / 0.35);
      const hx = a.x + (b.x - a.x) * fly, hy = a.y + (b.y - a.y) * fly;
      ctx.globalAlpha = 1 - age * 0.7;
      ctx.strokeStyle = 'rgba(255,240,170,.95)';
      ctx.lineWidth = Math.max(1.5, r * 0.09);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      /* 弹着：扩散的圆环（无效果 = 灰环，有战果 = 红环 + 内圈） */
      if (fly >= 1) {
        const rr = Math.max(4, r * 0.3) + age * r * 0.9;
        ctx.globalAlpha = (1 - age) * 0.9;
        ctx.strokeStyle = (o.code === '—') ? '#94a3b8' : '#f87171';
        ctx.lineWidth = Math.max(1.6, r * 0.1);
        ctx.beginPath();
        ctx.arc(b.x, b.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        if (o.code !== '—' && o.code !== 'S') {
          ctx.beginPath();
          ctx.arc(b.x, b.y, rr * 0.45, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
}

/* ============================================================
   4c) 掷骰过程（2D6）
   ------------------------------------------------------------
   点数在**点「开火」的那一刻**就定好了（roll2d6），动画只是把它演出来：
   两颗骰子乱跳 700ms → 落定 → 显示 a + b = 总和 → 关闭 → 结算。
   W.motion = false（离线冒烟）时不留任何异步，直接结算。
   ============================================================ */
const DIE_DOTS = [
  [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8],
];
function renderDie(id, v) {
  const el = $(id);
  if (!el) return;
  const dots = DIE_DOTS[Math.max(1, Math.min(6, v)) - 1] || [];
  let html = '';
  for (let i = 0; i < 9; i++) {
    html += '<b class="' + (dots.indexOf(i) >= 0 ? 'on' : '') + '"></b>';
  }
  el.innerHTML = html;
}
/* 把 2D6 拆成两颗骰子（在合法范围内随机拆，保证两个 1~6） */
function splitRoll(roll) {
  const lo = Math.max(1, roll - 6), hi = Math.min(6, roll - 1);
  const a = lo + Math.floor(Math.random() * (hi - lo + 1));
  return [a, roll - a];
}
function showDice(roll, done) {
  const box = $('wg-dice');
  if (!box || W.motion === false || typeof setInterval !== 'function') { done(); return; }
  const sumEl = $('wg-dice-sum'), tipEl = $('wg-dice-tip');
  box.classList.remove('hidden');
  if (sumEl) sumEl.textContent = '…';
  if (tipEl) tipEl.textContent = '掷 2D6';
  let t = 0;
  const timer = setInterval(() => {
    renderDie('wg-die1', 1 + Math.floor(Math.random() * 6));
    renderDie('wg-die2', 1 + Math.floor(Math.random() * 6));
    t += 70;
    if (t < 700) return;
    clearInterval(timer);
    const ab = splitRoll(roll);
    renderDie('wg-die1', ab[0]);
    renderDie('wg-die2', ab[1]);
    if (sumEl) sumEl.textContent = ab[0] + ' + ' + ab[1] + ' = ' + roll;
    if (tipEl) tipEl.textContent = '查表…';
    setTimeout(() => {
      box.classList.add('hidden');
      done();
    }, 480);
  }, 70);
}

/* ============================================================
   4d) 可拖动的表格窗：**完整**距离火力表 + 三张 CRT
   ------------------------------------------------------------
   玩家："将完整距离火力表和 CRT 表格使用可拖动弹窗的形式完整显示出来"
        "距离火力表中的距离需要做长一点（坦克射程很高，500m 都看不出衰减）"
   ⇒ 射程不再截断，1..R 格全部列出（含米数、是否超出本图）。
   ============================================================ */
function flvCellClass(v) {
  if (v == null) return 'none';
  return v >= 9 ? 'v9' : (v >= 5 ? 'v5' : '');
}
function flvTableHtml(c) {
  /* ★ R10.12：射程 = 直射与间瞄取大者；有炮就多一列「炮击 FLV」（art 表，不看视线） */
  const rng = Math.max(1, counterMaxRangeHex(c));
  const artRng = counterArtRangeHex(c);
  const diag = Math.ceil(Math.hypot(W.hx ? W.hx.cols : 1, W.hx ? W.hx.rows : 1));
  let h = '<h4>距离火力表 · ' + esc(counterDesignation(c, true)) + '</h4>';
  h += '<div class="legend">射程 ' + rng + ' 格（' + (rng * HEX_EDGE) + ' m）' +
       (artRng > 0 ? '｜炮击 ' + artRng + ' 格（间瞄）' : '') + '｜' +
       '「—」= 该距离已衰减到打不到｜灰行 = 超出本图（对角约 ' + diag + ' 格）</div>';
  h += '<table class="flv-full"><tr><th>距离(格)</th><th>距离(m)</th>' +
       '<th>对人员 FLV</th><th>反装甲 FLV</th>' +
       (artRng > 0 ? '<th>炮击 FLV</th>' : '') + '<th>本图</th></tr>';
  for (let d = 1; d <= rng; d++) {
    const soft = flvAt(c, d, 'soft');
    const hard = flvAt(c, d, 'hard');
    const art = artRng > 0 ? flvAt(c, d, 'art') : null;
    const off = d > diag;
    h += '<tr' + (off ? ' class="off"' : '') + '>' +
         '<td>' + d + '</td>' +
         '<td>' + (d * HEX_EDGE) + '</td>' +
         '<td class="' + flvCellClass(soft) + '">' + (soft == null ? '—' : soft) + '</td>' +
         '<td class="' + flvCellClass(hard) + '">' + (hard == null ? '—' : hard) + '</td>' +
         (artRng > 0 ? '<td class="' + flvCellClass(art) + '">' + (art == null ? '—' : art) + '</td>' : '') +
         '<td>' + (off ? '超出' : '·') + '</td></tr>';
  }
  h += '</table>';
  return h;
}
function crtTableHtml(kind) {
  const names = {
    soft: '反人员 CRT —— — / S / K（毙 1）/ 2K（毙 2）/ 3K（毙 3）',
    at: '反装甲 CRT —— — / S / Km（机动坏）/ Kf（武器坏）/ K（击毁）',
    art: '炮击 CRT —— — / S / K / 2K / 3K',
  };
  let h = '<h4>' + names[kind] + '</h4><table class="crt"><tr><th>FLV＼2D6</th>';
  for (let r = 2; r <= 12; r++) {
    h += '<th' + (r === 7 ? ' class="roll7"' : '') + '>' + r + '</th>';
  }
  h += '</tr>';
  for (let flv = 12; flv >= 1; flv--) {
    h += '<tr><th>' + flv + '</th>';
    for (let r = 2; r <= 12; r++) {
      const code = crtLookup(kind, flv, r);
      const cls = (code === '—') ? 'c0'
        : (code === 'S') ? 'c1'
        : ((code === '2K' || code === '3K' || code === 'Kf') ? 'c3' : 'c2');
      h += '<td class="' + cls + '">' + code + '</td>';
    }
    h += '</tr>';
  }
  return h + '</table>';
}
function renderSheet() {
  const body = $('wg-sheet-body');
  if (!body) return;
  let h = '';
  if (W.sel) h += flvTableHtml(W.sel);
  else h += '<h4>距离火力表</h4><div class="legend">先点一个棋子 —— 这里会列出它的**全部射程**' +
            '（格数 → 米 → 对人员/反装甲 FLV，一直列到衰减到打不到为止）。</div>';
  h += '<div class="sep"></div>';
  h += crtTableHtml('soft');
  h += crtTableHtml('at');
  h += crtTableHtml('art');
  /* ★ R10.11：三张表已整体向下平移一格 ⇒ 列出来提醒玩家，别以为 FLV 1 还是走个过场 */
  h += '<div class="legend">三张 CRT 已整表向下平移一格（FLV 1 也有战果：对人员/炮击 11~12 压制，' +
       '反装甲 12 点打坏机动）；「—」= 无效果。</div>';
  body.innerHTML = h;
}
function toggleSheet(force) {
  const el = $('wg-sheet');
  if (!el) return;
  const hidden = (force === true) ? true
    : (force === false) ? false
    : !el.classList.contains('hidden');
  el.classList.toggle('hidden', hidden);
  if (!hidden) renderSheet();
}
/* 拖动标题栏移动窗口 */
function bindSheetDrag() {
  const box = $('wg-sheet'), head = $('wg-sheet-drag');
  if (!box || !head) return;
  let drag = null;
  head.addEventListener('pointerdown', e => {
    if (e.target && e.target.id === 'wg-sheet-close') return;
    const r = box.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    box.style.transform = 'none';
    if (head.setPointerCapture) head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', e => {
    if (!drag) return;
    const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
    const x = Math.max(0, Math.min(vw - 180, e.clientX - drag.dx));
    const y = Math.max(0, Math.min(vh - 64, e.clientY - drag.dy));
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
  });
  const stop = () => { drag = null; };
  head.addEventListener('pointerup', stop);
  head.addEventListener('pointercancel', stop);
}

/* ============================================================
   6) 开火 / 回合 / 胜负
   ============================================================ */

/* ============================================================
   ★ R10.16：**撤回上一步**（按钮「↶ 撤回」+ Ctrl+Z）
   ------------------------------------------------------------
   为什么用**快照**而不是"反向操作"：一次炮击会同时改
   落点上的伤亡 / 压制 / 车辆损坏 / mpMax / 行动权 / 日志 ——
   反向写一遍必然漏项，这正是 R10.9 / R10.10 那类"两个口径"bug 的温床。
   快照只存**会变的字段**（位置 / MP / 行动权 / 压制 / 损坏 / 伤亡 / 回合 / 日志长度），
   棋子里的 node、hex、武器对象都是"引用真相"，**不复制** —— 否则撤销后数值就分叉了。
   ============================================================ */
const WG_UNDO_MAX = 30;

function snapshotState() {
  return {
    side: W.side, turn: W.turn, running: W.running,
    logLen: W.log.length,
    lastFire: W.lastFire || null,
    counters: W.counters.map(c => ({
      id: c.id,
      col: c.hex ? c.hex.col : -1,
      row: c.hex ? c.hex.row : -1,
      mp: c.mp, mpMax: c.mpMax,
      acted: c.acted, fired: c.fired,
      suppressed: c.suppressed, dead: c.dead, km: c.km, kf: c.kf,
      alive: (c.members || []).map(m => !!m.alive),
      corpses: (c.corpses || []).length,          // ★ R10.19：尸体点数（撤销要一起回滚）
      ammo: c.ammo ? Object.assign({}, c.ammo) : null,   // ★ R10.22：弹药池
    })),
    /* ★ R10.36：建筑 / 碉堡（工地进度、被炸掉的碉堡）一起进快照 */
    bld: Array.from(W.bld || new Map(), e => [e[0], Object.assign({}, e[1])]),
  };
}

function pushUndo() {
  if (!W.hx) return;
  W.undo.push(snapshotState());
  if (W.undo.length > WG_UNDO_MAX) W.undo.shift();
  refreshUndoBtn();
}

function restoreState(s) {
  W.side = s.side;
  W.turn = s.turn;
  W.running = s.running;
  W.lastFire = s.lastFire || null;
  if (W.log.length > s.logLen) W.log.length = s.logLen;   // 把上一步的战报一起撤掉
  const byId = new Map(W.counters.map(c => [c.id, c]));
  for (const cs of s.counters) {
    const c = byId.get(cs.id);
    if (!c) continue;
    c.hex = (cs.col >= 0) ? hexAt(W.hx, cs.col, cs.row) : null;
    c.mp = cs.mp;
    c.mpMax = cs.mpMax;
    c.acted = cs.acted;
    c.fired = cs.fired;
    c.suppressed = cs.suppressed;
    c.dead = cs.dead;
    c.km = cs.km;
    c.kf = cs.kf;
    (c.members || []).forEach((m, i) => { m.alive = (cs.alive[i] !== false); });
    if (cs.corpses == null) { /* 老快照：不动 */ }
    else if (c.corpses && c.corpses.length > cs.corpses) c.corpses.length = cs.corpses;
    if (cs.ammo) c.ammo = Object.assign({}, cs.ammo);     // ★ R10.22：弹药回滚
    c.animPos = null;
  }
  W.sel = null; W.target = null; W.reach = null; W.fire = null;
  W.anim = null; W.fx = []; W.overlay = [];
  /* ★ R10.36：建筑 / 碉堡状态一起回滚（工地进度、被炸掉的碉堡都要回来） */
  if (s.bld) W.bld = new Map(s.bld.map(e => [e[0], Object.assign({}, e[1])]));
  /* ★ R10.23：部署阶段撤回 ⇒ 棋盘与"待部署清单"按快照重新对齐
     （快照里没有"这一手刚放下的棋子"，也不能漏掉"这一手刚收回的棋子"） */
  if (W.deploy) {
    const snap = new Map((s.counters || []).map(x => [x.id, x]));
    const st = W.deploy;
    /* ① 还在清单里、但快照说"当时已经放下" ⇒ 放回棋盘 */
    for (const side of ['blue', 'red']) {
      const bench = st.bench[side] || [];
      for (let i = bench.length - 1; i >= 0; i--) {
        const c = bench[i];
        const cs = snap.get(c.id);
        if (!cs || cs.col < 0) continue;
        const h = hexAt(W.hx, cs.col, cs.row);
        if (!h) continue;
        bench.splice(i, 1);
        c.hex = h;
        if (W.counters.indexOf(c) < 0) W.counters.push(c);
      }
    }
    /* ② 在棋盘上、但快照说"当时还没放下"（或快照里根本没它）⇒ 退回清单 */
    for (let i = W.counters.length - 1; i >= 0; i--) {
      const c = W.counters[i];
      const cs = snap.get(c.id);
      if (cs && cs.col >= 0 && c.hex) continue;
      W.counters.splice(i, 1);
      c.hex = null;
      const bench = st.bench[c.side];
      if (bench && bench.indexOf(c) < 0) bench.push(c);
    }
    st.sel = null;
  }
}

function undoLast() {
  if (!W.running || W.anim || !W.undo.length) return false;
  const s = W.undo.pop();
  restoreState(s);
  sfxUndo();
  pushLog('t', '↶ 已撤回上一步');
  pushLog('t', '—— 第 ' + W.turn + ' 回合 · ' + sideName(W.side) + ' ——');
  refreshPanels();
  render();
  refreshUndoBtn();
  return true;
}

function refreshUndoBtn() {
  const b = $('wg-undo');
  if (!b) return;
  b.disabled = !W.undo.length || !W.running;
  b.title = W.undo.length ? ('撤回上一步（Ctrl+Z）· 还可撤 ' + W.undo.length + ' 步')
                          : '没有可撤回的步骤（Ctrl+Z）';
}

/* ★ R10.20 / R10.21：两个开关按钮的状态 */
function refreshOppBtn() {
  const b = $('wg-opp');
  if (!b) return;
  const on = (W.oppOn !== false);
  if (b.classList) b.classList.toggle('active', on);
  b.title = on
    ? '自动临机射击：开（敌人移动经过你的视线+直射射程 ⇒ 自动打一发）'
    : '自动临机射击：关';
}
function refreshSfxBtn() {
  const b = $('wg-sfx');
  if (!b) return;
  const muted = (typeof Sfx !== 'undefined') ? Sfx.isMuted() : true;
  if (b.classList) b.classList.toggle('active', !muted);
  b.title = muted ? '音效已关（点开）' : '音效已开（点关）';
}

function openFirePreview(atk, def) {
  W.target = def;
  W.fire = { atk, def, sit: fireSituation(W.hx, atk, def) };
  refreshPanels();
  render();
}

/* 2D6 各结果的出现概率（不改变任何状态） */
function firePreviewDist(atk, def) {
  const dd = diceDist();
  const map = new Map();
  let flv = 1;
  for (let roll = 2; roll <= 12; roll++) {
    const res = resolveFire(W.hx, atk, def, { roll });
    flv = res.flv;
    map.set(res.code, (map.get(res.code) || 0) + dd[roll]);
  }
  return { flv, map };
}

function shortCode(code, kind) {
  if (code === '—') return '无效';
  if (code === 'S') return '压制';
  if (kind === 'at') return (code === 'K') ? '击毁' : (code === 'Km' ? '机动坏' : '武器坏');
  return code === 'K' ? '毙1人' : code === '2K' ? '毙2人' : '毙3人';
}

function doFire() {
  const f = W.fire;
  if (!f || !f.sit.ok || W.anim) return;
  const atk = f.atk, def = f.def;
  /* ★ 先把 2D6 掷出来（骰子动画只负责"演"这个过程），骰子落定后再结算 */
  const roll = roll2d6();
  W.anim = { kind: 'dice' };
  refreshPanels();
  showDice(roll, () => {
    W.anim = null;
    commitFire(atk, def, roll);
  });
}

/* 骰子落地之后：判定 → **落点（炮击可能散）** → 落结果 → 曳光特效 → 战报 */
function commitFire(atk, def, roll) {
  pushUndo();                                    // ★ R10.16：开火前存快照（含这一炮的伤亡）
  const aimRes = resolveFire(W.hx, atk, def, { roll, bld: bldAt(W.bld, def.hex) });
  /* ★ R10.15：炮击会散布 —— 落点可能是目标周围六格中的任意一格，
     杀伤按**落点上的棋子**重新结算；落点是空格 ⇒ 这一炮白打。 */
  let impactHex = def.hex, victim = def, scattered = false;
  if (aimRes.kind === 'art' && def.hex && W.hx) {
    const sc = artScatterHex(W.hx, def.hex);
    if (sc && (sc.col !== def.hex.col || sc.row !== def.hex.row)) {
      scattered = true;
      impactHex = sc;
      const there = countersAt(W.counters, sc).filter(c => !c.dead);
      victim = there.length ? there[0] : null;
    }
  }
  const res = (victim && victim !== def)
    ? resolveFire(W.hx, atk, victim, { roll, bld: bldAt(W.bld, victim.hex) })
    : aimRes;
  const eff = victim ? applyFireResult(res, atk, victim)
                     : { code: '—', killed: 0, suppressed: false,
                         destroyed: false, mpCut: false, wpnCut: false };
  /* ★ R10.22：消耗弹药（每件参与射击的有限武器各 1 发；步枪/机枪不计数） */
  const usedAmmo = consumeAmmo(atk, res.dist, res.kind);
  /* ★ R10.21：音效（软目标 = 枪声，硬目标 = 炮/枪，间瞄 = 爆炸） */
  sfxFire(res.kind);
  if (victim && eff.killed) addCorpses(victim, eff.killed);   // ★ R10.19：尸体黑点
  /* ★ 开火动画：射手 → **落点**的曳光 + 弹着圈（画在棋子上面） */
  W.fx.push({
    kind: 'shot',
    a: { x: atk.hex.x, y: atk.hex.y },
    b: { x: impactHex.x, y: impactHex.y },
    t0: nowMs(), dur: SHOT_MS, code: res.code,
  });
  kickAnim();
  atk.fired = true;
  atk.acted = 'fire';               // ★ 移动/攻击二选一：打完了就不能再走
  const cls = atk.side === 'blue' ? 'blue' : 'red';
  pushLog(cls, atk.name + ' → ' + def.name + '　2D6=' + res.roll + ' · FLV ' + res.flv +
               ' ⇒ ' + res.code + '（' + res.label + '）');
  if (scattered) {
    pushLog('t', '　🎯 炮击散布：落点 (' + impactHex.col + ',' + impactHex.row + ')' +
                 (victim ? ' → 命中 ' + victim.name + (victim.side === atk.side ? '（友军！）' : '') : ''));
  }
  if (!victim) pushLog('hl', '　落点没有目标 —— 这一炮白打');
  if (res.notes.length) pushLog('t', '　' + res.notes.join('；'));
  if (usedAmmo.length) {
    pushLog('t', '　🧨 消耗 ' + usedAmmo.map(a => a.name + ' 1 发（剩 ' + a.left + '）').join('、'));
    const dry = usedAmmo.filter(a => a.left <= 0);
    if (dry.length) pushLog('hl', '　⚠ ' + dry.map(a => a.name).join('、') + ' 弹药耗尽');
  }
  if (victim && eff.killed) pushLog('hl', '　' + victim.name + ' 阵亡 ' + eff.killed + ' 人，剩 ' + counterMen(victim) + ' 人');
  if (eff.destroyed) pushLog('hl', '　💥 ' + victim.name + ' 被击毁');
  if (eff.suppressed) pushLog('hl', '　⚠ ' + victim.name + ' 被压制（下回合火力减半）');
  if (eff.mpCut) pushLog('hl', '　' + victim.name + ' 机动损坏（MP 减半）');
  if (eff.wpnCut) pushLog('hl', '　' + victim.name + ' 武器损坏（火力减半）');
  W.overlay.push({
    hex: impactHex, text: res.code,
    color: res.code === '—' ? '#94a3b8' : (res.code === 'S' ? '#fcd34d' : '#f87171'),
    t0: Date.now(),
  });
  W.lastFire = res;
  W.fire = null;
  W.target = null;
  refreshPanels();
  render();
  checkVictory();
}

/* ============================================================
   ★ R10.36：工兵修碉堡
   ------------------------------------------------------------
   玩家："双方的工兵可以花费 3 回合修建碉堡，前提是必须在不处于 ezoc 且没有被攻击的
         情况下，一旦被攻击或处于 ezoc 就会被打断"
   · 开工：选中**自己的工兵**（本回合还没动）→ 选中面板「🏗 修建碉堡」
     要求：这一格没有建筑/碉堡、不在水上、**不处于敌方 ZOC**
   · 每回合（本方结束）检查一次：工兵还在、没进敌方 ZOC、这回合没挨打 ⇒ 进度 +1，
     否则**打断**（工地直接拆掉，进度清零）
   · 满 BUNKER_TURNS（3）回合 ⇒ 变成**非中立碉堡**，归修建方
   · 甲方单位踏进乙方碉堡 ⇒ 碉堡**自动销毁**（bunkerOnEnter）
   ============================================================ */
function enemySideOf(side) { return side === 'blue' ? 'red' : 'blue'; }
function zocOfEnemy(side) { return zocKeysFor(W.hx, W.counters, enemySideOf(side)); }

/* 现在这次选中能不能开工（面板按钮可用性 + 点下去时二次校验） */
function buildCheck(c) {
  if (!W.running || W.phase !== 'play') return { ok: false, why: '还没开打' };
  if (!c) return { ok: false, why: '先选中一个棋子' };
  if (c.side !== W.side) return { ok: false, why: '不是本方回合' };
  if (c.dead) return { ok: false, why: '已被消灭' };
  if (!isEngineer(c)) return { ok: false, why: '只有工兵能修碉堡' };
  if (!c.hex) return { ok: false, why: '还没部署' };
  if (c.acted === 'move') return { ok: false, why: '本回合已移动' };
  if (c.acted === 'fire') return { ok: false, why: '本回合已射击' };
  if (c.acted === 'build') return { ok: false, why: '本回合已经在修碉堡了' };
  if (c.suppressed) return { ok: false, why: '被压制，没法施工' };
  const here = canBuildHere(W.bld, c.hex);
  if (!here.ok) return { ok: false, why: here.why };
  if (zocOfEnemy(c.side).has(hexKey(c.hex))) return { ok: false, why: '处于敌方 ZOC，不能施工' };
  return { ok: true, why: '' };
}

function startBuild() {
  const c = W.sel;
  const chk = buildCheck(c);
  if (!chk.ok) { Dlg.alert(chk.why); return false; }
  pushUndo();
  W.bld.set(hexKey(c.hex), { side: c.side, kind: 'site', t: 0, by: c.name || '' });
  c.acted = 'build';                      // 这一手就用掉了（不能再移动/射击）
  pushLog(c.side === 'blue' ? 'blue' : 'red',
    '🏗 ' + c.name + ' 开始修碉堡 (' + (c.hex.col + 1) + ',' + (c.hex.row + 1) + ')，需要 ' +
    BUNKER_TURNS + ' 回合（期间不能进 ZOC、不能挨打）');
  W.reach = null;
  refreshPanels();
  render();
  return true;
}

/* 本方回合结束：推进 / 打断所有在建碉堡 */
function tickBuilds(side) {
  if (!W.bld || !W.bld.size) return 0;
  const zoc = zocOfEnemy(side);
  let n = 0;
  for (const ent of Array.from(W.bld)) {
    const key = ent[0], b = ent[1];
    if (b.kind !== 'site' || b.side !== side) continue;
    const col = key % 10000, row = Math.floor(key / 10000);
    const hex = hexAt(W.hx, col, row);
    const eng = (W.counters || []).find(c => !c.dead && c.hex && hexKey(c.hex) === key && isEngineer(c));
    if (!eng) {
      W.bld.delete(key);
      pushLog('hl', '⛔ (' + (col + 1) + ',' + (row + 1) + ') 的碉堡停工 —— 工兵不在了，进度清零');
      n++;
      continue;
    }
    const r = buildTick(b, hex, zoc, !!eng.hitThisTurn);
    n++;
    if (!r.ok) {
      W.bld.delete(key);
      pushLog('hl', '⛔ (' + (col + 1) + ',' + (row + 1) + ') 碉堡施工被打断：' + r.why + ' —— 进度清零');
    } else if (r.done) {
      pushLog('hl', '🏰 ' + sideName(side) + ' 的碉堡修好了 (' + (col + 1) + ',' + (row + 1) +
                    ')：守方 FLV −' + BUNKER_FLV + '（敌方进驻会被炸毁）');
    } else {
      pushLog('t', '🔨 碉堡施工 ' + b.t + '/' + BUNKER_TURNS + '（再 ' + r.left + ' 回合）');
    }
  }
  return n;
}

/* 进驻判定：踏进"有主的碉堡"⇒ 自动销毁；进驻建筑/自家碉堡 ⇒ 掩体提示 */
function bunkerOnEnter(c, h) {
  if (!c || !h) return;
  const b = bldAt(W.bld, h);
  if (!b) return;
  if (b.kind === 'bunker' && b.side && b.side !== c.side) {
    W.bld.delete(hexKey(h));
    pushLog('hl', '💥 ' + c.name + ' 冲进敌方碉堡 ⇒ 碉堡被炸毁 (' + (h.col + 1) + ',' + (h.row + 1) + ')');
  } else if (b.kind === 'bunker') {
    pushLog('t', '🛡 ' + c.name + ' 进驻碉堡（守方 FLV −' + BUNKER_FLV + '）');
  } else if (b.kind === 'building') {
    pushLog('t', '🏠 ' + c.name + ' 进驻建筑（中立 · 守方 FLV −' + BUILDING_FLV + '）');
  }
}

function endTurn() {
  if (!W.running || W.anim || W.phase !== 'play') return;
  pushUndo();                               // ★ R10.16：换回合也能撤
  endSideTurn(W.counters, W.side);          // 本方压制到期
  /* ★ R10.36：先把本方在建的碉堡推进一回合（进 ZOC / 挨打 ⇒ 打断） */
  tickBuilds(W.side);
  /* ★ R10.23：防守类目标在本方回合结束时结算（控制住 +1，丢了清零） */
  const before = (W.held && W.held[W.side]) || 0;
  holdTick(W.counters, W.goals, W.held, W.side);
  if ((W.held[W.side] || 0) !== before) {
    pushLog('hl', '🎯 ' + sideName(W.side) + ' ' + goalProgressText(W.side));
  }
  if (W.side === 'blue') W.side = 'red';
  else { W.side = 'blue'; W.turn++; }
  W.sel = null; W.target = null; W.reach = null; W.fire = null;
  /* 目标达成？（占领 / 守住 N 回合 / 全歼） */
  const res = victoryGoals(W.counters, W.goals, W.held);
  if (res) { finishGame(res.winner, res.reason); return; }
  /* 回合用完：按剩余兵力判（玩家：不再数据点分） */
  if (W.turn > WG_MAX_TURN) {
    finishGame(timeUpWinner(W.counters), '回合上限 —— 按剩余兵力判定');
    return;
  }
  beginSideTurn(W.counters, W.side);
  pushLog('t', '—— 第 ' + W.turn + ' 回合 · ' + sideName(W.side) + ' ——');
  refreshPanels();
  render();
}

/* ★ R10.23：胜负只看**胜利目标**（全歼 / 占领 / 守住 N 回合），不再算据点分 */
function checkVictory() {
  if (W.phase !== 'play') return;
  const res = victoryGoals(W.counters, W.goals, W.held);
  if (res) finishGame(res.winner, res.reason);
}

/* 据点控制：按**据点**统计（半径按格）—— 面板显示"谁控制哪个点"用，不参与胜负 */
function objectiveTally() {
  const total = (W.gm.objectives || []).length;
  let blue = 0, red = 0;
  for (let i = 0; i < total; i++) {
    const ctl = objectiveControl(W.counters, i);
    if (ctl.owner === 'blue') blue++;
    else if (ctl.owner === 'red') red++;
  }
  return { blue, red, total };
}

function finishGame(winner, reason) {
  if (!W.running) return;
  W.running = false;
  W.phase = 'over';
  const b = countersAlive(W.counters, 'blue');
  const r = countersAlive(W.counters, 'red');
  const bMen = b.reduce((a, c) => a + counterMen(c), 0);
  const rMen = r.reduce((a, c) => a + counterMen(c), 0);
  const lines = [
    '蓝方：' + b.length + ' 个棋子 · ' + bMen + ' 人 ｜ 目标：' + goalLabel(W.goals.blue),
    '红方：' + r.length + ' 个棋子 · ' + rMen + ' 人 ｜ 目标：' + goalLabel(W.goals.red),
    '',
    winner ? ('🏆 ' + sideName(winner) + ' 获胜' + (reason ? '（' + reason + '）' : '')) : '⚖ 平局',
  ];
  pushLog('hl', '════ 战斗结束：' + (winner ? sideName(winner) + ' 获胜' : '平局') +
                (reason ? '（' + reason + '）' : '') + ' ════');
  pushLog('t', lines[0]);
  pushLog('t', lines[1]);
  refreshPanels();
  render();
  Dlg.alert('战斗结束\n\n' + lines.join('\n'));
}

/* ============================================================
   7) 侧栏面板 / 日志 / 启动
   ============================================================ */
function kv(k, v) { return '<div class="kv"><b>' + k + '</b><span>' + v + '</span></div>'; }
function rowHtml(k, v) { return '<div class="fire-row"><span>' + k + '</span><span>' + v + '</span></div>'; }

/* ---------- ★ R10.23：底图显示模式 / 部署面板 / 胜利目标面板 ---------- */
const VIEW_ORDER = ['tint', 'map', 'flat'];
const VIEW_LABEL = { tint: '🎨 叠加', map: '🗺 地图', flat: '⬛ 纯色' };
const VIEW_TIP = {
  tint: '真实地图 + 30% 地形色（规则一眼可见）',
  map: '真实地图 + 只有网格线（最像真实兵棋）',
  flat: '纯色六角格（不看地图）',
};
function refreshViewBtn() {
  const b = $('wg-view');
  if (b) {
    b.textContent = VIEW_LABEL[W.view || 'tint'];
    b.title = '底图显示：' + VIEW_TIP[W.view || 'tint'] + '（点击切换）';
  }
}
function cycleView() {
  const i = VIEW_ORDER.indexOf(W.view || 'tint');
  W.view = VIEW_ORDER[(i + 1) % VIEW_ORDER.length];
  try { localStorage.setItem(WG_VIEW_KEY, W.view); } catch (e) {}
  refreshViewBtn();
  pushLog('t', '底图显示：' + VIEW_TIP[W.view] +
    ((W.gm && W.gm.hexData) ? '（六角格手绘地图没有光栅底图，恒为纯色）' : ''));
  render();
}
function shortSide(s) { return s === 'blue' ? '蓝方' : (s === 'red' ? '红方' : '无人'); }

/* ★ R10.39：部署清单改成**文件夹树**（玩家："改为使用文件夹的形式选择单位，一层一层打开"）
   —— 用原生 <details>/<summary>，自带展开/收起，手机上也能点；
      每个文件夹显示「已放/总数」，展开状态存在 W.deploy.open 里（重画不丢）。 */
function deployTreeOf(list) {
  const root = { kids: new Map(), items: [] };
  for (const c of list) {
    const p = (Array.isArray(c.path) && c.path.length)
      ? c.path : [{ name: c.name, echelon: c.echelon }];
    let node = root;
    for (let i = 0; i < p.length - 1; i++) {
      const seg = p[i] || {};
      const key = String(seg.name || '') + '|' + String(seg.echelon || '');
      if (!node.kids.has(key)) {
        node.kids.set(key, { key, name: seg.name || '未命名', echelon: seg.echelon || '',
                             kids: new Map(), items: [] });
      }
      node = node.kids.get(key);
    }
    node.items.push(c);
  }
  return root;
}
function deployCounts(node) {
  let total = node.items.length, placed = 0;
  for (const c of node.items) if (c.hex && !c.dead) placed++;
  for (const kid of node.kids.values()) {
    const s = deployCounts(kid);
    total += s.total; placed += s.placed;
  }
  return { total, placed };
}
function deployTreeHtml(node, st, pathKey, depth) {
  let h = '';
  for (const kid of node.kids.values()) {
    const k = pathKey + '/' + kid.key;
    const cnt = deployCounts(kid);
    const open = st.open.has(k) || (depth === 0 && st.open.size === 0);
    h += '<details class="dep-folder" data-fk="' + esc(k) + '"' + (open ? ' open' : '') + '>' +
         '<summary><span class="df-name">📁 ' + esc(kid.name) + '</span>' +
         '<span class="df-cnt">' + cnt.placed + '/' + cnt.total + '</span></summary>' +
         '<div class="df-body">' + deployTreeHtml(kid, st, k, depth + 1) + '</div></details>';
  }
  for (const c of node.items) {
    const on = (st.sel === c) ? ' on' : '';
    if (c.hex && !c.dead) {
      h += '<div class="dep-chip placed' + on + '" title="已经在棋盘上（点棋盘上的它可收回）">' +
           '<span class="dp-name">✓ ' + esc(c.name) + '</span>' +
           '<span class="dp-sub">' + esc(counterStrengthLabel(c)) + '</span></div>';
    } else {
      h += '<button class="dep-chip' + on + '" data-cid="' + esc(c.id) + '">' +
           '<span class="dp-name">' + esc(c.name) + '</span>' +
           '<span class="dp-sub">' + esc(counterStrengthLabel(c)) + '</span></button>';
    }
  }
  return h;
}
function deployListHtml() {
  const st = W.deploy;
  if (!st) return '';
  if (!st.open) st.open = new Set();      // ★ R10.39：记住哪几个文件夹是展开的
  const side = st.side;
  const bench = st.bench[side];
  const placedList = W.counters.filter(c => c.side === side);
  const all = placedList.concat(bench);
  const total = all.length;
  let h = '<div class="dep-head ' + side + '">' + esc(sideName(side)) +
          ' <span>' + placedList.length + '/' + total + ' 已放 · 区 ' + st.zone[side].size + ' 格</span></div>';
  h += '<div class="dep-tip" style="margin:0 0 6px;">按<b>文件夹一层层点开</b>挑单位；' +
       '不想全放就直接点底部「✔ 部署完成」（没放的本局不上场）。</div>';
  h += '<div class="dep-tree">' + deployTreeHtml(deployTreeOf(all), st, '', 0) + '</div>';
  if (!bench.length) h += '<div class="dep-empty">都放好了 —— 点底部「✔ 部署完成」</div>';
  return h;
}
/* 胜利目标：部署阶段可编辑，开打后只读（显示进度） */
function goalProgressText(side) {
  const g = (W.goals || {})[side];
  if (!g) return '';
  if (g.kind === 'annihilate') {
    return '敌方还剩 ' + countersAlive(W.counters, side === 'blue' ? 'red' : 'blue').length + ' 个棋子';
  }
  const oi = (g.obj == null) ? -1 : (g.obj | 0);
  if (oi < 0) return '未选据点';
  const ctl = objectiveControl(W.counters, oi);
  const who = ctl.owner ? shortSide(ctl.owner) : '争夺中';
  const cnt = '（蓝 ' + ctl.blue + ' / 红 ' + ctl.red + '）';
  if (g.kind === 'capture') return '据点 ' + (oi + 1) + '：' + who + cnt;
  return '据点 ' + (oi + 1) + '：' + who + cnt + ' · 已守 ' +
         ((W.held && W.held[side]) || 0) + '/' + Math.max(1, (g.turns | 0) || 10) + ' 回合';
}
function goalsHtml() {
  const objs = (W.gm && W.gm.objectives) || [];
  const editable = (W.phase === 'deploy');
  const kinds = [['annihilate', '全歼敌方'], ['capture', '占领据点'], ['hold', '防守据点 N 回合']];
  let h = '';
  for (const side of ['blue', 'red']) {
    const g = (W.goals && W.goals[side]) || { kind: 'annihilate', obj: -1, turns: 10 };
    const dis = editable ? '' : ' disabled';
    h += '<div class="goal-row ' + side + '"><b>' + esc(sideName(side)) + '</b>';
    h += '<select data-goal-side="' + side + '" data-goal-field="kind"' + dis + '>';
    for (const kd of kinds) {
      h += '<option value="' + kd[0] + '"' + (g.kind === kd[0] ? ' selected' : '') + '>' +
           kd[1] + '</option>';
    }
    h += '</select>';
    if (g.kind !== 'annihilate' && objs.length) {
      h += '<select data-goal-side="' + side + '" data-goal-field="obj"' + dis + '>';
      for (let i = 0; i < objs.length; i++) {
        h += '<option value="' + i + '"' + (((g.obj | 0) === i) ? ' selected' : '') + '>' +
             esc(objs[i].name || ('据点 ' + (i + 1))) + '</option>';
      }
      h += '</select>';
    }
    if (g.kind === 'hold') {
      h += '<input type="number" min="1" max="' + WG_MAX_TURN + '" value="' +
           Math.max(1, (g.turns | 0) || 10) + '" title="守住的回合数" ' +
           'data-goal-side="' + side + '" data-goal-field="turns"' + dis + '>';
    }
    h += '</div><div class="goal-prog">' + esc(goalProgressText(side)) + '</div>';
  }
  if (editable) h += '<div class="dep-tip">目标可以改；攻防默认给攻方「占领」、守方「防守 10 回合」</div>';
  return h;
}

/* 部署 / 目标面板 + 底部按钮的显示状态（阶段一变就调） */
function refreshDeployUI() {
  const dep = (W.phase === 'deploy');
  const sec = $('wg-deploy-sec'), gsec = $('wg-goal-sec');
  if (sec) sec.classList.toggle('hidden', !dep);
  if (gsec) gsec.classList.toggle('hidden', !(W.hx && W.phase !== 'idle'));
  const autoBtn = $('wg-auto'), okBtn = $('wg-deploy-ok'), endBtn = $('wg-end');
  if (autoBtn) autoBtn.classList.toggle('hidden', !dep);
  if (okBtn) okBtn.classList.toggle('hidden', !dep);
  if (endBtn) endBtn.classList.toggle('hidden', dep);
  const box = $('wg-deploy');
  if (box) {
    box.innerHTML = dep ? deployListHtml() : '';
    /* ★ R10.39：记下文件夹展开状态（重画后不折叠回去） */
    if (dep && W.deploy) {
      const open = W.deploy.open || (W.deploy.open = new Set());
      box.querySelectorAll('details.dep-folder').forEach(d => {
        d.addEventListener('toggle', () => {
          const k = d.getAttribute('data-fk') || '';
          if (d.open) open.add(k); else open.delete(k);
        });
      });
    }
  }
  const gbox = $('wg-goals');
  if (gbox) gbox.innerHTML = (W.hx && W.phase !== 'idle') ? goalsHtml() : '';
  refreshViewBtn();
}

function refreshPanels() {
  const turnEl = $('wg-turn');
  if (turnEl) {
    turnEl.textContent = (W.phase === 'deploy' && W.deploy)
      ? (sideName(W.deploy.side) + ' 部署中')
      : (sideName(W.side) + ' 第 ' + W.turn + '/' + WG_MAX_TURN + ' 回合');
  }
  const st = $('wg-status');
  if (st) {
    const b = countersAlive(W.counters, 'blue').length;
    const r = countersAlive(W.counters, 'red').length;
    st.textContent = (W.phase === 'deploy')
      ? '部署：选棋子 → 点高亮格（🎲 一键 / ✔ 完成）'
      : (W.running ? ('蓝 ' + b + ' · 红 ' + r + ' ｜ 点棋子选中，点白雾格移动，点敌方棋子开火') : '');
  }
  refreshDeployUI();
  renderSelPanel();
  renderFlvPanel(W.sel);
  renderFirePanel();
  /* 表格窗开着就跟着选中棋子刷新 */
  const sheet = $('wg-sheet');
  if (sheet && !sheet.classList.contains('hidden')) renderSheet();
}

/* 一件装备的"关键数值"摘要 */
function equipStatText(eq) {
  const s = (eq && eq.stats) || {};
  const bits = [];
  if (s.antiPersonnel) bits.push('对人 ' + s.antiPersonnel);
  if (s.penetration) bits.push('穿甲 ' + s.penetration + 'mm');
  if (s.lethalRadius) bits.push('杀伤半径 ' + s.lethalRadius + 'm');
  if (s.armor) bits.push('装甲 ' + s.armor + 'mm');
  if (s.range) bits.push('射程 ' + s.range + 'm');
  return bits.join(' · ') || '—';
}
/* 该棋子的**全部装备清单**：枪、火箭筒、反坦克炮、迫击炮、车辆、支援车都列
   （玩家："将火炮等所有装备都给列举出来"） */
function equipListHtml(c) {
  const rows = [];
  const add = (eq, n) => {
    if (!eq) return;
    const key = (eq.id || eq.name || '?') + '|' + (eq.category || '');
    const hit = rows.find(r => r.key === key);
    if (hit) { hit.count += (n || 1); return; }
    rows.push({ key: key, eq: eq, count: n || 1 });
  };
  if (c.items && c.items.length) {
    c.items.forEach(it => add(it.eq, it.count));
  } else {
    if (c.kind === 'veh') {
      (c.weapons || []).forEach(w => add({ name: w.name, category: 'armored_vehicle', stats: w }, 1));
    }
    (c.members || []).forEach(m => {
      (m.weapons || []).forEach(w => add({ name: w.name, category: w.cat, stats: w }, 1));
    });
    (c.supports || []).forEach(s => add({ name: s.name, category: s.cat, stats: s }, s.count || 1));
  }
  if (!rows.length) return '<div class="fire-note">无装备记录</div>';
  let h = '<table class="equip-table"><tr><th>装备</th><th>类别</th><th>数</th><th>数值</th></tr>';
  for (const r of rows) {
    const cat = (typeof EQUIP_CATEGORIES !== 'undefined' && EQUIP_CATEGORIES[r.eq.category])
      ? EQUIP_CATEGORIES[r.eq.category].name : (r.eq.category || '—');
    h += '<tr><td>' + esc(r.eq.name || '?') + '</td>' +
         '<td>' + esc(cat) + '</td>' +
         '<td>' + r.count + '</td>' +
         '<td>' + esc(equipStatText(r.eq)) + '</td></tr>';
  }
  return h + '</table>';
}

function typeLabel(t) {
  const d = (typeof TYPES !== 'undefined' && t) ? TYPES[t] : null;
  return (d && d.name) ? d.name : (t || '—');
}

/* ★ R10.19：**逐人明细**（玩家："选中单位时直接列出单位内的每一个人，将他们的名字武器标出来…
   阵亡之后就将他们的头像以及名字黑掉"）
   · 名字在 makeCounters 里按武器起好（步枪兵1 / 机枪兵1 / 反坦克兵1…）；
   · 这里只负责显示：活着的头盔 + 名字 + 武器；阵亡的整行变灰 + 骷髅 + 划线。 */
function rosterHtml(c) {
  if (!c || c.kind !== 'inf' || !(c.members || []).length) return '';
  const alive = c.members.filter(m => m.alive).length;
  const rows = c.members.map((m, i) => {
    const ws = (m.weapons && m.weapons.length) ? m.weapons : (m.weapon ? [m.weapon] : []);
    const wname = ws.map(w => (w && w.name) || '徒手').join(' + ');
    const dead = !m.alive;
    return '<div class="man' + (dead ? ' dead' : '') + '" title="' +
             esc((m.name || ('兵' + (i + 1))) + '：' + (wname || '徒手')) + '">' +
             '<span class="man-face">' + (dead ? '☠' : '🪖') + '</span>' +
             '<span class="man-name">' + esc(m.name || ('兵' + (i + 1))) + '</span>' +
             '<span class="man-wpn">' + esc(wname || '徒手') + '</span>' +
           '</div>';
  }).join('');
  return '<div class="sec-sub">人员（' + alive + '/' + c.members.length + '）</div>' +
         '<div class="roster">' + rows + '</div>';
}

/* ★ R10.22：**弹药**面板（只列"有限弹药"的武器；步枪/机枪不进来） */
function ammoHtml(c) {
  if (!c || !c.ammo) return '';
  const names = Object.keys(c.ammo);
  if (!names.length) return '';
  const rows = names.map(n => {
    const left = Math.max(0, c.ammo[n] | 0);
    const max = Math.max(1, (c.ammoMax && c.ammoMax[n]) || left || 1);
    const pct = Math.max(0, Math.min(1, left / max));
    const cls = left <= 0 ? ' out' : (pct <= 0.25 ? ' low' : '');
    return '<div class="ammo-row' + cls + '">' +
             '<span class="ammo-name">' + esc(n) + '</span>' +
             '<span class="ammo-bar"><i style="width:' + Math.round(pct * 100) + '%"></i></span>' +
             '<span class="ammo-num">' + left + '/' + max + '</span>' +
           '</div>';
  }).join('');
  return '<div class="sec-sub">弹药</div><div class="ammo-list">' + rows + '</div>';
}

function renderSelPanel() {
  const el = $('wg-sel');
  const c = W.sel;
  if (!el) return;
  if (!c) { el.innerHTML = '<span style="color:#64748b">未选中（点棋子查看）</span>'; return; }
  let html = '';
  html += kv('番号', esc(counterDesignation(c)));
  html += kv('层级', esc(counterDesignation(c, true)));
  html += kv('建制', esc(echelonLabel(c.echelon || (c.node && c.node.echelon)) + ' · ' +
                         typeLabel(c.type || (c.node && c.node.type))));
  html += kv('阵营', '<span class="tag' + (c.side === 'blue' ? '' : ' bad') + '">' +
                       sideName(c.side) + '</span>');
  html += kv('兵力', esc(counterStrengthLabel(c)));
  html += kv('机动', (c.mpType === 'foot' ? '徒步' : c.mpType) + ' · MP ' + c.mp + '/' + c.mpMax);
  html += kv('所在', c.hex ? ('(' + c.hex.col + ',' + c.hex.row + ') ' + c.hex.terr +
                (c.hex.road ? ' · 有路' : '') + (c.hex.obj >= 0 ? ' · 据点' : '')) : '—');
  /* ★ R10.36：脚下这一格有什么工事（中立建筑 / 在建碉堡 / 完工碉堡） */
  const bHere = (c.hex && W.bld) ? bldAt(W.bld, c.hex) : null;
  html += kv('工事', !bHere ? '<span style="color:#64748b">无（空地）</span>'
    : bHere.kind === 'bunker'
      ? ('🏰 碉堡（' + shortSide(bHere.side) + '）守方 FLV −' + BUNKER_FLV)
      : bHere.kind === 'site'
        ? ('🔨 在建碉堡 ' + (bHere.t | 0) + '/' + BUNKER_TURNS + '（' + shortSide(bHere.side) + '）')
        : ('🏠 中立建筑 · 守方 FLV −' + BUILDING_FLV));
  /* ★ R10.36：自己的工兵 ⇒ 给一个「修建碉堡」按钮（不满足条件就灰掉并写明原因） */
  if (isEngineer(c) && c.side === W.side) {
    const chk = buildCheck(c);
    html += '<div class="build-box">' +
      '<button id="wg-build"' + (chk.ok ? ' class="primary"' : '') + (chk.ok ? '' : ' disabled') +
      ' title="' + esc(chk.ok ? ('花 ' + BUNKER_TURNS + ' 回合在脚下这一格修一座碉堡') : chk.why) + '">' +
      (c.acted === 'build' ? '🏗 施工中…' : ('🏗 修建碉堡（' + BUNKER_TURNS + ' 回合）')) + '</button>' +
      '<div class="build-hint">' +
      esc(chk.ok ? ('施工期间不能进敌方 ZOC、不能挨打，否则打断；修好之后敌方进驻会被炸毁') : chk.why) +
      '</div></div>';
  }
  const flags = [];
  if (c.acted === 'move') flags.push('<span class="tag warn">已移动 · 不能攻击</span>');
  else if (c.acted === 'fire') flags.push('<span class="tag warn">已攻击 · 不能移动</span>');
  if (c.suppressed) flags.push('<span class="tag warn">被压制</span>');
  if (c.dead) flags.push('<span class="tag bad">已消灭</span>');
  if (c.km) flags.push('<span class="tag bad">机动坏</span>');
  if (c.kf) flags.push('<span class="tag bad">武器坏</span>');
  if (c.side !== W.side) flags.push('<span class="tag">敌方</span>');
  if (flags.length) html += kv('状态', flags.join(' '));
  /* 现存武器（按人统计；一个人可能同时带步枪 + 火箭筒）
     ★ R10.12：车辆棋子也会带拖曳炮/支援武器（supports），一起列出来 */
  const wcnt = {};
  if (c.kind === 'veh') {
    (c.weapons || []).forEach(w => { const n = w.name || '车载武器'; wcnt[n] = (wcnt[n] || 0) + 1; });
    (c.supports || []).forEach(s => {
      const n = (s.name || '?');
      wcnt[n] = (wcnt[n] || 0) + (s.count || 1);
    });
  } else {
    (c.members || []).forEach(m => {
      if (!m.alive) return;
      (m.weapons || (m.weapon ? [m.weapon] : [])).forEach(w => {
        const n = w.name || '徒手';
        wcnt[n] = (wcnt[n] || 0) + 1;
      });
    });
    (c.supports || []).forEach(s => {
      const n = '[支援]' + (s.name || '?');
      wcnt[n] = (wcnt[n] || 0) + (s.count || 1);
    });
  }
  const wl = Object.keys(wcnt).map(k => k + '×' + wcnt[k]).join('、');
  html += kv('现存武器', esc(wl || '无'));
  html += rosterHtml(c);                        // ★ R10.19：逐人明细（阵亡黑掉）
  html += ammoHtml(c);                          // ★ R10.22：弹药（只列火炮/反坦克等）
  html += '<div class="sec-sub">装备清单</div>' + equipListHtml(c);
  el.innerHTML = html;
}

function renderFlvPanel(c) {
  const el = $('wg-flv');
  if (!el) return;
  if (!c) { el.innerHTML = '<span style="color:#64748b">—</span>'; return; }
  /* ★ R10.12：射程 = 直射与**间瞄（火炮）**取大者；有炮就多一行"炮击" */
  const rng = Math.max(1, counterMaxRangeHex(c));
  const artRng = counterArtRangeHex(c);
  /* ★ R10.5：射程解封后可能几十格（坦克 30 格）⇒ 侧栏只铺前 8 列，
     完整表请点「📊 表格」（可拖动的那个窗）。 */
  const colMax = Math.min(rng, 8);
  let html = '<table class="flv-table"><tr><th>距离(格)</th>';
  for (let d = 1; d <= colMax; d++) html += '<th>' + d + '</th>';
  html += '</tr>';
  const rows = [['对人员', 'soft'], ['反装甲', 'hard']];
  if (artRng > 0) rows.push(['炮击', 'art']);      // 间瞄：不看视线，只受射程限制
  for (const [label, kind] of rows) {
    html += '<tr><th>' + label + '</th>';
    for (let d = 1; d <= colMax; d++) {
      const v = flvAt(c, d, kind);
      const cls = (v == null) ? 'low' : (v >= 9 ? 'hot' : (v >= 5 ? 'mid' : 'low'));
      html += '<td class="' + cls + '">' + (v == null ? '—' : v) + '</td>';
    }
    html += '</tr>';
  }
  html += '</table>';
  html += '<div class="fire-note" style="margin-top:5px">射程 ' + rng + ' 格（' +
          (rng * HEX_EDGE) + ' m）' +
          (artRng > 0 ? ' · 含炮击 ' + artRng + ' 格（' + (artRng * HEX_EDGE) + ' m，间瞄不看视线）' : '') +
          (rng > colMax ? ' · 只列前 ' + colMax + ' 格，完整表点「📊 表格」' : '') + '</div>';
  el.innerHTML = html;
}

function renderFirePanel() {
  const el = $('wg-fire');
  if (!el) return;
  const f = W.fire;
  if (!f) {
    el.innerHTML = W.lastFire ? resultBox(W.lastFire)
      : '<span style="color:#64748b">选中自己的棋子 → 点敌方棋子</span>';
    return;
  }
  const atk = f.atk, def = f.def, sit = f.sit;
  if (!sit.ok) {
    el.innerHTML = '<div class="fire-box"><div class="fire-head">' +
      esc(atk.name) + ' → ' + esc(def.name) + '</div>' +
      '<div class="fire-note">无法射击：' + esc(sit.why) + '</div></div>';
    return;
  }
  const pv = firePreviewDist(atk, def);
  const terrPen = FLV_TERR_PENALTY[def.hex.terr] || 0;
  let html = '<div class="fire-box">';
  html += '<div class="fire-head">' + esc(atk.name) + ' → ' + esc(def.name) + '</div>';
  html += rowHtml('距离', sit.dist + ' 格（' + (sit.dist * HEX_EDGE) + ' m）');
  html += rowHtml('判定表', sit.kind === 'at' ? '反装甲'
                    : (sit.kind === 'art' ? '炮击（间瞄 · 不看视线）' : '反人员'));
  /* ★ R10.15：炮击会散布 —— 提前把概率写清楚（值只从 core 的常量读） */
  if (sit.kind === 'art') {
    html += rowHtml('散布', Math.round(ART_SCATTER_CHANCE * 100) +
                    '% 飘到周围六格之一（按落点结算；落点没人 = 白打）');
  }
  html += rowHtml('火力等级', 'FLV ' + pv.flv + (terrPen ? '（目标地形 −' + terrPen + '）' : ''));
  /* ★ R10.8：按目标类型挑武器 —— 把"用什么东西打的"直接写出来 */
  const uw = counterUsedWeapons(atk, sit.dist, sit.kind);
  if (uw.length) {
    html += rowHtml('使用武器', uw.map(u =>
      esc(u.name) + '×' + u.count +
      (u.limited && u.ammo != null ? '（弹 ' + u.ammo + '）' : '') +
      (sit.kind === 'at' && u.pen ? '（穿甲 ' + Math.round(u.pen) + 'mm）' : '')
    ).join('、'));
  }
  html += rowHtml('目标地形', def.hex.terr + '（掩体 ' + Math.round((def.hex.cover || 0) * 100) + '%）');
  const order = ['—', 'S', 'K', '2K', '3K', 'Km', 'Kf'];
  const parts = [];
  for (const code of order) {
    const p = pv.map.get(code);
    if (p) parts.push(shortCode(code, sit.kind) + ' ' + Math.round(p * 100) + '%');
  }
  html += '<div class="fire-note">2D6：' + parts.join(' · ') + '</div>';
  html += '<div class="fire-actions"><button class="go" id="wg-do-fire">🎲 开火</button>' +
          '<button id="wg-cancel-fire">取消</button></div>';
  html += '</div>';
  el.innerHTML = html;
  const go = $('wg-do-fire'), no = $('wg-cancel-fire');
  if (go) go.addEventListener('click', doFire);
  if (no) no.addEventListener('click', () => {
    W.fire = null; W.target = null; refreshPanels(); render();
  });
}

function resultBox(res) {
  const cls = res.code === '—' ? 'ok' : (res.code === 'S' ? 'mid' : 'bad');
  return '<div class="res"><div class="code ' + cls + '">' + res.code + '</div>' +
         '<div class="fire-note">' + esc(res.label) + '（2D6=' + res.roll +
         '，FLV ' + res.flv + '）</div></div>';
}

function pushLog(cls, text) {
  W.log.push({ cls, text });
  if (W.log.length > 400) W.log.shift();
  renderLog();
}
function renderLog() {
  const el = $('wg-log');
  if (!el) return;
  el.innerHTML = W.log.slice(-150)
    .map(o => '<div class="' + o.cls + '">' + esc(o.text) + '</div>').join('');
  el.scrollTop = el.scrollHeight;
}

/* ---------- 启动 ---------- */
wgInit();






