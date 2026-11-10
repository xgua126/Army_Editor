# -*- coding: utf-8 -*-
"""R9.6.5 镜像测试：**快速移动 = 投影点起步 + 路口接力**（battle.js: planFastRoute 矢量版）

玩家实测（截图：黄线=实际、绿线=期望）：
  ① **直道中段的单位先"回头"**：旧版路线从"最近的那个顶点"起步，而一条直道只有两个顶点
     ⇒ 单位先开回端点再沿路走。现在从**投影点（seg+t）**起步，只补"行进方向上的顶点"。
  ② **到路口不能换路**：旧版只沿一条路走到"离目标最近的点"就下路，然后一条长直线横穿。
     现在**接力**：沿当前路开到"离目标那条路最近的点"（≈路口）→ 换路继续（≤ FAST_HOP_MAX 次）
     → 只有"目标离本路的最近点 ≤ FAST_LEAVE_MAX"才下路收尾。

本测试把新旧两版都镜像出来，用同一组用例对比"路线离路网的最大偏差 / 路线长度"。
"""
import sys, io, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

fails = 0
def ck(name, got, exp):
    global fails
    ok = (got == exp)
    if not ok: fails += 1
    print(("  ok   " if ok else "  FAIL ") + f"{name}: {got}（期望 {exp}）")

# ---------- ★ 与 battle.js R9.6.5 同算法 ----------
FAST_LEAVE_MAX = 300
FAST_JUNCTION_R = 180
FAST_HOP_MAX = 24        # ★ R9.6.11：6 → 24（长距离要跨更多路口；6 跳会把长途半路截断）

def project_on_seg(x, y, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]
    L2 = vx * vx + vy * vy
    t = ((x - a[0]) * vx + (y - a[1]) * vy) / L2 if L2 > 0 else 0.0
    t = max(0.0, min(1.0, t))
    return (a[0] + vx * t, a[1] + vy * t, t)

def nearest_on_road(pts, x, y):
    """→ (seg, t, x, y, dist) | None"""
    best, bd = None, 1e18
    for i in range(len(pts) - 1):
        px, py, t = project_on_seg(x, y, pts[i], pts[i + 1])
        d = math.hypot(px - x, py - y)
        if d < bd: bd, best = d, (i, t, px, py, d)
    return best

def nearest_road_point(roads, x, y):
    """全地图最近的公路投影 → (road, seg, t, x, y, dist) | None"""
    best, bd = None, 1e18
    for r in roads:
        p = nearest_on_road(r['pts'], x, y)
        if p and p[4] < bd: bd, best = p[4], (r, p[0], p[1], p[2], p[3], p[4])
    return best

def seg_seg_closest(a, b, c, d):
    ux, uy = b[0] - a[0], b[1] - a[1]
    vx, vy = d[0] - c[0], d[1] - c[1]
    wx, wy = a[0] - c[0], a[1] - c[1]
    A = ux * ux + uy * uy; B = ux * vx + uy * vy; C = vx * vx + vy * vy
    D = ux * wx + uy * wy; E = vx * wx + vy * wy
    den = A * C - B * B
    if den < 1e-9:                     # ★ 平行/共线：把 r2 端点投到 r1 再投回来取最近
        best, bd = None, 1e18
        for v in (c, d):
            px, py, s = project_on_seg(v[0], v[1], a, b)
            qx, qy, t = project_on_seg(px, py, c, d)
            dd = math.hypot(px - qx, py - qy)
            if dd < bd: bd, best = dd, (s, t, px, py, dd)
        return best if best else (0.0, 0.0, a[0], a[1], math.hypot(a[0] - c[0], a[1] - c[1]))
    s = (B * E - C * D) / den; t = (A * E - B * D) / den
    s = max(0.0, min(1.0, s)); t = max(0.0, min(1.0, t))
    px, py = a[0] + ux * s, a[1] + uy * s
    qx, qy = c[0] + vx * t, c[1] + vy * t
    return (s, t, px, py, math.hypot(px - qx, py - qy))

def nearest_pt_road_to_road(p1, p2):
    best, bd = None, 1e18
    for i in range(len(p1) - 1):
        for j in range(len(p2) - 1):
            s, t, x, y, d = seg_seg_closest(p1[i], p1[i + 1], p2[j], p2[j + 1])
            if d < bd: bd, best = d, (i, s, x, y, d)
    return best

