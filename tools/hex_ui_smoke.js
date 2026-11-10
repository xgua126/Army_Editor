/* ============================================================
   hex_ui_smoke.js —— 兵棋「界面层」离线冒烟（假 DOM + 真地图 + 真存档）
   ------------------------------------------------------------
   为什么需要它：hex-core.js 有 hex_probe.js 做数值体检，但 wargame 能不能
   **跑起来**（开局 → 选棋子 → 移动 → 开火 → 换回合 → 结算）只有真跑才知道。
   没有浏览器的时候，用一层最小 DOM 桩就能把整条链路跑通 —— 抓过真 bug
   （比如 SA_CATS 漏声明、hexDistance 空引用）。

   用法：node tools/hex_ui_smoke.js       （最后一行打印 SMOKE OK）
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------- 最小 DOM 桩 ---------- */
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return null;
    if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
    /* ★ R10.23：bakeGridCanvas() 要 createImageData ⇒ 给一份真的像素缓冲，
       这样"六角格叠在真实地图上"这条渲染路径也能在冒烟里跑一遍 */
    if (k === 'createImageData') return (w, h) => ({
      width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
    });
    if (!(k in t)) t[k] = function () {};
    return t[k];
  },
  set(t, k, v) { t[k] = v; return true; },
});
const els = {};
function mkEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', scrollTop: 0, scrollHeight: 0,
    style: {}, dataset: {}, width: 1200, height: 800, _attrs: {}, _children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setPointerCapture() {},
    getAttribute(k) { return this._attrs[k] || null; },
    setAttribute(k, v) { this._attrs[k] = v; },
    appendChild(c) { this._children.push(c); },
    querySelectorAll() { return []; },
    getContext() { return ctxStub; },
    getBoundingClientRect() { return { width: 1200, height: 800, left: 0, top: 0 }; },
  };
}
global.document = {
  getElementById(id) { return els[id] || (els[id] = mkEl(id)); },
  createElement(tag) { return mkEl('new-' + tag); },
  querySelectorAll() { return []; },
  addEventListener() {},
  body: mkEl('body'),
};
global.window = { addEventListener() {}, devicePixelRatio: 1 };
global.Dlg = { alert() {} };

/* ★ 兵牌是 SVG → Image（真浏览器异步加载）。这里给同步 stub：
   loaded=true 但**不触发 onload**，避免 re-render 递归。 */
global.Image = class {
  constructor() { this.loaded = false; this._src = ''; }
  set src(v) { this._src = v; this.loaded = true; }
  get src() { return this._src; }
};
global.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = (opts || {}).type; } };
global.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} };

/* ★ 定种随机数：冒烟必须**可重复**（否则"掷出无效果"就会让断言随机翻车） */
let _seed = 20260101;
Math.random = function () {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
};

/* ---------- localStorage：一份装备库 + 两份编制存档 ---------- */
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] == null ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
localStorage.setItem('mil_equipment_lib_v1', JSON.stringify({
  eq_rifle: { id: 'eq_rifle', category: 'small_arms', name: '步枪',
              stats: { antiPersonnel: 10, range: 400, fireInterval: 0.3, ammo: 120 } },
  eq_mg: { id: 'eq_mg', category: 'small_arms', name: '轻机枪',
           stats: { antiPersonnel: 14, range: 600, fireInterval: 0.1, ammo: 300 } },
  eq_at: { id: 'eq_at', category: 'at_weapon', name: '火箭筒',
           stats: { crew: 1, antiArmor: 600, penetration: 500, range: 800,
                    fireInterval: 8, ammo: 3, deployTime: 3, disposable: 'no' } },
}));

function squadNode(tag, n) {
  return {
    type: 'infantry', echelon: 'squad', name: tag + '-班' + n, customName: false, remark: '',
    children: [], collapsed: false, layout: 'v',
    personnel: 9, personnelMax: 9,
    equipment: [{ eqId: 'eq_rifle', name: '步枪', count: 8, countMax: 0 },
                { eqId: 'eq_mg', name: '轻机枪', count: 1, countMax: 0 }],
    custom: null,
  };
}
function mkArmy(tag) {
  const pl = [];
  for (let p = 1; p <= 3; p++) {
    const sq = [];
    for (let s = 1; s <= 3; s++) sq.push(squadNode(tag, p + '' + s));
    pl.push({ type: 'infantry', echelon: 'platoon', name: tag + '-排' + p, customName: false,
              remark: '', children: sq, collapsed: false, layout: 'h',
              personnel: 0, personnelMax: 0, equipment: [], custom: null });
  }
  return { type: 'infantry', echelon: 'company', name: tag + '-连', customName: false,
           remark: '', children: pl, collapsed: false, layout: 'h',
           personnel: 0, personnelMax: 0, equipment: [], custom: null };
}
localStorage.setItem('mil_org_saves_v1', JSON.stringify({
  blueArmy: { time: 1, personnel: 81, data: mkArmy('B') },
  redArmy: { time: 2, personnel: 81, data: mkArmy('R') },
}));

/* ---------- 加载真代码（顺序同 wargame.html） ---------- */
const FILES = ['js/ms-catalog.js', 'js/data.js', 'js/vendor/milsymbol.js', 'js/milsymbol-bridge.js',
               'js/model.js', 'js/render.js', 'js/equipment.js',
               'js/maps-presets.js', 'js/grid-maps.js', 'js/sfx.js',
               'js/hex-core.js', 'js/hex-wargame.js'];
/* milsymbol 是 UMD：Node 里它走 module.exports，这里换成挂全局，好让桥接层直接用 */
const src = FILES.map(f => {
  let s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (f.indexOf('milsymbol.js') >= 0) s = s.replace(/module\.exports\s*=\s*/g, 'globalThis.__ms = ');
  return s;
}).join('\n');
const api = new Function(src + `
  if (typeof ms === 'undefined' && typeof globalThis.__ms !== 'undefined') globalThis.ms = globalThis.__ms;
  return { startGame, W, selectCounter, moveSelected, openFirePreview, doFire, endTurn,
           finishGame, hexKey, hexAt, hexNeighbors, countersAlive, counterMen,
           counterRangeHex, fireSituation, objectiveTally, counterStrengthLabel,
           buildSymbol, wgSymbolImage, counterDesignation, pathLabel, TYPES,
           buildPath, canAnimate, flvAt, counterRangeHex, flvTableHtml, crtTableHtml,
           renderSheet, splitRoll, buildCounters, counterFlv, takeMissingEquip,
           resolveEquipment, makeInfantryBattalion, resolveFire, counterPenetration,
           crtLookup, crtEff, crtEffRow,
           counterArtRangeHex, counterMaxRangeHex, fireKindFor,
           artScatterHex, applyFireResult, undoLast, ART_SCATTER_CHANCE,
           opportunityShotFor, opportunityTriggers, OPP_FIRE_FLV_PENALTY,
           roleNameOf, nameMembers, rosterHtml, addCorpses, TURN_SECONDS, MP_MAX,
           consumeAmmo, ammoBlocked, ammoHtml, weaponUsesAmmo, counterRaw,
           stepAnim,
           bakeHexMap, hexMapSize, GRID_MAPS, GRID_IDX, HEX_ROAD_SHARE,
           /* ★ R10.23：部署 / 胜利目标 / 格半径据点 */
           autoDeployAll, finishDeploySide, deployZone, deployableCount,
           spawnAnchors, hexOfWorld, hexDistance, objectiveControl,
           victoryGoals, holdTick, timeUpWinner, goalLabel,
           mapBaseAvailable, placeCounter, unplaceCounter, countersAt,
           hexMoveCost, msSIDC, msPlan, symbolSvg, TYPE_SIDC, ECHELON_CHAR,
           MS_CATALOG, TYPES_CAT, symbolBySidc,
           newNode, visibleChildren, hasStackableChildren, stackSizeOf,
           cloneSubtree, serializeOrg, deserializeOrg, countDescendants,
           diceDist, equipListHtml, counterUsedWeapons, eachWeapon,
           /* ★ R10.36：建筑 / 碉堡 / 合并编辑器的 hexData 烘焙 */
           initBuildings, bldAt, canBuildHere, buildTick, defTerrShift, isEngineer,
           hexBakeToData,
           BUNKER_TURNS, BUNKER_FLV, BUILDING_FLV };
`)();

const E = (id) => document.getElementById(id);
let fails = 0;
function ck(name, cond) {
  if (!cond) fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
}

/* ---------- ① 开局（★ R10.23：先进部署阶段 → 手动/一键部署 → 开打） ---------- */
E('wg-map').value = 'interchange';
E('wg-blue').value = 'blueArmy';
E('wg-red').value = 'redArmy';
E('wg-ech').value = 'squad';
E('wg-mode').value = 'meeting';
api.startGame();
api.W.motion = false;          // ★ 离线冒烟关掉动画：移动/开火必须同步完成
ck('没有 rAF 时不播动画（同步完成，不会卡住）', api.canAnimate() === false);

const W = api.W;
/* ★ R10.23：测试用"一键部署 + 完成"（蓝 → 红 → 开打） */
function deployAll() {
  api.autoDeployAll();
  api.finishDeploySide();
  api.autoDeployAll();
  api.finishDeploySide();
}
ck('地图烘焙：29×17 = 493 格（立交桥 5×2.5km，每格 100m）', W.hx.cols === 29 && W.hx.rows === 17);

/* ---------- ①a ★ R10.23：地形按"格内面积占比"烘焙 ---------- */
const hexList = W.hx.hexes.filter(h => !!h);
ck('每格都记了主地形占比 terrShare（0~1）',
   hexList.every(h => h.terrShare >= 0 && h.terrShare <= 1.0001));
ck('每格都记了路面占比 roadShare，且 road = (roadShare ≥ 1.5%)',
   hexList.every(h => h.roadShare >= 0 && h.roadShare <= 1.0001 &&
                      h.road === (h.roadShare >= api.HEX_ROAD_SHARE)));
