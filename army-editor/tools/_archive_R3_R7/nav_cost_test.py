# -*- coding: utf-8 -*-
"""寻路代价场：与 battle.js 的 buildNavGrid / straightTerrainCost / getNavCostField / computeNavRoute 同算法复刻
   目的：离线验证"绕远走公路更快时，真的会选公路"这一核心行为。"""
import sys, io, math, heapq
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CELL = 25
PATH_GAIN = 0.02

class Nav:
    def __init__(self, gw, gh, mul):
        self.gw, self.gh, self.cell = gw, gh, CELL
        self.mul = mul                       # mul[k] = 速度倍率（>0 即可通行）
    def passable(self, k): return self.mul[k] > 0

def straight_cost(nav, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    if L < 1: return 0.0
    steps = max(1, math.ceil(L / CELL))
    seg = L / steps
    cost = 0.0; prev = None
    for i in range(steps + 1):
        t = i / steps
        gx = max(0, min(nav.gw - 1, int((x1 + dx * t) // CELL)))
        gy = max(0, min(nav.gh - 1, int((y1 + dy * t) // CELL)))
        k = gy * nav.gw + gx
        if not nav.passable(k): return math.inf
        m = nav.mul[k]
        if prev is not None: cost += seg / max(0.05, (m + prev) * 0.5)
        prev = m
    return cost

def cost_field(nav, gx, gy, bound=math.inf):
    """Dijkstra（8 邻域）；bound 之外的格子保持 inf —— 对应 JS 的 qLimit 剪枝"""
    gw, gh = nav.gw, nav.gh
    dist = [math.inf] * (gw * gh)
    start = gy * gw + gx
    if not nav.passable(start):
        # 就近找可通行格
        best, bd = None, math.inf
        for dy in range(-6, 7):
            for dx in range(-6, 7):
                nx, ny = gx + dx, gy + dy
                if not (0 <= nx < gw and 0 <= ny < gh): continue
                if not nav.passable(ny * gw + nx): continue
                d = dx * dx + dy * dy
                if d < bd: bd, best = d, ny * gw + nx
        if best is None: return dist
        start = best
    dist[start] = 0.0
    h = [(0.0, start)]
    SQ2 = 1.41421356
    while h:
        c, i = heapq.heappop(h)
        if c > dist[i]: continue
        if c > bound: break
        cx = i % gw
        cy = (i - cx) // gw
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if not dx and not dy: continue
                nx, ny = cx + dx, cy + dy
                if not (0 <= nx < gw and 0 <= ny < gh): continue
                k = ny * gw + nx
                if not nav.passable(k): continue
                spd = max(0.05, (nav.mul[i] + nav.mul[k]) * 0.5)
                nc = c + (SQ2 if (dx and dy) else 1.0) * CELL / spd
                if nc < dist[k]:
                    dist[k] = nc
                    heapq.heappush(h, (nc, k))
    return dist

def route(nav, ux, uy, tx, ty):
    gw, gh = nav.gw, nav.gh
    ci = lambda v, hi: max(0, min(hi, v))
    gx, gy = ci(int(tx // CELL), gw - 1), ci(int(ty // CELL), gh - 1)
    sx, sy = ci(int(ux // CELL), gw - 1), ci(int(uy // CELL), gh - 1)
    dGoal = math.hypot(tx - ux, ty - uy)
    sc = straight_cost(nav, ux, uy, tx, ty)
    startIdx = sy * gw + sx
    if (sx, sy) == (gx, gy):
        return dict(sc=sc, pc=sc, used=False)
    if math.isfinite(sc):
        f = cost_field(nav, gx, gy, sc * (1 - PATH_GAIN))
        pc = f[startIdx]
        if math.isfinite(pc) and pc < sc * (1 - PATH_GAIN / 2):
            return dict(sc=sc, pc=pc, used=True)
        return dict(sc=sc, pc=sc, used=False)
    f2 = cost_field(nav, gx, gy, (dGoal / 0.6) * 2.5)
    pc2 = f2[startIdx]
    if not math.isfinite(pc2): return dict(sc=math.inf, pc=math.inf, used=False)
    return dict(sc=math.inf, pc=pc2, used=True)

OPEN, ROAD, FOREST, WALL = 1.0, 1.3, 0.35, 0.0     # WALL: mul=0 → 不可通行

def build(gw, gh, paint):
    mul = [OPEN] * (gw * gh)
    for (x0, y0, x1, y1, v) in paint:
        for gy in range(y0, y1):
            for gx in range(x0, x1):
                if 0 <= gx < gw and 0 <= gy < gh: mul[gy * gw + gx] = v
    return Nav(gw, gh, mul)

fails = 0
def ck(name, got, exp):
    global fails
    ok = (got == exp)
    if not ok: fails += 1
    print(("  ok   " if ok else "  FAIL ") + f"{name}: {got}（期望 {exp}）")

GW = GH = 80     # 80×25m = 2000m

print("== 场景1：直线穿树林(0.35)，绕行有公路(1.3) —— 应选路径 ==")
# 树林横带：y 35..45（875..1125m），x 8..72；公路沿 y=48..52 与 x=74..78 绕
nav = build(GW, GH, [
    (8, 35, 72, 45, FOREST),
    (8, 48, 78, 52, ROAD),
    (74, 10, 78, 52, ROAD),
])
r = route(nav, 250, 1000, 1750, 1000)
print(f"     直线代价 {r['sc']:.0f} ／ 路径代价 {r['pc']:.0f}")
ck("选择路径", r['used'], True)
ck("路径更省", r['pc'] < r['sc'], True)

print("== 场景2：全开阔 —— 应走直线（不绕）==")
nav2 = build(GW, GH, [])
r2 = route(nav2, 250, 1000, 1750, 1000)
print(f"     直线代价 {r2['sc']:.0f} ／ 路径代价 {r2['pc']:.0f}")
ck("走直线", r2['used'], False)
ck("两者几乎相等", abs(r2['sc'] - r2['pc']) < 1, True)

print("== 场景3：平地但很慢的沼泽(0.2)挡在直线上，旁边有公路 —— 应绕公路 ==")
nav3 = build(GW, GH, [
    (20, 30, 60, 50, 0.2),      # 大片沼泽
    (20, 52, 60, 56, ROAD),     # 绕行公路
])
r3 = route(nav3, 250, 1000, 1750, 1000)
print(f"     直线代价 {r3['sc']:.0f} ／ 路径代价 {r3['pc']:.0f}")
ck("选择路径", r3['used'], True)

print("== 场景4：直线被墙挡住（不可通行）—— 应绕行 ==")
nav4 = build(GW, GH, [
    (38, 30, 42, 50, WALL),     # 一堵竖墙正好堵住直线（y 750~1250m），上下留空可绕
])
r4 = route(nav4, 250, 1000, 1750, 1000)
print(f"     直线代价 {r4['sc']} ／ 路径代价 {r4['pc']:.0f}")
ck("直线不通", math.isinf(r4['sc']), True)
ck("绕行可达", r4['used'], True)

print("== 场景4b：墙横贯全图（无绕行）—— 直线不通且无路 ==")
nav4b = build(GW, GH, [(38, 0, 42, GH, WALL)])
r4b = route(nav4b, 250, 1000, 1750, 1000)
ck("直线不通", math.isinf(r4b['sc']), True)
ck("无绕行路线", r4b['used'], False)

print("== 场景5：下界/边界 —— 目标超出地图/同格 ==")
r5 = route(nav2, 250, 1000, 260, 1000)
ck("同格 → 不评估", r5['used'], False)

print("== 场景6（本次修复核心）：车为什么不贴公路 —— 旧模型 vs 新模型 ==")
# 同一张图：中间 600m 宽树林带挡在直线上；南边有绕行约 3km 的公路
# 旧模型：烘焙只看调色板 speedMul（林 0.6 / 路 1.3）⇒ 绕 3km 不划算 ⇒ 直穿
# 新模型：与运行时同表（轮式 林 0.21 / 路 1.69）⇒ 绕 3km 明显划算 ⇒ 走公路
def mobility_mul_for_tile(mt, tile):
    """与 grid-maps.js mobilityMulForTile 同表（唯一真相）"""
    mul = tile['speedMul']
    if mt == 'foot':
        if tile.get('road'): mul *= 1.1
        elif tile.get('forest'): mul *= 0.85
        elif tile.get('hill'): mul *= 0.9
    elif mt == 'wheeled':
        if tile.get('road'): mul *= 1.3
        elif tile.get('hill') or tile.get('forest'): mul *= 0.35
        else: mul *= 0.6
    elif mt == 'tracked':
        if tile.get('road'): mul *= 1.1
        elif tile.get('hill') or tile.get('forest'): mul *= 0.85
        else: mul *= 0.9
    elif mt == 'halftrack':
        if tile.get('road'): mul *= 1.2
        elif tile.get('hill') or tile.get('forest'): mul *= 0.75
        else: mul *= 0.85
    return mul

GRASS = {'speedMul': 1.0}
FOREST_T = {'speedMul': 0.6, 'forest': True}
HILL_T = {'speedMul': 0.8, 'hill': True}      # ★ 轮式能过（0.8 ≥ 0.7 门槛）但很慢 ⇒ 正是"硬爬坡不走公路"
ROAD_T = {'speedMul': 1.3, 'road': True}

def build_tiles(gw, gh, paint):
    tiles = [GRASS] * (gw * gh)
    for (x0, y0, x1, y1, t) in paint:
        for gy in range(y0, y1):
            for gx in range(x0, x1):
                if 0 <= gx < gw and 0 <= gy < gh: tiles[gy * gw + gx] = t
    return tiles

TILES = build_tiles(GW, GH, [
    (24, 20, 56, 60, HILL_T),          # 直穿：800m 宽丘陵（x 600~1400m，y 500~1500m）
    (0, 66, GW, 72, ROAD_T),           # 绕行公路：东西向主轴（y 1650~1800m）
    (8, 40, 12, 72, ROAD_T),           # 西侧连接段
    (76, 40, 80, 72, ROAD_T),          # 东侧连接段
])
SX, SY, TX, TY = 250, 1000, 1750, 1000     # 直线 1500m（其中 800m 是丘陵）

for mob in ('wheeled', 'foot'):
    old_mul = [t['speedMul'] for t in TILES]                    # 旧模型：只看调色板
    new_mul = [mobility_mul_for_tile(mob, t) for t in TILES]    # 新模型：与运行时同表
    r_old = route(Nav(GW, GH, old_mul), SX, SY, TX, TY)
    r_new = route(Nav(GW, GH, new_mul), SX, SY, TX, TY)
    print("   %s: 旧模型 直穿 %.0f / 路径 %.0f ⇒ %s   ｜   新模型 直穿 %.0f / 路径 %.0f ⇒ %s"
          % (mob, r_old['sc'], r_old['pc'], '绕行' if r_old['used'] else '直穿',
             r_new['sc'], r_new['pc'], '绕行' if r_new['used'] else '直穿'))
    if mob == 'wheeled':
        ck("轮式·旧模型：绕 3km 不划算 ⇒ 直穿丘陵（这就是「车不贴公路」）", r_old['used'], False)
        ck("轮式·新模型：绕 3km 划算 ⇒ 走公路", r_new['used'], True)
        ck("轮式·新模型：绕行确实比直穿快", r_new['pc'] < r_new['sc'], True)

print("\n%s" % ("全部通过 ✓" if fails == 0 else f"{fails} 项失败 ✗"))
sys.exit(0 if fails == 0 else 1)
