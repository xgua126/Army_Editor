# -*- coding: utf-8 -*-
"""hex_core_test.py —— R10「回合制六角格兵棋」规则层回归

设计前提（玩家定案）：
  · 基础棋子 = **班**；六角格 = **100m** 正六边形（pointy-top + odd-r）
  · FLV（火力等级）1~12，由**装备库**动态算出 ⇒ 射程表是"活"的
  · 三张 CRT（反人员 / 反装甲 / 炮击）是**固定常量** ⇒ 装备库怎么改都撼不动它们
  · 结果代号：软目标 S/K/2K/3K = 压制 / 毙 1・2・3 人；硬目标 S/Km/Kf/K

守住五件事：
  ① 常量与表**冻结**（改数值必须同时改这个测试 —— 防止手滑改坏平衡）
  ② 三张表**骨架统一**且**单调**（骰点↑、FLV↑ 都绝不会更差）
  ③ hex-core.js 是**纯函数**（不碰 DOM / localStorage，可离线跑）
  ④ 命名不与老文件冲突（data.js 已有 ECHELONS 对象）
  ⑤ 页面接线完整（wargame.html 的脚本顺序 + 规则不许在 UI 层重写）

跑法：python -X utf8 tools/hex_core_test.py
"""
import sys, io, os, re, json, subprocess
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
JS = os.path.join(ROOT, 'js')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


CORE = read(os.path.join(JS, 'hex-core.js'))
WAR = read(os.path.join(JS, 'hex-wargame.js'))
EQ = read(os.path.join(JS, 'equipment.js'))
HTML = read(os.path.join(ROOT, 'wargame.html'))
CSS = read(os.path.join(ROOT, 'css', 'wargame.css'))
IDX = read(os.path.join(ROOT, 'index.html'))
BH = read(os.path.join(ROOT, 'battle.html'))

fails = 0


def ck(name, got, exp=True):
    global fails
    ok = (got == exp)
    if not ok:
        fails += 1
    print(('  ok   ' if ok else '  FAIL ') + '%s：%s（期望 %s）' % (name, got, exp))


def has(src, s):
    return s in src


print('== 1. 常量冻结（改数值就得改这个测试） ==')
ck('HEX_EDGE = 100m（一格 = 一个班的有效射界）',
   re.search(r'const HEX_EDGE = (\d+);', CORE).group(1), '100')
ck('FLV_MAX = 12', re.search(r'const FLV_MAX = (\d+);', CORE).group(1), '12')
m = re.search(r'const RAW12 = \{ soft: (\d+), hard: (\d+), art: (\d+) \};', CORE)
ck('RAW12 = {soft:520, hard:264, art:270}（真实毫米穿深尺度：66mm ⇒ FLV 6）',
   m.groups() if m else None, ('520', '264', '270'))
ck('DIE_FACTOR 11 档（2D6 = 2..12），7 点 = ×1.00',
   re.search(r'const DIE_FACTOR = \[([^\]]+)\];', CORE).group(1).replace(' ', ''),
   '0.35,0.50,0.60,0.70,0.85,1.00,1.15,1.30,1.45,1.60,1.80')
ck('每回合移动点数（1 回合 = 60 秒）：徒步 2 / 轮式 8 / 履带 6',
   re.search(r'const MP_MAX = \{ ([^}]+) \};', CORE).group(1).replace(' ', ''),
   'foot:2,wheeled:8,tracked:6,halftrack:6,air:10')
ck('回合长度常量 TURN_SECONDS = 60（玩家：1 回合 = 1 分钟）',
   re.search(r'const TURN_SECONDS = (\d+);', CORE).group(1), '60')

print()
print('== 2. 三张固定 CRT：骨架统一 + 阈值冻结 ==')
ck('反人员：— <3 / S 3 / K 5 / 2K 8 / 3K 11',
   has(CORE, "soft: [[3, '—'], [5, 'S'], [8, 'K'], [11, '2K'], [Infinity, '3K']]"))
ck('反装甲：— <2 / S 2 / Km 3.5 / Kf 5.5 / K 8',
   has(CORE, "at:   [[2, '—'], [3.5, 'S'], [5.5, 'Km'], [8, 'Kf'], [Infinity, 'K']]"))
ck('炮击：— <3 / S 3 / K 5 / 2K 7 / 3K 10',
   has(CORE, "art:  [[3, '—'], [5, 'S'], [7, 'K'], [10, '2K'], [Infinity, '3K']]"))
ck('三表共用一条骨架 eff = FLV × DIE_FACTOR（不许各写一套公式）',
   has(CORE, 'return flv * DIE_FACTOR[r - 2];'))
ck('K / 2K / 3K = 毙 1 / 2 / 3 人（玩家定的计数单位就是"人"）',
   (has(CORE, "if (code === 'K') return 1;") and
    has(CORE, "if (code === '2K') return 2;") and
    has(CORE, "if (code === '3K') return 3;")))
ck('FLV 由 √ 压缩得到（1 个班永远打不到 12 级）',
   has(CORE, 'const v = FLV_MAX * Math.sqrt(raw / ref);'))

print()
print('== 2b. 三张表整体向下平移一格：FLV 1 也要有战果（R10.11） ==')
ck('平移常量只有一个（CRT_ROW_SHIFT = 1）', has(CORE, 'const CRT_ROW_SHIFT = 1;'))
ck('偏移只写在 crtRowFlv() 一处（FLV + 1）',
   has(CORE, 'return Math.max(1, Math.round(flv || 0)) + CRT_ROW_SHIFT;'))
ck('查表用的是平移后的 eff（crtLookup → crtEffRow）',
   has(CORE, 'const eff = crtEffRow(flv, roll);'))
ck('结算/展示的 eff 与查表同口径（resolveFire.eff → crtEffRow）',
   has(CORE, 'eff: crtEffRow(flv, roll),'))
ck('骨架没变（仍是 FLV × DIE_FACTOR，不是另写一套）',
   has(CORE, 'return crtEff(crtRowFlv(flv), roll);'))

print()
print('== 2c. 炮兵 / 间瞄（R10.12：山炮+卡车能打，射程表不再恒 1 格） ==')
ck('车辆棋子也会遍历 supports（拖曳炮/支援武器）',
   has(CORE, 'for (const s of (c.supports || [])) fn(s, s.count || 1);'))
ck('车辆分支把炮挂到 supports 上（一件不丢）',
   (has(CORE, 'const towed = items.filter(') and has(CORE, 'supports: sups,')))
ck('没有武器数值的车辆不再发"空气枪"',
   (has(CORE, 'function hasWeaponStats(st)') and
    has(CORE, 'weapons: hasWeaponStats(st) ? [_weaponOf(st, v.eq.category, v.eq.name)] : [],')))
ck('间瞄射程 / 最大射程 / 选表 三个纯函数都在 core 里',
   (has(CORE, 'function counterArtRangeHex(c)') and
    has(CORE, 'function counterMaxRangeHex(c)') and
    has(CORE, 'function fireKindFor(atk, def, dist, los)')))
ck('预览与结算共用 fireKindFor（结算不再写死 soft）',
   (has(CORE, 'const kind = fireKindFor(atk, def, dist, los);') and
    has(CORE, 'const kind = opts.kind || fireKindFor(atk, def, dist, los);')))
ck('间瞄不看视线（视线只在直射时拦）',
   has(CORE, "else if (kind !== 'art' && !los) why = '视线被遮挡（没有火炮可间瞄）';"))
ck('UI 多一行炮击 + 多一列炮击', (has(WAR, "rows.push(['炮击', 'art']);") and
   has(WAR, "'<th>炮击 FLV</th>'")))

print()
print('== 3. hex-core.js 必须是纯函数（能离线跑） ==')
ck('不碰 document / window', not (has(CORE, 'document.') or has(CORE, 'window.')))
ck('不碰 localStorage（装备库由调用方传进来）', not has(CORE, 'localStorage'))
ck('不写 HTML', not has(CORE, 'innerHTML'))

print()
print('== 4. UI 层不许重写规则 ==')
ck('hex-wargame.js 不出现 CRT_RULES（表只在 core 里）', not has(WAR, 'CRT_RULES'))
ck('hex-wargame.js 不自己算 FLV（只调 counterFlv / flvAt）',
   ((has(WAR, 'counterFlv(') or has(WAR, 'flvAt(')) and (not has(WAR, 'Math.sqrt('))))
