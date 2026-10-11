/* ============================================================
   grid-maps.js — 光栅地图核心（5m/格）+ 建筑系统
   ============================================================ */

/* 地形属性
   —— 通行 / 视线 / 掩体 三件事彻底拆开（以前 three-in-one 的 blocked 是"能进就不能挡视线"的根源）
   blocksMove : 不能通行
   sightBlock : 视线拦截值（**每 100m**，0~1；沿线累计 ≥1 完全遮挡）
                树林 0.5/100m、城区 0.7/100m、石墙 0.5/100m、**山丘 0.5/100m**
                ★ 山丘（山体）**遮挡视线**，但"站在山丘上视野更远"保持不变（spotMod 1.30）
                ★ 沼泽 = 0（只陷人陷车，**不挡视线** —— 玩家要求）
   spotMod    : 站在此格时的观察视距倍率（★现实基准：开阔地 3km）
   conceal    : 站在此格时的隐蔽度（0~1，越高越难被发现）
   cover      : 掩体（战斗伤害用，不参与视野）
   blocked    : 【已废弃】仅为兼容保留，= blocksMove
   ★★ R9.6.9 提醒：新增地形（如 `swamp`）**必须追加在数组末尾** ——
      地图 JSON 存的是**调色板下标**，插在中间会让所有老地图的地形整体错位。 */
const GRID_PALETTE = [
  /* ★ R9.6.12：草地颜色 `#e8f0e4`（近白）→ `#a8c585`（中亮橄榄绿）
     —— 玩家："平地地形颜色与曳光弹的颜色太接近了看不清曳光弹"。
        曳光弹是暖白/淡黄（255,238,170 / 255,255,255），在近白底上完全糊掉；
        换成中亮绿之后对比足够，且仍与树林 #5a8f5a / 沼泽 #4d5c42 拉开层次。 */
  { id:'empty',  name:'草地', color:'#a8c585', speedMul:1.0,  rangeMul:1.0, cover:0,    blocksMove:false, sightBlock:0,   spotMod:1.00, conceal:0,    blocked:false },
  { id:'road',   name:'公路', color:'#5a6470', speedMul:1.3,  rangeMul:1.0, cover:0,    blocksMove:false, sightBlock:0,   spotMod:1.05, conceal:0,    blocked:false, onRoad:true },
  { id:'forest', name:'树林', color:'#5a8f5a', speedMul:0.6,  rangeMul:0.5, cover:0.5,  blocksMove:false, sightBlock:0.5, spotMod:0.35, conceal:0.6,  blocked:false, onForest:true },
  /* ★ R9.6.9：山体**改为遮挡视线**（玩家要求）；"站在山丘上观察加成"不变（spotMod 1.30 / rangeMul 1.2） */
  { id:'hill',   name:'山丘', color:'#d4b483', speedMul:0.8,  rangeMul:1.2, cover:0.2,  blocksMove:false, sightBlock:0.5, spotMod:1.30, conceal:0.15, blocked:false, onHill:true },
  { id:'house',  name:'城区', color:'#7a8089', speedMul:0.5,  rangeMul:1.0, cover:0.9,  blocksMove:false, sightBlock:0.7, spotMod:0.30, conceal:0.7,  blocked:false },
  { id:'river',  name:'河流', color:'#6aa3d5', speedMul:0.15, rangeMul:1.0, cover:0.3,  blocksMove:false, sightBlock:0,   spotMod:0.95, conceal:0.1,  blocked:false },
  { id:'wall',   name:'石墙', color:'#a0aab5', speedMul:0.5,  rangeMul:1.0, cover:0.7,  blocksMove:true,  sightBlock:0.5, spotMod:1.00, conceal:0.3,  blocked:true },
  { id:'trench', name:'战壕', color:'#3d5aa8', speedMul:0.4,  rangeMul:1.0, cover:0.5,  blocksMove:false, sightBlock:0,   spotMod:0.90, conceal:0.5,  blocked:false, onTrench:true },
  /* ★ R9.6.9 新增：沼泽 —— 减速**比树林更狠**（履带 0.25 vs 树林 0.51）、有隐蔽与少量掩体，
     但 **sightBlock = 0（不遮挡视野）**。必须追加在末尾（见文件头"调色板下标"的说明）。 */
  { id:'swamp',  name:'沼泽', color:'#4d5c42', speedMul:0.35, rangeMul:0.85, cover:0.15, blocksMove:false, sightBlock:0,   spotMod:0.85, conceal:0.45, blocked:false, onSwamp:true },
];
const GRID_IDX = {};
GRID_PALETTE.forEach((p, i) => GRID_IDX[p.id] = i);

/* ★★★ R9.6.10：**地形纹理**（树林 / 沼泽 / 山丘）—— 玩家要求"给这些地形加一点简单纹理"
   ------------------------------------------------------------
   底图是"1 格 = 1 像素"，烘焙时按**格坐标哈希**给这三种地形叠一层**确定性花纹**
   （同一张图每次烘焙结果完全一样 ⇒ 不闪、不用存额外数据、不进地图 JSON）：
     · 树林：棋盘状树冠暗斑 + 明暗抖动     → 俯视像"成片树冠"
     · 沼泽：横向 2 暗 / 2 亮的条纹        → 像"水洼 / 苇塘"
     · 山丘：斜向脊线高光（每 3 格一条）   → 像"等高线 / 坡面"
   其它地形仍是纯色 ⇒ 观感不变、性能不受影响（一次烘焙，之后全是 drawImage）。
   ★ 战场底图（bakeGridCanvas）与编辑器每层烘焙（bakeLayerCanvas）**共用这一份实现**。 */
