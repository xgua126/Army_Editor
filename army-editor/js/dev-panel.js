/* ============================================================
   ★★ DEV 手动操控面板（**默认开启**；R9.1 起"关得掉也一定找得回来"）
   ------------------------------------------------------------
   为什么：寻路层被整体删除、AI / 寻路在重写。这一步要能把"执行层"
   （单位怎么走、会不会卡、会不会抖、命令层有没有在动）单独拿出来验证。

   打开 / 隐藏 / 找回（R9.1）：
     · 默认就开；`?dev=1` 强制开、`?dev=0` 强制关
     · 面板右上「隐藏」= 只藏这次会话，右下角浮动 **DEV** 小标签可点回来
     · 面板右上「彻底关闭」= 写 localStorage（要点两次）；之后仍可用
       **Ctrl+Shift+D** 或 `?dev=1` 强制打开 ⇒ 永远不会被锁在外面

   操作（DEV 模式下）：
     · 左键单击单位 = 选中（最近者；选中后画金圈）
     · 右键单击地图 = 让选中单位走到那里（写入 unit._manualDest）
     · Esc = 取消选中并清掉手动目的地；D / B = 下车 / 上车
     · F8 = 卡顿取证（DEV 关着也能按）；**Ctrl+Shift+D = 开关本面板**
   面板按钮：暂停 / 单步 / 清命令 / 下车 / 上车 / 卡顿取证
   ============================================================ */
