# -*- coding: utf-8 -*-
"""矢量公路栅格化 —— 与 grid-maps.js buildRoadGrid 同算法复刻

要保证的三件事（导航全靠它）：
  1. 路宽 w ⇒ 覆盖格子的宽度 ≈ w（不胖不瘦）
  2. 斜路沿线**不漏格**、且整条路是 **4-连通**的（车辆要的是一条连续可开带）
  3. 公路横穿"不可通行带"（河/城区）时，能把两侧**连起来**（这就是"用公路绕开不可通行"）
"""
import sys, io, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

fails = 0
def ck(name, got, exp):
    global fails
    ok = (got == exp)
    if not ok: fails += 1
    print(("  ok   " if ok else "  FAIL ") + f"{name}: {got}（期望 {exp}）")


def build_road_grid(gw, gh, cs, roads):
    """roads: [(w, [(x,y),…]), …] → set of (gx,gy)"""
    out = set()
    step = max(cs * 0.5, 2.5)
    for (w, pts) in roads:
        r = max(cs * 0.5, w / 2.0)
        r2 = r * r
        for i in range(1, len(pts)):
            ax, ay = pts[i - 1]; bx, by = pts[i]
            seg = math.hypot(bx - ax, by - ay)
            steps = max(1, int(math.ceil(seg / step)))
            for k in range(steps + 1):
                t = k / steps
                cx, cy = ax + (bx - ax) * t, ay + (by - ay) * t
                gx1 = max(0, int(math.floor((cx - r) / cs))); gx2 = min(gw - 1, int(math.ceil((cx + r) / cs)))
                gy1 = max(0, int(math.floor((cy - r) / cs))); gy2 = min(gh - 1, int(math.ceil((cy + r) / cs)))
                for gy in range(gy1, gy2 + 1):
                    wy = gy * cs + cs / 2.0
                    for gx in range(gx1, gx2 + 1):
                        wx = gx * cs + cs / 2.0
                        if (wx - cx) ** 2 + (wy - cy) ** 2 <= r2:
                            out.add((gx, gy))
    return out


def cells_of_line(road, pts, cs, step_m=1.0):
    """沿中心线每 step_m 采样一次，返回经过的格子（用来查"漏格"）"""
    hit = set()
    for i in range(1, len(pts)):
        ax, ay = pts[i - 1]; bx, by = pts[i]
        seg = math.hypot(bx - ax, by - ay)
        steps = max(1, int(math.ceil(seg / step_m)))
        for k in range(steps + 1):
            t = k / steps
            x, y = ax + (bx - ax) * t, ay + (by - ay) * t
            hit.add((int(x // cs), int(y // cs)))
    return hit


def connected(road, start, goal):
    """4-连通 BFS（车辆在实际通行里需要的是连续带，不是"点集"）"""
    if start not in road or goal not in road: return False
    seen = {start}; q = [start]
    while q:
        x, y = q.pop()
        if (x, y) == goal: return True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (nx, ny) in road and (nx, ny) not in seen:
                seen.add((nx, ny)); q.append((nx, ny))
    return False


GW, GH, CS = 200, 200, 5           # 1000m × 1000m，5m 格（与真实地图一致）

print("== 1. 路宽 → 覆盖宽度 ==")
for w, exp in ((10, 2), (20, 4), (50, 10)):
    road = build_road_grid(GW, GH, CS, [(w, [(0, 250), (900, 250)])])
    ys = sorted(set(gy for (_, gy) in road))
    ck(f"{w}m 路 ⇒ 覆盖 {len(ys)} 格高", len(ys), exp)      # 5m 格：10m=2 行、20m=4 行、50m=10 行
ck("4m 小路覆盖 1~2 格（5m 栅格的物理下限；下限 max(cs/2, w/2) 正是「不漏格」的保证）",
   len(set(gy for (_, gy) in build_road_grid(GW, GH, CS, [(4, [(0, 250), (900, 250)])]))), 2)

print("== 2. 斜路：不漏格 + 4-连通 ==")
for ang, name in ((45, "45°"), (30, "30°"), (72, "72°")):
    a = math.radians(ang)
    pts = [(50, 50), (50 + 800 * math.cos(a), 50 + 800 * math.sin(a))]
    road = build_road_grid(GW, GH, CS, [(12, pts)])
    need = cells_of_line(road, pts, CS)                    # 中心线经过的每格都必须被覆盖
    ck(f"{name} 斜路不漏格（中心线落格全部覆盖）", len(need - road), 0)
    s = (int(pts[0][0] // CS), int(pts[0][1] // CS))
    g = (int(pts[1][0] // CS), int(pts[1][1] // CS))
    ck(f"{name} 斜路 4-连通（车辆有连续可开带）", connected(road, s, g), True)

print("== 3. 公路打通不可通行带（河 / 城区）==")
# 河：x 380..620 一整条不可通行带（10m 路横穿 ⇒ 应该连起来）
river_road = build_road_grid(GW, GH, CS, [(12, [(50, 500), (950, 500)])])
band_blocked = [(gx, gy) for gx in range(int(380 // CS), int(620 // CS)) for gy in range(GH)]
no_road = [(gx, gy) for (gx, gy) in band_blocked if (gx, gy) not in river_road]
ck("河带里仍有「没被公路覆盖」的格（说明带子是挡的）", len(no_road) > 0, True)
ck("公路横穿河带 ⇒ 西岸能到东岸",
   connected(river_road, (10, 100), (190, 100)), True)
ck("公路确实落在河带里（桥）", any(380 <= gx * CS <= 620 for (gx, gy) in river_road), True)

print("== 4. 折线拐弯处不出现断口 ==")
bend = [(50, 950), (500, 950), (500, 500), (950, 500), (950, 50)]
road = build_road_grid(GW, GH, CS, [(16, bend)])
need = cells_of_line(road, bend, CS)
ck("多弯折线不漏格", len(need - road), 0)
ck("多弯折线首尾 4-连通", connected(road, (10, 190), (190, 10)), True)

print("")
print("%s" % ("全部通过 ✓" if fails == 0 else f"{fails} 项失败 ✗"))
sys.exit(0 if fails == 0 else 1)