const GRID_PALETTE_RGB = GRID_PALETTE.map(p => [
  parseInt(p.color.slice(1, 3), 16),
  parseInt(p.color.slice(3, 5), 16),
  parseInt(p.color.slice(5, 7), 16),
]);
/* 格坐标 → [0,1) 的稳定哈希（纹理的"随机"来源，可复现） */
function _cellHash01(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
/* 返回长度 3 的**复用**数组（热路径：每格调一次，绝不在这里分配对象） */
const _terrPix = [0, 0, 0];
function terrainPixel(terrIdx, gx, gy) {
  const base = GRID_PALETTE_RGB[terrIdx] || GRID_PALETTE_RGB[0];
  const def = GRID_PALETTE[terrIdx];
  _terrPix[0] = base[0]; _terrPix[1] = base[1]; _terrPix[2] = base[2];
  const id = def && def.id;
  if (id === 'forest' || id === 'swamp' || id === 'hill') {
    const h = _cellHash01(gx, gy);
    let k = 0.86 + h * 0.28;                                     // ±14% 明暗抖动
    if (id === 'forest') {
      if (((gx + gy) & 1) === 0) k *= 0.84;                      // 树冠暗斑（棋盘）
    } else if (id === 'swamp') {
      k *= (((gy + ((h * 4) | 0)) & 3) < 2) ? 0.84 : 1.06;        // 横向水纹
    } else {
      if ((((gx - gy) % 3) + 3) % 3 === 0) k *= 1.14;             // 山脊高光
    }
    _terrPix[0] = Math.min(255, _terrPix[0] * k);
    _terrPix[1] = Math.min(255, _terrPix[1] * k);
    _terrPix[2] = Math.min(255, _terrPix[2] * k);
  }
  return _terrPix;
}

const GRID_MAPS = {};

/* ============================================================
   建筑类型定义
   ============================================================ */
const BUILDING_TYPES = {
  cottage: {
    id:'cottage', name:'平房', icon:'🏠',
    w:30, h:20,
    pxW:60, pxH:40, dhPx:16,
    hpMax: 600,
    // 对内部人员的伤害乘数（剩余伤害，越小越安全）
    // intact: 80% 防子弹 / 30% 防炮火
    cover: {
      intact:    { bullet: 0.20, shell: 0.70 },
      damaged:   { bullet: 0.40, shell: 0.80 },
      collapsed: { bullet: 0.70, shell: 0.90 },
    },
    // 对建筑本体的伤害乘数（子弹 0%，炮火 100%）
    selfDamageMul: { bullet: 0.0, shell: 1.0 },
    capacity: { intact:1, damaged:1, collapsed:0 },
    capacityUnit:'排',
    variants: ['cottage_yellow','cottage_brick','cottage_stone','cottage_tile'],
    states: ['intact','damaged','collapsed'],
    thresholds: [0.80, 0.0],
  },
  midrise: {
    id:'midrise', name:'中层住宅', icon:'🏢',
    w:50, h:30,
    pxW:100, pxH:60, dhPx:32,
    hpMax: 1500,
    // intact: 95% 防子弹 / 50% 防炮火
    cover: {
      intact:    { bullet: 0.05, shell: 0.50 },
      damaged:   { bullet: 0.20, shell: 0.70 },
      collapsed: { bullet: 0.50, shell: 0.85 },
    },
    selfDamageMul: { bullet: 0.0, shell: 1.0 },
    capacity: { intact:3, damaged:2, collapsed:0 },
    capacityUnit:'排',
    variants: ['mid_cream','mid_gray','mid_brick'],
    states: ['intact','damaged','collapsed'],
    thresholds: [0.80, 0.0],
  },
  highrise: {
    id:'highrise', name:'高层住宅', icon:'🏬',
    w:70, h:40,
    pxW:105, pxH:60, dhPx:45,
    hpMax: 2500,
    // intact: 95% 防子弹 / 50% 防炮火
    cover: {
      intact:    { bullet: 0.05, shell: 0.50 },
      damaged:   { bullet: 0.20, shell: 0.70 },
      severe:    { bullet: 0.40, shell: 0.80 },
      collapsed: { bullet: 0.50, shell: 0.85 },
    },
    selfDamageMul: { bullet: 0.0, shell: 1.0 },
    capacity: { intact:6, damaged:4, severe:2, collapsed:0 },
    capacityUnit:'排',
    variants: ['high_white','high_brick'],
    states: ['intact','damaged','severe','collapsed'],
    thresholds: [0.80, 0.50, 0.0],
  },
  tower: {
    id:'tower', name:'超高层办公楼', icon:'🏙️',
    w:90, h:60,
    pxW:120, pxH:80, dhPx:60,
    hpMax: 4000,
    // intact: 95% 防子弹 / 50% 防炮火
    cover: {
      intact:    { bullet: 0.05, shell: 0.50 },
      damaged:   { bullet: 0.20, shell: 0.70 },
      severe:    { bullet: 0.40, shell: 0.80 },
      collapsed: { bullet: 0.50, shell: 0.85 },
    },
    selfDamageMul: { bullet: 0.0, shell: 1.0 },
    capacity: { intact:8, damaged:5, severe:2, collapsed:0 },
    capacityUnit:'排',
    variants: ['tower_glass','tower_dark'],
    states: ['intact','damaged','severe','collapsed'],
    thresholds: [0.80, 0.50, 0.0],
    hasHelipad: true,
  },
  bunker: {
    id:'bunker', name:'碉堡', icon:'🛡️',
    w:25, h:25,
    pxW:60, pxH:60, dhPx:10,
    hpMax: 3500,
    // intact: 99% 防子弹 / 70% 防炮火
    cover: {
      intact:    { bullet: 0.01, shell: 0.30 },
      damaged:   { bullet: 0.15, shell: 0.55 },
      collapsed: { bullet: 0.50, shell: 0.85 },
    },
    // 碉堡特殊：本体受子弹 100% / 炮火 60%
    selfDamageMul: { bullet: 1.0, shell: 0.6 },
    capacity: { intact:1, damaged:1, collapsed:0 },
    capacityUnit:'班',
    variants: ['bunker_concrete','bunker_green'],
    states: ['intact','damaged','collapsed'],
    thresholds: [0.80, 0.0],
  },
};

const BUILDING_PALETTE = {
  cottage_yellow: { top:'#c8a878', side:'#8a6838', sideDark:'#705028' },
  cottage_brick:  { top:'#b86648', side:'#7a3e28', sideDark:'#63321e' },
  cottage_stone:  { top:'#b8b0a0', side:'#787060', sideDark:'#605a4c' },
  cottage_tile:   { top:'#c86848', side:'#9a4838', sideDark:'#7a3828' },

  mid_cream: { top:'#c8b890', side:'#98887a', sideDark:'#786858' },
  mid_gray:  { top:'#98a8b8', side:'#687888', sideDark:'#485868' },
  mid_brick: { top:'#a87858', side:'#784830', sideDark:'#5e3824' },

  high_white: { top:'#b8b8b8', side:'#787878', sideDark:'#585858' },
  high_brick: { top:'#a86858', side:'#684038', sideDark:'#502e28' },

  tower_glass: { top:'#88a8c0', side:'#486888', sideDark:'#304860' },
  tower_dark:  { top:'#888888', side:'#505050', sideDark:'#383838' },

  bunker_concrete: { top:'#808080', side:'#505050', sideDark:'#383838' },
  bunker_green:    { top:'#688068', side:'#405040', sideDark:'#2c3c2c' },
};

/* 建筑剩余容量 */
function getBuildingCapacity(building) {
  const def = BUILDING_TYPES[building.type];
  if (!def) return 0;
  const state = getBuildingState(building);
  return def.capacity[state] || 0;
}

/* 单位所在建筑（无则 null） */
function getUnitBuilding(unit, gm) {
  if (!gm || !gm.buildings) return null;
  for (let i = gm.buildings.length - 1; i >= 0; i--) {
    const b = gm.buildings[i];
    if (getBuildingState(b) === 'collapsed') continue;
    if (isPointInBuilding(b, unit.x, unit.y)) return b;
  }
  return null;
}

/* 建筑三态判定 */
function getBuildingState(building) {
  const def = BUILDING_TYPES[building.type];
  if (!def) return 'intact';
  const pct = building.hp / building.hpMax;
  const th = def.thresholds;
  if (def.states.length === 3) {
    if (pct > th[0]) return 'intact';
    if (pct > th[1]) return 'damaged';
    return 'collapsed';
  } else {
    if (pct > th[0]) return 'intact';
    if (pct > th[1]) return 'damaged';
    if (pct > th[2]) return 'severe';
    return 'collapsed';
  }
}

/* 建筑尺寸（含旋转：暂不支持，只做 AABB） */
function buildingAABB(b) {
  return { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h };
}

/* 点是否在建筑内 */
function isPointInBuilding(b, x, y) {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/* 创建建筑实例 */
function createBuilding(typeId, x, y, variantKey) {
  const def = BUILDING_TYPES[typeId];
  if (!def) return null;
  return {
    id: 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
    type: typeId,
    x: Math.round(x),
    y: Math.round(y),
    w: def.w,
    h: def.h,
    hp: def.hpMax,
    hpMax: def.hpMax,
    variant: variantKey || def.variants[0],
    customName: '',
  };
}

/* 查找建筑（返回第一个包含该点的） */
function findBuildingAt(gm, x, y) {
  if (!gm.buildings) return null;
  for (let i = gm.buildings.length - 1; i >= 0; i--) {
    if (isPointInBuilding(gm.buildings[i], x, y)) return gm.buildings[i];
  }
  return null;
}

/* 返回所有包含该点的建筑 */
function findBuildingsAt(gm, x, y) {
  if (!gm.buildings) return [];
  return gm.buildings.filter(b => isPointInBuilding(b, x, y));
}

/* ============================================================
   建筑渲染（2.5D 伪俯视）
   供地图编辑器和战术模拟共用
   ============================================================ */

function _shadeColor(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * (1 + amt))));
  g = Math.max(0, Math.min(255, Math.round(g * (1 + amt))));
  b = Math.max(0, Math.min(255, Math.round(b * (1 + amt))));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function _prnd(seed, i) {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function _smoothClosedPath(pts) {
  if (pts.length < 3) return '';
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % pts.length];
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    d += ` Q${p0[0].toFixed(2)} ${p0[1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

let _buildingClipCounter = 0;

/* 炮弹贯穿洞 */
function _drawShellHole(cx, cy, r, rot, seed, wallColor) {
  let out = '';
  const N = 22;

  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = rot + (i / N) * Math.PI * 2;
    const noise =
      Math.sin(a * 3 + seed * 1.7) * 0.20 +
      Math.sin(a * 5 + seed * 2.3) * 0.10 +
      Math.sin(a * 8 + seed * 3.1) * 0.05;
    const rr = r * (1 + noise);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const holePath = _smoothClosedPath(pts);

  const outerPts = [];
  for (let i = 0; i < N; i++) {
    const a = rot + (i / N) * Math.PI * 2;
    const noise =
      Math.sin(a * 3 + seed * 1.7) * 0.20 +
      Math.sin(a * 5 + seed * 2.3) * 0.10 +
      Math.sin(a * 8 + seed * 3.1) * 0.05;
    const extra = 1.20 + Math.sin(a * 11 + seed * 4.3) * 0.10;
    const rr = r * (1 + noise) * extra;
    outerPts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const outerPath = _smoothClosedPath(outerPts);
  out += `<path d="${outerPath}" fill="${_shadeColor(wallColor, -0.55)}" opacity="0.85"/>`;
  out += `<path d="${outerPath}" fill="none"
    stroke="${_shadeColor(wallColor, 0.15)}" stroke-width="0.35" opacity="0.5"/>`;
  out += `<path d="${holePath}" fill="#040608"/>`;

  const cracks = 4 + Math.floor(_prnd(seed, 500) * 3);
  for (let i = 0; i < cracks; i++) {
    const a = _prnd(seed, i + 600) * Math.PI * 2;
    const len = r * (1.9 + _prnd(seed, i + 700) * 1.4);
    const bend1 = a + (_prnd(seed, i + 750) - 0.5) * 0.8;
    const bend2 = a + (_prnd(seed, i + 760) - 0.5) * 1.0;
    const p1x = cx + Math.cos(bend1) * len * 0.35;
    const p1y = cy + Math.sin(bend1) * len * 0.35;
    const p2x = cx + Math.cos(bend2) * len * 0.7;
    const p2y = cy + Math.sin(bend2) * len * 0.7;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len;
    out += `<path d="M${cx.toFixed(2)} ${cy.toFixed(2)} Q${p1x.toFixed(2)} ${p1y.toFixed(2)} ${p2x.toFixed(2)} ${p2y.toFixed(2)} T${ex.toFixed(2)} ${ey.toFixed(2)}"
      stroke="rgba(0,0,0,0.65)" stroke-width="0.35" fill="none" stroke-linecap="round"/>`;
  }

  const debris = 3 + Math.floor(_prnd(seed, 800) * 3);
  for (let i = 0; i < debris; i++) {
    const a = _prnd(seed, i + 900) * Math.PI * 2;
    const dist = r * (1.5 + _prnd(seed, i + 950) * 1.1);
    const dx = cx + Math.cos(a) * dist;
    const dy = cy + Math.sin(a) * dist;
    const dw = 0.6 + _prnd(seed, i + 1000) * 0.7;
    out += `<rect x="${dx.toFixed(2)}" y="${dy.toFixed(2)}"
      width="${dw.toFixed(2)}" height="${dw.toFixed(2)}"
      fill="${_shadeColor(wallColor, -0.25)}" opacity="0.7" rx="0.15"/>`;
  }

  return out;
}

/* 侧壁窗户 */
function _drawSideWindows(x, y, w, h, tx, ty, oy, dh, state, seed, kind) {
  const ox = dh * 0.5;
  let s = '';

  let layers;
  if (kind === 'tall') layers = 5;
  else layers = dh >= 20 ? 3 : 2;

  const layerH = oy / layers;
  const winH = Math.max(2, layerH * 0.55);

  const colsF = Math.max(3, Math.floor(w / 12));
  const winW_F = Math.max(2.5, (w / colsF) * 0.5);
  for (let r = 0; r < layers; r++) {
    const v = (r + 0.5) / layers;
    for (let c = 0; c < colsF; c++) {
      const u = (c + 0.5) / colsF;
      const winX = x + w * u - ox * (1 - v);
      const winY = y + h - oy * (1 - v);
      const rnd = (c * 7 + r * 13 + seed) % 10;
      let fill;
      if (state === 'damaged' && rnd < 2) fill = '#0b1220';
      else if (state === 'severe' && rnd < 5) fill = '#0b1220';
      else if (rnd < 3) fill = '#f5d878';
      else fill = '#151c24';
      s += `<rect x="${winX - winW_F/2}" y="${winY - winH}"
        width="${winW_F}" height="${winH}" fill="${fill}" opacity="0.95"/>`;
    }
  }

  const colsR = Math.max(2, Math.floor(h / 16));
  const winW_R = 2.5;
  for (let r = 0; r < layers; r++) {
    const v = (r + 0.5) / layers;
    for (let c = 0; c < colsR; c++) {
      const u = (c + 0.5) / colsR;
      const winX = x + w - ox * u;
      const winY = y - oy * u + h * v;
      const rnd = (c * 11 + r * 5 + seed + 3) % 10;
      let fill;
      if (state === 'damaged' && rnd < 2) fill = '#0b1220';
      else if (state === 'severe' && rnd < 5) fill = '#0b1220';
      else if (rnd < 2) fill = '#f5d878';
      else fill = '#0e141b';
      s += `<rect x="${winX - winW_R/2}" y="${winY}"
        width="${winW_R}" height="${winH}" fill="${fill}" opacity="0.85"/>`;
    }
  }
  return s;
}

/* 侧壁弹孔（含 clipPath 兜底） */
function _drawWallHoles(x, y, w, h, tx, ty, ox, oy, state, seed, kind, side, sideDark) {
  if (kind === 'bunker') return '';
  if (state !== 'damaged' && state !== 'severe') return '';

  const sizeMul = state === 'damaged' ? 1.0 : 1.7;
  const clipId = 'wallclip_' + (++_buildingClipCounter);
  let s = '';

  // clipPath：只允许弹孔画在前壁 + 右壁的多边形内
  s += `<defs><clipPath id="${clipId}">
    <polygon points="${tx},${ty+h} ${tx+w},${ty+h} ${x+w},${y+h} ${x},${y+h}"/>
    <polygon points="${tx+w},${ty} ${x+w},${y} ${x+w},${y+h} ${tx+w},${ty+h}"/>
  </clipPath></defs>`;

  s += `<g clip-path="url(#${clipId})">`;

  // 前壁（梯形，上边 tx..tx+w，下边 x..x+w）
  const frontHoles = state === 'damaged' ? 2 : 3;
  for (let i = 0; i < frontHoles; i++) {
    const u = 0.18 + _prnd(seed, i * 3 + 1) * 0.64;
    const v = 0.25 + _prnd(seed, i * 3 + 2) * 0.5;
    const hx = tx + u * w + v * ox;   // ★ 修复：加 v*ox 才能落在梯形内部
    const hy = ty + h + v * oy;
    const baseR = (3.0 + _prnd(seed, i * 3 + 3) * 1.5) * sizeMul;
    const rot = _prnd(seed, i * 3 + 4) * Math.PI * 2;
    s += _drawShellHole(hx, hy, baseR, rot, seed + i * 7, sideDark);
  }

  // 右壁
  const sideHoles = state === 'damaged' ? 1 : 2;
  for (let i = 0; i < sideHoles; i++) {
    const u = 0.3 + _prnd(seed, i * 5 + 11) * 0.4;
    const v = 0.2 + _prnd(seed, i * 5 + 12) * 0.55;
    const hx = tx + w + u * ox;
    const hy = ty + v * (h + oy);
    const baseR = (2.4 + _prnd(seed, i * 5 + 13) * 1.2) * sizeMul;
    const rot = _prnd(seed, i * 5 + 14) * Math.PI * 2;
    s += _drawShellHole(hx, hy, baseR, rot, seed + i * 11 + 100, side);
  }

  s += `</g>`;
  return s;
}

/* 屋面细节 */
function _drawRoofDetails(kind, tx, ty, w, h, side, helipad) {
  let s = '';
  if (kind === 'bunker') {
    s += `<circle cx="${tx+w/2}" cy="${ty+h/2}" r="${w*0.32}" fill="${side}" opacity="0.9"/>`;
    s += `<circle cx="${tx+w/2}" cy="${ty+h/2}" r="${w*0.20}" fill="rgba(0,0,0,0.3)"/>`;
    s += `<circle cx="${tx+w/2}" cy="${ty+h/2}" r="${w*0.20}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>`;
    s += `<rect x="${tx+w/2-4}" y="${ty+1}" width="8" height="2" fill="#0b1220"/>`;
    s += `<rect x="${tx+w/2-4}" y="${ty+h-3}" width="8" height="2" fill="#0b1220"/>`;
    s += `<rect x="${tx+1}" y="${ty+h/2-4}" width="2" height="8" fill="#0b1220"/>`;
    s += `<rect x="${tx+w-3}" y="${ty+h/2-4}" width="2" height="8" fill="#0b1220"/>`;
  } else if (kind === 'tall') {
    if (helipad) {
      const ccx = tx + w/2, ccy = ty + h/2;
      const r = Math.min(w, h) * 0.32;
      s += `<circle cx="${ccx}" cy="${ccy}" r="${r}" fill="#25282c" opacity="0.95"/>`;
      s += `<circle cx="${ccx}" cy="${ccy}" r="${r}" fill="none" stroke="#f5d878" stroke-width="1.4" opacity="0.95"/>`;
      s += `<circle cx="${ccx}" cy="${ccy}" r="${r*0.72}" fill="none" stroke="#f5d878" stroke-width="0.6" opacity="0.6"/>`;
      s += `<line x1="${ccx-r*0.35}" y1="${ccy-r*0.4}" x2="${ccx-r*0.35}" y2="${ccy+r*0.4}" stroke="#f5d878" stroke-width="1.6"/>`;
      s += `<line x1="${ccx+r*0.35}" y1="${ccy-r*0.4}" x2="${ccx+r*0.35}" y2="${ccy+r*0.4}" stroke="#f5d878" stroke-width="1.6"/>`;
      s += `<line x1="${ccx-r*0.35}" y1="${ccy}" x2="${ccx+r*0.35}" y2="${ccy}" stroke="#f5d878" stroke-width="1.6"/>`;
    } else {
      s += `<rect x="${tx+w/2-8}" y="${ty+h/2-6}" width="16" height="12" fill="${side}" opacity="0.85" rx="1"/>`;
      s += `<rect x="${tx+w/2-8}" y="${ty+h/2-6}" width="16" height="12" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>`;
      s += `<circle cx="${tx+w*0.22}" cy="${ty+h*0.3}" r="${Math.min(w,h)*0.1}" fill="${side}" opacity="0.9"/>`;
      s += `<circle cx="${tx+w*0.22}" cy="${ty+h*0.3}" r="${Math.min(w,h)*0.1}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="0.6"/>`;
      s += `<rect x="${tx+w*0.72}" y="${ty+h*0.25}" width="8" height="6" fill="${side}" opacity="0.85" rx="1"/>`;
      s += `<line x1="${tx+w*0.86}" y1="${ty+h*0.85}" x2="${tx+w*0.86}" y2="${ty+h*0.78}" stroke="#222" stroke-width="1"/>`;
      s += `<circle cx="${tx+w*0.86}" cy="${ty+h*0.78}" r="1" fill="#f00"/>`;
    }
  } else {
    s += `<circle cx="${tx+w*0.3}" cy="${ty+h*0.35}" r="${Math.min(w,h)*0.09}" fill="${side}" opacity="0.85"/>`;
    s += `<circle cx="${tx+w*0.3}" cy="${ty+h*0.35}" r="${Math.min(w,h)*0.09}" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"/>`;
    s += `<rect x="${tx+w*0.7}" y="${ty+h*0.3}" width="5" height="4" fill="${side}" opacity="0.8" rx="0.5"/>`;
    s += `<rect x="${tx+w*0.62}" y="${ty+h*0.7}" width="6" height="4" fill="${side}" opacity="0.8" rx="0.5"/>`;
  }
  return s;
}

