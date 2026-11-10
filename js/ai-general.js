/* ============================================================
   ★★★ R9：将军层 ai-general.js —— 每方一个"将军"
   ------------------------------------------------------------
   规模（与《钢铁之师2》同一量级）：每方 ≤60 个兵牌、单兵最多 240/单位、
   一场 20 分钟、**纯观战（双方 AI）**。⇒ 将军层不碰任何单位内部状态，
   只做一件事：

        **每 3~6 秒想一次，然后通过 Cmd.issue() 下命令。**

   为什么必须这么切：R8 之前"谁在写意图"散在 6 处（decideCommand /
   computeObjectiveMove / evaluateGroupStance / 空闲兜底 …），互相覆盖 ⇒
   玩家看到的"整体静止 / 抽搐"本质上是**意图在打架**。现在：

        · 意图（去哪 / 打谁 / 守不守） = 本文件 + cmd.js（唯一写者）
        · 执行（怎么走 / 队形 / 开火 / 上下车） = battle.js **原样保留**

   v1 决策规则（只有 3 条 —— 先把管道跑通，再谈战术）：
     ① 本方兵力 < 30%      ⇒ HOLD   （守住，别再送）
     ② 组视野里出现敌人    ⇒ ATTACK （打最近的；位置随命令一起下发，
                                       这样"看不见敌人"的单位也知道往哪推）
     ③ 其它                ⇒ MOVE_TO（最近的我方未控据点；同组稳定、不来回改）

   三条硬约束（都是为了避免"新机制引入新的周期性抖动"）：
     · 每次 tick 最多下发 MAX_ORDERS 条 ⇒ 60 个兵牌也不会在同一帧炸出 60 条
     · **只发"变化了"的命令**（目标没变 = 不重发）⇒ 不会每 3 秒把部队的
       计划重置一次（那正是"原地横跳"的成因）
     · 每个组一个固定相位（hashStr(gk)）+ **一次遍历**建好 gk→单位表
       ⇒ 既不会全挤到同一点，也不会在组循环里反复扫全表打出帧尖峰

   待做（见 待办TODO.md §50）：
     · ④ 弹药 < 20% ⇒ RESUPPLY（等 ③ 补给点落地后再加这条规则）
     · ⑤ 真正的战术：交替跃进 / 侧翼 / 预备队（在本文件加规则，不动执行层）
   ============================================================ */
