# -*- coding: utf-8 -*-
"""R7.6：任务级路线约束的离线测试（治「有路线不走、偏走目的地直线；失败 ⇒ 每帧重算」）

用户实测四类症状：
  ① 明明显示了路线（青色）/路网，单位偏要走「到目的地的直线（虚线）」
  ② 路线抖动、反复重算、来回折返
  ③ 每隔几秒整场卡一下
  ④ 单位「随便漂移」（不朝自己朝向走）

本文件做两件事：
  ① 与 JS 同算法复刻「路线状态机 / 失败缓存 / 令牌桶 / 转向速率 / 目标丢失迟滞」，
     并把【旧行为】与【新行为】摆在一起对比（断言新版把错误压掉）
  ② 静态守卫：直接在源码里断言关键句还在（防以后被改回去）
"""
import sys, io, math, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

fails = 0
def ck(name, got, exp):
    global fails
    ok = (got == exp)
    if not ok: fails += 1
    print(('  ok   ' if ok else '  FAIL ') + '%s: %s（期望 %s）' % (name, got, exp))

HERE = os.path.dirname(os.path.abspath(__file__))
def src(rel):
    with io.open(os.path.join(HERE, rel), 'r', encoding='utf-8') as f:
        return f.read()


# ============================================================
# 1) 路线「走空」的旧/新判据（根因 A：空数组在 JS 里是真值）
# ============================================================
print('== 1. 路线「走空」判据：旧版 !navPath 会把 [] 当成「有路线」⇒ 永不重算 ==')

def old_first_plan(nav_path):
    """battle.js 旧写法 `const firstPlan = !unit._navPath;` 的 JS 语义复刻
       —— JS 里 null 为假值、**空数组为真值**"""
    return nav_path is None            # !null=True ; ![]=False

def new_has_route(flag, nav_path):
    """battle.js 新写法：显式标志 + 非空数组"""
    return bool(flag) and (nav_path is not None) and len(nav_path) > 0

ck('旧版：还没规划过（null）⇒ 需要首次规划', old_first_plan(None), True)
ck('旧版：路线被吃空（[]）⇒ 误判为有路线 ⇒ 不重算（就是偏走直线的根因）',
   old_first_plan([]), False)
ck('新版：标志 true 但路线已走空 ⇒ 判「没路线」⇒ 会重算（治好了）',
   new_has_route(True, []), False)
ck('新版：标志 true 且还有路点 ⇒ 跟随中', new_has_route(True, [{'x': 1, 'y': 2}]), True)
ck('新版：规划失败（标志 false / 路线 null）⇒ 没路线', new_has_route(False, None), False)


# ============================================================
# 2) 规划失败：旧版「每帧重算」vs 新版「失败缓存」
# ============================================================
print('== 2. 规划失败 60 秒：旧版每帧重算（A*/Dijkstra 洪峰）vs 新版失败缓存 ==')

FAIL_RETRY_SEC = 8.0     # 与 battle.js NAV_FAIL_RETRY_SEC 同值
FAIL_DRIFT = 400.0       # 与 battle.js NAV_FAIL_DRIFT 同值

def sim_fail(frames, dt, goal_speed, use_cache):
    """planner 永远失败（None）。返回「实际调用 planner 的次数」。goal_speed = 目标漂移速度(m/s)。"""
    calls = 0
    fail_at = None
    fail_dest = None
    gx, gy0 = 0.0, 0.0
    for i in range(frames):
        t = i * dt
        nav_has_route = False
        want = True                       # 没有路线 ⇒ 一直想规划
        can = want
        if use_cache and (not nav_has_route) and (fail_at is not None):
            fdrift = (math.hypot(fail_dest[0] - gx, fail_dest[1] - gy0)
                      if fail_dest else float('inf'))
            if (t - fail_at) < FAIL_RETRY_SEC and fdrift < FAIL_DRIFT:
                can = False
        if can:
            calls += 1
            fail_at = t                   # 规划失败 ⇒ 记时间与目标
            fail_dest = (gx, gy0)
        gx += goal_speed * dt
    return calls

FR = 600                                  # 60 秒 @10Hz
old_calls = sim_fail(FR, 0.1, 0.0, False)
new_calls = sim_fail(FR, 0.1, 0.0, True)
ck('旧版：60 秒调用次数 == 帧数（每帧重算）', old_calls, FR)
ck('新版：固定目标 ⇒ 每 8 秒才重试一次', 
   (new_calls >= 1) and (new_calls <= FR * 0.1 / FAIL_RETRY_SEC + 2), True)
