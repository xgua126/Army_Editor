# -*- coding: utf-8 -*-
"""出生区多边形几何：与 grid-maps.js 的 pointInPoly / polyArea / spawnCenter / collectSpawnSlots 同算法复刻"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def pointInPoly(x, y, pts):
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]; xj, yj = pts[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi):
            inside = not inside
        j = i
    return inside

def polyArea(pts):
    a = 0
    n = len(pts); j = n - 1
    for i in range(n):
        a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
        j = i
    return abs(a) / 2

def polyCenter(pts):
    px = sum(p[0] for p in pts) / len(pts)
    py = sum(p[1] for p in pts) / len(pts)
    return px, py

def spawnArea(polys):
    return sum(polyArea(p) for p in polys)

def spawnCenter(polys):
    sx = sy = sw = 0.0
    for p in polys:
        a = polyArea(p) or 1
        cx, cy = polyCenter(p)
        sx += cx * a; sy += cy * a; sw += a
    return (sx / sw, sy / sw) if sw else (0, 0)

def collectSlots(bbox, polys, step):
    x0, y0, w, h = bbox
    c = spawnCenter(polys)
    out = []
    x = x0 + step * 0.5
    while x <= x0 + w + 1e-9:
        y = y0 + step * 0.5
        while y <= y0 + h + 1e-9:
            if any(pointInPoly(x, y, p) for p in polys):
                out.append((x, y, ((x - c[0]) ** 2 + (y - c[1]) ** 2) ** 0.5))
            y += step
        x += step
    out.sort(key=lambda t: t[2])
    return out

def bboxOf(polys):
    xs = [p[0] for poly in polys for p in poly]
    ys = [p[1] for poly in polys for p in poly]
    return (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))

fails = 0
def ck(name, got, exp):
    global fails
    ok = (abs(got - exp) < 1e-6) if isinstance(exp, (int, float)) else (got == exp)
    if not ok:
        fails += 1
        print(f"  FAIL {name}: got {got}, want {exp}")
    else:
        print(f"  ok   {name}: {got}")

print("== 1) 正方形（逆时针）1000×1000 ==")
sq = [(0, 0), (1000, 0), (1000, 1000), (0, 1000)]
ck("面积", polyArea(sq), 1000000)
ck("内点(500,500)", pointInPoly(500, 500, sq), True)
ck("外点(1500,500)", pointInPoly(1500, 500, sq), False)
ck("外点(500,-1)", pointInPoly(500, -1, sq), False)

print("== 2) 反序（顺时针）面积不变 ==")
ck("面积", polyArea(list(reversed(sq))), 1000000)

print("== 3) 凹多边形（L 形，面积 = 3/4 正方形）==")
L = [(0, 0), (1000, 0), (1000, 500), (500, 500), (500, 1000), (0, 1000)]
ck("面积", polyArea(L), 750000)
ck("L 的拐角内点(250,750)", pointInPoly(250, 750, L), True)
ck("凹口内但不在L里(750,750)", pointInPoly(750, 750, L), False)
ck("下臂内点(750,250)", pointInPoly(750, 250, L), True)

print("== 4) 多块（不相连）：面积相加、中心加权 ==")
p1 = [(0, 0), (100, 0), (100, 100), (0, 100)]        # 1e4，中心(50,50)
p2 = [(900, 0), (1000, 0), (1000, 100), (900, 100)]  # 1e4，中心(950,50)
polys = [p1, p2]
ck("总面积", spawnArea(polys), 20000)
c = spawnCenter(polys)
ck("质心 X（两块等面积 → 中点 500）", round(c[0], 3), 500.0)
ck("质心 Y", round(c[1], 3), 50.0)
ck("点在第一块内", any(pointInPoly(50, 50, p) for p in polys), True)
ck("点在两块之间（应否）", any(pointInPoly(500, 50, p) for p in polys), False)

print("== 5) collectSpawnSlots：L 形里只出圈内点，且从质心往外排 ==")
bb = bboxOf([L])
slots = collectSlots(bb, [L], 200)
bad = [s for s in slots if not pointInPoly(s[0], s[1], L)]
ck("越界的槽位数", len(bad), 0)
ds = [s[2] for s in slots]
ck("按到质心距离递增", ds == sorted(ds), True)
print(f"      L 形 bbox={bb} step=200 → 槽位 {len(slots)} 个（纯矩形会是 ~25 个）")

print("== 6) 多块 + 间隙：槽位只落在两块里 ==")
slots2 = collectSlots(bboxOf(polys), polys, 100)
mid = [s for s in slots2 if 150 < s[0] < 850]
ck("落在两块之间的槽位数", len(mid), 0)
print(f"      多块 bbox 内 step=100 → 槽位 {len(slots2)} 个（两块各 1 格 → 期望 2）")

print("\n%s" % ("全部通过 ✓" if fails == 0 else f"{fails} 项失败 ✗"))
sys.exit(0 if fails == 0 else 1)
