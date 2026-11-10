/* ============================================================
   hex_probe.js —— 用 Node 直接跑 js/hex-core.js 的**数值体检**
   ------------------------------------------------------------
   为什么单独写这个：hex-core.js 是纯函数（不碰 DOM），可以直接 new Function 加载，
   于是"规则对不对"可以离线验证 —— 不用开浏览器、不用截图。

   用法：node tools/hex_probe.js         （人看）
        node tools/hex_probe.js --json  （tools/hex_core_test.py 读）
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'hex-core.js'), 'utf8');

const api = new Function(src + `
  return { HEX_EDGE, HEX_W, HEX_H, HEX_ROW_STEP,
           hexCenter, worldToHex, hexNeighbors, hexDistance, hexLine, hexCorners,
           FLV_MAX, RAW12, DIE_FACTOR, CRT_RULES, crtLookup, crtEff, crtEffRow, crtKills,
           flvFromRaw, falloffSoft, falloffHard, counterRaw, counterFlv,
           counterRangeHex, counterPenetration, resolveFire, diceDist,
           FLV_TERR_PENALTY, MP_MAX, MP_COST };
`)();

/* ---------- 造几个"标准棋子"（数值全部来自装备库默认值） ---------- */
/* 数值全部取自装备库的**真实毫米**种子（R10.7 之后）：
   步枪 6 / 轻机枪 8 / 火箭筒 100mm 破甲 / 坦克 51mm 装甲 + 66mm 穿深 */
const RIFLE = { name: '步枪', cat: 'small_arms', antiPersonnel: 10, penetration: 0, range: 400, ammo: 120 };
const MG = { name: '轻机枪', cat: 'small_arms', antiPersonnel: 14, penetration: 0, range: 600, ammo: 200 };
const ROCKET = { name: '火箭筒', cat: 'at_weapon', antiPersonnel: 8, penetration: 100, range: 300, ammo: 3 };

function squad(opts) {
  const o = opts || {};
  const men = o.men == null ? 9 : o.men;
  const w = o.weapon || RIFLE;
  const members = [];
  for (let i = 0; i < men; i++) members.push({ alive: true, weapon: Object.assign({}, w) });
  return {
    id: 'p' + men + (o.weapon ? o.weapon.name : 'r'), side: 'blue', kind: 'inf',
    name: (o.name || '班') + men,
    members, supports: o.supports || [],
    mpType: 'foot', mp: 4, mpMax: 4,
    fired: false, suppressed: false, dead: false, armor: 0,
  };
}
function tank() {
  return {
    id: 'tank', side: 'red', kind: 'veh', name: '坦克',
    armor: 51, mpType: 'tracked', mp: 6, mpMax: 6,
    weapons: [{ name: '坦克炮', cat: 'armored_vehicle', antiPersonnel: 30,
                penetration: 66, range: 2500, ammo: 40 }],
    km: false, kf: false, fired: false, suppressed: false, dead: false,
  };
}
function hex(col, row, terr) {
  return { col, row, x: 0, y: 0, terr: terr || 'empty', road: false, bld: 0, obj: -1,
           sight: 0, cover: 0 };
}

/* ---------- 1) 六角格几何 ---------- */
const geo = { roundTripFail: [], neighborFail: [], lineFail: [] };
for (let row = 0; row < 8; row++) {
  for (let col = 0; col < 8; col++) {
    const c = api.hexCenter(col, row);
    const back = api.worldToHex(c.x, c.y);
    if (back.col !== col || back.row !== row) geo.roundTripFail.push([col, row, back.col, back.row]);
    const nbs = api.hexNeighbors(col, row);
    if (nbs.length !== 6) geo.neighborFail.push([col, row, 'count']);
    const seen = new Set();
    for (const nb of nbs) {
      const key = nb.col + ',' + nb.row;
      if (seen.has(key)) geo.neighborFail.push([col, row, 'dup', key]);
      seen.add(key);
      if (api.hexDistance({ col, row }, nb) !== 1) geo.neighborFail.push([col, row, 'dist', key]);
    }
  }
}
for (let d = 1; d <= 6; d++) {
  const a = { col: 4, row: 4 }, b = { col: 4 + d, row: 4 };
  const line = api.hexLine(a, b);
  if (line.length !== Math.max(0, api.hexDistance(a, b) - 1)) geo.lineFail.push([d, line.length]);
}


