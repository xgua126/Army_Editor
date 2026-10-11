# -*- coding: utf-8 -*-
"""mobility_core_test.py —— R8「寻路层整体删除 + 手动操控」的静态回归

背景：R3~R7.8 叠了 25 个寻路/车道/身份/预算/诊断函数（A* 粗格 + 路网 Dijkstra +
车道预设动画 + 命令指纹 + 帧预算 + 错峰），玩家实测"抽搐 / 周期性整场静止 / 寻不对"。
R8 把这一层**整体删除**，移动回到「朝目标直线走 + 被挡就找绕行点」，
并新增 DEV 手动操控（?dev=1）用来单独验证执行层。

守住三件事：
  ① 旧寻路层**真的没了**（符号级，防"删一半"）
  ② 保留的机制还在（地形速度表 / 公路数据 / 绕行 / 分离 / 朝向平滑）
  ③ 手动操控链路完整（battle.js 钩子 → dev-panel.js → battle.html 引入）

跑法：python -X utf8 tools/mobility_core_test.py
"""
import sys, io, os, re, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
JS = os.path.join(ROOT, 'js')

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

BT = read(os.path.join(JS, 'battle.js'))
GM = read(os.path.join(JS, 'grid-maps.js'))
ME = read(os.path.join(JS, 'map-editor.js'))
DP = read(os.path.join(JS, 'dev-panel.js'))
CD = read(os.path.join(JS, 'cmd.js'))          # ★ R9 命令层
GN = read(os.path.join(JS, 'ai-general.js'))   # ★ R9 将军层
BH = read(os.path.join(ROOT, 'battle.html'))
MH = read(os.path.join(ROOT, 'map-editor.html'))
EQ = read(os.path.join(JS, 'equipment.js'))     # ★ R9.6.9 装备种子/迁移
_DLGP = os.path.join(JS, 'dialog.js')           # ★ R9.6.11 自定义弹窗
DLG = read(_DLGP) if os.path.exists(_DLGP) else ''
UI = read(os.path.join(JS, 'ui.js'))            # ★ R9.6.11 弹窗统一

fails = 0
def ck(name, got, exp=True):
    global fails
    ok = (got == exp)
    if not ok:
        fails += 1
    print(('  ok   ' if ok else '  FAIL ') + '%s：%s（期望 %s）' % (name, got, exp))

def has(src, s):  return s in src
def none(src, names):
    bad = [n for n in names if n in src]
    return '无残留' if not bad else ('残留:' + ','.join(bad))

print('== 1. 旧寻路层已整体删除（符号级） ==')
ck('grid-maps：规划器 / A* / 路网 / 车道 / 兼容壳全无',
   none(GM, ['planMarchRoute', 'navcAStar', 'navcBuildGrid', 'navFor(', 'navcCellsToWaypoints',
             'navcDedupe', 'navcRelaxPolyline', 'navcPolylineTime', 'polylinePassable',
             'canStandAt', 'canCrossSegment', 'marchLeg', 'marchViaRoad', 'marchRoadProjection',
             'marchApproxTime', 'roadGraph', 'roadEdgeInfo', 'roadSegCross', 'roadInsertPts',
             'simplifyPolyline', 'laneSpecFor', 'polylineArc', 'lanePointAt', 'laneStationOf',
             'laneDistTo', 'MARCH_TABLE', 'marchMulForTile', 'bldSignature', 'buildingMask',
             'ROUTE_MOBS', 'ensureRoutes', 'normalizeRoutes', 'routeBadSegments',
             'refreshRouteValid', 'bakeRoutes', 'NAVC_CELL']), '无残留')
ck('battle.js：路线状态 / 车道 / 身份预算 / 诊断面板全无',
   none(BT, ['_navPath', '_navHasRoute', '_navCmdKey', '_navFailAt', '_navStuck',
             'planMarchRoute', 'navPlanBudgetTake', 'navPhaseOf', 'navCmdKeyOf',
             'updateLaneSlots', 'laneCursor', '_laneX', '_laneY', '_onLane', '_laneOK',
             'unit.moveMode', 'recordNavState', 'navHistPush', 'dumpNavHist', 'drawNavPanel',
             'drawNavBadges', 'drawNavDebugPaths', 'navCostCanvas',
             'findMobilityFriendlyWaypoint', 'canStandAt', 'NAV_BUDGET',
             'NAV_PLAN_MS_PER_FRAME', 'NAV_IDLE_CLEAR_SEC', 'NAV_FAIL_RETRY_SEC']), '无残留')
ck('编辑器 JS：路线 UI 的调用点全无',
   none(ME, ['revalidateAllRoutes', 'refreshRouteList', 'drawRouteOverlay', 'ensureRoutes',
             'refreshRouteValid', 'routeBadSegments', 'normalizeRoute(', 'bakeRoutes',
             'routeEsc', 'nearestRouteVertex', 'routeDraw', 'routeMobView']), '无残留')
ck('编辑器 HTML：路线工具与面板已移除',
   (not has(MH, 'data-tool="route"')) and (not has(MH, 'btn-route-bake'))
   and (not has(MH, 'id="route-list"')), True)

print('== 2. 保留的机制还在 ==')
ck('地形速度表（改名保留）', has(GM, 'const TERRAIN_SPEED_TABLE = {'), True)
ck('唯一速度函数 mobilityMulForTile', has(GM, 'function mobilityMulForTile(mt, tg) {'), True)
ck('公路数据链路（编辑 / 渲染 / 地形格）',
   (has(GM, 'function buildRoadGrid(gm) {') and has(GM, 'function ensureRoadGrid(gm) {')
    and has(GM, 'function normalizeRoads(arr) {') and has(GM, 'function invalidateRoadGrid(gm) {')), True)
ck('局部避障（直线 + 绕行点）',
   (has(BT, 'function isStraightPathClear(x1, y1, x2, y2, stepSize) {')
    and has(BT, 'function findAvoidanceWaypoint(unit, targetX, targetY) {')), True)
ck('朝向平滑（按用户决定保留）',
   (has(BT, 'const NAV_TURN_RATE = {') and has(BT, 'function navTurnToward(cur, want, maxStep) {')), True)
ck('车队同速 + 车辆分离 + 单兵分离',
   (has(BT, 'function fleetSpeedFactor(unit) {') and has(BT, 'function separateVehiclesLocal(unit, dt) {')
    and has(BT, 'function separateSoldiersLocal(unit, dt) {')), True)
ck('车辆移动只有一个入口（无车道参数）',
   ('function moveVehicleToward(unit, v, actualTarget, dt) {' in BT)
   and ('slotOverride' not in BT), True)

print('== 3. 手动操控链路完整 ==')
ck('battle.js：手动目的地覆盖 moveTarget（DEV 单兵手动；玩家操控那一方除外）',
   has(BT, 'if (unit._manualDest && !isPlayerCtl(unit)) {'), True)
ck('battle.js：右键 / 左键点选钩子（纯观战时归 DEV；玩家操控时归玩家系统）',
   (has(BT, 'if (window.DevPanel && DevPanel.onRightDown(e)) return;')
    and has(BT, 'if (!st.moved && st.button === 0 && !battle.playerSide && window.DevPanel) DevPanel.onLeftClick(e);')), True)
ck('battle.js：右键菜单已屏蔽', has(BT, "canvas.addEventListener('contextmenu'"), True)
ck('battle.js：世界坐标下绘制标记', has(BT, 'if (window.DevPanel) DevPanel.drawWorldMarkers();'), True)
ck('dev-panel.js：默认开启（?dev=1 或未显式关闭）', has(DP, 'const DEV = /[?&]dev=1/.test(location.search)'), True)
ck('dev-panel.js：可关闭（?dev=0 / localStorage.mil_dev）', (('dev=0' in DP) and ('mil_dev' in DP)), True)
ck('dev-panel.js：卡顿取证（F8 + 面板按钮）',
   (has(DP, 'function dumpSlow() {') and has(DP, "e.key === 'F8'") and has(DP, '📋 卡顿取证')), True)
ck('battle.js：分段计时 + 慢帧取证 + 顶栏峰值',
   (has(BT, 'function profAdd(key, ms) {') and has(BT, 'battle._slowPeak = rec;')
    and has(BT, '峰值 ${pk.逻辑}ms')), True)
