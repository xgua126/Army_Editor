# -*- coding: utf-8 -*-
"""R9.6 镜像测试：**实体为准的移动**（battle.js: moveUnitEntity / 路点"过点"判定）

玩家定案："单位只能朝着朝向行走，但可以在转向的过程中移动"；并且
"抵达判定是周围一个圈 ⇒ 每段都往里切一点 ⇒ 整条路径越走越偏"。

这里把两条规则镜像成 Python，用"看得见差异"的用例守住行为：
  ① 只朝朝向前进 ⇒ 起始朝向正东、目标正东时，**横向偏差恒为 0**
  ② 90°/180° 转弯 ⇒ 边走边转、**不绕圈**、能到位（掉头是小半径弧）
  ③ 路点"**过点**"判定 ⇒ 折线被完整走完（对比旧的"40m 就 pop"：偏差明显更小）
"""
import math, sys

PASS = FAIL = 0
def ck(name, got, want):
    global PASS, FAIL
    ok = (got == want)
    if ok: PASS += 1
    else:  FAIL += 1
    print('  %s %s：%r（期望 %r）' % ('ok  ' if ok else 'FAIL', name, got, want))

DT = 1 / 60.0
def ang_diff(a, b):
    d = a - b
    while d > math.pi: d -= math.pi * 2
    while d < -math.pi: d += math.pi * 2
    return d

def nav_turn(cur, want, max_step):
    d = ang_diff(want, cur)
    if abs(d) <= max_step: return want
    return cur + (max_step if d > 0 else -max_step)

# ---------- battle.js：unitArriveRadius 的镜像（★ R9.6.4） ----------
# 抵达半径 = 单位占地（编制 footprint ×0.4，带车 ×1.1，夹在 18~45m）
# 旧版用"士兵铺开半径 ×1.1" ⇒ 240 人的排 = 88×1.1 ≈ 97m（玩家："停在 97m 外"）
ARRIVE_R_MIN, ARRIVE_R_MAX = 18.0, 45.0
FOOTPRINT = {'platoon': 100, 'section': 80, 'squad': 50, 'team': 25, 'individual': 10}
def unit_arrive_radius(echelon, has_vehicles=False):
    fp = FOOTPRINT.get(echelon, 100)
    r = fp * 0.4 * (1.1 if has_vehicles else 1.0)
    return max(ARRIVE_R_MIN, min(ARRIVE_R_MAX, r))

# ---------- battle.js：moveUnitEntity 的镜像 ----------
def move_entity(x, y, facing, tx, ty, speed, turn, arrive_r, is_waypoint=False):
    """返回 (x, y, facing, stance, step)；is_waypoint=True ⇒ 中间路点：只转向、绝不停车
       arrive_r = 抵达半径（= unitArriveRadius(unit)，见 battle.js）"""
    stopR = max(ARRIVE_R_MIN, min(ARRIVE_R_MAX, arrive_r))
    dx, dy = tx - x, ty - y
    d = math.hypot(dx, dy)
    fx, fy = math.cos(facing), math.sin(facing)
    if (not is_waypoint) and (d <= stopR or (d < stopR * 2.2 and dx * fx + dy * fy < 0)):
        return x, y, facing, 'static', 0.0                    # 到位 / 已越过目标
    want = math.atan2(dy, dx)
    if abs(ang_diff(want, facing)) > 1.75:                    # 大角度：转向速率 ×1.8
        facing = nav_turn(facing, want, turn * 1.8 * DT)
    else:
        facing = nav_turn(facing, want, turn * DT)
    fx, fy = math.cos(facing), math.sin(facing)
    off = abs(ang_diff(want, facing))
    spd = speed
    if off > 1.2: spd *= 0.35                                 # 目标在侧后方 ⇒ 减速掉头
    elif off > 0.6: spd *= 0.7
    step = min(spd * DT, d)
    return x + fx * step, y + fy * step, facing, 'moving', step

def walk_route(points, pop_mode, speed=10.0, turn=1.1, arrive_r=25.0, dt=DT):
    """points = [(x,y)...]；pop_mode = 'passed'（新）或 'radius'（旧 40m）
       返回 (path, max_dev_to_polyline, arrived, stopped_at)"""
    x, y = points[0][0], points[0][1]
    f = math.atan2(points[1][1] - y, points[1][0] - x)      # 首次出发直接对齐
    wp_i = 1
    leg_from = (x, y)
    path = [(x, y)]
    stopR = max(ARRIVE_R_MIN, min(ARRIVE_R_MAX, arrive_r))
    arrived = False
    guard = 0
    while guard < 200000:
        guard += 1
        if wp_i >= len(points):
            arrived = True
            break
        tx, ty = points[wp_i]
        is_last = (wp_i == len(points) - 1)
        x2, y2, f2, stance, _ = move_entity(x, y, f, tx, ty, speed, turn, arrive_r,
                                            is_waypoint=not is_last)
        x, y, f = x2, y2, f2
        path.append((x, y))
        if stance == 'static':
            arrived = is_last                                   # 在最后一个路点停下 = 到位
            break
        d = math.hypot(tx - x, ty - y)
        if pop_mode == 'radius':
            if d < 40:
                leg_from = (tx, ty); wp_i += 1
        else:
            ldx, ldy = tx - leg_from[0], ty - leg_from[1]
            ll = math.hypot(ldx, ldy)
            passed = (ll > 1) and (((x - tx) * ldx + (y - ty) * ldy) / ll > 0)
            if passed or d <= max(14.0, arrive_r * 0.5):
                leg_from = (tx, ty); wp_i += 1
    # 最大"偏离路线"量：每个路径点到整条折线（最近段）的距离
    dev = 0.0
    for px, py in path:
        best = 1e18
        for i in range(len(points) - 1):
            ax, ay = points[i]; bx, by = points[i + 1]
            vx, vy = bx - ax, by - ay
            L2 = vx * vx + vy * vy
            tt = 0 if L2 == 0 else max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / L2))
            best = min(best, math.hypot(px - (ax + vx * tt), py - (ay + vy * tt)))
        dev = max(dev, best)
    return path, dev, arrived, (x, y)


