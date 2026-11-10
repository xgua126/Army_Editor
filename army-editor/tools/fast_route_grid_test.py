# -*- coding: utf-8 -*-
"""R9.5c 镜像测试：**栅格公路版的"快速移动"**（battle.js: roadTileAt / nearestRoadTile / planFastRouteByGrid）

为什么必须有这一条：
  预设/老地图的公路是**刷在地形格子里的**（`gLine(gm,…, 'road')`），它们的 `gm.roads`
  （矢量折线）是**空的** ⇒ 旧的 `planFastRoute` 第一行就 `return null` ⇒ "快速移动"退化成直线
  （玩家反馈："点了快速移动还是走直线"）。
  这里把**真实地图的公路刷法**（一字不差搬 makeInterchangeMap 的 gLine/gCircle）
  与**同一套算法**镜像成 Python，验证三件事：
    ① 能接入最近的公路格     ② 真的**沿公路推进**（路点都在路上）     ③ 直线收尾到目标
  另加一个"整张地图没有公路"的用例：必须返回 None（调用方改直线并写明原因）。
"""
import math, sys

PASS = FAIL = 0
def ck(name, got, want):
    global PASS, FAIL
    ok = (got == want)
    if ok: PASS += 1
    else:  FAIL += 1
    print('  %s %s：%r（期望 %r）' % ('ok  ' if ok else 'FAIL', name, got, want))

CELL = 5.0
ROAD = 1

def mk_map(w, h):
    gw, gh = int(math.ceil(w / CELL)), int(math.ceil(h / CELL))
    return {'w': w, 'h': h, 'cellSize': CELL, 'gw': gw, 'gh': gh, 'grid': [0] * (gw * gh)}

def g_circle(gm, cx, cy, r, t=ROAD):
    """与 grid-maps.js 兼容层的 gCircle 同源：格心落在半径内就盖章"""
    r2 = r * r
    x1 = max(0, int(math.floor((cx - r) / gm['cellSize'])))
    y1 = max(0, int(math.floor((cy - r) / gm['cellSize'])))
    x2 = min(gm['gw'] - 1, int(math.ceil((cx + r) / gm['cellSize'])))
    y2 = min(gm['gh'] - 1, int(math.ceil((cy + r) / gm['cellSize'])))
    for gx in range(x1, x2 + 1):
        wx = gx * gm['cellSize'] + gm['cellSize'] / 2
        for gy in range(y1, y2 + 1):
            wy = gy * gm['cellSize'] + gm['cellSize'] / 2
            if (wx - cx) ** 2 + (wy - cy) ** 2 <= r2:
                gm['grid'][gy * gm['gw'] + gx] = t

def g_line(gm, x1, y1, x2, y2, th, t=ROAD):
    dx, dy = x2 - x1, y2 - y1
    ln = math.hypot(dx, dy)
    steps = max(1, int(math.ceil(ln / (gm['cellSize'] / 2))))
    r = th / 2
    for i in range(steps + 1):
        k = i / steps
        g_circle(gm, x1 + dx * k, y1 + dy * k, r, t)

# ---------- battle.js 的三个函数（逐行镜像） ----------
def roadTileAt(gm, x, y):
    if not gm: return False
    gx, gy = int(math.floor(x / gm['cellSize'])), int(math.floor(y / gm['cellSize']))
    if gx < 0 or gy < 0 or gx >= gm['gw'] or gy >= gm['gh']: return False
    return gm['grid'][gy * gm['gw'] + gx] == ROAD

def nearestRoadTile(gm, x, y, maxR):
    if roadTileAt(gm, x, y): return (x, y, 0.0)
    cs = gm['cellSize']
    r = cs
    while r <= maxR:
        n = max(8, min(64, int(round(2 * math.pi * r / (cs * 3)))))
        for a in range(n):
            th = a / n * math.pi * 2 + r
            px, py = x + math.cos(th) * r, y + math.sin(th) * r
            if px < 0 or py < 0 or px > gm['w'] or py > gm['h']: continue
            if roadTileAt(gm, px, py): return (px, py, r)
        r += cs * 2
    return None