ck('开火只走 resolveFire / applyFireResult',
   (has(WAR, 'resolveFire(') and has(WAR, 'applyFireResult(')))
ck('移动范围只走 hexReachable', has(WAR, 'hexReachable('))

print()
print('== 4b. 兵牌必须复用兵牌库（玩家：不要重新绘制） ==')
ck('hex-wargame.js 走 buildSymbol（兵牌库唯一入口）', has(WAR, 'buildSymbol('))
ck('hex-wargame.js 不再自绘兵种符号（ctx.ellipse 已删）', not has(WAR, 'ctx.ellipse('))
ck('wargame.html 加载 model.js + render.js（兵牌库 + escapeXml）',
   (has(HTML, 'js/model.js') and has(HTML, 'js/render.js')))
_ord = [HTML.find('js/data.js'), HTML.find('js/model.js'), HTML.find('js/render.js'),
        HTML.find('js/hex-wargame.js')]
ck('脚本顺序 data → model → render → hex-wargame',
   all(x >= 0 for x in _ord) and _ord == sorted(_ord))
ck('牌下有番号（counterDesignation + strokeText 描边保证任何地形都读得清）',
   (has(WAR, 'counterDesignation(c)') and has(WAR, 'strokeText(')))
ck('番号是层级链（最多 4 级、斜杠分隔：旅/团 → 连 → 排 → 班）',
   (has(WAR, '(c.path || []).slice(-4)') and has(WAR, "parts.join('/')")))
ck('牌面不再带人数 / 装备数（玩家要求去掉）', not has(WAR, "txt += '·'"))
ck('兵牌边长 = 0.92 × 格边长（玩家：再缩小 0.2 左右）', has(WAR, 'r * 0.92'))
ck('棋子带 type/echelon（buildSymbol 需要）',
   has(CORE, 'type: node.type, echelon: node.echelon'))
ck('兵牌不铺阵营底色（玩家：边框太厚/超出格子，底色直接移除掉）',
   not has(WAR, 'col.fill'))
ck('敌我靠墨色区分（APP-6：红/蓝墨），不是靠底色块',
   has(WAR, 'col.ink'))

print()
print('== 4c. 动画：移动路径 + 开火曳光 ==')
ck('移动前先回溯路径（buildPath 用 hexReachable 的 came）',
   (has(WAR, 'function buildPath(') and has(WAR, 'W.reachCame = r.came')))
ck('沿路径逐格移动（MOVE_SEG_MS + animPos 插值）',
   (has(WAR, 'MOVE_SEG_MS') and has(WAR, 'a.c.animPos = {')))
ck('走完留路径残影（kind: trail）', has(WAR, "kind: 'trail'"))
ck('开火有曳光（kind: shot）', has(WAR, "kind: 'shot'"))
ck('rAF 驱动、播完自动停',
   (has(WAR, 'requestAnimationFrame(animFrame)') and
    has(WAR, 'if (busy) _rafId = requestAnimationFrame(animFrame);')))
ck('动画期间不接受点击 / 结束回合（防命令打架）', has(WAR, '|| W.anim) return;'))
ck('没有 rAF 或关掉 motion 时同步完成（离线可测）',
   (has(WAR, 'function canAnimate()') and has(WAR, "W.motion !== false")))

print()
print('== 4d. 表格窗（完整射程 + CRT）与掷骰过程 ==')
ck('射程不再封顶 6 格（坦克能列到 30 格）',
   (not has(CORE, 'Math.min(6, Math.floor(best / HEX_EDGE))')) and has(CORE, 'function flvAt('))
ck('火力表用 flvAt（打不到显示 —，不是误导性的 1）', has(WAR, 'flvAt(c, d, kind)'))
ck('完整火力表列到实际射程（1..rng 全列 + 米数 + 超出本图）',
   (has(WAR, 'for (let d = 1; d <= rng; d++)') and has(WAR, '超出本图')))
ck('三张 CRT 全显示',
   (has(WAR, "crtTableHtml('soft')") and has(WAR, "crtTableHtml('at')")
    and has(WAR, "crtTableHtml('art')")))
ck('表格窗可拖动（标题栏 pointermove）',
   (has(WAR, 'function bindSheetDrag()') and has(WAR, 'head.addEventListener(\'pointermove\'')))
ck('按钮开/关表格窗', (has(HTML, 'id="wg-sheet-btn"') and has(WAR, 'function toggleSheet(')))
ck('掷骰过程：两颗骰子 + 2D6 拆解',
   (has(WAR, 'function showDice(') and has(WAR, 'function splitRoll(') and has(WAR, 'DIE_DOTS')))
ck('先定骰后演（doFire: roll2d6 + showDice → commitFire 结算）',
   (has(WAR, 'const roll = roll2d6();') and has(WAR, 'function commitFire(')
    and has(WAR, 'showDice(roll, () => {')))
ck('页面/样式齐备（表格窗 + 骰子）',
   (has(HTML, 'id="wg-sheet"') and has(HTML, 'id="wg-dice"')
    and has(CSS, '.sheet {') and has(CSS, '.die {')))

print()
print('== 4e. 装备数值必须真的从装备库带进来（R10.6） ==')
ck('装备解析有三级兜底（eqId → 名字 → 内置种子）',
   (has(CORE, 'function resolveEquipment(') and has(CORE, 'DEFAULT_EQUIPMENT_SEED.find')
    and has(CORE, 'libNameIndex')))
ck('不再只认 lib[e.eqId]（真凶已修）', not has(CORE, 'lib[e.eqId];'))
ck('只填了 countMax 也按配发算', has(CORE, '(e.count || 0) || (e.countMax || 0)'))
ck('整班无轻武器时配"制式步枪"兜底', has(CORE, 'fallback:rifle'))
ck('对不上的装备会记下来、开局提示（不静默按 0）',
   (has(CORE, 'HEX_MISSING_EQUIP') and has(WAR, 'takeMissingEquip()')))

print()
print('== 4f. 真实装甲/穿深 + 距离曲线（R10.7） ==')
ck('kind 归一：at ≡ hard（修复"射程表 6 / 开火 1"）',
   has(CORE, "if (kind === 'hard' || kind === 'at') return 'hard';"))
ck('穿深按真实距离曲线查表插值（PEN_CURVE）',
   (has(CORE, 'const PEN_CURVE = [') and has(CORE, 'function penCurveAt(')))
ck('HEAT（火箭筒/导弹）不随距离衰减',
   has(CORE, "const HEAT_CATS = { at_weapon: 1 };"))
ck('超出射程穿深归 0', has(CORE, 'if (distM > rng) return 0;'))
ck('反装甲按穿深/装甲比 5 档修正',
   has(CORE, "const tier = (r >= 2) ? 1 : (r >= 1.2) ? 0 : (r >= 0.9) ? -1 : (r >= 0.6) ? -2 : -3;"))
ck('种子换成真实毫米（M4A3 51/66、虎式 102/120）',
   (('armor:51,' in EQ) and ('penetration:66,' in EQ)
    and ('armor:102,' in EQ) and ('penetration:120,' in EQ)))
ck('装备库迁移升到 v8（老库也能升级到真实数值）',
   (('const EQUIP_SEED_VERSION = 8;' in EQ) and ('version: 8,' in EQ)))

print()
print('== 4g. 行动二选一 / 装备清单 / 按目标类型选武器（R10.8） ==')
ck('移动/攻击二选一（acted 字段 + 新回合重置）',
   (has(CORE, 'c.acted = null;') and has(WAR, "c.acted = 'move';")
    and has(WAR, "atk.acted = 'fire';")))
ck('已移动不能攻击（fireSituation 拦）',
   has(CORE, "else if (atk.acted === 'move') why"))
ck('一人可带多件武器（members[].weapons）',
   (has(CORE, 'weapons: weapon ? [weapon] : []') and has(CORE, 'm.weapons.push(s)')))
ck('棋子保存编制里的全部装备（items）', has(CORE, 'items: items.map('))
ck('面板有完整装备清单（equipListHtml + equip-table）',
   (has(WAR, 'function equipListHtml(') and has(WAR, 'equip-table')))
ck('开火面板显示"使用武器"',
   has(WAR, 'counterUsedWeapons(atk, sit.dist, sit.kind)'))