ck('立交桥有矢量公路 ⇒ 一定烘出"有路"的格子（' +
   hexList.filter(h => h.road).length + ' 格）', hexList.some(h => h.road));
ck('真实地图底图可用（bakeGridCanvas 出图 ⇒ 六角格叠在实时战斗那张图上）',
   api.mapBaseAvailable() === true);
ck('据点半径改成**格**（rHex ≥ 1）, 且每格只归一个据点',
   (W.gm.objectives || []).every(o => o.rHex >= 1) &&
   hexList.every(h => h.obj >= -1 && h.obj < (W.gm.objectives || []).length));

/* 合成地图：左半树林 / 右半草地 / 一条 10m 横路 / 一小块 1 格路 */
(function () {
  const GW = 200, GH = 100, CS = 5;
  const grid = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) grid[y * GW + x] = (x < 100) ? api.GRID_IDX.forest : api.GRID_IDX.empty;
  }
  const gm = {
    id: 'synthetic', name: '合成测试图', w: GW * CS, h: GH * CS, cellSize: CS,
    gw: GW, gh: GH, layers: [{ visible: true, grid }], roads: [],
    buildings: [], objectives: [{ name: '测试点', x: 500, y: 250, r: 300 }],
  };
  const hx = api.bakeHexMap(gm);
  const left = hx.hexes.filter(h => h && h.x < 400);
  const right = hx.hexes.filter(h => h && h.x > 620);
  ck('面积占优：左半（树林 60%+）⇒ 全判树林', left.length > 0 && left.every(h => h.terr === 'forest'));
  ck('面积占优：右半（草地）⇒ 全判草地', right.length > 0 && right.every(h => h.terr === 'empty'));
  /* 据点半径按格：r=300m ⇒ rHex=3，格距 ≤ 3 的格子都归它 */
  const o = gm.objectives[0];
  const oc = api.hexOfWorld(hx, o.x, o.y);
  const objHexes = hx.hexes.filter(h => h && h.obj === 0);
  ck('据点 r=300m ⇒ rHex=3，归属格都在 3 格内（' + objHexes.length + ' 格）',
     objHexes.length >= 7 && objHexes.every(h => api.hexDistance(h, oc) <= 3));
  /* 一条 10m 宽的横路（y 200~210），应该沿路烘出有路的格子 */
  const grid2 = new Uint8Array(GW * GH);
  for (let y = 40; y < 42; y++) for (let x = 0; x < GW; x++) grid2[y * GW + x] = api.GRID_IDX.road;
  const gm2 = Object.assign({}, gm, { layers: [{ visible: true, grid: grid2 }],
    objectives: [], _hex: null, _composedGrid: null, _rev: 0 });
  const hx2 = api.bakeHexMap(gm2);
  const roadHexes = hx2.hexes.filter(h => h && h.road);
  ck('10m 横路 ⇒ 沿路每一列都烘出"有路"（' + roadHexes.length + ' 格，列数 ' + hx2.cols + '）',
     roadHexes.length >= hx2.cols * 0.7 && roadHexes.length <= hx2.cols + 2);
  ck('路不抢主地形（路上那格仍是草地）', roadHexes.every(h => h.terr === 'empty'));
  /* 只刷 1 个 5m 格的路 ⇒ 0.1% 面积 ⇒ 不算"这一格有路" */
  const grid3 = new Uint8Array(GW * GH);
  grid3[0] = api.GRID_IDX.road;
  const gm3 = Object.assign({}, gm, { layers: [{ visible: true, grid: grid3 }],
    objectives: [], _hex: null, _composedGrid: null, _rev: 0 });
  const hx3 = api.bakeHexMap(gm3);
  ck('只有 1 个 5m 格的路 ⇒ 不算公路格（阈值 1.5%）',
     hx3.hexes.filter(h => h && h.road).length === 0);
  /* 20m 宽的河：主地形仍按多数（草地），但记成"水域" ⇒ 过河照样按河的成本 */
  const grid4 = new Uint8Array(GW * GH);
  for (let y = 40; y < 44; y++) for (let x = 0; x < GW; x++) grid4[y * GW + x] = api.GRID_IDX.river;
  const gm4 = Object.assign({}, gm, { layers: [{ visible: true, grid: grid4 }],
    objectives: [], _hex: null, _composedGrid: null, _rev: 0 });
  const hx4 = api.bakeHexMap(gm4);
  const waterHexes = hx4.hexes.filter(h => h && h.water);
  ck('20m 河 ⇒ 记成水域叠加属性（主地形仍按多数 = 草地）',
     waterHexes.length > 0 && waterHexes.every(h => h.terr === 'empty'));
  ck('水域照样挡车（轮式进不去 / 徒步按河 3 点）', waterHexes.length > 0 &&
     waterHexes.every(h => api.hexMoveCost(h, 'wheeled') === Infinity &&
                           api.hexMoveCost(h, 'foot') === 3));
})();

/* ---------- ①b ★ R10.23：部署（遭遇 20%/20%，攻防 80%/20%） ---------- */
ck('开局先进部署阶段（不是直接开打）', W.phase === 'deploy');
ck('部署阶段棋盘上还没有棋子', W.counters.length === 0);
const anchors = api.spawnAnchors(W.gm);
const nDeploy = api.deployableCount(W.hx);
const zBlue = W.deploy.zone.blue.size, zRed = W.deploy.zone.red.size;
ck('遭遇：蓝方部署区 ≈ 20%（' + zBlue + '/' + nDeploy + '）',
   Math.abs(zBlue / nDeploy - 0.20) < 0.02);
ck('遭遇：红方部署区 ≈ 20%（' + zRed + '/' + nDeploy + '）',
   Math.abs(zRed / nDeploy - 0.20) < 0.02);
ck('遭遇：两个部署区不重叠（中间 60% 是无人区）',
   [...W.deploy.zone.blue].every(k => !W.deploy.zone.red.has(k)));
const atkBlue = api.deployZone(W.hx, 'blue', 'attack', 'red', anchors);
const atkRed = api.deployZone(W.hx, 'red', 'attack', 'red', anchors);
ck('攻防：防守方（红）≈ 80%（' + atkRed.size + '/' + nDeploy + '）',
   Math.abs(atkRed.size / nDeploy - 0.80) < 0.03);
ck('攻防：进攻方（蓝）≈ 20%（' + atkBlue.size + '/' + nDeploy + '）',
   Math.abs(atkBlue.size / nDeploy - 0.20) < 0.03);
ck('攻防：防守方的 80% 从"自己那一头"数（红锚点附近一定在区内）',
   [...atkRed].some(k => {
     const h = api.hexAt(W.hx, k % 10000, Math.floor(k / 10000));
     return h && Math.hypot(h.x - anchors.red.x, h.y - anchors.red.y) < 300;
   }));

/* 手动放一个 → 撤回 ⇒ 回到待部署清单；区外放不下 */
const st0 = W.deploy;
const c1 = st0.bench.blue[0];
const benchN = st0.bench.blue.length;
let spot = null, outHex = null;
for (const key of st0.zone.blue) {
  const h = api.hexAt(W.hx, key % 10000, Math.floor(key / 10000));
  if (h && api.countersAt(W.counters, h).length === 0) { spot = h; break; }
}
for (let rr = 0; rr < W.hx.rows && !outHex; rr++) {
  for (let cc = 0; cc < W.hx.cols && !outHex; cc++) {
    const h = api.hexAt(W.hx, cc, rr);
    if (h && !st0.zone.blue.has(api.hexKey(h)) && isFinite(api.hexMoveCost(h, 'foot'))) outHex = h;
  }
}
ck('手动部署：点区内格子能放下', !!spot && api.placeCounter(c1, spot) === true &&
   c1.hex === spot && W.counters.indexOf(c1) >= 0 && st0.bench.blue.length === benchN - 1);
ck('部署区外放不下（会提示"这格不在你的部署区"）',
   !!outHex && api.placeCounter(c1, outHex) === false);
const undoOk = api.undoLast();
ck('部署阶段撤回 ⇒ 棋子回到待部署清单（undo=' + undoOk + ' / bench ' +
   st0.bench.blue.length + '/' + benchN + ' / hex=' + (c1.hex ? 'y' : 'n') +
   ' / inCounters=' + (W.counters.indexOf(c1) >= 0) + '）',
   st0.bench.blue.length === benchN && c1.hex === null && W.counters.indexOf(c1) < 0);

/* 一键部署 → 完成 → 换红方 → 再一键 → 完成 ⇒ 开打 */
const nAuto = api.autoDeployAll();
const blue = api.countersAlive(W.counters, 'blue');
ck('一键部署把蓝方 9 个棋子都放下（' + nAuto + ' 个）', blue.length === 9);
ck('放下的棋子都在蓝方部署区里',
   blue.every(c => W.deploy.zone.blue.has(api.hexKey(c.hex))));
ck('部署不重叠（一格只放一个）',
   new Set(blue.map(c => api.hexKey(c.hex))).size === blue.length);
api.finishDeploySide();
ck('蓝方完成后轮到红方部署', W.deploy.side === 'red' && W.phase === 'deploy');
api.autoDeployAll();
const red = api.countersAlive(W.counters, 'red');
ck('红方一键部署也是 9 个', red.length === 9);
api.finishDeploySide();
ck('双方部署完成 ⇒ 进入战斗（phase=play）', W.phase === 'play' && W.running === true);
ck('一格一个棋子：3 排 × 3 班 = 9 个（蓝 ' + blue.length + ' / 红 ' + red.length + '）',
   blue.length === 9 && red.length === 9);
ck('每个棋子都站在格子上', W.counters.every(c => !!c.hex));

