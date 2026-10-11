# -*- coding: utf-8 -*-
# ★ R7.5「道路预设动画 + 命令级承诺」离线镜像测试
# 用户规格（原话）：
#   ① "这些 AI 应该就像有一个不存在的玩家在操作他们，发出一个命令之后，在下一个命令没有到来之前就不会改变。"
#   ② "道路中线就是预埋的路径；上了马路就进入预设动画：车辆沿道路中间排成队列，步兵沿道路两侧排成两纵列。"
# 本测试镜像 battle.js / grid-maps.js 里的实现，断言：
#   A. 车道规格（车辆单列居中 20m / 步兵两列 ±(w/2−2m) 8m / 路宽<12m 退化为单列居中）
#   B. 队形落点几何（弧长 + 法向偏移；整列以单位中心为对称点）
#   C. 命令级承诺：一条命令内**零重算**（旧行为对照：每 3 秒重算）
import io, sys, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

LANE_VEH_GAP = 20.0      # 车辆车距（米）
LANE_FOOT_GAP = 8.0      # 步兵列内间距（米）
LANE_FOOT_MIN_W = 12.0   # 步兵两列所需最小路宽
LANE_SHOULDER = 2.0      # 离路肩余量
ROAD_DEFAULT_W = 10.0
NAV_CMD_DEST_DRIFT = 800.0

fails = 0
def ck(name, got, cond, note=''):
    global fails
    ok = bool(cond)
    if not ok: fails += 1
    print(('  ok   ' if ok else '  FAIL ') + name + ': ' + str(got) + ('  ' + note if note else ''))


# ===== A. 车道规格（镜像 grid-maps.js 的 laneSpecFor）=====
def lane_spec_for(cls, road_w):
    w = road_w if (isinstance(road_w, (int, float)) and road_w > 0) else ROAD_DEFAULT_W
    if cls == 'foot':
        if w < LANE_FOOT_MIN_W:
            return dict(lanes=1, off=0.0, gap=LANE_FOOT_GAP)
        return dict(lanes=2, off=max(0.0, w / 2 - LANE_SHOULDER), gap=LANE_FOOT_GAP)
    return dict(lanes=1, off=0.0, gap=LANE_VEH_GAP)

print('== A. 车道规格：谁走中间、谁走两侧 ==')
v = lane_spec_for('wheeled', 20.0)
ck('车辆：单列居中、车距 20m', v, v['lanes'] == 1 and v['off'] == 0 and v['gap'] == 20)
v2 = lane_spec_for('tracked', 60.0); v3 = lane_spec_for('halftrack', 4.0)
ck('履带 / 半履带 同车辆规格', (v2['lanes'], v2['gap'], v3['gap']), v2['lanes'] == 1 and v2['gap'] == 20 and v3['gap'] == 20)
f20 = lane_spec_for('foot', 20.0)
ck('步兵（路宽 20m）：两列、偏移 ±8m(=w/2−2)、列内 8m', f20,
   f20['lanes'] == 2 and abs(f20['off'] - 8.0) < 1e-9 and f20['gap'] == 8)
f12 = lane_spec_for('foot', 12.0); f11 = lane_spec_for('foot', 11.9)
ck('边界：路宽 12m 仍两列（偏移 4m）', f12, f12['lanes'] == 2 and abs(f12['off'] - 4.0) < 1e-9)
ck('路宽 < 12m ⇒ 退化为单列居中（居中走最安全）', f11, f11['lanes'] == 1 and f11['off'] == 0)
f4 = lane_spec_for('foot', 4.0)
ck('4m 小路也是单列居中（不会有人被挤出路面）', f4, f4['lanes'] == 1 and f4['off'] == 0)


