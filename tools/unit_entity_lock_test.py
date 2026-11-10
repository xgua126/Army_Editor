# -*- coding: utf-8 -*-
"""R9.6.3 镜像测试：**实体坐标锁**（battle.js / dev-panel.js）

为什么必须有这一条：
R9.6 把模型改成"**实体为准**"（单位坐标只由 `facing × speed × dt` 推进），但
**绘制阶段还留着一句旧模型的代码**：

    const uc = unitCenterFromSoldiers(u);
    if (uc) { u.x = uc.x; u.y = uc.y; }   // ← 每帧在 drawBattlefield() 里把实体拖向成员质心

而"在车上的兵"的位置 = 车位置（`syncAboardSoldiers`），车辆槽位用的却是**原始**
`v.ox/v.oy`（"车长×间距"网格，**最后一行没排满时均值 ≠ 0**）
⇒ 实体**每帧被平移一次**（方向 = R(朝向)·槽位均值），表现就是玩家报的：

    "开局所有单位冲向地图角落 / 跑出地图"、"单位持续漂移、滑出公路"
    "不管是不是 AI 控制都会出现，即使有一方是玩家控制的"

—— 因为它发生在**绘制**里，绕过了命令层与 `isPlayerCtl`：**没有命令的单位照样跑**。

本测试两层：
  ① 静态：三件事必须成立（绘制不写坐标 / 车辆槽位零均值 / 实体每帧夹回地图）
  ② 数值：把"车槽位 + 质心回写"的每帧数学镜像出来，用数字证明
     · 旧写法 10 秒能漂 1~2km（与报告的现象一致）
     · 新写法（零均值槽位 + 不回写）漂移恒为 0
"""
import io, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = io.open(os.path.join(HERE, '..', 'js', 'battle.js'), encoding='utf-8').read()
DP = io.open(os.path.join(HERE, '..', 'js', 'dev-panel.js'), encoding='utf-8').read()

PASS = FAIL = 0
def ck(name, got, want):
    global PASS, FAIL
    ok = (got == want)
    if ok: PASS += 1
    else:  FAIL += 1
    print('  %s %s：%r（期望 %r）' % ('ok  ' if ok else 'FAIL', name, got, want))

# ============================================================
print('== 1. 静态：绘制阶段**不许**写回单位坐标 ==')
ck('battle.js：没有 `u.x = uc.x`（R9.6 的质心回写）', 'u.x = uc.x' in BT, False)
ck('battle.js：没有 `const uc = unitCenterFromSoldiers(u);`', 'const uc = unitCenterFromSoldiers(u);' in BT, False)
ck('battle.js：兵牌位置 = 实体位置', 'const p = w2s(u.x, u.y);' in BT, True)
ck('battle.js：unitCenterFromSoldiers 只剩"定义 + ?steer=0 旧路径"两处调用',
   BT.count('unitCenterFromSoldiers('), 2)
ck('battle.js：旧路径由 STEER_ENTITY 明确分开',
   ('if (STEER_ENTITY) {' in BT) and ('const center = unitCenterFromSoldiers(unit);' in BT), True)

print('== 2. 静态：车辆槽位与步兵槽位**同口径**（相对槽位质心 ⇒ 零均值） ==')
ck('battle.js：存在 unitVehicleSlotCenter()', 'function unitVehicleSlotCenter(unit) {' in BT, True)
ck('battle.js：3 个摆放点都用它（定义 1 + 调用 3）', BT.count('unitVehicleSlotCenter(unit)'), 4)
ck('battle.js：3 处都按"槽位 − 槽位质心"用（零均值）',
   BT.count('const vox = (v.ox || 0) - vsc.x, voy = (v.oy || 0) - vsc.y;'), 3)

def _body(fn):
    i = BT.index('function ' + fn + '(')
    j = BT.index('\n}', i)
    return BT[i:j]

ck('battle.js：placeMembersForUnit 里不再用原始车槽位', 'v.ox * hx' in _body('placeMembersForUnit'), False)
ck('battle.js：placeVehicles 里不再用原始车槽位', 'v.ox * hx' in _body('placeVehicles'), False)
ck('battle.js：recenterMembersOnUnit 里不再用原始车槽位', 'v.ox * hx' in _body('recenterMembersOnUnit'), False)