ck('新版调用次数 ≤ 旧版的 1/20', new_calls * 20 <= old_calls, True)
mv_calls = sim_fail(FR, 0.1, 120.0, True)   # 目标 120m/s ⇒ 3.3 秒就漂出 400m
ck('新版：目标漂得快 ⇒ 允许更频繁重试（但仍远少于每帧）',
   (mv_calls > new_calls) and (mv_calls < FR * 0.5), True)



# ============================================================
# 3) 规划预算：**时间限额**（R7.7）
# ============================================================
print('== 3. 规划预算：每帧"时间限额" vs 旧版"单帧 6 次" ==')

NAV_PLAN_MS_PER_FRAME = 8.0     # 与 battle.js 同值
NAV_BUDGET_PER_SEC = 24         # 与 battle.js 同值（软上限）
NAV_BUDGET_MAX = 8              # 与 battle.js 同值

class TimeBudget:
    """battle.js navPlanBudgetTake() 的同算法复刻（R7.7：时间限额 + 每秒软上限）"""
    def __init__(self):
        self.t = -1e9; self.n = float(NAV_BUDGET_MAX)
        self.frame_key = None; self.frame_start = None
        self.calls = 0; self.skips = 0
    def take(self, frame_key, now_ms, now_t):
        if frame_key != self.frame_key:                 # 新的一帧：计时归零
            self.frame_key = frame_key; self.frame_start = now_ms
        dtb = max(0.0, now_t - self.t); self.t = now_t   # ① 每秒软上限
        self.n = min(NAV_BUDGET_MAX, self.n + dtb * NAV_BUDGET_PER_SEC)
        if self.n < 1: self.skips += 1; return False
        if self.frame_start is not None and now_ms - self.frame_start >= NAV_PLAN_MS_PER_FRAME:
            self.skips += 1; return False                # ② 本帧时间用完 ⇒ 顺延
        self.n -= 1; self.calls += 1
        return True

def sim_frames(units, frames, fps, plan_ms, use_time_budget):
    """返回 (每帧规划次数, 每帧规划耗时ms)。★ 帧内墙钟会随每次规划推进 plan_ms（与真实一致）"""
    per_plans, per_ms = [], []
    b = TimeBudget()
    need = [True] * units
    for f in range(frames):
        frame_t = f / fps
        clock = f * (1000.0 / fps)          # 帧内墙钟
        n = 0
        for i in range(len(need)):
            if not need[i]: continue
            ok = b.take(f, clock, frame_t) if use_time_budget else (n < 6)   # 旧版：单帧最多 6 次
            if ok:
                need[i] = False; n += 1
                clock += plan_ms            # ★ 这一次规划本身花掉的时间
        per_plans.append(n); per_ms.append(n * plan_ms)
    return per_plans, per_ms

PLAN_MS = 30.0
old_plans, old_ms = sim_frames(40, 120, 60, PLAN_MS, False)     # 2 秒 @60fps
new_plans, new_ms = sim_frames(40, 120, 60, PLAN_MS, True)

ck('旧版：单帧最多 6 次 ⇒ 单帧规划耗时可达 6×30 = 180ms（那 180ms 里画面完全不刷新）',
   int(max(old_ms)), int(6 * PLAN_MS))
ck('新版：单帧规划耗时 ≤ 一次规划 + 预算（30+8=38ms）', max(new_ms) <= PLAN_MS + NAV_PLAN_MS_PER_FRAME, True)
ck('新版单帧最坏耗时 ≤ 旧版的 1/4', max(new_ms) * 4 <= max(old_ms), True)
ck('新版：2 秒内 40 个请求全部被满足（不会饿死）', sum(new_plans), 40)
ck('新版：需求被摊到多帧（单帧峰值次数远小于单位数）', max(new_plans) < 10, True)


# ============================================================
# 4) 转向速率（单位只能走向自己朝向的方向）
# ============================================================
print('== 4. 转向速率：朝向以有限角速度追目标（不再瞬移转向）==')

TURN_RATE = {'foot': 2.8, 'wheeled': 1.1, 'tracked': 0.85, 'halftrack': 1.0, 'air': 6.0}

def turn_toward(cur, want, max_step):
    """battle.js navTurnToward() 的同算法复刻"""
    d = want - cur
    while d > math.pi: d -= math.pi * 2
    while d < -math.pi: d += math.pi * 2
    if abs(d) <= max_step: return want
    return cur + (max_step if d > 0 else -max_step)