/* 双坡瓦片屋顶 */
function _drawGableRoof(tx, ty, w, h, topColor) {
  let s = '';
  const midX = tx + w/2;
  s += `<polygon points="${tx},${ty} ${midX},${ty} ${midX},${ty+h} ${tx},${ty+h}" fill="${topColor}"/>`;
  s += `<polygon points="${midX},${ty} ${tx+w},${ty} ${tx+w},${ty+h} ${midX},${ty+h}" fill="${_shadeColor(topColor, -0.22)}"/>`;
  s += `<line x1="${midX}" y1="${ty}" x2="${midX}" y2="${ty+h}" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>`;
  const tiles = Math.max(3, Math.floor(h / 3));
  for (let i = 1; i < tiles; i++) {
    const yline = ty + (h / tiles) * i;
    s += `<line x1="${tx}" y1="${yline}" x2="${tx+w}" y2="${yline}" stroke="rgba(0,0,0,0.18)" stroke-width="0.4"/>`;
  }
  s += `<line x1="${midX}" y1="${ty}" x2="${midX}" y2="${ty+h}" stroke="rgba(255,255,255,0.25)" stroke-width="0.5"/>`;
  s += `<circle cx="${midX}" cy="${ty+0.6}" r="0.9" fill="rgba(0,0,0,0.5)"/>`;
  s += `<circle cx="${midX}" cy="${ty+h-0.6}" r="0.9" fill="rgba(0,0,0,0.5)"/>`;
  return s;
}