# ===== B. 队形落点几何（镜像 polylineArc / lanePointAt / laneStationOf / laneSlotsFor）=====
def polyline_arc(pts):
    acc = [0.0]
    for i in range(1, len(pts)):
        acc.append(acc[i - 1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    return dict(acc=acc, total=acc[-1] if acc else 0.0)

def lane_point_at(pts, arc, s):
    sc = max(0.0, min(arc['total'], s))
    i = 1
    while i < len(arc['acc']) - 1 and arc['acc'][i] < sc:
        i += 1
    ax, ay = pts[i - 1]; bx, by = pts[i]
    seg = max(1e-6, arc['acc'][i] - arc['acc'][i - 1])
    t = (sc - arc['acc'][i - 1]) / seg
    ux, uy = (bx - ax) / seg, (by - ay) / seg
    return dict(x=ax + (bx - ax) * t, y=ay + (by - ay) * t, nx=-uy, ny=ux)

def lane_station_of(pts, arc, x, y):
    best, bd = 0.0, float('inf')
    for i in range(1, len(pts)):
        ax, ay = pts[i - 1]; bx, by = pts[i]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = ((x - ax) * dx + (y - ay) * dy) / L2 if L2 > 1e-6 else 0.0
        t = max(0.0, min(1.0, t))
        d = math.hypot(x - (ax + dx * t), y - (ay + dy * t))
        if d < bd:
            bd, best = d, arc['acc'][i - 1] + math.sqrt(L2) * t
    return dict(s=best, d=bd)

def lane_slots(pts, w, ux, uy, cls, n, mounted=False):
    """返回 [(目标点x, 目标点y)]，顺序与成员一致（镜像 laneSlotsFor 的排布规则）"""
    arc = polyline_arc(pts)
    st = lane_station_of(pts, arc, ux, uy)
    if st['d'] > w / 2 + 6:
        return None
    sp = lane_spec_for(cls, w)
    out = []
    if mounted:
        for k in range(n):
            p = lane_point_at(pts, arc, st['s'] + (k - (n - 1) / 2.0) * sp['gap'])
            out.append((p['x'], p['y']))
        return out
    per = 2 if sp['lanes'] == 2 else 1
    rows = max(1, math.ceil(n / per))
    for i in range(n):
        row = i // per
        lane = (-sp['off'] if i % 2 == 0 else sp['off']) if sp['lanes'] == 2 else 0.0
        p = lane_point_at(pts, arc, st['s'] + (row - (rows - 1) / 2.0) * sp['gap'])
        out.append((p['x'] + p['nx'] * lane, p['y'] + p['ny'] * lane))
    return out

MID = [(0.0, 0.0), (0.0, 1000.0)]     # 一条南北向直路的中线（法向 = x 方向）
print('== B. 步兵两列：8 个兵 → 左右各一列、列内 8m、整列以单位中心对称 ==')
slots = lane_slots(MID, 20.0, 0.0, 100.0, 'foot', 8)
side = [x for x, y in slots]
ys = sorted(set(round(y, 3) for x, y in slots))
ck('只有两种横向偏移（两列：−8 / +8）', sorted(set(round(s, 3) for s in side)),
   sorted(set(round(s, 3) for s in side)) == [-8.0, 8.0])
ck('每列偏移 = w/2−2 = 8m', abs(side[0]), abs(abs(side[0]) - 8.0) < 1e-9)
ck('4 排（8 人 / 2 列），排间距 8m', ys, len(ys) == 4 and all(abs(ys[i + 1] - ys[i] - 8.0) < 1e-9 for i in range(3)))
ck('整列以单位中心（y=100）为对称点', (ys[0], ys[-1]), abs((ys[0] + ys[-1]) / 2 - 100.0) < 1e-9)

print('== B2. 车辆一列居中：3 辆车 → 车距 20m、全部压在中线上 ==')
vs = lane_slots(MID, 20.0, 0.0, 100.0, 'wheeled', 3, mounted=True)
xs = sorted(set(round(x, 6) for x, y in vs)); vy = sorted(y for x, y in vs)
ck('全部在中线上（横向 0，车辆走道路中间）', xs, xs == [0.0])
ck('车距 20m', vy, len(vy) == 3 and abs(vy[1] - vy[0] - 20.0) < 1e-9 and abs(vy[2] - vy[1] - 20.0) < 1e-9)
ck('整列以单位中心对称', (vy[0], vy[-1]), abs((vy[0] + vy[-1]) / 2 - 100.0) < 1e-9)

print('== B3. 单列退化：路宽 10m 的步兵 → 全在中线上、间距 8m ==')
s1 = lane_slots(MID, 10.0, 0.0, 100.0, 'foot', 5)
ck('全部居中（0 偏移）', sorted(set(round(x, 6) for x, y in s1)), sorted(set(round(x, 6) for x, y in s1)) == [0.0])
ck('间距 8m', sorted(y for x, y in s1), abs(sorted(y for x, y in s1)[1] - sorted(y for x, y in s1)[0] - 8.0) < 1e-9)

print('== B4. 离路判定：中心离中线超过 半路宽+6m ⇒ 不再按车道排（回到普通走位）==')
ck('离中线 20m（半路宽 5+6=11）⇒ 不上车道', lane_slots(MID, 10.0, 20.0, 100.0, 'foot', 4), lane_slots(MID, 10.0, 20.0, 100.0, 'foot', 4) is None)



# ===== C. 命令级承诺：一条命令内零重算（对照：旧行为周期重算）=====
def sim_plans(seconds, dt=0.1, intent_change_at=None, on_lane=False, new=True):
    """镜像导航块的触发条件：
       new=True → 只有 [首次 / 命令变更 / 身份变更 / 受阻 / 目的地漂移>800m（非车道）]
       new=False→ 旧行为：每 3 秒周期重算（+ 每 2 秒的漂移重算）"""
    plans = 0; path = None; cmd_key = 'MOVE_TO|obj1|-'; dest = None
    k = 0
    while k * dt < seconds - 1e-9:
        t = k * dt
        unit_x = 10.0 * t                     # 单位 10m/s 前进 ⇒ 目的地是"前方 400m"的滚动胡萝卜
        goal_x = unit_x + 400.0
        key = 'MOVE_TO|obj1|-'
        if intent_change_at is not None and t >= intent_change_at:
            key = 'ATTACK|e9|-'
        if new:
            changed = (key != cmd_key)
            drift = abs(dest - goal_x) if dest is not None else float('inf')
            if path is None or changed or (not on_lane and drift > NAV_CMD_DEST_DRIFT):
                plans += 1; path = True; cmd_key = key; dest = goal_x
        else:
            if path is None or (t % 3.0) < dt or (t % 2.0) < dt:
                plans += 1; path = True; dest = goal_x
        k += 1
    return plans

print('== C. 60 秒（单位前进 600m，目的地在滑动）==')
old = sim_plans(60.0, new=False)
new = sim_plans(60.0, new=True)
print('   旧行为重算 ' + str(old) + ' 次 ／ 新行为重算 ' + str(new) + ' 次')
ck('旧行为被周期重算打成几十次', old, old >= 20)
ck('新行为一条命令内只规划 1 次（首次）', new, new == 1)

print('== C2. 命令变更 ⇒ 恰好多算一次 ==')
n2 = sim_plans(60.0, intent_change_at=30.0)
ck('意图变了（MOVE_TO → ATTACK）⇒ 重算 2 次', n2, n2 == 2)

print('== C3. 上了马路（车道激活）⇒ 连"目的地漂移"都不触发重算 ==')
n3 = sim_plans(300.0, on_lane=True)
n4 = sim_plans(300.0, on_lane=False)
print('   车道上 300 秒重算 ' + str(n3) + ' 次 ／ 不在车道上 ' + str(n4) + ' 次')
ck('车道上 300 秒只规划 1 次（沿中线一直走）', n3, n3 == 1)
ck('对照：不在车道上时 800m 漂移兜底会触发重算', n4, n4 >= 2)


# ===== D. 受阻申请有冷却（不会打成每帧重算）=====
def sim_stuck(seconds, dt=0.1, cooldown=3.0):
    plans = 1; last = 0.0; k = 0
    while k * dt < seconds - 1e-9:
        t = k * dt
        if t - last > cooldown:       # 卡墙检测每 0.5s 一次 → 申请重算（冷却 3s）
            plans += 1; last = t
        k += 1
    return plans

print('== D. 受阻 60 秒：申请重算的次数 ==')
st = sim_stuck(60.0)
print('   有 3 秒冷却 ' + str(st) + ' 次 ／ 无冷却（每帧）= ' + str(int(60 / 0.1)) + ' 次')
ck('受阻时也只是每 3 秒一次（≈21 次）', st, 18 <= st <= 24)
ck('远小于"每帧重算"的量级', int(60 / 0.1), int(60 / 0.1) >= st * 20)

print('')
print('全部通过 ✓' if fails == 0 else str(fails) + ' 项失败 ✗')
sys.exit(0 if fails == 0 else 1)
