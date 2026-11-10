/* ============================================================
   milsymbol-bridge.js —— 兵牌统一改用 MIL-STD-2525 / APP-6 库
   ------------------------------------------------------------
   库：milsymbol v3（MIT，见 js/vendor/milsymbol.js，本地内置、不联网）
   为什么：玩家「把整个项目的兵牌样式全部替换为这个库」——
           标准图形（步兵十字、装甲椭圆、防空穹顶、工兵…）全部由库画，
           我们只负责：兵种→SIDC、梯队→SIDC 第 12 位、配色、尺寸。

   15 位字母 SIDC（本文件只用这一种）：
     1    编码方案 S（warfighting）
     2    敌我 F=友军 / H=敌军 / N=中立 / U=未知
     3    作战维度 G=地面 A=空中 P=太空 S=海面 U=水下
     4    状态 P=存在
     5-10 功能码（6 位，见 TYPE_SIDC；第 5 位=第一扇区修饰、第 6 位=第二扇区）
     11   修饰符1（M = 机动）
     12   修饰符2（梯队 A…K，或机动 O/P/Q/R/S…）
     13-14 国家码    15 战斗序列
   ★ 梯队：A 组 B 班 C 分队 D 排 E 连 F 营 G 团 H 旅 I 师 J 军 K 集团军
   ============================================================ */

/* 我方兵种 → 功能码（6 位）。空字符串 / 缺省 = 只画框（用于纯文字兵牌） */
const TYPE_SIDC = {
  /* 机动 */
  infantry:       'UCI---',   // 步兵（十字）
  light_infantry: 'UCIL--',   // 轻步兵
  mech:           'UCII--',   // 机械化步兵（十字 + 装甲椭圆）
  armor:          'UCA---',   // 装甲（椭圆）
  light_armor:    'UCATL-',   // 装甲·轻
  heavy_armor:    'UCATH-',   // 装甲·重
  airborne:       'UCIA--',   // 空降（第一扇区 A）
  air_assault:    'UCIS--',   // 空中突击（第一扇区 S）
  mountain:       'UCIO--',   // 山地（库表里 UCIO = INFANTRY + MOUNTAIN；UCIC 是寒区）
  recon:          'UCR---',   // 侦察（斜线）
  recon_mech:     'UCRV--',   // 装甲侦察
  wheeled_inf:    'UCIM--',   // 摩托化步兵（十字 + 车轮）
  /* 火力 */
  artillery:      'UCF---',   // 野战炮兵（实心圆点）
  mlrs:           'UCFR--',   // 多管火箭
  mortar:         'UCFM--',   // 迫击炮
  anti_tank:      'UCAA--',   // 反坦克（炮点 + 上三角）
  aaa:            'UCD---',   // 防空（穹顶）
  towed_w:        'UCF---',   // 轮式牵引炮（+ 机动 S）
  towed_t:        'UCF---',   // 履带牵引炮（+ 机动 S）
  /* 航空 */
  rotary:         'UCV---',   // 旋翼
  fixedwing:      'UCVF--',   // 固定翼
  attack_heli:    'UCVRA-',   // 攻击直升机
  uav_unit:       'UCVU--',   // 无人机
  /* 保障 */
  engineer:       'UCE---',   // 工兵
  signal:         'UUS---',   // 通讯
  medical:        'USM---',   // 医疗
  supply:         'USS---',   // 补给
  /* ★ R10.29：指挥 / 作战支援 / 宪兵 / 后勤 / 架桥 已从默认兵种库删除 */
};

/* 纯文字主图形的兵种（字母内容） */
const TEXT_MAIN = { combat_support: 'CS', mp: 'MP', hq: 'HQ' };

/* 兵种固定带的机动修饰符（SIDC 第 11-12 位）：11='M' 表示"机动"，12 见下表
     O 轮式(受限) P 轮式 Q 履带 R 轮履混编 S 牵引 T 铁路 W 驮马 Y 两栖 */
const TYPE_MOB = {
  towed_w: 'MS',
  towed_t: 'MS',
};

/* 我们的梯队 → SIDC 第 12 位 */
const ECHELON_CHAR = {
  army: 'K', corps: 'J', division: 'I', brigade: 'H', regiment: 'G',
  battalion: 'F', company: 'E', platoon: 'D', section: 'C', squad: 'B',
  team: 'A', individual: '-',
};

