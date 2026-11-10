# -*- coding: utf-8 -*-
"""R9.6.6 镜像测试：**选路要代入"地形数值 × 单位数值"**

为什么必须有这一条：
两张表一直在（`TERRAIN_SPEED_TABLE` + 单位 `mobilityType/speed`），但它们**从来没进过选路**：
  · `getTerrainAt()` 不返回 `id`，而 `mobilityMulForTile` 读的正是 `tg.id` ⇒ 查表恒得 0
    ⇒ **徒步 _terrainMul = 0（一步不动）、车辆被钳到 0.15×** —— 地形表形同虚设；
  · 快速移动只看几何距离 ⇒ 轮式往森林里钻、步兵白绕公路、长途明明直线更快还沿路走。

玩家定案："把地形的数值和单位的数值代入进去"。
本测试把"代价模型"镜像成 Python，用**手算得出来的数字**守住：
  腿的代价 = 米 ÷ (单位速度 × 地形倍率)   ；倍率 0（开不进去）⇒ ∞
再断言"选路比较"的结论：轮式该沿路、步兵该走直线、不可通行必须判 ∞。
"""
import sys, io, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

fails = 0
def ck(name, got, exp):
    global fails
    ok = (got == exp)
    if not ok: fails += 1
    print(("  ok   " if ok else "  FAIL ") + f"{name}: {got}（期望 {exp}）")

# ---------- ★ 与 grid-maps.js 一字不差的表 ----------
TABLE = {
    'foot':      {'empty':1.00,'road':1.00,'forest':1.00,'hill':1.00,'house':1.00,'river':1.00,'trench':1.00,'wall':0},
    'wheeled':   {'empty':0.60,'road':1.69,'forest':0,   'hill':0,   'house':0,   'river':0,   'trench':0,   'wall':0},
    'tracked':   {'empty':0.90,'road':1.43,'forest':0.51,'hill':0.68,'house':0,   'river':0,   'trench':0.36,'wall':0},
    'halftrack': {'empty':0.85,'road':1.56,'forest':0.45,'hill':0.60,'house':0,   'river':0,   'trench':0.34,'wall':0},
    'air':       {'empty':1.00,'road':1.00,'forest':1.00,'hill':1.00,'house':1.00,'river':1.00,'trench':1.00,'wall':1.00},
}
def mul_for(mob, tile):
    row = TABLE.get(mob, TABLE['foot'])
    v = row.get(tile)
    return 0 if v is None else v

# ---------- ★ 与 battle.js 同算法（legTime / pathTime） ----------
def leg_time(mob, speed, a, b, tile_at, step_m=25.0):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    if L < 1: return 0.0
    n = max(1, int(math.ceil(L / step_m)))
    seg = L / n
    t = 0.0
    for i in range(n):
        k = (i + 0.5) / n                      # ★ 每段中点（Σ(seg) 正好 = L）
        mul = mul_for(mob, tile_at(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k))
        if not (mul > 0): return float('inf')
        t += seg / (speed * mul)
    return t

def path_time(mob, speed, pts, tile_at):
    t = 0.0
    for i in range(1, len(pts)):
        d = leg_time(mob, speed, pts[i - 1], pts[i], tile_at)
        if not math.isfinite(d): return float('inf')
        t += d
    return t

def fmt_eta(sec):
    if not math.isfinite(sec): return '—'
    if sec < 90: return '%d 秒' % round(sec)
    m = sec / 60
    if m < 60: return '%.1f 分钟' % (round(m * 10) / 10)
    return '%.1f 小时' % (round(m / 6) / 10)

# ---------- 三个地形世界 ----------
def tiles_road_and_grass(x, y):            # 中间一条南北向公路（y=0 处 120m 宽），两侧草地
    return 'road' if abs(y) <= 60 else 'empty'
def tiles_forest_band(x, y):               # 草地 + 一条横穿东西的森林带（x 1400~1600）
    if 1400 <= x <= 1600: return 'forest'
    return 'road' if abs(y) <= 60 else 'empty'
def tiles_wall(x, y):
    return 'wall' if 900 <= x <= 1000 else 'empty'

print('== 1. 地形数值真的生效：同一条 1000m 直腿，公路 vs 草地 ==')
T_ROAD  = leg_time('wheeled', 20.0, (0, 0), (1000, 0), lambda x, y: 'road')
T_GRASS = leg_time('wheeled', 20.0, (0, 0), (1000, 0), lambda x, y: 'empty')
print('     轮式 20m/s：公路 %.2fs · 草地 %.2fs · 比值 %.3f' % (T_ROAD, T_GRASS, T_GRASS / T_ROAD))
ck('公路 1000m = 1000/(20×1.69) = 29.59s', round(T_ROAD, 2), 29.59)
ck('草地 1000m = 1000/(20×0.60) = 83.33s', round(T_GRASS, 2), 83.33)
ck('草地比公路慢 2.8 倍以上（1.69/0.60）', T_GRASS / T_ROAD > 2.8, True)