/* ---------- 2) FLV 阶梯 ---------- */
const units = {
  '班9人·步枪': squad({ men: 9 }),
  '排27人·步枪': squad({ men: 27 }),
  '连81人·步枪': squad({ men: 81 }),
  '班9人·轻机枪': squad({ men: 9, weapon: MG, name: '机枪班' }),
  '反装甲组·火箭筒': squad({ men: 2, weapon: ROCKET, name: '反装甲组' }),
  '坦克·甲51穿66': tank(),
};
const ladders = {};
for (const name of Object.keys(units)) {
  const u = units[name];
  const rng = Math.max(1, api.counterRangeHex(u));
  ladders[name] = { range: rng, soft: [], hard: [] };
  for (let d = 1; d <= Math.min(6, Math.max(1, rng)); d++) {
    ladders[name].soft.push(api.counterFlv(u, d, 'soft'));
    ladders[name].hard.push(api.counterFlv(u, d, 'hard'));
  }
}

/* ---------- 3) CRT：整张表 + 单调性 ---------- */
const SEVERITY = { soft: ['—', 'S', 'K', '2K', '3K'], at: ['—', 'S', 'Km', 'Kf', 'K'],
                   art: ['—', 'S', 'K', '2K', '3K'] };
const crt = {};
const crtViolations = [];
for (const kind of ['soft', 'at', 'art']) {
  crt[kind] = {};
  const sev = SEVERITY[kind];
  for (let flv = 1; flv <= 12; flv++) {
    crt[kind][flv] = {};
    let prevSev = 0;
    for (let roll = 2; roll <= 12; roll++) {
      const code = api.crtLookup(kind, flv, roll);
      crt[kind][flv][roll] = code;
      const s = sev.indexOf(code);
      if (s < 0) crtViolations.push([kind, flv, roll, 'unknown code ' + code]);
      else if (s < prevSev) crtViolations.push([kind, flv, roll, 'roll↑ 结果变差']);
      else prevSev = s;
    }
  }
  for (let roll = 2; roll <= 12; roll++) {
    let prev = 0;
    for (let flv = 1; flv <= 12; flv++) {
      const s = sev.indexOf(crt[kind][flv][roll]);
      if (s < prev) crtViolations.push([kind, flv, roll, 'FLV↑ 结果变差']);
      prev = s;
    }
  }
}

/* ---------- 4) 端到端样例：9 人班 → 树林里的 9 人班（2 格） ---------- */
const atk = squad({ men: 9 });
atk.hex = hex(0, 0);
const def = squad({ men: 9 });
def.hex = hex(2, 0, 'forest');
const samples = [];
for (let roll = 2; roll <= 12; roll++) {
  const r = api.resolveFire(null, atk, def, { roll });
  samples.push({ roll, flv: r.flv, code: r.code, label: r.label });
}

/* ---------- 5) 骰子分布 ---------- */
const dist = api.diceDist().map(p => Math.round(p * 1000) / 10);

const out = {
  edge: api.HEX_EDGE, flvMax: api.FLV_MAX, raw12: api.RAW12,
  geo, ladders, crt, crtViolations, samples, dist,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out));
} else {
  console.log('六角格边长 = ' + out.edge + 'm，FLV 上限 = ' + out.flvMax);
  console.log('几何：往返失败 ' + geo.roundTripFail.length + ' / 邻居失败 ' +
              geo.neighborFail.length + ' / 攻击线失败 ' + geo.lineFail.length);
  console.log('\nFLV 阶梯（1 格 → 最远）：');
  for (const k of Object.keys(ladders)) {
    console.log('  ' + k.padEnd(18) + ' 软 ' + ladders[k].soft.join(',') +
                ' ｜ 硬 ' + ladders[k].hard.join(',') + ' ｜ 射程 ' + ladders[k].range + ' 格');
  }
  console.log('\nCRT 违规：' + (crtViolations.length ? JSON.stringify(crtViolations) : '无'));
  console.log('\n9 人班打树林里的 9 人班（2 格，地形 −2）：');
  for (const s of samples) {
    console.log('  2D6=' + String(s.roll).padStart(2) + '  FLV ' + s.flv +
                '  →  ' + s.code + '（' + s.label + '）');
  }
  console.log('\n2D6 分布 %：' + dist.join(' '));
  console.log('\n反人员 CRT（行=FLV，列=2D6）：');
  for (let flv = 1; flv <= 12; flv++) {
    const line = [];
    for (let roll = 2; roll <= 12; roll++) line.push((crt.soft[flv][roll] + '  ').slice(0, 3));
    console.log('  FLV' + String(flv).padStart(2) + ' ' + line.join(''));
  }
}