print('== 3. 静态：实体每帧夹回地图（唯一实现 + 两个调用点） ==')
ck('battle.js：存在 clampUnitEntityToMap()', 'function clampUnitEntityToMap(unit) {' in BT, True)
ck('battle.js：调用点 = 2（移动成功时 + 每帧无条件）', BT.count('clampUnitEntityToMap(unit);'), 2)
ck('battle.js：余量自检（余量必须 < 半张地图，否则退回 20m）',
   'const m = (mRaw * 2 < MAP_W && mRaw * 2 < MAP_H) ? mRaw : 20;' in BT, True)
ck('battle.js：旧的"只在走过时才夹"的内联写法已删',
   'unit.x = Math.max(m, Math.min(MAP_W - m, unit.x));' in BT, False)

print('== 4. 静态：车上兵在**夹边界之后**同步（不与自己的车脱节） ==')
i_clamp = BT.index('clampMembersToMap(unit);')
i_sync = BT.index('syncAboardSoldiers(unit);', i_clamp)
ck('battle.js：syncAboardSoldiers 在 clampMembersToMap 之后', i_sync > i_clamp, True)

print('== 5. 静态：面板能看到"本帧位移"（复现时不用再猜） ==')
ck('battle.js：记录 unit._frameStep', 'unit._frameStep = Math.hypot' in BT, True)
ck('dev-panel.js：显示"本帧位移"', '本帧位移' in DP, True)

# ============================================================
# 数值镜像：generateVehicleOffsets（★ 与 battle.js 同一公式，去掉抖动 ⇒ 只看网格本身的均值）
def veh_offsets(n, sp=14.0):
    per_row = max(1, int(math.ceil(math.sqrt(n))))
    rows = int(math.ceil(n / per_row))
    out = []
    for i in range(n):
        row, col = i // per_row, i % per_row
        out.append(((col - (per_row - 1) / 2.0) * sp,
                    (row - (rows - 1) / 2.0) * sp * 0.85))
    return out

def slot_center(offs):
    if not offs: return (0.0, 0.0)
    return (sum(o[0] for o in offs) / len(offs), sum(o[1] for o in offs) / len(offs))

def simulate(n_veh, crew_per_veh, frames, centered_slots, write_back, dt=1 / 60.0, turn_rate=0.0):
    """每帧顺序与 JS 一致：① 车辆落到 set-point ② 车上兵 = 车位置 ③ 绘制阶段（旧版回写质心）
       本用例单位**不移动**（速度 0）⇒ 任何位移都只能是"坐标被偷写"。
       turn_rate = 0 ⇒ 朝向不变（最坏情形：一直朝同一方向漂）
       返回 (终点距起点, 单帧最大平移)"""
    offs = veh_offsets(n_veh)
    sc = slot_center(offs)
    ex = ey = facing = 0.0
    step = 0.0
    for _ in range(frames):
        hx, hy = math.cos(facing), math.sin(facing)
        vpos = []
        for ox, oy in offs:
            if centered_slots: ox, oy = ox - sc[0], oy - sc[1]
            vpos.append((ex + (ox * hx - oy * hy), ey + (ox * hy + oy * hx)))
        cx = sum(p[0] for p in vpos) / len(vpos)
        cy = sum(p[1] for p in vpos) / len(vpos)
        if write_back:
            step = max(step, math.hypot(cx - ex, cy - ey))
            ex, ey = cx, cy
        facing += turn_rate * dt                       # 朝向缓慢变化（漂移方向随之旋转）
    return math.hypot(ex, ey), step

FRAMES = 600                                          # 10 秒 @60fps
print('== 6. 数值：旧写法每帧把实体平移一次（10 秒能漂多少？） ==')
raw3 = slot_center(veh_offsets(3))
ck('3 辆车（2×2 网格只坐满 3 格）槽位均值 ≠ 0', round(math.hypot(*raw3), 3) > 0.5, True)
old_d, old_step = simulate(3, 10, FRAMES, centered_slots=False, write_back=True)
new_d, _        = simulate(3, 10, FRAMES, centered_slots=True,  write_back=True)
no_wb_d, _      = simulate(3, 10, FRAMES, centered_slots=False, write_back=False)
print('     3 辆车 · 全员在车上（每辆 10 人）：')
print('       旧写法（原始槽位 + 质心回写）：10 秒位移 %.0fm（每帧 %.2fm ⇒ %.0f m/s）'
      % (old_d, old_step, old_step * 60))