/* ---------- ①c ★ R10.23：胜利目标（全歼 / 占领 / 防守 N 回合，不再算据点分） ---------- */
ck('遭遇默认目标：双方全歼', W.goals.blue.kind === 'annihilate' && W.goals.red.kind === 'annihilate');
const fakeBlue = { side: 'blue', dead: false, hex: { obj: 0 }, members: [{ alive: true }], kind: 'inf' };
const fakeRed = { side: 'red', dead: false, hex: { obj: 0 }, members: [{ alive: true }], kind: 'inf' };
ck('据点控制：同格各一个 ⇒ 争夺中', api.objectiveControl([fakeBlue, fakeRed], 0).owner === null);
ck('据点控制：净优势判控制', api.objectiveControl([fakeBlue, fakeBlue, fakeRed], 0).owner === 'blue');
ck('占领判定：控制住就赢',
   api.victoryGoals([fakeBlue, fakeBlue, fakeRed],
     { blue: { kind: 'capture', obj: 0 }, red: { kind: 'annihilate' } },
     { blue: 0, red: 0 }).winner === 'blue');
const heldTest = { blue: 0, red: 0 };
api.holdTick([fakeBlue], { blue: { kind: 'hold', obj: 0, turns: 2 } }, heldTest, 'blue');
ck('防守计数：控制住 +1', heldTest.blue === 1);
api.holdTick([fakeRed], { blue: { kind: 'hold', obj: 0, turns: 2 } }, heldTest, 'blue');
ck('防守计数：丢了清零', heldTest.blue === 0);
ck('防守判定：守满 N 回合才赢',
   api.victoryGoals([fakeBlue, fakeRed],
     { blue: { kind: 'hold', obj: 0, turns: 2 }, red: { kind: 'annihilate' } },
     { blue: 2, red: 0 }).winner === 'blue' &&
   api.victoryGoals([fakeBlue, fakeRed],
     { blue: { kind: 'hold', obj: 0, turns: 2 }, red: { kind: 'annihilate' } },
     { blue: 1, red: 0 }) === null);
ck('全歼判定：敌方棋子全没了',
   api.victoryGoals([fakeBlue], { blue: { kind: 'annihilate' }, red: { kind: 'annihilate' } },
     { blue: 0, red: 0 }).winner === 'blue');
ck('超时判定：按剩余兵力（不是据点分）',
   api.timeUpWinner([fakeBlue, fakeBlue, fakeRed]) === 'blue' &&
   api.timeUpWinner([fakeBlue, fakeRed]) === null);
ck('目标文案可读：「' + api.goalLabel({ kind: 'hold', obj: 2, turns: 8 }) + '」',
   /防守据点 3/.test(api.goalLabel({ kind: 'hold', obj: 2, turns: 8 })));

const c0 = blue[0];
ck('班：9 人、射程 6 格（轻机枪 600m 封顶 6）、反装甲 FLV=1',
   api.counterMen(c0) === 9 && api.counterRangeHex(c0) === 6);
ck('棋子强度文本可读：' + api.counterStrengthLabel(c0), /9\/9/.test(api.counterStrengthLabel(c0)));

/* ---------- ①b 兵牌：必须复用兵牌库（北约符号）+ 写番号 ---------- */
const symSvg = api.buildSymbol(c0.type || 'infantry', c0.echelon || 'squad', null);
ck('兵牌库 buildSymbol 可用（返回 SVG）',
   (typeof symSvg === 'string') && symSvg.indexOf('<svg') === 0);
ck('符号已转成图片并标记 loaded',
   !!api.wgSymbolImage(c0.type || 'infantry', c0.echelon || 'squad', null));
ck('番号是北约式层级链（' + api.counterDesignation(c0) + '）',
   api.counterDesignation(c0) === 'B/1/11');
ck('侧栏有完整上级链（' + api.pathLabel(c0) + '）',
   api.pathLabel(c0).indexOf('B-连') === 0);

/* 所有兵种 × 梯队都要能生成**合法**兵牌（SVG 里不许混进 undefined / NaN） */
let badSym = [];
let symTotal = 0;
for (const tp of Object.keys(api.TYPES)) {
  for (const e of ['squad', 'platoon', 'company', 'battalion']) {
    symTotal++;
    const svg = api.buildSymbol(tp, e, null);
    if (!svg || svg.indexOf('undefined') >= 0 || svg.indexOf('NaN') >= 0) badSym.push(tp + '/' + e);
  }
}
ck('全部兵种×梯队都能生成合法兵牌（' + symTotal + ' 组，例外 ' + badSym.length + '）',
   badSym.length === 0);

/* ★ R10.31：标准库目录（数据源 = MIL-STD-2525D / APP-6，和 map.army 的 Formations 同源） */
const CAT_ITEMS = (function () {
  const out = [];
  for (const c of api.MS_CATALOG) for (const sb of c.subs) for (const it of sb.items) out.push(it);
  return out;
})();
ck('兵牌库按兵种分成独立页签（' + api.MS_CATALOG.length + ' 个 / ' + CAT_ITEMS.length + ' 个兵牌）',
   api.MS_CATALOG.length >= 15 && CAT_ITEMS.length >= 300 &&
   api.MS_CATALOG.every(c => c.subs.length === 1 && c.subs[0].n === c.n));
ck('全是陆地单位（SIDC 第 3 位 = G，长方形框，没有空中 A / 太空 P / 海面 S / 水下 U / 特战 F）',
   CAT_ITEMS.every(it => it.s.charAt(2) === 'G') &&
   CAT_ITEMS.every(it => ['A', 'P', 'S', 'U', 'F'].indexOf(it.s.charAt(2)) < 0));
ck('兵种页签：' + api.MS_CATALOG.map(c => c.n + '(' + c.subs[0].items.length + ')').join('、'),
   ['步兵', '装甲兵', '炮兵', '反坦克', '防空兵', '陆军航空兵', '侦察兵', '工程兵',
    '防化兵', '通信兵', '情报与电子战', '气象与测绘', '警备与宪兵', '医疗卫勤',
    '补给与维修', '运输与投送', '人事与行政'].every(n =>
     api.MS_CATALOG.some(c => c.n === n)));
ck('没有画成「倒着的问号」的兵牌（库里不认的码已在生成时剔除）',
   (function () {
     const bad = [];
     for (const it of CAT_ITEMS) {
       const svg = api.symbolBySidc(it.s, { w: 64, h: 44 }) || '';
       if (svg.indexOf('?') >= 0 || svg.length < 200) bad.push(it.n);
     }
     if (bad.length) console.log('    有问号/空框:', bad.slice(0, 8).join(' | '));
     return bad.length === 0;
   })());
ck('目录里每条都是 15 位 SIDC',
   CAT_ITEMS.every(it => typeof it.s === 'string' && it.s.length === 15));
ck('目录按两级分类（大类 → 子类 → 条目）',
   api.MS_CATALOG.every(c => c.subs.length && c.subs.every(sb => sb.items.length && sb.n)));
ck('目录条目都进了 TYPES，且保留原来的分类（可拖到树上）',
   api.TYPES_CAT.length === api.MS_CATALOG.length &&
   api.TYPES_CAT.every(c => c.subs.every(sb => sb.keys.every(k =>
     api.TYPES[k] && api.TYPES[k].sidc && api.TYPES[k].cat === c.id))));
ck('目录条目都有中文名（抽查前 200 条）',
   CAT_ITEMS.slice(0, 200).every(it => /[\u4e00-\u9fa5]/.test(it.n)));
ck('目录兵牌都能画出图（抽样 80 个）',
   (function () {
     const bad = [];
     for (let i = 0; i < CAT_ITEMS.length; i += Math.ceil(CAT_ITEMS.length / 80)) {
       const svg = api.symbolBySidc(CAT_ITEMS[i].s, { w: 64, h: 44 });
       if (!svg || svg.length < 200) bad.push(CAT_ITEMS[i].n + '/' + CAT_ITEMS[i].s);
     }
     if (bad.length) console.log('    空白兵牌:', bad.slice(0, 6).join(' | '));
     return bad.length === 0;
   })());
ck('陆地单位里能看到步兵 / 装甲 / 野战炮兵 / 防空 这些常用兵种',
   (function () {
     const names = [];
     for (const c of api.MS_CATALOG)
       for (const sb of c.subs) for (const it of sb.items) names.push(it.n);
     return names.some(n => n.indexOf('步兵') >= 0) && names.some(n => n.indexOf('装甲') >= 0) &&
            names.some(n => n.indexOf('野战炮兵') >= 0) && names.some(n => n.indexOf('防空') >= 0);
   })());
/* ★ R10.33：堆叠 / 加强减弱 / 徽章 / 复制子树 */
(function () {
  const mk = () => api.newNode('infantry', 'platoon', 'B');
  const p = api.newNode('infantry', 'company', 'A');
  ck('新建单位默认就是「合并显示」', p.stack === true);
  p.stack = false;                       // 先关掉，测"不合并"的情况
  p.children = [mk(), mk(), mk()];
  ck('合并：3 个完全一样的下属 → 可合并', api.hasStackableChildren(p) === true);
  ck('关掉合并时 3 个都显示', api.visibleChildren(p).length === 3);
  p.stack = true;
  ck('开着合并只画 1 条分支（省 2 个位置）', api.visibleChildren(p).length === 1);
  ck('合并数量 = 3（画 3 张叠起来的兵牌）',
     api.stackSizeOf(api.visibleChildren(p)[0], p) === 3);
  p.children[1].name = 'B2';
  ck('只有两个一样时：合并成"1 条分支 + ×2"', api.visibleChildren(p).length === 2);
  p.children[2].name = 'B3';
  ck('下属各不相同就不算相同 → 全部展开',
     api.hasStackableChildren(p) === false && api.visibleChildren(p).length === 3);
})();
(function () {
  const t = api.newNode('infantry', 'company', 'X');
  t.mod = '+'; t.badge = 'data:image/png;base64,AAA'; t.stack = true;
  const back = api.deserializeOrg(api.serializeOrg(t));
  ck('加强/减弱 · 徽章 · 堆叠 存盘再读回来都还在',
     back.mod === '+' && back.badge === 'data:image/png;base64,AAA' && back.stack === true);
  const parent = api.newNode('infantry', 'battalion', 'P');
  parent.children = [t];
  const cp = api.cloneSubtree(api.serializeOrg(parent));
  ck('复制 = 当前单位 + 下属一起复制（加强 / 徽章也跟着走）',
     cp.children.length === 1 && cp.children[0].mod === '+' &&
     cp.children[0].badge === 'data:image/png;base64,AAA');
})();
ck('自定义兵牌已经删干净（没有三池数据 / 没有修饰缩略图函数）',
   typeof api.symbolForMod === 'undefined' && typeof api.msFragOf === 'undefined' &&
   typeof api.MS_MAIN === 'undefined');