/* 2.5D 建筑绘制（返回 SVG 字符串） */
function renderBuildingSVG(building, pixelW, pixelH) {
  const def = BUILDING_TYPES[building.type];
  if (!def) return '';
  const pal = BUILDING_PALETTE[building.variant] || BUILDING_PALETTE[def.variants[0]];
  const state = getBuildingState(building);

  const w = def.pxW;
  const h = def.pxH;
  const dh = def.dhPx;

  // ★ 底面左上角 = (0, 0)，顶面左上角 = (-ox, -oy)
  const ox = dh * 0.5;
  const oy = dh;
  const x = 0;
  const y = 0;
  const tx = -ox;
  const ty = -oy;

  const vbX = tx;
  const vbY = ty;
  const vbW = w + ox;
  const vbH = h + oy;

  let s = '';
  s += `<svg viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${pixelW}" height="${pixelH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">`;
  s += `<defs>
    <linearGradient id="bldR${building.id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.45"/>
    </linearGradient>
    <linearGradient id="bldD${building.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.4"/>
    </linearGradient>
  </defs>`;

  // 坍塌
  if (state === 'collapsed') {
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#3a3a38" opacity="0.55"/>`;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"
      stroke="${pal.side}" stroke-width="0.8" stroke-dasharray="2,3" opacity="0.5"/>`;
    const rubble = [
      [x+4, y+3, 8, 5], [x+w-13, y+7, 9, 4],
      [x+6, y+h-10, 7, 5], [x+w-18, y+h-12, 8, 5],
      [x+w/2-6, y+h/2-4, 8, 5], [x+w/2-12, y+h-8, 6, 4],
      [x+10, y+h/2, 5, 6], [x+w-10, y+h/2+2, 6, 4],
    ];
    rubble.forEach(([rx,ry,rw,rh], i) => {
      const c = i % 3 === 0 ? _shadeColor(pal.top, -0.35) : _shadeColor(pal.side, -0.1);
      s += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${c}" rx="1" opacity="0.9"/>`;
    });
    s += `<path d="M${x} ${y} L${x} ${y+h*0.4} L${x+3} ${y+h*0.42} L${x+3} ${y} Z" fill="${pal.side}" opacity="0.85"/>`;
    s += `<path d="M${x+w-3} ${y+h*0.5} L${x+w} ${y+h*0.48} L${x+w} ${y+h} L${x+w-3} ${y+h} Z" fill="${pal.sideDark}" opacity="0.85"/>`;
    s += `<circle cx="${x+w/2}" cy="${y+h/2}" r="4" fill="rgba(70,70,70,0.4)"/>`;
    s += `<circle cx="${x+w/2+8}" cy="${y+h/2-6}" r="2.5" fill="rgba(90,90,90,0.28)"/>`;
    s += `</svg>`;
    return s;
  }

  // 阴影
  s += `<polygon points="${x+3},${y+h+3} ${x+w+3},${y+h+3} ${tx+w+3},${ty+h+3} ${tx+3},${ty+h+3}" fill="rgba(0,0,0,0.55)"/>`;
  s += `<polygon points="${x+w+3},${y+3} ${x+w+3},${y+h+3} ${tx+w+3},${ty+h+3} ${tx+w+3},${ty+3}" fill="rgba(0,0,0,0.42)"/>`;

  // 右侧壁
  s += `<polygon points="${x+w},${y} ${tx+w},${ty} ${tx+w},${ty+h} ${x+w},${y+h}" fill="${pal.side}"/>`;
  s += `<polygon points="${x+w},${y} ${tx+w},${ty} ${tx+w},${ty+h} ${x+w},${y+h}" fill="url(#bldR${building.id})"/>`;

  // 前壁
  s += `<polygon points="${x},${y+h} ${x+w},${y+h} ${tx+w},${ty+h} ${tx},${ty+h}" fill="${pal.sideDark}"/>`;
  s += `<polygon points="${x},${y+h} ${x+w},${y+h} ${tx+w},${ty+h} ${tx},${ty+h}" fill="url(#bldD${building.id})"/>`;

  // 窗户
  const seed = (building.variant.charCodeAt(0) || 65) + (building.x || 0) * 0.01 + (building.y || 0) * 0.013;
  if (def.id !== 'bunker') {
    s += _drawSideWindows(x, y, w, h, tx, ty, oy, dh, state, seed,
      (def.id === 'highrise' || def.id === 'tower') ? 'tall' : 'house');
  }

  // 弹孔
  s += _drawWallHoles(x, y, w, h, tx, ty, ox, oy, state, seed,
    (def.id === 'highrise' || def.id === 'tower') ? 'tall' : 'house',
    pal.side, pal.sideDark);

  // 顶面
  const isTile = building.variant === 'cottage_tile';
  if (isTile) {
    s += _drawGableRoof(tx, ty, w, h, pal.top);
  } else {
    s += `<rect x="${tx}" y="${ty}" width="${w}" height="${h}" fill="${pal.top}"/>`;
    s += _drawRoofDetails((def.id === 'highrise' || def.id === 'tower') ? 'tall' : 'house',
      tx, ty, w, h, pal.side, def.hasHelipad);
  }

  // 损伤叠加
  if (state === 'damaged') {
    s += `<polygon points="${tx+w*0.62},${ty} ${tx+w},${ty} ${tx+w},${ty+h*0.48}" fill="#0b1220" opacity="0.95"/>`;
    s += `<path d="M${tx+w*0.2} ${ty} L${tx+w*0.26} ${ty+h*0.3} L${tx+w*0.16} ${ty+h*0.55}" stroke="#0a0d11" stroke-width="1.2" fill="none" opacity="0.85"/>`;
  } else if (state === 'severe') {
    s += `<polygon points="${tx+w*0.35},${ty} ${tx+w},${ty} ${tx+w},${ty+h*0.68}" fill="#0b1220" opacity="0.95"/>`;
    s += `<polygon points="${tx},${ty+h*0.38} ${tx+w*0.28},${ty+h*0.5} ${tx},${ty+h}" fill="#0b1220" opacity="0.95"/>`;
    s += `<path d="M${tx+w*0.42} ${ty} L${tx+w*0.36} ${ty+h*0.42} L${tx+w*0.52} ${ty+h*0.72}" stroke="#0a0d11" stroke-width="1.8" fill="none"/>`;
    s += `<circle cx="${tx+w*0.5}" cy="${ty+h*0.3}" r="3" fill="#1a1a1a" opacity="0.75"/>`;
  }

  s += `<rect x="${tx}" y="${ty}" width="${w}" height="1.5" fill="rgba(255,255,255,0.15)"/>`;
  s += `<rect x="${tx}" y="${ty}" width="${w}" height="${h}" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="0.8"/>`;
  s += `</svg>`;
  return s;
}

