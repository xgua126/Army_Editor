# -*- coding: utf-8 -*-
# 车辆直线「死区」的离线测试（battle.js straightTerrainCost / navBlockTol 的同算法复刻）
# 背景：旧版是「蹭到一个不可通行子格就判直线不通」⇒「只擦到几个像素的城区」也会被判不通
#       ⇒ 车的方案整个作废 ⇒ 步兵凭空下车徒步（用户实测）。
# 死区【按格计】：采样步长本身 ≈ 一格（25m），按米定死区会永远不生效。
import io, sys, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CELL = 25
VEH_DEADZONE_CELLS = 1
BLOCKED_MUL = 0.05


class Nav:
    def __init__(self, gw, gh, mul):
        self.gw, self.gh, self.cell = gw, gh, CELL
        self.mul = mul
    def ok(self, k):
        return self.mul[k] > 0


def block_tol(mob):
    return 0 if mob in ('foot', 'air') else VEH_DEADZONE_CELLS


def straight_cost(nav, x1, y1, x2, y2, mob):
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    if L < 1: return 0.0
    steps = max(1, math.ceil(L / CELL)); seg = L / steps
    tol = block_tol(mob)
    cost = 0.0; prev = None; run = 0
    for i in range(steps + 1):
        t = i / steps
        gx = max(0, min(nav.gw - 1, int((x1 + dx * t) // CELL)))
        gy = max(0, min(nav.gh - 1, int((y1 + dy * t) // CELL)))
        k = gy * nav.gw + gx
        if not nav.ok(k):
            run += 1
            if run > tol: return math.inf
            cost += seg / BLOCKED_MUL
            prev = None
            continue
        run = 0
        m = nav.mul[k]
        if prev is not None: cost += seg / max(0.05, (m + prev) * 0.5)
        prev = m
    return cost


def build(gw, gh, blocked):
    mul = [1.0] * (gw * gh)
    for k in blocked: mul[k] = 0.0
    return Nav(gw, gh, mul)


fails = 0
def ck(name, got, must_be_finite):
    global fails
    ok = (math.isfinite(got) == must_be_finite)
    if not ok: fails += 1
    print(('  ok   ' if ok else '  FAIL ') + name + ': ' + ('有限' if math.isfinite(got) else '不通(inf)'))


print('== 直线死区（车辆允许夹 1 格，步兵不允许）==')
GW, GH = 20, 3
nav = build(GW, GH, [1 * GW + 10])
c1 = straight_cost(nav, 25, 37, 475, 37, 'wheeled')
ck('① 车辆：夹 1 格阻挡 ⇒ 算通（死区内）', c1, True)
c0 = straight_cost(build(GW, GH, []), 25, 37, 475, 37, 'wheeled')
print('     通畅代价 ' + str(round(c0, 1)) + ' ／ 夹 1 格代价 ' + str(round(c1, 1)) + '（贵 ' + str(round(c1 / c0, 2)) + ' 倍）')
if not (c1 > c0 * 1.3):
    fails += 1
    print('  FAIL ② 死区内代价没有明显变贵（能绕就不绕了）')
else:
    print('  ok   ② 死区内代价明显更贵 ⇒ 有更好路线时仍会绕')
nav2 = build(GW, GH, [1 * GW + 10, 1 * GW + 11])
ck('③ 车辆：连续夹 2 格 ⇒ 判不通', straight_cost(nav2, 25, 37, 475, 37, 'wheeled'), False)
ck('④ 步兵：夹 1 格 ⇒ 判不通（无死区）', straight_cost(nav, 25, 37, 475, 37, 'foot'), False)
ck('⑤ 完全通畅 ⇒ 有限', c0, True)
if not (430 < c0 < 470):
    fails += 1
    print('  FAIL ⑤ 通畅代价异常: ' + str(round(c0, 1)))
else:
    print('  ok   ⑤ 通畅代价 ≈ 长度（1.0 倍率）')
nav3 = build(GW, GH, [1 * GW + 0])
ck('⑥ 阻挡贴起点 ⇒ 仍算通', straight_cost(nav3, 25, 37, 475, 37, 'wheeled'), True)
nav4 = build(GW, GH, [1 * GW + 19])
ck('⑦ 阻挡贴终点 ⇒ 仍算通', straight_cost(nav4, 25, 37, 475, 37, 'wheeled'), True)
nav5 = build(GW, GH, [1 * GW + 8])
ck('⑧ 斜向擦过 1 格 ⇒ 仍算通', straight_cost(nav5, 25, 25, 400, 60, 'tracked'), True)
print('')
print('全部通过 ✓' if fails == 0 else str(fails) + ' 项失败 ✗')
sys.exit(0 if fails == 0 else 1)