ck('敌方红墨兵牌也能生成', !!api.wgSymbolImage('infantry', 'squad', null, '#a01b1b'));

/* ---------- ①b2 ★ R10.24：兵牌统一由 MIL-STD-2525 库（milsymbol）绘制 ---------- */
ck('milsymbol 库已就绪 + 桥接层可用',
   typeof api.msSIDC === 'function' && typeof api.symbolSvg === 'function');
ck('SIDC 是 15 位字母码，梯队落在第 12 位（班=B）：' + api.msSIDC('infantry', 'squad', null),
   api.msSIDC('infantry', 'squad', null) === 'SFGPUCI----B---');
ck('连（E）/ 营（F）同一兵种只差梯队那一位',
   api.msSIDC('infantry', 'company', null) === 'SFGPUCI----E---' &&
   api.msSIDC('infantry', 'battalion', null) === 'SFGPUCI----F---');
ck('每个兵种都配了功能码或完整 SIDC（主图形为字母的三个除外）',
   Object.keys(api.TYPES).filter(k => !api.TYPES[k].isCustom).every(k =>
     typeof api.TYPE_SIDC[k] === 'string' || !!api.TYPES[k].sidc));
ck('防空（aaa）用的是"穹顶"功能码 UCD---', api.TYPE_SIDC.aaa === 'UCD---');
ck('兵牌真的来自库（带 viewBox 的 <svg> + 库特有的坐标）',
   (function () {
     const s = api.symbolSvg('armor', 'company', null) || '';
     return s.indexOf('<svg') === 0 && /viewBox="\d/.test(s);
   })());
ck('同一兵种不同兵种画出来不一样（不是同一个图形）',
   (function () {
     const a = api.symbolSvg('infantry', 'company', null) || '';
     const b = api.symbolSvg('armor', 'company', null) || '';
     return a !== b && a.length > 200 && b.length > 200;
   })());
ck('默认兵种库里已删掉 指挥/作战支援/宪兵/后勤/架桥',
   ['hq', 'mp', 'combat_support', 'logistics', 'bridging'].every(k => !api.TYPES[k]));
ck('山地步兵用的是"步兵 + 山地"（UCIO--），不是寒区（UCIC--）',
   api.TYPE_SIDC.mountain === 'UCIO--');
/* ---------- ①c 表格：完整距离火力表 + 三张 CRT（可拖动弹窗） ---------- */
const tankC = { kind: 'veh', armor: 200, name: '坦克',
                weapons: [{ cat: 'armored_vehicle', antiPersonnel: 30, penetration: 500,
                            range: 3000, ammo: 40 }] };
ck('射程不再封顶 6 格（坦克 3000m ⇒ 30 格）', api.counterRangeHex(tankC) === 30);
ck('长距离能看出衰减（1 格 ' + api.flvAt(tankC, 1, 'soft') + ' → 20 格 ' +
   api.flvAt(tankC, 20, 'soft') + '）',
   (api.flvAt(tankC, 1, 'soft') >= api.flvAt(tankC, 20, 'soft')) &&
   api.flvAt(tankC, 1, 'soft') >= 2);
ck('超出射程返回 null（表格显示 —）', api.flvAt(tankC, 31, 'soft') === null);

const flvHtml = api.flvTableHtml(tankC);
ck('完整火力表列出全部 30 行', (flvHtml.match(/<tr/g) || []).length >= 31);
const crtHtml = api.crtTableHtml('soft');
ck('CRT 表是 12 行 × 11 列（FLV 1..12 × 2D6 2..12）',
   (crtHtml.match(/<tr/g) || []).length === 13 &&
   (crtHtml.match(/<td/g) || []).length === 132);
api.renderSheet();
ck('表格窗内容能生成（含 CRT 字样）', String(E('wg-sheet-body').innerHTML).indexOf('CRT') >= 0);
const sp = api.splitRoll(7);
ck('2D6 能拆成两颗合法骰子（' + sp.join('+') + '=7）',
   sp[0] >= 1 && sp[0] <= 6 && sp[1] >= 1 && sp[1] <= 6 && (sp[0] + sp[1]) === 7);

/* ---------- ①c2 三张 CRT 整体向下平移一格（R10.11：FLV 1 也要有战果） ----------
   玩家："火力值为 1 的话也应该能够打出战果啊，调整一下那三张表格，
          直接将现在的数值向下平移然后再加一行就好了" */
ck('FLV 1 也能打出战果（对人员 2D6=12 → ' + api.crtLookup('soft', 1, 12) + '）',
   api.crtLookup('soft', 1, 12) !== '—');
ck('FLV 1 反装甲 12 点能打坏机动（' + api.crtLookup('at', 1, 12) + '）',
   api.crtLookup('at', 1, 12) === 'Km');
ck('FLV 1 不是白给（对人员 2D6=7 仍是 —）', api.crtLookup('soft', 1, 7) === '—');
ck('平移等价：FLV n 这一行 == 原 FLV n+1 那一行（eff 用 FLV+1）',
   api.crtEffRow(1, 12) === api.crtEff(2, 12) && api.crtEffRow(11, 7) === api.crtEff(12, 7) &&
   api.crtEffRow(5, 9) === api.crtEff(6, 9));
ck('平移后 FLV 越高仍是越来越好（12 行全 2K/3K 封顶）',
   api.crtLookup('soft', 12, 12) === '3K' && api.crtLookup('soft', 12, 2) !== '—');

/* ---------- ①d 装备数值必须真的带进来（R10.6） ----------
   预设/老存档里的装备条目只有 `{name, count}`，没有 eqId —— 旧代码只认 eqId ⇒ 全部漏掉。 */
function oneSquad(equipment, men) {
  return { type: 'infantry', echelon: 'squad', name: '测试班', personnel: (men == null ? 9 : men),
           equipment: equipment, children: [] };
}
const byNameOnly = api.buildCounters(oneSquad([{ name: '突击步枪', count: 9 }]), 'blue', 'squad');
ck('只有名字的老存档装备也能带入数值（FLV ' + api.counterFlv(byNameOnly[0], 1, 'soft') + '）',
   api.counterFlv(byNameOnly[0], 1, 'soft') >= 4);
ck('成员真的拿到枪了', byNameOnly[0].members.every(m => m.weapon && m.weapon.antiPersonnel > 0));

const maxOnly = api.buildCounters(oneSquad([{ name: '突击步枪', count: 0, countMax: 9 }]), 'blue', 'squad');
ck('只填了"编制上限"也按配发算（FLV ' + api.counterFlv(maxOnly[0], 1, 'soft') + '）',
   api.counterFlv(maxOnly[0], 1, 'soft') >= 4);

const noneAtAll = api.buildCounters(oneSquad([]), 'blue', 'squad');
ck('一件轻武器都没有时配"制式步枪"兜底（FLV ' + api.counterFlv(noneAtAll[0], 1, 'soft') + '）',
   api.counterFlv(noneAtAll[0], 1, 'soft') >= 3);

const atTeam = api.buildCounters(oneSquad([{ name: '单兵火箭筒', count: 2 }]), 'blue', 'squad');
ck('反装甲武器从库里带入穿甲（反装甲 FLV ' + api.counterFlv(atTeam[0], 1, 'hard') + '）',
   api.counterFlv(atTeam[0], 1, 'hard') >= 5);
ck('找不到的装备会被记下来（不静默）',
   (api.buildCounters(oneSquad([{ name: '不存在的激光炮', count: 1 }]), 'blue', 'squad'),
    api.takeMissingEquip().indexOf('不存在的激光炮') >= 0));

/* 真实预设编制（data.js 的 makeInfantryBattalion）—— 玩家最可能用的就是它 */
const presetBn = api.makeInfantryBattalion();
const presetC = api.buildCounters(presetBn, 'blue', 'squad');
const presetFlv = presetC.map(c => api.counterFlv(c, 1, 'soft'));
ck('内置预设编制能生成棋子（' + presetC.length + ' 个班）', presetC.length >= 9);
ck('预设班的对人员 FLV 合理（最小 ' + Math.min.apply(null, presetFlv) +
   ' / 最大 ' + Math.max.apply(null, presetFlv) + '）',
   Math.min.apply(null, presetFlv) >= 3);
ck('预设班的班用武器清单非空（' +
   (presetC[0] && presetC[0].members.filter(m => m.weapon).length) + ' 人有枪）',
   presetC[0] && presetC[0].members.filter(m => m.weapon).length >= 8);

/* ---------- ①e 真实装甲/穿深 + 距离曲线（R10.7） ----------
   玩家截图："两台谢尔曼相距 6 格，射击却显示 100% 无效" */
function veh(arm, pen, rng) {
  return { kind: 'veh', armor: arm, name: 'v',
           weapons: [{ cat: 'armored_vehicle', antiPersonnel: 25, penetration: pen,
                       range: rng, ammo: 40 }] };
}
const HX = (c) => ({ col: c, row: 0, terr: 'empty', road: false, bld: 0, obj: -1,
                     sight: 0, cover: 0 });
const sher = veh(51, 66, 2500); sher.hex = HX(0);
const sher2 = veh(51, 66, 2500); sher2.hex = HX(6);
const tiger = veh(102, 120, 3000); tiger.hex = HX(6);
const tigerShooter = veh(102, 120, 3000); tigerShooter.hex = HX(0);
const flvOf = (a, b) => api.resolveFire(null, a, b, { roll: 7 }).flv;

