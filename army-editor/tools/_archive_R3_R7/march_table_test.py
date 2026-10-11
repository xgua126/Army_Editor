# -*- coding: utf-8 -*-
"""R7 行军系统（用户框架）—— 唯一通行/速度表 + 静态守卫

用户定的规则（本文件就是它的可执行说明书）：
  · 徒步      ：**速度恒定、永不受地形影响**；只被"绝对不可通行"挡
  · 轮式      ：只走平地 + 公路（树林/山丘/城区/河/墙 都不可通行）
  · 履带/半履带：可通行地形更多（含树林/山丘/战壕）
  · 第一步/最后一步（接入/驶离腿）：履带/半履带再放宽一档（可穿城区）
  · 石墙 + 建筑：**所有身份、所有档位**都不可通行
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

fails = 0
def ck(name, got, exp):
    global fails
    ok = (got == exp)
    if not ok: fails += 1
    print(("  ok   " if ok else "  FAIL ") + f"{name}: {got}（期望 {exp}）")

HERE = os.path.dirname(os.path.abspath(__file__))
def src(rel):
    return io.open(os.path.join(HERE, rel), 'r', encoding='utf-8').read()

# ============================================================
# 1) 与 grid-maps.js MARCH_TABLE / MARCH_TABLE_ACCESS 同值映射（手工对齐）
# ============================================================
MAIN = {
    'foot':      {'empty': 1.00, 'road': 1.00, 'forest': 1.00, 'hill': 1.00, 'house': 1.00, 'river': 1.00, 'trench': 1.00, 'wall': None},
    'wheeled':   {'empty': 0.60, 'road': 1.69, 'forest': None, 'hill': None, 'house': None, 'river': None, 'trench': None, 'wall': None},
    'tracked':   {'empty': 0.90, 'road': 1.43, 'forest': 0.51, 'hill': 0.68, 'house': None, 'river': None, 'trench': 0.36, 'wall': None},
    'halftrack': {'empty': 0.85, 'road': 1.56, 'forest': 0.45, 'hill': 0.60, 'house': None, 'river': None, 'trench': 0.34, 'wall': None},
}
ACCESS = {
    'foot':      MAIN['foot'],
    'wheeled':   MAIN['wheeled'],
    'tracked':   dict(MAIN['tracked'], house=0.40),
    'halftrack': dict(MAIN['halftrack'], house=0.35),
}
TERRAINS = ['empty', 'road', 'forest', 'hill', 'house', 'river', 'trench', 'wall']

def mul(cls, terr, tier='main'):
    row = (ACCESS if tier == 'access' else MAIN).get(cls, MAIN['foot'])
    v = row[terr]
    return 0 if v is None else v
def passable(cls, terr, tier='main'):
    return mul(cls, terr, tier) > 0
def pass_set(cls, tier='main'):
    return set(t for t in TERRAINS if passable(cls, t, tier))

def time_of(cls, terr, meters, tier='main'):
    """时间当量 = 米 ÷ 倍率（不可通行 ⇒ 无穷）"""
    m = mul(cls, terr, tier)
    return float('inf') if m <= 0 else meters / m

print("== 1. 徒步：速度恒定、不受地形影响 ==")
ck("徒步在所有非石墙地形都能过", pass_set('foot'), set(TERRAINS) - {'wall'})
ck("徒步倍率全 = 1.00（不受地形影响）", sorted(set(mul('foot', t) for t in TERRAINS if t != 'wall')), [1.0])
ck("走 1000m 草地 / 树林 / 山丘 / 城区 耗时完全相同",
   (time_of('foot', 'empty', 1000), time_of('foot', 'forest', 1000),
    time_of('foot', 'hill', 1000), time_of('foot', 'house', 1000)),
   (1000.0, 1000.0, 1000.0, 1000.0))
ck("石墙：徒步也不可通行", passable('foot', 'wall'), False)

print("== 2. 轮式：只走平地 + 公路 ==")
ck("轮式可通行集 = {平地, 公路}", pass_set('wheeled'), {'empty', 'road'})
ck("轮式 公路 : 平地 = 2.82 倍", round(mul('wheeled', 'road') / mul('wheeled', 'empty'), 2), 2.82)
ck("轮式 进树林 ✗ / 上丘陵 ✗ / 进城区 ✗ / 过河 ✗", pass_set('wheeled') & {'forest', 'hill', 'house', 'river'}, set())

print("== 3. 履带 / 半履带：可通行地形更多 ==")
ck("履带可通行集 ⊃ 轮式 + {树林, 山丘, 战壕}", pass_set('tracked'), {'empty', 'road', 'forest', 'hill', 'trench'})
ck("半履带与履带可通行集相同", pass_set('halftrack') == pass_set('tracked'), True)
ck("履带能过丘陵（轮式不能）", passable('tracked', 'hill') and not passable('wheeled', 'hill'), True)
ck("履带/半履带过河仍然 ✗（河是绝对障碍级）",
   (passable('tracked', 'river'), passable('halftrack', 'river')), (False, False))

print("== 4. 第一步 / 最后一步（接入 / 驶离腿）放宽档 ==")
ck("履带·放宽档：可穿城区", passable('tracked', 'house', 'access'), True)
ck("半履带·放宽档：可穿城区", passable('halftrack', 'house', 'access'), True)
ck("轮式**不**放宽（用户没给轮式放宽）", passable('wheeled', 'house', 'access'), False)
ck("放宽档对石墙无效（绝对不可通行）",
   (passable('tracked', 'wall', 'access'), passable('wheeled', 'wall', 'access')), (False, False))
ck("徒步放宽档 = 主档（本来就哪儿都能走）", pass_set('foot', 'access') == pass_set('foot'), True)

print("== 5. 静态守卫（源码里必须还在 / 必须已经不在）==")
gm = src(os.path.join('..', 'js', 'grid-maps.js'))
bt = src(os.path.join('..', 'js', 'battle.js'))
ck("唯一表 MARCH_TABLE 存在", 'const MARCH_TABLE = {' in gm, True)
ck("放宽档 MARCH_TABLE_ACCESS 存在", 'const MARCH_TABLE_ACCESS = {' in gm, True)
ck("唯一倍率函数 marchMulForTile（0 = 不可通行）", 'function marchMulForTile(cls, tg, tier) {' in gm, True)
ck("canStandAt 走唯一表", ('function canStandAt(gm, x, y, cls, tier) {' in gm)
   and ('return marchMulForTile(cls, t, tier) > 0;' in gm), True)
ck("A* 粗格按档位建（main / access）", 'function navcBuildGrid(gm, tier) {' in gm and 'function navFor(gm, tier) {' in gm, True)
ck("行军规划器唯一入口 planMarchRoute", 'function planMarchRoute(gm, cls, sx, sy, gx, gy) {' in gm, True)
ck("沿公路行走（路网图上走）", 'function marchViaRoad(gm, cls, specFrom, specTo) {' in gm, True)
ck("退让阶梯（接入点按时间升序逐个试）", 'candIn.sort((a, b) => a.t - b.t);' in gm, True)
ck("battle.js 调用行军规划器", 'planMarchRoute(battle.gridMap, cls, unit.x, unit.y, navGX, navGY)' in bt, True)
ck("battle.js 有行军/战斗模式判定", 'function updateMoveMode(unit) {' in bt and 'function enemyThreatRange(enemy, unit) {' in bt, True)
ck("+500m 与 平静回切 常量在", ('MARCH_COMBAT_EXTRA = 500' in bt) and ('MARCH_CALM_SEC = 15' in bt), True)
ck("旧决策层已删干净",
   not any(s in bt for s in ('function planRouteViaMap', 'function rideRoutePlan', 'function vehicleReach',
                             '_rideStop', 'ROUTE_ENTRY_MAX', 'RIDE_MIN_ADVANTAGE')), True)
for nm, txt in (('grid-maps.js', gm), ('battle.js', bt), ('map-editor.js', src(os.path.join('..', 'js', 'map-editor.js')))):
    ck(nm + ' 括号平衡', txt.count('{') - txt.count('}'), 0)

print('')
print('%s' % ('全部通过 ✓' if fails == 0 else f'{fails} 项失败 ✗'))
sys.exit(0 if fails == 0 else 1)
