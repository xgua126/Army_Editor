/* ============================================================
   ★★★ R9：命令层 cmd.js —— 玩家 / 将军AI / 脚本 **共用同一条命令管道**
   ------------------------------------------------------------
   本项目规模（与《钢铁之师2》同一量级）：每方 ≤60 个兵牌、地图 13×7~20×12km、
   单位粒度 排/班/组/单兵、单兵最多 240/单位、一场 20 分钟、**纯观战（双方 AI）**。
   ⇒ 于是：
     · **命令粒度 = 组**（unit._groupKey，= 编制树上一级，对应 SD2 的「战斗群/营连」）
     · 命令是**意向 + 完成判定**（SD2 的 Smart Orders），不是每帧的临时目标
     · src = ai | player | script，优先级 **player > script > ai**
     · ★ 只有本文件能改「组命令」⇒ 把以前「6 处都在写 moveTarget」收敛成 1 处
   ============================================================ */

const CMD_TYPES = ['MOVE_TO','ATTACK','HOLD','TAKE_COVER','GARRISON','BOARD','DISMOUNT','FIRE_MISSION','WITHDRAW','SET_STANCE','RESUPPLY'];

/* ★★★ R9.2：**命令表 = 唯一真相**（谁能发 / 需要什么装备 / 是一次性还是持续）
   —— 将军层、玩家、脚本**共用这一张表**；加新命令只需在这里加一行。 */
const CMD_SPEC = {
  MOVE_TO:      { fast: true, needs: null,        once: true  },
  ATTACK:       { needs: null,                    once: true  },
  HOLD:         { needs: null,                    once: false },
  TAKE_COVER:   { needs: null,                    once: true  },
  GARRISON:     { needs: 'building',              once: true  },
  BOARD:        { needs: 'vehicle',               once: true  },
  DISMOUNT:     { needs: 'vehicle',               once: true  },
  FIRE_MISSION: { needs: 'artillery',             once: false },
  WITHDRAW:     { needs: null,                    once: true  },
  SET_STANCE:   { needs: null,                    once: false },
  RESUPPLY:     { needs: 'supply',                once: true  },
};

/* 命令中文名（DEV 面板 / 红字提示用） */
const CMD_TYPE_CN = {
  MOVE_TO: '移动', ATTACK: '攻击', HOLD: '固守', TAKE_COVER: '找掩体',
  GARRISON: '进驻', BOARD: '上车', DISMOUNT: '下车',
  FIRE_MISSION: '火力任务', WITHDRAW: '撤退', SET_STANCE: '战法', RESUPPLY: '补给',
};

/* ★★★ R9.4：**命令超时表（秒）** —— 没列的 / 0 = 持续命令（HOLD / SET_STANCE / FIRE_MISSION）不超时。
   目的：任何"永远完不成"的命令都**不许永久占住一个组** ——
   否则玩家的命令会让那个组被 AI 彻底放弃（将军无法覆盖 player），
   某些类型还会每 0.4 秒重试一次重活（成员重排 / 全员下车）⇒ 直接卡死页面。
   超时后按"完成"处理，原因写在 `doneReason='超时 Ns'`（DEV 面板与日志都看得到）。 */
const ORD_TIMEOUT = {
  MOVE_TO: 120, ATTACK: 150, TAKE_COVER: 30, GARRISON: 90,
  BOARD: 20, DISMOUNT: 20, WITHDRAW: 60, RESUPPLY: 150,
};