ck("'at' 与 'hard' 必须等价（修复前就是这个不一致）",
   api.counterFlv(sher, 6, 'at') === api.counterFlv(sher, 6, 'hard'));
ck('谢尔曼 600m 反装甲 FLV = 6（真实穿深 60mm / 标定 264）',
   api.counterFlv(sher, 6, 'hard') === 6);
ck('谢尔曼打谢尔曼 600m 能打出战果（FLV ' + flvOf(sher, sher2) + '）', flvOf(sher, sher2) >= 4);
ck('谢尔曼打虎式 600m 基本打不穿（FLV ' + flvOf(sher, tiger) + ' ≤ 3）', flvOf(sher, tiger) <= 3);
ck('虎式打谢尔曼 600m 碾压（FLV ' + flvOf(tigerShooter, sher2) + ' ≥ 8）',
   flvOf(tigerShooter, sher2) >= 8);

let noEff = 0;
const ddS = api.diceDist();
for (let r = 2; r <= 12; r++) {
  if (api.resolveFire(null, sher, sher2, { roll: r }).code === '—') noEff += ddS[r];
}
ck('谢尔曼互射不再"100% 无效"（无效概率 ' + Math.round(noEff * 100) + '%）', noEff < 0.2);

ck('动能弹穿深随距离下降（600m ' + Math.round(api.counterPenetration(sher, 6)) +
   'mm > 2000m ' + Math.round(api.counterPenetration(sher, 20)) + 'mm）',
   api.counterPenetration(sher, 6) > api.counterPenetration(sher, 20));

const baz = { kind: 'inf', members: [],
              supports: [{ cat: 'at_weapon', antiPersonnel: 0, penetration: 100,
                           range: 300, lethalRadius: 0 }] };
ck('破甲弹（HEAT）穿深不随距离衰减',
   api.counterPenetration(baz, 1) === api.counterPenetration(baz, 2));
ck('超出射程穿深归零（火箭筒 300m，4 格 = 400m）', api.counterPenetration(baz, 4) === 0);

/* ---------- ①f 装备清单 + 多武器 + 按目标类型选武器（R10.8） ---------- */
const mixed = api.buildCounters(oneSquad([
  { name: '突击步枪', count: 8 },
  { name: '轻机枪', count: 1 },
  { name: '单兵火箭筒', count: 2 },
]), 'blue', 'squad')[0];
const equipHtml = api.equipListHtml(mixed);
ck('装备清单把全部装备都列出来（含火箭筒）',
   equipHtml.indexOf('步枪') >= 0 && equipHtml.indexOf('轻机枪') >= 0 &&
   equipHtml.indexOf('火箭筒') >= 0);
ck('一个人可以同时带多件武器（步枪 + 火箭筒）',
   mixed.members.some(m => (m.weapons || []).length >= 2));
ck('打软目标：软 FLV ' + api.counterFlv(mixed, 1, 'soft') + '（只用枪，不拿火箭筒凑数）',
   api.counterFlv(mixed, 1, 'soft') >= 4 && api.counterFlv(mixed, 1, 'soft') <= 6);
ck('打硬目标：反装甲 FLV ' + api.counterFlv(mixed, 1, 'hard') + '（只用火箭筒）',
   api.counterFlv(mixed, 1, 'hard') >= 5);
const uwSoft = api.counterUsedWeapons(mixed, 1, 'soft').map(u => u.name).join('、');
const uwHard = api.counterUsedWeapons(mixed, 1, 'hard').map(u => u.name).join('、');
ck('软目标"使用武器"里没有火箭筒（' + uwSoft + '）', uwSoft.indexOf('火箭筒') < 0);
ck('硬目标"使用武器"里只有火箭筒（' + uwHard + '）',
   uwHard.indexOf('火箭筒') >= 0 && uwHard.indexOf('步枪') < 0);

/* ---------- ①g 武器口径必须一致（R10.9） ----------
   踩过的坑：引入"一人多武器"后，射程/穿深还在读"主武器"单件
   ⇒ 被分给某士兵的导弹/重机枪不计射程，射程表只到步枪的 5 格。 */
const ranged = api.buildCounters(oneSquad([
  { name: '半自动步枪', count: 12 },   // 450m
  { name: '反坦克导弹', count: 2 },     // 4000m（HEAT）
]), 'blue', 'squad')[0];
function maxRangeHexOf(c) {
  let best = 0;
  api.eachWeapon(c, w => {
    if (!w) return;
    if (w.cat === 'artillery' || w.cat === 'infantry_arty') return;
    best = Math.max(best, w.range || 0);
  });
  return Math.floor(best / 100);
}
ck('射程取全部武器里最远的（' + api.counterRangeHex(ranged) + ' 格 = 4000m）',
   api.counterRangeHex(ranged) === 40);
ck('射程口径 = 最远武器，不许各算各的',
   api.counterRangeHex(ranged) === maxRangeHexOf(ranged));
ck('远距离反装甲仍能打到（30 格 FLV ' + api.counterFlv(ranged, 30, 'hard') + '）',
   api.counterFlv(ranged, 30, 'hard') >= 8);
ck('穿深取最强武器（导弹 600mm）', api.counterPenetration(ranged, 1) >= 500);
ck('射程表能列出导弹的全部距离', (api.flvTableHtml(ranged).match(/<tr/g) || []).length >= 41);

/* ---------- ①h 枪比人多：多出来的枪不许丢（R10.10） ----------
   玩家截图：12 人配「步枪×12 + 重机枪×1」，现存武器里没有重机枪、
   射程只按 500m 的步枪算 ⇒ 火力表只到 5 格。
   真凶：`members[i] = sa[i % sa.length]` 的 i 只到 count-1，第 13 件被静默丢掉。 */
const overArm = api.buildCounters(oneSquad([
  { name: '突击步枪', count: 12 },   // 500m
  { name: '重机枪', count: 1 },       // 1000m
], 12), 'blue', 'squad')[0];
const overArmNames = [];
api.eachWeapon(overArm, w => { if (w) overArmNames.push(w.name); });
ck('多出来的重机枪没被丢掉（现存武器：' + overArmNames.join('、') + '）',
   overArmNames.indexOf('重机枪') >= 0 && overArmNames.length === 13);
ck('射程按最远的重机枪算（' + api.counterRangeHex(overArm) + ' 格 = 1000m，不是步枪的 5 格）',
   api.counterRangeHex(overArm) === 10);
ck('12 个人、13 件枪：有人同时带两件（不新增士兵）',
   overArm.members.length === 12 && overArm.members.some(m => (m.weapons || []).length === 2));
ck('火力表按 10 格铺满（不再是 5 行）',
   (api.flvTableHtml(overArm).match(/<tr/g) || []).length >= 11);
ck('枪比人少时仍按人循环配发（旧观感不变）',
   (function () {
     const few = api.buildCounters(oneSquad([{ name: '突击步枪', count: 5 }], 9), 'blue', 'squad')[0];
     return few.members.length === 9 && few.members.every(m => (m.weapons || []).length === 1);
   })());

/* ---------- ①i 炮兵：山炮 + 卡车也能打（R10.12） ----------
   玩家截图：`75mm山炮（射程 9000m）+ 运输卡车` 的炮兵阵地「射程 1 格、对人员 —、反装甲 —」，点敌人打不了。
   真凶：① 车辆分支只给卡车配武器，山炮被丢掉；② 射程只看直射；
        ③ 结算写死 soft（炮击表 art 从没被用过）、视线照旧要通。 */
function oneNode(type, men, equipment) {
  return { type: type, echelon: 'squad', name: '测试' + type, personnel: men,
           equipment: equipment, children: [] };
}
const battery = api.buildCounters(oneNode('artillery', 5, [
  { name: '75mm山炮', count: 1 },     // 9000m，杀伤半径 20m
  { name: '运输卡车', count: 1 },      // 支援车辆（没有武器数值）
]), 'blue', 'squad')[0];
ck('炮兵阵地的山炮被保留（supports：' +
   (battery.supports || []).map(s => s.name).join('、') + '）',
   (battery.supports || []).some(s => s.name === '75mm山炮'));
ck('卡车不再发"射程 1 格的空气枪"（weapons ' + battery.weapons.length + ' 件）',
   battery.weapons.length === 0);
ck('间瞄射程 ' + api.counterArtRangeHex(battery) + ' 格（9000m）· 直射 ' +
   api.counterRangeHex(battery) + ' 格 · 最大 ' + api.counterMaxRangeHex(battery) + ' 格',
   api.counterArtRangeHex(battery) === 90 && api.counterRangeHex(battery) === 0 &&
   api.counterMaxRangeHex(battery) === 90);
ck('炮击 FLV 不再恒 1（5 格炮击 FLV ' + api.counterFlv(battery, 5, 'art') + '）',
   api.counterFlv(battery, 5, 'art') >= 2);
ck('侧栏射程表列出「炮击」行', api.flvTableHtml(battery).indexOf('炮击') >= 0);

/* 真地图上摆两个棋子：炮击不看视线、结算也走 art 表 */
const artyTarget = api.buildCounters(oneSquad([{ name: '突击步枪', count: 9 }], 9), 'red', 'squad')[0];
battery.hex = api.hexAt(W.hx, 1, 1);
artyTarget.hex = api.hexAt(W.hx, 9, 5);
const artySit = api.fireSituation(W.hx, battery, artyTarget);
ck('间瞄不看视线：判定通过（kind=' + artySit.kind + '，距离 ' + artySit.dist + ' 格）',
   artySit.ok && artySit.kind === 'art');
const artyRes = api.resolveFire(W.hx, battery, artyTarget, { roll: 12 });
ck('结算也走炮击表（kind=' + artyRes.kind + '，' + api.counterUsedWeapons(battery, 5, 'art')
   .map(u => u.name).join('、') + '）',
   artyRes.kind === 'art' && artyRes.usedWeapons.some(u => u.name === '75mm山炮'));
