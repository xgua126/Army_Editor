# -*- coding: utf-8 -*-
# 寻路抖动（抽振 / 折返 / A* 疯涨）的离线回归测试
# 把 battle.js 里三条决策规则的【旧版 vs 新版】摆在一起，断言新版把翻转/替换次数压到极低。
# 用户实测症状：单位在「有路点/没路点」两种状态间抽振；走两秒直线又折返回路点；
#               A* 一分钟 5275 次（约 88 次/秒，高刷屏 + crowded 每 0.6s 触发重算）。
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PATH_GAIN = 0.02        # 进入路径：路径比直线省 >= 2%
PATH_EXIT_GAIN = 0.15   # 退出路径：直线要比路径省 >= 15%（双阈值滞回）
REPATH_GAIN = 0.95      # 路线承诺：新路线必须 < 旧路线 * 0.95（省 >= 5%）才替换

fails = 0
def ck(name, got, cond, note=''):
    global fails
    ok = bool(cond)
    if not ok: fails += 1
    print(('  ok   ' if ok else '  FAIL ') + name + ': ' + str(got) + ('  ' + note if note else ''))


# ===== A. 直线/路径 选择：新旧规则在同一串「省幅抖动」下的翻转次数 =====
def old_use_path(sc, pc, was):
    return pc < sc * (1 - PATH_GAIN)

def new_use_path(sc, pc, was):
    # 已在走路径时，允许「路径比直线贵 <=15%」继续走路径
    if was: return pc < sc * (1 + PATH_EXIT_GAIN)
    return pc < sc * (1 - PATH_GAIN)

def count_flips(fn, gains):
    was = False; flips = 0
    for g in gains:
        pc = 1000.0 * (1 - g)
        now = fn(1000.0, pc, was)
        if now != was: flips += 1
        was = now
    return flips

print('== A. 直线 <-> 路径：省幅在 2% 阈值附近抖动（20 次评估）==')
gains = [0.031, 0.019, 0.022, 0.018, 0.021, 0.017, 0.023, 0.019, 0.020, 0.018,
         0.022, 0.016, 0.024, 0.019, 0.021, 0.018, 0.020, 0.017, 0.023, 0.019]
fo = count_flips(old_use_path, gains)
fn_ = count_flips(new_use_path, gains)
print('   旧规则翻转 ' + str(fo) + ' 次 / 新规则翻转 ' + str(fn_) + ' 次')
ck('旧规则确实会反复翻转（>6 次）', fo, fo > 6, '<- 这就是走路点/走直线来回跳的根因')
ck('新规则几乎不翻转（<=1 次）', fn_, fn_ <= 1)


# ===== B. 路线承诺：新路线只小幅更优时不替换（防掉头）=====
def old_take(oldc, newc):
    return True

def new_take(oldc, newc):
    return newc < oldc * REPATH_GAIN

def count_takes(fn, deltas):
    oldc = 1000.0; takes = 0
    for d in deltas:
        newc = oldc * (1 - d)
        if fn(oldc, newc):
            takes += 1; oldc = newc
    return takes

print('== B. 路线承诺：新路线代价在 +-3% 内抖动（30 次重算），最后一次真省 12% ==')
deltas = [0.03, -0.02, 0.025, -0.03, 0.02, 0.028, -0.025, 0.03, -0.02, 0.026,
          -0.03, 0.022, 0.028, -0.02, 0.024, -0.028, 0.03, -0.022, 0.026, -0.03,
          0.021, 0.029, -0.024, 0.027, -0.021, 0.023, -0.029, 0.025, -0.026, 0.12]
to = count_takes(old_take, deltas)
tn = count_takes(new_take, deltas)
print('   旧规则替换 ' + str(to) + ' 次 / 新规则替换 ' + str(tn) + ' 次')
ck('旧规则每次都换（= 每次都可能换个方向）', to, to == len(deltas))
ck('新规则只在真正省 12% 时换一次', tn, tn == 1)


# ===== C. 重算频率：30 个单位跑 60 秒 =====
def sim_repath(units, dur, tick, old):
    total = 0
    for u in range(units):
        since = 9999.0; path = True; t = 0.0; k = 0
        while t < dur - 1e-9:
            t += tick; since += tick; k += 1
            goal = (k % int(20.0 / tick) == 0)            # 目标每 20 秒变一次
            crowded = (k % int(1.0 / tick)) < int(0.7 / tick)   # 70% 时间为拥挤
            if old:
                need = goal or (crowded and since > 0.6) or since > 2.0
            else:
                need = goal or since > (25.0 if path else 9.0)
            if need:
                total += 1; since = 0.0
    return total

print('== C. 30 个单位跑 60 秒：触发多少次重算 ==')
ro = sim_repath(30, 60.0, 0.1, True)
rn = sim_repath(30, 60.0, 0.1, False)
print('   旧规则 ' + str(ro) + ' 次  ⇒ ' + str(round(ro / 60.0, 1)) + ' 次/秒')
print('   新规则 ' + str(rn) + ' 次  ⇒ ' + str(round(rn / 60.0, 1)) + ' 次/秒')
ck('新规则至少降 8 倍', round(ro / max(1, rn), 1), ro >= rn * 8)
ck('新规则 <= 令牌桶上限 12 次/秒', round(rn / 60.0, 1), rn / 60.0 <= 12.0)

print('')
print('全部通过 ✓' if fails == 0 else str(fails) + ' 项失败 ✗')
sys.exit(0 if fails == 0 else 1)
