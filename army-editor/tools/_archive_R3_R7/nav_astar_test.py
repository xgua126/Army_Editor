# -*- coding: utf-8 -*-
"""A* 与 battle.js 的 navAStar / straightTerrainCost 同算法复刻
   验证 ① 公路绕行能被找到（旧版"Dijkstra 圆盘 + 1.5 万格上限"找不到）
        ② A* 探索量远小于圆盘（这就是不卡死的原因）"""
import sys, io, math, heapq, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CELL = 25
FASTEST = 1.3
H_EPS = 1.001

class Nav:
    def __init__(self, gw, gh, mul):
        self.gw, self.gh, self.cell = gw, gh, CELL
        self.mul = mul
    def ok(self, k): return self.mul[k] > 0

def straight_cost(nav, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    if L < 1: return 0.0
    steps = max(1, math.ceil(L / CELL)); seg = L / steps
    cost = 0.0; prev = None
    for i in range(steps + 1):
        t = i / steps
        gx = max(0, min(nav.gw - 1, int((x1 + dx * t) // CELL)))
        gy = max(0, min(nav.gh - 1, int((y1 + dy * t) // CELL)))
        k = gy * nav.gw + gx
        if not nav.ok(k): return math.inf
        m = nav.mul[k]
        if prev is not None: cost += seg / max(0.05, (m + prev) * 0.5)
        prev = m
    return cost

def astar(nav, ux, uy, tx, ty, limit=math.inf, max_cells=60000, dedupe=True):
    """dedupe=False → 复现旧版（不去重，陈旧条目也占一次"结算"，大图必撞上限）。
       dedupe=True  → 与 grid-maps.js 新版一致（闭集去重 + 上限按格数自适应）。"""
    gw, gh, cell = nav.gw, nav.gh, CELL
    ci = lambda v, hi: max(0, min(hi, v))
    gx, gy = ci(int(tx // cell), gw - 1), ci(int(ty // cell), gh - 1)
    sx, sy = ci(int(ux // cell), gw - 1), ci(int(uy // cell), gh - 1)
    if not nav.ok(gy * gw + gx):
        best, bd = None, math.inf
        for dy in range(-6, 7):
            for dx in range(-6, 7):
                nx, ny = gx + dx, gy + dy
                if not (0 <= nx < gw and 0 <= ny < gh): continue
                if not nav.ok(ny * gw + nx): continue
                d = dx * dx + dy * dy
                if d < bd: bd, best = d, ny * gw + nx
        if best is None: return None, 0
        gx, gy = best % gw, (best - gx) // gw
    start, goal = sy * gw + sx, gy * gw + gx
    if not nav.ok(start): return None, 0
    if start == goal: return 0.0, 1
    g = [math.inf] * (gw * gh)
    heur = lambda i: math.hypot(((i % gw) - gx) * cell, (((i - i % gw) // gw) - gy) * cell) / FASTEST
    g[start] = 0.0
    h = [(heur(start) * H_EPS, start)]
    SQ2 = 1.41421356
    settled = 0
    closed = bytearray(gw * gh)                     # ★ 出堆去重（与 grid-maps.js 新版一致）
    cap = (max(max_cells, gw * gh) if dedupe else max_cells)
    while h:
        f, i = heapq.heappop(h)
        if dedupe:
            if closed[i]: continue                  # 陈旧条目直接丢
            closed[i] = 1
        settled += 1
        if settled > cap: return None, settled
        if i == goal: return g[goal], settled
        if g[i] + heur(i) >= limit: continue      # ★ 代价预算剪枝：赢不了 limit 就不展开
        cx = i % gw
        cy = (i - cx) // gw
        g0 = g[i]
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if not dx and not dy: continue
                nx, ny = cx + dx, cy + dy
                if not (0 <= nx < gw and 0 <= ny < gh): continue
                k = ny * gw + nx
                if not nav.ok(k): continue
                seg = (SQ2 if (dx and dy) else 1.0) * cell
                spd = max(0.05, (nav.mul[i] + nav.mul[k]) * 0.5)
                ng = g0 + seg / spd
                if ng < g[k]:
                    g[k] = ng
                    heapq.heappush(h, (ng + heur(k) * H_EPS, k))
    return None, settled

def dijkstra_disc(nav, ux, uy, tx, ty, bound, cap):
    """旧版：从目标扩圆盘 + 格数上限（返回 start 代价、结算格数）"""
    gw, gh = nav.gw, nav.gh
    ci = lambda v, hi: max(0, min(hi, v))
    gx, gy = ci(int(tx // CELL), gw - 1), ci(int(ty // CELL), gh - 1)
    sx, sy = ci(int(ux // CELL), gw - 1), ci(int(uy // CELL), gh - 1)
    dist = [math.inf] * (gw * gh)
    start = gy * gw + gx
    dist[start] = 0.0
    h = [(0.0, start)]; settled = 0
    SQ2 = 1.41421356
    while h:
        c, i = heapq.heappop(h)
        if c > dist[i]: continue
        if c > bound: break
        settled += 1
        if settled > cap: break
        cx = i % gw
        cy = (i - cx) // gw
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if not dx and not dy: continue
                nx, ny = cx + dx, cy + dy
                if not (0 <= nx < gw and 0 <= ny < gh): continue
                k = ny * gw + nx
                if not nav.ok(k): continue
                seg = (SQ2 if (dx and dy) else 1.0) * CELL
                spd = max(0.05, (nav.mul[i] + nav.mul[k]) * 0.5)
                nc = c + seg / spd
                if nc < dist[k]: dist[k] = nc; heapq.heappush(h, (nc, k))
    return dist[sy * gw + sx], settled

# ===== 用你的巴斯托涅场景建模（粗格 50m）=====
# 城区：x 20..80 格（1~4km）、y 30..70 格（1.5~3.5km）—— 3km 宽 × 2km 深，正好横在 A、B 之间
# 公路：北侧 y 24..28、南侧 y 72..76 两条横路 + 东西各一条竖路连通
OPEN, ROAD, CITY = 1.0, 1.3, 0.5
GW = GH = 400          # 400×25m = 10km × 10km（本次粗格 50→25，格数 ×4）

def build(gw, gh, paint):
    mul = [OPEN] * (gw * gh)
    for (x0, y0, x1, y1, v) in paint:
        for gy in range(y0, y1):
            for gx in range(x0, x1):
                if 0 <= gx < gw and 0 <= gy < gh: mul[gy * gw + gx] = v
    return Nav(gw, gh, mul)

paint = [(40, 60, 160, 140, CITY),
         (20, 48, 180, 56, ROAD), (20, 144, 180, 152, ROAD),
         (20, 48, 28, 152, ROAD), (172, 48, 180, 152, ROAD)]
nav = build(GW, GH, paint)

fails = 0
def ck(name, got, exp):
    global fails
    ok = (got == exp)
    if not ok: fails += 1
    print(("  ok   " if ok else "  FAIL ") + f"{name}: {got}（期望 {exp}）")

print("== A→B：4km 直线横穿 3km 城区（正是你说的场景）==")
ax, ay, bx, by = 400, 2500, 4500, 2500
GAIN = 0.02
sc = straight_cost(nav, ax, ay, bx, by)
t0 = time.perf_counter(); cost, settled = astar(nav, ax, ay, bx, by, sc * (1 - GAIN)); ms = (time.perf_counter() - t0) * 1000
print(f"   直线代价 {sc:.0f} ／ A* 路径代价 {cost if cost else 0:.0f} ／ A* 结算 {settled} 格 / {ms:.1f}ms")
ck("直线通（但慢）", math.isfinite(sc), True)
ck("A* 找到路径", cost is not None, True)
ck("路径明显更省（>20%）", cost is not None and cost < sc * 0.8, True)
ck("探索量 < 40000（25m 粗格下应约 3 万格）", settled < 40000, True)

print("== C→D：较短的一趟（烟雾测试）==")
sc2 = straight_cost(nav, 900, 2500, 2600, 2500)
c2, s2 = astar(nav, 900, 2500, 2600, 2500, sc2 * (1 - GAIN))
print(f"   直线代价 {sc2:.0f} ／ A* 结果 {c2 if c2 else 'None'} ／ 结算 {s2} 格")
ck("给出结果且不劣于直线", (c2 is None) or (c2 <= sc2 * 1.001), True)

print("== 开阔地（7km 对角）：不应绕路、探索量应极小 ==")
def line_avg_mul(nav, x1, y1, x2, y2):
    # 与 battle.js straightAvgMul 同算法
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    if L < 1: return 1.0
    steps = max(1, math.ceil(L / CELL)); s = 0.0
    for i in range(steps + 1):
        tt = i / steps
        gx = max(0, min(nav.gw - 1, int((x1 + dx * tt) // CELL)))
        gy = max(0, min(nav.gh - 1, int((y1 + dy * tt) // CELL)))
        s += nav.mul[gy * nav.gw + gx]
    return s / (steps + 1)

BAND_CELLS, STRIDE_MIN, REF_CELLS = 40, 2, 120

def near_max_mul(nav, x1, y1, x2, y2):
    # 与 battle.js navNearMaxMul 同算法：直线两侧 ±BAND_CELLS 格走廊里的最快地形倍率
    gw, gh = nav.gw, nav.gh
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    if L2 < 1: return 1.0
    band = BAND_CELLS * CELL
    stride = max(STRIDE_MIN, int(math.ceil((math.hypot(dx, dy) / CELL) / REF_CELLS)))
    minX = max(0, int((min(x1, x2) - band) // CELL)); maxX = min(gw - 1, int((max(x1, x2) + band) // CELL))
    minY = max(0, int((min(y1, y2) - band) // CELL)); maxY = min(gh - 1, int((max(y1, y2) + band) // CELL))
    best = -1.0
    for gy in range(minY, maxY + 1, stride):
        for gx in range(minX, maxX + 1, stride):
            px = (gx + 0.5) * CELL - x1; py = (gy + 0.5) * CELL - y1
            tt = (px * dx + py * dy) / L2
            tt = 0.0 if tt < 0 else (1.0 if tt > 1 else tt)
            qx = px - dx * tt; qy = py - dy * tt
            if qx * qx + qy * qy > band * band: continue
            m = nav.mul[gy * gw + gx]
            if m > best: best = m
    return 1.0 if best < 0 else best

# ★ 廉价跳过（本次新增）：走廊内没有明显更快的地形 ⇒ 绕行不可能赢 ⇒ 一格都不搜
nav2 = build(GW, GH, [])
sc3 = straight_cost(nav2, 500, 500, 7500, 7500)
line2, near2 = line_avg_mul(nav2, 500, 500, 7500, 7500), near_max_mul(nav2, 500, 500, 7500, 7500)
skip2 = (near2 <= line2 * 1.02)
c3, s3 = (None, 0) if skip2 else astar(nav2, 500, 500, 7500, 7500, sc3 * (1 - GAIN))
print(f"   开阔地：直线平均倍率 {line2:.2f} ／ 走廊最快 {near2:.2f} ⇒ {'跳过搜索' if skip2 else '需要搜索'}")
print(f"   直线代价 {sc3:.0f} ／ A* 结果 {c3 if c3 else 'None（走直线）'} ／ 结算 {s3} 格")
ck("开阔地廉价跳过生效（0 格，不再把整张图搜一遍）", s3, 0)
nav3 = build(GW, GH, [(40, 60, 160, 140, 0.5)])
line3, near3 = line_avg_mul(nav3, 400, 2500, 4500, 2500), near_max_mul(nav3, 400, 2500, 4500, 2500)
print(f"   对照（城区+平地）：直线平均 {line3:.2f} ／ 走廊最快 {near3:.2f}")
ck("城区不被跳过（走廊里有更快地形，值得搜）", near3 > line3 * 1.02, True)

print("== 车辆：城区视为不可通行（0.5 < 0.7）==")
veh = build(GW, GH, [(40, 60, 160, 140, 0.0),      # 城区 → 车辆不可通行（坐标随粗格 25m ×2）
                     (20, 48, 180, 56, ROAD), (20, 144, 180, 152, ROAD),
                     (20, 48, 28, 152, ROAD), (172, 48, 180, 152, ROAD)])
scv = straight_cost(veh, ax, ay, bx, by)
cv, sv = astar(veh, ax, ay, bx, by)
print(f"   直线代价 {scv} ／ A* 路径代价 {cv if cv else 0:.0f} ／ 结算 {sv} 格")
ck("车辆直线不通（穿不过城区）", math.isinf(scv), True)
ck("车辆能绕公路到达", cv is not None, True)

# ===== 回归（本次修复核心）：路点折线绝不能切进"车不可通行"格 =====
print("== 回归：路点折线是否穿过车不可通行格（mul < 0.7） ==")
VEH_FLOOR = 0.7
SPAN = 6

def wps_of(cells, gw):
    """与 battle.js navCellsToWaypoints 同算法：直线上每 SPAN 格一点 + 拐角必补点"""
    if len(cells) <= 2: return list(cells)
    out = [cells[0]]; last = None; run = 0
    for i in range(1, len(cells)):
        a, b = cells[i-1], cells[i]
        ax, ay = a % gw, a // gw
        bx, by = b % gw, b // gw
        d = (1 if bx > ax else (-1 if bx < ax else 0), 1 if by > ay else (-1 if by < ay else 0))
        if i == 1: last, run = d, 1; continue
        if d == last:
            run += 1
            if run >= SPAN: out.append(b); run = 0
        else:
            out.append(a); last, run = d, 0
    out.append(cells[-1])
    ded = []
    for c in out:
        if not ded or c != ded[-1]: ded.append(c)
    return ded

def old_wps_of(cells):
    return [cells[i] for i in range(0, len(cells), 3)] + [cells[-1]]

def seg_bad(mul, gw, W, floor):
    bad = 0
    for i in range(1, len(W)):
        ax, ay = W[i-1] % gw + 0.5, W[i-1] // gw + 0.5
        bx, by = W[i] % gw + 0.5, W[i] // gw + 0.5
        n = max(1, int((abs(bx-ax) + abs(by-ay)) / 0.05))
        for k in range(n + 1):
            tt = k / n
            kx = max(0, min(gw - 1, int(ax + (bx-ax)*tt)))
            ky = max(0, min(GH - 1, int(ay + (by-ay)*tt)))
            if mul[ky * gw + kx] < floor: bad += 1
    return bad

sc3 = straight_cost(nav, 400, 2500, 4500, 2500)
c3, _s3 = astar(nav, 400, 2500, 4500, 2500, sc3 * (1 - GAIN))
assert c3 is not None, "A* 应能找到路径"
# 取回格链：重新跑一次并重建（astar 只回代价，这里用同法重建路径）
def astar_path(nav, ux, uy, tx, ty, limit=math.inf):
    gw, gh, cell = nav.gw, nav.gh, CELL
    ci = lambda v, hi: max(0, min(hi, v))
    gx, gy = ci(int(tx // cell), gw - 1), ci(int(ty // cell), gh - 1)
    sx, sy = ci(int(ux // cell), gw - 1), ci(int(uy // cell), gh - 1)
    start, goal = sy * gw + sx, gy * gw + gx
    g = [math.inf] * (gw * gh); par = [-1] * (gw * gh)
    heur = lambda i: math.hypot(((i % gw) - gx) * cell, ((i // gw) - gy) * cell) / FASTEST
    g[start] = 0.0; h = [(heur(start) * H_EPS, start)]; SQ2 = 1.41421356
    while h:
        f, i = heapq.heappop(h)
        if i == goal:
            path = []
            k = goal
            while k != -1: path.append(k); k = par[k]
            return path[::-1]
        if g[i] + heur(i) >= limit: continue
        cx, cy = i % gw, i // gw
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if not dx and not dy: continue
                nx, ny = cx + dx, cy + dy
                if not (0 <= nx < gw and 0 <= ny < gh): continue
                k = ny * gw + nx
                if not nav.ok(k): continue
                seg = (SQ2 if (dx and dy) else 1.0) * cell
                spd = max(0.05, (nav.mul[i] + nav.mul[k]) * 0.5)
                ng = g[i] + seg / spd
                if ng < g[k]: g[k] = ng; par[k] = i; heapq.heappush(h, (ng + heur(k) * H_EPS, k))
    return None

path = astar_path(nav, 400, 2500, 4500, 2500, sc3 * (1 - GAIN))
Wn = wps_of(path, GW)
Wo = old_wps_of(path)
bo = seg_bad(nav.mul, GW, Wo, VEH_FLOOR)
bn = seg_bad(nav.mul, GW, Wn, VEH_FLOOR)
print(f"   走廊 {len(path)} 格 ／ 旧路点 {len(Wo)} 个 → 穿车不可通行格 {bo} 处")
print(f"   走廊 {len(path)} 格 ／ 新路点 {len(Wn)} 个 → 穿车不可通行格 {bn} 处")
ck("新路点折线不穿车不可通行格", bn, 0)

# ---- 更强的对照：多弯走廊上直接检查"折线是否越出走廊"（旧算法必越界 = 本次修的病）----
def mk_bends(seq):
    out = [seq[0]]
    for p in seq[1:]:
        c = out[-1]
        while c != p:
            dx = 1 if p[0] > c[0] else (-1 if p[0] < c[0] else 0)
            dy = 1 if p[1] > c[1] else (-1 if p[1] < c[1] else 0)
            c = (c[0] + dx, c[1] + dy); out.append(c)
    return out

def seg_out(W, cs, gw):
    bad = 0
    for i in range(1, len(W)):
        ax, ay = W[i-1] % gw + 0.5, W[i-1] // gw + 0.5
        bx, by = W[i] % gw + 0.5, W[i] // gw + 0.5
        n = max(1, int((abs(bx-ax) + abs(by-ay)) / 0.05))
        for k in range(n + 1):
            tt = k / n
            if (int(ax + (bx-ax)*tt), int(ay + (by-ay)*tt)) not in cs: bad += 1
    return bad

bend = mk_bends([(0, 0), (8, 0), (8, 6), (12, 6), (12, 11), (22, 11), (22, 14)])
flat = [y * GW + x for (x, y) in bend]
csb = set(bend)
o2 = seg_out(old_wps_of(flat), csb, GW)
n2 = seg_out(wps_of(flat, GW), csb, GW)
print(f"   多弯走廊 {len(bend)} 格：旧路点越出走廊 {o2} 处 ／ 新路点越出走廊 {n2} 处")
ck("新路点不越出走廊（不切角）", n2, 0)
ck("（对照）旧路点会切角 —— 这就是本次修的病", o2 > 0, True)

# ===== 回归（本次修复核心之二）：A* 的"安全上限"不能被"重复入堆的陈旧条目"吃掉 =====
# 背景：bakeRoutes 调 navcAStar 时传 limit=Infinity（不做代价剪枝）⇒ 探索量最大；
#       而 25m 粗格让 8km×6km 的图有 76800 格（50m 时代只有 19200）⇒ 固定 60000 上限会被撞到，
#       于是"明明有路"却返回 null ⇒ 自动生成报"路径算不出来"。本回归把这件事钉住。
print("== 回归：大图 + limit=∞（bakeRoutes 就是这么调的）时，A* 不应误报\"算不出路\" ==")
def maze(gw, gh, n_wall, wall_w, gap_y):
    """锯齿走廊：上下封边 + n_wall 道竖墙、缺口上下交替（逼出多次拐弯 ⇒ 启发式形同废纸）"""
    nav = build(gw, gh, [])
    edge = 12
    for gy in list(range(0, edge)) + list(range(gh - edge, gh)):
        for gx in range(gw):
            nav.mul[gy * gw + gx] = 0.0
    step = gw // (n_wall + 1)
    for i in range(n_wall):
        x = step * (i + 1)
        for gy in range(edge, gh - edge):
            for gx in range(x, min(gw, x + wall_w)):
                nav.mul[gy * gw + gx] = 0.0
        gy0, gy1 = ((edge, edge + gap_y) if i % 2 == 0 else (gh - edge - gap_y, gh - edge))
        for gy in range(gy0, gy1):
            for gx in range(x, min(gw, x + wall_w)):
                nav.mul[gy * gw + gx] = OPEN
    return nav

def bfs_reach(nav, ux, uy, tx, ty):
    """只看能不能走（不看代价）—— 用来判定"路到底存不存在"，与 A* 的判定相互独立"""
    gw, gh = nav.gw, nav.gh
    s = int(uy // CELL) * gw + int(ux // CELL)
    t = int(ty // CELL) * gw + int(tx // CELL)
    seen = bytearray(gw * gh); seen[s] = 1; q = [s]; head = 0
    while head < len(q):
        i = q[head]; head += 1
        if i == t: return True, head
        cx, cy = i % gw, i // gw
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nx, ny = cx + dx, cy + dy
                if not (0 <= nx < gw and 0 <= ny < gh): continue
                k = ny * gw + nx
                if seen[k] or not nav.ok(k): continue
                seen[k] = 1; q.append(k)
    return False, head

bg = maze(240, 160, 5, 5, 40)                       # 6km×4km = 38400 格（小图对照）
bsx, bsy = 350, 2000
btx, bty = 5650, 2000
big = maze(320, 240, 9, 5, 40)                      # 8km×6km = 76800 格（= 用户那张巴斯托涅的量级）
gsx, gsy = 350, 2000
gtx, gty = 7800, 2000

reach, seen = bfs_reach(bg, bsx, bsy, btx, bty)
co, so = astar(bg, bsx, bsy, btx, bty, math.inf, 60000, dedupe=False)
cn, sn = astar(bg, bsx, bsy, btx, bty, math.inf, 60000, dedupe=True)
print(f"   小图 38400 格：可达={reach}（BFS {seen} 格）"
      f" ／ 旧 = {'None' if co is None else round(co)}（结算 {so}）"
      f" ／ 新 = {'None' if cn is None else round(cn)}（结算 {sn}）")
big_reach, big_seen = bfs_reach(big, gsx, gsy, gtx, gty)
bo, bso = astar(big, gsx, gsy, gtx, gty, math.inf, 60000, dedupe=False)
bn, bsn = astar(big, gsx, gsy, gtx, gty, math.inf, 60000, dedupe=True)
print(f"   大图 76800 格：可达={big_reach}（BFS {big_seen} 格）"
      f" ／ 旧 = {'None' if bo is None else round(bo)}（结算 {bso}）"
      f" ／ 新 = {'None' if bn is None else round(bn)}（结算 {bsn}）")
ck("小图：BFS 证明终点可达", reach, True)
ck("小图：新逻辑找到的代价与旧逻辑一致（改动不改变结果）", cn == co, True)
ck("小图：出堆去重减少结算量", sn < so, True)
ck("大图：BFS 证明终点可达（路是存在的）", big_reach, True)
ck("大图：旧逻辑（不去重 + 固定 60000）撞上限 ⇒ 误报\"算不出路\"", (bo is None and bso > 60000), True)
ck("大图：新逻辑（去重 + 上限自适应）能找到路径", bn is not None, True)
ck("大图：新逻辑结算格数 ≤ 图格数", bsn <= big.gw * big.gh, True)

print("")
print("%s" % ("全部通过 ✓" if fails == 0 else f"{fails} 项失败 ✗"))
sys.exit(0 if fails == 0 else 1)
