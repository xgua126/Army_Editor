/* ============================================================
   data.js — 兵种表、图标、预设
   必须第一个加载，为其他文件提供 TYPES、ICON_PARTS 等常量
   ============================================================ */

/* 兵种表：结构 = 主元素(main) + 框内上部修饰(s1) + 框内下部属性(s2) */
const TYPES = {
  /* —— 机动 —— */
  infantry:       { name:'步兵',           cat:'maneuver', main:['cross'] },
  light_infantry: { name:'轻步兵',         cat:'maneuver', main:['cross'],               s2:['light'] },
  mech:           { name:'机步',           cat:'maneuver', main:['cross','ellipse'] },
  armor:          { name:'装甲',           cat:'maneuver', main:['ellipse'] },
  light_armor:    { name:'轻型装甲',       cat:'maneuver', main:['ellipse'],             s2:['light'] },
  heavy_armor:    { name:'重型装甲',       cat:'maneuver', main:['ellipse'],             s2:['heavy'] },
  airborne:       { name:'空降',           cat:'maneuver', main:['cross'],               s1:['chute'] },
  air_assault:    { name:'空中突击',       cat:'maneuver', main:['cross'],               s2:['air_assault'] },
  mountain:       { name:'山地',           cat:'maneuver', main:['cross'],               s2:['mountain'] },
  recon:          { name:'侦察',           cat:'maneuver', main:['diagonal'] },
  recon_mech:     { name:'侦察（机械）',   cat:'maneuver', main:['diagonal','ellipse'] },
  wheeled_inf:    { name:'摩托化步兵',     cat:'maneuver', main:['cross'],               s2:['wheeled'] },

  /* —— 火力 —— */
  artillery:      { name:'炮兵',           cat:'fire',     main:['circle_small'] },
  mlrs:           { name:'多管火箭炮',     cat:'fire',     main:['circle_small'],        s1:['mlrs'] },
  mortar:         { name:'迫击炮',         cat:'fire',     main:['mortar'] },
  anti_tank:      { name:'反坦克',         cat:'fire',     main:['circle_small','triangle_up'] },
  aaa:            { name:'防空',           cat:'fire',     main:['circle_small','triangle_down'] },
  towed_w:        { name:'轮式牵引炮',     cat:'fire',     main:['circle_small'],        s2:['towed_w'] },
  towed_t:        { name:'履带牵引炮',     cat:'fire',     main:['circle_small'],        s2:['towed_t'] },

  /* —— 航空 —— */
  rotary:         { name:'旋翼航空',       cat:'air',      main:['rotary'] },
  fixedwing:      { name:'固定翼航空',     cat:'air',      main:['fixedwing'] },
  attack_heli:    { name:'攻击直升机',     cat:'air',      main:['rotary'],              s1:['attack'] },
  uav_unit:       { name:'无人机部队',     cat:'air',      main:['cross'],               s1:['uav'] },

  /* —— 保障 —— */
  engineer:       { name:'工兵',           cat:'support',  main:['engineer'] },
  bridging:       { name:'架桥',           cat:'support',  main:['engineer'],            s1:['bridge'] },
  signal:         { name:'通讯',           cat:'support',  main:['signal'] },
  medical:        { name:'医疗',           cat:'support',  main:['medical_cross'] },
  logistics:      { name:'后勤',           cat:'support',  main:['supply'] },
  supply:         { name:'补给',           cat:'support',  main:['supply'] },
  combat_support: { name:'作战支援',       cat:'support',  main:['text_CS'] },
  mp:             { name:'宪兵',           cat:'support',  main:['mp'] },
  hq:             { name:'指挥',           cat:'support',  main:['text_HQ'] },
};

const CUSTOM_KEY = 'mil_custom_types_v1';

function getCustomTypes() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'); }
  catch (e) { return {}; }
}
function setCustomTypes(obj) { localStorage.setItem(CUSTOM_KEY, JSON.stringify(obj)); }

(function mergeCustomTypes() {
  const custom = getCustomTypes();
  Object.keys(custom).forEach(k => {
    TYPES[k] = custom[k];
  });
})();

const CHIP_LABELS = {
  cross:'步兵', ellipse:'装甲', circle_small:'炮兵', supply:'补给',
  diagonal:'侦察', triangle_up:'反坦克', triangle_down:'防空',
  mortar:'迫击炮', rotary:'旋翼', fixedwing:'固定翼',
  engineer:'工兵', signal:'通讯', medical_cross:'医疗', text_HQ:'指挥',
  text_CS:'作战支援', mp:'宪兵',
  chute:'空降', attack:'攻击', bridge:'架桥', mlrs:'多管火箭', uav:'无人机',
  wave:'两栖', tracked:'履带', wheeled:'轮式', wheeled_cc:'轮式越野',
  halftrack:'半履带', motorcycle:'摩托车', bicycle:'自行车',
  towed_w:'轮式牵引', towed_t:'履带牵引', horse:'马',
  air_assault:'空中突击', mountain:'山地',
  heavy:'重型', medium:'中型', light:'轻型'
};