ck('battle.js：视野/密度**错峰**（不再全场同帧一起重算）',
   (has(BT, 'hashPhase(unit, 0.3)') and has(BT, 'hashPhase(unit, DENSITY_UPDATE_INTERVAL)')), True)
ck('battle.js：**空闲兜底已整段删除**（"永远有下一条命令"改由将军层保证）',
   (has(BT, '空闲兜底已整段删除') and ('nearestFreeObjective(' not in BT)
    and ('空闲兜底→据点' not in BT) and has(BT, 'snapTargetPassable')), True)
ck('battle.js：卡住停顿时**错峰**（不再全场同帧一起停）',
   (has(BT, 'unit._stuckPhase') and has(BT, 'unit._holdMoveUntil = battle.time + 0.35;')), True)
ck('battle.js：目标点不可通行 ⇒ 吸附到最近可通行处（治"车顶墙永久卡住"）',
   (has(BT, 'function snapTargetPassable(unit, mt) {')
    and has(BT, 'if (moveTarget) moveTarget = snapTargetPassable(unit, moveTarget);')), True)
ck('battle.js：顶栏显示"停止 N（原因×n）"', has(BT, '｜ 停止 ${idleN}'), True)
ck('dev-panel.js：显示选中单位的"为什么不动"', has(DP, '为什么不动：'), True)
ck('dev-panel.js：选中 / 下单 / 标记 / 单步',
   (has(DP, 'function pickUnit(cx, cy) {') and has(DP, 'function applyMove(wx, wy) {')
    and has(DP, 'function drawWorldMarkers() {') and has(DP, 'function stepOne() {')), True)
ck('dev-panel.js：暴露 window.DevPanel', has(DP, 'window.DevPanel = {'), True)
ck('dev-panel.js：不误用 window.battle / window.camera（顶层 let 不是 window 属性）',
   (('window.battle' not in DP) and ('window.camera' not in DP) and ('function hasBattle()' in DP)), True)
ck('battle.html 引入 dev-panel.js', has(BH, 'js/dev-panel.js'), True)

print('== 4. 速度表数值（行为镜像） ==')
m = re.search(r'const TERRAIN_SPEED_TABLE = \{(.*?)\n\};', GM, re.S)
ck('表可解析', bool(m), True)
if m:
    rows = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"\s*(\w+):\s*\{(.*)\},", line)
        if mm:
            rows[mm.group(1)] = {k: float(v) for k, v in re.findall(r"(\w+):\s*([0-9.]+)", mm.group(2))}
    ck('徒步全 1.00（不受地形影响）',
       all(abs(rows['foot'][k] - 1.0) < 1e-9 for k in ('empty', 'road', 'forest', 'hill', 'trench')), True)
    ck('轮式：公路 1.69 / 平地 0.60 / 树林 0（开不进去）',
       (rows['wheeled']['road'] == 1.69 and rows['wheeled']['empty'] == 0.60
        and rows['wheeled']['forest'] == 0.0), True)
    ck('履带：树林 0.51 / 丘陵 0.68 / 战壕 0.36',
       (rows['tracked']['forest'] == 0.51 and rows['tracked']['hill'] == 0.68
        and rows['tracked']['trench'] == 0.36), True)

print('== 5. 命令层 cmd.js + 将军层 ai-general.js（R9：只换这两层） ==')
ck('cmd.js：唯一入口 issue(src, gk, type, p)', has(CD, 'issue(src, gk, type, p) {'), True)
ck('cmd.js：11 种命令类型 + CMD_SPEC 门槛表（有炮才能火力任务 / 有车才能上下车）',
   (has(CD, "'RESUPPLY'") and has(CD, 'const CMD_SPEC = {') and has(CD, "needs: 'artillery'")
    and has(CD, "needs: 'vehicle'") and has(CD, "needs: 'supply'")), True)
ck('cmd.js：优先级 player > script > ai',
   (has(CD, "prev.src === 'player' && src !== 'player'") and has(CD, "prev.src === 'script' && src === 'ai'")), True)
ck('cmd.js：每帧完成判定（到达 / 目标已消灭 / 已进驻）',
   (has(CD, "o.doneReason = '到达';") and has(CD, "o.doneReason = '目标已消灭';")
    and has(CD, "o.doneReason = '已进驻';")), True)
ck('cmd.js：日志上限 200 + 完成命令 1 秒后回收（state 不无限增长）',
   (has(CD, 'maxLog: 200') and has(CD, 'battle.time - o._doneAt > 1') and has(CD, 'delete this.state[gk];')), True)
ck('cmd.js：unitsOf 按 unit._groupKey（命令粒度 = 组）',
   has(CD, "if (u.alive && u._groupKey === gk) out.push(u);"), True)

ck('ai-general.js：每方一个将军（blue / red）',
   (has(GN, 'const sides = {') and has(GN, 'blue: { nextThink:') and has(GN, 'red:  { nextThink:')), True)
ck('ai-general.js：思考间隔 3~6 秒', has(GN, 'const THINK_MIN = 3, THINK_MAX = 6;'), True)
ck('ai-general.js：每 tick 最多 8 条命令（摊帧，防新的同步尖峰）', has(GN, 'const MAX_ORDERS = 8;'), True)
ck('ai-general.js：兵力 < 30% ⇒ 全军固守', has(GN, 'const STRENGTH_HOLD = 0.30;'), True)
ck('ai-general.js：v1 三条规则（HOLD / ATTACK / MOVE_TO）',
   (has(GN, "type: 'HOLD'") and has(GN, "type: 'ATTACK'") and has(GN, "type: 'MOVE_TO'")), True)
ck('ai-general.js：只发"变化了"的命令 + 组轮转（不会每 3 秒重置全军计划）',
   (has(GN, 'if (same) continue;') and has(GN, 'st.cursor = (start + Math.max(1, issued)) % n;')), True)
ck('ai-general.js：**只调用 Cmd.issue，不碰执行层**（不写 objectiveId / 单位状态）',
   ('Cmd.issue(' in GN)
   and (re.search(r'objectiveId\s*=(?!=)', GN) is None)      # 只读 active.objectiveId，不赋值
   and none(GN, ['moveTarget', '_manualDest', 'separateSoldiers',
                 'setUnitMounted', 'unitFirepowerList']), '无残留')
ck('ai-general.js：暴露 window.General（battle.js 每帧调用）',
   (has(GN, 'window.General = {') and has(GN, "typeof battle !== 'undefined'")), True)
ck('ai-general.js：应急开关 ?gen=0（将军层完全停手，用于 A/B 对照）',
   (has(GN, 'const ENABLED = !/[?&]gen=0/.test(location.search);') and has(GN, 'if (!ENABLED) return null;')), True)

ck('battle.js：updateBattle 每帧调 Cmd.tick() + General.tick()（都 try/catch）',
   (has(BT, 'try { Cmd.tick(); } catch (e) {') and has(BT, 'window.General.tick();')), True)
ck('battle.js：命令 → 战术层唯一桥（mirrorGroupObjective / groupOrderOf）',
   (has(BT, 'function mirrorGroupObjective(groupKey, objectiveId) {')
    and has(BT, 'function groupOrderOf(unit) {')), True)
ck('battle.js：命令 HOLD ⇒ 原地（不再被旧的目标分配拽走）', has(BT, "if (gord0.type === 'HOLD') {"), True)
ck('battle.js：命令给的据点不参与旧的重新评估（防漂移）',
   (has(BT, 'if (!targetObj && !groupState.cmdObjId) {')
    and has(BT, 'groupState.cmdObjId && groupState.cmdObjId === found._id')), True)
ck('battle.js：组级 ATTACK 带"敌情位置"（看不见敌人的单位也知道往哪推）',
   has(BT, "gord.type === 'ATTACK' && gord.x != null"), True)
ck('battle.js：卡太久（>6 秒）**上报命令层**（不永久顶墙）',
   has(BT, "Cmd.clear(co.groupKey || unit._groupKey, '单位卡住 >6 秒（'"), True)
ck('dev-panel.js：面板显示选中单位的"组令"（验证命令层最直接的窗口）',
   (has(DP, "function groupCmdLabel(u) {") and has(DP, "groupCmdLabel(sel)")), True)