/* ============================================================
   地图数据结构（新增 buildings）
   ============================================================ */

/* 建议单边参战人数：按地图面积估算（每平方公里 6 人），可被地图编辑器手动覆盖 */
const SOLDIERS_PER_KM2 = 6;
function recommendedSoldiers(w, h) {
  const km2 = Math.max(0.001, (w * h) / 1e6);
  return Math.max(10, Math.round(km2 * SOLDIERS_PER_KM2));
}

/* ============================================================
   出生区（开局集结地）
   —— 每个地图给蓝/红双方各一个矩形出生区；没有就按地图尺寸自动给默认值
   ============================================================ */
const SPAWN_UNIT_SPACING = 120;   // 估算容量用的"单位占地面积"（米）

function makeDefaultSpawn(gm, side) {
  const w = gm.w, h = gm.h;
  const sw = Math.max(600, Math.round(w * 0.14));
  const sh = Math.max(600, Math.round(h * 0.55));
  if (side === 'blue') {
    return { x: Math.round(w * 0.03), y: Math.round((h - sh) / 2), w: sw, h: sh };
  }
  // 红方：有据点 → 围着最靠中的那个据点（防守方就驻那儿）；否则放地图右侧
  if (gm.objectives && gm.objectives.length) {
    let best = gm.objectives[0], bestD = Infinity;
    for (const o of gm.objectives) {
      const d = Math.hypot(o.x - w / 2, o.y - h / 2);
      if (d < bestD) { bestD = d; best = o; }
    }
    return {
      x: Math.max(0, Math.round(best.x - sw / 2)),
      y: Math.max(0, Math.round(best.y - sh / 2)),
      w: sw, h: sh,
    };
  }
  return { x: Math.round(w * 0.83), y: Math.round((h - sh) / 2), w: sw, h: sh };
}

function spawnIsValid(sp) {
  if (!sp) return false;
  if (Array.isArray(sp.polys) && sp.polys.some(p => Array.isArray(p) && p.length >= 3)) return true;
  return ['x','y','w','h'].every(k => typeof sp[k] === 'number') && sp.w >= 100 && sp.h >= 100;
}

/* ---------- 出生区几何：矩形 + ★多个多边形 ----------
   数据：gm.spawns[side] = { x,y,w,h,           // 总包围盒（所有多边形的并集；老地图就是矩形本身）
                            polys: [ [ {x,y}, … ], … ] }   // 多个不相连的出生块；空 → 按矩形
   规则：只要 polys 里有 ≥3 顶点的块，就按多边形判定；否则按矩形。老地图天然兼容。 */

function spawnPolysOf(sp) {
  if (!sp || !Array.isArray(sp.polys)) return [];
  return sp.polys.filter(p => Array.isArray(p) && p.length >= 3);
}
function spawnHasPolys(sp) { return spawnPolysOf(sp).length > 0; }

/* 点在多边形内（射线法） */
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/* 点是否在出生区内（多块多边形任一命中；无多边形 → 矩形） */
function pointInSpawn(sp, x, y) {
  if (!sp) return false;
  const polys = spawnPolysOf(sp);
  if (polys.length) {
    for (const p of polys) if (pointInPoly(x, y, p)) return true;
    return false;
  }
  if (!spawnIsValid(sp)) return false;
  return x >= sp.x && x <= sp.x + sp.w && y >= sp.y && y <= sp.y + sp.h;
}

/* 多边形面积（鞋带公式，取绝对值；顶点顺/逆时针都行） */
function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return Math.abs(a) / 2;
}

/* 出生区总面积（多边形合计 / 矩形面积） */
function spawnArea(sp) {
  const polys = spawnPolysOf(sp);
  if (polys.length) {
    let a = 0;
    for (const p of polys) a += polyArea(p);
    return a;
  }
  return spawnIsValid(sp) ? sp.w * sp.h : 0;
}

/* 出生区中心（面积加权质心 / 矩形中心）—— 用于标签与"本方纵深方向" */
function spawnCenter(sp) {
  if (!sp) return { x: 0, y: 0 };
  const polys = spawnPolysOf(sp);
  if (polys.length) {
    let sx = 0, sy = 0, sw = 0;
    for (const p of polys) {
      const a = polyArea(p) || 1;
      let px = 0, py = 0;
      for (const v of p) { px += v.x; py += v.y; }
      sx += (px / p.length) * a; sy += (py / p.length) * a; sw += a;
    }
    if (sw > 0) return { x: sx / sw, y: sy / sw };
  }
  return { x: sp.x + sp.w / 2, y: sp.y + sp.h / 2 };
}

/* 由所有多边形重算总包围盒（无多边形则不动，保持矩形） */
function refreshSpawnBBox(sp) {
  const polys = spawnPolysOf(sp);
  if (!polys.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) {
    for (const v of p) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
  }
  if (!isFinite(minX)) return;
  sp.x = Math.round(minX);
  sp.y = Math.round(minY);
  sp.w = Math.max(1, Math.round(maxX - minX));
  sp.h = Math.max(1, Math.round(maxY - minY));
}

function setSpawnPolys(sp, polys) {
  sp.polys = polys;
  refreshSpawnBBox(sp);
}

/* 出生区大致能容纳多少单位（仅用于编辑器提示） */
function spawnCapacity(sp) {
  const a = spawnArea(sp);
  if (!a) return 0;
  return Math.max(0, Math.floor(a / (SPAWN_UNIT_SPACING * SPAWN_UNIT_SPACING * 2.25)));
}

/* 补齐出生区（老地图 / 用户地图都走这里） */
function ensureSpawns(gm) {
  if (!gm) return;
  if (!gm.spawns || typeof gm.spawns !== 'object') gm.spawns = {};
  for (const side of ['blue', 'red']) {
    const sp = gm.spawns[side];
    if (!spawnIsValid(sp)) {
      gm.spawns[side] = makeDefaultSpawn(gm, side);
    } else if (spawnHasPolys(sp)) {
      refreshSpawnBBox(sp);      // ★ 有多边形时以多边形为准重算包围盒（防止手改 JSON 不一致）
    }
  }
}

/* ============================================================
   ★★★ R9.2：**补给点**（玩家要的第三项：弹药回补）
   ------------------------------------------------------------
   数据：`gm.supplies = [{ id, name, x, y, r }]`（世界米；r 默认 120m）
     · 单位在圈内**停留 ≥3 秒** ⇒ 每秒回补 20%（按每件武器的 ammoMax 比例，见 battle.js）
     · 序列化 / 反序列化都带上；**老地图没有这个字段 ⇒ 完全兼容**
     · 地图上一个补给点都没有 ⇒ `autoSupplies()` 自动在各方纵深放一个
       （跟 `autoEncounterObjectives` 一个思路：让机制在 4 张预置图上也能立刻验证）
   ============================================================ */
const SUPPLY_DEFAULT_RADIUS = 120;
let _supplySeq = 0;

function normalizeSupplies(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const s of arr) {
    if (!s || typeof s.x !== 'number' || typeof s.y !== 'number') continue;
    out.push({
      id: s.id || ('sup_' + (++_supplySeq) + '_' + Math.round(s.x) + '_' + Math.round(s.y)),
      name: s.name || ('补给点 ' + (out.length + 1)),
      x: s.x, y: s.y,
      r: Math.max(40, Math.min(600, typeof s.r === 'number' ? s.r : SUPPLY_DEFAULT_RADIUS)),
    });
  }
  return out;
}