ck('纯卡车棋子打不了（没有武器）', (function () {
  const truck = api.buildCounters(oneNode('supply', 2, [{ name: '运输卡车', count: 1 }]), 'blue', 'squad')[0];
  return api.counterMaxRangeHex(truck) === 0;
})());

/* ---------- ② 移动 ---------- */
api.selectCounter(c0);
const reach0 = W.reach ? W.reach.size : 0;
ck('选中本方棋子后给出可移动范围（' + reach0 + ' 格）', reach0 > 0);
let dest = null;
for (const [key] of W.reach) {
  const h = api.hexAt(W.hx, key % 10000, Math.floor(key / 10000));
  if (h && h.terr === 'empty') { dest = h; break; }
}
const mpBefore = c0.mp;
if (!dest) { for (const [key] of W.reach) { dest = api.hexAt(W.hx, key % 10000, Math.floor(key / 10000)); break; } }
/* 移动前：路径必须能从 came 回溯出来（玩家要看"走的哪条路"） */
const pth = api.buildPath(W.hx, W.reachCame, c0.hex, dest);
ck('能回溯出移动路径（' + pth.length + ' 格）',
   pth.length >= 2 && pth[0] === c0.hex && pth[pth.length - 1] === dest);
api.moveSelected(dest);
ck('移动成功并扣 MP（' + mpBefore + ' → ' + c0.mp + '）', c0.mp < mpBefore);
ck('移动后落点正确', c0.hex === dest);

/* ---------- ③ 开火（★ R10.8：移动/攻击二选一 ⇒ 必须换一个没动过的棋子来打） ---------- */
const shooter = api.countersAlive(W.counters, 'blue').find(x => x !== c0 && !x.acted);
const foe = red[0];
let adj = null;
for (const nb of api.hexNeighbors(shooter.hex.col, shooter.hex.row)) {
  const h = api.hexAt(W.hx, nb.col, nb.row);
  if (h) { adj = h; break; }
}
foe.hex = adj;
ck('已移动过的棋子不能攻击（移动/攻击二选一）',
   api.fireSituation(W.hx, c0, foe).ok === false);

api.selectCounter(shooter);
const sit = api.fireSituation(W.hx, shooter, foe);
ck('相邻 1 格可以开火（' + sit.dist + ' 格 / 射程 ' + sit.range + '）', sit.ok);

api.openFirePreview(shooter, foe);
ck('开火预览面板里有"开火"按钮', E('wg-fire').innerHTML.indexOf('wg-do-fire') >= 0);
ck('预览写了 2D6 概率', E('wg-fire').innerHTML.indexOf('2D6') >= 0);
ck('预览写了"使用武器"（按目标类型挑武器）',
   E('wg-fire').innerHTML.indexOf('使用武器') >= 0);

const menBefore = api.counterMen(foe);
api.doFire();
ck('开火后射手标记已攻击', shooter.fired === true && shooter.acted === 'fire');
api.selectCounter(shooter);
ck('攻击过的棋子不能再移动（没有可移动范围）', !W.reach || W.reach.size === 0);

/* 战果必须与结算代号**自洽**（不赌"一定有战果"） */
const fireLine = W.log.filter(o => o.text.indexOf('⇒') >= 0).pop();
const codeM = fireLine ? /⇒ ([^（]+)/.exec(fireLine.text) : null;
const code = codeM ? codeM[1].trim() : '';
ck('日志里有结算代号（' + (code || '无') + '）', code !== '');
if (code === '—') {
  ck('无效果 ⇒ 人数不变且没被压制', api.counterMen(foe) === menBefore && !foe.suppressed);
} else if (code === 'S') {
  ck('压制 ⇒ 人数不变但被压制', api.counterMen(foe) === menBefore && foe.suppressed === true);
} else {
  ck(code + ' ⇒ 掉人（' + menBefore + ' → ' + api.counterMen(foe) + '）',
     api.counterMen(foe) < menBefore);
}
ck('日志有记录（' + W.log.length + ' 条）', W.log.length > 0);
ck('同回合不能再打第二枪', api.fireSituation(W.hx, shooter, foe).ok === false);

/* ---------- ④ 换回合 ---------- */
api.endTurn();
ck('结束回合 → 红方回合', W.side === 'red' && W.turn === 1);
api.endTurn();
ck('再结束 → 第 2 回合，射手恢复行动', W.side === 'blue' && W.turn === 2 &&
   shooter.fired === false && shooter.acted === null);
ck('新回合 MP 回满', shooter.mp === shooter.mpMax);

/* ---------- ⑤ 据点 / 胜负 ---------- */
const obj = api.objectiveTally();
ck('据点统计（共 ' + obj.total + ' 个）', obj.total > 0);
for (const c of api.countersAlive(W.counters, 'red')) c.dead = true;
api.finishGame();
ck('一方被全歼 → 战斗结束（running=false）', W.running === false);

/* ---------- ⑨ 六角格地图编辑器产物：hexData → 兵棋格子（R10.13） ----------
   地图编辑器不存 5m 光栅，只存"每格是什么"（hexData）；兵棋这里必须**原样照抄**。 */
const hxSize = api.hexMapSize(5, 4);
const hd = { cols: 5, rows: 4,
             terr: new Array(20).fill('empty'), road: new Array(20).fill(0),
             obj: new Array(20).fill(-1), deploy: new Array(20).fill('') };
hd.terr[1 * 5 + 2] = 'forest';
hd.terr[2 * 5 + 0] = 'house';
hd.road[2 * 5 + 1] = 1;
hd.obj[3 * 5 + 4] = 0;
hd.deploy[0] = 'blue';
hd.deploy[19] = 'red';
const hexMap = { id: 'hxTest', name: '手绘测试图', cols: 5, rows: 4,
                 w: hxSize.w, h: hxSize.h, hexData: hd,
                 objectives: [{ id: 'o1', name: '据点 1', x: 0, y: 0, r: 110 }] };
api.GRID_MAPS['hxTest'] = hexMap;
const hx2 = api.bakeHexMap(hexMap);
ck('编辑器地图直接生成六角格（' + hx2.cols + '×' + hx2.rows + ' = ' +
   hx2.hexes.filter(Boolean).length + ' 格）',
   hx2.cols === 5 && hx2.rows === 4 && hx2.hexes.filter(Boolean).length === 20);
ck('画的地形原样进来（(2,1) 树林 / (0,2) 城区）',
   api.hexAt(hx2, 2, 1).terr === 'forest' && api.hexAt(hx2, 0, 2).terr === 'house');
ck('公路是叠加属性（(1,2) 草地 + 公路）',
   api.hexAt(hx2, 1, 2).road === true && api.hexAt(hx2, 1, 2).terr === 'empty');
ck('据点编号原样进来（(4,3) = 0）', api.hexAt(hx2, 4, 3).obj === 0);
ck('部署区原样进来（(0,0) 蓝 / (4,3) 红）',
   api.hexAt(hx2, 0, 0).deploy === 'blue' && api.hexAt(hx2, 4, 3).deploy === 'red');

/* 真的用这张图开局：部署区只有 1 格 ⇒ 双方各落 1 个棋子（其余当预备队） */
E('wg-map').value = 'hxTest';
api.startGame();
deployAll();
ck('兵棋能选中编辑器地图并开局（' + api.W.hx.cols + '×' + api.W.hx.rows + ' 格）',
   api.W.hx.cols === 5 && api.W.hx.rows === 4);
ck('手绘六角格地图没有光栅底图（自动回退纯色渲染）', api.mapBaseAvailable() === false);
const blueZone = api.countersAlive(api.W.counters, 'blue');
ck('蓝方按地图部署区落子（' + blueZone.length + ' 个 → (' +
   (blueZone[0] ? blueZone[0].hex.col + ',' + blueZone[0].hex.row : '—') + ')）',
   blueZone.length === 1 && blueZone[0].hex.col === 0 && blueZone[0].hex.row === 0);
const redZone = api.countersAlive(api.W.counters, 'red');
ck('红方按地图部署区落子（' + redZone.length + ' 个）',
   redZone.length === 1 && redZone[0].hex.deploy === 'red');

/* ---------- ①k 装甲目标不会被压制（R10.14） ---------- */
const sRes = api.resolveFire(null, sher, sher2, { roll: 2 });
ck('反装甲表的 S 对坦克算无效果（2D6=2 → ' + sRes.code + '）', sRes.code === '—');
const dummyVeh = { kind: 'veh', suppressed: false, armor: 51, dead: false, km: false, kf: false };
const sOut = api.applyFireResult({ kind: 'at', code: 'S' }, sher, dummyVeh);
ck('坦克不会被压制（applyFireResult 双保险）',
   sOut.suppressed === false && dummyVeh.suppressed === false);
const dummyInf = { kind: 'inf', suppressed: false, members: [{ alive: true }] };
api.applyFireResult({ kind: 'soft', code: 'S' }, sher, dummyInf);
ck('步兵照样会被压制（规则只对装甲豁免）', dummyInf.suppressed === true);

/* ---------- ①l 炮击散布（R10.15） ---------- */
const tgtHex = api.hexAt(hx2, 1, 1);           // ⑨ 里那张 5×4 手绘图（格子够、地形已知）
const scat = api.artScatterHex(hx2, tgtHex, (function () {
  let i = 0; const seq = [0.0, 0.5];        // 第一次：散（<35%）；第二次：选第 3 个邻居
  return function () { return seq[(i++) % seq.length]; };
})());
ck('炮击会散（' + tgtHex.col + ',' + tgtHex.row + ' → ' + (scat ? scat.col + ',' + scat.row : '无') + '）',
   !!scat && !(scat.col === tgtHex.col && scat.row === tgtHex.row));
ck('落点一定在目标的六个邻居里',
   api.hexNeighbors(tgtHex.col, tgtHex.row).some(q => scat && q.col === scat.col && q.row === scat.row));