ck('battle.html：battle.js **之后**引入 cmd.js / ai-general.js（避开顶层 let 的 TDZ）',
   (BH.index('js/battle.js') < BH.index('js/cmd.js') < BH.index('js/ai-general.js')), True)

print('== 6. 文件规模（信息） ==')
for name in ('battle.js', 'grid-maps.js', 'map-editor.js', 'dev-panel.js', 'cmd.js', 'ai-general.js'):
    print('  ·  %s  %d 行' % (name, read(os.path.join(JS, name)).count('\n') + 1))
print('  （括号平衡 / 未定义引用由 tools/undef_refs_scan.py 负责 —— 它带完整词法器）')

print('== 7. 字符串字面量体检（治"一个没转义的引号 ⇒ 整个文件解析失败"） ==')
import subprocess, tempfile
LIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js_literal_check.py')
def run_lit(args):
    return subprocess.run([sys.executable, '-X', 'utf8', LIT] + args,
                          capture_output=True, text=True, encoding='utf-8',
                          errors='replace', cwd=ROOT)
r = run_lit([])
ck('js/*.js 全部通过（无未闭合字符串 / 无"闭合后紧跟标识符"）', r.returncode, 0)
if r.returncode:
    print(r.stdout)
r2 = run_lit(['--lines', os.path.join(JS, 'changelog.js')])
ck('changelog.js：逐行引号配平（用户手写更新日志的守卫）', r2.returncode, 0)
if r2.returncode:
    print(r2.stdout)
# ★ 自检：把 1.7.3 那条事故原文（`stance==='static'`）喂进去，**必须**报错 ——
#   否则这个守卫就是个永远绿灯的摆设。顺便证明"3 个报错其实来自 1 个字符"。
badfile = os.path.join(tempfile.gettempdir(), '_mil_lit_bugtest.js')
bad = ("const V = '1.0.0';\nconst CHANGELOG = [\n"
       "  '定位：`stance==='static'` 把机动身份判据推翻',\n"
       "];\n")
with io.open(badfile, 'w', encoding='utf-8') as f:
    f.write(bad)
r3 = run_lit(['--lines', badfile])
ck('自检：裸引号样例**必须**被抓到（守卫是活的）', r3.returncode, 1)
try:
    os.remove(badfile)
except OSError:
    pass

print('== 8. R9.1：朝向约束（车 + 步兵"只能朝朝向走"±14°）+ 消除"走走停停" ==')
ck('朝向锥：±14° 常量 + cone / project / paceMul 三个函数',
   (has(BT, 'const HEADING_LAT_TAN = 0.25;') and has(BT, 'function headingConeDir(dx, dy, facing) {')
    and has(BT, 'function headingProject(dx, dy, facing) {') and has(BT, 'function paceMulOf(unit) {')), True)
ck('步兵走位过朝向锥（不再朝槽位任意斜着飘）',
   has(BT, 'const cone = headingConeDir(sdx / sd, sdy / sd, unit.facing);'), True)
ck('车体横向修正 ≤ ±14°（旧值 lat*0.7 ≈ ±40° 已删）',
   (has(BT, 'const lat = Math.max(-fwdComp * HEADING_LAT_TAN') and ('lat * 0.7' not in BT)), True)
ck('车被挡不再"纯侧移"，改成"打方向 + 沿车头走"',
   has(BT, 'const wantF2 = Math.atan2(dy * 0.5 + perpY * ss'), True)
ck('分离力横向压到 1/4（车辆 + 士兵都过投影）',
   (BT.count('headingProject(') >= 3), True)
ck('压制段不再"停 1.8 秒"，改为**减速 25% 继续走**',
   (has(BT, 'if (!inMove) { unit._paceMul = 0.25;') and ('压制段：站住打' not in BT)), True)
ck('打不到时不停在原地（继续推进到交战距离）',
   (has(BT, "if (canShoot) { unit._aiWhy = '就地据守开火'; return null; }")
    and has(BT, 'unit._paceMul = 0.6;')), True)
ck('绕行点过期 0.8 → 3 秒（去掉"一抽一抽"）',
   (has(BT, 'expiresAt: battle.time + 3,') and ('expiresAt: battle.time + 0.8' not in BT)), True)
ck('卡住停顿 1.2 → 0.35 秒（只当擦墙打滑）', has(BT, 'unit._holdMoveUntil = battle.time + 0.35;'), True)
ck('行进节流每帧复位（不泄漏到下一帧）', has(BT, 'unit._paceMul = 1;'), True)

ck('dev-panel.js：隐藏面板 = 本次会话（不影响 DEV 本身）',
   (has(DP, "let hidden = ssGet('mil_dev_hidden') === '1';") and has(DP, 'function setHidden(h) {')), True)
ck('dev-panel.js：浮动 DEV 小标签（隐藏后点得回来）',
   (has(DP, 'elTab = el(') and has(DP, "elTab.addEventListener('click', () => setHidden(false));")), True)
ck('dev-panel.js：Ctrl+Shift+D 无条件开关（面板不存在也能救回来）',
   (has(DP, "e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')")
    and has(DP, 'if (!DEV) { forceEnableDev(); return; }')), True)
ck('dev-panel.js：彻底关闭要点两次（不弹原生 confirm）',
   (has(DP, 'offArmed') and ('confirm(' not in DP)), True)
ck('dev-panel.js：一次性迁移（自动解开旧版"关 DEV"造成的永久锁死）',
   (has(DP, "lsGet('mil_dev') === '0' && !lsGet('mil_dev_fix_r91')") and has(DP, "lsSet('mil_dev_fix_r91', '1')")), True)
ck('dev-panel.js：面板显示"节流 %"（验证走走停停是否真消失）', has(DP, "' · 节流 '"), True)

print('== 9. R9.2：补给点 / 弹药闭环 / 命令接口 v1 / 战法上移 / 快速移动 / L1 速度 ==')
GM2 = read(os.path.join(JS, 'grid-maps.js'))
ME2 = read(os.path.join(JS, 'map-editor.js'))

ck('③ 补给点数据：normalizeSupplies / makeSupply / autoSupplies',
   (has(GM2, 'function normalizeSupplies(arr) {') and has(GM2, 'function makeSupply(x, y, r, name) {')
    and has(GM2, 'function autoSupplies(gm) {') and has(GM2, 'const SUPPLY_DEFAULT_RADIUS = 120;')), True)
ck('③ 补给点进序列化 / 反序列化 / 新建地图',
   (has(GM2, 'supplies: normalizeSupplies(obj.supplies),') and has(GM2, 'supplies: (gm.supplies || []).map(s => ({')
    and has(GM2, 'supplies: [],')), True)
ck('③ 战场：地图没配 ⇒ 自动放两个 + 圈内 ≥3 秒 ⇒ 每秒 +20%',
   (has(BT, 'battle.supplies = (gm.supplies && gm.supplies.length) ? normalizeSupplies(gm.supplies) : autoSupplies(gm);')
    and has(BT, 'const RS_DWELL = 3.0;') and has(BT, 'const RS_RATE  = 0.20;')
    and has(BT, 'function updateResupply(unit, dt) {') and has(BT, 'updateResupply(unit, dt);')), True)
ck('③ 补给点绘制 + 顶栏"补给中 N"',
   (has(BT, 'function drawSupplies() {') and has(BT, 'drawSupplies();')
    and has(BT, "' · 补给中 '")), True)
ck('③ cmd.js：RESUPPLY（完成判定 = 备弹 ≥90%）',
   (has(CD, "o.type === 'RESUPPLY'") and has(CD, "o.doneReason = '弹药已补满';")), True)
ck('③ 将军规则：组平均备弹 < 20% ⇒ 去补给点',
   (has(GN, 'const AMMO_RESUPPLY = 0.20;') and has(GN, 'function groupAmmo(us) {')
    and has(GN, "want = { type: 'RESUPPLY', supplyId: sup.id")), True)
ck('③ 执行层：RESUPPLY 命令 ⇒ 去补给点、进圈就停',
   has(BT, "if (gord0.type === 'RESUPPLY') {"), True)

ck('④ 命令接口：tryIssue 唯一安全入口 + 装备门槛 + 拒绝',
   (has(CD, 'tryIssue(src, gk, type, p) {') and has(CD, '_groupHas(us, what) {')
    and has(CD, '_reject(src, type, reason) {') and has(CD, 'this.toast = { msg, until: battle.time + 2 };')), True)