function makeSupply(x, y, r, name) {
  const s = normalizeSupplies([{ x, y, r, name }])[0];
  if (!s) return null;
  s.id = 'sup_' + Date.now().toString(36) + '_' + (++_supplySeq);
  return s;
}

/* 没有补给点的地图 ⇒ 自动给每方在**纵深**放一个（出生区质心再往外 600m） */
function autoSupplies(gm) {
  if (!gm) return [];
  ensureSpawns(gm);
  const out = [];
  for (const side of ['blue', 'red']) {
    const sp = gm.spawns && gm.spawns[side];
    let x = gm.w * (side === 'blue' ? 0.12 : 0.88), y = gm.h * 0.5;
    if (sp) {
      const c = (typeof spawnCenter === 'function') ? spawnCenter(sp)
              : { x: sp.x + (sp.w || 0) / 2, y: sp.y + (sp.h || 0) / 2 };
      const dx = c.x - gm.w / 2, dy = c.y - gm.h / 2;
      const len = Math.hypot(dx, dy) || 1;
      x = c.x + (dx / len) * 600;
      y = c.y + (dy / len) * 600;
    }
    out.push({
      id: 'auto_sup_' + side,
      name: (side === 'blue' ? '蓝方' : '红方') + '补给点',
      x: Math.max(80, Math.min(gm.w - 80, x)),
      y: Math.max(80, Math.min(gm.h - 80, y)),
      r: SUPPLY_DEFAULT_RADIUS,
    });
  }
  return out;
}

function makeGridMap(w, h, cellSize) {
  const gw = Math.ceil(w / cellSize), gh = Math.ceil(h / cellSize);
  const baseGrid = new Uint8Array(gw * gh);
  return {
    id: 'grid_' + Date.now().toString(36),
    name: '未命名地图',
    w, h, cellSize, gw, gh,
    maxUnitsPerSide: 60,
    soldiersPerSide: recommendedSoldiers(w, h),
    objectives: [],
    buildings: [],
    supplies: [],                    // ★ R9.2 补给点（[{id,name,x,y,r}]）
    layers: [
      { id: 'L' + Date.now().toString(36) + '_0', name: '图层 1', visible: true, opacity: 1.0, grid: baseGrid }
    ],
    roads: [],                       // ★ 矢量公路（折线 + 宽度）
    _composedGrid: null,
    _canvas: null,
    _roadGrid: null,
    _roadGridDirty: true,
    _isUserMap: true,
  };
}

function gRect(gm, x, y, w, h, id) {
  const t = GRID_IDX[id];
  const grid = gm.layers ? gm.layers[gm._genActiveIdx || 0].grid : gm.grid;
  const x1 = Math.max(0, Math.floor(x / gm.cellSize));
  const y1 = Math.max(0, Math.floor(y / gm.cellSize));
  const x2 = Math.min(gm.gw - 1, Math.floor((x + w) / gm.cellSize));
  const y2 = Math.min(gm.gh - 1, Math.floor((y + h) / gm.cellSize));
  for (let gx = x1; gx <= x2; gx++)
    for (let gy = y1; gy <= y2; gy++)
      grid[gy * gm.gw + gx] = t;
  gm._canvas = null;
}

function gCircle(gm, cx, cy, r, id) {
  const t = GRID_IDX[id];
  const r2 = r * r;
  const x1 = Math.max(0, Math.floor((cx - r) / gm.cellSize));
  const y1 = Math.max(0, Math.floor((cy - r) / gm.cellSize));
  const x2 = Math.min(gm.gw - 1, Math.ceil((cx + r) / gm.cellSize));
  const y2 = Math.min(gm.gh - 1, Math.ceil((cy + r) / gm.cellSize));
  for (let gx = x1; gx <= x2; gx++) {
    for (let gy = y1; gy <= y2; gy++) {
      const wx = gx * gm.cellSize + gm.cellSize / 2;
      const wy = gy * gm.cellSize + gm.cellSize / 2;
      const dx = wx - cx, dy = wy - cy;
      if (dx * dx + dy * dy <= r2) gm.grid[gy * gm.gw + gx] = t;
    }
  }
  gm._canvas = null;
}

function gLine(gm, x1, y1, x2, y2, thickness, id) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len / (gm.cellSize / 2));
  const r = thickness / 2;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    gCircle(gm, x1 + dx * k, y1 + dy * k, r, id);
  }
}

function gPixel(gm, gx, gy, id) {
  if (gx < 0 || gx >= gm.gw || gy < 0 || gy >= gm.gh) return;
  gm.grid[gy * gm.gw + gx] = GRID_IDX[id];
  gm._canvas = null;
}

function gFloodFill(gm, gx, gy, id) {
  if (gx < 0 || gx >= gm.gw || gy < 0 || gy >= gm.gh) return;
  const target = gm.grid[gy * gm.gw + gx];
  const next = GRID_IDX[id];
  if (target === next) return;

  const stack = [[gx, gy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= gm.gw || y < 0 || y >= gm.gh) continue;
    if (gm.grid[y * gm.gw + x] !== target) continue;
    gm.grid[y * gm.gw + x] = next;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  gm._canvas = null;
}

/* ============================================================
   图层合成
   ============================================================ */
function ensureComposedGrid(gm) {
  if (gm._composedGrid && gm._composedGrid.length === gm.gw * gm.gh) return;
  gmRecomposeAll(gm);
}

/* ★ 图层合成规则（唯一真相）：
   「index 越大越靠上；非零覆盖」
   —— 编辑器画布（render 里 i=0→n-1 依次 drawImage）、图层面板（顶部显示最后一个 index）、
      增量合成 gmUpdateComposedCell 全都是这个语义。
      旧版这里从 n-1 往 0 遍历、每个非零都覆盖 ⇒ 最后写入的是【最小 index】，
      等于"index 越小越靠上"，与其它三处完全相反：
        · 编辑器里看着没问题（它用逐层 canvas 画），一进战斗合成就是反的
        · getGridTerrain 读的正是 _composedGrid ⇒ 掩体/通行/视线/射程倍率全取错层
        · 还与 gmUpdateComposedCell（增量）互相矛盾 ⇒ 同一格结果取决于最后一次是增量还是全量 */
function gmRecomposeAll(gm) {
  const total = gm.gw * gm.gh;
  const out = new Uint8Array(total);
  const layers = gm.layers || [];
  for (let i = 0; i < layers.length; i++) {      // ★ 由下往上：后画的覆盖先画的
    const L = layers[i];
    if (!L.visible) continue;
    const g = L.grid;
    for (let k = 0; k < total; k++) {
      if (g[k] !== 0) out[k] = g[k];
    }
  }
  /* ★ 矢量公路：烙在图层之上（导航 / 战场 / 烘焙都读 _composedGrid）
     —— 同时留一份"只有图层"的 _composedLayers 给**底图渲染**用：
        否则矢量描线下面会露出栅格路的锯齿边（正是要消灭的东西） */
  const roads = gm.roads || [];
  gm._composedLayers = out;
  if (roads.length) {
    const rg = ensureRoadGrid(gm);
    const merged = new Uint8Array(total);
    for (let k = 0; k < total; k++) merged[k] = rg[k] ? rg[k] : out[k];
    gm._composedGrid = merged;
  } else {
    gm._composedGrid = out;
    if (gm._roadGrid) { gm._roadGrid = null; gm._roadGridDirty = false; }
  }
  gm._canvas = null;
  gm._rev = (gm._rev || 0) + 1;      // ★ 地形/公路变了 ⇒ 公路路网图（含各段可过性）必须重建
}

/* 单格增量合成（与 gmRecomposeAll 必须同规则：index 越大越靠上、非零覆盖） */
function gmUpdateComposedCell(gm, gx, gy) {
  if (!gm._composedGrid) { gmRecomposeAll(gm); return; }
  if (gx < 0 || gx >= gm.gw || gy < 0 || gy >= gm.gh) return;
  const idx = gy * gm.gw + gx;
  let val = 0;
  const layers = gm.layers || [];
  for (let i = 0; i < layers.length; i++) {      // ★ 正向遍历，同理
    const L = layers[i];
    if (!L.visible) continue;
    const v = L.grid[idx];
    if (v !== 0) val = v;
  }
  /* ★ 矢量公路压在最上面（与 gmRecomposeAll 同规则）；底图那份保持"只有图层" */
  if (!gm._composedLayers || gm._composedLayers.length !== gm._composedGrid.length) gm._composedLayers = null;
  if (gm._composedLayers) gm._composedLayers[idx] = val;
  if ((gm.roads || []).length) {
    const rg = ensureRoadGrid(gm);
    if (rg[idx] !== 0) val = rg[idx];
  }
  gm._composedGrid[idx] = val;
  gm._canvas = null;
  gm._rev = (gm._rev || 0) + 1;      // ★ 同 gmRecomposeAll：作废公路路网图缓存
}

function bakeGridCanvas(gm) {
  if (gm._canvas) return gm._canvas;
  ensureComposedGrid(gm);
  /* ★ 矢量公路**不**画进底图：底图只画图层 —— 否则矢量描线下面会露出栅格路的锯齿边。
     公路由 drawRoadOverlay()/drawRoads() 用矢量描线画 ⇒ 干净利落、随缩放始终锐利。 */
  const composed = (gm.roads && gm.roads.length && gm._composedLayers) ? gm._composedLayers : gm._composedGrid;
  const c = document.createElement('canvas');
  c.width = gm.gw; c.height = gm.gh;
  const cctx = c.getContext('2d');
  const img = cctx.createImageData(gm.gw, gm.gh);
  const d = img.data;
  const GW = gm.gw;
  for (let i = 0; i < composed.length; i++) {
    /* ★★★ R9.6.10：地形纹理（树林 / 沼泽 / 山丘）—— 顺带把"每格 parseInt 字符串颜色"
       的旧写法换成了查表 + 哈希 ⇒ 烘焙反而更快。 */
    const px = terrainPixel(composed[i], i % GW, (i / GW) | 0);
    d[i*4]   = px[0];
    d[i*4+1] = px[1];
    d[i*4+2] = px[2];
    d[i*4+3] = 255;
  }
  cctx.putImageData(img, 0, 0);
  gm._canvas = c;
  return c;
}

function getGridTerrain(gm, x, y) {
  if (!gm) return GRID_PALETTE[0];
  const gx = Math.floor(x / gm.cellSize);
  const gy = Math.floor(y / gm.cellSize);
  if (gx < 0 || gx >= gm.gw || gy < 0 || gy >= gm.gh) return GRID_PALETTE[0];
  ensureComposedGrid(gm);
  return GRID_PALETTE[gm._composedGrid[gy * gm.gw + gx]];
}

/* ============================================================
   RLE 压缩
   ============================================================ */
function encodeRLE(grid) {
  const rle = [];
  if (grid.length === 0) return rle;
  let cur = grid[0], count = 1;
  for (let i = 1; i < grid.length; i++) {
    if (grid[i] === cur) { count++; }
    else { rle.push(cur, count); cur = grid[i]; count = 1; }
  }
  rle.push(cur, count);
  return rle;
}

function decodeRLE(rle, len) {
  const grid = new Uint8Array(len);
  let pos = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const v = rle[i], c = rle[i+1];
    grid.fill(v, pos, pos + c);
    pos += c;
  }
  return grid;
}