/* 可复用部件 */
const _rotary = (c) =>
  `<path d="M36 46 L12 30 L12 62 Z" fill="${c}"/>` +
  `<path d="M36 46 L60 30 L60 62 Z" fill="${c}"/>`;

const _fixedwing = (c) =>
  `<path d="M36 46 L14 32 Q10 46 14 60 Z" fill="${c}"/>` +
  `<path d="M36 46 L58 32 Q62 46 58 60 Z" fill="${c}"/>`;

const _mortar = (c) =>
  `<line x1="36" y1="30" x2="36" y2="50" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>` +
  `<path d="M30 36 L36 30 L42 36" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<circle cx="36" cy="58" r="6" fill="none" stroke="${c}" stroke-width="2.4"/>`;

/* 主元素（框内中部） */
const ICON_PARTS = {
  cross:          (c)    => `<path d="M9 30 L63 62 M63 30 L9 62" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
  ellipse:        (c)    => `<ellipse cx="36" cy="46" rx="27" ry="13" fill="none" stroke="${c}" stroke-width="2.6"/>`,
  circle_small:   (c)    => `<circle cx="36" cy="46" r="7" fill="${c}"/>`,
  supply:         (c)    => `<circle cx="36" cy="46" r="13" fill="none" stroke="${c}" stroke-width="2.2"/><line x1="36" y1="33" x2="36" y2="59" stroke="${c}" stroke-width="1.6"/><line x1="23" y1="46" x2="49" y2="46" stroke="${c}" stroke-width="1.6"/><line x1="27" y1="37" x2="45" y2="55" stroke="${c}" stroke-width="1.6"/><line x1="45" y1="37" x2="27" y2="55" stroke="${c}" stroke-width="1.6"/>`,
  diagonal:       (c)    => `<line x1="9" y1="62" x2="63" y2="30" stroke="${c}" stroke-width="2.8" stroke-linecap="round"/>`,
  triangle_up:    (c)    => `<path d="M9 62 L36 30 L63 62" stroke="${c}" stroke-width="2.4" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
  triangle_down:  (c)    => `<path d="M9 30 L36 62 L63 30" stroke="${c}" stroke-width="2.4" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
  engineer:       (c)    => `<g transform="rotate(90 36 46)"><path d="M26 30 V62 M26 30 H46 M26 46 H42 M26 62 H46" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  signal:         (c)    => `<path d="M46 30 L28 46 L42 46 L24 62" stroke="${c}" stroke-width="2.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
  medical_cross:  (c)    => `<line x1="36" y1="32" x2="36" y2="60" stroke="${c}" stroke-width="6" stroke-linecap="round"/><line x1="22" y1="46" x2="50" y2="46" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
  text_HQ:        (c)    => `<text x="36" y="46" dy="0.35em" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="900" fill="${c}" letter-spacing="1">HQ</text>`,
  text_CS:        (c)    => `<text x="36" y="46" dy="0.35em" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="900" fill="${c}" letter-spacing="1">CS</text>`,
  mp:             (c)    => `<text x="36" y="46" dy="0.35em" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="900" fill="${c}" letter-spacing="1">MP</text>`,
  mortar:         _mortar,
  rotary:         _rotary,
  fixedwing:      _fixedwing,
};

/* 上方元素（统一 y 22~34） */
const SECTOR1_PARTS = {
  chute:      (c) => `<path d="M26 30 Q36 22 46 30" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M32 30 L36 34 L40 30" stroke="${c}" stroke-width="1.6" fill="none" stroke-linejoin="round"/>`,
  attack:     (c) => `<text x="36" y="29" dy="0.35em" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="${c}">A</text>`,
  bridge:     (c) => `<path d="M20 26 L25 29 L47 29 L52 26" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 34 L25 31 L47 31 L52 34" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  mlrs:       (c) => `<path d="M24 27 L36 22 L48 27" stroke="${c}" stroke-width="1.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/><path d="M26 33 L36 28 L46 33" stroke="${c}" stroke-width="1.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
  mortar:     (c) => `<path d="M33 28 L36 24 L39 28" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="36" cy="32" r="2.2" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  uav:        (c) => `<path d="M24 25 L36 33 L48 25" stroke="${c}" stroke-width="3.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
};