ck('按目标类型筛武器（weaponRole + counterRaw(c,d,kind)）',
   (has(CORE, 'function weaponRole(') and has(CORE, 'function counterRaw(c, distHex, kind)')))

print()
print('== 4h. 武器口径唯一（R10.9：射程 / 穿深 / 火力必须看同一份武器表） ==')
ck('新增 eachWeapon 作为唯一遍历口径', has(CORE, 'function eachWeapon(c, fn)'))
ck('射程走 eachWeapon（不再只看主武器）',
   (has(CORE, 'eachWeapon(c, (w) => {') and (not has(CORE, 'scan(m.weapon)'))))
ck('穿深走 eachWeapon', has(CORE, 'best = Math.max(best, penAt(w, d));'))
ck('火力按目标类型筛且走 eachWeapon', has(CORE, 'eachWeapon(c, (w, n) => {'))
ck('"使用武器"清单也走 eachWeapon（车辆同样）',
   has(CORE, 'eachWeapon(c, (w, n) => take(w, n));'))
ck('火力（counterRaw）车辆分支也走 eachWeapon（拖曳炮才算得上火力）',
   (has(CORE, 'if (wantArt) addArt(w, n);') and has(CORE, 'if (wantSoft) addSoft(w, n, true);')))

print()
print('== 4i. 枪比人多时一件不丢（R10.10：12 支步枪 + 1 挺重机枪 ⇒ 射程 10 格） ==')
ck('多出来的轻武器塞给已有成员（每人上限 3 件、同一件不重复发）',
   (has(CORE, 'const extraSA = [];')
    and has(CORE, 'const m = holderFor(w);')
    and has(CORE, 'if (ws.length >= 3) return false;')
    and has(CORE, 'else extraSA.push(Object.assign({}, w, { count: 1 }));')))
ck('塞不下的并进 supports（不许静默丢弃）',
   has(CORE, 'for (const w of extraSA) leftover.push(w);'))
ck('不再用下标截断发枪（旧写法 `sa[i % sa.length]` 会丢掉第 13 件）',
   not has(CORE, 'members.push(_mkMember(it && it.eq ? _weaponOf('))

print()
print('== 4j. 地图编辑器（★ R10.36：两个编辑器合并成一个，新建时选「是否使用六角格」） ==')
ME_HTML = read(os.path.join(ROOT, 'map-editor.html'))
ME_JS = read(os.path.join(JS, 'map-editor.js'))
ME_CSS = read(os.path.join(ROOT, 'css', 'map-editor.css'))
GRIDM = read(os.path.join(JS, 'grid-maps.js'))
HM_HTML = read(os.path.join(ROOT, 'hex-map-editor.html'))
ck('六角格编辑器页已变成**跳转页**（老书签/老链接自动进 map-editor.html）',
   (has(HM_HTML, "location.replace('map-editor.html')") and
    has(HM_HTML, 'map-editor.html') and not has(HM_HTML, 'js/hex-map-editor.js')))
ck('没有任何页面再加载旧的 hex-map-editor.js / .css（已经并进地图编辑器）',
   (('js/hex-map-editor.js' not in ME_HTML) and
    ('hex-map-editor.js' not in HTML) and ('hex-map-editor.js' not in IDX) and
    ('hex-map-editor.css' not in ME_HTML)))
ck('地图编辑器脚本顺序 grid-maps → hex-core → map-editor（几何/烘焙复用兵棋那一份）',
   (lambda o: all(a >= 0 for a in o) and o == sorted(o))([
       ME_HTML.find('js/grid-maps.js'), ME_HTML.find('js/hex-core.js'),
       ME_HTML.find('js/map-editor.js')]))
ck('新建地图**弹窗里问「是否使用六角格」**（默认使用六角格）',
   (has(ME_HTML, 'name="new-hex" value="1" checked') and
    has(ME_HTML, 'name="new-hex" value="0"') and
    has(ME_HTML, '使用六角格') and has(ME_JS, 'function newHexChoice()') and
    has(ME_JS, 'gm.hex = newHexChoice();')))
ck('六角格模式下画布叠**六角网格辅助线**（视图里可开关）',
   (has(ME_HTML, 'id="chk-hex"') and has(ME_CSS, '.hex-opt') and
    has(ME_JS, 'function drawHexGrid(c)') and has(ME_JS, 'function hexPathOn(') and
    has(ME_JS, 'drawHexGrid(ctx);') and has(ME_JS, 'let showHexGrid = true;')))
ck('★ R10.37：**画法只有一套**（最初那套 5m 自由绘制）—— 六角格不改画笔粒度',
   (not has(ME_JS, 'function paintHex(col, row)') and
    not has(ME_JS, 'function hexesInShape(tool, a, b)') and
    not has(ME_JS, 'paintHexAt(') and
    has(ME_JS, '/* ★ R10.37：**画法只有最初那套**（5m 自由绘制）。') and
    has(ME_JS, 'const rad = Math.ceil(brushSize / 2);') and
    has(ME_JS, 'gLine(currentMap, start.x, start.y, end.x, end.y, brushSize * cs, t);')))
ck('★ R10.37：每格地形 = **格内面积占比最大者**（沿用 hex-core 的 bakeHexMap）',
   (has(CORE, "let terr = 'empty', best = -1, bestRank = 99;") and
    has(CORE, 'const A = area[i] > 0 ? area[i] : cellA;') and
    has(CORE, 'if (bShare >= HEX_BUILD_SHARE && terr !== \'house\') terr = \'house\';')))
ck('建筑**放进格子里**（吸附格心 + 长宽收窄到一格内）',
   (has(ME_JS, 'const c = hexCenter(p.col, p.row);') and
    has(ME_JS, "bw = Math.max(10, Math.min(def.w, Math.round(HEX_W * 0.72)));") and
    has(ME_JS, "bh = Math.max(10, Math.min(def.h, Math.round(HEX_EDGE * 0.86)));") and
    has(ME_JS, 'b.neutral = true;')))
ck('据点 / 出生区顶点也吸附到格心（画出整格对齐的部署区）',
   (has(ME_JS, 'if (hexUsable()) o.rHex = Math.max(1, Math.round(r / HEX_EDGE));') and
    has(ME_JS, '/* ★ R10.36：六角格模式 —— 顶点吸附到格心')))
ck('保存时**自动烘焙 hexData**（地形/公路/建筑/据点/出生区）',
   (has(ME_JS, 'function bakeHexNow()') and
    has(ME_JS, 'data = hexBakeToData(currentMap);') and
    has(ME_JS, 'currentMap.hexData = data;') and
    has(CORE, 'function hexBakeToData(gm)')))
ck('hexData 里有 deploy（出生区 → 部署区，作者画哪块就部署哪块）',
   has(CORE, 'if (pointInSpawn(s, h.x, h.y)) deploy[i] = side;'))
ck('地图存储带上 hex / hexData（存盘、导出、导入都不丢）',
   (has(GRIDM, 'hex: gm.hex ? 1 : 0,') and has(GRIDM, 'hexData: gm.hexData || null,') and
    has(GRIDM, 'hex: !!obj.hex,') and has(GRIDM, 'hexData: obj.hexData || null,')))
ck('hex-core 认识 hexData（不走光栅烘焙）+ 尺寸换算',
   (has(CORE, 'if (gm.hexData) return bakeHexData(gm);') and
    has(CORE, 'function bakeHexData(gm)') and has(CORE, 'function hexMapSize(cols, rows)')))
ck('兵棋启动时加载老六角地图（HEX_MAPS_KEY，兼容以前画的图）',
   (has(WAR, "const HEX_MAPS_KEY = 'mil_hex_maps_v1';") and
    has(WAR, 'function loadUserHexMaps()') and has(WAR, 'loadUserHexMaps();')))
ck('部署优先用地图画的部署区（作者涂的格子 > 20%/80% 切分）',
   (has(CORE, 'if (ph && ph.deploy === side && isFinite(hexMoveCost(ph, \'foot\'))) painted.add(hexKey(ph));') and
    has(CORE, 'if (painted.size) return painted;')))
ck('入口都指向合并后的地图编辑器',
   (has(HTML, 'map-editor.html') and has(IDX, 'map-editor.html') and
    not has(HTML, 'hex-map-editor.html') and not has(IDX, 'hex-map-editor.html')))
ck('「移动 / 开火」模式按钮已删（现在纯点击）',
   (not has(HTML, 'data-act=')) and (not has(WAR, 'function setMode(')) and
   (not has(WAR, 'W.mode')))