def follow_road(pts, frm, to, route):
    """frm/to = (seg,t,x,y,dist)：只补**行进方向上的顶点**（同段 ⇒ 一个都不加）"""
    if not frm or not to or len(pts) < 2: return
    fs, ts = int(frm[0]), int(to[0])
    if ts > fs:
        for i in range(fs + 1, ts + 1): route.append(pts[i])
    elif ts < fs:
        for i in range(fs, ts, -1): route.append(pts[i])

def nearest_road_point_except(roads, x, y, skip, maxR):
    best, bd = None, maxR
    for r in roads:
        if r is skip: continue
        p = nearest_on_road(r['pts'], x, y)
        if p and p[4] < bd: bd, best = p[4], (r, p[0], p[1], p[2], p[3], p[4])
    return best

# ---------- 新版（R9.6.5）----------
def plan_fast_route(roads, sx, sy, tx, ty):
    gTgt = nearest_road_point(roads, tx, ty)
    if not gTgt: return None
    route = []; visited = set()
    cur = (sx, sy); forced = None
    for _hop in range(FAST_HOP_MAX):
        pin = None; R = None
        if forced is not None and id(forced) not in visited:
            p = nearest_on_road(forced['pts'], cur[0], cur[1])
            if p and p[4] <= FAST_JUNCTION_R * 2: R, pin = forced, p
            forced = None
        if R is None:
            hit = nearest_road_point(roads, cur[0], cur[1])
            if not hit: break
            R = hit[0]; pin = (hit[1], hit[2], hit[3], hit[4], hit[5])
        if pin[4] > 40: route.append((pin[2], pin[3]))          # 接入公路（投影点）
        if id(R) in visited: break
        visited.add(id(R))
        q = nearest_on_road(R['pts'], tx, ty) or pin
        if q[4] <= FAST_LEAVE_MAX or gTgt[0] is R:              # 目标就在本路附近 / 目标最近的路就是本路
            follow_road(R['pts'], pin, q, route); route.append((q[2], q[3])); break
        jr = nearest_pt_road_to_road(R['pts'], gTgt[0]['pts']) or q
        follow_road(R['pts'], pin, jr, route); route.append((jr[2], jr[3]))
        alt = nearest_road_point_except(roads, jr[2], jr[3], R, FAST_JUNCTION_R)
        if not alt: break
        cur = (alt[3], alt[4]); forced = alt[0]
        if alt[5] > 40: route.append((alt[3], alt[4]))
    route.append((tx, ty))
    return route if len(route) > 1 else None

# ---------- 旧版（R9.6.3 之前：顶点起步 + 单路 → 直线）—— 只为对照 ----------
def plan_fast_route_old(roads, sx, sy, tx, ty):
    pin = nearest_road_point(roads, sx, sy)
    if not pin: return None
    route = []
    if pin[5] > 40: route.append((pin[3], pin[4]))
    pts = pin[0]['pts']
    pout = nearest_road_point(roads, tx, ty)
    if pout and pout[0] is pin[0] and len(pts) > 1:
        i0 = pin[1] if pin[2] < 0.5 else pin[1] + 1
        i1 = pout[1] if pout[2] < 0.5 else pout[1] + 1
        i0 = max(0, min(len(pts) - 1, i0)); i1 = max(0, min(len(pts) - 1, i1))
        if i1 > i0: route += pts[i0 + 1:i1 + 1]
        else: route += pts[i0:i1 - 1 if i1 > 0 else None:-1]
        route.append((pout[3], pout[4]))
    else:
        i0 = pin[1] if pin[2] < 0.5 else pin[1] + 1
        pick, pd = None, 1e18
        for i, p in enumerate(pts):
            d = math.hypot(p[0] - tx, p[1] - ty)
            if d < pd: pd, pick = d, i
        if pick is not None:
            if pick > i0: route += pts[i0 + 1:pick + 1]
            else: route += pts[i0:pick - 1 if pick > 0 else None:-1]
    route.append((tx, ty))
    return route

# ---------- 度量 ----------
def poly_len(route):
    return sum(math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1])
               for i in range(len(route) - 1))

def max_dev_from_roads(route, roads, step=20.0):
    """把路线按 step 采样，返回"离路网最远的距离"（= 横穿/切角的量化指标）"""
    worst = 0.0
    for i in range(len(route) - 1):
        a, b = route[i], route[i + 1]
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(math.ceil(seg / step)))
        for k in range(n + 1):
            t = k / n
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            best = min(nearest_on_road(r['pts'], x, y)[4] for r in roads)
            worst = max(worst, best)
    return worst