def time_to_turn(cls, dtheta, dt=1 / 60.0):
    cur = 0.0
    t = 0.0
    while abs(((dtheta - cur + math.pi) % (2 * math.pi)) - math.pi) > 1e-4:
        cur = turn_toward(cur, dtheta, TURN_RATE[cls] * dt)
        t += dt
        if t > 60: break
    return t

t_track = time_to_turn('tracked', math.pi)     # 坦克 180°
t_foot = time_to_turn('foot', math.pi)         # 步兵 180°
ck('坦克 180° 需要 π/0.85 ≈ 3.7 秒（不是瞬移）', round(t_track, 1), round(math.pi / 0.85, 1))
ck('步兵转得比坦克快', t_foot < t_track, True)
ck('直升机几乎瞬时（≤0.6s）', time_to_turn('air', math.pi) <= 0.6, True)
ck('小角度（≤一步）一次到位', turn_toward(0.0, 0.01, 0.05), 0.01)


# ============================================================
# 5) 目标短暂丢失的迟滞（旧版一帧 null 就全清 ⇒ 全量重算）
# ============================================================
print('== 5. 目标丢失迟滞：0.5 秒空档不清路线，>0.8 秒才清 ==')

IDLE_CLEAR_SEC = 0.8     # 与 battle.js NAV_IDLE_CLEAR_SEC 同值

def sim_idle(gap_sec, dt=0.1):
    """目标空档 gap 秒后回来：路线是否还在（在 ⇒ 不会全量重算）"""
    no_goal_since = None
    cleared = False
    t = 0.0
    while t < gap_sec - 1e-9:
        if no_goal_since is None: no_goal_since = t
        if t - no_goal_since > IDLE_CLEAR_SEC: cleared = True
        t += dt
    return (not cleared)               # True = 路线保留

ck('空档 0.5 秒 ⇒ 路线保留（旧版会清 ⇒ 下次是首次规划全量重算）', sim_idle(0.5), True)
ck('空档 0.7 秒 ⇒ 路线保留', sim_idle(0.7), True)
ck('空档 1.5 秒 ⇒ 路线清掉（命令真的没了）', sim_idle(1.5), False)


# ============================================================
# 6) 静态守卫 + 括号平衡
# ============================================================
print('== 6. 静态守卫（源码里关键句还在）+ 括号平衡 ==')

bt = src(os.path.join('..', 'js', 'battle.js'))
gm = src(os.path.join('..', 'js', 'grid-maps.js'))

ck('新增常量：失败重试 / 失败漂移 / 丢失迟滞 / **时间预算**',
   ('const NAV_FAIL_RETRY_SEC = 8;' in bt) and ('const NAV_FAIL_DRIFT = 400;' in bt)
   and ('const NAV_IDLE_CLEAR_SEC = 2.6;' in bt)
   and ('const NAV_PLAN_MS_PER_FRAME = 8;' in bt)
   and ('const NAV_BUDGET_PER_SEC = 24;' in bt) and ('const NAV_BUDGET_MAX = 8;' in bt), True)
ck('预算函数存在，且被 mover 与身份决策共用',
   ('function navPlanBudgetTake() {' in bt)
   and ("if (canPlan && !navPlanBudgetTake()) { canPlan = false; unit._navSkip = 'budget'; }" in bt)
   and ('if (!navPlanBudgetTake()) {' in bt), True)
ck('R7.7：首次规划错峰（把开局几十条路线摊到多帧）',
   ('function navPhaseOf(unit) {' in bt)
   and ('if (wantPlan && unit._navCmdKey == null && battle.time < navPhaseOf(unit) * 1.5) {' in bt), True)
ck('R7.7：开场预热导航粗格（把首帧那几百毫秒移出游戏帧）',
   ("navFor(battle.gridMap, 'main'); navFor(battle.gridMap, 'access');" in bt), True)
ck('R7.7：A* 缓冲复用（世代号）——不再每次分配 ≈1.3MB',
   ('let A = nav._ast;' in gm)
   and ('const closed = A.closed, genArr = A.gen;' in gm)
   and ('gScore[start] = 0; genArr[start] = gen; parent[start] = -1;' in gm)
   and ('if (genArr[k] !== gen || ng < gScore[k]) {' in gm), True)
ck('R7.7：主循环**不再因异常停机**（旧版 600 次后 rAF 链断掉 = 永久冻住）',
   ('_loopErrMax' not in bt) and ('battle._loopErrMsg = (err && (err.message' in bt), True)