print('       只修"槽位零均值"            ：10 秒位移 %.0fm' % new_d)
print('       只删"质心回写"              ：10 秒位移 %.0fm' % no_wb_d)
ck('旧写法：10 秒漂 > 1000m（= 玩家看到的"一开局就冲出去"）', old_d > 1000, True)
ck('只修槽位（零均值）⇒ 漂移 0', round(new_d, 6), 0.0)
ck('只删回写 ⇒ 漂移 0（两处都是必要的一半）', round(no_wb_d, 6), 0.0)
rot_d, _ = simulate(3, 10, FRAMES, centered_slots=False, write_back=True, turn_rate=0.5)
print('       旧写法 + 朝向同时旋转（0.5rad/s）：10 秒位移 %.0fm（轨迹是半径 ~%.0fm 的圆）'
      % (rot_d, old_step / (0.5 / 60.0)))
ck('朝向旋转时也漂 > 200m（"整体朝地图边滑过去"）', rot_d > 200, True)

print('== 7. 数值：新写法（零均值槽位 + 不回写）⇒ 漂移恒为 0 ==')
for (nv, crew, label) in [(3, 10, '3 车（10 人/车）'), (8, 30, '8 车（排级 240 人）'), (1, 1, '1 车（单人）')]:
    d, _ = simulate(nv, crew, FRAMES, centered_slots=True, write_back=False)
    print('     %s：10 秒位移 %.6fm' % (label, d))
    ck(label + ' ⇒ 位移 0', round(d, 6), 0.0)

print('== 8. 数值：半员在车上时旧漂移按"在车比例"缩小（但依然跑得飞快） ==')
def mixed_step(n_veh, aboard_frac, frames, centered_slots, write_back):
    """一半人在车上（位置 = 车）、一半人徒步（质心 = 实体）⇒ 质心 = 两者的加权混合"""
    offs = veh_offsets(n_veh)
    sc = slot_center(offs)
    ex = ey = facing = 0.0
    step = 0.0
    for _ in range(frames):
        hx, hy = math.cos(facing), math.sin(facing)
        vpos = []
        for ox, oy in offs:
            if centered_slots: ox, oy = ox - sc[0], oy - sc[1]
            vpos.append((ex + (ox * hx - oy * hy), ey + (ox * hy + oy * hx)))
        cx = sum(p[0] for p in vpos) / len(vpos)
        cy = sum(p[1] for p in vpos) / len(vpos)
        mx = cx * aboard_frac + ex * (1 - aboard_frac)
        my = cy * aboard_frac + ey * (1 - aboard_frac)
        if write_back:
            step = max(step, math.hypot(mx - ex, my - ey))
            ex, ey = mx, my
        facing += 0.5 / 60.0
    return step

s_half = mixed_step(3, 0.5, FRAMES, centered_slots=False, write_back=True)
print('     3 辆车 · 一半人在车上：旧写法每帧平移 %.2fm ⇒ %.0f m/s' % (s_half, s_half * 60))
ck('半员在车上也照样漂（> 30 m/s ⇒ 与谁操控无关）', s_half * 60 > 30, True)
s_half_new = mixed_step(3, 0.5, FRAMES, centered_slots=True, write_back=False)
ck('新写法（半员在车上）⇒ 位移 0', round(s_half_new, 6), 0.0)

print('== 9. ★ R9.6.4：抵达半径 = 单位占地（选中圈 = 真正的判定圈，不再是"士兵铺开半径"） ==')
CMD = io.open(os.path.join(HERE, '..', 'js', 'cmd.js'), encoding='utf-8').read()
ck('battle.js：存在 unitArriveRadius()', 'function unitArriveRadius(unit) {' in BT, True)
ck('battle.js：moveUnitEntity 用 unitArriveRadius 当停止半径', 'const stopR = unitArriveRadius(unit);' in BT, True)
ck('battle.js：选中圈用同一个半径（看到的就是判定圈）', 'const r = unitArriveRadius(u);' in BT, True)
ck('battle.js：旧的"士兵铺开半径 ×1.1"当停止半径已删',
   '(unit._formationRadius || 0) * 1.1' in BT, False)
ck('cmd.js：到达判定也用 unitArriveRadius', 'unitArriveRadius(u)' in CMD, True)
ck('dev-panel.js：选中圈也用 unitArriveRadius', 'unitArriveRadius(sel)' in DP, True)

print()
if FAIL == 0:
    print('全部通过 ✓')
else:
    print('%d 项失败 ✗' % FAIL)
sys.exit(1 if FAIL else 0)