def max_x(route): return max(p[0] for p in route)

R1 = [{'id': 'A', 'pts': [(0, 0), (10000, 0)]}]
R2 = [{'id': 'A', 'pts': [(0, 0), (3000, 0)]},
      {'id': 'B', 'pts': [(2800, 0), (2800, 3000)]}]

print('== 1. 直道中段出发：**不许先回头够端点**（旧版会先开到 10km 的端点再折返）==')
def drive_len(route, sx, sy):
    """真实行驶距离 = 出发点到第一个路点 + 路线长度"""
    return math.hypot(route[0][0] - sx, route[0][1] - sy) + poly_len(route)
new1 = plan_fast_route(R1, 5000, 30, 8000, 100)
old1 = plan_fast_route_old(R1, 5000, 30, 8000, 100)
print('     新：路线 %s · 行驶 %.0fm' % (new1, drive_len(new1, 5000, 30)))
print('     旧：路线 %s · 行驶 %.0fm' % (old1, drive_len(old1, 5000, 30)))
ck('新路线最远只到目标附近（不越到 10km 端点）', max_x(new1) <= 8100, True)
ck('旧路线确实跑到了 10km 端点（= 玩家看到的"先回头"）', max_x(old1) >= 10000, True)
ck('新路线比旧路线少开 ≥ 3500m', drive_len(old1, 5000, 30) - drive_len(new1, 5000, 30) >= 3500, True)

print('== 2. 路口接力：沿 A 到交点 → 换 B → 沿 B 走（旧版直接长直线横穿）==')
new2 = plan_fast_route(R2, 100, 0, 2800, 2800)
old2 = plan_fast_route_old(R2, 100, 0, 2800, 2800)
dev_new2 = max_dev_from_roads(new2, R2)
dev_old2 = max_dev_from_roads(old2, R2)
print('     新：路线 %s · 离路网最大偏差 %.0fm' % (new2, dev_new2))
print('     旧：路线 %s · 离路网最大偏差 %.0fm' % (old2, dev_old2))
ck('新路线全程贴路（离路网 ≤ 60m）', dev_new2 <= 60, True)
ck('旧路线横穿 ~200m（= 截图里的黄线切角）', dev_old2 > 150, True)
ck('新路线里出现了"沿 B 走"的落地路点', (2800, 2800) in new2, True)
ck('新路线在路口留下一个"换路点" (2800,0)', (2800, 0) in new2, True)

print('== 3. 三段接力：A → B → C，全程贴路、有界、不死循环 ==')
R3 = [{'id': 'A', 'pts': [(0, 0), (2000, 0)]},
      {'id': 'B', 'pts': [(1900, 0), (1900, 2000)]},
      {'id': 'C', 'pts': [(1800, 2000), (5000, 2000)]}]
new3 = plan_fast_route(R3, 100, 0, 4800, 2000)
print('     路线 %s' % (new3,))
ck('走完 A → B → C（含 B/C 上的换路点）', ((1900, 2000) in new3) and ((4800, 2000) in new3), True)
ck('全程贴路（离路网 ≤ 60m）', max_dev_from_roads(new3, R3) <= 60, True)
ck('最后一段直线 ≤ 350m（目标是路边的点 ⇒ 几乎为 0）',
   math.hypot(new3[-1][0] - new3[-2][0], new3[-1][1] - new3[-2][1]) <= 350, True)
ck('路点数有界（≤ 24，换路上限 6 次兜底）', len(new3) <= 24, True)
ck('总长有界（≤ 直线距离×2.5 + 500m）', poly_len(new3) <= math.hypot(4700, 2000) * 2.5 + 500, True)

print('== 4. 目标离线 > FAST_LEAVE_MAX ⇒ 一定以"直线收尾"结束（保底不变）==')
R4 = [{'id': 'A', 'pts': [(0, 0), (1000, 0)]}]
new4 = plan_fast_route(R4, 500, 0, 500, 3000)
print('     路线 %s' % (new4,))
ck('末尾就是目标点', new4[-1], (500, 3000))
ck('离开公路后是直线（上一点在 A 上）', abs(new4[-2][1]) < 1, True)

print('')
print('%s' % ('全部通过 ✓' if fails == 0 else f'{fails} 项失败 ✗'))
sys.exit(0 if fails == 0 else 1)
