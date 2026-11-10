# -*- coding: utf-8 -*-
"""车辆可通行判据的离线测试："格内有没有一条能开车的带"（navStripOk 的同算法复刻）

为什么不用"可通行子格占比"：公路只有 10~15m 宽，被树林夹住时占比很低（5x5 子格里只占 2~3 列），
按占比判会把公路整个判死 ⇒ 车再也上不了路；按"有没有连续带"判才符合实际。"""
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

STRIP = 2        # 连续几格算一条"带"（子格 5m ⇒ 2 格 = 10m，刚好一条小路／单车道）
WALL = 0.75      # 硬阻挡占比超过它 ⇒ 车辆也不走（全是楼房／水面那种格）


def strip_ok(v, sw, sh, need=STRIP):
    if not v: return True
    at = lambda x, y: 1 if (0 <= x < sw and 0 <= y < sh and v[y * sw + x]) else 0
    for y in range(sh):
        run = 0
        for x in range(sw):
            run = run + 1 if at(x, y) else 0
            if run >= need: return True
    for x in range(sw):
        run = 0
        for y in range(sh):
            run = run + 1 if at(x, y) else 0
            if run >= need: return True
    return False


def veh_pass(v, sw, sh, bad, tot):
    return strip_ok(v, sw, sh) and (tot <= 0 or float(bad) / tot <= WALL)


def grid(rows):
    sw = max(len(r) for r in rows); sh = len(rows)
    v = []
    for r in rows:
        v += [1 if c == "#" else 0 for c in r]
        v += [0] * (sw - len(r))
    return v, sw, sh


fails = 0
def ck(name, got, exp):
    global fails
    ok = (got == exp)
    if not ok: fails += 1
    print(("  ok   " if ok else "  FAIL ") + name + ": " + str(got) + "（期望 " + str(exp) + "）")


print("== 车辆可通行判据：有没有一条能开车的带 ==")
# ① 15m 公路（3 列）从 25m 格中间穿过，两侧都是树林（不可开）⇒ 必须判"能走"！
v, sw, sh = grid(["..###", "..###", "..###", "..###", "..###"])
ck("① 林地夹住的公路（占比仅 40%）⇒ 能走", veh_pass(v, sw, sh, 0, 25), True)
# ② 最窄的单车道（2 列）也应当能走
v, sw, sh = grid(["...##", "...##", "...##", "...##", "...##"])
ck("② 单车道 10m ⇒ 能走", veh_pass(v, sw, sh, 0, 25), True)
# ③ 只有零散 1 格宽的缝（没有连续带）⇒ 不能走
v, sw, sh = grid([".#.#.", "#.#.#", ".#.#.", "#.#.#", ".#.#."])
ck("③ 只有交错 1 格缝 ⇒ 不能走", veh_pass(v, sw, sh, 0, 25), False)
# ④ 全是楼房 ⇒ 不能走
v, sw, sh = grid(["#####"] * 5)
ck("④ 全楼房 ⇒ 不能走", veh_pass(v, sw, sh, 25, 25), False)
# ⑤ 半楼房 + 一条 2 格路 ⇒ 能走（硬阻挡占比 60% 但没超 75%）
v, sw, sh = grid(["###..", "###..", "###..", "###..", "###.."])
ck("⑤ 楼房夹着 10m 路（硬阻挡 60%）⇒ 能走", veh_pass(v, sw, sh, 15, 25), True)
# ⑥ 85% 全是硬阻挡 ⇒ 即便有一条带也不作为过境通道
v, sw, sh = grid([".####", ".####", ".####", ".####", ".####"])
ck("⑥ 硬阻挡 80% ⇒ 不走", veh_pass(v, sw, sh, 20, 25), False)
# ⑦ 空地图（无子格）⇒ 默认能走
ck("⑦ 空格 ⇒ 能走（不误判）", veh_pass([], 0, 0, 0, 0), True)

print("")
print("全部通过 ✓" if fails == 0 else str(fails) + " 项失败 ✗")
sys.exit(0 if fails == 0 else 1)