# ============================================================
print('== 1. 只朝朝向前进：起始朝向正东 + 目标正东 ⇒ 横向偏差**恒为 0** ==')
x, y, f = 0.0, 0.0, 0.0
maxy = 0.0
steps = 0
while steps < 60000:
    steps += 1
    x, y, f, stance, _ = move_entity(x, y, f, 2000.0, 0.0, 10.0, 1.1, 25.0)
    maxy = max(maxy, abs(y))
    if stance == 'static': break
ck('横向偏差（y）恒为 0', round(maxy, 6), 0.0)
ck('到位（x ≈ 2000 − 停止半径）', 1900 <= x <= 2000, True)
ck('到位后 stance = static（会停）', stance, 'static')

print('== 2. 90° 转弯：边走边转（弧线） ⇒ 不绕圈、能到位 ==')
x, y, f = 0.0, 0.0, 0.0                                    # 朝东，目标正北
maxx = 0.0
for i in range(60000):
    x, y, f, stance, _ = move_entity(x, y, f, 0.0, 1500.0, 10.0, 1.1, 25.0)
    maxx = max(maxx, x)
    if stance == 'static': break
ck('能到位（y 接近 1500）', y >= 1420, True)
ck('转弯外扩 ≤ 120m（是弧线，不是大回环）', maxx <= 120, True)
ck('到位后没在目标附近绕圈（stance=static）', stance, 'static')

print('== 3. 180° 掉头：目标在正后方 ⇒ 小半径弧转向，不兜大圈 ==')
x, y, f = 0.0, 0.0, 0.0                                    # 朝东，目标正西（正后方）
maxy = 0.0
for i in range(60000):
    x, y, f, stance, _ = move_entity(x, y, f, -1200.0, 0.0, 10.0, 1.1, 25.0)
    maxy = max(maxy, abs(y))
    if stance == 'static': break
ck('真的掉头过去了（x ≤ −1100）', x <= -1100, True)
ck('掉头外扩 ≤ 60m（速度×0.35 + 转向×1.8 ⇒ 小半径）', maxy <= 60, True)

print('== 4. 折线：新"过点"判定 vs 旧"40m 就 pop"（玩家图上那个"圈"） ==')
pts = [(0.0, 0.0), (1000.0, 0.0), (1000.0, 900.0), (1700.0, 900.0)]
p_new, dev_new, ok_new, end_new = walk_route(pts, 'passed')
p_old, dev_old, ok_old, end_old = walk_route(pts, 'radius')
print('     过点判定：最大偏差 %.1fm · 路点全部走完=%s' % (dev_new, ok_new))
print('     40m 判定：最大偏差 %.1fm · 路点全部走完=%s' % (dev_old, ok_old))
ck('新规则：折线最大偏差 ≤ 25m（不切角）', dev_new <= 25, True)
ck('旧规则明显更偏（≥ 1.5× 新规则）', dev_old >= dev_new * 1.5, True)
ck('新规则：走到最后一个路点', ok_new, True)

print('== 5. 防绕圈：目标在身后很近 ⇒ 立刻当"已到达"停下 ==')
x, y, f, stance, _ = move_entity(0.0, 0.0, 0.0, -30.0, 0.0, 10.0, 1.1, 25.0)
ck('目标在正后方 30m（< 2.2×停止半径）⇒ 立即 static', stance, 'static')

print('== 6. ★ R9.6.4：抵达半径 = **单位占地**（不再用"士兵铺开半径"） ==')
ck('排（footprint 100）⇒ 40m（旧版 88×1.1 ≈ 97m ⇒ 玩家实测"停在 97m"）', unit_arrive_radius('platoon'), 40.0)
ck('分队（80）⇒ 32m', unit_arrive_radius('section'), 32.0)
ck('班（50）⇒ 20m', unit_arrive_radius('squad'), 20.0)
ck('火力组（25）⇒ 下限 18m', unit_arrive_radius('team'), 18.0)
ck('带车的排 ⇒ 44m（40×1.1）', unit_arrive_radius('platoon', True), 44.0)
ck('任何编制都不超过上限 45m', unit_arrive_radius('army') <= 45.0, True)

x, y, f = 0.0, 0.0, 0.0
for i in range(60000):
    x, y, f, stance, _ = move_entity(x, y, f, 2000.0, 0.0, 10.0, 1.1, unit_arrive_radius('platoon'))
    if stance == 'static': break
print('     排走到 2000m 的目标：停在 x=%.0f（旧版会停在 ~1903）' % x)
ck('停在 1960~2005（也就是"走到你点的那个点"）', 1960 <= x <= 2005, True)

print()
if FAIL == 0:
    print('全部通过 ✓')
else:
    print('%d 项失败 ✗' % FAIL)
sys.exit(1 if FAIL else 0)