print('== 2. 单位数值真的生效：同一条穿林腿，轮式 vs 徒步（速度也各用各的）==')
A, B = (0, 0), (3000, 0)
T_WHEEL = leg_time('wheeled', 20.0, A, B, tiles_forest_band)
T_FOOT  = leg_time('foot',    12.0, A, B, tiles_forest_band)
print('     轮式穿林 = %s · 徒步穿林 = %.1fs' % (T_WHEEL, T_FOOT))
ck('轮式穿森林 ⇒ ∞（开不进去，表里是 0）', T_WHEEL, float('inf'))
ck('徒步穿森林 ⇒ 有限（foot 全 1.00）', math.isfinite(T_FOOT), True)
ck('徒步 = 3000/(12×1.0) = 250.0s', round(T_FOOT, 1), 250.0)
ck('履带穿森林有限但慢（0.51×）',
   round(leg_time('tracked', 20.0, A, B, lambda x, y: 'forest'), 1), round(3000 / (20 * 0.51), 1))

print('== 3. 不可通行的地形必须判 ∞（不能"吸附到不能走的地方"）==')
T_WALL = leg_time('wheeled', 20.0, (0, 0), (2000, 0), tiles_wall)
ck('轮式遇石墙 ⇒ ∞', T_WALL, float('inf'))
ck('徒步遇石墙也 ⇒ ∞（foot 的 wall = 0）', leg_time('foot', 12.0, (0, 0), (2000, 0), tiles_wall), float('inf'))
ck('折线里只要有一点不可通行 ⇒ pathTime = ∞',
   path_time('wheeled', 20.0, [(0, 0), (950, 0), (1200, 0)], tiles_wall), float('inf'))

print('== 4. 选路比较（这就是"代入"要改变的行为）==')
# 场景：沿公路绕 1.6 倍距离  vs  直线越野
L_DIRECT = 1000.0
L_ROAD   = 1600.0
t_road_wheel  = L_ROAD   / (20.0 * 1.69)      # 轮式沿公路
t_direct_wheel= L_DIRECT / (20.0 * 0.60)      # 轮式越野（草地）
t_road_foot   = L_ROAD   / (12.0 * 1.00)      # 徒步沿公路（foot 无公路加成）
t_direct_foot = L_DIRECT / (12.0 * 1.00)      # 徒步直线
print('     轮式：沿路 %.1fs vs 直线 %.1fs ⇒ 选 %s' % (t_road_wheel, t_direct_wheel, '沿公路' if t_road_wheel < t_direct_wheel else '直线'))
print('     徒步：沿路 %.1fs vs 直线 %.1fs ⇒ 选 %s' % (t_road_foot, t_direct_foot, '沿公路' if t_road_foot < t_direct_foot else '直线'))
ck('轮式：绕 1.6 倍也该走公路（1.69× 值）', t_road_wheel < t_direct_wheel, True)
ck('徒步：公路没有加成 ⇒ 宁可走直线（shorter wins）', t_direct_foot < t_road_foot, True)
ck('履带：绕 1.4 倍走公路更快（1.43/0.90 = 1.59 倍以内都划算）',
   (1400 / (20 * 1.43)) < (1000 / (20 * 0.90)), True)
ck('履带：绕 1.7 倍就不划算了（阈值就是倍率之比）',
   (1700 / (20 * 1.43)) < (1000 / (20 * 0.90)), False)

print('== 5. 预计用时（ETA）与显示 ==')
ck('ETA = Σ L/(speed×mul)：1000m 公路 + 500m 草地（轮式 20）',
   round(1000 / (20 * 1.69) + 500 / (20 * 0.60), 1), round(29.59 + 41.67, 1))
ck('fmtEta(45) ⇒ 秒', fmt_eta(45), '45 秒')
ck('fmtEta(192) ⇒ 3.2 分钟', fmt_eta(192), '3.2 分钟')
ck('fmtEta(∞) ⇒ —', fmt_eta(float('inf')), '—')

print('== 6. 静态守卫：这套"代入"必须真的接在代码上（不许只写在测试里）==')
import os
HERE = os.path.dirname(os.path.abspath(__file__))
BT = io.open(os.path.join(HERE, '..', 'js', 'battle.js'), encoding='utf-8').read()
CD = io.open(os.path.join(HERE, '..', 'js', 'cmd.js'), encoding='utf-8').read()
DP = io.open(os.path.join(HERE, '..', 'js', 'dev-panel.js'), encoding='utf-8').read()

ck('battle.js：getTerrainAt 带上 id（地形表能查到的那把钥匙）',
   'id: t.id,' in BT, True)
ck('battle.js：mulAtPoint 直接取地形瓦片（不再用缺 id 的对象）',
   'terrainMobilityMulFor(mob, getGridTerrain(battle.gridMap, x, y))' in BT, True)
ck('battle.js：unitPlanProfile（乘车/徒步 + mob + speed，可带目标做二选一）',
   ('function unitPlanProfile(unit, toX, toY) {' in BT) and ('mobilityTypeMounted || unit.mobilityType' in BT), True)