/* 一次算清：SIDC / 功能码 / 要不要我们自己的文字 */
function msPlan(type, echelon, custom) {
  const ech0 = ECHELON_CHAR[echelon] || '-';
  /* ★ R10.26：标准库目录（js/ms-catalog.js）里每个兵种自带完整 SIDC，
       只把梯队写进第 12 位 */
  const tdef = (typeof TYPES !== 'undefined' && TYPES[type]) ? TYPES[type] : null;
  const customSidc = (custom && custom.sidc) ? String(custom.sidc) : '';
  const fixedSidc = customSidc || (tdef && tdef.sidc ? String(tdef.sidc) : '');
  if (fixedSidc && fixedSidc.length === 15) {
    let s = fixedSidc;
    if (ech0 !== '-') s = s.slice(0, 11) + ech0 + s.slice(12);
    const txt0 = (custom && custom.text) ? String(custom.text)
               : (tdef && tdef.text) ? String(tdef.text) : '';
    const txt = txt0 ? txt0.slice(0, 6) : '';
    return { sidc: s, code: (txt ? '' : 'X'), echelon: ech0, text: txt };
  }

  let code = TYPE_SIDC[type] || '';
  let sec1 = '', mob = TYPE_MOB[type] || '';

  /* 第一扇区修饰（功能码第 5 位）：空降 / 山地 / 空中突击 */
  if (code && sec1) code = code.slice(0, 4) + sec1 + code.slice(5);

  const ech = ech0;
  /* ★ 第 11-12 位：标准里"梯队"和"机动"占同一个位置，不能同时出现
       —— 我们优先梯队（棋盘上要看班/排/连），没有梯队时才用机动 */
  let mod1 = '-', mod2 = '-';
  if (ech !== '-') mod2 = ech;
  else if (mob) { mod1 = mob.charAt(0) || '-'; mod2 = mob.charAt(1) || '-'; }

  const sidc = 'SFGP' + String(code || '').padEnd(6, '-') + mod1 + mod2 + '---';
  return {
    sidc,
    code,
    echelon: ech,
    text: code ? '' : (TEXT_MAIN[type] || ''),
  };
}
function msSIDC(type, echelon, custom) { return msPlan(type, echelon, custom).sidc; }

/* ---------- SVG 适配：换成我们的画布尺寸 ---------- */
function msFitSVG(svg, w, h) {
  /* milsymbol 输出形如 <svg width="158" height="108" viewBox="21 46 158 108">
     ⇒ 保留 viewBox（库的坐标不动），只改 width/height，等比缩放居中 */
  let out = svg.replace(/\swidth="[^"]*"/, ' width="' + w + '"')
               .replace(/\sheight="[^"]*"/, ' height="' + h + '"');
  if (out.indexOf('preserveAspectRatio') < 0) {
    out = out.replace(/<svg\b/, '<svg preserveAspectRatio="xMidYMid meet"');
  }
  return out;
}

/* ---------- 纯文字主图形（HQ / CS / MP 以及自定义文字） ---------- */
function msEscape(s) {
  if (typeof escapeXml === 'function') return escapeXml(s);
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function msInjectText(svg, text, ink) {
  const t = String(text || '').slice(0, 6);
  if (!t) return svg;
  const fs = t.length <= 2 ? 46 : t.length <= 3 ? 38 : t.length <= 4 ? 32 : 24;
  /* 库的坐标：框 = x 25..175 / y 50..150 ⇒ 中心 (100,100)
     用 dy 而不是 dominant-baseline：SVG 当图片渲染时兼容性更好 */
  const node = '<text x="100" y="100" dy="0.35em" text-anchor="middle" ' +
    "font-family=\"Arial, 'Helvetica Neue', sans-serif\" font-weight=\"900\" font-size=\"" + fs + '" ' +
    'letter-spacing="1" fill="' + ink + '">' + msEscape(t) + '</text>';
  return svg.replace(/<\/svg>\s*$/, node + '</svg>');
}

/* ---------- 对外唯一入口 ---------- */
const _msCache = new Map();

/* 主题/尺寸的默认值（所有入口共用） */
function _msDefaults(opts) {
  const o = opts || {};
  const theme = (typeof getThemeColors === 'function')
    ? getThemeColors() : { ink: '#0a3d91', paper: '#dce8f7' };
  return {
    ink: o.ink || theme.ink || '#0a3d91',
    paper: o.paper || theme.paper || '#dce8f7',
    w: o.w || (typeof SYM_W === 'number' ? SYM_W : 72),
    h: o.h || (typeof SYM_H === 'number' ? SYM_H : 70),
  };
}
function _msRender(sidc, text, ink, paper, w, h) {
  if ((typeof ms === 'undefined') || !ms || typeof ms.Symbol !== 'function') return null;
  try {
    const sym = new ms.Symbol(sidc, {
      size: 100,
      fillColor: paper,      // 兵牌底色（"纸"）
      frameColor: ink,       // 边框
      iconColor: ink,        // 图形
      infoFields: false,     // 不要库自带的文字字段（番号我们自己写）
      strokeWidth: 4,
    });
    let svg = msFitSVG(sym.asSVG(), w, h);
    if (text) svg = msInjectText(svg, text, ink);
    return svg;
  } catch (e) {
    return null;
  }
}

function symbolSvg(type, echelon, custom, opts) {
  const d = _msDefaults(opts);
  const key = [type, echelon, custom ? JSON.stringify(custom) : '', d.ink, d.paper, d.w, d.h].join('|');
  if (_msCache.has(key)) return _msCache.get(key);
  let svg = null;

  try {
    const plan = msPlan(type, echelon, custom);
    svg = _msRender(plan.sidc, plan.text, d.ink, d.paper, d.w, d.h);
  } catch (e) { svg = null; }
  _msCache.set(key, svg);
  return svg;
}

/* 直接按 SIDC 出图（标准库目录 / 预览页 / 自定义兵牌选择器用） */
function symbolBySidc(sidc, opts) {
  const o = opts || {};
  const d = _msDefaults(o);
  const key = ['SIDC', sidc, o.text || '', d.ink, d.paper, d.w, d.h].join('|');
  if (_msCache.has(key)) return _msCache.get(key);
  const svg = _msRender(String(sidc || ''), o.text || '', d.ink, d.paper, d.w, d.h);
  _msCache.set(key, svg);
  return svg;
}
function msClearSymbolCache() { _msCache.clear(); }