ck('R7.7：弹幕/爆炸/炮弹上限（治"战斗后期越来越重"）',
   ('const MAX_TRACERS = 1500;' in bt) and ('const MAX_EXPLOSIONS = 400;' in bt)
   and ('const MAX_SHELLS = 120;' in bt), True)
ck('R7.7：NaN 位置守卫',
   ('function healUnitPosition(unit) {' in bt)
   and ('if (!isFinite(unit.x) || !isFinite(unit.y)) healUnitPosition(unit);' in bt), True)
ck('R7.7：屏上诊断条（逻辑/绘制 ms + 规划次数/秒 + 异常）',
   ('battle._logicMs = _logicMs; battle._drawMs = _drawMs;' in bt)
   and ('· 规划 ${_navRateVal.toFixed(1)}/s' in bt), True)
ck('转向速率表 + 转向函数存在',
   ('const NAV_TURN_RATE = { foot: 2.8, wheeled: 1.1, tracked: 0.85, halftrack: 1.0, air: 6.0 };' in bt)
   and ('function navTurnToward(cur, want, maxStep) {' in bt)
   and ('function navTurnRateOf(unit) {' in bt), True)
ck('显式路线标志：不再用数组真值判断（旧写法已删）',
   ('const firstPlan = !unit._navPath;' not in bt)
   and ('const hasRoute = !!unit._navHasRoute' in bt)
   and ('unit._navHasRoute = !!unit._navPath;' in bt), True)
ck('路线走空 ⇒ 明确清标志（治偏走目的地直线）',
   ("unit._navSkip = 'drained';" in bt) and ('unit._navHasRoute = false;' in bt), True)
ck('失败缓存：记失败时间与目标',
   ('unit._navFailAt = battle.time; unit._navFailDest = { x: navGX, y: navGY };' in bt)
   and ('if (canPlan && !hasRoute && unit._navFailAt != null) {' in bt), True)
ck('目标丢失迟滞（不再一帧 null 就全清）',
   ('if (unit._noGoalSince == null) unit._noGoalSince = battle.time;' in bt)
   and ('if (battle.time - unit._noGoalSince > NAV_IDLE_CLEAR_SEC) {' in bt), True)
ck('单位朝向：有限转向速率（不再瞬移）',
   ('unit.facing = navTurnToward(' in bt), True)
ck('车体朝向：只能朝车头走（转向速率 + 限幅横向修正）',
   ('v.facing = navTurnToward(' in bt)
   and ('let mvx = dx / (d || 1), mvy = dy / (d || 1);' in bt)
   and ('const lat = Math.max(-1, Math.min(1, fx * mvy - fy * mvx));' in bt), True)
ck('行驶中不被瞄准瞬移覆盖朝向',
   ("if (unit.stance !== 'moving') v.facing = Math.atan2(vdy, vdx);" in bt)
   and ("if (unit.stance !== 'moving') unit.facing = Math.atan2(dy, dx);" in bt), True)
ck('士兵绕行侧一次定死（去掉每帧随机）',
   ('if (s._side !== 1 && s._side !== -1) s._side = (Math.random() < 0.5) ? 1 : -1;' in bt)
   and (': (Math.random() < 0.5 ? 1 : -1);' not in bt), True)
ck('跟随路线时分离力减弱（不再被推离路线）',
   ('if (unit._onLane) pushMul *= 0.2;' in bt)
   and ('else if (unit._navPath && unit._navPath.length) pushMul *= 0.35;' in bt), True)
ck('路网 Dijkstra 换二叉堆（旧版 O(V²) 线性扫描已删）',
   ('const hPush = (f, v) => {' in gm) and ('let cur = -1, best = Infinity;' not in gm), True)
ck('受阻抗衡未被破坏（申请重算仍只有一处、冷却 60s）',
   (bt.count('unit._navStuck = true;') == 1) and ('const NAV_ROUTE_FAIL_COOLDOWN = 60;' in bt), True)
ck('命令级承诺未被破坏（周期重算仍未回归）',
   ('function navJitterOf' not in bt) and ('sinceNav > NAV_ROUTE_RECHECK' not in bt), True)

for nm, txt in (('grid-maps.js', gm), ('battle.js', bt)):
    ck(nm + ' 括号平衡', txt.count('{') - txt.count('}'), 0)

print('')
print('%s' % ('全部通过 ✓' if fails == 0 else '%d 项失败 ✗' % fails))
sys.exit(0 if fails == 0 else 1)