print()
print('== 4k. 装甲免压制 / 炮击散布 / 撤回上一步（R10.14~R10.17） ==')
ck('装甲目标不吃压制（suppressible + resolveFire 把 S 变 —）',
   (has(CORE, 'function suppressible(c)') and
    has(CORE, "if (code === 'S' && !suppressible(def)) {")))
ck('applyFireResult 再拦一道（车辆绝不写 suppressed）',
   has(CORE, 'if (!suppressible(def)) return out;'))
ck('炮击散布：概率只写在一个常量 + 只挑地图内的邻居',
   (has(CORE, 'const ART_SCATTER_CHANCE = 0.35;') and
    has(CORE, 'function artScatterHex(hx, targetHex, rnd)') and
    has(CORE, 'const cands = hexNeighbors(targetHex.col, targetHex.row)')))
ck('开火按**落点**结算（散到空格 = 白打）',
   (has(WAR, 'const sc = artScatterHex(W.hx, def.hex);') and
    has(WAR, 'if (!victim) pushLog(') and has(WAR, '落点没有目标')))
ck('预览里写出散布概率（只读 core 常量）',
   has(WAR, "html += rowHtml('散布', Math.round(ART_SCATTER_CHANCE * 100) +"))
ck('撤回：快照只存会变的字段（含 mpMax / 成员存活）+ 栈上限',
   (has(WAR, 'const WG_UNDO_MAX = 30;') and has(WAR, 'function snapshotState()') and
    has(WAR, 'function restoreState(s)') and has(WAR, 'function undoLast()') and
    has(WAR, 'mpMax: c.mpMax,') and has(WAR, 'c.mpMax = cs.mpMax;') and
    has(WAR, 'alive: (c.members || []).map(m => !!m.alive),')))
ck('移动 / 开火 / 换回合 都存快照（3 处 pushUndo）',
   len(re.findall(r'pushUndo\(\);', WAR)) >= 3)
ck('兵棋撤回：按钮 + Ctrl+Z',
   (has(HTML, 'id="wg-undo"') and has(WAR, "e.key.toLowerCase() === 'z'") and
    has(CSS, '#wg-bar button:disabled')))
ck('地图编辑器撤回：Ctrl+Z + 一步一快照',
   (has(ME_JS, 'function pushHistory()') and has(ME_JS, 'function undo()') and
    has(ME_JS, "e.key.toLowerCase() === 'z'") and has(ME_JS, 'const MAX_HISTORY = 20;')))
ck('地图编辑器公路是**矢量折线**（画节点连线，不是每格一条横带）',
   (has(ME_JS, 'function drawRoadOverlay(c)') and has(ME_JS, 'function roadClick(wx, wy)') and
    has(ME_HTML, 'data-tool="road"')))

print()
print('== 4l. 临机射击 / 逐人明细 / 尸体 / 音效（R10.18~R10.21） ==')
SFX = read(os.path.join(JS, 'sfx.js'))
ck('临机射击是**纯函数**判定（可离线测）',
   (has(CORE, 'function opportunityShotFor(hx, shooter, hex, targetSide, targetKind)') and
    has(CORE, 'function opportunityTriggers(hx, counters, mover, path, side)')))
ck('每单位每次移动只触发一次（不是每格一次、也没有每回合次数上限）',
   (has(CORE, 'used.add(s.id);') and has(CORE, 'if (!s || s === mover || s.dead || s.side === side || used.has(s.id)) continue;')
    and (not has(CORE, 'OPP_FIRE_MAX_PER_SIDE'))))
ck('只有直射武器能临机（炮兵间瞄=0 ⇒ 自动排除）',
   has(CORE, "const rng = counterRangeHex(shooter);          // 只有直射武器（炮兵=0 ⇒ 自动排除）"))
ck('仓促射击 FLV 降档走 resolveFire 唯一口径（opts.flvPenalty）',
   (has(CORE, 'const OPP_FIRE_FLV_PENALTY = 1;') and
    has(CORE, 'const flvPen = Math.max(0, opts.flvPenalty || 0);')))
ck('临机射击接进移动（动画里按 step 触发 + 停 320ms）',
   (has(WAR, 'const trig = (W.oppOn === false) ? [] : opportunityTriggers(') and
    has(WAR, 'const OPP_HOLD_MS = 320;') and has(WAR, 'opFire(tr.shooter, a.c, a.path[tr.step]);')))
ck('被打死在半路就地停下（不会被拖到终点）', has(WAR, '在移动途中被消灭'))
ck('逐人起名：按武器给 步枪兵1 / 机枪兵1 / 反坦克兵1…',
   (has(CORE, 'function roleNameOf(weapon)') and has(CORE, 'function nameMembers(members)') and
    has(CORE, "if (/机枪/.test(n)) return '机枪兵';") and has(CORE, 'nameMembers(members);')))
ck('面板逐人列表（阵亡黑掉）', (has(WAR, 'function rosterHtml(c)') and
   has(WAR, '<div class="roster">') and has(WAR, "html += rosterHtml(c);")))
ck('尸体黑点（世界里存偏移、画在兵牌下面、撤销能回滚）',
   (has(WAR, 'function addCorpses(c, k)') and has(WAR, 'function drawCorpses(ctx, r)') and
    has(WAR, 'drawCorpses(ctx, r);') and has(WAR, 'corpses: (c.corpses || []).length,')))
ck('音效：WebAudio 现场合成，没有音频文件',
   (has(SFX, 'window.AudioContext || window.webkitAudioContext') and
    has(SFX, "fire(kind)") and has(SFX, "move(mob)") and has(SFX, "undo()") and
    has(SFX, "localStorage.setItem(KEY, muted ? '1' : '0');")))
ck('音效接进 移动 / 开火 / 临机 / 撤回（缺文件也静默降级）',
   (has(WAR, 'function sfxFire(kind)') and has(WAR, 'sfxFire(res.kind);') and
    has(WAR, 'sfxFire(chk.kind);') and has(WAR, 'sfxMove(c.mpType);') and has(WAR, 'sfxUndo();')))
ck('wargame.html 加载 sfx.js + 两个开关按钮',
   (has(HTML, 'js/sfx.js') and has(HTML, 'id="wg-sfx"') and has(HTML, 'id="wg-opp"')))
ck('1 回合 = 60 秒后总回合数上调到 30（徒步 2 格才走得到对面）',
   re.search(r'const WG_MAX_TURN = (\d+);', WAR).group(1), '30')

print()
print('== 4m. 一人不重复发武器 / 弹药系统（R10.22） ==')
ck('同一件武器不会重复发给同一个人（canTake + holderFor）',
   (has(CORE, 'function canTake(m, w) {') and
    has(CORE, 'function holderFor(w) {') and
    has(CORE, 'return !ws.some(x => (x.name || \'?\') === key);') and
    (not has(CORE, 'members.find(mm => mm.weapons && mm.weapons.length < 3)'))))
ck('支援武器也走同一个"谁能接"的判定',
   has(CORE, 'const m = holderFor(s);                          // ★ R10.22'))
ck('弹药只算有限弹药武器（步枪/机枪/手枪无限）',
   (has(CORE, 'const NO_AMMO_CATS = { small_arms: 1, misc: 1 };') and
    has(CORE, 'function weaponUsesAmmo(w) {')))
ck('弹药池按棋子里汇总（名字 → 发数），两个 makeCounters 分支都初始化',
   (has(CORE, 'function initCounterAmmo(c) {') and
    has(CORE, "pool[w.name] = (pool[w.name] || 0) + per * Math.max(1, n || 1);") and
    WAR.count('initCounterAmmo(counter);') == 0 and
    CORE.count('initCounterAmmo(counter);') == 2))
ck('弹尽的武器不再出力（soft / hard / art / 穿深 / 使用武器 全部过滤）',
   (CORE.count('if (!weaponHasAmmo(c, w)) return;') >= 4 and
    has(CORE, '// ★ R10.22：弹尽的武器不出力')))
ck('消耗与判定：consumeAmmo / ammoBlocked / dryAmmoText',
   (has(CORE, 'function consumeAmmo(c, distHex, kind)') and
    has(CORE, 'function ammoBlocked(c, distHex, kind)') and
    has(CORE, 'function dryAmmoText(c)') and
    has(CORE, "else if (ammoBlocked(atk, dist, kind)) why = '弹药耗尽（' + dryAmmoText(atk) + '）';")))
