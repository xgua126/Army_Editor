# -*- coding: utf-8 -*-
"""
战术选项打分仿真台（决策层 TACTICAL_WEIGHTS 离线验证）
-----------------------------------------------------------------
用途：改 battle.js 里的 TACTICAL_WEIGHTS 之后，先跑这个脚本确认
      "六个选项在各典型态势下还选得对"，再进游戏实测（省得反复手操）。

用法：python army-editor/tools/tactical_weights_sim.py

⚠ 本文件是 battle.js 中 scoreTacticalOptions() / TACTICAL_WEIGHTS 的复刻，
  改了 JS 那边请同步改这里（公式一一对应，注释标了同样的名字）。
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ===== 与 battle.js 的 TACTICAL_WEIGHTS 保持一致 =====
W = {
 'hold': dict(outOfRange=0.9, cover=2.0, supp=0.9, support=0.6, weak=0.3, defend=1.0, pinned=1.2),
 'bound': dict(outOfRange=1.2, noCover=1.0, assault=1.0, even=0.3, supp=1.2),
 'assault': dict(canFire=0.6, enemySupp=1.6, edge=1.6, morale=0.6, supp=1.4),
 'withdraw': dict(supp=1.5, weak=2.0, lowMorale=1.2, noCover=0.5, assault=0.8, friends=0.6),
 'regroup': dict(supp=1.7, weak=1.1, assault=1.0, friends=1.3),
 'flank': dict(even=0.6, assault=0.9, outOfRange=0.9, calm=0.6, cover=0.6, engaged=1.2),
}

def score(s):
    """与 battle.js scoreTacticalOptions() 一一对应"""
    even = 1 - abs(s['ratio'] - 0.5) * 2
    return {
      'HOLD': W['hold']['outOfRange']*s['outOfRange'] + W['hold']['cover']*s['cover']
              + W['hold']['supp']*s['supp'] + W['hold']['support']*s['support']
              + W['hold']['weak']*(1-s['ratio']) + W['hold']['defend']*(1-s['assaultMission'])
              - W['hold']['pinned']*s['supp'],
      'BOUND': W['bound']['outOfRange']*s['outOfRange'] + W['bound']['noCover']*(1-s['cover'])
              + W['bound']['assault']*s['assaultMission'] + W['bound']['even']*even
              - W['bound']['supp']*s['supp'],
      'ASSAULT': W['assault']['canFire']*s['canFire'] + W['assault']['enemySupp']*s['enemySupp']
              + W['assault']['edge']*max(0, s['edge']) + W['assault']['morale']*s['morale']
              - W['assault']['supp']*s['supp'],
      'WITHDRAW': W['withdraw']['supp']*s['supp'] + W['withdraw']['weak']*(1-s['ratio'])
              + W['withdraw']['lowMorale']*(1-s['morale']) + W['withdraw']['noCover']*(1-s['cover'])
              - W['withdraw']['assault']*s['assaultMission'] - W['withdraw']['friends']*s['friendNear'],
      'REGROUP': W['regroup']['supp']*s['supp'] + W['regroup']['weak']*(1-s['ratio'])
              - W['regroup']['assault']*s['assaultMission'] + W['regroup']['friends']*s['friendNear'],
      'FLANK': W['flank']['even']*even + W['flank']['assault']*s['assaultMission']
              + W['flank']['outOfRange']*s['outOfRange'] + W['flank']['calm']*(1-s['supp'])
              + W['flank']['cover']*s['cover'] - W['flank']['engaged']*s['canFire'],
    }

def mk(canFire, cover, supp, ratio, morale=1.0, enemySupp=0.0, support=0, mission=1.0, friendNear=0.5):
    """与 battle.js assessSituation() 一一对应（canFire/outOfRange 由能否打到折算）"""
    return dict(canFire=1 if canFire else 0, outOfRange=0 if canFire else 1,
                cover=cover, supp=supp, ratio=ratio, edge=(ratio-0.5)*2,
                morale=morale, enemySupp=enemySupp, support=support, assaultMission=mission,
                friendNear=friendNear)

# (态势, 因子, 期望选择)
CASES = [
 ("1 遭遇800m超射程/平地无掩体/均势/有炮/进攻", mk(False, 0.0, 0.0, 0.50, 1.0, 0.0, 1, 1.0), "BOUND(推进)"),
 ("2 300m可开火/无掩体/均势",                  mk(True,  0.0, 0.0, 0.50, 1.0, 0.0, 1, 1.0), "BOUND→原地/找掩体"),
 ("3 300m可开火/掩体0.8/均势",                 mk(True,  0.8, 0.0, 0.50, 1.0, 0.0, 1, 1.0), "HOLD(据守)"),
 ("4 300m/无掩体/被压0.8/劣势0.30/进攻",        mk(True,  0.0, 0.8, 0.30, 1.0, 0.0, 1, 1.0), "WITHDRAW"),
 ("5 300m/敌军崩0.9/我方优0.70",               mk(True,  0.0, 0.0, 0.70, 1.0, 0.9, 1, 1.0), "ASSAULT(冲)"),
 ("6 防守方500m超射程/掩体1.0/均势",           mk(False, 1.0, 0.0, 0.50, 1.0, 0.0, 1, 0.0), "HOLD(守壕)"),
 ("7 800m超射程/掩体0.6/劣势0.40/进攻",        mk(False, 0.6, 0.0, 0.40, 1.0, 0.0, 1, 1.0), "FLANK(迂回)"),
 ("8 300m/被压0.9/劣势0.25/票池剩30%",         mk(True,  0.2, 0.9, 0.25, 0.3, 0.0, 0, 1.0), "WITHDRAW/REGROUP"),
 ("9 300m/被压0.9/劣势0.25/防守",              mk(True,  0.2, 0.9, 0.25, 0.9, 0.0, 1, 0.0), "WITHDRAW"),
 ("A 800m超射程/无掩体/均势/防守(守方)",        mk(False, 0.0, 0.0, 0.50, 1.0, 0.0, 0, 0.0), "BOUND(迎战)"),
 ("B 300m/被压1.0/劣势0.20/掩体0.9/友军3个",    mk(True,  0.9, 1.0, 0.20, 0.5, 0.0, 1, 1.0, 1.0), "REGROUP(收拢)"),
 ("C 300m/被压1.0/劣势0.20/掩体0.9/孤立无友军", mk(True,  0.9, 1.0, 0.20, 0.5, 0.0, 0, 1.0, 0.0), "WITHDRAW(撤)"),
]

hits = 0
for name, s, expect in CASES:
    sc = score(s)
    order = sorted(sc.items(), key=lambda kv: -kv[1])
    top = order[0]
    ok = top[0] in expect
    hits += 1 if ok else 0
    print(("  OK  " if ok else " FAIL ") + name)
    print("        选: %s (%.2f)   期望: %s" % (top[0], top[1], expect))
    print("        " + "  ".join("%s%.2f" % (k, v) for k, v in order))
print("\n%d/%d 通过" % (hits, len(CASES)))