ck('没掷中散布就不偏（rnd=0.99 → null）', api.artScatterHex(hx2, tgtHex, () => 0.99) === null);
ck('散布概率来自 core 常量（' + Math.round(api.ART_SCATTER_CHANCE * 100) + '%）',
   api.ART_SCATTER_CHANCE > 0 && api.ART_SCATTER_CHANCE < 1);

/* ---------- ⑩ 撤回上一步（R10.16） ----------
   专门造一张全空的小地图：移动/开火都不受地形影响，断言干净。 */
const undoHd = { cols: 12, rows: 9,
                 terr: new Array(108).fill('empty'), road: new Array(108).fill(0),
                 obj: new Array(108).fill(-1), deploy: new Array(108).fill('') };
const undoSize = api.hexMapSize(12, 9);
api.GRID_MAPS['hxUndo'] = { id: 'hxUndo', name: '撤销测试图', w: undoSize.w, h: undoSize.h,
                            hexData: undoHd, objectives: [] };
E('wg-map').value = 'hxUndo';
api.startGame();
deployAll();
api.W.motion = false;

const uc = api.countersAlive(api.W.counters, 'blue')[0];
const fromCol = uc.hex.col, fromRow = uc.hex.row, mp0 = uc.mp;
api.selectCounter(uc);
let undoDest = null;
for (const [key] of api.W.reach) {
  const h = api.hexAt(api.W.hx, key % 10000, Math.floor(key / 10000));
  if (h && !api.countersAlive(api.W.counters).some(c => c.hex === h)) { undoDest = h; break; }
}
api.moveSelected(undoDest);
ck('移动后棋子换了格子（' + fromCol + ',' + fromRow + ' → ' + uc.hex.col + ',' + uc.hex.row + '）',
   uc.hex.col !== fromCol || uc.hex.row !== fromRow);
ck('移动后扣了 MP 且标成"已移动"', uc.mp < mp0 && uc.acted === 'move');
api.undoLast();
ck('撤回移动：位置 / MP / 行动权全部还原',
   uc.hex.col === fromCol && uc.hex.row === fromRow && uc.mp === mp0 && uc.acted === null);

/* 撤回开火：人数、行动标记、日志长度一起回滚 */
const atk2 = api.buildCounters(oneSquad([{ name: '突击步枪', count: 9 }], 9), 'blue', 'squad')[0];
const def2 = api.buildCounters(oneSquad([{ name: '突击步枪', count: 9 }], 9), 'red', 'squad')[0];
atk2.hex = api.hexAt(api.W.hx, 4, 4);
def2.hex = api.hexAt(api.W.hx, 5, 4);
api.W.counters.push(atk2, def2);
api.selectCounter(atk2);
api.openFirePreview(atk2, def2);
const menBefore2 = api.counterMen(def2);
const logBefore = api.W.log.length;
api.doFire();
ck('开火后射手标记已射击（' + (api.W.lastFire ? api.W.lastFire.code : '?') + '）',
   atk2.fired === true && atk2.acted === 'fire');
api.undoLast();
ck('撤回开火：人数 / 标记 / 战报一起回滚',
   api.counterMen(def2) === menBefore2 && atk2.fired === false && atk2.acted === null &&
   def2.dead === false && api.W.log.length <= logBefore + 2);
ck('撤销栈空时再撤 = 什么都不做',
   api.W.undo.length === 0 && api.undoLast() === false);

/* ---------- ⑪ 1 回合 = 60 秒 / 逐人明细 / 尸体 / 临机射击（R10.18~R10.21） ---------- */
ck('1 回合 = ' + api.TURN_SECONDS + ' 秒，徒步 ' + api.MP_MAX.foot + ' 格（车辆不变）',
   api.TURN_SECONDS === 60 && api.MP_MAX.foot === 2 && api.MP_MAX.wheeled === 8 &&
   api.MP_MAX.tracked === 6);

/* 逐人明细：名字按武器起、阵亡黑掉 */
const named = api.buildCounters(oneSquad([
  { name: '突击步枪', count: 7 },
  { name: '轻机枪', count: 2 },
], 9), 'blue', 'squad')[0];
const nm = named.members.map(m => m.name);
ck('逐人按武器起名（' + nm[0] + '、' + nm[1] + '…、' + nm[7] + '）',
   nm[0] === '步枪兵1' && nm[1] === '步枪兵2' && nm[7] === '机枪兵1');
ck('面板列出每个人的名字与武器', (function () {
  const h = api.rosterHtml(named);
  return h.indexOf('步枪兵1') >= 0 && h.indexOf('突击步枪') >= 0 && h.indexOf('机枪兵1') >= 0;
})());
named.members[0].alive = false;
ck('阵亡的人整行黑掉（class="man dead" + 骷髅）',
   api.rosterHtml(named).indexOf('man dead') >= 0 && api.rosterHtml(named).indexOf('☠') >= 0);

/* 尸体黑点 */
const corpseC = { id: 'cCorpse', kind: 'inf', corpses: [] };
api.addCorpses(corpseC, 3);
ck('阵亡生成尸体点（' + corpseC.corpses.length + ' 个）', corpseC.corpses.length === 3);

/* 临机射击：纯函数触发判定（全空小图，不受地形干扰） */
const oppHd = { cols: 8, rows: 6,
                terr: new Array(48).fill('empty'), road: new Array(48).fill(0),
                obj: new Array(48).fill(-1), deploy: new Array(48).fill('') };
const oppSize = api.hexMapSize(8, 6);
api.GRID_MAPS['hxOpp'] = { id: 'hxOpp', name: '临机测试图', w: oppSize.w, h: oppSize.h,
                           hexData: oppHd, objectives: [] };
const oppHx = api.bakeHexMap(api.GRID_MAPS['hxOpp']);
const mkSquad = (side) => api.buildCounters(
  oneSquad([{ name: '突击步枪', count: 9 }], 9), side, 'squad')[0];

const shA = mkSquad('blue');
shA.hex = api.hexAt(oppHx, 2, 2);
const mover = mkSquad('red');
const mPath = [api.hexAt(oppHx, 4, 2), api.hexAt(oppHx, 3, 2)];
mover.hex = mPath[0];
const trig = api.opportunityTriggers(oppHx, [shA, mover], mover, mPath, 'red');
ck('走进视线+射程 ⇒ 记一次临机射击（step=' + (trig[0] ? trig[0].step : '—') + '）',
   trig.length === 1 && trig[0].shooter === shA && trig[0].step === 1);
ck('同一次移动只触发一次（不是每格一次）',
   api.opportunityTriggers(oppHx, [shA, mover], mover,
     [mPath[0], mPath[1], api.hexAt(oppHx, 2, 1)], 'red')
     .filter(t => t.shooter === shA).length === 1);

const farShooter = mkSquad('blue');
farShooter.hex = api.hexAt(oppHx, 7, 5);
ck('超出直射射程 ⇒ 不触发', api.opportunityTriggers(oppHx, [farShooter, mover], mover,
   [api.hexAt(oppHx, 0, 0), api.hexAt(oppHx, 1, 0)], 'red').length === 0);

const artyShooter = api.buildCounters({ type: 'artillery', echelon: 'squad', name: '炮班',
  personnel: 5, equipment: [{ name: '75mm山炮', count: 1 }, { name: '运输卡车', count: 1 }],
  children: [] }, 'blue', 'squad')[0];
artyShooter.hex = api.hexAt(oppHx, 2, 2);
ck('纯炮兵阵地（山炮+卡车，无直射武器）不参与临机射击',
   api.counterRangeHex(artyShooter) === 0 &&
   api.opportunityTriggers(oppHx, [artyShooter, mover], mover, mPath, 'red').length === 0);

/* 仓促射击：FLV 降档走 core 的唯一口径 */
const fA = mkSquad('blue'); fA.hex = api.hexAt(oppHx, 2, 2);
const fD = mkSquad('red');  fD.hex = api.hexAt(oppHx, 3, 2);
const rBase = api.resolveFire(oppHx, fA, fD, { roll: 9 });
const rOpp = api.resolveFire(oppHx, fA, fD, { roll: 9, flvPenalty: api.OPP_FIRE_FLV_PENALTY });
ck('仓促射击 FLV −' + api.OPP_FIRE_FLV_PENALTY + '（' + rBase.flv + ' → ' + rOpp.flv + '）',
   rOpp.flv === Math.max(1, rBase.flv - api.OPP_FIRE_FLV_PENALTY) &&
   rOpp.notes.join('').indexOf('仓促射击') >= 0);

/* 端到端：真的移动一次，路上被临机射击（关动画 ⇒ 同步结算） */
E('wg-map').value = 'hxOpp';
api.startGame();
api.W.motion = false;
deployAll();                                     // ★ R10.23：部署完才进战斗（phase=play）
api.W.counters.length = 0;                       // 清场，只留我们摆的两个
const mv = mkSquad('blue');
const sh = mkSquad('red');
mv.hex = api.hexAt(api.W.hx, 1, 2);
sh.hex = api.hexAt(api.W.hx, 2, 4);
api.W.counters.push(mv, sh);
api.W.side = 'blue';
api.selectCounter(mv);
const destOpp = api.hexAt(api.W.hx, 3, 2);
const logBefore2 = api.W.log.length;
api.moveSelected(destOpp);
ck('移动途中吃到临机射击（日志出现 ⚡）',
   api.W.log.slice(logBefore2).some(o => o.text.indexOf('⚡') >= 0));
ck('没被打死就照常走到终点（' + mv.hex.col + ',' + mv.hex.row + '）',
   mv.dead || (mv.hex.col === 3 && mv.hex.row === 2));