ck('④ 拒绝机制：玩家"普通移动"走不到 ⇒ 拒绝 + 提示改用快速移动',
   has(CD, '直线方向过不去（试试「快速移动」沿公路走）'), True)
ck('④ 快速移动：最近公路投影 → 沿折线 → 直线收尾（不做 A*）',
   (has(BT, 'function projectOnSeg(x, y, a, b) {') and has(BT, 'function nearestRoadPoint(gm, x, y) {')
    and has(BT, 'function planFastRoute(unit, tx, ty) {')), True)
ck('④ mover 消费路点表（走到 40m 内就 pop）',
   has(BT, 'if (gord && gord.fast && gord.route && gord.route.length && !unit._manualDest) {'), True)
ck('④ 红字上屏 2 秒（顶栏 toast）', has(BT, 'Cmd.toast && Cmd.toast.until > battle.time'), True)

ck('⑤/E 战法由将军层定（执行层只读）',
   (has(GN, 'function pickStance(us, isDef) {') and has(GN, 'const STANCE_CN = {')
    and has(BT, 'const STANCE_TO_OPTION = {') and has(BT, 'function mirrorGroupStance(groupKey, stance) {')), True)
ck('⑤/E updateTacticalOption：有组战法就直接用（旧 utility 评分降为兜底）',
   (has(BT, 'const gsForStance = battle._groups && battle._groups[unit._groupKey];')
    and has(BT, 'unit._optionCommitUntil = battle.time + (OPTION_COMMIT[unit._option] || 4);')), True)
ck('⑤/E 旧"组级自动战法"让位（有带战法的命令时不抢写）',
   has(BT, 'if (!co || co.done || !co.stance) evaluateGroupStance(gk);'), True)
ck('⑤/E 战法随命令下发 + 战法变了要重发',
   (has(GN, '&& (w.stance ? active.stance === w.stance : true)') and has(CD, 'stance: p.stance || null,')), True)

ck('D-L1 步兵速度全队一次采样（不再逐人采样 ⇒ 队伍不被拉长）',
   (has(BT, 'function unitTerrainMulSample(unit) {') and has(BT, 'unitTerrainMulSample(unit);')
    and has(BT, "const sstep = Math.min(unit.speed * (unit._terrainMul == null ? 1 : unit._terrainMul)")), True)

ck('DEV 命令界面：作用域 + 命令类型下拉 + 右键执行 + 命令清单',
   (has(DP, 'const ORDER_KINDS = [') and has(DP, 'function applyOrder(wx, wy, forceFast) {')
    and has(DP, 'Cmd.tryIssue(\'player\', gk, type,') and has(DP, 'function renderCmdList() {')), True)
ck('DEV 命令界面：Shift+右键 = 快速移动 + 面板显示 战法/补给',
   (has(DP, 'applyOrder(w.x, w.y, e.shiftKey)') and has(DP, "function stanceLabel(u) {")
    and has(DP, "function supplyLabel(u) {")), True)

ck('编辑器：📦 补给点工具 + 面板 + 撤销历史 + 渲染',
   (has(ME2, "'supply': '📦 补给点'") and has(ME2, 'function placeSupplyAt(wx, wy) {')
    and has(ME2, 'function eraseSupplyAt(wx, wy) {') and has(ME2, 'function refreshSupplyPanel() {')
    and has(ME2, 'function bindSupplyPanel() {')
    and has(ME2, 'supplies: JSON.parse(JSON.stringify(currentMap.supplies || [])),')), True)
ck('编辑器 HTML：补给点工具按钮 + 面板齐备',
   (has(MH, 'data-tool="supply"') and has(MH, 'data-tool="erase-supply"')
    and has(MH, 'id="supply-radius"') and has(MH, 'id="supply-list"')), True)

print('== 10. R9.3：玩家命令必须"看得见效果"（修"点了没反应"） ==')
ck('battle.js：玩家 MOVE_TO / RESUPPLY / GARRISON 带坐标 ⇒ 直接去那个点（不再被忽略）',
   has(BT, "if ((gord.type === 'MOVE_TO' || gord.type === 'RESUPPLY' || gord.type === 'GARRISON') && gord.x != null) {"), True)
ck('battle.js：玩家 HOLD ⇒ 固守（不许自己冲上去）',
   has(BT, "unit._cmdWhy = '玩家命令：固守';"), True)
ck('battle.js：玩家 TAKE_COVER / WITHDRAW 生效',
   (has(BT, "unit._cmdWhy = '玩家命令：找掩体（附近没有可用掩体）';")
    and has(BT, "} else if (gord.type === 'WITHDRAW') {")
    and has(BT, "ex = unit.x + (unit.x - e.x) / d * 500;")), True)
ck('battle.js：玩家 上车/下车 覆盖 AI 的 updateRideMode（否则每帧又被切回去）',
   (has(BT, "if (gord && !gord.done && gord.src === 'player' && (gord.type === 'BOARD' || gord.type === 'DISMOUNT')) {")
    and has(BT, 'want = (gord.type === \'BOARD\');')), True)
ck('dev-panel.js：命令目标点画虚线 + ✕ + 中文命令名（右键后有反馈）',
   (has(DP, '命令层的目标点也要画出来')
    and has(DP, "g.strokeStyle = isSel ? 'rgba(250,204,21,0.95)' : 'rgba(96,165,250,0.45)';")), True)
ck('ai-general.js：被玩家命令挡住时不占将军的"名额"',
   has(GN, "if (ord2 && ord2.src === 'ai') {"), True)

print('== 11. R9.4：修"给 AI 下车命令 ⇒ 整页卡死" ==')
ck('battle.js：士兵分离改成**空间网格**（不再 O(k²)）',
   (has(BT, 'const grid = unit._sepGrid || (unit._sepGrid = new Map());')
    and has(BT, 'const pool = unit._sepPool || (unit._sepPool = []);')
    and has(BT, 'grid.get(((cx + ox) * 73856093) ^ ((cy + oy) * 19349663))')
    and has(BT, '装桶（复用数组，零分配）')), True)
# ★ 只在 separateSoldiersLocal 的函数体里查"旧的双层循环"（separateVehiclesLocal 里那个 k≤40 的保留）
_ss = BT.index('function separateSoldiersLocal(unit, dt) {')
ck('battle.js：separateSoldiersLocal 内已无"和全部士兵逐个比"的双层循环',
   ('for (let j = 0; j < list.length; j++)' not in BT[_ss:_ss + 3500]), True)
ck('cmd.js：命令看门狗（ORD_TIMEOUT，超时按完成处理）',
   (has(CD, 'const ORD_TIMEOUT = {') and has(CD, "o.doneReason = '超时 ' + tmo + 's';")
    and has(CD, 'BOARD: 20, DISMOUNT: 20')), True)
ck('battle.js：上下车失败退避（不再每 0.4 秒重试重活）',
   (has(BT, "&& battle.time - (unit._mountFailAt || -9999) > 2.5) {")
    and has(BT, 'unit._mountFails = (unit._mountFails || 0) + 1;')), True)

# ★ 复杂度镜像：把"旧 O(k²)"和"新网格"在同一批士兵位置上各数一遍"比较次数"
import math as _m
def _sep_pairs_brute(k):
    return k * (k - 1)
