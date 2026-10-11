# -*- coding: utf-8 -*-
"""R6 之二：建筑必须对「规划」可见（否则规划穿村、校验标红）

用户实测："这个寻路根本没有使用到马路啊，他直接就画了一条前往目的地的直线。"
根因：`canStandAt`（校验/执行）把建筑当墙，而 `navcBuildGrid`（规划）**只读地形瓦片**
     ⇒ 规划认为村里是空地、直着最省 ⇒ 路线穿房 ⇒ 校验把那段标红。
本文件做两件事：
  ① 与 JS 同算法复刻 buildingMask / navcBuildGrid，断言"建筑挡住的就是受阻的"，
     并且 pin 住"没有掩膜的老行为会判可通过"（回归）
  ② 静态守卫：直接在源码里断言关键句还在（防止以后被改回去）
"""
import sys, io, math, os, random
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

fails = 0
def ck(name, got, exp):
    global fails
    ok = (got == exp)
    if not ok: fails += 1
    print(("  ok   " if ok else "  FAIL ") + f"{name}: {got}（期望 {exp}）")

HERE = os.path.dirname(os.path.abspath(__file__))
def src(rel):
    with io.open(os.path.join(HERE, rel), 'r', encoding='utf-8') as f:
        return f.read()


# ============================================================
# 1) 建筑掩膜（buildingMask 复刻：矩形覆盖 ⇒ 保守，占地格全标 1）
# ============================================================
CS = 5
def building_mask(gw, gh, cs, blds):
    m = [0] * (gw * gh)
    for (bx, by, bw, bh) in blds:
        x0 = max(0, int(math.floor(bx / cs))); x1 = min(gw - 1, int(math.floor((bx + bw) / cs)))
        y0 = max(0, int(math.floor(by / cs))); y1 = min(gh - 1, int(math.floor((by + bh) / cs)))
        for gy in range(y0, y1 + 1):
            for gx in range(x0, x1 + 1): m[gy * gw + gx] = 1
    return m

def in_building(blds, x, y):
    for (bx, by, bw, bh) in blds:
        if bx <= x <= bx + bw and by <= y <= by + bh: return True
    return False