TURNS = [0, 0.35, -0.35, 0.7, -0.7, 1.2, -1.2]
def planFastRouteByGrid(gm, sx, sy, tx, ty):
    """★ R9.6（P3）：与 battle.js 同步 —— 允许平走/微绕过路口，且**只在离目标最近的点下路**"""
    if not gm or not gm['w']: return None
    pin = nearestRoadTile(gm, sx, sy, 2500)
    if not pin: return None
    route = []
    if pin[2] > 30: route.append((pin[0], pin[1]))
    step = max(120, min(400, math.hypot(tx - pin[0], ty - pin[1]) / 20))
    JUNCTION_TOL, LEAVE_BACK = 150.0, 260.0
    cx, cy, guard, stall, nonImprove = pin[0], pin[1], 0, 0, 0
    bestD = math.hypot(tx - cx, ty - cy)
    bestIdx = len(route)
    while guard < 80:
        guard += 1
        dTo = math.hypot(tx - cx, ty - cy)
        if dTo < step * 0.9: break
        base = math.atan2(ty - cy, tx - cx)
        pick, pickScore, pickD, improved = None, -1e18, dTo, False
        fb, fbScore, fbD = None, -1e18, dTo
        for k in TURNS:
            th = base + k
            px, py = cx + math.cos(th) * step, cy + math.sin(th) * step
            if px < 0 or py < 0 or px > gm['w'] or py > gm['h']: continue
            snap = (px, py, 0.0) if roadTileAt(gm, px, py) else nearestRoadTile(gm, px, py, step * 0.7)
            if not snap: continue
            nd = math.hypot(tx - snap[0], ty - snap[1])
            score = (dTo - nd) - abs(k) * 40
            progX, progY = cx - pin[0], cy - pin[1]
            progLen = math.hypot(progX, progY)
            if progLen > step:
                ux, uy = progX / progLen, progY / progLen
                newProj = (snap[0] - pin[0]) * ux + (snap[1] - pin[1]) * uy
                if newProj < progLen - step * 0.15: continue
            if nd < dTo - 5:
                if score > pickScore: pickScore, pick, pickD, improved = score, (snap[0], snap[1]), nd, True
            elif nd <= dTo + JUNCTION_TOL:
                if score > fbScore: fbScore, fb, fbD = score, (snap[0], snap[1]), nd
        if not pick: pick, pickD, improved = fb, fbD, False
        if not pick:
            stall += 1
            if stall >= 4: break
            continue
        stall = 0
        if not improved:
            nonImprove += 1
            if nonImprove >= 6: break
        else:
            nonImprove = 0
        cx, cy = pick
        route.append((cx, cy))
        if pickD < bestD - 1: bestD, bestIdx = pickD, len(route)
        if pickD > bestD + LEAVE_BACK: break
        prevPt = (cx, cy)
    route = route[:bestIdx]
    route.append((tx, ty))
    return route if len(route) > 1 else None


# ============================================================
print('== 1. 预设地图（★ 立交桥）的公路刷法 ⇒ 真的有"路格" ==')
gm = mk_map(13000, 7000)
g_line(gm, 0, 2750, 13000, 4500, 100)
g_line(gm, 8500, 0, 8100, 3400, 100)
g_line(gm, 8100, 3400, 13000, 4400, 100)
g_circle(gm, 8300, 3400, 350); g_circle(gm, 8300, 3400, 180)
g_line(gm, 0, 1500, 4000, 1500, 40)
g_line(gm, 9500, 5500, 13000, 5500, 40)
g_line(gm, 3500, 0, 3500, 4000, 40)
nroad = sum(1 for v in gm['grid'] if v == ROAD)
ck('立交桥地图的路格数 > 0（旧版走 gm.roads=[] ⇒ 这里为 0 ⇒ 快速移动必然退化）', nroad > 0, True)
ck('主线中点 (6500,3625) 在路上', roadTileAt(gm, 6500, 3625), True)
ck('越野处 (6000,2000) 不在路上', roadTileAt(gm, 6000, 2000), False)