ck('开火 / 临机射击都扣弹药（含战报）',
   (has(WAR, 'const usedAmmo = consumeAmmo(atk, res.dist, res.kind);') and
    has(WAR, 'const usedAmmo = consumeAmmo(shooter, res.dist, res.kind);') and
    has(WAR, "🧨 消耗 ")))
ck('面板有弹药条 + 撤销能回滚弹药',
   (has(WAR, 'function ammoHtml(c)') and has(WAR, '<div class="ammo-list">') and
    has(WAR, 'ammo: c.ammo ? Object.assign({}, c.ammo) : null,') and
    has(WAR, 'if (cs.ammo) c.ammo = Object.assign({}, cs.ammo);')))
ck('弹药条样式（低弹黄 / 尽弹红）',
   (has(CSS, '.ammo-row.low .ammo-bar i') and has(CSS, '.ammo-row.out .ammo-name')))

print()
print('== 4n. ★ R10.23：格内面积占比 / 据点按格 / 部署模式 / 胜利目标 ==')
ck('地形按**面积**累加（遍历 5m 栅格 → worldToHex 归格）',
   (has(CORE, 'const share = new Float64Array(nHex * palN);') and
    has(CORE, 'const p = worldToHex((gx + 0.5) * cs, wy);') and
    has(CORE, 'share[hi * palN + ((idx >= 0 && idx < palN) ? idx : 0)] += cellA;') and
    has(CORE, 'area[hi] += cellA;')))
ck('不再用"中心 + 6 方向 7 点采样"（旧算法已删干净）',
   (not has(CORE, 'HEX_EDGE * 0.62')) and (not has(CORE, 'roadHit')))
ck('主地形 = 面积最大的（路不抢主地形；平局按 HEX_TERR_ORDER）',
   (has(CORE, 'if (k === roadIdx) continue;') and
    has(CORE, 'const rank = hexTerrRank(id);') and
    has(CORE, "const HEX_TERR_ORDER = ['house', 'forest', 'hill', 'swamp', 'river', 'trench', 'wall', 'road', 'empty'];") and
    has(CORE, 'if (v > best + 0.001 || (Math.abs(v - best) <= 0.001 && rank < bestRank)) {')))
ck('公路是叠加属性：路面占比 ≥ 1.5%（HEX_ROAD_SHARE）',
   (has(CORE, 'const HEX_ROAD_SHARE = 0.015;') and
    has(CORE, 'const roadShare = roadIdx >= 0 ? (share[i * palN + roadIdx] / A) : 0;') and
    has(CORE, 'const road = roadShare >= HEX_ROAD_SHARE;')))
ck('建筑按面积占比判城区（≥30%），不再"格心碰一下就变城区"',
   (has(CORE, 'const HEX_BUILD_SHARE = 0.30;') and
    has(CORE, "if (bShare >= HEX_BUILD_SHARE && terr !== 'house') terr = 'house';")))
ck('据点半径改成**格**（老地图 r 米数自动折算 rHex 并写回）',
   (has(CORE, 'const objR = objs.map(o => (o.rHex != null)') and
    has(CORE, 'if (d <= objR[k] && d < objD) { objD = d; obj = k; }') and
    has(CORE, 'objs[i].rHex = objR[i];') and
    (not has(CORE, 'Math.hypot(o.x - c.x, o.y - c.y) <= (o.r || 300)'))))
ck('烘焙缓存带版本号 + 地图版本（改算法/改图自动重烘）',
   (has(CORE, 'const HEX_BAKE_VER = 3;') and
    has(CORE, 'gm._hex.ver === HEX_BAKE_VER && gm._hex.rev === rev')))
ck('部署模式比例只写一处（遭遇各 20% / 攻防 守80 攻20）',
   has(CORE, 'const DEPLOY_SHARE = { meeting: 0.20, attack: { defender: 0.80, attacker: 0.20 } };'))
ck('部署区按"双方出生点连线"排序后切比例（任何地图都能算）',
   (has(CORE, 'const d = Math.hypot(h.x - ab.x, h.y - ab.y) - Math.hypot(h.x - ar.x, h.y - ar.y);') and
    has(CORE, 'cells.sort((p, q) => (p.d - q.d) || (p.h.row - q.h.row) || (p.h.col - q.h.col));') and
    has(CORE, 'const from = fromBlueEnd ? 0 : Math.max(0, n - cnt);')))
ck('出生锚点优先用地图 spawns，没画就退回西/东边',
   (has(CORE, 'const sp = gm && gm.spawns && gm.spawns[side];') and
    has(CORE, 'function spawnAnchors(gm)')))
ck('三种胜利目标：全歼 / 占领 / 守住 N 回合（不再按据点算分）',
   (has(CORE, 'function victoryGoals(counters, goals, held)') and
    has(CORE, "if (g.kind === 'capture' && oi >= 0)") and
    has(CORE, "} else if (g.kind === 'hold' && oi >= 0)") and
    (not has(WAR, 'if (!winner) winner = obj.blue > obj.red'))))
ck('防守计数按回合结算（控制住 +1 / 丢了清零）',
   has(CORE, 'h[side] = (ctl.owner === side) ? ((h[side] || 0) + 1) : 0;'))
ck('超时按剩余兵力判（玩家：不再数据点分）',
   (has(CORE, 'function timeUpWinner(counters)') and
    has(WAR, "finishGame(timeUpWinner(W.counters), '回合上限 —— 按剩余兵力判定');")))
ck('UI：部署阶段（手动摆 / 一键部署 / 完成）+ 真实地图底图三态',
   (has(WAR, 'function onDeployClick(mx, my)') and
    has(WAR, 'function autoDeployAll()') and
    has(WAR, 'function finishDeploySide()') and
    has(WAR, 'function drawMapBase(ctx, k)') and
    has(WAR, 'function drawVectorRoads(ctx, k)') and
    has(WAR, "const VIEW_ORDER = ['tint', 'map', 'flat'];")))
ck('UI 不复刻规则：部署区 / 胜负 / 防守计数全调 core 纯函数',
   (has(WAR, 'victoryGoals(W.counters, W.goals, W.held)') and
    has(WAR, 'deployZone(W.hx,') and
    has(WAR, 'holdTick(W.counters, W.goals, W.held, W.side)')))
ck('页面接线：部署模式 / 一键部署 / 完成 / 显示模式 / 两个面板都在',
   (has(HTML, 'id="wg-mode"') and has(HTML, 'id="wg-defender"') and
    has(HTML, 'id="wg-auto"') and has(HTML, 'id="wg-deploy-ok"') and
    has(HTML, 'id="wg-view"') and has(HTML, 'id="wg-deploy-sec"') and
    has(HTML, 'id="wg-goal-sec"')))
ck('CSS 有部署芯片 / 目标行 / 通用 hidden', all(has(CSS, k) for k in
   ['.dep-chip', '.goal-row', '.goal-prog', '.hidden { display: none !important; }']))
ck('地图编辑器的据点也带 rHex（半径按格 · 六角模式）',
   has(ME_JS, 'o.rHex = Math.max(1, Math.round(r / HEX_EDGE));'))

print()
print('== 4o. ★ R10.24：兵牌统一改用 MIL-STD-2525 / APP-6 库（milsymbol） ==')
RD = read(os.path.join(JS, 'render.js'))
DATA = read(os.path.join(JS, 'data.js'))
UI = read(os.path.join(JS, 'ui.js'))
CAT = read(os.path.join(JS, 'ms-catalog.js'))
CAT_GEN = read(os.path.join(ROOT, 'tools', 'gen_ms_catalog.py'))
CAT_BUILD = read(os.path.join(ROOT, 'tools', 'build_catalog.js'))
STYLE = read(os.path.join(ROOT, 'css', 'style.css'))
MS = read(os.path.join(JS, 'vendor', 'milsymbol.js'))
BR = read(os.path.join(JS, 'milsymbol-bridge.js'))
ck('库已本地内置（不联网）：js/vendor/milsymbol.js 存在且是 UMD 单文件',
   os.path.isfile(os.path.join(JS, 'vendor', 'milsymbol.js')) and
   has(MS, 'module.exports=I()') and has(MS, '.ms=I()'))