(function () {
  /* ★ 默认就开（玩家不用记 ?dev=1）。想关掉：面板上的「隐藏 / 彻底关闭」，或地址后加 ?dev=0。
     判定：?dev=1 强制开 > ?dev=0 强制关 > localStorage.mil_dev === '0' 关 > 否则开 */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  /* ★★ R9.1：**关得掉、也一定找得回来**
     旧版的「关 DEV」写 localStorage 后再刷新 ⇒ 面板消失、界面上再无入口
     ⇒ 玩家被彻底锁在外面（只能手改 URL）。现在：
       · 「隐藏面板」= 只藏本次会话（sessionStorage），右下角留一个浮动 **DEV** 小标签可点回来
       · 「彻底关闭」= 写 mil_dev=0（下次默认不建面板），但**永远**可以用 `?dev=1`
         或快捷键 **Ctrl+Shift+D** 强制打开（快捷键无条件注册 ⇒ 面板不存在也能救回来） */
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  /* ★★★ R9.1 **一次性迁移**：旧版「关 DEV」会把玩家**永久锁在外面**（按钮消失、界面无入口）。
     首次加载时把这个"被锁"状态清掉并记标记 —— 之后玩家再关就是他自己选的。
     （`?dev=0` 仍然优先，不受影响。） */
  try {
    if (lsGet('mil_dev') === '0' && !lsGet('mil_dev_fix_r91')) {
      lsSet('mil_dev', '1');
      lsSet('mil_dev_fix_r91', '1');
      ssSet('mil_dev_hidden', '0');
    }
  } catch (e) {}
  const DEV = /[?&]dev=1/.test(location.search)
           || (!/[?&]dev=0/.test(location.search) && lsGet('mil_dev') !== '0');
  let hidden = ssGet('mil_dev_hidden') === '1';     // 只影响"面板是否显示"，不影响 DEV 本身
  const log = [];
  let sel = null;            // 选中的单位
  let stepOnce = false;      // 单步：跑完这一帧再停
  let elInfo = null, elLog = null, elStep = null, elBox = null, elTab = null, elCmdList = null;

  function now() { return hasBattle() ? battle.time.toFixed(1) : '0.0'; }

  /* ★ 关键：`battle` / `camera` 在 battle.js 里是**顶层 let** ⇒ 它们**不是 window 的属性**
     （只有 var / function 声明才会挂上去）。所以判定必须用 typeof ——
     用「window 属性形式」去取会**永远是 undefined** ⇒ 手动操控整条链路静默失效。 */
  function hasBattle() { return (typeof battle !== 'undefined') && battle; }
  function zoomNow() { return (typeof camera !== 'undefined' && camera.zoom) ? camera.zoom : 1; }

  /* ---------------- 逻辑 ---------------- */

  function pickUnit(cx, cy) {
    if (!hasBattle() || !battle.units) return null;
    const w = (typeof s2w === 'function') ? s2w(cx, cy) : null;
    if (!w) return null;
    let best = null, bestD = Infinity;
    for (const u of battle.units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - w.x, u.y - w.y);
      const rad = Math.max(30, (typeof unitArriveRadius === 'function' ? unitArriveRadius(u) * 1.2 : (u._formationRadius || 0) * 1.1));
      if (d <= rad && d < bestD) { best = u; bestD = d; }
    }
    return best;
  }

  function pushLog(s) {
    log.push('t=' + now() + '  ' + s);
    if (log.length > 60) log.shift();
    renderLog();
  }

  /* ★ 卡顿取证：把最近 40 次「>40ms 的帧」导出（console.table + 剪贴板 JSON），
     每条记录都带"最慢段"（分离 / 视野 / 密度 / AI / 移动 / 其它）⇒ 一眼看出卡在哪。 */
  function dumpSlow() {
    const rows = (hasBattle() && battle._slow) ? battle._slow.slice().reverse() : [];
    if (rows.length) console.table(rows);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(JSON.stringify(rows, null, 1));
      }
    } catch (e) {}
    console.log('[卡顿取证] ' + rows.length + ' 条慢帧（JSON 已尝试复制到剪贴板）', rows);
    pushLog('取证：' + (rows.length
      ? (rows.length + ' 条慢帧 · 峰值 逻辑 ' + rows[0].逻辑 + 'ms ／ 最慢段 ' + rows[0].最慢段)
      : '没有 >40ms 的帧（说明卡顿不在"逻辑/绘制"里）'));
  }

  function clearSel() {
    if (sel) pushLog('取消选中 ' + (sel.name || sel.id));
    sel = null;
    renderInfo();
  }

  /* ============================================================
     ★★★ R9.2：**完整的命令界面**（玩家命令走命令层，不再"默默走过去"）
     ------------------------------------------------------------
     · 作用域「整组」= 命令层（`Cmd.tryIssue('player', …)`）—— 被拒会红字提示 + 记日志
       （"直线过不去 / 该组没有载具 / 该组没有火炮 / 地图上没有补给点" 都会明确告诉你）
     · 作用域「单个单位」= 老办法（`unit._manualDest`）—— 只支持 移动 / 快速移动
     · 命令类型与 `cmd.js` 的 CMD_TYPES 一一对应
     · 右键 = 执行当前设置；**Shift+右键 = 直接快速移动**（最常用的快捷方式）
     ============================================================ */
  const ORDER_KINDS = [
    ['MOVE_TO', '移动'], ['MOVE_TO_FAST', '快速移动(公路)'], ['ATTACK', '攻击'],
    ['HOLD', '固守'], ['TAKE_COVER', '找掩体'], ['GARRISON', '进驻'],
    ['BOARD', '上车'], ['DISMOUNT', '下车'], ['FIRE_MISSION', '火力任务'],
    ['RESUPPLY', '补给'], ['WITHDRAW', '撤退'],
  ];
  let scope = 'group';         // 'group' = 走命令层（整组） / 'unit' = 单个单位
  let orderKind = 'MOVE_TO';

  function hasCmd() { return (typeof Cmd !== 'undefined') && Cmd && typeof Cmd.tryIssue === 'function'; }

  function applyOrder(wx, wy, forceFast) {
    if (!sel || !sel.alive) { pushLog('没选中单位（先左键点一个）'); return; }
    const kind = forceFast ? 'MOVE_TO_FAST' : orderKind;
    const type = (kind === 'MOVE_TO_FAST') ? 'MOVE_TO' : kind;
    const fast = (kind === 'MOVE_TO_FAST');
    /* ★★★ R9.5d：**单位级作用域改成走命令层**（`u:<id>`）——
       以前它只写 `sel._manualDest`（只有"移动"有意义、没有完成判定/反馈）；
       现在 11 种命令都能下给单个单位，和玩家命令条同一条管道。 */
    if (scope === 'unit') {
      if (!hasCmd()) { pushLog('命令层没加载（js/cmd.js）'); return; }
      const res = Cmd.tryIssue('player', 'u:' + sel.id, type, { x: wx, y: wy, fast, note: '玩家' });
      if (res && res.ok) {
        pushLog('[单位] ' + (sel.name || sel.id) + ' ' + (CMD_TYPE_CN[type] || type) + (fast ? '(快速)' : '') +
                ' (' + Math.round(wx) + ',' + Math.round(wy) + ')');
      } else {
        pushLog('✕ ' + ((res && res.reason) || '被拒'));
      }
      renderInfo();
      return;
    }
    if (!hasCmd()) { pushLog('命令层没加载（js/cmd.js）'); return; }
    const gk = sel._groupKey;
    if (!gk) { pushLog('这个单位没有"组"（_groupKey 为空）⇒ 无法下组命令'); return; }
    const res = Cmd.tryIssue('player', gk, type, { x: wx, y: wy, fast, note: '玩家' });
    if (res && res.ok) {
      pushLog('[玩家] ' + (CMD_TYPE_CN[type] || type) + (fast ? '(快速)' : '') +
              ' ⇒ ' + gk.split('|').pop() + ' (' + Math.round(wx) + ',' + Math.round(wy) + ')');
    } else {
      pushLog('✕ ' + ((res && res.reason) || '被拒'));
    }
    renderInfo();
  }

  function applyMove(wx, wy) {
    if (!sel) { pushLog('没选中单位（先左键点一个）'); return; }
    if (!sel.alive) { pushLog('选中的单位已阵亡'); sel = null; renderInfo(); return; }
    sel._manualDest = { x: wx, y: wy };
    pushLog('[手动] ' + (sel.name || sel.id) + ' → MOVE(' + Math.round(wx) + ',' + Math.round(wy) + ')');
    renderInfo();
  }

  function applyClear() {
    if (!sel) return;
    sel._manualDest = null;
    pushLog('[手动] ' + (sel.name || sel.id) + ' 清掉目的地（交回 AI）');
    renderInfo();
  }

  function setMounted(want) {
    if (!sel) { pushLog('没选中单位'); return; }
    if (typeof setUnitMounted !== 'function') return;
    if (!sel.vehicles || !sel.vehicles.length) { pushLog('该单位没有载具'); return; }
    sel._manualDest = null;
    setUnitMounted(sel, want);
    pushLog('[手动] ' + (sel.name || sel.id) + (want ? ' 上车' : ' 下车'));
    renderInfo();
  }

  function stepOne() {
    if (!hasBattle() || !battle.running) return;
    battle.paused = true;                       // 先确保是暂停态
    stepOnce = true;
    battle.paused = false;                      // 放开跑一帧
    if (typeof gameLoop === 'function') requestAnimationFrame(gameLoop);
    pushLog('单步');
  }

  function setPaused(p) {
    if (!hasBattle() || !battle.running) return;
    battle.paused = p;
    if (!p && typeof gameLoop === 'function') requestAnimationFrame(gameLoop);
    renderInfo();
    pushLog(p ? '暂停' : '继续');
  }

  /* ---------------- 每帧绘制（battle.js 在世界坐标变换下调用） ---------------- */

  function drawWorldMarkers() {
    if (!DEV) return;
    if (stepOnce) { stepOnce = false; if (hasBattle()) battle.paused = true; }   // 单步：跑完这帧再停
    /* ★★★ R9.5：**玩家操控模式下不再画 DEV 的标记** —— 选中圈 / 框选 / 命令目标点
       已经由 battle.js 的玩家操控系统画了（两套一起画会互相干扰）。
       本面板的信息 / 日志 / 按钮照旧可用（它是调试工具，不是玩家界面）。 */
    if (hasBattle() && battle.playerSide) return;
    const cv = document.getElementById('battle-canvas');
    if (!cv) return;
    const g = cv.getContext('2d');
    const z = zoomNow();
    g.save();
    if (sel && sel.alive) {                     // 选中圈
      g.strokeStyle = 'rgba(250,204,21,0.95)';
      g.lineWidth = 2.5 / z;
      g.beginPath();
      g.arc(sel.x, sel.y, (typeof unitArriveRadius === 'function' ? unitArriveRadius(sel) : Math.max(28, (sel._formationRadius || 0) * 1.15)), 0, Math.PI * 2);
      g.stroke();
    }
    for (const u of (hasBattle() ? (battle.units || []) : [])) {   // 手动目的地：✕ + 虚线
      if (!u.alive || !u._manualDest) continue;
      const d = u._manualDest;
      g.strokeStyle = 'rgba(250,204,21,0.85)';
      g.lineWidth = 2 / z;
      g.setLineDash([12 / z, 8 / z]);
      g.beginPath(); g.moveTo(u.x, u.y); g.lineTo(d.x, d.y); g.stroke();
      g.setLineDash([]);
      const r = 14 / z;
      g.beginPath();
      g.moveTo(d.x - r, d.y - r); g.lineTo(d.x + r, d.y + r);
      g.moveTo(d.x + r, d.y - r); g.lineTo(d.x - r, d.y + r);
      g.stroke();
    }
    /* ★★★ R9.3：**命令层的目标点也要画出来** —— 右键下达命令后"看得见"才叫有反馈。
       选中单位所在组：亮黄虚线（从单位拉到目标点）+ ✕ + 中文命令名；其它玩家命令：淡蓝虚线。 */
    if (typeof Cmd !== 'undefined' && Cmd.state) {
      const selGk = (sel && sel._groupKey) ? sel._groupKey : null;
      for (const gk in Cmd.state) {
        const o = Cmd.state[gk];
        if (!o || o.done || o.x == null || o.y == null) continue;
        const isSel = (gk === selGk);
        if (!isSel && o.src !== 'player') continue;
        const p = w2s(o.x, o.y);
        g.setLineDash([12 / z, 8 / z]);
        g.strokeStyle = isSel ? 'rgba(250,204,21,0.95)' : 'rgba(96,165,250,0.45)';
        g.lineWidth = (isSel ? 2 : 1) / z;
        if (isSel && sel) {                       // 从选中单位画虚线到目标点
          g.beginPath(); g.moveTo(sel.x, sel.y); g.lineTo(o.x, o.y); g.stroke();
        }
        g.setLineDash([]);
        const rr = (isSel ? 10 : 6) / z;          // ✕ 标记
        g.beginPath();
        g.moveTo(p.sx - rr, p.sy - rr); g.lineTo(p.sx + rr, p.sy + rr);
        g.moveTo(p.sx + rr, p.sy - rr); g.lineTo(p.sx - rr, p.sy + rr);
        g.stroke();
        if (isSel) {
          const label = ((typeof CMD_TYPE_CN === 'object' && CMD_TYPE_CN[o.type]) || o.type)
                      + '（' + o.src + '）';
          g.font = Math.round(12 / z) + 'px ui-monospace, monospace';
          g.fillStyle = 'rgba(250,204,21,0.95)';
          g.textAlign = 'left';
          g.textBaseline = 'bottom';
          g.fillText(label, p.sx + rr * 1.5, p.sy - rr);
        }
      }
    }
    g.restore();
  }

  /* ---------------- 输入钩子（battle.js 调用） ---------------- */

  function onRightDown(e) {
    if (!DEV) return false;
    const cv = e.currentTarget;
    const rect = cv.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const w = (typeof s2w === 'function') ? s2w(cx, cy) : null;
    if (!w) return true;
    const hit = pickUnit(cx, cy);
    if (hit) { sel = hit; pushLog('选中 ' + (hit.name || hit.id)); renderInfo(); return true; }
    applyOrder(w.x, w.y, e.shiftKey);      // ★ R9.2：右键 = 执行当前命令设置（Shift = 快速移动）
    return true;
  }

  function onLeftClick(e) {
    if (!DEV) return;
    const cv = e.currentTarget;
    if (!cv || !cv.getBoundingClientRect) return;
    const rect = cv.getBoundingClientRect();
    const hit = pickUnit(e.clientX - rect.left, e.clientY - rect.top);
    sel = hit;
    if (hit) pushLog('选中 ' + (hit.name || hit.id));
    renderInfo();
  }

  /* ---------------- UI ---------------- */

  function el(tag, style, text) {
    const d = document.createElement(tag);
    if (style) d.setAttribute('style', style);
    if (text != null) d.textContent = text;
    return d;
  }

  /* ★★ R9.2：**命令清单**（活动命令 + 最近被拒）—— 验证"命令层真的在驱动部队"的窗口 */
  function renderCmdList() {
    if (!elCmdList) return;
    if (!hasCmd()) { elCmdList.textContent = '命令层未加载（js/cmd.js）'; return; }
    const cs = Cmd.summary();
    const lines = ['命令 ' + cs.active + ' 条'];
    for (const o of cs.list.slice(0, 8)) {
      lines.push('  ' + o.type + '(' + o.src + ') ' + (o.target || '') + (o.note ? ' · ' + o.note : ''));
    }
    if (cs.rejects.length) {
      lines.push('最近被拒：');
      for (const r of cs.rejects.slice(-2)) lines.push('  ' + r.msg);
    }
    elCmdList.textContent = lines.join('\n');
  }

  function renderLog() {
    if (!elLog) return;
    elLog.innerHTML = '';
    for (const s of log.slice(-10)) {
      elLog.appendChild(el('div', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', s));
    }
    elLog.scrollTop = elLog.scrollHeight;
  }

  function renderInfo() {
    if (!elInfo) return;
    if (elStep) elStep.textContent = (hasBattle() && battle.paused) ? '▶ 继续' : '⏸ 暂停';
    if (!sel || !sel.alive) { elInfo.textContent = '未选中（左键点单位 → 右键点地面 = 移动）'; return; }
    const md = sel._manualDest;
    const dist = md ? Math.round(Math.hypot(md.x - sel.x, md.y - sel.y)) : null;
    elInfo.textContent = (sel.name || sel.id) + ' · ' + (sel.side === 'blue' ? '蓝' : '红') +
      ' · ' + (sel.mounted ? '乘车' : ((sel.vehicles && sel.vehicles.length) ? '徒步(有车)' : '徒步')) +
      ' · ' + (md ? ('命令 MOVE 剩 ' + dist + 'm') : '无手动命令') +
      ' · stance=' + (sel.stance || '-') +
      ' · 备弹 ' + Math.round(unitAmmoRatio(sel) * 100) + '%' +
      ' · 朝向 ' + Math.round((sel.facing || 0) * 180 / Math.PI) + '°' +
      /* ★ R9.1：节流（= 旧版"压制段停 1.8 秒"，现在改成减速）—— 有值就说明在"猫腰慢进"，
         而不是卡住。这是判断"走走停停是否真的消失"最直接的窗口。 */
      ((typeof paceMulOf === 'function' && paceMulOf(sel) < 0.99)
        ? (' · 节流 ' + Math.round(paceMulOf(sel) * 100) + '%') : '') +
      ' · 战法 ' + stanceLabel(sel) +
      /* ★ R9.6.6：规划档案（地形数值 × 单位数值 + 预计用时）—— "代入是否生效"看这一行 */
      ' · 路况 ' + planProfileLabel(sel) +
      /* ★ R9.6.3：本帧实体位移（米）+ 历史最大 —— "没有移动目标却在位移" = 坐标被偷写 */
      ((sel._frameStep != null) ? (' · 本帧位移 ' + (Math.round(sel._frameStep * 10) / 10) + 'm'
        + (sel._dbgMaxStep > 3 ? ('（峰值 ' + Math.round(sel._dbgMaxStep) + 'm@'
            + (Math.round((sel._dbgMaxStepAt || 0) * 10) / 10) + 's）') : '')) : '') +
      ' · 补给 ' + supplyLabel(sel) +
      ' · 组令 ' + groupCmdLabel(sel) +
      (sel._idleWhy ? (' ｜ 为什么不动：' + sel._idleWhy) : '');
  }

  /* ★ R9：把该单位所属【组】的现行命令显示出来（将军 / 玩家下的）——
     这是验证"命令层真的在驱动部队"最直接的窗口。
     注意 `Cmd` 是 cmd.js 里的**顶层 const**（不是 window 属性）⇒ 只能用 typeof 判。 */
  /* ★★★ R9.2：把该单位所属组的**战法**显示出来（将军层定的，执行层只读） */
  function stanceLabel(u) {
    const gs = (hasBattle() && battle._groups && u._groupKey) ? battle._groups[u._groupKey] : null;
    if (!gs || !gs.stance) return '-';
    const cn = { assault: '冲锋', bound: '交替跃进', hold: '据守',
                 flank: '侧翼', reserve: '重整', withdraw: '撤退' };
    return cn[gs.stance] || gs.stance;
  }
  /* ★ R9.6.6：规划档案（地形数值 × 单位数值）—— "代入是否生效"看这一行 */
  function planProfileLabel(u) {
    if (typeof unitPlanProfile !== 'function') return '-';
    const p = unitPlanProfile(u, u._aimX, u._aimY);   // ★ R9.6.7：带目标 ⇒ 显示"这条腿最终会怎么走"
    let road = null;
    try {
      if (typeof mobilityMulForTile === 'function' && battle.gridMap) {
        road = mobilityMulForTile(p.mob, getGridTerrain(battle.gridMap, u.x, u.y));
      }
    } catch (e) { road = null; }
    const fi = u._fastRouteInfo;
    return (p.ride ? '乘车' : '徒步') + '/' + p.mob + ' ' + (Math.round(p.speed * 10) / 10) + 'm/s' +
      (road != null ? (' · 脚下地形 ' + road + '×') : '') +
      ((fi && isFinite(fi.eta) && typeof fmtEta === 'function') ? (' · 预计 ' + fmtEta(fi.eta)) : '');
  }

  /* ★ R9.2：补给状态（圈内停留秒数 / 正在回补） */
  function supplyLabel(u) {
    if (u._resupplying) return '补给中 ' + (Math.round((u._resupplyDwell || 0) * 10) / 10) + 's';
    if (u._resupplyDwell > 0) return '圈内 ' + (Math.round(u._resupplyDwell * 10) / 10) + 's';
    return '-';
  }

  function groupCmdLabel(u) {
    if (typeof Cmd === 'undefined' || typeof Cmd.current !== 'function') return '无';
    /* ★ R9.5d：先看**单位级**命令（玩家点谁命令谁），再看组级命令（将军/脚本） */
    let o = u.id ? Cmd.current('u:' + u.id) : null;
    if (!o && u._groupKey) o = Cmd.current(u._groupKey);
    if (!o) return '无';
    const scope = (o.groupKey && o.groupKey.slice(0, 2) === 'u:') ? '单位' : '组';
    return o.type + '(' + (o.src || 'ai') + '·' + scope + ')' + (o.done ? '✓已完成 ' + (o.doneReason || '') : '');
  }

  /* ★★ R9.1：显示 / 隐藏 / 强制打开 —— 三个入口都指向同一份状态，永不失联 */
  function applyVisibility() {
    if (elBox) elBox.style.display = hidden ? 'none' : '';
    if (elTab) elTab.style.display = (DEV && hidden) ? '' : 'none';
  }
  function setHidden(h) {
    hidden = !!h;
    ssSet('mil_dev_hidden', hidden ? '1' : '0');
    applyVisibility();
    if (!hidden) { renderInfo(); pushLog('面板已显示'); }
    else pushLog('面板已隐藏（右下角 DEV 小标签 / Ctrl+Shift+D 可找回）');
  }
  /* 被"彻底关闭"（mil_dev=0）后唯一的两条出路：`?dev=1` 或 Ctrl+Shift+D */
  function forceEnableDev() {
    lsSet('mil_dev', '1');
    ssSet('mil_dev_hidden', '0');
    location.reload();
  }

  function buildUI() {
    const box = elBox = el('div', 'position:fixed;top:56px;right:10px;width:330px;z-index:9999;' +
      'background:rgba(15,23,42,.92);border:1px solid #334155;border-radius:8px;padding:8px;' +
      'font:11px/1.5 ui-monospace,monospace;color:#e2e8f0;box-shadow:0 6px 20px rgba(0,0,0,.45);');
    const head = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:4px;');
    head.appendChild(el('div', 'font-weight:700;color:#fca5a5;', 'DEV · 手动操控'));
    /* ★ R9.1：「隐藏」只藏本次会话；「彻底关闭」要点**两次**（不弹原生 confirm ——
       1.6.0 起本项目就把 prompt/confirm 都换成自绘弹窗了）。
       点完仍然能用 **Ctrl+Shift+D** 或 `?dev=1` 找回来 ⇒ 绝不会像旧版那样被永久锁在外面。 */
    const btnStyle = 'margin-left:auto;background:transparent;border:1px solid #475569;' +
      'border-radius:5px;color:#94a3b8;padding:1px 6px;cursor:pointer;font:inherit;';
    const hideBtn = el('button', btnStyle, '隐藏');
    hideBtn.title = '只隐藏本次会话（右下角 DEV 小标签可点回来；快捷键 Ctrl+Shift+D）';
    hideBtn.addEventListener('click', () => setHidden(true));
    head.appendChild(hideBtn);
    const off = el('button', btnStyle.replace('margin-left:auto;', ''), '彻底关闭');
    off.title = '关掉之后再开：地址加 ?dev=1，或按 Ctrl+Shift+D';
    let offArmed = false;
    off.addEventListener('click', () => {
      if (!offArmed) {
        offArmed = true;
        off.textContent = '再点一次=关闭';
        pushLog('[提示] 想再打开面板：?dev=1 或 Ctrl+Shift+D');
        return;
      }
      lsSet('mil_dev', '0');
      ssSet('mil_dev_hidden', '0');
      location.reload();
    });
    head.appendChild(off);
    box.appendChild(head);
    box.appendChild(el('div', 'color:#94a3b8;margin-bottom:6px;',
      '玩家操控模式下：canvas 的左键=框选 / 右键=命令（归玩家系统）· 本面板按钮照旧可用 · F8=取证'));
    elInfo = el('div', 'color:#fcd34d;margin-bottom:6px;min-height:30px;',
      '未选中（左键点单位 → 右键点地面 = 移动）');
    box.appendChild(elInfo);
    const row = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;');
    const mk = (label, fn) => {
      const b = el('button', 'flex:1;min-width:76px;background:rgba(255,255,255,.08);' +
        'border:1px solid #334155;border-radius:6px;color:#e2e8f0;padding:3px 6px;' +
        'cursor:pointer;font:inherit;', label);
      b.addEventListener('click', ev => { ev.preventDefault(); fn(); });
      return b;
    };
    elStep = mk('⏸ 暂停', () => setPaused(!(hasBattle() && battle.paused)));
    row.appendChild(elStep);
    row.appendChild(mk('▶ 单步', stepOne));
    row.appendChild(mk('✕ 清命令', applyClear));
    row.appendChild(mk('D 下车', () => setMounted(false)));
    row.appendChild(mk('B 上车', () => setMounted(true)));
    row.appendChild(mk('📋 卡顿取证', dumpSlow));
    box.appendChild(row);

    /* ★★ R9.2：**命令区** —— 作用域 + 命令类型（右键执行；Shift+右键 = 快速移动） */
    const cmdRow = el('div', 'display:flex;gap:4px;align-items:center;margin-bottom:4px;');
    const mkSelect = (opts, cur, onChange) => {
      const s = document.createElement('select');
      s.setAttribute('style', 'flex:1;background:#0f172a;color:#e2e8f0;border:1px solid #334155;' +
        'border-radius:5px;padding:2px 4px;font:inherit;');
      for (const pair of opts) {
        const o = document.createElement('option');
        o.value = pair[0]; o.textContent = pair[1];
        if (pair[0] === cur) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    cmdRow.appendChild(mkSelect([['group', '整组'], ['unit', '单个单位']], scope,
      v => { scope = v; renderInfo(); }));
    cmdRow.appendChild(mkSelect(ORDER_KINDS, orderKind, v => { orderKind = v; renderInfo(); }));
    box.appendChild(cmdRow);
    box.appendChild(el('div', 'color:#64748b;margin-bottom:4px;',
      '右键 = 执行上面的命令 · Shift+右键 = 快速移动 · 被拒会红字提示'));
    elCmdList = el('div', 'white-space:pre-wrap;max-height:104px;overflow:auto;color:#7dd3fc;' +
      'border-top:1px solid #1e293b;padding-top:4px;margin-bottom:4px;');
    box.appendChild(elCmdList);
    elLog = el('div', 'max-height:130px;overflow:auto;color:#94a3b8;border-top:1px solid #1e293b;padding-top:4px;');
    box.appendChild(elLog);
    document.body.appendChild(box);

    /* ★ R9.1：浮动 **DEV** 小标签 —— 面板被「隐藏」时它还在，点一下就回来（永不锁死） */
    elTab = el('div', 'position:fixed;bottom:10px;right:10px;z-index:9999;display:none;' +
      'background:rgba(220,38,38,.85);color:#fff;border-radius:6px;padding:3px 9px;' +
      'font:11px/1.5 ui-monospace,monospace;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.4);',
      'DEV');
    elTab.title = '点这里重新打开 DEV 面板（快捷键 Ctrl+Shift+D）';
    elTab.addEventListener('click', () => setHidden(false));
    document.body.appendChild(elTab);
    applyVisibility();
  }

  /* ★ F8 = 卡顿取证（**DEV 关着也能按**，方便随时取证；Chrome 不占用 F8） */
  window.addEventListener('keydown', e => {
    if (e.key === 'F8') { e.preventDefault(); dumpSlow(); }
  });

  /* ★★ R9.1：**Ctrl+Shift+D = 开关 DEV 面板**（无条件注册 ——
     面板被「隐藏」、甚至被「彻底关闭」时也能按：
     没启用 ⇒ 强制打开；启用了 ⇒ 在显示/隐藏之间切。
     这就是"旧版关掉后永远打不开"的解药。） */
  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      if (!DEV) { forceEnableDev(); return; }
      setHidden(!hidden);
    }
  });

  if (DEV) {
    window.addEventListener('DOMContentLoaded', () => {
      buildUI();
      window.addEventListener('keydown', e => {
        /* ★ R9.1：带修饰键的组合（尤其 **Ctrl+Shift+D** 开关面板）交给上面的监听器处理，
           否则按 Ctrl+Shift+D 会顺带命中这里的 `d` ⇒ 把选中单位"下车" */
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (e.key === 'Escape') { clearSel(); return; }
        if (e.key === 'd' || e.key === 'D') { setMounted(false); return; }
        if (e.key === 'b' || e.key === 'B') { setMounted(true); return; }
      });
      pushLog('DEV 已启用 · 隐藏=面板右上「隐藏」 · 找回=Ctrl+Shift+D 或 ?dev=1');
      /* ★ R9：面板信息**每 0.4 秒自刷一次**（纯只读）—— 不用点鼠标就能看到
         "组令 / 为什么不动 / 备弹" 的实时变化（验证命令层 + 将军层最直观的窗口）。 */
      setInterval(() => {
        /* 选中的单位已阵亡 / 或**已换了一局**（battle.units 里没有它了）⇒ 取消选中 */
        if (sel && (!sel.alive || (hasBattle() && battle.units && battle.units.indexOf(sel) < 0))) sel = null;
        renderInfo();
        renderCmdList();
      }, 400);
    });
  }

  /* 暴露给 battle.js 的钩子（非 DEV 时全是空操作） */
  window.DevPanel = {
    get enabled() { return DEV; },
    get selected() { return sel; },
    onRightDown: onRightDown,
    onLeftClick: onLeftClick,
    drawWorldMarkers: drawWorldMarkers,
  };
})();