const Cmd = {
  state: {},        // groupKey -> order
  log: [],          // 最近 200 条：{t, src, gk, type, note}
  maxLog: 200,
  counts: { ai: 0, player: 0, script: 0 },
  rejects: [],      // 被拒绝的命令（最近 20 条）：{t, src, type, msg}
  toast: null,      // 玩家命令被拒 ⇒ 上屏红字 {msg, until}

  /* ---------- 唯一入口 ---------- */
  issue(src, gk, type, p) {
    if (!gk || CMD_TYPES.indexOf(type) < 0) return null;
    p = p || {};
    const prev = this.state[gk];
    /* 优先级：玩家命令未完成时 AI 不许覆盖；script 同理高于 ai */
    if (prev && !prev.done && prev.src === 'player' && src !== 'player') return prev;
    if (prev && !prev.done && prev.src === 'script' && src === 'ai') return prev;
    const ord = {
      type, src: src || 'ai', at: battle.time, done: false, doneReason: null,
      objectiveId: p.objectiveId || null, targetId: p.targetId || null,
      supplyId: p.supplyId || null,
      x: (p.x == null ? null : p.x), y: (p.y == null ? null : p.y),
      stance: p.stance || null, fast: !!p.fast, route: p.route || null,
      note: p.note || '', groupKey: gk,
    };
    this.state[gk] = ord;
    this.counts[src] = (this.counts[src] || 0) + 1;
    this._push(src, gk, type, p.note || '');
    return ord;
  },

  /* ============================================================
     ★★★ R9.2（④ 命令接口 v1）：**下达命令的唯一安全入口**
     ------------------------------------------------------------
     与 `issue()` 的区别：这里会先做**体检**——
       · 这一组还有没有单位          · 装备门槛（有车才能上下车 / 有炮才能火力任务 / 有补给点才能补给）
       · 走不到就拒绝（只查玩家命令的"直线粗查"：`isStraightPathClear`）
     拒绝时：玩家命令 ⇒ **上屏红字 2 秒** + 记日志；AI 命令 ⇒ 静默改发（将军下一轮会换目标）。
     ★ 将军层以后一律改用 `tryIssue`；`issue()` 保留给"已经体检过"的脚本/AI 内部调用。
     ============================================================ */
  tryIssue(src, gk, type, p) {
    p = p || {};
    if (!gk || CMD_TYPES.indexOf(type) < 0) return this._reject(src, type, '未知命令');
    const us = this.unitsOf(gk);
    if (!us.length) return this._reject(src, type, '这一组没有可用单位');

    const spec = CMD_SPEC[type] || {};
    if (spec.needs === 'vehicle' && !this._groupHas(us, 'vehicle')) {
      return this._reject(src, type, '该组没有载具');
    }
    if (spec.needs === 'artillery' && !this._groupHas(us, 'artillery')) {
      return this._reject(src, type, '该组没有火炮/迫击炮 ⇒ 无法执行火力任务');
    }
    if (spec.needs === 'supply') {
      const sp = (battle.supplies || []).find(s => s.id === p.supplyId)
              || (typeof nearestSupplyFor === 'function' ? nearestSupplyFor(us) : null);
      if (!sp) return this._reject(src, type, '地图上没有补给点');
      p.supplyId = sp.id; p.x = sp.x; p.y = sp.y;
    }
    /* 走不到的"普通移动"：拒绝并提示改用「快速移动」（玩家定案）
       ★ R9.6.6：现在按**单位自己的机动类型**判地形（轮式不该被放行开进森林 —— 开进去就是
       0 倍率原地打滑 = 玩家说的"永久卡住"） */
    if (src === 'player' && type === 'MOVE_TO' && !p.fast && p.x != null) {
      const u0 = us[0];
      const okPath = (typeof isStraightPathClearFor === 'function')
        ? isStraightPathClearFor(u0, p.x, p.y)
        : (typeof isStraightPathClear === 'function' && isStraightPathClear(u0.x, u0.y, p.x, p.y, 25));
      if (!okPath) {
        return this._reject(src, type, '直线方向过不去（试试「快速移动」沿公路走）');
      }
      /* ★ R9.6.7：把"这条腿该乘车还是该走"记进命令（执行层 `updateRideMode` 会照它办，
         否则"步兵下车进城区"会被又拉回车上：车在城区 = 0 倍率 ⇒ 原地打滑） */
      if (typeof unitPlanProfile === 'function') p.planRide = !!unitPlanProfile(u0, p.x, p.y).ride;
    }
    /* ★★★ R9.6.6/7：快速移动 = **按"地形数值 × 单位数值"选路**（时间代价），note 写明算法 + 预计用时。
       ★ R9.6.7：**没有可通行路线时必须拒绝**，不许"偷偷改直线硬穿"——
         旧写法在这里不做体检 ⇒ 玩家看到"普通移动被拒、快速移动却能穿过去"（实测反馈）。 */
    if (type === 'MOVE_TO' && p.fast && p.x != null && typeof planFastRoute === 'function') {
      const u0 = us[0];
      p.route = planFastRoute(u0, p.x, p.y) || null;
      const fi = u0._fastRouteInfo || null;
      if (fi) p.planRide = !!fi.ride;             // ★ R9.6.7：命令级身份（执行层照它上下车）
      const etaTxt = (fi && isFinite(fi.eta) && typeof fmtEta === 'function')
        ? (' · 预计 ' + fmtEta(fi.eta)) : '';
      const whoTxt = (fi && fi.mob) ? ('（' + fi.mob + ' ' + (Math.round(fi.speed * 10) / 10) + 'm/s' + etaTxt + '）') : '';
      if (!p.route) {
        /* 退回直线之前**再做一次通行体检**（同一个判据，和普通移动一致） */
        const okStraight = (typeof isStraightPathClearFor === 'function')
          ? isStraightPathClearFor(u0, p.x, p.y)
          : (typeof isStraightPathClear === 'function' && isStraightPathClear(u0.x, u0.y, p.x, p.y, 25));
        if (!okStraight) {
          return this._reject(src, type,
            '走不过去：附近没有可通行公路，直线方向也不可通行（' + ((fi && fi.mob) || '?') + '）');
        }
        p.note = (p.note ? p.note + ' · ' : '') + ((fi && fi.why) ? fi.why : '附近没公路⇒改直线') + etaTxt;
      } else {
        p.note = (p.note ? p.note + ' · ' : '') + '沿公路' + whoTxt;
      }
    }
    const ord = this.issue(src, gk, type, p);
    return ord ? { ok: true, order: ord } : { ok: false, reason: '被更高优先级的命令挡住' };
  },

  _groupHas(us, what) {
    for (const u of us) {
      if (what === 'vehicle' && u.vehicles && u.vehicles.length) return true;
      if (what === 'artillery' && u.isArtilleryUnit) return true;
      if (what === 'building') return true;                 // 楼由执行层就近挑
    }
    return false;
  },

  _reject(src, type, reason) {
    const msg = '✕ ' + (CMD_TYPE_CN[type] || type) + '：' + reason;
    this.rejects.push({ t: Math.round(battle.time * 10) / 10, src, type, msg });
    if (this.rejects.length > 20) this.rejects.shift();
    if (src === 'player') this.toast = { msg, until: battle.time + 2 };   // ★ 玩家：上屏红字 2 秒
    else this._push('ai', '-', type, '[改发] ' + reason);
    return { ok: false, reason };
  },

  current(gk) { return this.state[gk] || null; },

  clear(gk, why) {
    const o = this.state[gk];
    if (!o) return;
    if (!o.done) { o.done = true; o.doneReason = why || '取消'; }
    this._push(o.src, gk, '-', o.doneReason);
    delete this.state[gk];
  },

  /* ★★★ R9.5d：**命令粒度有两档**（走同一条管道 ⇒ 门槛 / 完成判定 / 看门狗 / 日志全都一样）
       · `gk`        = **组**（编制树上一级）—— 将军层 / 脚本用（整组一起动）
       · `u:<unitId>` = **单个单位** —— 玩家"点谁命令谁"用（不再拖着同组其他单位）
     玩家要求原话："不应该点一个单位给他下命令还要带着他同组的其他单位一起走" */
  unitsOf(gk) {
    if (typeof gk === 'string' && gk.slice(0, 2) === 'u:') {
      const id = gk.slice(2);
      for (const u of battle.units) if (u.alive && u.id === id) return [u];
      return [];                                   // 单位阵亡 ⇒ 上层按"单位全没"判完成
    }
    const out = [];
    for (const u of battle.units) if (u.alive && u._groupKey === gk) out.push(u);
    return out;
  },

  /* ---------- 每帧：完成判定（组级） ---------- */
  tick() {
    for (const gk in this.state) {
      const o = this.state[gk];
      if (!o) continue;
      /* ★ R9：完成 / 取消的命令**保留 1 秒**（让玩家和 DEV 面板看得到"为什么完成"）
         之后回收 —— 不回收的话 Cmd.state 会随战局无限增长（一局几百个组），
         而且 battle.js 会一直看到一个"已完成"的命令，误判成"这组还有命令"。 */
      if (o.done) {
        if (o._doneAt == null) o._doneAt = battle.time;
        else if (battle.time - o._doneAt > 1) delete this.state[gk];
        continue;
      }
      const us = this.unitsOf(gk);
      if (!us.length) { o.done = true; o.doneReason = '单位全没'; continue; }
      const need = Math.ceil(us.length * 0.6);

      /* ★★★ R9.4：**命令看门狗**（见上面的 ORD_TIMEOUT）
         —— 永远完不成的命令不能永久占住这个组，否则玩家命令 = 永久冻结那一组。
         ★★★ R9.5b：但**玩家的命令跳过看门狗** —— 玩家的意图不许被静默丢弃
         （否则 120 秒后"移动"命令自动失效 ⇒ 部队自己动起来 = "命令被覆盖"）。
         玩家想取消就按 ✋ 停止 / 右键下新命令。 */
      const tmo = ORD_TIMEOUT[o.type];
      if (tmo && o.src !== 'player' && battle.time - o.at > tmo) {
        o.done = true; o.doneReason = '超时 ' + tmo + 's';
      }
      if (o.type === 'MOVE_TO') {
        const o2 = o.objectiveId ? battle.objectives.find(x => x._id === o.objectiveId) : null;
        const tx = o2 ? o2.x : o.x, ty = o2 ? o2.y : o.y;
        if (tx == null) { o.done = true; o.doneReason = '没有目标点'; continue; }
        const rr = o2 ? Math.max(60, o2.r * 0.9) : 60;
        let arrived = 0, enemySeen = 0;
        for (const u of us) {
          /* ★ R9.6.4：到达判定用"抵达半径"（单位占地），不再叠加士兵铺开半径 */
          if (Math.hypot(u.x - tx, u.y - ty) < rr + (typeof unitArriveRadius === 'function' ? unitArriveRadius(u) : 0)) arrived++;
          if (u.visibleEnemies && u.visibleEnemies.length) enemySeen++;
        }
        if (arrived >= need) { o.done = true; o.doneReason = '到达'; }
        else if (enemySeen >= need) { o.done = true; o.doneReason = '遭遇敌军⇒转攻击'; }
      } else if (o.type === 'ATTACK') {
        const tg = o.targetId ? battle.units.find(u => u.id === o.targetId) : null;
        if (tg) {
          if (!tg.alive) { o.done = true; o.doneReason = '目标已消灭'; }
        } else if (o.x != null) {
          /* ★★★ R9.5c：**"打这个位置"**（右键点了地图，没有锁定到具体单位）
             —— 旧代码 `targetId` 为空 ⇒ 直接判 `done='目标已消灭'` ⇒ 命令在**下达的同 1 秒**
             就"完成"了 ⇒ 部队原地不动 = 玩家看到"点攻击没反应 / 攻击命令不听"。
             现在改成 MOVE_TO 式**到位判定**：60% 单位进入 150m + 编队半径 ⇒ 已到达攻击位置。 */
          let ok = 0;
          for (const u of us) {
            if (Math.hypot(u.x - o.x, u.y - o.y) < 150 + (typeof unitArriveRadius === 'function' ? unitArriveRadius(u) : 0)) ok++;
          }
          if (ok >= need) { o.done = true; o.doneReason = '已到达攻击位置'; }
        } else {
          o.done = true; o.doneReason = '没有目标';
        }
      } else if (o.type === 'TAKE_COVER') {
        let ok = 0;
        for (const u of us) if (coverFactorAt(u.x, u.y) >= 0.5) ok++;
        if (ok >= need) { o.done = true; o.doneReason = '已有掩体'; }
      } else if (o.type === 'BOARD' || o.type === 'DISMOUNT') {
        const want = (o.type === 'BOARD');
        let ok = 0, veh = 0;
        for (const u of us) { if (!u.vehicles || !u.vehicles.length) continue; veh++; if (!!u.mounted === want) ok++; }
        if (!veh) { o.done = true; o.doneReason = '该组没有载具'; }
        else if (ok >= Math.ceil(veh * 0.8)) { o.done = true; o.doneReason = want ? '已上车' : '已下车'; }
      } else if (o.type === 'WITHDRAW') {
        let safe = 0;
        for (const u of us) if (!u.visibleEnemies || !u.visibleEnemies.length) safe++;
        /* ★★★ R9.5c：加 5 秒宽限 —— "看不见敌人"**不等于**已经脱离接触。
           旧判据在下达的同 1 秒就成立 ⇒ "撤退"瞬间"完成"、部队纹丝不动
           （玩家看到"点撤退没用"）。 */
        if (battle.time - o.at > 5 && safe >= Math.ceil(us.length * 0.8)) {
          o.done = true; o.doneReason = '脱离接触';
        }
      } else if (o.type === 'GARRISON') {
        let ok = 0;
        for (const u of us) if (unitIsGarrisoned(u)) ok++;
        if (ok >= need) { o.done = true; o.doneReason = '已进驻'; }
      } else if (o.type === 'RESUPPLY') {
        /* ★ R9.2：补给完成 = 组里大多数单位备弹 ≥ 90% */
        let ok = 0;
        for (const u of us) if (unitAmmoRatio(u) >= 0.9) ok++;
        if (ok >= need) { o.done = true; o.doneReason = '弹药已补满'; }
      }
      /* HOLD / SET_STANCE / FIRE_MISSION = 持续命令，不自动完成 */
      if (o.done) {
        this._push(o.src, gk, o.type, '[完成] ' + o.doneReason);
        /* ★★★ R9.5c：**玩家的命令必须报告结局**（完成 + 为什么完成）——
           "点了个命令没反应"里有一半其实是"命令瞬间就完成了"（已到达 / 已有掩体 / 弹药已满…），
           结局不报出来，玩家只会以为按钮坏了。 */
        if (o.src === 'player') {
          const cn = (typeof CMD_TYPE_CN === 'object' && CMD_TYPE_CN[o.type]) || o.type;
          this.toast = { msg: '「' + cn + '」' + (o.doneReason || '完成'), until: battle.time + 3 };
        }
      }
    }
  },

  _push(src, gk, type, note) {
    this.log.push({ t: Math.round(battle.time * 10) / 10, src, gk, type, note });
    if (this.log.length > this.maxLog) this.log.shift();
  },

  summary() {
    const list = [];
    let n = 0;
    for (const gk in this.state) {
      const o = this.state[gk];
      if (!o || o.done) continue;
      n++;
      list.push({
        gk, type: o.type, src: o.src, note: o.note,
        t: Math.round(o.at * 10) / 10,
        target: o.objectiveId || o.supplyId || o.targetId ||
                (o.x != null ? (Math.round(o.x) + ',' + Math.round(o.y)) : ''),
      });
    }
    const toast = (this.toast && this.toast.until > battle.time) ? this.toast : null;
    return {
      active: n, list,
      log: this.log.slice(-14),          // 最近命令流水
      rejects: this.rejects.slice(-4),   // 最近被拒的命令
      toast,                             // 玩家命令被拒的红字（2 秒）
    };
  },
};