/* ============================================================
   ★ 地形速度表（**唯一真相**）—— 只负责「速度」，不再管寻路
   ------------------------------------------------------------
   R8 起寻路层已整体删除（A* / 路网 Dijkstra / 车道 / 路线缓存全部移除），
   这张表只剩一个用途：**某机动类型在某种地形上的速度倍率**。
     · 徒步：全 1.00（用户规则：移动力不受地形影响）
     · 轮式：只走平地 + 公路；其余 0（= 开不进去，会停在原地）
     · 履带 / 半履带：可过丘陵 / 树林 / 战壕；**沼泽比树林更慢**（0.25 / 0.22）
     · 绝对不可通行：石墙 + 建筑（由 pointIsBlocking / isMoveBlockedAt 判定，不在这张表里）
       ★ R9.6.9：**建筑对车辆另外硬阻断**（`vehicleBlockedAt` / `vehicleEnterBuildingBlocked`）
         —— 玩家规则"只有步兵可以进入建筑"
    调用方：battle.js 的 terrainMobilityMulFor() → terrainMobilityMul() / mulAtPoint() / polylineTime()
   ============================================================ */
const TERRAIN_SPEED_TABLE = {
  foot:      { empty: 1.00, road: 1.00, forest: 1.00, hill: 1.00, house: 1.00, river: 1.00, trench: 1.00, wall: 0, swamp: 1.00 },
  wheeled:   { empty: 0.60, road: 1.69, forest: 0,    hill: 0,    house: 0,    river: 0,    trench: 0,    wall: 0, swamp: 0 },
  tracked:   { empty: 0.90, road: 1.43, forest: 0.51, hill: 0.68, house: 0,    river: 0,    trench: 0.36, wall: 0, swamp: 0.25 },
  halftrack: { empty: 0.85, road: 1.56, forest: 0.45, hill: 0.60, house: 0,    river: 0,    trench: 0.34, wall: 0, swamp: 0.22 },
  air:       { empty: 1.00, road: 1.00, forest: 1.00, hill: 1.00, house: 1.00, river: 1.00, trench: 1.00, wall: 1.00, swamp: 1.00 },
};

/* 某机动类型 × 地形瓦片 → 速度倍率（0 = 该地形开不进去） */
function mobilityMulForTile(mt, tg) {
  if (!tg) return 0;
  const row = TERRAIN_SPEED_TABLE[mt] || TERRAIN_SPEED_TABLE.foot;
  const v = row[tg.id];
  return (v == null) ? 0 : v;
}

const ROAD_DEFAULT_W = 10;      // 默认路宽（米）＝ 2 格 @5m
const ROAD_MIN_W = 4;           // 4m：能过大车的最小宽度
const ROAD_MAX_W = 60;          // 60m：大街 / 广场
const ROAD_TILE_ID = 'road';

function normalizeRoad(r, i) {
  if (!r || !Array.isArray(r.pts)) return null;
  const pts = r.pts.map(p => ({ x: +p.x || 0, y: +p.y || 0 }));
  if (pts.length < 2) return null;
  const w = Math.max(ROAD_MIN_W, Math.min(ROAD_MAX_W, +r.w || ROAD_DEFAULT_W));
  return { id: r.id || ('rd' + (i + 1)), name: r.name || ('公路 ' + (i + 1)), w, pts };
}
function normalizeRoads(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  arr.forEach((r, i) => { const n = normalizeRoad(r, i); if (n) out.push(n); });
  return out;
}
function ensureRoads(gm) { if (!gm.roads) gm.roads = []; }
function roadLength(r) {
  let s = 0;
  for (let i = 1; i < r.pts.length; i++) s += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y);
  return s;
}

/* 把矢量公路烙成"道路格"（只给导航/战场用；作者的地形图层保持干净）
   —— 圆盘戳印 + ≤2.5m 采样 ⇒ 斜路也不会漏格、不会出现台阶孔洞 */
function buildRoadGrid(gm) {
  const total = gm.gw * gm.gh;
  const out = new Uint8Array(total);
  const roads = gm.roads || [];
  if (!roads.length) return out;
  const idx = GRID_IDX[ROAD_TILE_ID];
  const cs = gm.cellSize;
  const stepM = Math.max(cs * 0.5, 2.5);
  for (const rd of roads) {
    const r = Math.max(cs * 0.5, rd.w / 2);
    const r2 = r * r;
    const pts = rd.pts;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
      const seg = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(seg / stepM));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
        const gx1 = Math.max(0, Math.floor((cx - r) / cs)), gx2 = Math.min(gm.gw - 1, Math.ceil((cx + r) / cs));
        const gy1 = Math.max(0, Math.floor((cy - r) / cs)), gy2 = Math.min(gm.gh - 1, Math.ceil((cy + r) / cs));
        for (let gy = gy1; gy <= gy2; gy++) {
          const wy = gy * cs + cs / 2;
          for (let gx = gx1; gx <= gx2; gx++) {
            const wx = gx * cs + cs / 2;
            const dx = wx - cx, dy = wy - cy;
            if (dx * dx + dy * dy <= r2) out[gy * gm.gw + gx] = idx;
          }
        }
      }
    }
  }
  return out;
}

function ensureRoadGrid(gm) {
  if (gm._roadGridDirty || !gm._roadGrid || gm._roadGrid.length !== gm.gw * gm.gh) {
    gm._roadGrid = buildRoadGrid(gm);
    gm._roadGridDirty = false;
  }
  return gm._roadGrid;
}
/* 公路改动后必须调用：作废道路格 + 地形画布缓存 */
function invalidateRoadGrid(gm) {
  gm._roadGridDirty = true;
  gm._canvas = null;
}

/* ============================================================
   序列化
   ============================================================ */