ck('battle.js：legTime 用 mobilityMulForTile 且 mul=0 ⇒ Infinity',
   ('function legTime(unit, a, b, prof) {' in BT) and ('if (!(mul > 0)) return Infinity;' in BT), True)
ck('battle.js：pathTime（折线，任一点不通 ⇒ Infinity）', 'function pathTime(unit, pts, prof) {' in BT, True)
ck('battle.js：estimateOnRoad（按时间选下路点）', 'function estimateOnRoad(unit, road, from, tx, ty, prof) {' in BT, True)
ck('battle.js：planFastRoute 里按时间二选一（A 沿路 / B 换路）',
   ('const etaA =' in BT) and ('etaB = Infinity' in BT) and ('etaA <= etaB' in BT), True)
ck('battle.js：planFastRouteByGrid 用时间代价排序',
   'const stepT = legTime(unit, { x: cx, y: cy }, snap, prof);' in BT, True)
ck('battle.js：直线更快 ⇒ 返回 null 并写明原因',
   ("info.why = isFinite(tStraight)" in BT
    and "'沿公路绕太远⇒改直线'" in BT and "'附近没公路⇒改直线'" in BT), True)
ck('battle.js：R9.6.11 沿路 vs 直线的**倍率门限**（乘车 2.5 / 徒步 1.25）+ 换路上限 24',
   (('const FAST_HOP_MAX = 24;' in BT)
    and ('const FAST_ROAD_WORSE_RIDE = 2.5;' in BT)
    and ('const FAST_ROAD_WORSE_FOOT = 1.25;' in BT)
    and ('hopEta <= tStraight * fastRoadWorseRatio(prof)' in BT)), True)
ck('battle.js：矢量公路图**不再因为"目标离线远"切到道路格版**（长距离快速移动的根因）',
   ('if (!gm.roads || !gm.roads.length) {' in BT), True)
ck('battle.js：isStraightPathClearFor（普通移动按机动类型判地形）',
   'function isStraightPathClearFor(unit, x, y) {' in BT, True)
ck('battle.js：fmtEta', 'function fmtEta(sec) {' in BT, True)
ck('battle.js：实体速度对地形倍率留 0.10 下限（永不死冻）',
   'const ENTITY_MIN_TERRAIN_MUL = 0.10;' in BT, True)
ck('cmd.js：普通移动用 isStraightPathClearFor', 'isStraightPathClearFor(u0, p.x, p.y)' in CD, True)
ck('cmd.js：note 带预计用时', "' · 预计 ' + fmtEta(fi.eta)" in CD, True)
ck('dev-panel.js：显示规划档案（地形数值 × 单位数值）',
   ('planProfileLabel' in DP) and ('脚下地形' in DP), True)

print('== 7. R9.6.7：修"步兵（有车）进城区/树林被判不可通行" + "快速移动偷偷硬穿" ==')
ck('battle.js：车过不去这条腿 ⇒ 自动退回徒步档案（下车走）',
   ('if (!isFinite(tm)) return footProf;' in BT) and ('function unitFootProfile(unit) {' in BT), True)
ck('battle.js：都能过 ⇒ 谁快用谁',
   'return (tm <= tf) ? rideProf : footProf;' in BT, True)
ck('battle.js：两个规划器都把目标点传进档案（才会做"车/步"二选一）',
   BT.count('unitPlanProfile(unit, tx, ty)'), 2)
ck('battle.js：普通移动的体检也带目标点',
   'unitPlanProfile(unit, x, y)' in BT, True)
ck('battle.js：updateRideMode 遵守命令级身份（ord.planRide === false ⇒ 徒步）',
   ('liveOrd.planRide === false' in BT) and ("'命令规划=徒步（车走不过去）'" in BT), True)
ck('cmd.js：没有可通行路线 + 直线也不可通行 ⇒ **拒绝**（不许偷偷硬穿）',
   ("if (!okStraight) {" in CD) and ('附近没有可通行公路，直线方向也不可通行' in CD), True)
ck('cmd.js：把 planRide 写进命令（普通 + 快速两条路都写）',
   CD.count('p.planRide = ') >= 2, True)
# 数值：有车的步兵排（轮式 20m/s + 徒步 12m/s）点进城区 —— 轮式 ∞、徒步有限 ⇒ 该走徒步
t_rid_in_city = leg_time('wheeled', 20.0, (0, 0), (800, 0), lambda x, y: 'house')
t_foot_in_city = leg_time('foot', 12.0, (0, 0), (800, 0), lambda x, y: 'house')
ck('轮式进城区 ⇒ ∞（表里 house = 0）', t_rid_in_city, float('inf'))
ck('徒步进城区 ⇒ 有限（foot house = 1.00）⇒ 步兵应当能进', round(t_foot_in_city, 1), round(800 / 12.0, 1))
ck('徒步穿树林 ⇒ 有限（foot forest = 1.00）',
   math.isfinite(leg_time('foot', 12.0, (0, 0), (800, 0), lambda x, y: 'forest')), True)

print('')
print('%s' % ('全部通过 ✓' if fails == 0 else f'{fails} 项失败 ✗'))
sys.exit(0 if fails == 0 else 1)