def _sep_pairs_grid(k, R=12.0, spread=110.0):
    side = int(_m.ceil(_m.sqrt(k)))
    step = spread / side
    cells, pts = {}, []
    for i in range(k):
        x = (i % side) * step
        y = (i // side) * step
        pts.append((x, y))
        cells.setdefault((int(x / R), int(y / R)), []).append(i)
    n = 0
    for (x, y) in pts:
        cx, cy = int(x / R), int(y / R)
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                n += len(cells.get((cx + ox, cy + oy), ()))
    return n
_pb, _pg = _sep_pairs_brute(240), _sep_pairs_grid(240)
ck('分离算法复杂度：240 兵时 网格比较数 ×4 < 旧 O(k²)（%d → %d）' % (_pb, _pg), _pg * 4 < _pb, True)

print('== 12. R9.5：简易玩家操控系统（我操控哪一方 ⇒ 那一方将军让位） ==')
ck('battle.js：玩家操控状态（playerSide / aiEnabled / selection / curOrder）',
   (has(BT, "playerSide: 'blue',") and has(BT, 'aiEnabled: { blue: true, red: true },')
    and has(BT, 'selection: [],') and has(BT, "curOrder: 'MOVE_TO',")), True)
ck('battle.js：setPlayerSide ⇒ 关掉那一方 AI + 清掉它遗留的 AI/玩家命令',
   (has(BT, 'function setPlayerSide(side, silent) {')
    and has(BT, 'battle.aiEnabled[battle.playerSide] = false;')
    and has(BT, "if (gk.indexOf(battle.playerSide + '|') === 0) { Cmd.clear(gk, '玩家接管'); continue; }")), True)
ck('ai-general.js：玩家操控的阵营，将军**完全不管**',
   has(GN, 'if (battle.aiEnabled && battle.aiEnabled[side] === false) continue;'), True)
ck('battle.js：左键框选 / 点选（只选自己那一方）',
   (has(BT, 'function selectBox(x0, y0, x1, y1, add) {')
    and has(BT, 'function selectClick(sx, sy, add) {')
    and has(BT, 'function ownUnits() {')), True)
ck('battle.js：右键下达 + 按组下达 + 需要点的命令校验（攻击不带点 ⇒ 自动瞄最近敌人）',
   (has(BT, 'function execPlayerOrder(kind, wx, wy, targetId) {')
    and has(BT, 'const ORDERS_NEED_POINT = { MOVE_TO: 1, MOVE_TO_FAST: 1, GARRISON: 1, FIRE_MISSION: 1 };')
    and has(BT, "if (type === 'ATTACK' && wx == null && battle.selection.length) {")
    and has(BT, "const res = Cmd.tryIssue('player', 'u:' + u.id, type,")), True)
ck('battle.js：数字键 1~9 / 0 选命令 · Esc 取消 · 中键或 Alt+左键平移',
   (has(BT, 'const ORDER_KEYMAP = {')
    and has(BT, 'const wantPan = (e.button === 1) || (e.button === 0 && e.altKey) || (e.button === 0 && !playable);')
    and has(BT, 'if (ORDER_KEYMAP[e.key]) { setCurOrder(ORDER_KEYMAP[e.key]); return; }')), True)
ck('battle.js：选中圈 + 框选矩形 + 命令提示',
   (has(BT, 'function drawPlayerSelection() {') and has(BT, 'function drawPlayerOverlay() {')
    and has(BT, 'drawPlayerSelection();') and has(BT, 'drawPlayerOverlay();')), True)
ck('battle.js：新一局清空命令层与选中（不会拿上一局的命令指挥新部队）',
   (has(BT, "if (typeof Cmd !== 'undefined') Cmd.state = {};") and has(BT, 'battle.selection = [];')), True)
ck('battle.js：诊断行 / 图例**默认关**（收进「👁 显示」）',
   (has(BT, 'if (battle.sh.diag) {') and has(BT, 'if (battle.sh.legend) drawLegend();')
    and has(BT, 'sh: { legend: false, diag: false },')), True)
ck('dev-panel.js：玩家操控模式下不再画 DEV 标记（不互相干扰）',
   (has(DP, 'if (hasBattle() && battle.playerSide) return;') and has(DP, '本面板按钮照旧可用')), True)
ck('battle.html：玩家阵营选择 + 命令条 + 显示弹层',
   (has(BH, 'id="player-side"') and has(BH, 'id="cmdbar"') and has(BH, 'id="display-pop"')
    and has(BH, 'data-order="MOVE_TO_FAST"') and has(BH, 'id="opt-ai-blue"')), True)

print('== 13. R9.5b：玩家操控 ⇒ **执行层彻底放手**（修"明明我操控它们还自己动/命令被覆盖"） ==')
ck('battle.js：isPlayerCtl（我带它 + 没交回 AI）', 
   (has(BT, 'function isPlayerCtl(u) {')
    and has(BT, "if (!battle.playerSide || !u || u.side !== battle.playerSide) return false;")
    and has(BT, 'if (battle.aiEnabled && battle.aiEnabled[u.side]) return false;')), True)
ck('battle.js：执行层放手 —— 有命令照命令走 / 没命令原地待命（最后一步强制）',
   (has(BT, 'if (isPlayerCtl(unit)) {')
    and has(BT, 'const live = (gord && gord.src === \'player\' && !gord.done) ? gord : null;')
    and has(BT, "unit._idleWhy = '玩家操控：没有命令 ⇒ 原地待命")
    and BT.index('if (isPlayerCtl(unit)) {') > BT.index('if (moveTarget) moveTarget = snapTargetPassable(unit, moveTarget);')), True)
ck('battle.js：HOLD/上车/下车/战法/火力任务 ⇒ 玩家操控时不往别处跑',
   (has(BT, "const stay = (t === 'HOLD' || t === 'BOARD' || t === 'DISMOUNT' ||")
    and has(BT, "t === 'SET_STANCE' || t === 'FIRE_MISSION' ||")), True)
ck('battle.js：玩家的 ATTACK 带点但看不见敌人 ⇒ 推进到玩家点的位置（不再跑偏）',
   (has(BT, "} else if (gord.type === 'ATTACK' && gord.x != null && !(target && target.alive)) {")
    and has(BT, "unit._cmdWhy = '玩家命令：攻击（推进到指定位置）';")), True)
ck('battle.js：**卡住 >6 秒不再清玩家的命令**（玩家命令只有玩家能取消）',
   has(BT, "if (co && !co.done && co.src !== 'player') {"), True)
ck('cmd.js：命令看门狗**跳过玩家的命令**（玩家的意图不许被静默丢弃）',
   has(CD, 'if (tmo && o.src !== \'player\' && battle.time - o.at > tmo) {'), True)
ck('battle.js：玩家阵营不算 AI 战法（执行层不替玩家做决定）',
   (has(BT, "if (battle.playerSide && gk.indexOf(battle.playerSide + '|') === 0")
    and has(BT, '&& !(battle.aiEnabled && battle.aiEnabled[battle.playerSide])) continue;')), True)
ck('battle.js：下玩家命令时清掉 DEV 单兵手动目的地（不再挤掉组命令）',
   has(BT, 'for (const u of battle.selection) u._manualDest = null;'), True)
ck('命令条提示写明"没下令的部队原地待命"（并把"交回 AI"说清是"含自主移动"）',
   (has(BT, 'const CMD_HINT_DEFAULT =') and has(BT, '没下令的部队原地待命')
    and has(BH, '蓝方交给 AI（含自主移动）')), True)

print('== 14. R9.5c：修"只有移动听 / 下车秒上车 / 快速移动走直线" ==')
ck('cmd.js：攻击"打这个位置"（无 targetId）⇒ **到位判定**，不再下达即完成',
   (has(CD, "} else if (o.x != null) {") and has(CD, "o.doneReason = '已到达攻击位置';")
    and has(CD, "o.doneReason = '没有目标';")), True)
ck('cmd.js：撤退加 5 秒宽限（"看不见敌人"≠已脱离，不再瞬间完成）',
   has(CD, 'if (battle.time - o.at > 5 && safe >= Math.ceil(us.length * 0.8)) {'), True)
ck('cmd.js：**玩家的命令必须报告结局**（完成 / 为什么完成 ⇒ 上屏 toast）',
   (has(CD, "if (o.src === 'player') {") and has(CD, "this.toast = { msg: '「' + cn + '」' + (o.doneReason || '完成')")), True)
ck('battle.js：右键「攻击」会锁定落点附近的敌人（targetId）',
   (has(BT, "if (battle.curOrder === 'ATTACK') {") and has(BT, 'function pickEnemyNear(wx, wy, maxR) {')
    and has(BT, 'execPlayerOrder(battle.curOrder, w.x, w.y, tid);')), True)
ck('battle.js：上下车是**粘性意图**（下车后不会自己爬回车上）· 单位级优先',
   (has(BT, 'playerRide: {},') and has(BT, 'if (type === \'BOARD\') battle.playerRide[u.id] = true;')
    and has(BT, "else if (type === 'DISMOUNT') battle.playerRide[u.id] = false;")
    and has(BT, 'const want2 = Object.prototype.hasOwnProperty.call(pr, unit.id) ? pr[unit.id]')), True)
ck('battle.js：快速移动 —— 预设/老地图（公路刷在格子里、gm.roads 为空）走"道路格"版',
   (has(BT, 'function roadTileAt(gm, x, y) {') and has(BT, 'function nearestRoadTile(gm, x, y, maxR) {')
    and has(BT, 'function planFastRouteByGrid(unit, tx, ty) {')
    and has(BT, 'const g = planFastRouteByGrid(unit, tx, ty);')
    and has(BT, 'unit._fastRouteKind = g ? \'grid\' : \'none\';')), True)
ck('cmd.js：快速移动把"沿公路 / 改直线 + 预计用时"写进命令 note（玩家看得到走了没、要多久）',
   (has(CD, "p.note = (p.note ? p.note + ' · ' : '') + '沿公路' + whoTxt;")
    and has(CD, "(' · 预计 ' + fmtEta(fi.eta))")
    and has(BT, "showOrderToast('「' + cn + (fast ? '·快速' : '') + '」→ ' + ok + ' 个单位'")), True)

print('== 15. R9.5d：**点谁命令谁**（单位级命令）+ **把点击点和路线画出来** ==')
ck('cmd.js：unitsOf 支持单位级键 `u:<unitId>`（组/单位共用同一条管道）',
   (has(CD, "if (typeof gk === 'string' && gk.slice(0, 2) === 'u:') {")
    and has(CD, "for (const u of battle.units) if (u.alive && u.id === id) return [u];")), True)
ck('battle.js：groupOrderOf **单位级优先于组级**',
   (has(BT, "const uo = Cmd.current('u:' + unit.id);")
    and has(BT, 'if (uo && !uo.done) return uo;')), True)
ck('battle.js：玩家命令逐**单位**下达（不再拖着同组其他单位）',
   (has(BT, 'for (const u of battle.selection) {')
    and has(BT, "const res = Cmd.tryIssue('player', 'u:' + u.id, type,")
    and has(BT, "Cmd.clear('u:' + u.id, '玩家停止');")), True)
ck('battle.js：★ 命令目标点 + **实际路线**（含快速移动的路点）画在地图上',
   (has(BT, 'function drawPlayerOrders() {')
    and has(BT, 'if (o.route && o.route.length) for (const p of o.route) pts.push({ x: p.x, y: p.y });')
    and has(BT, "const label = cn + (o.fast ? '·快速' : '') + ' '")
    and has(BT, 'drawPlayerOrders();')), True)
ck('battle.js：选中=亮黄 / 其他己方=淡蓝；路线随行进变短（mover 会 shift 路点）',
   (has(BT, "ctx.strokeStyle = isSel ? 'rgba(252, 211, 77, 0.95)' : 'rgba(96, 165, 250, 0.42)';")
    and has(BT, 'if (isSel && pts.length > 2) {')), True)
ck('dev-panel.js：DEV 的"单位级"作用域也改走命令层（11 种命令都能下给单个单位）+ 显示 单位/组',
   (has(DP, "Cmd.tryIssue('player', 'u:' + sel.id, type,")
    and has(DP, "const scope = (o.groupKey && o.groupKey.slice(0, 2) === 'u:') ? '单位' : '组';")), True)
ck('battle.js：切阵营时连**单位级**命令一起清',
   has(BT, "if (gk.slice(0, 2) === 'u:') {              // ★ R9.5d：单位级命令也要按阵营清"), True)
ck('battle.js：右键**落点回显**（被拒=红 ✕ 渐隐 / 成功=绿 ✕）——"我点到哪里"看得见',
   (has(BT, "battle.clickMark = { x: wx, y: wy, t: battle.time, ok: false };")
    and has(BT, 'const cm = battle.clickMark;')
    and has(BT, "cm.ok ? 'rgba(74, 222, 128, 0.95)' : 'rgba(248, 113, 113, 0.98)'")), True)

print('== 16. R9.6：**实体为准的移动**（禁漂移）+ **过点判定** + **沿路不提前下路** ==')
ck('battle.js：`STEER_ENTITY` 开关（?steer=0 可切回旧路径做 A/B）',
   has(BT, 'const STEER_ENTITY = !/[?&]steer=0/.test(location.search);'), True)
ck('battle.js：实体运动 —— **只有前向分量**（横向恒 0）+ 被挡只在朝向 ±40° 内打方向',
   (has(BT, 'function moveUnitEntity(unit, target, dt, isWaypoint) {')
    and has(BT, 'const nx0 = unit.x + fx * step, ny0 = unit.y + fy * step;')
    and has(BT, 'const a = unit.facing + sgn * (0.14 * i);      // ±8° ±16° ±24° ±32° ±40°')), True)
ck('battle.js：**中间路点不停车**（否则停在第一个路点）+ 终点"越过即到位"（防绕圈）',
   (has(BT, 'if (!isWaypoint && (d <= stopR || (d < stopR * 2.2 && (dx * fx + dy * fy) < 0))) {')
    and has(BT, 'const aimIsWaypoint = !!(gord && gord.fast && gord.route && gord.route.length && !unit._manualDest);')), True)
ck('battle.js：成员按队形跟随 + **零均值化**（质心恒等于实体）· ★R9.6.9 步兵槽位**不随朝向旋转**',
   (has(BT, 'function placeMembersForUnit(unit, dt) {')
    and has(BT, 'function recenterMembersOnUnit(unit) {')
    and has(BT, 'const SOLDIERS_ROTATE_WITH_FACING = false;')
    and BT.count('const tx = SOLDIERS_ROTATE_WITH_FACING ? unit.x + (ox * hx - oy * hy) : unit.x + ox;') == 2
    and has(BT, 'sx += s.x - tx;')), True)
ck('battle.js：旧路径（质心反推）只在 ?steer=0 时存在',
   (has(BT, 'if (STEER_ENTITY) {') and has(BT, 'recenterMembersOnUnit(unit);')
    and has(BT, 'const center = unitCenterFromSoldiers(unit);')), True)
ck('battle.js：路点"**过点**"判定（穿垂面 / 很近才 pop）—— 不再切角',
   (has(BT, 'if (ll > 1) passed = ((unit.x - wp.x) * ldx + (unit.y - wp.y) * ldy) / ll > 0;')
    and has(BT, 'if (!passed && wd > Math.max(14, unitArriveRadius(unit) * 0.5)) break;')), True)
ck('battle.js：沿路**只在离目标最近的点下路** + 过路口容差 + 不许回头',
   (has(BT, 'const JUNCTION_TOL = 150, LEAVE_BACK = 260;')
    and has(BT, 'route.length = Math.min(route.length, bestIdx);')
    and has(BT, 'if (newProj < progLen - step * 0.15) continue;')), True)
ck('battle.js：多单位 ⇒ **每个单位一个落点**（不再靠密度横移散开）',
   (has(BT, 'function unitTargetSlots(units, wx, wy) {')
    and has(BT, 'const slots = unitTargetSlots(alive, wx, wy);')
    and has(BT, 'if (STEER_ENTITY && typeof isPlayerCtl === \'function\' && isPlayerCtl(unit)) return moveTarget;')), True)

print('== 17. R9.6.9：交火数值 / 步兵不跟中心转 / 票池·时间 / 沼泽·山体 / 只有步兵进建筑 ==')
ck('battle.js：命中率改成真实交火量级（0.10 − 0.08×(d/r)）',
   has(BT, 'let baseChance = 0.10 - (dist / weapon.range) * 0.08;'), True)
ck('battle.js：命中下限 0.02（旧 0.15 会把新公式整个盖掉）',
   (has(BT, 'const hitChance = Math.max(0.02, baseChance);')
    and not has(BT, 'const hitChance = Math.max(0.15, baseChance);')), True)
ck('equipment.js：轻武器改成**点射节奏**（突击 0.6 / 冲锋 0.5 / 轻机 0.5 / 重机 0.6）',
   ("name:'突击步枪',   stats:{ ammo:120, antiPersonnel:6,  range:500,  fireInterval:0.6 }" in EQ
    and "name:'冲锋枪',     stats:{ ammo:180, antiPersonnel:4,  range:200,  fireInterval:0.5 }" in EQ
    and "name:'轻机枪',     stats:{ ammo:500, antiPersonnel:8,  range:600,  fireInterval:0.5 }" in EQ
    and "name:'重机枪',     stats:{ ammo:900, antiPersonnel:15, range:1000, fireInterval:0.6 }" in EQ), True)
ck('equipment.js：种子版本 7 + v7 迁移（老库自动跟新，手改过的会被 skip）',
   (has(EQ, 'const EQUIP_SEED_VERSION = 7;') and has(EQ, 'version: 7,')
    and has(EQ, "'突击步枪':   { old: { fireInterval: 0.12 }, new: { fireInterval: 0.6 } }")), True)
ck('battle.js：票池 1000（其余票规则未动）',
   (has(BT, 'const TICKETS_MIN            = 1000;')
    and has(BT, 'const TICKET_BLEED_PER_POINT = 0.3;')
    and has(BT, 'const TICKETS_PER_SOLDIER    = 1;')), True)
ck('battle.js：一场 **40 分钟**（MAX_BATTLE_TIME 2400）',
   has(BT, 'const MAX_BATTLE_TIME = 2400;'), True)
ck('grid-maps.js：新增**沼泽**（5 行速度表都有它）',
   (has(GM, "id:'swamp'") and GM.count('swamp:') == 5
    and has(GM, 'swamp: 0.25 }') and has(GM, 'swamp: 1.00 }')), True)
ck('grid-maps.js：沼泽**减速比树林狠**（履带 0.25 < 树林 0.51）且**不遮挡视野**',
   (has(GM, "sightBlock:0,   spotMod:0.85, conceal:0.45") and has(GM, 'tracked:   { empty: 0.90, road: 1.43, forest: 0.51')), True)
ck('grid-maps.js：**山体遮挡视线**（hill sightBlock 0.5；站在上面视野加成不变）',
   (has(GM, 'sightBlock:0.5, spotMod:1.30') and has(GM, 'rangeMul:1.2')), True)
ck('battle.js：建筑对**车辆**硬阻断（步兵放行 / 已在楼内可脱困 / 车不摆进楼里）',
   (has(BT, 'function pointInAnyBuilding(x, y) {')
    and has(BT, 'function circleInAnyBuilding(x, y, radius) {')
    and has(BT, 'function vehicleBlockedAt(unit, x, y, radius) {')
    and has(BT, 'function vehicleEnterBuildingBlocked(v, x, y, radius) {')
    and has(BT, 'if (!isMoveBlockedAt(nx0, ny0, R) && !vehicleBlockedAt(unit, nx0, ny0, R))')
    and has(BT, 'if (pointInAnyBuilding(nx, ny)) continue;')), True)
ck('battle.js：楼内单位 ⇒ **楼顶血量条** + **隐藏楼内单兵点**（只留兵牌）',
   (has(BT, 'function refreshBuildingOccupancy() {')
    and has(BT, 'refreshBuildingOccupancy();')
    and has(BT, "if (u._bldOccupied && (u.stance !== 'moving'")
    and has(BT, 'if (b._occBlue || b._occRed) {')), True)

print('== 18. R9.6.10：官方地图池（三张实景图）+ 树林/沼泽/山丘纹理 ==')
_ppath = os.path.join(JS, 'maps-presets.js')
PRESET = read(_ppath) if os.path.exists(_ppath) else ''
ck('js/maps-presets.js 存在且是官方地图数组',
   ('const GRID_MAP_PRESETS = [' in PRESET), True)
if PRESET:
    raw = PRESET[PRESET.index('const GRID_MAP_PRESETS = [') + len('const GRID_MAP_PRESETS = '):]
    raw = raw[:raw.rindex(']') + 1]
    maps = json.loads(raw)          # ★ 用真 JSON 解析一遍：内联数据必须是合法对象数组
    ck('内联地图可解析 · 三张（bastogne / interchange / carentan）',
       [m['id'] for m in maps], ['bastogne', 'interchange', 'carentan'])
    ck('三张地图尺寸 = 9×5 / 5×2.5 / 8×4.5 km',
       [(m['w'], m['h']) for m in maps], [(9000, 5000), (5000, 2500), (8000, 4500)])
    ck('官方图不带没人读的旧 routes 字段', all('routes' not in m for m in maps), True)
ck('grid-maps.js：旧 4 张"代码生成预设"已整体删除',
   none(GM, ['makeInterchangeMap', 'makeStalingradMap', 'makeKurskMap', 'makeKoreaMap',
             'GRID_MAPS.stalingrad =', 'GRID_MAPS.korea =']), '无残留')
ck('grid-maps.js：官方池 = loadPresetMaps() 反序列化 + 标 _isUserMap=false',
   ('function loadPresetMaps() {' in GM)
   and ('gm._isUserMap = false;              // ★ 官方地图' in GM)
   and ('  loadPresetMaps();           // ★ R9.6.10：官方地图池（maps-presets.js）' in GM), True)
ck('battle.html / map-editor.html：maps-presets.js 都在 grid-maps.js **之前**',
   ((BH.index('js/maps-presets.js') < BH.index('js/grid-maps.js'))
    and (MH.index('js/maps-presets.js') < MH.index('js/grid-maps.js'))), True)
ck('battle.html：4 个写死的旧选项已删 + battle.js 有 buildMapSelect()',
   ((not has(BH, 'value="stalingrad"')) and has(BT, 'function buildMapSelect() {')), True)
ck('battle.js：随机地图池 = 官方图（不再写死 id 数组）',
   (has(BT, 'const pool = Object.values(GRID_MAPS).filter(gm => gm && !gm._isUserMap);')
    and (not has(BT, "const pool = ['interchange', 'stalingrad', 'kursk', 'korea'];"))), True)
ck('grid-maps.js：纹理只作用于 forest/swamp/hill（格坐标哈希，不额外存数据）',
   (has(GM, 'function terrainPixel(terrIdx, gx, gy) {')
    and has(GM, "if (id === 'forest' || id === 'swamp' || id === 'hill') {")
    and has(GM, 'const px = terrainPixel(composed[i], i % GW, (i / GW) | 0);')), True)
ck('map-editor.js：编辑器烘焙用**同一份**纹理实现',
   has(ME, 'const px = terrainPixel(v, i % GW, (i / GW) | 0);'), True)

print('== 19. R9.6.11：反炮兵含迫击炮 / 单位能出楼 / 尸体 / 建筑重置 / 快速移动 / 曳光弹 / 自定义弹窗 ==')
ck('battle.js：反炮兵 = "手里有 artillery 武器"（**含迫击炮**，不再只看编制类型）',
   (has(BT, 'function unitHasArtilleryFire(unit) {')
    and BT.count('if (!unitHasArtilleryFire(other)) continue;') == 2
    and has(BT, 'if (unitHasArtilleryFire(other) && unitHasArtilleryFire(unit)) score *= 0.4;')), True)
ck('battle.js：玩家下令 ⇒ 解除驻守 + 15 秒不钻楼（"允许单位从建筑当中出来"）',
   (has(BT, 'if (unit._garrisonIdx != null) { unit._garrisonIdx = null; unit._houseKey = null; }')
    and has(BT, 'unit._noGarrisonUntil = battle.time + 15;')
    and has(BT, 'if (battle.time < (unit._noGarrisonUntil || 0)) return null;')), True)
ck('battle.js：尸体灰点（阵亡处留点 + 上限 + 绘制 + 每局清空）',
   (has(BT, 'function addCorpse(x, y, side) {')
    and has(BT, 'addCorpse(s.x, s.y, unit.side);')
    and has(BT, 'const MAX_CORPSES = 4000;')
    and has(BT, 'battle.corpses = [];')
    and has(BT, 'for (const c of battle.corpses) {')), True)
ck('battle.js：**建筑状态每局重置**（上一局塌掉的楼不带到下一局）',
   (has(BT, 'function resetBuildingsForBattle() {')
    and has(BT, "if (typeof b.hpMax === 'number' && b.hpMax > 0) b.hp = b.hpMax;")
    and has(BT, 'resetBuildingsForBattle();')), True)
ck('battle.js：快速移动 —— **长距离不再"识别不到道路"**（倍率门限 + 24 跳 + 矢量图不切道路格版）',
   (has(BT, 'const FAST_HOP_MAX = 24;')
    and has(BT, 'const FAST_ROAD_WORSE_RIDE = 2.5;')
    and has(BT, 'const FAST_ROAD_WORSE_FOOT = 1.25;')
    and has(BT, 'function fastRoadWorseRatio(prof) {')
    and has(BT, 'if (!gm.roads || !gm.roads.length) {')), True)
ck('battle.js：曳光弹 = **短划 + 弹头**（不再画"枪口→目标"的整条直线 = 激光）',
   (has(BT, 'const TRACER_SPEED = 900;') and has(BT, 'const TRACER_DASH = 130;')
    and has(BT, 'const TRACER_LIFE = 0.45;')
    and has(BT, 'ctx.lineTo(t.x1 + ux * head, t.y1 + uy * head);')
    and has(BT, 'battle.tracers = battle.tracers.filter(t => t.age < TRACER_LIFE);')), True)
ck('dialog.js：自定义弹窗（alert/confirm/prompt · Promise · 排队 · Enter/Esc）',
   (('const Dlg = (() => {' in DLG) and ('window.Dlg = Dlg;' in DLG)
    and ('function showNext(req) {' in DLG) and ("e.key === 'Escape'" in DLG)), True)
ck('三个页面都引入了 dialog.js（且在最前）',
   (BH.index('js/dialog.js') < BH.index('js/battle.js')
    and MH.index('js/dialog.js') < MH.index('js/map-editor.js')
    and (('js/dialog.js' in read(os.path.join(ROOT, 'index.html'))))), True)
ck('ui.js：两套自研弹窗统一走 Dlg（去掉重复实现）',
   (has(UI, 'Dlg.prompt(o.label || o.title') and has(UI, 'Dlg.confirm(message, { title: title')), True)
_BAD_DLG = re.compile(r'(?<![\w.$])(alert|confirm|prompt)\(')
_bad_dlg = []
for _f in sorted(os.listdir(JS)):
    if _f.endswith('.js') and _f != 'dialog.js':
        if _BAD_DLG.search(read(os.path.join(JS, _f))):
            _bad_dlg.append(_f)
for _h in ('index.html', 'battle.html', 'map-editor.html'):
    if _BAD_DLG.search(read(os.path.join(ROOT, _h))):
        _bad_dlg.append(_h)
ck('全项目**零浏览器弹窗**（js/html 里没有裸的 alert/confirm/prompt 调用）', _bad_dlg, [])

print('== 20. R9.6.12：密度（排内 22m / 排间 ≥150m）+ 炮兵杀伤率 + 草地颜色 ==')
ck('battle.js：排内单兵间距 = 22m（按"立交桥 12.5km² / 双方 1100 人 = 88 人/km²"基准反推）',
   (has(BT, 'const SOLDIER_SPACING = 22;')
    and has(BT, 'const spacing = SOLDIER_SPACING;                 // ★ R9.6.12')
    and (not has(BT, 'SOLDIER_SPACING * 1.6'))), True)
ck('battle.js：排与排落点间距 ≥225m 且 ≈6.75×抵达半径（R9.6.13：在 180m 基础上再 ×1.5 ⇒ 排 270m）',
   has(BT, 'const spacing = Math.max(225, 6.75 * unitArriveRadius(units[0]));'), True)
ck('battle.js：密度挤开力 30 → 150 → **225m**（×1.5）+ 扫描半径 500 → 800m',
   (has(BT, 'const DENSITY_FORCE = 225;') and has(BT, 'const DENSITY_SCAN_RADIUS = 800;')), True)
ck('battle.js：炮兵杀伤圈内**不再必死**（0.55 × 半径衰减 × 掩体系数）',
   (has(BT, 'const radial = 1 - 0.45 * (sd / R);')
    and has(BT, 'coverFactorAt(s.x, s.y, true) * 0.55 * radial')), True)
ck('grid-maps.js：草地颜色改成中亮橄榄绿（与曳光弹拉开对比）',
   (has(GM, "id:'empty',  name:'草地', color:'#a8c585'")
    and (not has(GM, "color:'#e8f0e4'"))), True)

# —— 数值自检：编队公式（battle.js generateSoldierOffsets）→ 每人占地 → 一发炮的期望伤亡 ——
import math as _mm
def _form_radius(n, spacing):
    r = 0.0
    for t in range(_mm.ceil(n / 4.0)):
        r = max(r, spacing * (0.4 + _mm.sqrt(t) * 0.9))
    return r
_r_old, _r_new = _form_radius(30, 12.8), _form_radius(30, 22.0)
_a_old, _a_new = _mm.pi * _r_old ** 2, _mm.pi * _r_new ** 2
per_old, per_new = _a_old / 30, _a_new / 30
print('       30 人排：旧间距 12.8m ⇒ 半径 %.0fm / 每人 %.0f m²；新 22m ⇒ 半径 %.0fm（正面 %.0fm）/ 每人 %.0f m²'
      % (_r_old, per_old, _r_new, _r_new * 2, per_new))
ck('排内密度：30 人排每人占地 ≥ 300 m² 且相对旧值 ≥ 2.5×',
   (per_new >= 300 and per_new / per_old >= 2.5), True)
_ld = _mm.pi * 20 * 20                       # 迫击炮杀伤圈（lethalRadius 20m）
_k_old = min(1.0, _ld / _a_old) * 1.0 * 30            # 旧：开阔地必死 ⇒ 圈内 100%
_k_new = min(1.0, _ld / _a_new) * (0.55 * 0.7) * 30   # 新：0.55 × 半径平均衰减(≈0.7)
print('       一发迫击炮(20m) 对 30 人排的期望伤亡：旧 %.1f 人/发 ⇒ 12 发 %.0f 人（整排蒸发）；新 %.1f 人/发 ⇒ 12 发 ≈ %.0f 人'
      % (_k_old, _k_old * 12, _k_new, _k_new * 12))
ck('一轮炮击不再整排蒸发：单发期望 ≤ 2.5 人（旧值 ≈ 10 人/发）',
   _k_new <= 2.5, True)

print('== 21. R9.6.13：手机端适配（三个页面）==')
MED = read(os.path.join(ROOT, 'css', 'map-editor.css'))
BCD = read(os.path.join(ROOT, 'css', 'battle.css'))
ck('battle.html / map-editor.html 都有 viewport（含 viewport-fit=cover）',
   (('viewport-fit=cover' in BH) and ('viewport-fit=cover' in MH)), True)
ck('地图编辑器：手机端工具抽屉（🛠 按钮 + body.mobile-tools-open）',
   (has(MH, 'id="btn-mobile-tools"') and has(ME, 'function bindMobileUI() {')
    and has(ME, "document.body.classList.toggle('mobile-tools-open')")
    and ('body.mobile-tools-open .sidebar' in MED)), True)
ck('地图编辑器：≤900px 媒体查询 + 触摸目标放大 + 画布 touch-action',
   (('@media (max-width: 900px)' in MED) and ('.tool-btn { min-height: 44px' in MED)
    and ('touch-action: none' in MED)), True)
ck('地图编辑器：双指平移 + 捏合缩放（锚点法：世界点始终贴在中点下）',
   (has(ME, "canvas.addEventListener('touchstart', e => {")
    and has(ME, "canvas.addEventListener('touchmove', e => {")
    and has(ME, 'camera.x = tst.wx - (mx - rect.width / 2) / camera.zoom;')), True)
ck('战场：双指拖动 = 平移（中点参与）+ 画布 touch-action + 相机控件避开命令条',
   (('const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;' in BT)
    and ('#battle-canvas { touch-action: none;' in BCD)
    and ('.cam-controls { right: 8px; bottom: 92px;' in BCD)), True)
ck('战场：命令条手机端单行横向滚动 + 按钮 ≥42px + 手机操作提示条',
   (('flex-wrap: nowrap; overflow-x: auto;' in BH)
    and ('min-height: 42px; padding: 8px 12px' in BH)
    and has(BH, 'id="mobile-hint"')), True)
ck('编制编辑器（index.html）本来就是移动端就绪（抽屉 + 捏合缩放）',
   (('mobile-open-lib' in read(os.path.join(ROOT, 'index.html')))
    and ('pinchState' in read(os.path.join(ROOT, 'index.html')))), True)

print()
print('全部通过 ✓' if fails == 0 else '%d 项失败 ✗' % fails)
sys.exit(0 if fails == 0 else 1)