ck('保留 MIT 许可头（合规）', has(MS, 'The MIT License (MIT)') and has(MS, 'Beckman'))
ck('三个用到兵牌的页面都先加载库、再加载桥接层，最后才是 render.js',
   all((lambda h: (lambda i, j, k: 0 <= i < j < k)(
       h.find('js/vendor/milsymbol.js'), h.find('js/milsymbol-bridge.js'), h.find('js/render.js')))(x)
       for x in [HTML, BH, read(os.path.join(ROOT, 'index.html'))]))
ck('render.js 只留一个入口（手绘版已删除；库没加载时画空框兜底）',
   (has(RD, 'const svg = symbolSvg(type, echelon, custom, { w: SYM_W, h: SYM_H });') and
    (not has(RD, 'function legacyBuildSymbol')) and
    (not has(RD, 'function typeIconSVG')) and (not has(RD, 'function echelonMarkSVG'))))
ck('★ 我们手画的图元库已删除（ICON_PARTS / SECTOR*_PARTS / CHIP_LABELS 全没了）',
   (not has(DATA, 'const ICON_PARTS')) and (not has(DATA, 'const SECTOR1_PARTS')) and
   (not has(DATA, 'const SECTOR2_PARTS')) and (not has(DATA, 'const CHIP_LABELS')) and
   (not has(DATA, 'function renderTextPart')))

# ---- R10.31：标准库目录（取代原来的三件套 + 自定义兵牌） ----
CAT_ITEMS = re.findall(r"\{ n: '([^']*)', s: '([^']*)' \}", CAT)
ck('标准库目录 js/ms-catalog.js 已生成（MS_CATALOG：大类 → 子类 → 条目）',
   os.path.isfile(os.path.join(JS, 'ms-catalog.js')) and
   has(CAT, 'const MS_CATALOG = [') and has(CAT, 'subs: [') and has(CAT, 'items: ['))
ck('★ R10.32：库只留长方形框的陆地单位，且一个兵种一个页签',
   has(CAT, "id: 'lu_infantry'") and has(CAT, "id: 'lu_armor'") and
   has(CAT, "id: 'lu_artillery'") and has(CAT, "id: 'lu_supply'") and
   CAT.count("id: 'lu_") >= 15 and
   all(("n: '%s', subs: [" % n) not in CAT for n in
       ['陆地单位', '陆地装备', '陆地设施', '空中', '海面', '水下', '活动', '太空', '民用']))
ck('目录条目够多（%d 条）且都是 15 位 SIDC' % len(CAT_ITEMS),
   len(CAT_ITEMS) >= 300 and all(len(sidc) == 15 for _, sidc in CAT_ITEMS))
ck('每条都是陆地维度（第 3 位 G，画出来是矩形框）',
   all(sidc[2] == 'G' for _, sidc in CAT_ITEMS))
ck('按兵种重新分组（步兵/装甲兵/炮兵/防空兵/陆军航空兵/侦察兵 …）',
   all(has(CAT, "n: '%s', items: [" % n) for n in
       ['步兵', '装甲兵', '炮兵', '反坦克', '防空兵', '陆军航空兵',
        '侦察兵', '工程兵', '防化兵', '通信兵', '情报与电子战',
        '医疗卫勤', '补给与维修', '运输与投送', '人事与行政']))
CJK = re.compile(r'[\u4e00-\u9fa5]')
cn = [n for n, _ in CAT_ITEMS if CJK.search(n)]
ck('目录名字都翻成了中文（%d / %d）' % (len(cn), len(CAT_ITEMS)),
   len(cn) >= len(CAT_ITEMS) * 0.98)
ck('生成器读的是官方表（JMSML 的 LegacySymbol 15 位 SIDC）+ 有中文词表',
   has(CAT_GEN, 'LegacySymbol') and has(CAT_GEN, 'const LEN') is False and
   has(CAT_GEN, 'ZH_ENTITY') and os.path.isfile(os.path.join(ROOT, 'tools', 'zh_glossary.py')))
ck('生成后用 milsymbol 实测校验 SIDC（库不认 / 画不出图形的一律不收）',
   has(CAT_BUILD, 'okSymbol(s)') and has(CAT_BUILD, 'sym.isValid()') and
   has(CAT_BUILD, 'ms.Symbol'))
ck('★ 自定义兵牌已彻底删除（没有三池脚本 / 没有弹窗标记 / 没有「+ 自定义兵牌」按钮）',
   (not os.path.isfile(os.path.join(JS, 'ms-parts.js'))) and
   (not os.path.isfile(os.path.join(ROOT, 'tools', 'gen_ms_parts.js'))) and
   (not has(UI, 'customDraft')) and (not has(UI, 'renderCustomModal')) and
   (not has(BR, 'msFragOf')) and (not has(BR, 'symbolForMod')) and
   (not has(read(os.path.join(ROOT, 'index.html')), 'custom-modal')) and
   (not has(read(os.path.join(ROOT, 'index.html')), 'lib-new-btn')))
ck('兵牌库面板：大类分页 + 二级子类标题 + 分批加载',
   has(UI, 'TYPES_CAT') and has(UI, 'className = \'lib-sub\'') and
   has(UI, 'appendLibBatch') and has(STYLE, '.lib-sub {') and has(STYLE, '.lib-more {'))
ck('data.js 把目录并进 TYPES（每条带 sidc / cat / 中文名）',
   has(DATA, 'function mergeCatalogTypes') and has(DATA, 'TYPES[key] = { name: it.n, cat: cat.id, sidc: it.s };') and
   has(DATA, 'const TYPES_CAT = []'))

ck('SIDC 拼装只写在一处（S+敌我+维度+状态+6 位功能码+2 位修饰+3 位）',
   has(BR, "'SFGP' + String(code || '').padEnd(6, '-') + mod1 + mod2 + '---'"))
ck('梯队 → 第 12 位（A 组 B 班 C 分队 D 排 E 连 F 营 G 团 H 旅 I 师 J 军 K 集团军）',
   all(has(BR, k + ": '" + v + "'") for k, v in
       [('team', 'A'), ('squad', 'B'), ('section', 'C'), ('platoon', 'D'), ('company', 'E'),
        ('battalion', 'F'), ('regiment', 'G'), ('brigade', 'H'), ('division', 'I'),
        ('corps', 'J'), ('army', 'K')]))
ck('防空=穹顶 UCD--- / 机步=UCII-- / 摩托化=UCIM--（都取自库自带的功能码表）',
   has(BR, "'UCD---'") and has(BR, "'UCII--'") and has(BR, "'UCIM--'"))
ck('主图形是字母的兵种（HQ/CS/MP）按玩家要求保留我们自己的文字',
   (has(BR, "const TEXT_MAIN = { combat_support: 'CS', mp: 'MP', hq: 'HQ' };") and
    has(BR, 'function msInjectText(svg, text, ink)')))
ck('敌方红墨改成**参数**传（不再对 SVG 做字符串替换）',
   has(WAR, 'svg = symbolSvg(type, echelon, custom, { ink });'))

order = [HTML.find('js/maps-presets.js'), HTML.find('js/grid-maps.js'),
         HTML.find('js/hex-core.js'), HTML.find('js/hex-wargame.js')]
ck('wargame.html 脚本顺序：maps-presets → grid-maps → hex-core → hex-wargame',
   all(a >= 0 for a in order) and order == sorted(order))
ck('wargame.html 有画布 / 侧栏 / 命令条 / 相机控件',
   (has(HTML, 'id="wg-canvas"') and has(HTML, 'id="wg-side"') and
    has(HTML, 'id="wg-bar"') and has(HTML, 'id="wg-fit"')))
ck('wargame.html 有"棋子粒度"选择（班/火力组/分队/排/连）',
   (has(HTML, 'id="wg-ech"') and has(HTML, 'value="squad"') and has(HTML, 'value="platoon"')))
ck('css/wargame.css 有手机端媒体查询 + 画布 touch-action',
   (has(CSS, '@media (max-width: 900px)') and has(CSS, 'touch-action: none')))
ck('index.html 有兵棋入口（wargame.html）', has(IDX, 'wargame.html'))
ck('battle.html 标了 ALPHA（旧的实时战斗冻结不动）', has(BH, 'ALPHA'))
ck('页面上写明"每格 100m"', has(HTML, '100m'))