(function () {
  const THINK_MIN = 3, THINK_MAX = 6;      // 将军思考间隔（秒，随机）
  const MAX_ORDERS = 8;                    // 每次 tick 最多下发几条（摊帧，防同步尖峰）
  const STRENGTH_HOLD = 0.30;              // 兵力低于这个比例 ⇒ 全军固守
  const REPICK_DIST = 2500;                // 有更近的据点、且近这么多米（2500）才改派
  const ATTACK_KEEP = 1.15;                // 已有攻击目标时，新目标要近 15% 才换（迟滞）

  /* ★ 应急开关：地址后加 `?gen=0` ⇒ 将军层**完全停手**（命令层保持为空，
     部队回到"原有 AI 自己决定"的行为）。用来 A/B 对照"新将军层 vs 老行为"，
     一行判定、零风险 —— 纯观战模式下 AI 出问题就等于整场没法看，必须留这个阀门。 */
  const ENABLED = !/[?&]gen=0/.test(location.search);

  const sides = {
    blue: { nextThink: 0.4, cursor: 0, menMax: 0, men: 0, issued: 0, last: null },
    red:  { nextThink: 1.1, cursor: 0, menMax: 0, men: 0, issued: 0, last: null },
  };
  sides._lastTarget = {};

  /* ---------- 环境探测 ----------
     ★ battle / Cmd 都是**顶层 let/const**（不是 window 属性），所以只能用
       typeof 判断（变量未声明时 typeof 是安全的） */
  function hasBattle() { return (typeof battle !== 'undefined') && battle && battle.units; }
  function hasCmd() { return (typeof Cmd !== 'undefined') && Cmd && typeof Cmd.issue === 'function'; }
  function now() { return hasBattle() ? battle.time : 0; }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (Math.abs(h) % 1000) / 1000;        // 0~1
  }

  /* ---------- 兵力：按【单兵数】统计 ----------
     ★ 玩家规则：兵牌只是显示工具，真正的实体是士兵 ⇒ 规模/强弱一律用人数 */
  function menOf(side) {
    let n = 0;
    for (const u of battle.units) {
      if (!u.alive || u.side !== side) continue;
      const ss = u.soldiers || [];
      if (!ss.length) { n++; continue; }        // 没有单兵建模的单位（纯车辆）算 1
      for (let i = 0; i < ss.length; i++) if (ss[i].alive) n++;
    }
    return n;
  }

  /* 该方的"组"（unit._groupKey = 编制树上一级；对应 SD2 的战斗群/营连）
     ★ 一次遍历就建好 gk → 单位列表，**不要在组循环里反复扫 battle.units**：
       60 个组 × 数千单位 = 每次思考十几万次判定，会把帧时间打出尖峰
       （R8.1 的教训：所有"周期性重算"都必须摊开/一次算完）。 */
  function unitsByGroup(side) {
    const map = new Map();
    for (const u of battle.units) {
      if (!u.alive || u.side !== side || !u._groupKey) continue;
      let arr = map.get(u._groupKey);
      if (!arr) { arr = []; map.set(u._groupKey, arr); }
      arr.push(u);
    }
    return map;
  }

  function centroid(us) {
    let cx = 0, cy = 0;
    for (const u of us) { cx += u.x; cy += u.y; }
    return { x: cx / us.length, y: cy / us.length };
  }

  /* 组视野**并集**：{ near: 最近的敌人, list: 视野内的全部敌人 }（null = 没看见任何敌人） */
  function seenEnemies(us, cx, cy) {
    const seen = new Map();
    for (const u of us) {
      const vs = u.visibleEnemies || [];
      for (const e of vs) if (e && e.alive && e.id != null && !seen.has(e.id)) seen.set(e.id, e);
    }
    if (!seen.size) return null;
    const list = Array.from(seen.values());
    let near = null, bd = Infinity;
    for (const e of list) {
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < bd) { bd = d; near = e; }
    }
    return { near, list };
  }

  function defenderOf(side) {
    return (typeof defenderSide === 'function') && defenderSide() === side;
  }

  /* 该方"该去"的据点池：守方先守自己的点；否则去打不由我方控制的点 */
  function objectivePool(side, isDef) {
    const os = battle.objectives || [];
    if (!os.length) return [];
    if (isDef) {
      const mine = os.filter(o => o.owner === side);
      if (mine.length) return mine;
    }
    const theirs = os.filter(o => o.owner !== side);
    return theirs.length ? theirs : os;
  }

  /* 选据点：近者优先 + 组相位偏移（分散）+ 已被别的组认领的点加权（避免全挤一个点）
     + **迟滞**：不因为一点距离差就换点（换点 = 全组掉头 ⇒ 玩家看到"折返跑"）
     ★ 将军层与执行层共用同一张"认领表"（battle._groups[gk].cmdObjId，由 battle.js 镜像） */
  function pickObjective(side, gk, cx, cy, isDef, claim) {
    const pool = objectivePool(side, isDef);
    if (!pool.length) return null;
    const gs = battle._groups && battle._groups[gk];
    const cur = (gs && gs.cmdObjId) ? pool.find(o => o._id === gs.cmdObjId) : null;
    const off = hashStr(gk) * 600;
    let best = null, bestScore = Infinity;
    for (const o of pool) {
      const d = Math.hypot(o.x - cx, o.y - cy);
      const score = (d - Math.max(0, o.r || 150) * 0.3 + off) * (1 + 0.9 * (claim[o._id] || 0));
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (cur && best && best._id !== cur._id) {
      const dCur = Math.hypot(cur.x - cx, cur.y - cy);
      const dBest = Math.hypot(best.x - cx, best.y - cy);
      if (dCur - dBest < REPICK_DIST) best = cur;
    }
    if (best) claim[best._id] = (claim[best._id] || 0) + 1;
    return best;
  }

  /* 攻击目标迟滞：已有目标**此刻还看得见**、且新目标没近 15% ⇒ 不换（防"每 3 秒换一次目标"）
     ★ 保留的旧目标必须是 **seen.list 里的**（= 当前视野内）——
       否则 AI 会去追一个"自己看不见的敌人"，那就是开全图作弊。 */
  function pickAttackTarget(gk, seen, cx, cy) {
    if (!seen) return null;
    const curId = sides._lastTarget[gk];
    const cur = (curId != null) ? seen.list.find(u => u.id === curId) : null;
    if (cur) {
      const dCur = Math.hypot(cur.x - cx, cur.y - cy);
      const dNew = Math.hypot(seen.near.x - cx, seen.near.y - cy);
      if (dNew > dCur * ATTACK_KEEP) return cur;
    }
    return seen.near;
  }

  /* ============================================================
     ★★★ R9.2：**战法（stance）由将军定** —— 这是"combat AI"那一半的收敛点
     ------------------------------------------------------------
     旧版是**每个单位**各跑一遍 utility 评分（TACTICAL_WEIGHTS：HOLD/BOUND/ASSAULT/
     FLANK/REGROUP/WITHDRAW）⇒ 同一个组里两个单位可能一个在"跃进"一个在"据守"，
     而且每 2 秒重评一次 ⇒ 玩家看到的"走两步停一下 / 原地横跳"就是这么来的。
     现在：**将军按组评一次**，把战法写进命令（`ord.stance`）→ 镜像到 `battle._groups[gk].stance`
     → 执行层只"读"战法（`updateTacticalOption`），不再自己决定"走还是停"。
     评分输入全部来自**已有的事实**（兵力比 / 压制 / 掩体 / 敌我数量），不新增判据。
     ============================================================ */
  const STANCE_CN = { assault: '冲锋', bound: '交替跃进', hold: '据守', flank: '侧翼',
                      reserve: '重整', withdraw: '撤退' };
  const AMMO_RESUPPLY = 0.20;      // 组平均备弹低于这个比例 ⇒ 去补给

  /* 组平均备弹（0~1）；按**单兵/车辆武器**算，和 DEV 面板显示的同一个口径 */
  function groupAmmo(us) {
    if (typeof unitAmmoRatio !== 'function' || !us.length) return 1;
    let s = 0;
    for (const u of us) s += unitAmmoRatio(u);
    return s / us.length;
  }

  /* 组级战法评估（顺序 = 优先级） */
  function pickStance(us, isDef) {
    const side = us[0].side;
    let cx = 0, cy = 0, hp = 0, hpMax = 0, supp = 0, cover = 0;
    for (const u of us) {
      cx += u.x; cy += u.y;
      hp += u.hpPersonnel || 0;
      hpMax += u.hpPersonnelMax || 0;
      supp = Math.max(supp, u.suppressionLevel || 0);
      if (typeof getCoverAt === 'function') cover = Math.max(cover, getCoverAt(u.x, u.y));
    }
    cx /= us.length; cy /= us.length;
    const hpRatio = hpMax > 0 ? hp / hpMax : 1;

    let friends = 0, enemies = 0;
    for (const o of battle.units) {
      if (!o.alive) continue;
      if (Math.hypot(o.x - cx, o.y - cy) > 1500) continue;
      if (o.side === side) friends++; else enemies++;
    }

    if (hpRatio < 0.35 || supp >= 0.85) return 'withdraw';     // 打残 / 被彻底压住 ⇒ 撤
    if (isDef) return cover > 0.5 ? 'hold' : 'bound';          // 守方：有掩体就守，没掩体交替跃进
    if (enemies === 0) return 'assault';                       // 没接敌 ⇒ 直接推进（不再慢吞吞）
    if (enemies > friends * 1.6) return cover > 0.5 ? 'hold' : 'withdraw';
    if (friends > enemies * 1.5) return 'assault';             // 明显优势 ⇒ 冲锋
    return 'bound';                                            // 均势 ⇒ 交替跃进
  }

  /* ---------- 一次思考：为一个 side 产出并下发所有组的命令 ---------- */
  function think(side) {
    const st = sides[side];
    const isDef = defenderOf(side);
    const men = menOf(side);
    st.menMax = Math.max(st.menMax, men);
    st.men = men;
    const ratio = st.menMax > 0 ? men / st.menMax : 1;

    const byGroup = unitsByGroup(side);
    if (!byGroup.size) return null;
    const gks = Array.from(byGroup.keys()).sort();

    const n = gks.length;
    const start = st.cursor % n;
    const claim = {};
    const wants = [];

    for (let i = 0; i < n; i++) {
      const gk = gks[(start + i) % n];
      const us = byGroup.get(gk);
      if (!us || !us.length) continue;
      const c = centroid(us);

      const stance = pickStance(us, isDef);
      let want = null;
      if (ratio < STRENGTH_HOLD) {
        want = { type: 'HOLD', stance: 'hold', note: '兵力 ' + Math.round(ratio * 100) + '% < 30% ⇒ 固守' };
      } else {
        const seen = seenEnemies(us, c.x, c.y);
        if (seen) {
          const t = pickAttackTarget(gk, seen, c.x, c.y);
          sides._lastTarget[gk] = t.id;
          want = { type: 'ATTACK', targetId: t.id, x: t.x, y: t.y, stance,
                   note: '接敌 ' + (t.name || t.id) + ' · ' + STANCE_CN[stance] };
        } else {
          delete sides._lastTarget[gk];
          /* ★ R9.2：**没接敌但打空了 ⇒ 去补给**（比"继续攻点"优先级高：空枪推上去就是送） */
          const ammo = groupAmmo(us);
          const sup = (typeof nearestSupplyFor === 'function') ? nearestSupplyFor(us) : null;
          if (ammo < AMMO_RESUPPLY && sup) {
            want = { type: 'RESUPPLY', supplyId: sup.id, x: sup.x, y: sup.y, stance: 'hold',
                     note: '备弹 ' + Math.round(ammo * 100) + '% ⇒ ' + sup.name };
          } else {
            const o = pickObjective(side, gk, c.x, c.y, isDef, claim);
            if (o) {
              want = { type: 'MOVE_TO', objectiveId: o._id, stance,
                       note: (isDef ? '守点 ' : '攻点 ') + (o.name || o._id) + ' · ' + STANCE_CN[stance] };
            }
          }
        }
      }
      if (want) wants.push({ gk, want });
    }

    /* ---------- 下发：先照顾"还没有命令的组"，再处理"命令变了"的组 ---------- */
    let issued = 0, holds = 0, attacks = 0, moves = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const it of wants) {
        if (issued >= MAX_ORDERS) break;
        const cur = Cmd.current(it.gk);
        const active = (cur && !cur.done) ? cur : null;
        if (pass === 0 && active) continue;      // 第一轮：只给没有命令的组
        if (pass === 1 && !active) continue;     // 第二轮：命令有变化的组
        const w = it.want;
        const same = active && active.type === w.type
          && (w.objectiveId ? active.objectiveId === w.objectiveId : true)
          && (w.targetId ? active.targetId === w.targetId : true)
          && (w.stance ? active.stance === w.stance : true)      // ★ 战法变了也要重发
          /* ★ 敌情位置也算"变化"：ATTACK 命令里带的是**下达那一刻**的敌人坐标，
             敌人跑远了（>300m）就必须重发 —— 否则部队会一直冲向几秒前的旧坐标。 */
          && (w.x == null || active.x == null || Math.hypot(active.x - w.x, active.y - w.y) < 300);
        if (same) continue;                      // 没变 ⇒ 不重发（关键：不重置部队的计划）
        const ord2 = Cmd.issue('ai', it.gk, w.type, w);
        /* ★ R9.3：被**玩家命令**挡住时 `issue` 会原样返回玩家那条 ⇒ 不算"我们发出去了"
           （否则将军的名额会被"白试"消耗掉，别的组得不到命令） */
        if (ord2 && ord2.src === 'ai') {
          issued++;
          if (w.type === 'HOLD') holds++;
          else if (w.type === 'ATTACK') attacks++;
          else moves++;
        }
      }
      if (issued >= MAX_ORDERS) break;
    }

    st.issued++;
    st.cursor = (start + Math.max(1, issued)) % n;   // 轮转 ⇒ 兵牌多时也不会永远只照顾前几个组
    const sum = {
      t: Math.round(battle.time * 10) / 10, side, men, menMax: st.menMax,
      ratio: Math.round(ratio * 100) / 100, groups: n,
      issued, holds, attacks, moves, active: Cmd.summary().active,
    };
    st.last = sum;
    return sum;
  }

  /* ---------- 每帧被 battle.js 调用（见 updateBattle） ---------- */
  function tick() {
    if (!ENABLED) return null;                    // ?gen=0 ⇒ 将军层停手（命令层留空，交回原有 AI）
    if (!hasBattle() || !hasCmd()) return null;
    if (!battle.running || battle.paused || battle.ended) return null;
    if (!battle._groups) return null;             // 开局还没建组

    /* ★ 新的一局：battle.time 回到 0（时间倒流）⇒ 清掉上一局的记忆
       （兵力基线 / 攻击目标 / 轮转游标 / 思考相位）—— 否则"再打一次"后
        将军会拿着上一局的基准兵力，一开局就把全军判成"兵力不足 ⇒ 固守"。 */
    const t = now();
    if (t < (sides._t || 0)) {
      for (const s of ['blue', 'red']) {
        const st = sides[s];
        st.menMax = 0; st.men = 0; st.cursor = 0; st.issued = 0; st.last = null;
        st.nextThink = (s === 'blue') ? 0.4 : 1.1;
      }
      sides._lastTarget = {};
    }
    sides._t = t;

    let out = null;
    for (const side of ['blue', 'red']) {
      const st = sides[side];
      /* ★★★ R9.5：**玩家操控的阵营，将军彻底不管**（命令只由玩家下）
         —— 这是"AI 老是覆盖我的命令"的根治：不是靠优先级去抢，而是根本没人跟你抢。
         （顶栏「👁 显示」里的"蓝/红方 AI 接管"可以单独打开，用于对比。） */
      if (battle.aiEnabled && battle.aiEnabled[side] === false) continue;
      if (t < st.nextThink) continue;
      st.nextThink = t + THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN);
      try {
        const s = think(side);
        if (s) out = s;
      } catch (e) {
        console.error('[General] ' + side + ' 决策异常（本帧已跳过）：', e);
      }
    }
    return out;
  }

  window.General = {
    tick: tick,
    sides: sides,
    summary: function () { return { blue: sides.blue.last, red: sides.red.last }; },
    /* 只读常量，给 DEV 面板 / 调试看 */
    THINK_MIN: THINK_MIN, THINK_MAX: THINK_MAX,
    MAX_ORDERS: MAX_ORDERS, STRENGTH_HOLD: STRENGTH_HOLD,
  };
})();
