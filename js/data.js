/* ============================================================
   data.js — 兵种表、图标、预设
   必须第一个加载，为其他文件提供 TYPES、ICON_PARTS 等常量
   ============================================================ */

/* 兵种表：结构 = 主元素(main) + 框内上部修饰(s1) + 框内下部属性(s2) */
const TYPES = {
  /* —— 机动 —— */
  infantry:       { name:'步兵',           cat:'maneuver' },
  light_infantry: { name:'轻步兵',         cat:'maneuver' },
  mech:           { name:'机步',           cat:'maneuver' },
  armor:          { name:'装甲',           cat:'maneuver' },
  light_armor:    { name:'轻型装甲',       cat:'maneuver' },
  heavy_armor:    { name:'重型装甲',       cat:'maneuver' },
  airborne:       { name:'空降',           cat:'maneuver' },
  air_assault:    { name:'空中突击',       cat:'maneuver' },
  mountain:       { name:'山地',           cat:'maneuver' },
  recon:          { name:'侦察',           cat:'maneuver' },
  recon_mech:     { name:'侦察（机械）',   cat:'maneuver' },
  wheeled_inf:    { name:'摩托化步兵',     cat:'maneuver' },

  /* —— 火力 —— */
  artillery:      { name:'炮兵',           cat:'fire' },
  mlrs:           { name:'多管火箭炮',     cat:'fire' },
  mortar:         { name:'迫击炮',         cat:'fire' },
  anti_tank:      { name:'反坦克',         cat:'fire' },
  aaa:            { name:'防空',           cat:'fire' },
  towed_w:        { name:'轮式牵引炮',     cat:'fire' },
  towed_t:        { name:'履带牵引炮',     cat:'fire' },

  /* —— 航空 —— */
  rotary:         { name:'旋翼航空',       cat:'air' },
  fixedwing:      { name:'固定翼航空',     cat:'air' },
  attack_heli:    { name:'攻击直升机',     cat:'air' },
  uav_unit:       { name:'无人机部队',     cat:'air' },

  /* —— 保障 —— */
  engineer:       { name:'工兵',           cat:'support' },
  signal:         { name:'通讯',           cat:'support' },
  medical:        { name:'医疗',           cat:'support' },
  supply:         { name:'补给',           cat:'support' },
  /* ★ R10.29：按玩家要求删掉「指挥 / 作战支援 / 宪兵 / 后勤 / 架桥」
     （前四个主图形是字母，已有自定义文字；架桥图标不对） */
};

/* ★ R10.31：**自定义兵牌功能已删除**，兵种库改为「标准库目录」
   —— 数据在 js/ms-catalog.js（MS_CATALOG），来源 MIL-STD-2525D / APP-6 官方表；
       ★ R10.32：玩家要求「只要长方形边框的」→ 只收陆地单位，并按兵种重新分组。
       每个条目自带 15 位 SIDC，画的时候只把梯队写进第 12 位（见 js/milsymbol-bridge.js）。
   老存档里的 type 键（infantry / armor …）继续有效，只是渲染也走标准库。
   被删掉的旧目录兵牌（空中/海面/水下…）在 msPlan 里退化成空矩形框，不会报错。 */
const TYPES_CAT = [];          // 面板用： [{ id, n, subs: [{ n, keys: [...] }] }]

(function mergeCatalogTypes() {
  if (typeof MS_CATALOG === 'undefined' || !MS_CATALOG) return;
  MS_CATALOG.forEach(cat => {
    const c = { id: cat.id, n: cat.n, subs: [] };
    (cat.subs || []).forEach(sub => {
      const s = { n: sub.n, keys: [] };
      (sub.items || []).forEach(it => {
        if (!it || !it.s) return;
        let key = 'ms_' + String(it.s).replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (TYPES[key]) {
          let i = 2;
          while (TYPES[key + '_' + i]) i++;
          key = key + '_' + i;
        }
        TYPES[key] = { name: it.n, cat: cat.id, sidc: it.s };
        s.keys.push(key);
      });
      if (s.keys.length) c.subs.push(s);
    });
    if (c.subs.length) TYPES_CAT.push(c);
  });
})();