print('== 2. 从越野处出发 ⇒ 接入公路 + 沿公路推进 + 直线收尾 ==')
def run(sx, sy, tx, ty, label, minRoadPts=2):
    r = planFastRouteByGrid(gm, sx, sy, tx, ty)
    if not r:
        ck(label + '：算出路线', False, True); return
    firstRoad = roadTileAt(gm, r[0][0], r[0][1])
    onRoad = sum(1 for p in r[:-1] if roadTileAt(gm, p[0], p[1]))
    total = sum(math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]) for i in range(len(r) - 1))
    straight = math.hypot(tx - sx, ty - sy)
    print('     %s：路点 %d 个（在路上 %d）· 接入点在路上=%s · 行程 %.0fm / 直线 %.0fm'
          % (label, len(r), onRoad, firstRoad, total, straight))
    ck(label + '：路点数 ≥ 3', len(r) >= 3, True)
    ck(label + '：第一个路点（接入点）落在公路上', firstRoad, True)
    ck(label + '：沿公路段的路点数 ≥ %d' % minRoadPts, onRoad >= minRoadPts, True)
    ck(label + '：最后一个路点 = 目标点', (round(r[-1][0]), round(r[-1][1])), (tx, ty))
    ck(label + '：行程没离谱（≤ 直线 + 2.6km）', total <= straight + 2600, True)

run(1500, 4200, 1500, 1500, 'A 南侧越野 → 北侧小公路')
run(6000, 2000, 12000, 2000, 'B 主线南侧 → 东侧')
run(1200, 1500, 12500, 5600, 'C 西北小公路 → 东南小公路')

print('== 3. 整张地图没有公路 ⇒ 必须返回 None（调用方改直线 + 写明原因） ==')
gm2 = mk_map(4000, 4000)
ck('无公路地图：返回 None', planFastRouteByGrid(gm2, 500, 500, 3500, 3500) is None, True)
ck('无公路地图：roadTileAt 全 False', roadTileAt(gm2, 1000, 1000), False)
ck('nearestRoadTile 找不到 ⇒ None', nearestRoadTile(gm2, 2000, 2000, 2500), None)

print('== 4. R9.6（P3）：**路口/弯道不许提前下路** ==')
# 水平路 (0,5000)→(5000,5000) + 折向北 (5000,5000)→(5000,9000)；目标在弯道内侧 (5500,5200)
# —— 沿路最接近目标的点是 (5000,5200)（在**转弯之后 200m**）。
#    旧算法"必须比现在更接近才走"在弯道处判"跟不动" ⇒ 直接下路走直线（玩家看到的"到路口就脱离道路"）。
gm3 = mk_map(10000, 12000)
g_line(gm3, 0, 5000, 5000, 5000, 100)
g_line(gm3, 5000, 5000, 5000, 9000, 100)
r3 = planFastRouteByGrid(gm3, 1000, 5000, 5500, 5200)
ck('弯道用例：算出路线', bool(r3), True)
if r3:
    maxy = max(p[1] for p in r3[:-1])                 # 最后一个路点是目标本身，排除
    last_road = r3[-2]
    print('     路点 %d 个 · 路上最大 y = %.0f · 最后路点 = (%.0f, %.0f)'
          % (len(r3), maxy, last_road[0], last_road[1]))
    ck('沿路越过了弯道（有路点 y > 5050，即走了转弯之后的那段）', maxy > 5050, True)
    ck('最后路点落在"离目标最近处"附近（(5000,5200) ± 300m）',
       math.hypot(last_road[0] - 5000, last_road[1] - 5200) <= 300, True)

print()
if FAIL == 0:
    print('全部通过 ✓')
else:
    print('%d 项失败 ✗' % FAIL)
sys.exit(1 if FAIL else 0)