/* 下方元素（移动符号组 + 属性） */
const SECTOR2_PARTS = {
  wave:        (c) => `<path d="M6 60 Q14 52 22 60 T38 60 T54 60 T70 60" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  tracked:     (c) => `<rect x="26" y="60" width="20" height="5.5" rx="2.75" fill="none" stroke="${c}" stroke-width="1.6"/>`,
  wheeled:     (c) => `<circle cx="30" cy="62" r="3" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="42" cy="62" r="3" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  wheeled_cc:  (c) => `<circle cx="25" cy="62" r="3" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="36" cy="62" r="3" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="47" cy="62" r="3" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  halftrack:   (c) => `<rect x="26" y="60" width="12" height="5.5" rx="2.75" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="44" cy="62" r="3" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  motorcycle:  (c) => `<circle cx="36" cy="62" r="3" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  bicycle:     (c) => `<circle cx="30" cy="62" r="3" fill="${c}"/><circle cx="42" cy="62" r="3" fill="${c}"/>`,
  towed_w:     (c) => `<circle cx="27" cy="62" r="3" fill="none" stroke="${c}" stroke-width="1.5"/><rect x="34" y="60" width="14" height="5.5" rx="2.75" fill="none" stroke="${c}" stroke-width="1.6"/>`,
  towed_t:     (c) => `<rect x="24" y="60" width="14" height="5.5" rx="2.75" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="45" cy="62" r="3" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  horse:       (c) => `<path d="M31 58 V63 Q31 66 36 66 Q41 66 41 63 V58" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  air_assault: (c) => `<path d="M22 56 L36 64 L50 56" stroke="${c}" stroke-width="1.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
  mountain:    (c) => `<path d="M24 66 L36 56 L48 66 Z" fill="${c}"/>`,
  heavy:       (c) => `<text x="36" y="62" dy="0.35em" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="900" fill="${c}">H</text>`,
  medium:      (c) => `<text x="36" y="62" dy="0.35em" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="900" fill="${c}">M</text>`,
  light:       (c) => `<text x="36" y="62" dy="0.35em" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="900" fill="${c}">L</text>`,
};

const ECHELONS = {
  army:{name:'集团军'}, corps:{name:'军'}, division:{name:'师'},
  brigade:{name:'旅'}, regiment:{name:'团'}, battalion:{name:'营'},
  company:{name:'连'}, platoon:{name:'排'}, section:{name:'分队'},
  squad:{name:'班'}, team:{name:'火力组'}, individual:{name:'单兵'},
};
const ECHELON_ORDER = ['army','corps','division','brigade','regiment','battalion','company','platoon','section','squad','team','individual'];

const AUX_TYPES = [
  'artillery','mlrs','mortar','anti_tank','aaa',
  'engineer','bridging','signal','medical','supply','combat_support','mp','hq',
  'towed_w','towed_t',
  'recon','recon_mech',
  'rotary','fixedwing','attack_heli','uav_unit',
];

const FRAME_W = 72, FRAME_H = 48, TOP_PAD = 22;
const SYM_W = FRAME_W, SYM_H = FRAME_H + TOP_PAD, FRAME_Y = TOP_PAD;
const INK_LIGHT = '#0a3d91', PAPER_LIGHT = '#dce8f7';
const INK_DARK  = '#7cb1f0', PAPER_DARK  = '#1e3a5f';
const BORDER_SW = 3;

const DEFAULT_VERT_ECHELONS = new Set(['platoon', 'section', 'squad', 'team', 'individual']);

/* ============================================================
   预设编制：所有 make / build 函数
   ============================================================ */

function makeBattalion(type, bnP, bnE, coP, coE, plP, plE, sqP, sqE) {
  const bn = newNode(type, 'battalion');
  bn.personnel = bnP;
  bn.equipment = JSON.parse(JSON.stringify(bnE));
  for (let c = 0; c < 3; c++) {
    const co = newNode(type, 'company');
    co.personnel = coP;
    co.equipment = JSON.parse(JSON.stringify(coE));
    for (let p = 0; p < 3; p++) {
      const pl = newNode(type, 'platoon');
      pl.personnel = plP;
      pl.equipment = JSON.parse(JSON.stringify(plE));
      for (let s = 0; s < 3; s++) {
        const sq = newNode(type, 'squad');
        sq.personnel = sqP;
        sq.equipment = JSON.parse(JSON.stringify(sqE));
        pl.children.push(sq);
      }
      co.children.push(pl);
    }
    bn.children.push(co);
  }
  return bn;
}