/* ★ R10.25：**手绘图元库已整体删除**
   ICON_PARTS / SECTOR1_PARTS / SECTOR2_PARTS / CHIP_LABELS / _rotary… 全部不要了。
   兵牌一律由 MIL-STD-2525 库（milsymbol）绘制，见 js/milsymbol-bridge.js；
   兵种清单在 js/ms-catalog.js（标准库目录，自动生成）。 */

const ECHELONS = {
  army:{name:'集团军'}, corps:{name:'军'}, division:{name:'师'},
  brigade:{name:'旅'}, regiment:{name:'团'}, battalion:{name:'营'},
  company:{name:'连'}, platoon:{name:'排'}, section:{name:'分队'},
  squad:{name:'班'}, team:{name:'火力组'}, individual:{name:'单兵'},
};
const ECHELON_ORDER = ['army','corps','division','brigade','regiment','battalion','company','platoon','section','squad','team','individual'];

const AUX_TYPES = [
  'artillery','mlrs','mortar','anti_tank','aaa',
  'engineer','signal','medical','supply',
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
    60, [{name:'指挥车',count:1},{name:'突击步枪',count:15},{name:'迫击炮',count:6},{name:'重机枪',count:6},{name:'轻机枪',count:9}],
    120, [{name:'突击步枪',count:30},{name:'迫击炮',count:2},{name:'重机枪',count:2},{name:'轻机枪',count:6}],
    32, [{name:'突击步枪',count:10},{name:'轻机枪',count:2},{name:'迫击炮',count:1}],
    9, [{name:'突击步枪',count:8},{name:'轻机枪',count:1}]);
}
function makeMechBattalion() {
  return makeBattalion('mech',
    60, [{name:'指挥车',count:2},{name:'突击步枪',count:15},{name:'重机枪',count:6},{name:'迫击炮',count:6},{name:'轻机枪',count:8}],
    130, [{name:'步兵战车',count:13},{name:'突击步枪',count:30},{name:'轻机枪',count:6},{name:'重机枪',count:3},{name:'迫击炮',count:2}],
    32, [{name:'步兵战车',count:4},{name:'突击步枪',count:10},{name:'轻机枪',count:3},{name:'反坦克导弹',count:2}],
    9, [{name:'突击步枪',count:8},{name:'轻机枪',count:1},{name:'反坦克导弹',count:1}]);
}
function makeArmorBattalion() {
  const bn = newNode('armor','battalion');
  bn.personnel = 52;
  bn.equipment = [{name:'指挥车',count:2},{name:'突击步枪',count:10},{name:'重机枪',count:4},{name:'迫击炮',count:2},{name:'轻机枪',count:6}];
  for (let c=0;c<3;c++){
    const co = newNode('armor','company');
    co.personnel = 14;
    co.equipment = [{name:'主战坦克',count:14},{name:'突击步枪',count:4},{name:'轻机枪',count:4},{name:'重机枪',count:1}];
    for (let p=0;p<3;p++){
      const pl = newNode('armor','platoon');
      pl.personnel = 4;
      pl.equipment = [{name:'主战坦克',count:4},{name:'突击步枪',count:1},{name:'轻机枪',count:1}];
      for (let s=0;s<4;s++){
        const sq = newNode('armor','squad');
        sq.personnel = 3;
        sq.equipment = [{name:'主战坦克',count:1},{name:'突击步枪',count:3}];
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
    50, [{name:'突击步枪',count:12},{name:'迫击炮',count:6},{name:'重机枪',count:6},{name:'轻机枪',count:12},{name:'反坦克导弹',count:8}],
    110, [{name:'突击步枪',count:28},{name:'迫击炮',count:2},{name:'重机枪',count:2},{name:'轻机枪',count:6},{name:'反坦克导弹',count:2}],
    30, [{name:'突击步枪',count:10},{name:'轻机枪',count:2},{name:'反坦克导弹',count:1}],
    9, [{name:'突击步枪',count:8},{name:'轻机枪',count:1}]);
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
  const hq = newNode('signal','battalion');
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
  const hq = newNode('signal','battalion');
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
  const artyHq = newNode('signal','battalion');
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
    const hqBn = newNode('signal','battalion','旅部营');
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
  const artyHq = newNode('signal','battalion');
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