/* 动画分支：stepAnim 走到触发点要打一发、并且"停一下"（hold），之后照常落子 */
const animMover = mkSquad('blue');
const animShooter = mkSquad('red');
animMover.hex = api.hexAt(api.W.hx, 1, 2);
animShooter.hex = api.hexAt(api.W.hx, 2, 4);
api.W.counters.push(animMover, animShooter);
const path2 = [api.hexAt(api.W.hx, 1, 2), api.hexAt(api.W.hx, 2, 2), api.hexAt(api.W.hx, 3, 2)];
api.W.anim = {
  kind: 'move', c: animMover, path: path2, cost: 2, t0: 0, seg: 100, hold: 0,
  trig: api.opportunityTriggers(api.W.hx, api.W.counters, animMover, path2, 'blue'),
};
const log0 = api.W.log.length;
api.stepAnim(120);
ck('动画分支：走到触发点就打一发（日志 ⚡）',
   api.W.log.slice(log0).some(o => o.text.indexOf('⚡') >= 0));
ck('临机射击让移动动画停顿（hold ' + (api.W.anim ? api.W.anim.hold : '—') + '）',
   !!(api.W.anim && api.W.anim.hold > 0));
let guard = 0;
while (api.W.anim && guard++ < 400) api.stepAnim(220 + guard * 100);
ck('停顿之后照常走完（落子到终点 ' + animMover.hex.col + ',' + animMover.hex.row + '）',
   !api.W.anim && animMover.hex.col === 3 && animMover.hex.row === 2);

/* ---------- ⑫ 一人不重复发武器 / 弹药系统（R10.22） ---------- */
const ammoSquad = api.buildCounters(oneSquad([
  { name: '突击步枪', count: 12 },
  { name: '反坦克导弹', count: 2 },
], 12), 'blue', 'squad')[0];
const dupBad = ammoSquad.members.filter(m => {
  const ns = (m.weapons || []).map(w => w.name);
  return new Set(ns).size !== ns.length;
});
ck('同一个人不会拿到两件一样的武器（重复 ' + dupBad.length + ' 人）', dupBad.length === 0);
const missileCarriers = ammoSquad.members.filter(m =>
  (m.weapons || []).some(w => w.name === '反坦克导弹'));
ck('两枚反坦克导弹分给两个人（' + missileCarriers.length + ' 人携带）',
   missileCarriers.length === 2);
ck('弹药池按件汇总（反坦克导弹 6×2 = ' + ammoSquad.ammo['反坦克导弹'] + '）',
   ammoSquad.ammo['反坦克导弹'] === 12);
ck('步枪/机枪不进弹药池（玩家：步兵步机枪的弹药就算了）',
   !('突击步枪' in ammoSquad.ammo) && !api.weaponUsesAmmo({ name: '突击步枪', cat: 'small_arms' }));
ck('面板有弹药条（' + '反坦克导弹 12/12' + '）', (function () {
  const h = api.ammoHtml(ammoSquad);
  return h.indexOf('反坦克导弹') >= 0 && h.indexOf('12/12') >= 0;
})());

/* 炮兵的弹药：山炮 60 发 → 打一发少一发 → 打光开不了火 */
const ammoBat = api.buildCounters({ type: 'artillery', echelon: 'squad', name: '炮班',
  personnel: 5, equipment: [{ name: '75mm山炮', count: 1 }, { name: '运输卡车', count: 1 }],
  children: [] }, 'blue', 'squad')[0];
const ammoTgt = mkSquad('red');
ammoBat.hex = api.hexAt(api.W.hx, 1, 1);
ammoTgt.hex = api.hexAt(api.W.hx, 5, 1);
ck('山炮弹药池（' + ammoBat.ammo['75mm山炮'] + '/60）', ammoBat.ammo['75mm山炮'] === 60);
ck('有弹时炮击 raw > 0', api.counterRaw(ammoBat, 4, 'art').art > 0);
const used1 = api.consumeAmmo(ammoBat, 4, 'art');
ck('打一发消耗 1 发（剩 ' + (used1[0] ? used1[0].left : '?') + '）',
   used1.length === 1 && ammoBat.ammo['75mm山炮'] === 59);
ammoBat.ammo['75mm山炮'] = 0;
ck('炮弹打光 ⇒ 炮击 raw = 0', api.counterRaw(ammoBat, 4, 'art').art === 0);
ck('炮弹打光 ⇒ 判定拦住（' + (function () {
  const s = api.fireSituation(api.W.hx, ammoBat, ammoTgt);
  return s.why || '能打';
})() + '）', (function () {
  const s = api.fireSituation(api.W.hx, ammoBat, ammoTgt);
  return !s.ok && s.why.indexOf('弹药耗尽') >= 0;
})());

/* 没弹的直射单位也不参与临机射击（坦克炮弹打光） */
const dryTank = api.buildCounters({ type: 'armor', echelon: 'squad', name: '坦克班',
  personnel: 3, equipment: [{ name: '主战坦克', count: 1 }], children: [] }, 'blue', 'squad')[0];
dryTank.hex = api.hexAt(api.W.hx, 2, 2);
const tankGun = Object.keys(dryTank.ammo)[0];
ck('坦克本身有炮弹池（' + tankGun + ' ' + dryTank.ammo[tankGun] + ' 发）', !!tankGun && dryTank.ammo[tankGun] > 0);
dryTank.ammo[tankGun] = 0;
ck('炮弹打光 ⇒ 不参与临机射击',
   api.opportunityShotFor(api.W.hx, dryTank, api.hexAt(api.W.hx, 3, 2), 'red', 'inf') === null);

/* 真开一炮 → 弹药 -1；撤回 → 弹药回滚 */
api.W.counters.length = 0;
ammoBat.ammo['75mm山炮'] = 60;
api.W.counters.push(ammoBat, ammoTgt);
api.W.side = 'blue';
ammoBat.acted = null; ammoBat.fired = false;
api.selectCounter(ammoBat);
api.openFirePreview(ammoBat, ammoTgt);
const ammoBeforeFire = ammoBat.ammo['75mm山炮'];
api.doFire();
ck('开火后弹药 -1（' + ammoBeforeFire + ' → ' + ammoBat.ammo['75mm山炮'] + '）',
   ammoBat.ammo['75mm山炮'] === ammoBeforeFire - 1);
api.undoLast();
ck('撤回后弹药回滚到 ' + ammoBat.ammo['75mm山炮'] + ' 发',
   ammoBat.ammo['75mm山炮'] === ammoBeforeFire);

/* ============================================================
   ★ R10.36：建筑 / 碉堡（玩家定案的那 4 条规则，全是纯函数）
   ============================================================ */
(function () {
  const hx = api.W.hx;
  const blds = api.initBuildings(hx);
  const houses = hx.hexes.filter(h => h && ((h.bld | 0) > 0 || h.terr === 'house'));
  ck('开局：地图上的建筑全部登记成**中立建筑**（' + blds.size + ' 格）',
     blds.size === houses.length &&
     Array.from(blds.values()).every(b => b.kind === 'building' && b.side === ''));

  const empty = hx.hexes.find(h => h && !(h.bld | 0) && h.terr !== 'house' &&
                                    h.terr !== 'river' && !h.water);
  ck('空地可以开工（canBuildHere.ok）', !!empty && api.canBuildHere(blds, empty).ok === true);
  if (houses.length) {
    ck('建筑格不能再修碉堡（提示\"直接进驻就行\"）',
       api.canBuildHere(blds, houses[0]).ok === false);
  }

  /* 施工：3 回合；挨打 / 进 ZOC 就打断 */
  const site = { side: 'blue', kind: 'site', t: 0 };
  const r1 = api.buildTick(site, empty, new Set(), false);
  ck('施工第 1 回合：进度 1/' + api.BUNKER_TURNS + '，没完工',
     r1.ok === true && r1.done === false && site.t === 1);
  ck('挨打 ⇒ 打断（进度不再涨）',
     api.buildTick(site, empty, new Set(), true).ok === false && site.t === 1);
  ck('处于敌方 ZOC ⇒ 打断',
     api.buildTick(site, empty, new Set([api.hexKey(empty)]), false).ok === false && site.t === 1);
  api.buildTick(site, empty, new Set(), false);          // t=2
  const r3 = api.buildTick(site, empty, new Set(), false); // t=3 ⇒ 完工
  ck('连续 ' + api.BUNKER_TURNS + ' 回合 ⟹ 变成**非中立碉堡**（side 保留）',
     r3.done === true && site.kind === 'bunker' && site.side === 'blue');

  ck('碉堡掩体比中立建筑硬（FLV 罚分 碉堡 ' + api.BUNKER_FLV + ' > 建筑 ' + api.BUILDING_FLV + '）',
     api.defTerrShift(empty, { kind: 'bunker' }) === api.BUNKER_FLV &&
     api.defTerrShift(empty, { kind: 'building' }) === api.BUILDING_FLV &&
     api.BUNKER_FLV > api.BUILDING_FLV);
  ck('工兵判定：engineer = 工兵（步兵不算）',
     api.isEngineer({ type: 'engineer' }) === true &&
     api.isEngineer({ type: 'infantry' }) === false &&
     api.isEngineer({ type: 'mech_engineer' }) === true);

  /* 合并编辑器：保存时把手画的地图烘焙成 hexData */
  const d = api.hexBakeToData(api.W.gm);
  ck('保存时烘焙 hexData：尺寸 = 现场烘焙（' + (d ? d.cols + '×' + d.rows : '?') + '）',
     !!d && d.cols === hx.cols && d.rows === hx.rows &&
     d.terr.length === d.cols * d.rows && d.road.length === d.cols * d.rows);
  ck('hexBakeToData 的每格地形/公路 = 兵棋现场烘焙的结果',
     hx.hexes.every((h, i) => !h ||
       (d.terr[i] === h.terr && (d.road[i] ? 1 : 0) === (h.road ? 1 : 0))));
  ck('hexBakeToData 带上了建筑标记 bld[]（六角格里的中立建筑靠它）',
     Array.isArray(d.bld) && d.bld.length === d.cols * d.rows);
})();

console.log(fails === 0 ? 'SMOKE OK' : 'SMOKE FAILED: ' + fails);
process.exit(fails === 0 ? 0 : 1);