function makeInfantryBattalion() {
  return makeBattalion('infantry',
    60, [{name:'指挥车',count:1},{name:'迫击炮',count:6},{name:'重机枪',count:6},{name:'轻机枪',count:9}],
    120, [{name:'迫击炮',count:2},{name:'重机枪',count:2},{name:'轻机枪',count:6}],
    32, [{name:'轻机枪',count:2},{name:'迫击炮',count:1}],
    9, [{name:'轻机枪',count:1}]);
}
function makeMechBattalion() {
  return makeBattalion('mech',
    60, [{name:'指挥车',count:2},{name:'重机枪',count:6},{name:'迫击炮',count:6},{name:'轻机枪',count:8}],
    130, [{name:'步兵战车',count:13},{name:'轻机枪',count:6},{name:'重机枪',count:3},{name:'迫击炮',count:2}],
    32, [{name:'步兵战车',count:4},{name:'轻机枪',count:3},{name:'反坦克导弹',count:2}],
    9, [{name:'轻机枪',count:1},{name:'反坦克导弹',count:1}]);
}
function makeArmorBattalion() {
  const bn = newNode('armor','battalion');
  bn.personnel = 52;
  bn.equipment = [{name:'指挥车',count:2},{name:'重机枪',count:4},{name:'迫击炮',count:2},{name:'轻机枪',count:6}];
  for (let c=0;c<3;c++){
    const co = newNode('armor','company');
    co.personnel = 14;
    co.equipment = [{name:'主战坦克',count:14},{name:'轻机枪',count:4},{name:'重机枪',count:1}];
    for (let p=0;p<3;p++){
      const pl = newNode('armor','platoon');
      pl.personnel = 4;
      pl.equipment = [{name:'主战坦克',count:4},{name:'轻机枪',count:1}];
      for (let s=0;s<4;s++){
        const sq = newNode('armor','squad');
        sq.personnel = 3;
        sq.equipment = [{name:'主战坦克',count:1}];
        pl.children.push(sq);
      }
      co.children.push(pl);
    }
    bn.children.push(co);
  }
  return bn;
}
function makeAirborneBattalion() {
  return makeBattalion('airborne',
    50, [{name:'迫击炮',count:6},{name:'重机枪',count:6},{name:'轻机枪',count:12},{name:'反坦克导弹',count:8}],
    110, [{name:'迫击炮',count:2},{name:'重机枪',count:2},{name:'轻机枪',count:6},{name:'反坦克导弹',count:2}],
    30, [{name:'轻机枪',count:2},{name:'反坦克导弹',count:1}],
    9, [{name:'轻机枪',count:1}]);
}

function makeArtyBattalion(kind) {
  const bn = newNode('artillery','battalion');
  bn.personnel = 30;
  const eqName = kind === 'mlrs' ? '多管火箭炮' : (kind === 'light' ? '轻型榴弹炮' : '自行火炮');
  bn.equipment = [{name:'指挥车',count:2},{name:eqName,count:18},{name:'轻机枪',count:12},{name:'迫击炮',count:4}];
  for (let c=0;c<3;c++){
    const co = newNode('artillery','company');
    co.personnel = 60;
    co.equipment = [{name:eqName,count:6},{name:'轻机枪',count:4}];
    for (let p=0;p<2;p++){
      const pl = newNode('artillery','platoon');
      pl.personnel = 20;
      pl.equipment = [{name:eqName,count:3},{name:'轻机枪',count:2}];
      co.children.push(pl);
    }
    bn.children.push(co);
  }
  return bn;
}
function makeAaaBattalion() {
  const bn = newNode('aaa','battalion');
  bn.personnel = 40;
  bn.equipment = [{name:'指挥车',count:2},{name:'自行高炮',count:18},{name:'防空导弹',count:12},{name:'轻机枪',count:8},{name:'重机枪',count:4}];
  for (let c=0;c<3;c++){
    const co = newNode('aaa','company');
    co.personnel = 80;
    co.equipment = [{name:'自行高炮',count:6},{name:'轻机枪',count:2}];
    bn.children.push(co);
  }
  return bn;
}
function makeAntiTankBattalion() {
  const bn = newNode('anti_tank','battalion');
  bn.personnel = 40;
  bn.equipment = [{name:'指挥车',count:2},{name:'反坦克导弹',count:24},{name:'反坦克炮',count:12},{name:'轻机枪',count:8},{name:'重机枪',count:4}];
  for (let c=0;c<3;c++){
    const co = newNode('anti_tank','company');
    co.personnel = 80;
    co.equipment = [{name:'反坦克导弹',count:8},{name:'轻机枪',count:2}];
    bn.children.push(co);
  }
  return bn;
}
function makeReconBattalion(mech) {
  const bn = newNode(mech ? 'recon_mech' : 'recon', 'battalion');
  bn.personnel = 50;
  bn.equipment = [{name:'指挥车',count:3},{name:'装甲侦察车',count:24},{name:'轻机枪',count:12},{name:'重机枪',count:6},{name:'反坦克导弹',count:8},{name:'迫击炮',count:4}];
  for (let c=0;c<3;c++){
    const co = newNode(mech ? 'recon_mech' : 'recon', 'company');
    co.personnel = 90;
    co.equipment = [{name:'装甲侦察车',count:8},{name:'轻机枪',count:4},{name:'重机枪',count:2},{name:'反坦克导弹',count:2}];
    bn.children.push(co);
  }
  return bn;
}
function makeEngineerBattalion() {
  const bn = newNode('engineer','battalion');
  bn.personnel = 60;
  bn.equipment = [{name:'指挥车',count:2},{name:'工程车',count:15},{name:'轻机枪',count:12},{name:'重机枪',count:4},{name:'迫击炮',count:4}];
  for (let c=0;c<3;c++){
    const co = newNode('engineer','company');
    co.personnel = 100;
    co.equipment = [{name:'工程车',count:5},{name:'轻机枪',count:4},{name:'重机枪',count:2}];
    bn.children.push(co);
  }
  return bn;
}
function makeSignalBattalion() {
  const bn = newNode('signal','battalion');
  bn.personnel = 50;
  bn.equipment = [{name:'指挥车',count:4},{name:'通信车',count:18},{name:'轻机枪',count:10},{name:'重机枪',count:4}];
  for (let c=0;c<3;c++){
    const co = newNode('signal','company');
    co.personnel = 80;
    co.equipment = [{name:'通信车',count:6},{name:'轻机枪',count:2}];
    bn.children.push(co);
  }
  return bn;
}
function makeSupplyBattalion() {
  const bn = newNode('supply','battalion');
  bn.personnel = 60;
  bn.equipment = [{name:'指挥车',count:2},{name:'运输卡车',count:60},{name:'油罐车',count:20},{name:'轻机枪',count:12},{name:'重机枪',count:6}];
  for (let c=0;c<3;c++){
    const co = newNode('supply','company');
    co.personnel = 120;
    co.equipment = [{name:'运输卡车',count:20},{name:'轻机枪',count:2}];
    bn.children.push(co);
  }
  return bn;
}
function makeMedicalBattalion() {
  const bn = newNode('medical','battalion');
  bn.personnel = 40;
  bn.equipment = [{name:'指挥车',count:2},{name:'救护车',count:20},{name:'轻机枪',count:6}];
  for (let c=0;c<2;c++){
    const co = newNode('medical','company');
    co.personnel = 80;
    co.equipment = [{name:'救护车',count:10},{name:'轻机枪',count:3}];
    bn.children.push(co);
  }
  return bn;
}
function makeHqCompany() {
  const hq = newNode('hq','battalion');
  hq.personnel = 120;
  hq.equipment = [{name:'指挥车',count:8},{name:'运输卡车',count:12},{name:'轻机枪',count:20},{name:'重机枪',count:8}];
  const guard = newNode('infantry','company');
  guard.personnel = 120;
  guard.equipment = [{name:'轻机枪',count:12},{name:'重机枪',count:6},{name:'迫击炮',count:4},{name:'装甲输送车',count:6}];
  hq.children.push(guard);
  return hq;
}