print()
print('== 5b. 入口可达性（玩家反馈过"入口在哪我没找到"） ==')
PORTAL = os.path.join(ROOT, '..', 'index.html')
PORTAL = read(PORTAL) if os.path.exists(PORTAL) else ''
UIS = read(os.path.join(JS, 'ui.js'))
MEH = read(os.path.join(ROOT, 'map-editor.html'))
ck('编辑器顶栏入口排在「战斗测试」之前（不会被挤出可视区）',
   (IDX.find('wargame.html') > 0) and (IDX.find('wargame.html') < IDX.find('btn-battle')))
ck('编辑器顶栏入口不是 desktop-only 按钮的最后一个（hint 已可收缩）',
   has(read(os.path.join(ROOT, 'css', 'style.css')), 'header .hint {\n    flex: 0 1 auto;'))
ck('门户页（项目根 index.html）首屏 CTA 有兵棋入口',
   has(PORTAL, 'army-editor/wargame.html'))
ck('门户页工具集里有兵棋卡片', has(PORTAL, '开始下棋'))
ck('battle.html 顶栏有兵棋入口', has(BH, 'href="wargame.html"'))
ck('map-editor.html 顶栏有兵棋入口', has(MEH, 'href="wargame.html"'))
ck('编辑器手机端 ☰「更多功能」里有兵棋入口',
   has(UIS, 'href="wargame.html"'))

print()
print('== 6. 数值体检（node tools/hex_probe.js --json） ==')
probe = os.path.join(ROOT, 'tools', 'hex_probe.js')
data = None
if os.path.exists(probe):
    try:
        r = subprocess.run(['node', probe, '--json'], capture_output=True, timeout=180)
        if r.returncode == 0:
            data = json.loads(r.stdout.decode('utf-8', 'replace'))
        else:
            print('  （node 退出码 %d：%s）' %
                  (r.returncode, r.stderr.decode('utf-8', 'replace')[:300]))
    except FileNotFoundError:
        print('  SKIP：本机没有 node，跳过动态体检（静态断言已跑完）')
    except Exception as e:
        print('  SKIP：动态体检失败 %s' % e)
else:
    print('  SKIP：找不到 tools/hex_probe.js')

if data:
    g = data['geo']
    ck('六角格 8×8：hexCenter ↔ worldToHex 往返全对', len(g['roundTripFail']), 0)
    ck('六角格：每格恰好 6 个邻居且距离都是 1', len(g['neighborFail']), 0)
    ck('攻击线：不含起终点，长度 = 距离-1', len(g['lineFail']), 0)
    ck('CRT 单调性（骰点↑ / FLV↑ 都不会更差）', data['crtViolations'], [])

    L = data['ladders']
    squad = L['班9人·步枪']['soft'][0]
    platoon = L['排27人·步枪']['soft'][0]
    company = L['连81人·步枪']['soft'][0]
    ck('1 格上：9 人班 FLV 4~6（能打但打不穿重装甲）', 4 <= squad <= 6, True)
    ck('1 格上：27 人排 FLV 7~10（攻坚主力）', 7 <= platoon <= 10, True)
    ck('1 格上：81 人连 FLV = 12（集火顶格）', company, 12)
    ck('反装甲组对装甲 FLV ≥ 6（火箭筒能威胁坦克）',
       min(L['反装甲组·火箭筒']['hard']) >= 6, True)
    ck('步兵班反装甲 FLV = 1（步枪打不穿坦克）',
       max(L['班9人·步枪']['hard']), 1)
    ck('距离衰减：1 格 > 最远格', squad > L['班9人·步枪']['soft'][-1], True)

    print()
    print('  棋子射程表（FLV，逐格）：')
    for k, v in L.items():
        print('    %-18s 软 %-22s 硬 %-22s 射程 %d 格' %
              (k, ','.join(map(str, v['soft'])), ','.join(map(str, v['hard'])), v['range']))

print()
print('== 6.5 R10.33：装备库层级 / 自行火炮数值 / 堆叠 / 加强减弱 / 徽章 / 复制子树 ==')
EQUI = read(os.path.join(JS, 'equipment-ui.js'))
MODEL = read(os.path.join(JS, 'model.js'))
DIALOG = read(os.path.join(JS, 'dialog.js'))
ART = EQ[EQ.index('artillery: {'):EQ.index('at_gun: {')]
ck('装备库弹窗层级低于确认框（否则"删除装备"的确认框被压住、点不到）',
   has(EQUI, 'z-index:2147483600') and has(DIALOG, 'z-index:2147483646'))
ck('自行火炮能填「速度」和「机动方式」（全履带 / 半履带 / 轮式）',
   has(ART, "key: 'mobility'") and has(ART, "name: '速度'") and
   has(ART, "key: 'mobilityType'") and
   has(ART, "label: '全履带'") and has(ART, "label: '半履带'") and has(ART, "label: '轮式'"))
ck('数据模型：节点带 加强/减弱 · 徽章 · 合并显示 三个字段（且存读都认）',
   has(MODEL, "mod: '', badge: '', stack: true") and
   has(MODEL, 'n.mod = data.mod') and has(MODEL, 'c.badge = node.badge') and
   has(MODEL, 'n.stack = data.stack !== false'))
ck('合并显示是默认行为（有完全一样的下属就叠成一格，省空间）',
   has(MODEL, 'c.stack = node.stack !== false') and has(MODEL, 'stack: true'))
ck('顶栏收成「保存 / 装备库 / 撤销 / 更多」，其余收进下拉',
   has(IDX, 'id="btn-more"') and has(IDX, 'id="more-panel"') and
   has(STYLE, 'header .more-panel') and has(UI, "getElementById('btn-more')") and
   has(IDX, 'id="btn-load"') and has(IDX, 'id="btn-export-img"') and
   has(IDX, 'id="btn-battle"'))
ck('堆叠：按「整棵子树指纹」分组，堆叠时每组只画第一条分支',
   has(MODEL, 'function nodeSignature') and has(MODEL, 'function visibleChildren') and
   has(MODEL, 'function hasStackableChildren') and has(RD, 'visibleChildren(node)'))
ck('加强/减弱画在兵牌框外右上角，堆叠画多层方框 + ×N',
   has(RD, 'class="mod-mark ') and has(STYLE, '.node .mod-mark {') and
   has(RD, 'class="stack-layer l1"') and has(STYLE, '.node .stack-layer.l1') and
   has(RD, 'class="stack-count"'))
ck('属性面板：加强/减弱按钮 + 上传徽章 + 堆叠开关',
   has(UI, 'mod-opt') and has(UI, 'btn-badge-up') and has(UI, 'pickBadgeImage') and
   has(UI, 'btn-toggle-stack'))
ck('复制 = 当前单位 + 全部下属（粘贴走 cloneSubtree 一起带）',
   has(UI, 'clipboardNode = serializeOrg(node);') and has(UI, 'countDescendants(node)'))

print()
print('== 4p. 建筑 / 碉堡（★ R10.36：中立建筑 + 工兵修碉堡 + 敌方进驻摧毁） ==')
ck('常量：修一座碉堡 = 3 回合；掩体 碉堡 3 / 建筑 2',
   (has(CORE, 'const BUNKER_TURNS = 3;') and has(CORE, 'const BUNKER_FLV = 3;') and
    has(CORE, 'const BUILDING_FLV = 2;')))
ck('开局：地图上的建筑全部登记成**中立建筑**（side 为空 ⇒ 谁都能进）',
   (has(CORE, 'function initBuildings(hx)') and
    has(CORE, "map.set(bldKeyOf(h), { side: BLD_NEUTRAL, kind: 'building', t: 0, by: '' });") and
    has(CORE, "if ((h.bld | 0) > 0 || h.terr === 'house') {")))
ck('施工校验：只有空地能开工（建筑格 / 水面上不行）',
   (has(CORE, 'function canBuildHere(map, hex)') and
    has(CORE, "if (b) return { ok: false, why: (b.kind === 'bunker'")))
ck('每回合推进 / 打断：进 ZOC、挨打 ⇒ 打断；满 3 回合 ⇒ 完工',
   (has(CORE, 'function buildTick(bld, hex, zocKeys, hit)') and
    has(CORE, "if (zocKeys && zocKeys.has(bldKeyOf(hex))) return { ok: false, why: '处于敌方 ZOC' };") and
    has(CORE, "if (hit) return { ok: false, why: '遭到攻击' };") and
    has(CORE, "if (bld.t >= BUNKER_TURNS) { bld.kind = 'bunker'; return { ok: true, done: true, left: 0 }; }")))
