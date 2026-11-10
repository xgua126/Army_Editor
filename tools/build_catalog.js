/* ============================================================
   build_catalog.js —— 把 tools/_ma/catalog.json 变成 js/ms-catalog.js
   ------------------------------------------------------------
   为什么还要这一步：
     JMSML 里的 2525C 标签偶尔把"作战维度"字母写错（比如民事事务写成 S*FPGC…，
     正确应是 SFGPGC…），直接拿来画会只剩一个空框。
     这里用 milsymbol **真的画一遍**：只出空框的，就换维度字母再试，
     哪个画出来的笔画多就用哪个；怎么都画不出来的直接丢掉。
   用法：node tools/build_catalog.js   （先跑 python -X utf8 tools/gen_ms_catalog.py）
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, '_ma', 'catalog.json');
const OUT = path.join(ROOT, 'js', 'ms-catalog.js');

const ctx = { console, window: {}, document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/vendor/milsymbol.js'), 'utf8'), ctx);
const ms = ctx.ms;

/* 每个大类正确的"作战维度"字母（2525C 第 3 位）；null = 保持标签原样
   ★ R10.32：库里只剩陆地单位；F（特种作战维度）也必须改成 G ——
   milsymbol 不认 F，会退化成一个只写「SF」的空框。 */
const DIM = {
  land_unit: 'G', land_equipment: 'G', land_installation: 'G', land_civilian: 'G',
  air: 'A', air_missile: 'A', sea_surface: 'S', mine_warfare: 'S',
  sea_subsurface: 'U', space: 'P', space_missile: 'P', cyberspace: 'G',
  activity: null,
};

function svgOf(sidc) {
  try { return new ms.Symbol(sidc, { size: 30 }).asSVG(); } catch (e) { return ''; }
}
/* 这个 SIDC 画出来是不是一个"真"兵牌：
   ① 库自己要认（isValid）—— 不认的码库会画一个"？"占位（玩家看到的就是这个）
   ② 除了外框还得有图形 —— 只画得出空框的也不要 */
function okSymbol(sidc) {
  let sym = null;
  try { sym = new ms.Symbol(sidc, { size: 30 }); } catch (e) { return false; }
  if (typeof sym.isValid === 'function' && !sym.isValid()) return false;
  const svg = sym.asSVG();
  if (!svg) return false;
  const rest = svg.replace(/<svg[^>]*>|<\/svg>/g, '')
                  .replace(/<path[\s\S]*?<\/path>/, '')     // 第一条 path = 外框
                  .trim();
  return rest.length > 0;
}

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let total = 0, fixed = 0, dropped = 0;
const seen = new Set();
const out = [];

for (const set of data) {
  const dim = DIM[set.id] || 'G';
  const subs = [];
  for (const sub of set.subs) {
    const items = [];
    for (const it of sub.items) {
      /* 把第 3 位强制成本大类的作战维度（JMSML 里有几条写错了，
         比如民事事务写成 S*FPGC…，正确是 SFGPGC…，否则只画得出空框） */
      const s = dim ? (it.s.slice(0, 2) + dim + it.s.slice(3)) : it.s;
      if (s !== it.s) fixed++;
      if (!okSymbol(s)) { dropped++; continue; }          // 画不出图形 / 库不认 → 不要
      if (seen.has(s)) continue;                          // 全库去重
      seen.add(s);
      items.push({ n: it.n, s });
    }
    if (items.length) subs.push({ n: sub.n, items });
  }
  if (subs.length) out.push({ id: set.id, n: set.n, subs });
  total += subs.reduce((a, x) => a + x.items.length, 0);
}

const q = (t) => "'" + String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const lines = [
  '/* ============================================================',
  '   ms-catalog.js —— 陆地单位兵牌库（自动生成，别手改）',
  '   ------------------------------------------------------------',
  '   ★ R10.32：只要长方形框的——只收陆地单位，一个兵种一个页签',
  '   （步兵 / 装甲兵 / 炮兵 / 反坦克 / 防空兵 / 陆军航空兵 / 侦察兵 / 工程兵 …）',
  '   数据源：Esri/joint-military-symbology-xml（MIL-STD-2525D / APP-6 的机器可读版，',
  '          跟 map.army 的 Formations 是同一套标准表）',
  '   结构：MS_CATALOG = [ { id, n 大类中文, subs: [ { n 子类中文, items: [ { n, s } ] } ] } ]',
  '         n = 中文名，s = 15 位 SIDC（友军）',
  '   生成：python -X utf8 tools/gen_ms_catalog.py && node tools/build_catalog.js',
  '   ============================================================ */',
  'const MS_CATALOG = [',
];
for (const set of out) {
  lines.push('  { id: ' + q(set.id) + ', n: ' + q(set.n) + ', subs: [');
  for (const sub of set.subs) {
    lines.push('    { n: ' + q(sub.n) + ', items: [');
    for (const it of sub.items) lines.push('      { n: ' + q(it.n) + ', s: ' + q(it.s) + ' },');
    lines.push('    ] },');
  }
  lines.push('  ] },');
}
lines.push('];');
lines.push('');
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

console.log('sets', out.length, 'items', total, 'fixed', fixed, 'dropped', dropped);