function makeRegiment(type, name, hqP, hqE, bnFactory, bnCount) {
  const r = newNode(type, 'regiment', name);
  r.personnel = 60;
  r.equipment = [{name:'指挥车',count:3},{name:'轻机枪',count:8},{name:'重机枪',count:4}];
  const hq = newNode('hq','battalion');
  hq.personnel = hqP;
  hq.equipment = hqE;
  r.children.push(hq);
  for (let i = 0; i < bnCount; i++) r.children.push(bnFactory());
  return r;
}

function buildEmptyDivision() {
  uid = 0;
  return newNode('infantry','division','新建师');
}

function buildArmorDivision() {
  uid = 0;
  const r = newNode('armor','division','第1装甲师');
  r.personnel = 180;
  r.equipment = [{name:'指挥车',count:8},{name:'运输卡车',count:20},{name:'轻机枪',count:30},{name:'重机枪',count:12}];

  const artyReg = newNode('artillery','regiment','炮兵团');
  artyReg.personnel = 60;
  artyReg.equipment = [{name:'指挥车',count:4},{name:'轻机枪',count:12},{name:'重机枪',count:6}];
  const artyHq = newNode('hq','battalion');
  artyHq.personnel = 40;
  artyHq.equipment = [{name:'指挥车',count:3},{name:'轻机枪',count:6}];
  artyReg.children.push(artyHq, makeArtyBattalion('spg'), makeArtyBattalion('spg'), makeArtyBattalion('mlrs'));

  r.children.push(
    makeRegiment('armor','第1装甲团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeArmorBattalion, 3),
    makeRegiment('armor','第2装甲团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeArmorBattalion, 3),
    makeRegiment('mech','机步团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeMechBattalion, 3),
    artyReg,
    makeAaaBattalion(), makeAntiTankBattalion(), makeReconBattalion(true),
    makeEngineerBattalion(), makeSignalBattalion(), makeSupplyBattalion(),
    makeMedicalBattalion(), makeHqCompany()
  );
  renumber(r, false);
  forEachNode(r, n => { if (n !== r && n.children.length) n.collapsed = true; });
  return r;
}

function buildInfantryDivision() {
  uid = 0;
  const r = newNode('infantry','division','第1步兵师');
  r.personnel = 180;
  r.equipment = [{name:'指挥车',count:8},{name:'运输卡车',count:20},{name:'轻机枪',count:30},{name:'重机枪',count:12}];

  r.children.push(
    makeRegiment('infantry','第1步兵团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeInfantryBattalion, 3),
    makeRegiment('infantry','第2步兵团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeInfantryBattalion, 3),
    makeRegiment('infantry','第3步兵团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeInfantryBattalion, 3),
    makeRegiment('artillery','炮兵团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], () => makeArtyBattalion('spg'), 3),
    makeAaaBattalion(), makeAntiTankBattalion(), makeReconBattalion(false),
    makeEngineerBattalion(), makeSignalBattalion(), makeSupplyBattalion(),
    makeMedicalBattalion(), makeHqCompany()
  );
  renumber(r, false);
  forEachNode(r, n => { if (n !== r && n.children.length) n.collapsed = true; });
  return r;
}

function buildMechDivision() {
  uid = 0;
  const r = newNode('mech','division','第1机械化步兵师');
  r.personnel = 200;
  r.equipment = [{name:'指挥车',count:10},{name:'运输卡车',count:24},{name:'轻机枪',count:34},{name:'重机枪',count:14}];

  r.children.push(
    makeRegiment('mech','第1机步团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeMechBattalion, 3),
    makeRegiment('mech','第2机步团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeMechBattalion, 3),
    makeRegiment('armor','装甲团', 50, [{name:'指挥车',count:3},{name:'轻机枪',count:6},{name:'重机枪',count:4}], makeArmorBattalion, 3),
    makeRegiment('artillery','炮兵团', 40, [{name:'指挥车',count:3},{name:'轻机枪',count:6}], () => makeArtyBattalion('spg'), 3),
    makeAaaBattalion(), makeAntiTankBattalion(), makeReconBattalion(true),
    makeEngineerBattalion(), makeSignalBattalion(), makeSupplyBattalion(),
    makeMedicalBattalion(), makeHqCompany()
  );
  renumber(r, false);
  forEachNode(r, n => { if (n !== r && n.children.length) n.collapsed = true; });
  return r;
}

function buildAirborneDivision() {
  uid = 0;
  const r = newNode('airborne','division','第1空降师');
  r.personnel = 150;
  r.equipment = [{name:'指挥车',count:6},{name:'运输卡车',count:16},{name:'轻机枪',count:30},{name:'重机枪',count:10}];

  r.children.push(
    makeRegiment('airborne','第1空降团', 35, [{name:'指挥车',count:2},{name:'轻机枪',count:6}], makeAirborneBattalion, 3),
    makeRegiment('airborne','第2空降团', 35, [{name:'指挥车',count:2},{name:'轻机枪',count:6}], makeAirborneBattalion, 3),
    makeRegiment('airborne','第3空降团', 35, [{name:'指挥车',count:2},{name:'轻机枪',count:6}], makeAirborneBattalion, 3),
    makeRegiment('artillery','空降炮兵团', 30, [{name:'指挥车',count:2},{name:'轻机枪',count:6}], () => makeArtyBattalion('light'), 3),
    makeAaaBattalion(), makeAntiTankBattalion(), makeReconBattalion(false),
    makeEngineerBattalion(), makeSignalBattalion(), makeSupplyBattalion(),
    makeMedicalBattalion(), makeHqCompany()
  );
  renumber(r, false);
  forEachNode(r, n => { if (n !== r && n.children.length) n.collapsed = true; });
  return r;
}

function build101stAirAssault() {
  uid = 0;
  const r = newNode('airborne','division','第101空中突击师');
  r.personnel = 200;
  r.equipment = [{name:'指挥车',count:12},{name:'运输卡车',count:30},{name:'轻机枪',count:40},{name:'重机枪',count:16}];

  for (let b = 1; b <= 3; b++) {
    const bde = newNode('airborne','brigade',`第${b}空中突击旅`);
    bde.personnel = 120;
    bde.equipment = [{name:'指挥车',count:6},{name:'轻机枪',count:16},{name:'重机枪',count:6}];
    const hqBn = newNode('hq','battalion','旅部营');
    hqBn.personnel = 60;
    hqBn.equipment = [{name:'指挥车',count:4},{name:'轻机枪',count:8}];
    bde.children.push(hqBn);
    for (let i = 1; i <= 3; i++) {
      const bn = makeAirborneBattalion();
      bn.name = `第${i}空中突击营`;
      bde.children.push(bn);
    }
    const artyBn = makeArtyBattalion('light');
    artyBn.name = '旅属炮兵营';
    bde.children.push(artyBn);
    const reconBn = makeReconBattalion(false);
    reconBn.name = '旅属侦察营';
    bde.children.push(reconBn);
    r.children.push(bde);
  }

  const cab = newNode('rotary','brigade','第101战斗航空旅');
  cab.personnel = 200;
  cab.equipment = [{name:'指挥车',count:8},{name:'轻机枪',count:20},{name:'重机枪',count:8}];
  for (let i = 1; i <= 3; i++) {
    const ahBn = newNode('attack_heli','battalion',`第${i}攻击直升机营`);
    ahBn.personnel = 80;
    ahBn.equipment = [{name:'AH-64E阿帕奇',count:24},{name:'轻机枪',count:8}];
    cab.children.push(ahBn);
  }
  for (let i = 1; i <= 5; i++) {
    const uhBn = newNode('rotary','battalion',`第${i}突击直升机营`);
    uhBn.personnel = 60;
    uhBn.equipment = [{name:'UH-60M黑鹰',count:24},{name:'轻机枪',count:6}];
    cab.children.push(uhBn);
  }
  const chBn = newNode('rotary','battalion','重型运输直升机营');
  chBn.personnel = 50;
  chBn.equipment = [{name:'CH-47F支奴干',count:24},{name:'轻机枪',count:4}];
  cab.children.push(chBn);
  r.children.push(cab);

  const divArty = newNode('artillery','brigade','师属炮兵');
  divArty.personnel = 80;
  divArty.equipment = [{name:'指挥车',count:4},{name:'轻机枪',count:12}];
  for (let i = 1; i <= 3; i++) {
    const bn = makeArtyBattalion('spg');
    bn.name = `第${i}155mm榴弹炮营`;
    divArty.children.push(bn);
  }
  const himars = newNode('mlrs','battalion','HIMARS营');
  himars.personnel = 40;
  himars.equipment = [{name:'M142 HIMARS',count:18},{name:'轻机枪',count:8}];
  divArty.children.push(himars);
  r.children.push(divArty);

  const susBde = newNode('supply','brigade','第101保障旅');
  susBde.personnel = 80;
  susBde.equipment = [{name:'指挥车',count:4},{name:'运输卡车',count:40}];
  susBde.children.push(makeSupplyBattalion());
  susBde.children.push(makeMedicalBattalion());
  susBde.children.push(makeSignalBattalion());
  susBde.children.push(makeEngineerBattalion());
  susBde.children.push(makeHqCompany());
  r.children.push(susBde);

  renumber(r, false);
  forEachNode(r, n => { if (n !== r && n.children.length) n.collapsed = true; });
  return r;
}

function build1stMarineDivision() {
  uid = 0;
  const r = newNode('infantry','division','陆战第1师');
  r.personnel = 200;
  r.equipment = [{name:'指挥车',count:8},{name:'运输卡车',count:24},{name:'轻机枪',count:40},{name:'重机枪',count:16}];

  const regNames = ['陆战第1团', '陆战第5团', '陆战第7团'];
  for (const rn of regNames) {
    const reg = makeRegiment('infantry', rn, 40,
      [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeInfantryBattalion, 3);
    r.children.push(reg);
  }

  const artyReg = newNode('artillery','regiment','第11炮兵团');
  artyReg.personnel = 60;
  artyReg.equipment = [{name:'指挥车',count:4},{name:'轻机枪',count:12},{name:'重机枪',count:6}];
  const artyHq = newNode('hq','battalion');
  artyHq.personnel = 40;
  artyHq.equipment = [{name:'指挥车',count:3},{name:'轻机枪',count:6}];
  artyReg.children.push(artyHq);
  for (let i = 1; i <= 4; i++) {
    const bn = makeArtyBattalion('light');
    bn.name = `第${i}炮兵营`;
    artyReg.children.push(bn);
  }
  r.children.push(artyReg);

  const tank = newNode('armor','battalion','师属坦克营');
  tank.personnel = 50;
  tank.equipment = [{name:'M4A3谢尔曼',count:70},{name:'轻机枪',count:16}];
  r.children.push(tank);

  const eng = makeEngineerBattalion(); eng.name = '师属工兵营'; r.children.push(eng);
  const med = makeMedicalBattalion(); med.name = '师属医疗营'; r.children.push(med);
  const sig = makeSignalBattalion(); sig.name = '师属通信营'; r.children.push(sig);
  const recon = makeReconBattalion(false); recon.name = '师属侦察营'; r.children.push(recon);
  const supp = makeSupplyBattalion(); supp.name = '师属补给营'; r.children.push(supp);
  const hq = makeHqCompany(); hq.name = '师部营'; r.children.push(hq);

  renumber(r, false);
  forEachNode(r, n => { if (n !== r && n.children.length) n.collapsed = true; });
  return r;
}

function buildGrossdeutschland() {
  uid = 0;
  const r = newNode('armor','division','大德意志装甲师');
  r.personnel = 200;
  r.equipment = [{name:'指挥车',count:10},{name:'运输卡车',count:40},{name:'轻机枪',count:50},{name:'重机枪',count:20}];

  const pzReg = newNode('armor','regiment','大德意志装甲团');
  pzReg.personnel = 80;
  pzReg.equipment = [{name:'指挥车',count:4},{name:'轻机枪',count:12},{name:'重机枪',count:6}];
  for (let i = 1; i <= 2; i++) {
    const bn = makeArmorBattalion();
    bn.name = `第${i}装甲营`;
    pzReg.children.push(bn);
  }
  const tigerBn = newNode('armor','battalion','虎式重装甲营');
  tigerBn.personnel = 40;
  tigerBn.equipment = [{name:'虎式坦克',count:45},{name:'轻机枪',count:8}];
  pzReg.children.push(tigerBn);
  r.children.push(pzReg);

  const pzgNames = ['第1装甲掷弹兵团', '第2装甲掷弹兵团'];
  for (const pn of pzgNames) {
    const reg = makeRegiment('mech', pn, 40,
      [{name:'指挥车',count:3},{name:'轻机枪',count:6}], makeMechBattalion, 3);
    r.children.push(reg);
  }

  const artyReg = makeRegiment('artillery','大德意志炮兵团', 40,
    [{name:'指挥车',count:3},{name:'轻机枪',count:6}], () => makeArtyBattalion('spg'), 3);
  r.children.push(artyReg);

  const rec = makeReconBattalion(true); rec.name = '师属装甲侦察营'; r.children.push(rec);
  const at = makeAntiTankBattalion(); at.name = '师属反坦克营'; r.children.push(at);
  const aa = makeAaaBattalion(); aa.name = '师属防空营'; r.children.push(aa);
  const eng = makeEngineerBattalion(); eng.name = '师属工兵营'; r.children.push(eng);
  const sig = makeSignalBattalion(); sig.name = '师属通信营'; r.children.push(sig);
  const supp = makeSupplyBattalion(); supp.name = '师属补给营'; r.children.push(supp);
  const med = makeMedicalBattalion(); med.name = '师属医疗营'; r.children.push(med);
  const hq = makeHqCompany(); hq.name = '师部'; r.children.push(hq);

  renumber(r, false);
  forEachNode(r, n => { if (n !== r && n.children.length) n.collapsed = true; });
  return r;
}

function build88thDivision() {
  uid = 0;
  const r = newNode('infantry','division','第88师');
  r.personnel = 200;
  r.equipment = [{name:'指挥车',count:4},{name:'运输卡车',count:12},{name:'轻机枪',count:40},{name:'重机枪',count:16}];

  const brigadeDefs = [
    { name: '第262旅', regs: ['第524团', '第523团'] },
    { name: '第264旅', regs: ['第527团', '第528团'] },
  ];
  for (const bd of brigadeDefs) {
    const bde = newNode('infantry','brigade', bd.name);
    bde.personnel = 80;
    bde.equipment = [{name:'指挥车',count:2},{name:'轻机枪',count:8}];
    for (const rn of bd.regs) {
      const reg = makeRegiment('infantry', rn, 30,
        [{name:'指挥车',count:2},{name:'轻机枪',count:4}], makeInfantryBattalion, 3);
      bde.children.push(reg);
    }
    r.children.push(bde);
  }

  const arty = newNode('artillery','battalion','师属炮兵营');
  arty.personnel = 60;
  arty.equipment = [{name:'75mm山炮',count:12},{name:'轻机枪',count:12}];
  for (let i = 1; i <= 3; i++) {
    const co = newNode('artillery','company',`第${i}炮兵连`);
    co.personnel = 20;
    co.equipment = [{name:'75mm山炮',count:4},{name:'轻机枪',count:4}];
    arty.children.push(co);
  }
  r.children.push(arty);

  const eng = makeEngineerBattalion(); eng.name = '师属工兵营'; r.children.push(eng);
  const sig = makeSignalBattalion(); sig.name = '师属通信营'; r.children.push(sig);
  const supp = makeSupplyBattalion(); supp.name = '师属辎重营'; r.children.push(supp);
  const med = makeMedicalBattalion(); med.name = '师属卫生队'; r.children.push(med);
  const hq = makeHqCompany(); hq.name = '师部特务营'; r.children.push(hq);

  renumber(r, false);
  forEachNode(r, n => { if (n !== r && n.children.length) n.collapsed = true; });
  return r;
}

const PRESETS = {
  blank:      buildEmptyDivision,
  armor:      buildArmorDivision,
  infantry:   buildInfantryDivision,
  mech:       buildMechDivision,
  '101st':    build101stAirAssault,
  marine1:    build1stMarineDivision,
  grossde:    buildGrossdeutschland,
  division88: build88thDivision,
};