ck('守方掩体：地形与建筑/碉堡**取大者**（不重复叠加两次）',
   (has(CORE, 'function defTerrShift(hex, bld)') and
    has(CORE, "if (bld) tp = Math.max(tp, bld.kind === 'bunker' ? BUNKER_FLV : BUILDING_FLV);")))
ck('resolveFire 把建筑/碉堡算进守方 FLV（opts.bld）',
   (has(CORE, 'const bld = (opts.bld !== undefined) ? opts.bld : null;') and
    has(CORE, 'const tp = defTerrShift(def.hex, bld);')))
ck('挨打会被记一笔（hitThisTurn），本方回合开始清零',
   (has(CORE, "if (res && res.code && res.code !== '—') def.hitThisTurn = true;") and
    has(CORE, 'c.hitThisTurn = false;')))
ck('修碉堡用掉这一手（acted = build ⇒ 不能再移动/射击）',
   (has(CORE, "else if (atk.acted === 'build') why = '本回合在修碉堡';") and
    has(WAR, "c.acted = 'build';")))
ck('兵棋：W.bld 建筑表 + 开局登记 + 每个回合末推进',
   (has(WAR, 'bld: new Map(),') and has(WAR, 'W.bld = initBuildings(W.hx);') and
    has(WAR, 'function tickBuilds(side)') and has(WAR, 'tickBuilds(W.side);')))
ck('兵棋：敌方进驻 ⇒ 碉堡**自动销毁**（中立建筑不受影响）',
   (has(WAR, 'function bunkerOnEnter(c, h)') and
    has(WAR, "if (b.kind === 'bunker' && b.side && b.side !== c.side) {") and
    has(WAR, 'W.bld.delete(hexKey(h));')))
ck('兵棋：面板「🏗 修建碉堡」按钮 + 条件说明（不满足就灰掉并写原因）',
   (has(WAR, 'class="build-box"') and has(WAR, 'id="wg-build"') and
    has(WAR, 'function buildCheck(c)') and has(WAR, 'function startBuild()') and
    has(CSS, '.build-box button')))
ck('兵棋：画面上画出 中立建筑 / 在建碉堡(带进度) / 完工碉堡',
   (has(WAR, 'function drawWarBuildings(ctx, r)') and has(WAR, 'drawWarBuildings(ctx, r);') and
    has(WAR, "ctx.fillText(done ? '🏰' : '🔨'")))
ck('撤回要带上建筑/碉堡状态（工地进度、被炸掉的碉堡都回滚）',
   (has(WAR, 'bld: Array.from(W.bld || new Map()') and
    has(WAR, 'if (s.bld) W.bld = new Map(s.bld.map')))
ck('建筑**不会被打坏**：兵棋里没有建筑 HP 衰减（hp 只留在编辑器/battle 兼容字段里）',
   (not has(WAR, 'b.hp -=') and not has(WAR, 'bld.hp')))

print()
print('== 4q. 存档（★ R10.38：文件为准 + IndexedDB 缓存 + 老 localStorage 迁移） ==')
STORE = read(os.path.join(JS, 'store.js'))
IOJS = read(os.path.join(JS, 'io.js'))
MODEL = read(os.path.join(JS, 'model.js'))
ck('store.js：文件保存三条路（另存为 / 手机分享 / 下载）',
   (has(STORE, 'async function saveFile(filename, obj, opts)') and
    has(STORE, 'showSaveFilePicker') and has(STORE, 'navigator.canShare') and
    has(STORE, 'a.download = name')))
ck('IndexedDB 换成新的本机存储（不再受 localStorage 5MB 限制）',
   (has(STORE, 'indexedDB') and has(STORE, "const DB_NAME = 'mil_store_v1'") and
    has(STORE, 'function idbPut(k, v)') and has(STORE, 'function idbAll()')))
ck('老 localStorage 数据一次性迁移 + 可清理释放空间',
   (has(STORE, 'for (const k of LEGACY_KEYS)') and has(STORE, 'function clearLegacy()') and
    has(STORE, 'function legacyBytes()')))
ck('编制「保存」= 同时写文件（不再只是保存到浏览器）',
   (has(IOJS, 'const r = await saveOrgRecordToFile(name, rec);') and
    has(IOJS, "kind: 'mil-org'") and has(IOJS, 'function fileResultText(r)')))
ck('「全部数据」一键导出 / 导入（编制 + 地图 + 装备库）',
   (has(STORE, 'function bundle()') and has(STORE, 'function applyBundle(b)') and
    has(IOJS, 'async function exportEverything()') and has(IOJS, 'async function importEverything()') and
    has(IDX, 'id="btn-export-all"') and has(IDX, 'id="btn-import-all"')))
ck('地图 / 装备库 / 编制存档 / 自动存档都改走 Store',
   (has(GRIDM, "if (typeof Store !== 'undefined') return Store.get(GRID_MAPS_KEY, {}) || {};") and
    has(EQ, "if (typeof Store !== 'undefined') return Store.get(EQUIP_LIB_KEY, {}) || {};") and
    has(WAR, "if (typeof Store !== 'undefined') return Store.get(WG_SAVES_KEY, {}) || {};") and
    has(MODEL, "if (typeof Store !== 'undefined') Store.set(AUTOSAVE_KEY, rec);")))
ck('四个页面都加载 js/store.js',
   all(has(P, 'js/store.js') for P in (IDX, HTML, BH, ME_HTML)))
ck('手机端：兵棋右侧面板改成上滑抽屉（带开关按钮）',
   (has(HTML, 'id="wg-side-toggle"') and has(CSS, 'body.wg-side-open #wg-side') and
    has(WAR, "document.body.classList.toggle('wg-side-open')")))

print()
print('== 4r. 部署文件夹树 + 从文件导入编制/地图（★ R10.39） ==')
ck('部署清单是**文件夹树**（<details> 一层层展开，带「已放/总数」）',
   (has(WAR, 'function deployTreeOf(list)') and
    has(WAR, 'function deployTreeHtml(node, st, pathKey, depth)') and
    has(WAR, 'class="dep-folder"') and has(WAR, '📁 ') and
    has(CSS, '.dep-folder > summary')))
ck('文件夹展开状态记在 W.deploy.open（重画后不折叠回去）',
   (has(WAR, "d.addEventListener('toggle'") and has(WAR, 'open.add(k)')))
ck('可以不全部部署：还有没放的确认一下，确认后只带已部署的开打',
   (has(WAR, 'function finishDeploySide()') and has(WAR, 'async function askFinishDeploySide()') and
    has(WAR, 'askFinishDeploySide()') and has(WAR, '本局不上场')))
ck('兵棋顶栏可以直接**从文件导入编制 / 地图**',
   (has(HTML, 'id="wg-import-army"') and has(HTML, 'id="wg-import-map"') and
    has(WAR, 'async function importArmyFromFile()') and has(WAR, 'async function importMapFromFile()') and
    has(WAR, 'saveUserMapToStorage(gm)') and has(WAR, 'Store.set(WG_SAVES_KEY, saves);')))

print()
print('== 7. 界面层离线冒烟（node tools/hex_ui_smoke.js） ==')
smoke = os.path.join(ROOT, 'tools', 'hex_ui_smoke.js')
if os.path.exists(smoke):
    try:
        r = subprocess.run(['node', smoke], capture_output=True, timeout=240)
        out = r.stdout.decode('utf-8', 'replace')
        ck('开局→选子→移动→开火→换回合→结算 全链路跑通',
           ('SMOKE OK' in out) and r.returncode == 0, True)
        if r.returncode != 0:
            print(out[-2500:])
            print(r.stderr.decode('utf-8', 'replace')[-1500:])
    except FileNotFoundError:
        print('  SKIP：本机没有 node，跳过界面冒烟')
    except Exception as e:
        print('  SKIP：界面冒烟失败 %s' % e)
else:
    print('  SKIP：找不到 tools/hex_ui_smoke.js')

print()
print('全部通过 ✅' if fails == 0 else '%d 项失败 ❌' % fails)
sys.exit(0 if fails == 0 else 1)

ck('声明了 HEX_ECHELONS，且**没有**重复声明 data.js 的 ECHELONS',
   (has(CORE, 'const HEX_ECHELONS =') and (not has(CORE, 'const ECHELONS ='))))