def cell_mask(m, gw, cs, x, y):
    gx, gy = int(x // cs), int(y // cs)
    return m[gy * gw + gx]

GW, GH = 200, 120                      # 1000m × 600m @5m
BLDS = [(200, 200, 30, 20), (500, 300, 60, 45), (120, 500, 25, 25)]
mask = building_mask(GW, GH, CS, BLDS)

print("== 1. 掩膜与 isPointInBuilding 完全一致（逐点采样 6000 点）==")
random.seed(7)
miss = 0; checked = 0
for _ in range(6000):
    bx, by, bw, bh = BLDS[_ % len(BLDS)]
    x = bx + random.random() * bw
    y = by + random.random() * bh
    checked += 1
    if not in_building(BLDS, x, y): continue
    if not cell_mask(mask, GW, CS, x, y): miss += 1
ck("建筑内任意点所在细格都被标记（漏标数）", miss, 0)
ck("采样数合理", checked, 6000)

print("== 2. 掩膜只多标一圈（保守但不过分）==")
extra = 0
for gy in range(GH):
    for gx in range(GW):
        if not mask[gy * GW + gx]: continue
        # 该格矩形必须与某栋建筑「相交或贴边」（否则就是乱标）
        rx, ry = gx * CS, gy * CS
        hit = False
        for (bx, by, bw, bh) in BLDS:
            if rx <= bx + bw and rx + CS >= bx and ry <= by + bh and ry + CS >= by: hit = True; break
        if not hit: extra += 1
ck("被标记的格全部与建筑矩形相交/贴边（没有乱标）", extra, 0)
per = [((bw // CS) + 2) * ((bh // CS) + 2) for (_, _, bw, bh) in BLDS]
total_mask = sum(mask)
ck("标记格数 ≤ Σ(占地格 + 一圈外扩)", total_mask <= sum(per), True)

print("== 3. 规划粗格（navcBuildGrid 复刻）：建筑让格子「不再是空地」==")
NAVC_CELL = 25; BLOCK_RATIO = 0.45
def nav_cell_bad(nx, ny, use_mask):
    """返回 (bad, tot)：bad = 不可通行子格数（含建筑）"""
    y0 = int(math.floor(ny * NAVC_CELL / CS)); y1 = int(math.ceil((ny + 1) * NAVC_CELL / CS))
    x0 = int(math.floor(nx * NAVC_CELL / CS)); x1 = int(math.ceil((nx + 1) * NAVC_CELL / CS))
    bad = tot = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            tot += 1
            b = use_mask and mask[y * GW + x]
            if b: bad += 1
    return bad, tot

# 一栋 30×20 的房子正好压在一个 25m 粗格里（草地）
bx, by, bw, bh = BLDS[0]
nx, ny = bx // NAVC_CELL, by // NAVC_CELL
bad_new, tot = nav_cell_bad(nx, ny, True)
bad_old, _ = nav_cell_bad(nx, ny, False)
ck("有掩膜：该格不可通行子格比例 > 45%", bad_new / tot > BLOCK_RATIO, True)
ck("（对照）没有掩膜的老行为：0% ⇒ 判「空地可走」（这就是穿村的来源）", bad_old, 0)
ck("★ 老行为会判这格对步兵可通行：", (bad_old / tot > BLOCK_RATIO), False)
ck("★ 新行为判这格对步兵不可通行：", (bad_new / tot > BLOCK_RATIO), True)


# ============================================================
# 4) 静态守卫：关键句子必须在源码里（防止被改回去）
# ============================================================
print("== 4. 静态守卫（源码里必须还在的关键句）==")
gm_js = src(os.path.join('..', 'js', 'grid-maps.js'))
me_js = src(os.path.join('..', 'js', 'map-editor.js'))

ck("规划粗格用上了建筑掩膜", 'const mask = buildingMask(gm);' in gm_js, True)
ck("子格里建筑参与「能不能过」（与 canStandAt 同源）",
   ('const bld = mask ? mask[row + x] : 0;' in gm_js) and ('marchMulForTile(mob, t, ti)' in gm_js)
   and ('if (mv <= 0) badBy[mob]++;' in gm_js), True)
ck("导航缓存键含建筑签名（加/删房子必须失效）", 'cached.bldSig === bldSig' in gm_js, True)
ck("A* 斜向不切角", 'if (dx && dy && (!pass[i + dx] || !pass[i + dy * gw])) continue;' in gm_js, True)
ck("公路路网图存在", 'function roadGraph(gm) {' in gm_js, True)
ck("R7 行军规划器存在（唯一入口）", 'function planMarchRoute(gm, cls, sx, sy, gx, gy) {' in gm_js, True)
ck("沿公路行走（路网 Dijkstra + 虚拟接入点）", 'function marchViaRoad(gm, cls, specFrom, specTo) {' in gm_js, True)
ck("交点切开折线", 'function roadInsertPts(pts, adds) {' in gm_js, True)
ck("退让阶梯：接入点按时间升序逐个试",
   ('candIn.sort((a, b) => a.t - b.t);' in gm_js) and ('const inTry = candIn.slice(0, MARCH_ACCESS_TRY);' in gm_js), True)
ck("细修路点存在（把压在障碍上的点挪出来）", 'function navcRelaxPolyline(gm, pts, cls, tier) {' in gm_js, True)
ck("第一步/最后一步用放宽档", "const TIER = 'access';" in gm_js, True)
ck("战斗里的 terrainMobilityMulFor 仍委托给唯一表",
   'return mobilityMulForTile(mt, tg);' in src(os.path.join('..', 'js', 'battle.js')), True)
bt_js = src(os.path.join('..', 'js', 'battle.js'))
ck("运行时：乘车身份在**命令级**定下（车能到目标 ⇒ ride）",
   ('unit._ridePlanOk = !!plan;' in bt_js)
   and ("unit._rideMode = unit._ridePlanOk ? 'ride' : 'foot';" in bt_js), True)
# ★ R7.1：机动身份只能有**一个**决策者 —— 治"上车↔下车"来回切（三种寻路模式抖动）
ck("唯一机动决策者：unitWantsRide 已删除（判据全并入 updateRideMode）",
   ('function unitWantsRide' not in bt_js)
   and ('function updateRideMode(unit, goalX, goalY, force) {' in bt_js), True)
ck("决策结果只有一处产出 `_rideWant`，上车点只读它",
   ('unit._rideWant = (unit._rideMode' in bt_js)
   and ('const want = updateRideMode(unit,' in bt_js)
   and ('unitWantsRide(unit)' not in bt_js), True)
ck("卡墙不再清空路线、也不再申请换路（R7.5.1：就地解决）",
   ('// 强制重算流场路径' not in bt_js)
   and (bt_js.count('unit._navAskAt = battle.time;') == 1)
   and ('unit._holdMoveUntil = battle.time + 2;' in bt_js), True)
# ★ R7.5：命令级承诺 + 道路预设动画（车道）—— 治"每几秒重算 ⇒ 上下车/路线乱切"
ck("命令级承诺：只在命令变更时重算（周期重算已删）",
   ('const NAV_CMD_DEST_DRIFT' in bt_js) and ('function navCmdKeyOf(unit) {' in bt_js)
   and ('function navJitterOf' not in bt_js) and ('sinceNav > NAV_ROUTE_RECHECK' not in bt_js), True)
ck("身份的贵判据只在命令变更时算一次（force 参数）",
   ('function updateRideMode(unit, goalX, goalY, force) {' in bt_js)
   and ('if (force || unit._ridePlanOk == null) {' in bt_js), True)
ck("R7.4 那批补丁已彻底删除（不留半成品）",
   ('function navRebasePlan' not in bt_js) and ('function navOffPolylineDist' not in bt_js)
   and ('unit._navKeepPlan' not in bt_js) and ('unit._navKeepUntil' not in bt_js)
   and ('unit._engagedSticky' not in bt_js) and ('unit._navNearMode' not in bt_js)
   and ('const NAV_MODE_CONFIRM' not in bt_js) and ('const MARCH_MIN_MARCH' not in bt_js), True)
ck("预设动画：车道规格（车辆单列居中 / 步兵两列贴肩 / 路窄退化单列）",
   ('function laneSpecFor(cls, roadW) {' in gm_js) and ('const LANE_VEH_GAP = 20;' in gm_js)
   and ('const LANE_FOOT_GAP = 8;' in gm_js) and ('const LANE_FOOT_MIN_W = 12;' in gm_js), True)
ck("预设动画：中线弧长 / 车道取点 / 落点计算（缓存 + 游标）",
   ('function polylineArc(' in gm_js) and ('function lanePointAt(' in gm_js)
   and ('function laneStationOf(' in gm_js) and ('function updateLaneSlots(unit) {' in bt_js)
   and ('function laneCursor(pts, arc) {' in bt_js), True)
ck("预设动画：上路后**朝向强制 = 道路方向**（治车辆互相挤）",
   ('v._laneFacing = Math.atan2(-p.nx, p.ny);' in bt_js)
   and ('if (onLane) v.facing = slotOverride._laneFacing;' in bt_js), True)
ck("预设动画：车道上不侧移 / 不跑分离（成员由弧长定，顺带省 O(n²)）",
   ('} else if (!onLane) {' in bt_js)
   and ('if (!unit.mounted && !unit._onLane) separateSoldiersLocal(unit, dt);' in bt_js)
   and ('!unit._onLane) separateVehiclesLocal(unit, dt);' in bt_js), True)
ck("受阻不再申请重算（就地解决）；真要换路每 60 秒最多一次",
   ('const NAV_ROUTE_FAIL_COOLDOWN = 60;' in bt_js)
   and (bt_js.count('unit._navStuck = true;') == 1), True)
ck("预设动画：车辆按纵列位走（slotOverride 接到 moveVehicleToward）",
   ('function moveVehicleToward(unit, v, actualTarget, dt, slotOverride) {' in bt_js)
   and ('moveVehicleToward(unit, v, actualTarget, dt, lv);' in bt_js), True)
ck("路网边带路宽 + 车道宽取沿途最窄",
   ('w: L.w || ROAD_DEFAULT_W' in gm_js) and ('laneW: road.laneW || ROAD_DEFAULT_W' in gm_js), True)
ck("编辑器：加/删建筑后仍会重算路线有效段（兼容壳，待删 UI）", me_js.count('revalidateAllRoutes();') >= 4, True)

for nm, txt in (('grid-maps.js', gm_js), ('map-editor.js', me_js),
                ('battle.js', src(os.path.join('..', 'js', 'battle.js')))):
    ck(nm + ' 括号平衡', txt.count('{') - txt.count('}'), 0)

print('')
print('%s' % ('全部通过 ✓' if fails == 0 else f'{fails} 项失败 ✗'))
sys.exit(0 if fails == 0 else 1)