function serializeGridMap(gm) {
  return {
    id: gm.id,
    name: gm.name,
    w: gm.w, h: gm.h, cellSize: gm.cellSize,
    maxUnitsPerSide: gm.maxUnitsPerSide || 60,
    soldiersPerSide: gm.soldiersPerSide || recommendedSoldiers(gm.w, gm.h),
    objectives: gm.objectives || [],
    buildings: gm.buildings || [],
    spawns: gm.spawns || null,
    /* ★ R9.2：补给点（只存必要字段；坐标留 0.1m 精度 ⇒ 体积小） */
    supplies: (gm.supplies || []).map(s => ({
      id: s.id, name: s.name,
      x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10,
      r: Math.round(s.r || SUPPLY_DEFAULT_RADIUS),
    })),
    layers: gm.layers.map(L => ({
      id: L.id, name: L.name,
      visible: L.visible, opacity: L.opacity,
      rle: encodeRLE(L.grid),
    })),
    /* ★ 矢量公路：只存必要字段（坐标留 0.1m 精度 ⇒ 体积小） */
    roads: (gm.roads || []).map(r => ({
      id: r.id, name: r.name, w: Math.round(r.w * 10) / 10,
      pts: r.pts.map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
    })),
  };
}

function deserializeGridMap(obj) {
  const gw = Math.ceil(obj.w / obj.cellSize);
  const gh = Math.ceil(obj.h / obj.cellSize);
  let layers;
  if (obj.layers && Array.isArray(obj.layers)) {
    layers = obj.layers.map((L, i) => ({
      id: L.id || ('L' + Date.now().toString(36) + '_' + i),
      name: L.name || ('图层 ' + (i + 1)),
      visible: L.visible !== false,
      opacity: typeof L.opacity === 'number' ? L.opacity : 1.0,
      grid: decodeRLE(L.rle, gw * gh),
    }));
  } else {
    layers = [{
      id: 'L' + Date.now().toString(36) + '_0',
      name: '图层 1',
      visible: true,
      opacity: 1.0,
      grid: decodeRLE(obj.rle, gw * gh),
    }];
  }
  const gm = {
    id: obj.id, name: obj.name || '未命名地图',
    w: obj.w, h: obj.h, cellSize: obj.cellSize,
    gw, gh,
    maxUnitsPerSide: obj.maxUnitsPerSide || 60,
    soldiersPerSide: obj.soldiersPerSide || recommendedSoldiers(obj.w, obj.h),
    objectives: obj.objectives || [],
    buildings: obj.buildings || [],
    spawns: obj.spawns || null,
    supplies: normalizeSupplies(obj.supplies),   // ★ R9.2 补给点（老地图没有 ⇒ []，兼容）
    /* ★ R8：路线系统已删；旧地图里的 routes 字段原样保留（不解析、不校验、不显示） */
    routes: Array.isArray(obj.routes) ? obj.routes : [],
    roads: normalizeRoads(obj.roads),          // ★ 矢量公路（老地图没有 ⇒ []，兼容）
    layers,
    _composedGrid: null,
    _canvas: null,
    _roadGrid: null,
    _roadGridDirty: true,
    _isUserMap: true,
  };
  ensureSpawns(gm);
  return gm;
}

/* ============================================================
   用户地图 storage
   ============================================================ */
const GRID_MAPS_KEY = 'mil_grid_maps_v1';

function getUserMapsRaw() {
  try { return JSON.parse(localStorage.getItem(GRID_MAPS_KEY) || '{}'); }
  catch (e) { return {}; }
}

function saveUserMapToStorage(gm) {
  const maps = getUserMapsRaw();
  maps[gm.id] = serializeGridMap(gm);
  try {
    localStorage.setItem(GRID_MAPS_KEY, JSON.stringify(maps));
    return true;
  } catch (e) {
    console.error('保存地图失败：', e);
    return false;
  }
}

function deleteUserMapFromStorage(id) {
  const maps = getUserMapsRaw();
  delete maps[id];
  try { localStorage.setItem(GRID_MAPS_KEY, JSON.stringify(maps)); } catch (e) {}
}

function loadUserMapsIntoMemory() {
  const maps = getUserMapsRaw();
  Object.values(maps).forEach(obj => {
    try {
      const gm = deserializeGridMap(obj);
      ensureComposedGrid(gm);
      GRID_MAPS[obj.id] = gm;
    } catch (e) { console.warn('地图加载失败：', obj.id, e); }
  });
}

/* ============================================================
   预设地图（**官方地图池** = js/maps-presets.js，由地图编辑器导出）
   ------------------------------------------------------------
   ★ R9.6.10：旧的 4 张"代码生成预设"（立交桥 / 斯大林格勒 / 库尔斯克 / 朝鲜丘陵）**整体删除**，
     改为加载三张**实景自制图**：巴斯通涅(9×5km) · 立交桥(5×2.5km) · 卡朗唐(8×4.5km)。
     这里只负责反序列化 —— 地图数据全在 maps-presets.js 里，改图不用动这个文件。
   ============================================================ */
function loadPresetMaps() {
  const list = (typeof GRID_MAP_PRESETS !== 'undefined' && Array.isArray(GRID_MAP_PRESETS))
    ? GRID_MAP_PRESETS : [];
  list.forEach(obj => {
    try {
      const gm = deserializeGridMap(obj);
      gm._isUserMap = false;              // ★ 官方地图（编辑器里不可删、下拉框里分组不同）
      GRID_MAPS[gm.id] = gm;
    } catch (e) { console.warn('官方地图加载失败：', obj && obj.id, e); }
  });
}

/* ============================================================
   兼容层：绘制函数写入"当前活动层"
   ============================================================ */
function _getActiveGrid(gm) {
  if (!gm.layers || !gm.layers.length) return gm.grid;
  let i = gm._genActiveIdx || 0;
  if (!(i >= 0 && i < gm.layers.length)) i = 0;      // ★ 越界兜底：旧代码会在这里 TypeError
  return (gm.layers[i] || gm.layers[0]).grid;
}

gLine = function(gm, x1, y1, x2, y2, thickness, id) {
  const t = GRID_IDX[id];
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  // ★ 至少 1 段：旧代码 steps=0 时 k=i/steps=NaN ⇒ 坐标全 NaN ⇒ 画不出任何东西
  const steps = Math.max(1, Math.ceil(len / (gm.cellSize / 2)));
  const r = thickness / 2;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    gCircle(gm, x1 + dx * k, y1 + dy * k, r, id);
  }
};
gRect = function(gm, x, y, w, h, id) {
  const t = GRID_IDX[id];
  const grid = _getActiveGrid(gm);
  const x1 = Math.max(0, Math.floor(x / gm.cellSize));
  const y1 = Math.max(0, Math.floor(y / gm.cellSize));
  const x2 = Math.min(gm.gw - 1, Math.floor((x + w) / gm.cellSize));
  const y2 = Math.min(gm.gh - 1, Math.floor((y + h) / gm.cellSize));
  for (let gx = x1; gx <= x2; gx++)
    for (let gy = y1; gy <= y2; gy++)
      grid[gy * gm.gw + gx] = t;
  gm._canvas = null;
};
gCircle = function(gm, cx, cy, r, id) {
  const t = GRID_IDX[id];
  const grid = _getActiveGrid(gm);
  const r2 = r * r;
  const x1 = Math.max(0, Math.floor((cx - r) / gm.cellSize));
  const y1 = Math.max(0, Math.floor((cy - r) / gm.cellSize));
  const x2 = Math.min(gm.gw - 1, Math.ceil((cx + r) / gm.cellSize));
  const y2 = Math.min(gm.gh - 1, Math.ceil((cy + r) / gm.cellSize));
  for (let gx = x1; gx <= x2; gx++) {
    for (let gy = y1; gy <= y2; gy++) {
      const wx = gx * gm.cellSize + gm.cellSize / 2;
      const wy = gy * gm.cellSize + gm.cellSize / 2;
      const dx = wx - cx, dy = wy - cy;
      if (dx * dx + dy * dy <= r2) grid[gy * gm.gw + gx] = t;
    }
  }
  gm._canvas = null;
};
gPixel = function(gm, gx, gy, id) {
  if (gx < 0 || gx >= gm.gw || gy < 0 || gy >= gm.gh) return;
  const grid = _getActiveGrid(gm);
  grid[gy * gm.gw + gx] = GRID_IDX[id];
  gm._canvas = null;
};
gFloodFill = function(gm, gx, gy, id) {
  if (gx < 0 || gx >= gm.gw || gy < 0 || gy >= gm.gh) return;
  const grid = _getActiveGrid(gm);
  const target = grid[gy * gm.gw + gx];
  const next = GRID_IDX[id];
  if (target === next) return;
  const stack = [[gx, gy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= gm.gw || y < 0 || y >= gm.gh) continue;
    if (grid[y * gm.gw + x] !== target) continue;
    grid[y * gm.gw + x] = next;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  gm._canvas = null;
};

/* ============================================================
   初始化
   ============================================================ */
(function initGridMaps() {
  loadPresetMaps();           // ★ R9.6.10：官方地图池（maps-presets.js）
  loadUserMapsIntoMemory();   // 编辑器里存过的用户地图（localStorage）
})();
