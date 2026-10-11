/* ============================================================
   battle.js — 战术模拟引擎 v23
   新增：
   - 前沿观察员标记系统（步兵发现敌人 → 通知炮兵）
   - 炮兵角色系统（反炮兵 / 火力支援）
   - 炮兵自行评估转移
   - 组独立姿态（assault / defend / reserve）
   - 武器分组（消除齐射）
   - 密度感知（footprint 模型 · 单位主动散开）
   修复：
   - 切换地图残留
   - 迫击炮移动中部署/冷却异常
   - 反炮兵 ghost 目标位置过期
   ============================================================ */

const SAVES_KEY = 'mil_org_saves_v1';
/* ★ R9.6.9：一场 40 分钟（玩家："时间变成 40 分钟"） */
const MAX_BATTLE_TIME = 2400;

/* ============================================================
   胜利分（票池）—— 票池 = 胜利分 = 士气池
   扣票来源：阵亡 / 载具损毁 / 据点差 bleed / （攻防）据点被攻占
   票归零 → 该方战败
   ============================================================ */
/* ★ R9.6.9：票池 500 → **1000**（玩家："票池增加到 1000 票其他不变"）。
   初始票 = max(票池下限, 双方人数) —— 设成 1000 之后，除非单边兵力 >1000，
   双方就都是 1000 票；其余票规则（阵亡扣票 / 据点流血 / 夺点奖励）一行未动。 */
const TICKETS_MIN            = 1000;  // 初始票池（每方）
const TICKETS_PER_SOLDIER    = 1;     // 每阵亡 1 兵
const TICKETS_PER_VEHICLE    = 8;     // 每损毁 1 辆载具
const TICKET_BLEED_PER_POINT = 0.3;   // 每秒 × 据点差（只扣少点的一方）
const CAPTURE_BONUS          = 120;   // 仅攻防战：攻占一个据点 → 守方扣这么多
const ASSAULT_DEFENDER_BONUS = 200;   // 攻防战守方初始多这么多票
const CAPTURE_SECONDS        = 45;    // 从"完全中立"到"完全占领"所需秒数
const CAPTURE_MEN_FULL       = 30;    // 点内兵力差达到该数 = 全速占领
const ENCOUNTER_AUTO_POINTS  = 3;     // 遭遇战自动生成的中立据点数

const MAX_UNITS_PER_SIDE = 60;

const SYM_SCREEN_W = 35;
const UNIT_FRONTAGE = 180;
const MAP_MIN_W = 1200;
const MAP_MIN_H = 800;

const SUPPORTED_ECHELONS = ['platoon', 'section', 'squad', 'team', 'individual'];

let MAP_W = 2000;
let MAP_H = 1300;

const HP_PER_SOLDIER = 10;
const SEPARATION_RADIUS = 220;
/* ★ 单位间分离力：以前是 450（配合 dt 相当于每帧位移 7.5~15m，单位会被"弹"得抽搐瞬移），
   改成 8 这种"m/s 量级"的弹簧强度，并对累加值做限幅 */
const SEPARATION_FORCE = 8;
const SEPARATION_MAX = 2;        // Σ重叠度 的限幅
const SOLDIER_SEP_RADIUS = 12;   // 士兵间最小间距（米）
const SOLDIER_SEP_FORCE = 6;     // 士兵间分离强度（m/s 量级，旧值 45 会让士兵每帧抖 1.5m）
const SOLDIER_SEP_MAX = 2;       // Σ重叠度 限幅
const TARGET_CACHE_INTERVAL = 0.3;

const COOLDOWN_RING_MIN_INTERVAL = 2.0;

const SUPPRESSION_THRESHOLD = 0.5;
const SUPPRESSION_DECAY = 0.25;
const SUPPRESSION_NOFIRE_TIME = 5;
const SUPPRESSION_INCOVER_TIME = 2;
const SUPPRESSED_SPEED_MULT = 0.45;
/* ★ 压制模型重做（旧模型每次射击事件 +0.22 × 250 事件/秒 = 0.03 秒就压满，
   双方一交火就同时变成木头人 ⇒ "看不见对射"） */
const SUPP_MAX_PER_SEC   = 0.45;   // 单个士兵【每秒最多】累积这么多压制（无论落多少发）
const SUPP_HARD          = 0.85;   // 极端压制：才短暂停火 / 才清空目标
const SUPPRESSED_FIRE_MUL = 0.30;  // 被压住时的命中系数（不是禁火！）
const SUPPRESSED_RATE_MUL = 0.60;  // 被压住时的射速系数

const TARGET_LOCK_TIME = 1.5;
const COVER_SEARCH_COOLDOWN = 2.5;
const COVER_TARGET_LIFETIME = 3.5;

/* ★ 上下车判据（治"步兵穿林出地形瞬间弹回车位"）
   —— 旧代码只看「脚下/前方 60m 地形能不能走车」就决定上车，
      而车早已被卡在林边/楼外 ⇒ 一上车就把士兵坐标硬吸附到车上 = 整队瞬移。 */
const VEHICLE_NEAR_RADIUS = 45;      // 车要到单位这么近才允许上车
const VEHICLE_NEAR_RATIO  = 0.6;     // 且至少六成存活车辆到位
const VEHICLE_STAY_MOUNTED_GAP = 150; // ★ 已在车上时，车拉开到这么远才算掉队（滞回：上车 45m / 下车 150m）
/* ★ 弃车门槛大幅放宽（800m/25s → 1500m/60s）：分段乘车下车后，单位会徒步走远，
   而车在这个阶段常被甩到几百米外 —— 旧门槛会把"正常的下车徒步"误判成"掉队" ⇒
   走到下一个点时整车已被判弃车 ⇒ 永久徒步（用户实测） */
const VEHICLE_ABANDON_GAP  = 1500;   // 车被甩下这么远……
const VEHICLE_ABANDON_TIME = 60;     // ……且持续这么久追不上 → 才算掉队

const COUNTER_BATTERY_MEMORY = 10;

/* ★★★ R9.6.11：**"这个单位会打炮吗"**（反炮兵要算**迫击炮** —— 玩家要求）
   ------------------------------------------------------------
   判据 = "手里有 artillery 类别的武器"（车辆炮 **或** 士兵手里的迫击炮/掷弹筒/山炮）。
   为什么不能只看 `unit.isArtilleryUnit`：那是**编制节点类型**白名单（artillery/mlrs/towed_*），
   而"步兵排自带 2 门迫击炮"在编制里仍然只是个步兵排 —— 它照样抛炮弹、照样有**炮口火光**，
   反炮兵当然要能顺着火光找到它（旧代码只看 isArtilleryUnit ⇒ 迫击炮永远不被反炮兵盯上）。 */
function unitHasArtilleryFire(unit) {
  if (!unit) return false;
  if (unit.isArtilleryUnit) return true;
  for (const v of (unit.vehicles || [])) {
    if (!v.destroyed && !v.abandoned && v.weapon && v.weapon.isArtillery) return true;
  }
  for (const s of (unit.soldiers || [])) {
    if (s.alive && s.weapon && s.weapon.isArtillery) return true;
  }
  return false;
}

/* ★★★ R9.6.11：**尸体标记**（玩家要求：阵亡地点留一个灰点，**局内永久保存**）
   ------------------------------------------------------------
   只存坐标 + 阵营（渲染就是一个小灰点）；上限 MAX_CORPSES，超过就丢最旧的
   —— 40 分钟的大战可能死几千人，不允许无界增长（否则渲染与内存都会出事）。 */
const MAX_CORPSES = 4000;
function addCorpse(x, y, side) {
  if (!isFinite(x) || !isFinite(y)) return;
  if (!battle.corpses) battle.corpses = [];
  battle.corpses.push({ x, y, side: side || null });
  if (battle.corpses.length > MAX_CORPSES) {
    battle.corpses.splice(0, battle.corpses.length - MAX_CORPSES);
  }
}

const HOUSE_SEARCH_RADIUS = 320;

const ARTILLERY_RELOCATE_MIN = 300;
const ARTILLERY_RELOCATE_MAX = 500;
const ARTILLERY_SCATTER_BASE = 25;
const ARTY_THREAT_RADIUS = 800;
const ARTY_RELOCATE_COOLDOWN = 8;
const FRONTLINE_MARK_TTL = 6;

const WEAPON_GROUP_SIZE = 8;
const WEAPON_MAX_GROUPS = 5;

/* ★ 非战斗态"高机动地形偏好" */
const MOBILITY_LOOKAHEAD = 400;
const COMBAT_ZONE_RADIUS = 900;

/* ★ 密度感知参数 */
const ECHELON_FOOTPRINT = {
  army: 800, corps: 500, division: 350, brigade: 250,
  regiment: 200, battalion: 150, company: 150,
  platoon: 100, section: 80, squad: 50,
  team: 25, individual: 10,
};
const DENSITY_CROWDED_THRESHOLD = 0.8;
const DENSITY_SPARSE_THRESHOLD  = 1.5;
const DENSITY_SCAN_RADIUS = 800;      // ★ R9.6.12：500 → 800（否则 500m 外的友军"感觉不到挤"）
const DENSITY_UPDATE_INTERVAL = 2;
/* ★ R9.6.13：**挤开距离** 150 → **225m**（玩家："排与排之间的间隙再拉大现在的半倍"）
   —— 与落点间距同比例（×1.5）；两个排的"挤"阈值本来就是 160m，现在真能被推得更开。 */
const DENSITY_FORCE = 225;

let canvas, ctx;
let canvasW = 0, canvasH = 0;

let camera = {
  x: 1000, y: 650, zoom: 0.5,
  minZoom: 0.05, maxZoom: 4,
};

let unitSelection = { blue: null, red: null };
let selectedMapId = '';

const VIEW_MODES = ['all', 'both', 'blue', 'red'];
let viewMode = 'all';

let showUnitLabels = true;
let showIndividuals = true;
const SOLDIER_DOT_MIN_ZOOM = 0.35;

const $ = id => document.getElementById(id);
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

function w2s(x, y) {
  return {
    sx: (x - camera.x) * camera.zoom + canvasW / 2,
    sy: (y - camera.y) * camera.zoom + canvasH / 2,
  };
}
function s2w(sx, sy) {
  return {
    x: (sx - canvasW / 2) / camera.zoom + camera.x,
    y: (sy - canvasH / 2) / camera.zoom + camera.y,
  };
}

/* ============================================================
   ★★★ R9.5：**玩家操控系统**（阵营 / 选择 / 命令）
   ------------------------------------------------------------
   设计原则（针对"AI 老是覆盖我的命令"）：
     · 你带的那一方，**将军完全不管**（`battle.aiEnabled[side] = false`）
       ⇒ 没有任何"覆盖命令"的可能（不是靠优先级去抢，而是根本没人跟你抢）
     · 交互与 RTS 一致：左键框选/点选 · 右键下达 · 数字键选命令 · Esc 取消
       · 平移 = 中键拖 / Alt+左键拖（纯观战模式下仍是左键拖）
     · 命令仍走**命令层** `Cmd.tryIssue('player', …)`：装备门槛 / 走不到的拒绝 /
       完成判定 / 超时看门狗 全在那一层，这里只做"选择 → 下达"
     · 命令粒度 = **组**（命令层的组 = 编制树上一级）⇒ 框选多个单位会按组下达
   ============================================================ */
/* 需要"右键点一个目标位置"的命令；其余（固守/掩体/上下车/补给/停止）按钮点了就生效
   —— 补给的目标点由命令层自己找最近补给点；攻击不带点 ⇒ 打离选中部队最近的敌人 */
const ORDERS_NEED_POINT = { MOVE_TO: 1, MOVE_TO_FAST: 1, GARRISON: 1, FIRE_MISSION: 1 };

const ORDER_KEYMAP = {
  '1': 'MOVE_TO', '2': 'MOVE_TO_FAST', '3': 'ATTACK', '4': 'HOLD', '5': 'TAKE_COVER',
  '6': 'BOARD', '7': 'DISMOUNT', '8': 'RESUPPLY', '9': 'WITHDRAW', '0': 'STOP',
};
/* 命令条默认提示（★ R9.5b：说清"没下令的部队原地待命"；★ R9.5d：说清"点谁命令谁 + 会画路线"） */
const CMD_HINT_DEFAULT = '左键框选/点选（Shift 加选）· 右键下达 · 1~9 选命令 · Esc 取消'
                       + ' ｜ 点谁命令谁（只动选中的单位）· 目标点与路线画在地图上 ｜ 没下令的部队原地待命';

function setPlayerSide(side, silent) {
  battle.playerSide = side || '';
  battle.selection = [];
  battle.playerRide = {};                           // ★ R9.5c：换边 ⇒ 上下车意图清空
  battle.aiEnabled = { blue: true, red: true };     // 换边 ⇒ AI 开关复位（再由下面关掉你带的那一方）
  if (battle.playerSide) {
    battle.aiEnabled[battle.playerSide] = false;    // ★ 你带的那一方：将军彻底不管
    if (typeof Cmd !== 'undefined') {               // 清掉那一方遗留的 AI/玩家命令（否则会继续跑旧目标）
      for (const gk in Cmd.state) {
        if (gk.indexOf(battle.playerSide + '|') === 0) { Cmd.clear(gk, '玩家接管'); continue; }
        if (gk.slice(0, 2) === 'u:') {              // ★ R9.5d：单位级命令也要按阵营清
          const u = battle.units.find(x => x.id === gk.slice(2));
          if (u && u.side === battle.playerSide) Cmd.clear(gk, '玩家接管');
        }
      }
    }
  }
  const cb = $('opt-ai-blue'), cr = $('opt-ai-red');
  if (cb) cb.checked = !!battle.aiEnabled.blue;
  if (cr) cr.checked = !!battle.aiEnabled.red;
  const bar = $('cmdbar');
  if (bar) bar.classList.toggle('hidden', !battle.playerSide);
  updateCmdBar();
  if (!silent && ctx) drawBattlefield();
}

function setCurOrder(k) {
  battle.curOrder = k;
  updateCmdBar();
  const hint = $('cmdbar-hint');
  if (hint) {
    const need = !!ORDERS_NEED_POINT[k];
    hint.textContent = need
      ? ('「' + (k === 'MOVE_TO_FAST' ? '快速移动' : ((typeof CMD_TYPE_CN === 'object' && CMD_TYPE_CN[k]) || k)) +
         '」：右键点地图选择目标位置')
      : CMD_HINT_DEFAULT;
  }
}

function updateCmdBar() {
  const info = $('cmdbar-info');
  if (info) {
    const own = battle.playerSide ? battle.units.filter(u => u.alive && u.side === battle.playerSide).length : 0;
    /* ★ R9.5c：顺手把"选中部队为什么没动"写到命令条上
       （例：玩家命令：找掩体（附近没有可用掩体）/ 玩家操控：没有命令 ⇒ 原地待命）
       —— 玩家不用开诊断就能看懂"命令到底有没有生效"。 */
    const u0 = battle.selection.length ? battle.selection[0] : null;
    const why = (u0 && u0.alive && u0._idleWhy) ? String(u0._idleWhy).slice(0, 46) : '';
    info.textContent = battle.playerSide
      ? ((battle.playerSide === 'blue' ? '蓝方' : '红方') + ' · 已选 ' + battle.selection.length + ' / 共 ' + own
         + (why ? (' ｜ ' + why) : ''))
      : '未操控（纯观战）';
  }
  document.querySelectorAll('#cmdbar button').forEach(b => {
    b.classList.toggle('active', b.dataset.order === battle.curOrder);
  });
}

function ownUnits() {
  if (!battle.playerSide) return [];
  return battle.units.filter(u => u.alive && u.side === battle.playerSide);
}

/* ============================================================
   ★★★ R9.5b：**"这一方由玩家在带"的唯一判据**
   ------------------------------------------------------------
   `playerSide` = 你带的阵营；`aiEnabled[side]` = 那一方**是否交回 AI 接管**。
   只有"我带它、而且没交回 AI"时，执行层才必须**彻底放手**：
     · 有玩家命令 ⇒ 严格照命令走（不走自己那套目标分配/战法/掩体）
     · 没有命令   ⇒ **原地待命**（不自己动；但敌人进射程仍然会还击）
   想让自己那一方也自己打 ⇒ 顶栏「👁 显示 → XX方 AI 接管」勾上。
   ============================================================ */
function isPlayerCtl(u) {
  if (!battle.playerSide || !u || u.side !== battle.playerSide) return false;
  if (battle.aiEnabled && battle.aiEnabled[u.side]) return false;   // 已交回 AI ⇒ 执行层照常自主
  return true;
}

/* 左键单击：选中最近的一个（add = Shift 加选） */
function selectClick(sx, sy, add) {
  const w = s2w(sx, sy);
  let best = null, bd = Infinity;
  for (const u of ownUnits()) {
    const d = Math.hypot(u.x - w.x, u.y - w.y);
    const rad = Math.max(35, unitArriveRadius(u) * 1.2);
    if (d <= rad && d < bd) { bd = d; best = u; }
  }
  if (!best) { if (!add) battle.selection = []; updateCmdBar(); return; }
  if (add) { if (battle.selection.indexOf(best) < 0) battle.selection.push(best); }
  else battle.selection = [best];
  updateCmdBar();
}

/* 左键框选（屏幕矩形 → 世界矩形；只框自己那一方） */
function selectBox(x0, y0, x1, y1, add) {
  const a = s2w(Math.min(x0, x1), Math.min(y0, y1));
  const b = s2w(Math.max(x0, x1), Math.max(y0, y1));
  const hit = ownUnits().filter(u => u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y);
  if (add) { for (const u of hit) if (battle.selection.indexOf(u) < 0) battle.selection.push(u); }
  else battle.selection = hit;
  updateCmdBar();
}

/* ============================================================
   下达玩家命令：按**组**（同一组只下一次；门槛/拒绝/完成判定都在命令层）
   ============================================================ */
function execPlayerOrder(kind, wx, wy, targetId) {
  if (!battle.playerSide) { showOrderToast('先在上方选「我操控」哪一方'); return; }
  if (!battle.selection.length) { showOrderToast('先左键框选 / 点选你的单位'); return; }
  if (typeof Cmd === 'undefined') { showOrderToast('命令层没加载（js/cmd.js）'); return; }

  const fast = (kind === 'MOVE_TO_FAST');
  const type = fast ? 'MOVE_TO' : kind;

  const groups = {};                       // 仅用于"没有单位"的兜底判断
  for (const u of battle.selection) if (u.alive && u._groupKey) groups[u._groupKey] = u;
  /* 玩家下命令 ⇒ 清掉 DEV 的单兵手动目的地（否则它会挤掉命令 = "命令被覆盖"） */
  for (const u of battle.selection) u._manualDest = null;

  if (type === 'STOP') {                   // ✋ 停止 = 撤销选中**单位**的命令（交回 AI / 原地）
    let n = 0;
    for (const u of battle.selection) {
      if (u.alive) { Cmd.clear('u:' + u.id, '玩家停止'); n++; }
    }
    showOrderToast('✋ 已停止 ' + n + ' 个单位的命令');
    return;
  }
  if (ORDERS_NEED_POINT[kind] && wx == null) {
    showOrderToast('这个命令需要目标点：选好命令后**右键点地图**');
    return;
  }
  /* 攻击没给点 ⇒ 自动瞄准"离选中部队最近的敌人"（按钮点了就打，不必先右键） */
  if (type === 'ATTACK' && wx == null && battle.selection.length) {
    let cx = 0, cy = 0, n = 0;
    for (const u of battle.selection) { cx += u.x; cy += u.y; n++; }
    cx /= n; cy /= n;
    let best = null, bd = Infinity;
    for (const e of battle.units) {
      if (!e.alive || e.side === battle.playerSide) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) { wx = best.x; wy = best.y; targetId = best.id; }
  }
  let ok = 0, rej = 0, note = '';
  /* ★★★ R9.5d：**点谁就给谁下命令** —— 逐**单位**下达（`u:<id>`），
     不再按组下达 ⇒ 点 1 个兵牌不会拖着它同组的其他单位一起走。
     ★★★ R9.6（P4）：多单位 ⇒ 每个单位**自己的落点**（`unitTargetSlots`，
     垂直于行进方向排开）⇒ 不挤在一个点上，也不需要 `applyDensityOffset` 偷偷横移。 */
  const alive = battle.selection.filter(x => x.alive);
  const slots = unitTargetSlots(alive, wx, wy);
  for (let i = 0; i < alive.length; i++) {
    const u = alive[i];
    const p = slots[i] || { x: wx, y: wy };
    const res = Cmd.tryIssue('player', 'u:' + u.id, type,
                             { x: p.x, y: p.y, fast, note: '玩家', targetId: targetId || null });
    if (res && res.ok) {
      ok++;
      /* ★ R9.5c：上下车 = **粘性意图**（下车后不会自己爬回车上；上车后不会自己跳下来） */
      if (type === 'BOARD') battle.playerRide[u.id] = true;
      else if (type === 'DISMOUNT') battle.playerRide[u.id] = false;
      if (!note && res.order && res.order.note) note = res.order.note;
    } else rej++;
  }
  const cn = (typeof CMD_TYPE_CN === 'object' && CMD_TYPE_CN[type]) || type;
  /* ★ R9.5d：**命令被拒时，把"我点的那个点"也标出来**（红 ✕）——
     否则玩家只看到一句红字，不知道是哪个点被拒了。 */
  if (ok === 0 && wx != null) {
    battle.clickMark = { x: wx, y: wy, t: battle.time, ok: false };
  } else if (wx != null) {
    battle.clickMark = { x: wx, y: wy, t: battle.time, ok: true };
  }
  showOrderToast('「' + cn + (fast ? '·快速' : '') + '」→ ' + ok + ' 个单位'
                 + (note ? ('（' + note.replace('玩家 · ', '') + '）') : '')
                 + (rej ? ('（' + rej + ' 个被拒，看上方红字）') : ''));
}

function playerRightClick(e) {
  if (!battle.playerSide) return;
  const rect = canvas.getBoundingClientRect();
  const w = s2w(e.clientX - rect.left, e.clientY - rect.top);
  /* ★ R9.5c：点「攻击」时，右键落点附近有敌人 ⇒ **锁定它**（targetId）
     —— 有 targetId 才会以"目标已消灭"为完成判据；没有则按"到位"判定（不再是 1 秒完成）。 */
  let tid = null;
  if (battle.curOrder === 'ATTACK') {
    const pick = pickEnemyNear(w.x, w.y, 200);
    if (pick) tid = pick.id;
  }
  execPlayerOrder(battle.curOrder, w.x, w.y, tid);
}

/* 右键落点附近的敌方单位（用于"攻击"锁定目标） */
function pickEnemyNear(wx, wy, maxR) {
  let best = null, bd = maxR;
  for (const u of battle.units) {
    if (!u.alive || u.side === battle.playerSide) continue;
    const d = Math.hypot(u.x - wx, u.y - wy) - unitArriveRadius(u);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

/* ============================================================
   ★★★ R9.6（P4）：**多单位点同一个目标点 ⇒ 每个单位一个落点**
   ------------------------------------------------------------
   框选 N 个单位点一个点，如果它们拿到的 x/y 完全相同，就会挤在同一个点上。
   旧版靠 `applyDensityOffset` 偷偷把目标横移来散开 —— 那正是"漂移"的来源之一。
   现在在下达前就把落点摊开：**垂直于行进方向**排成一排（>8 个分两排），
   并按各单位当前在横轴上的位置排序 ⇒ 各走各的、互不交叉。
   ============================================================ */
function unitTargetSlots(units, wx, wy) {
  const out = [];
  const n = units.length;
  if (!n || wx == null || wy == null) return out;
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= n; cy /= n;
  const ax = wx - cx, ay = wy - cy;
  const al = Math.hypot(ax, ay) || 1;
  const ux = ax / al, uy = ay / al;                // 行进方向（单位向量）
  const px = -uy, py = ux;                         // 横向（垂直）
  /* ★ R9.6.13：落点间距再 **×1.5**（玩家："排与排之间的间隙再拉大现在的半倍"）
     —— `max(150, 4.5×R)` → `max(225, 6.75×R)`（排 ⇒ **270m**；班 ⇒ ≥225m）。
     依据同一套基准（立交桥 12.5km² / 双方 1100 人）：排正面 122m + **间隙 148m**。
     ⚠ 若觉得铺得太开：把 225 / 6.75 按比例往回缩（例如 ×0.8）即可。 */
  const spacing = Math.max(225, 6.75 * unitArriveRadius(units[0]));
  const order = units.map((u, i) => ({ i, s: (u.x - cx) * px + (u.y - cy) * py }))
                     .sort((a, b) => a.s - b.s);   // 按当前横轴位置排序 ⇒ 不交叉
  const rows = (n > 8) ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  for (let k = 0; k < n; k++) {
    const row = (rows === 1) ? 0 : Math.min(rows - 1, Math.floor(k / perRow));
    const col = (rows === 1) ? k : (k % perRow);
    const inRow = (row === rows - 1) ? (n - perRow * (rows - 1)) : perRow;
    const off = (col - (inRow - 1) / 2) * spacing;
    const depth = row * spacing;
    out[order[k].i] = { x: wx + px * off - ux * depth, y: wy + py * off - uy * depth };
  }
  return out;
}

function showOrderToast(msg) {
  battle.orderToast = { msg, until: (battle.time || 0) + 2.2 };
  if (ctx) drawBattlefield();
}

/* 选中的单位：金色圈（世界坐标 —— 与 drawRoads / 兵牌同一坐标系） */
function drawPlayerSelection() {
  if (!battle.playerSide || !battle.selection.length) return;
  const z = camera.zoom || 1;
  ctx.save();
  for (const u of battle.selection) {
    if (!u.alive) continue;
    const r = unitArriveRadius(u);           // ★ R9.6.4：选中圈 = 真实的"抵达判定圈"（不再是大黄圈）
    ctx.beginPath();
    ctx.arc(u.x, u.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(252, 211, 77, 0.95)';
    ctx.lineWidth = 3 / z;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(u.x, u.y, r * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(252, 211, 77, 0.35)';
    ctx.lineWidth = 1.5 / z;
    ctx.stroke();
  }
  ctx.restore();
}

/* ============================================================
   ★★★ R9.5d：**把"我点到哪了 / 会怎么走"画出来**
   ------------------------------------------------------------
   玩家要求："下了命令之后我连点到哪里了都不知道，也不知道单位会以什么路线走"。
   画法（**世界坐标** —— 与 drawRoads / drawPlayerSelection 同一坐标系）：
     · 折线：单位（多个单位共用一条命令时取它们的质心）→ 命令的路点表 → 目标点
     · 目标点：✕ + 圆环 + 中文命令名 + 距离
     · 选中的：亮黄；其他己方单位：淡蓝
   路点表 `ord.route` 是命令层在**下达时**算好的（mover 边走边 shift 掉走过的点）
   ⇒ 画出来的就是"**还剩多少路**"（越走越短，也看得出是不是沿公路）。 */
function drawPlayerOrders() {
  if (!battle.playerSide || !ctx) return;
  const z = camera.zoom || 1;
  const buckets = [[], []];                        // [0]=其他己方单位 · [1]=选中的单位
  for (const u of ownUnits()) {
    const o = groupOrderOf(u);
    if (!o || o.src !== 'player') continue;
    if (o.x == null && o.y == null) continue;      // HOLD / SET_STANCE 没有目标点
    buckets[battle.selection.indexOf(u) >= 0 ? 1 : 0].push({ u, o });
  }
  for (let bi = 0; bi < 2; bi++) {
    const byOrd = new Map();                       // 同一条命令只画一次
    for (const it of buckets[bi]) {
      let e = byOrd.get(it.o);
      if (!e) { e = []; byOrd.set(it.o, e); }
      e.push(it.u);
    }
    for (const [o, us] of byOrd) {
      let cx = 0, cy = 0;
      for (const u of us) { cx += u.x; cy += u.y; }
      cx /= us.length; cy /= us.length;
      const isSel = (bi === 1);
      const pts = [{ x: cx, y: cy }];
      if (o.route && o.route.length) for (const p of o.route) pts.push({ x: p.x, y: p.y });
      const tx = o.x, ty = o.y;
      pts.push({ x: tx, y: ty });

      ctx.save();
      ctx.setLineDash([14 / z, 9 / z]);
      ctx.strokeStyle = isSel ? 'rgba(252, 211, 77, 0.95)' : 'rgba(96, 165, 250, 0.42)';
      ctx.lineWidth = (isSel ? 2.2 : 1.2) / z;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      if (isSel && pts.length > 2) {               // 路点小方点：一眼看出"沿公路"的拐点
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(252, 211, 77, 0.85)';
        const s = 5 / z;
        for (let i = 1; i < pts.length - 1; i++) ctx.fillRect(pts[i].x - s, pts[i].y - s, s * 2, s * 2);
      }
      ctx.setLineDash([]);
      const r = (isSel ? 13 : 8) / z;              // 目标点：✕ + 圆环
      ctx.strokeStyle = isSel ? 'rgba(252, 211, 77, 0.98)' : 'rgba(96, 165, 250, 0.5)';
      ctx.lineWidth = (isSel ? 2.4 : 1.4) / z;
      ctx.beginPath();
      ctx.moveTo(tx - r, ty - r); ctx.lineTo(tx + r, ty + r);
      ctx.moveTo(tx + r, ty - r); ctx.lineTo(tx - r, ty + r);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(tx, ty, r * 1.9, 0, Math.PI * 2); ctx.stroke();
      if (isSel) {
        const cn = (typeof CMD_TYPE_CN === 'object' && CMD_TYPE_CN[o.type]) || o.type;
        const d = Math.round(Math.hypot(tx - cx, ty - cy));
        const label = cn + (o.fast ? '·快速' : '') + ' '
                    + (d >= 1000 ? (d / 1000).toFixed(1) + 'km' : d + 'm');
        ctx.font = Math.round(13 / z) + 'px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const lx = tx + r * 2.2, ly = ty;
        const w = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(15,23,42,0.72)';
        ctx.fillRect(lx - 3 / z, ly - 9 / z, w + 6 / z, 18 / z);
        ctx.fillStyle = 'rgba(252, 211, 77, 0.98)';
        ctx.fillText(label, lx, ly);
      }
      ctx.restore();
    }
  }
  /* ★ R9.6.1（诊断）：把**每个单位这一帧要去哪**都画出来（含 AI 方）——
     "单位乱跑"这类问题，一眼就能看出是谁给它下的目标。
     👁 显示 → 诊断 打开时才画。 */
  if (battle.sh.diag) {
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.lineWidth = 1.2 / z;
    ctx.setLineDash([6 / z, 5 / z]);
    for (const u of battle.units) {
      if (!u.alive || u._aimX == null) continue;
      if (battle.playerSide && u.side === battle.playerSide && battle.selection.indexOf(u) >= 0) continue;
      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(u._aimX, u._aimY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(u._aimX, u._aimY, 4 / z, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ★ R9.5d：**右键落点回显** —— 被拒 ⇒ 红 ✕ + 扩散圈（4 秒渐隐），成功 ⇒ 绿 ✕。
     玩家要求"我连我点到哪里了都不知道" ⇒ 落点必须看得见，尤其是**被拒**的时候。 */
  const cm = battle.clickMark;
  if (cm && battle.time - cm.t < 4) {
    const a = Math.max(0, 1 - (battle.time - cm.t) / 4);
    const s = 9 / z;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.65 * a;
    ctx.strokeStyle = cm.ok ? 'rgba(74, 222, 128, 0.95)' : 'rgba(248, 113, 113, 0.98)';
    ctx.lineWidth = 2 / z;
    ctx.beginPath();
    ctx.moveTo(cm.x - s, cm.y - s); ctx.lineTo(cm.x + s, cm.y + s);
    ctx.moveTo(cm.x + s, cm.y - s); ctx.lineTo(cm.x - s, cm.y + s);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cm.x, cm.y, s * (1.8 + (1 - a) * 1.8), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

/* 框选矩形 + 命令提示（屏幕坐标，画在 HUD 层） */
function drawPlayerOverlay() {
  if (battle.boxSel) {
    const b = battle.boxSel;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(252, 211, 77, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.fillStyle = 'rgba(252, 211, 77, 0.10)';
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.restore();
  }
  if (battle.orderToast && battle.orderToast.until > battle.time) {
    ctx.save();
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(battle.orderToast.msg).width;
    ctx.fillStyle = 'rgba(15,23,42,.85)';
    ctx.fillRect(canvasW / 2 - tw / 2 - 8, 6, tw + 16, 22);
    ctx.fillStyle = '#fcd34d';
    ctx.fillText(battle.orderToast.msg, canvasW / 2, 11);
    ctx.restore();
  }
}

let battle = {
  units: [], tracers: [], explosions: [], shells: [],
  objectives: [],
  gridMap: null,
  gridCanvas: null,
  running: false, paused: false, ended: false,
  time: 0, speed: 1, lastTime: 0,
  blueName: '', redName: '', mode: 'encounter',
  nextObjectiveCheck: 0,
  _groups: {},
  _marks: null,
  _nextMarkUpdate: 0,
  _nextArtyRoleCheck: 0,
  /* ============================================================
     ★★★ R9.5：**玩家操控系统**
     ------------------------------------------------------------
     · `playerSide`：你亲自带哪一方（'' = 纯观战，双方 AI 对打）
       —— 你带的那一方，**将军彻底让位**（`aiEnabled[side] = false`）⇒
          "AI 老是覆盖我的命令"从根上消失（不是靠优先级去抢）
     · `selection`：你选中的单位（左键框选 / 点选；只会是 playerSide 那一方）
       —— 命令按**组**下达（命令层的粒度就是组），所以一次命令能带动整组
     · `curOrder`：命令条当前选中的命令类型（对应数字键 1~9）
     ============================================================ */
  playerSide: 'blue',
  aiEnabled: { blue: true, red: true },
  selection: [],
  curOrder: 'MOVE_TO',
  orderToast: null,
  boxSel: null,                       // 框选矩形（屏幕坐标，画在 HUD 层）
  clickMark: null,                    // ★ R9.5d 右键落点回显 {x,y,t,ok}
  sh: { legend: false, diag: false }, // 显示开关（图例 / 诊断行）
  /* ★ R9.5c：玩家操控的组 —— **粘性上下车意图**（gk → true 上车 / false 下车）。
     为什么需要：命令层的 DISMOUNT 一旦"完成"（人都下来了），执行层下一帧
     `updateRideMode` 又会算出"要坐车" ⇒ 立刻爬回车上 = 玩家看到的"秒上车"。
     玩家的上下车是**状态**，不是一次性动作 ⇒ 记在这里，一直生效到玩家改主意。 */
  playerRide: {},
};

const symbolCache = new Map();

/* ============================================================
   1) 初始化
   ============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  canvas = $('battle-canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  populateArmySelectors();
  buildMapSelect();       // ★ R9.6.10：地图下拉框由 GRID_MAPS 动态生成（官方 ★ / 用户 📁）

  on('blue-army', 'change', () => { unitSelection.blue = null; updateStartButton(); });
  on('red-army',  'change', () => { unitSelection.red  = null; updateStartButton(); });

  on('btn-start', 'click', startBattle);
  on('btn-pause', 'click', togglePause);
  on('btn-reset', 'click', resetBattle);
  on('btn-select-units', 'click', openUnitSelector);

  on('speed', 'change', e => {
    battle.speed = parseFloat(e.target.value) || 1;
  });

  on('opt-show-names', 'change', e => { showUnitLabels = e.target.checked; });
  on('opt-show-individuals', 'change', e => { showIndividuals = e.target.checked; });

  /* ============================================================
     ★★★ R9.5：玩家操控系统的界面绑定
     ============================================================ */
  const psSel = $('player-side');
  if (psSel) {
    battle.playerSide = psSel.value || '';
    setPlayerSide(battle.playerSide, true);
    psSel.addEventListener('change', () => setPlayerSide(psSel.value || ''));
  }
  document.querySelectorAll('#cmdbar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.order;
      const needPoint = !!ORDERS_NEED_POINT[k];
      setCurOrder(k);
      /* 不需要目标点的命令（固守/掩体/上下车/停止）⇒ 点按钮就直接执行 */
      if (!needPoint) execPlayerOrder(k);
    });
  });
  const dpBtn = $('btn-display'), dpPop = $('display-pop');
  if (dpBtn && dpPop) {
    dpBtn.addEventListener('click', e => {
      e.stopPropagation();
      dpPop.classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!dpPop.classList.contains('hidden') && !dpPop.contains(e.target) && e.target !== dpBtn) {
        dpPop.classList.add('hidden');
      }
    });
  }
  on('opt-show-legend', 'change', e => { battle.sh.legend = e.target.checked; drawBattlefield(); });
  on('opt-show-diag',   'change', e => { battle.sh.diag = e.target.checked; drawBattlefield(); });
  on('opt-ai-blue', 'change', e => { battle.aiEnabled.blue = e.target.checked; });
  on('opt-ai-red',  'change', e => { battle.aiEnabled.red  = e.target.checked; });

  /* 快捷键：1~9 选命令 · 0 停止 · Esc 取消选中（输入框里不拦） */
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) ? String(e.target.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (ORDER_KEYMAP[e.key]) { setCurOrder(ORDER_KEYMAP[e.key]); return; }
    if (e.key === 'Escape') {
      battle.selection = []; battle.boxSel = null;
      updateCmdBar(); if (ctx) drawBattlefield();
    }
  });

  const mapSel = $('battle-map');
  if (mapSel) {
    selectedMapId = mapSel.value || '';
    mapSel.addEventListener('change', e => {
      selectedMapId = e.target.value || '';
    });
  }

  on('result-restart', 'click', () => {
    $('result-overlay').classList.add('hidden');
    startBattle();
  });
  on('result-close', 'click', () => {
    $('result-overlay').classList.add('hidden');
  });

  on('cam-zoom-in',  'click', () => zoomAt(canvasW/2, canvasH/2, 1.25));
  on('cam-zoom-out', 'click', () => zoomAt(canvasW/2, canvasH/2, 1/1.25));
  on('cam-reset',    'click', resetCamera);

  let panState = null;
  /* ★ R8：右键不再弹浏览器菜单；★★ R9.5：有"我操控"的阵营时，右键 = **下达命令** */
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    const playable = !!battle.playerSide;
    /* 平移：中键拖 / Alt+左键拖 / （纯观战时）左键拖 —— 与 RTS 习惯一致 */
    const wantPan = (e.button === 1) || (e.button === 0 && e.altKey) || (e.button === 0 && !playable);
    if (wantPan) {
      panState = { mode: 'pan', startX: e.clientX, startY: e.clientY,
                   camX: camera.x, camY: camera.y,
                   pointerId: e.pointerId, moved: false, button: e.button };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      canvas.classList.add('panning');
      return;
    }
    if (e.button === 2) {
      /* 右键：有玩家阵营 ⇒ 下命令（DEV 面板不再抢右键）；否则才交给 DEV 面板 */
      if (playable) { playerRightClick(e); return; }
      if (window.DevPanel && DevPanel.onRightDown(e)) return;
      return;
    }
    if (e.button !== 0) return;
    /* 左键 = 框选（玩家阵营在场时） */
    const rect = canvas.getBoundingClientRect();
    panState = { mode: 'select',
                 startX: e.clientX - rect.left, startY: e.clientY - rect.top,
                 curX: e.clientX - rect.left, curY: e.clientY - rect.top,
                 pointerId: e.pointerId, moved: false, button: 0, add: !!e.shiftKey };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', e => {
    if (!panState || e.pointerId !== panState.pointerId) return;
    if (panState.mode === 'select') {
      const rect = canvas.getBoundingClientRect();
      panState.curX = e.clientX - rect.left;
      panState.curY = e.clientY - rect.top;
      if (!panState.moved && Math.hypot(panState.curX - panState.startX, panState.curY - panState.startY) > 4) {
        panState.moved = true;
        battle.boxSel = { x0: panState.startX, y0: panState.startY, x1: panState.curX, y1: panState.curY };
      }
      if (panState.moved) {
        battle.boxSel.x1 = panState.curX;
        battle.boxSel.y1 = panState.curY;
        drawBattlefield();
      }
      return;
    }
    const dx = e.clientX - panState.startX;
    const dy = e.clientY - panState.startY;
    if (!panState.moved && Math.hypot(dx, dy) > 3) panState.moved = true;
    if (!panState.moved) return;
    camera.x = panState.camX - dx / camera.zoom;
    camera.y = panState.camY - dy / camera.zoom;
    clampCamera();
    drawBattlefield();
  });
  function endPan(e) {
    if (!panState) return;
    if (e && e.pointerId !== panState.pointerId) return;
    const st = panState;
    panState = null;
    try { canvas.releasePointerCapture(st.pointerId); } catch (_) {}
    canvas.classList.remove('panning');
    if (st.mode === 'select') {
      battle.boxSel = null;
      if (st.moved) selectBox(st.startX, st.startY, st.curX, st.curY, st.add);
      else selectClick(st.startX, st.startY, st.add);
      drawBattlefield();
      return;
    }
    /* 纯观战时：左键单击 = DEV 面板的选中（旧行为，保持可用） */
    if (!st.moved && st.button === 0 && !battle.playerSide && window.DevPanel) DevPanel.onLeftClick(e);
  }
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1/1.15);
  }, { passive: false });

  let pinchState = null;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      const rect = canvas.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      const w = s2w(cx, cy);
      pinchState = { startDist: dist, startZoom: camera.zoom, cx, cy, worldCX: w.x, worldCY: w.y };
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchState) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      /* ★ R9.6.13：**中点也参与** ⇒ 双指拖动 = 平移（手机上唯一可用的平移手势），
         与捏合缩放共用同一个"世界锚点"（按住瞬间中点下的那个世界点） */
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      let nz = pinchState.startZoom * dist / pinchState.startDist;
      nz = Math.max(camera.minZoom, Math.min(camera.maxZoom, nz));
      camera.zoom = nz;
      camera.x = pinchState.worldCX - (cx - canvasW / 2) / camera.zoom;
      camera.y = pinchState.worldCY - (cy - canvasH / 2) / camera.zoom;
      clampCamera();
      drawBattlefield();
    }
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinchState = null;
  }, { passive: true });

  window.addEventListener('keydown', e => {
    if (e.key === 'v' || e.key === 'V') {
      const idx = VIEW_MODES.indexOf(viewMode);
      viewMode = VIEW_MODES[(idx + 1) % VIEW_MODES.length];
      battle._viewHintAt = battle.time;          // ★ R9：提示只显示 4 秒
      drawBattlefield();
    }
    // ★ L：视野显示（isovist）—— 视距圆 + 半透明可见区，被遮挡方向挖成透明
    if (e.key === 'l' || e.key === 'L') {
      visionOverlay = !visionOverlay;
      if (!visionOverlay) {
        for (const u of battle.units) u._visPoly = null;   // 关掉就清缓存，下次打开重算
      }
      battle._viewHintAt = battle.time;          // ★ R9：提示只显示 4 秒
      drawBattlefield();
    }
    /* ★ R8：P（寻路诊断）/ H（状态史 dump）两个键已随寻路层一起删除。
       DEV 模式（?dev=1）的手动操控快捷键见 js/dev-panel.js。 */
  });

  drawBattlefield();
});

function zoomAt(px, py, factor) {
  const w = s2w(px, py);
  let nz = camera.zoom * factor;
  nz = Math.max(camera.minZoom, Math.min(camera.maxZoom, nz));
  camera.zoom = nz;
  camera.x = w.x - (px - canvasW / 2) / camera.zoom;
  camera.y = w.y - (py - canvasH / 2) / camera.zoom;
  clampCamera();
  drawBattlefield();
}
function clampCamera() {
  const margin = Math.max(MAP_W, MAP_H) * 0.3;
  camera.x = Math.max(-margin, Math.min(MAP_W + margin, camera.x));
  camera.y = Math.max(-margin, Math.min(MAP_H + margin, camera.y));
}
function resetCamera() {
  camera.x = MAP_W / 2;
  camera.y = MAP_H / 2;
  const targetViewW = MAP_W * 1.2;
  const targetViewH = MAP_H * 1.2;
  const zx = canvasW / targetViewW;
  const zy = canvasH / targetViewH;
  camera.zoom = Math.max(0.05, Math.min(2, Math.min(zx, zy)));
  camera.minZoom = camera.zoom * 0.2;
  camera.maxZoom = Math.max(2, camera.zoom * 16);
  drawBattlefield();
}
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvasW = rect.width;
  canvasH = rect.height;
  canvas.width = canvasW * dpr;
  canvas.height = canvasH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  resetCamera();
}
/* ★★★ R9.6.10：**地图下拉框 = GRID_MAPS 动态生成**
   ------------------------------------------------------------
   旧版把 4 张预设地图**写死在 battle.html** 里 ⇒ 每次换官方图都要同时改 html 与 battle.js
   （还有 startBattle 里的随机池），三处迟早对不上。现在**唯一来源 = GRID_MAPS**：
     官方图（不来自 localStorage）显示 `★ 名字（9×5km）`，用户图显示 `📁 名字（…）`。 */
function buildMapSelect() {
  const sel = $('battle-map');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">自动（随机）</option>';
  const official = [], users = [];
  Object.values(GRID_MAPS).forEach(gm => {
    if (!gm) return;
    (gm._isUserMap ? users : official).push(gm);
  });
  const add = (gm, tag) => {
    const opt = document.createElement('option');
    opt.value = gm.id;
    opt.textContent = `${tag} ${gm.name}（${gm.w / 1000}×${gm.h / 1000}km）`;
    sel.appendChild(opt);
  };
  official.forEach(gm => add(gm, '★'));
  users.forEach(gm => add(gm, '📁'));
  if (keep) sel.value = keep;
}

function populateArmySelectors() {
  let saves = {};
  try { saves = JSON.parse(localStorage.getItem(SAVES_KEY) || '{}'); }
  catch (e) { saves = {}; }
  const keys = Object.keys(saves).sort((a, b) => (saves[b].time||0) - (saves[a].time||0));
  const blueSel = $('blue-army');
  const redSel  = $('red-army');
  if (!keys.length) {
    if (blueSel) blueSel.innerHTML = '<option value="">（无存档）</option>';
    if (redSel)  redSel.innerHTML  = '<option value="">（无存档）</option>';
    return;
  }
  const options = keys.map(k => {
    const s = saves[k];
    const date = new Date(s.time || Date.now());
    return `<option value="${escapeHtml(k)}">${escapeHtml(k)} · ${date.toLocaleDateString()}</option>`;
  }).join('');
  if (blueSel) blueSel.innerHTML = '<option value="">-- 蓝方 --</option>' + options;
  if (redSel)  redSel.innerHTML  = '<option value="">-- 红方 --</option>' + options;
}
function updateStartButton() {
  const blue = $('blue-army')?.value;
  const red  = $('red-army')?.value;
  const btn = $('btn-start');
  if (btn) btn.disabled = !(blue && red);
  const sel = $('btn-select-units');
  if (sel) sel.disabled = !(blue && red);
}

/* ============================================================
   2) 路径工具
   ============================================================ */
function forEachWithPath(rootNode, fn) {
  function walk(node, path) {
    fn(node, path);
    if (node.children && node.children.length) {
      node.children.forEach((c, i) => {
        walk(c, path ? `${path}/${i}` : String(i));
      });
    }
  }
  walk(rootNode, '');
}

const ECHELON_ORDER_LOCAL = [
  'army','corps','division','brigade','regiment','battalion',
  'company','platoon','section','squad','team','individual'
];

function autoSelectEchelon(rootNode, targetEchelon, outSet) {
  const targetIdx = ECHELON_ORDER_LOCAL.indexOf(targetEchelon);

  function walk(node, path, isRoot) {
    if (!isRoot && path) {
      const nodeIdx = ECHELON_ORDER_LOCAL.indexOf(node.echelon);
      if (nodeIdx >= targetIdx && nodeIdx >= 0) {
        outSet.add(path);
        return;
      }
      if (!node.children || !node.children.length) {
        outSet.add(path);
        return;
      }
    }
    if (node.children && node.children.length) {
      node.children.forEach((c, i) => {
        walk(c, path ? `${path}/${i}` : String(i), false);
      });
    }
  }
  walk(rootNode, '', true);
}

function applySelection(path, checked, sel) {
  if (checked) sel.add(path);
  else sel.delete(path);
}
function extractSelectedUnits(rootNode, selectionSet, targetEchelon, maxUnits) {
  const result = [];
  const limit = maxUnits || MAX_UNITS_PER_SIDE;

  function walk(node, path, isRoot, parentNode) {
    if (!isRoot && selectionSet && selectionSet.has(path)) {
      result.push({ node, path, parentNode });
      return;
    }
    if (!node.children || !node.children.length) return;
    if (!isRoot && !selectionSet) {
      const nodeIdx = ECHELON_ORDER_LOCAL.indexOf(node.echelon);
      const targetIdx = ECHELON_ORDER_LOCAL.indexOf(targetEchelon);
      if (nodeIdx >= targetIdx && nodeIdx >= 0) {
        result.push({ node, path, parentNode });
        return;
      }
    }
    node.children.forEach((c, i) => {
      walk(c, path ? `${path}/${i}` : String(i), false, node);
    });
  }
  walk(rootNode, '', true, null);

  if (result.length > limit) {
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    result.length = limit;
  }
  return result;
}
/* 已选单位的总人数 —— 仅用于把"建议参战人数"呈现给玩家，不做任何限制 */
function selectionSoldiers(root, selectionSet) {
  if (!root || !selectionSet || !selectionSet.size) return 0;
  let s = 0;
  forEachWithPath(root, (node, path) => {
    if (path && selectionSet.has(path)) s += estimateSoldiers(node);
  });
  return s;
}

function getMapMaxUnits() {
  if (selectedMapId && GRID_MAPS[selectedMapId] && GRID_MAPS[selectedMapId].maxUnitsPerSide) {
    return GRID_MAPS[selectedMapId].maxUnitsPerSide;
  }
  return MAX_UNITS_PER_SIDE;
}

function getMapMaxSoldiers() {
  const gm = selectedMapId && GRID_MAPS[selectedMapId];
  if (gm) {
    if (gm.soldiersPerSide) return gm.soldiersPerSide;
    return recommendedSoldiers(gm.w, gm.h);
  }
  // 未选地图（自动/随机）：按默认单位上限 × 每单位 30 人估算
  return MAX_UNITS_PER_SIDE * 30;
}

/* ============================================================
   3) 地图尺寸（已锁定，不再动态计算）
   ============================================================ */
function computeMapSizeFromUnits(units) {
  const n = Math.max(2, Math.ceil(units.length / 2));
  const w = Math.max(MAP_MIN_W, Math.round(n * UNIT_FRONTAGE * 1.8));
  const h = Math.max(MAP_MIN_H, Math.round(w * 0.62));
  return { w, h };
}

/* ============================================================
   4) 地形
   ============================================================ */
/* ★★★ R9.6.11：**建筑状态每局重置**（玩家实测 bug：上一局被打塌的楼会保留到下一局）
   ------------------------------------------------------------
   为什么需要：`gm.buildings` 挂在 **GRID_MAPS 里的地图对象**上（**跨局共享**），
   战斗中被打掉的 `hp` 不会自己回来 ⇒ 下一局开局就是"废墟地图"（楼全是塌的）。
   这里在开局时把每栋楼恢复成 `hpMax`，并清掉上一局的占用标记。 */
function resetBuildingsForBattle() {
  const gm = battle.gridMap;
  const bs = (gm && gm.buildings) || [];
  for (const b of bs) {
    if (typeof b.hpMax === 'number' && b.hpMax > 0) b.hp = b.hpMax;
    b._occBlue = 0;
    b._occRed = 0;
  }
}

function generateTerrain() {
  const gm = GRID_MAPS[selectedMapId];
  if (!gm) {
    battle.gridMap = null;
    battle.gridCanvas = null;
    battle.objectives = [];
    battle.supplies = [];
    return;
  }
  MAP_W = gm.w;
  MAP_H = gm.h;
  battle.gridMap = gm;
  ensureSpawns(gm);
  battle.gridCanvas = bakeGridCanvas(gm);

  /* ★★ R9.2：**补给点** —— 地图自己配了就用它的；一个都没有 ⇒ 自动在各方纵深放一个
     （和 `autoEncounterObjectives` 一个思路：让机制在 4 张预置图上也能立刻验证） */
  battle.supplies = (gm.supplies && gm.supplies.length) ? normalizeSupplies(gm.supplies) : autoSupplies(gm);

  /* ★ 据点：遭遇战没有据点时自动生成中立争夺点；攻防战由守方初始占有 */
  let objSrc = (gm.objectives || []).slice();
  if (!objSrc.length && (!battle.mode || battle.mode === 'encounter')) {
    objSrc = autoEncounterObjectives(gm);
  }
  const defSide = defenderSide();
  battle.objectives = objSrc.map((o, i) => {
    const init = defSide === 'blue' ? 1 : (defSide === 'red' ? -1 : 0);
    return {
      x: o.x, y: o.y, r: o.r, name: o.name,
      owner: defSide || null,
      cap: init,
      _auto: !!o._auto,
      _id: 'obj_' + i,
      blueCount: 0, redCount: 0,
    };
  });
}


function getTerrainAt(x, y) {
  if (!battle.gridMap) return {
    speedMul:1, rangeMul:1, cover:0, blocked:false,
    blocksMove:false, sightBlock:0, spotMod:1, conceal:0,
    onRoad:false, onHill:false, onForest:false, onTrench:false,
  };
  const t = getGridTerrain(battle.gridMap, x, y);
  return {
    /* ★★★ R9.6.6：**必须带上 id** —— `mobilityMulForTile(mt, tg)` 读的就是 `tg.id`
       （TERRAIN_SPEED_TABLE 的键是地形 id：empty/road/forest/…）。
       丢了这一行 ⇒ 查表 `row[undefined]` ⇒ 恒返回 0 ⇒ **整套地形速度表形同虚设**：
         · 徒步 `_terrainMul = 0` ⇒ 每帧 step = 0 ⇒ **步兵根本走不动**
         · 车辆 `fleetSpeedFactor` 被钳到下限 0.15 ⇒ **所有车都只有 15% 速度**
       玩家原话："把地形的数值和单位的数值代入进去" —— 就是这一行。 */
    id: t.id,
    speedMul: t.speedMul,
    rangeMul: t.rangeMul,
    cover: t.cover,
    blocked: !!t.blocksMove,
    blocksMove: !!t.blocksMove,
    sightBlock: t.sightBlock || 0,
    spotMod: (typeof t.spotMod === 'number') ? t.spotMod : 1,
    conceal: t.conceal || 0,
    onRoad: !!t.onRoad,
    onHill: !!t.onHill,
    onForest: !!t.onForest,
    onTrench: !!t.onTrench,
  };
}
function getCoverAt(x, y) {
  if (!battle.gridMap) return 0;
  const t = getGridTerrain(battle.gridMap, x, y);
  let cover = t.cover;
  if (!t.blocksMove && cover < 0.7) {
    const gm = battle.gridMap;
    const gx = Math.floor(x / gm.cellSize);
    const gy = Math.floor(y / gm.cellSize);
    const N4 = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dy] of N4) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= gm.gw || ny < 0 || ny >= gm.gh) continue;
      const nt = getGridTerrain(gm,
        nx * gm.cellSize + gm.cellSize / 2,
        ny * gm.cellSize + gm.cellSize / 2);
      if (nt.id === 'wall') cover = Math.max(cover, 0.6);
    }
  }
  return cover;
}

/* ============================================================
   建筑辅助
   ============================================================ */
const _battleBuildingImgCache = new Map();

function getBattleBuildingImage(b) {
  const state = getBuildingState(b);
  const def = BUILDING_TYPES[b.type];
  if (!def) return null;
  const key = b.type + '|' + b.variant + '|' + state;
  if (_battleBuildingImgCache.has(key)) return _battleBuildingImgCache.get(key);

  const ox = def.dhPx * 0.5;
  const oy = def.dhPx;
  const imgW = def.pxW + ox;
  const imgH = def.pxH + oy;

  let svg;
  try { svg = renderBuildingSVG(b, imgW, imgH); }
  catch (e) { return null; }

  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  img.loaded = false;
  img.onload = () => { img.loaded = true; };
  img.onerror = () => { console.warn('建筑 SVG 加载失败'); };
  img.src = url;
  _battleBuildingImgCache.set(key, img);
  return img;
}

/* 任意坐标处的掩体乘数（士兵级掩体用） */
function coverFactorAt(x, y, isArtillery) {
  if (battle.gridMap && battle.gridMap.buildings) {
    for (let i = battle.gridMap.buildings.length - 1; i >= 0; i--) {
      const b = battle.gridMap.buildings[i];
      if (getBuildingState(b) === 'collapsed') continue;
      if (isPointInBuilding(b, x, y)) {
        const def = BUILDING_TYPES[b.type];
        const c = def.cover[getBuildingState(b)];
        return isArtillery ? c.shell : c.bullet;
      }
    }
  }
  // 无建筑 → 旧地形掩体
  const cover = getCoverAt(x, y);
  return isArtillery ? (1 - cover * 0.9) : (1 - cover * 0.7);
}

/* 建筑坍塌/破损时对内部单位伤害 */
function applyBuildingCollapseDamage(building, ratio) {
  for (const u of battle.units) {
    if (!u.alive) continue;
    if (!isPointInBuilding(building, u.x, u.y)) continue;
    const killCount = Math.max(1, Math.round(u.soldiers.length * ratio));
    for (let k = 0; k < killCount && k < u.soldiers.length; k++) {
      damageSoldier(u, HP_PER_SOLDIER);
    }
  }
}

function isInHouse(x, y) {
  if (!battle.gridMap) return false;
  const t = getGridTerrain(battle.gridMap, x, y);
  return t.id === 'house';
}
/* ★ 掩体搜索：从"贴身"开始的多档半径扫描
   —— 老代码的采样半径是 `maxRadius * (0.4 ~ 0.85)`，最近也在 112m 外，
      所以贴着身边 15m 的石墙/树林永远进不了候选（"石墙一直没人用"的真正原因）。
   现在：25/45/80/140/240 五档（★首档从 15→25，避免"掩体就在 15m 外却因为到达阈值 40m 直接判为已到达、人根本没动"） */
const COVER_SCAN_RINGS = [25, 45, 80, 140, 240];

function scanCoverAround(x, y, rings, dirX, dirY, radius) {
  let best = null, bestScore = -Infinity;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const seed = (x * 0.0137 + y * 0.0271) % (Math.PI * 2);
  for (let ri = 0; ri < rings.length; ri++) {
    const r = rings[ri];
    const SAMPLES = 12;
    for (let i = 0; i < SAMPLES; i++) {
      const angle = i * goldenAngle + seed + ri * 0.4;
      const tx = x + Math.cos(angle) * r;
      const ty = y + Math.sin(angle) * r;
      if (tx < 40 || tx > MAP_W - 40 || ty < 40 || ty > MAP_H - 40) continue;
      if (isMoveBlockedAt(tx, ty, radius)) continue;                 // 带半径
      const cover = getCoverAt(tx, ty);
      if (cover < 0.3) continue;
      if (isPathBlocked(x, y, tx, ty, radius, 25)) continue;         // 必须走得到
      let score = cover * 500 - r * 0.6;
      if (dirX !== undefined) {
        const dot = Math.cos(angle) * dirX + Math.sin(angle) * dirY;
        score += dot * 40;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x: tx, y: ty, cover };
      }
    }
  }
  return best;
}

function findNearbyCover(unit, maxRadius, preferredDir) {
  const cap = Math.max(40, maxRadius || 240);
  const rings = COVER_SCAN_RINGS.filter(r => r <= cap);
  return scanCoverAround(
    unit.x, unit.y, rings,
    preferredDir ? preferredDir.x : undefined,
    preferredDir ? preferredDir.y : undefined,
    bodyRadiusOf(unit)
  );
}

/* 任意坐标附近找掩体（士兵级掩体搜索用） */
function findNearbyCoverAt(x, y, maxRadius) {
  const cap = Math.max(30, maxRadius || 160);
  const rings = COVER_SCAN_RINGS.filter(r => r <= cap);
  return scanCoverAround(x, y, rings, undefined, undefined, SOLDIER_BODY_RADIUS);
}


/* ============================================================
   避障系统
   ============================================================ */
const AVOID_SAMPLE_DIST = 300;
const AVOID_ANGLES = [
  0,
  0.26, -0.26,   // ±15°
  0.52, -0.52,   // ±30°
  0.79, -0.79,   // ±45°
  1.05, -1.05,   // ±60°
  1.31, -1.31,   // ±75°
  1.57, -1.57,   // ±90°
];

/* ★★ R8：两个小工具（只用于"哪一段慢"的取证与错峰，不改任何行为）
   · hashPhase(unit, span)：给单位一个**固定**的 0~span 相位 ⇒ 把"每 X 秒全场同时重算"
     摊到不同帧上（旧版所有单位在同一帧一起重算视野/密度 ⇒ 周期性同步尖峰 = 玩家看到的"整体静止"）
   · profAdd(key, ms)：把某一段的耗时累加进 battle._prof（每帧清零，见 updateBattle） */
function hashVal(unit, salt) {
  const s = String((unit && (unit.id || unit.name)) || 'u') + '#' + (salt || 0);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return (h % 1000) / 1000;
}
function hashPhase(unit, span) { return hashVal(unit, 0) * span; }
function profAdd(key, ms) {
  const p = battle._prof || (battle._prof = { sep: 0, vis: 0, dens: 0, ai: 0, move: 0 });
  p[key] = (p[key] || 0) + ms;
}
/* ★ R8/R9.2：空闲兜底已删除 ⇒ 这个函数不再需要（"永远有下一条命令"改由将军层保证） */
/* 直线路径是否通畅（每 20m 采样一次） */
function isStraightPathClear(x1, y1, x2, y2, stepSize) {
  stepSize = stepSize || 20;
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist / stepSize);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (pointIsBlocking(x1 + dx * t, y1 + dy * t)) return false;
  }
  return true;
}

/* 找绕行点：从目标方向左右采样，选"角度偏移小 + 离目标近"的可通行点 */
function findAvoidanceWaypoint(unit, targetX, targetY) {
  const dx = targetX - unit.x, dy = targetY - unit.y;
  const dist = Math.hypot(dx, dy) || 1;
  const baseAngle = Math.atan2(dy, dx);
  const sampleDist = Math.min(AVOID_SAMPLE_DIST, dist);

  let best = null;
  let bestScore = Infinity;

  for (const da of AVOID_ANGLES) {
    const a = baseAngle + da;
    const tx = unit.x + Math.cos(a) * sampleDist;
    const ty = unit.y + Math.sin(a) * sampleDist;

    if (tx < 20 || tx > MAP_W - 20 || ty < 20 || ty > MAP_H - 20) continue;
    if (isMoveBlockedAt(tx, ty, bodyRadiusOf(unit))) continue;
    if (isPathBlocked(unit.x, unit.y, tx, ty, bodyRadiusOf(unit), 25)) continue;
    if (isPathCrowded(unit, unit.x, unit.y, tx, ty)) continue;   // ★ 绕开"站着不动"的单位

    const goalDist = Math.hypot(targetX - tx, targetY - ty);
    const anglePenalty = Math.abs(da) * 150;
    const score = anglePenalty + goalDist;

    if (score < bestScore) {
      bestScore = score;
      best = { x: tx, y: ty, da };
    }
  }

  return best;
}
function navMobOf(unit) { return (unit && unit.mobilityType) || 'foot'; }

/* ★ R7.6：转向速率（"单位只能走向自己朝向的方向"）
   —— 朝向以**有限角速度**追目标，不再每帧瞬移转向；移动方向由朝向决定
      （车体见 moveVehicleToward；单位朝向见 mover 末尾）。 */
const NAV_TURN_RATE = { foot: 2.8, wheeled: 1.1, tracked: 0.85, halftrack: 1.0, air: 6.0 };  // rad/s
function navTurnRateOf(unit) { return NAV_TURN_RATE[navMobOf(unit)] || 1.4; }
/* 把 cur 朝 want 转最多 maxStep 弧度（走最短弧） */
function navTurnToward(cur, want, maxStep) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return want;
  return cur + (d > 0 ? maxStep : -maxStep);
}

/* ============================================================
   ★★★ R9.1：**朝向约束**（玩家定案：车 + 步兵都"只能朝向朝向走"，
   但允许 **±14° 以内**的斜向微调 —— 不用停车就能修正，最平滑、漂移基本消失）
   ------------------------------------------------------------
   为什么定 ±14°：完全禁止横向 ⇒ 想对齐槽位就得"先停车转向" ⇒ 又变成走走停停；
      tan(14°) ≈ 0.249 ⇒ 判据就是"横向分量 ≤ 纵向分量 × 0.25"。
   纪律：**每一处**改变成员坐标的地方都必须过这道锥，否则整队还是会被推歪：
     · 士兵走位（8.3 段）      · 车体前进 / 被挡绕行（moveVehicleToward）
     · 车-车分离 / 士兵分离     （横向推挤 = 玩家看到的"漂移"的根）
   ============================================================ */
const HEADING_LAT_TAN = 0.25;                 // ≈ tan(14°)

/* 把方向 (dx,dy) 夹进"朝向 facing ±14°"的行进锥（返回单位向量；目标在正后方 ⇒ null） */
function headingConeDir(dx, dy, facing) {
  const hx = Math.cos(facing || 0), hy = Math.sin(facing || 0);
  const fwd = dx * hx + dy * hy;              // 沿朝向的分量
  const lat = dx * (-hy) + dy * hx;           // 横向分量（右为正）
  if (fwd <= 0.02) return null;               // 正后方 ⇒ 这一帧先不前进（让朝向转过去）
  const latMax = fwd * HEADING_LAT_TAN;
  const lc = Math.max(-latMax, Math.min(latMax, lat));
  const ox = hx * fwd + (-hy) * lc, oy = hy * fwd + hx * lc;
  const l = Math.hypot(ox, oy) || 1;
  return { x: ox / l, y: oy / l };
}

/* 分离力/推挤：沿朝向分量原样保留，横向分量**压到 1/4**
   —— 完全不保留 ⇒ 左右两人永远解不开重叠；完全不压 ⇒ 整队被推歪 = 漂移 */
function headingProject(dx, dy, facing) {
  const hx = Math.cos(facing || 0), hy = Math.sin(facing || 0);
  const fwd = dx * hx + dy * hy;
  const lat = dx * (-hy) + dy * hx;
  return {
    x: hx * fwd + (-hy) * lat * HEADING_LAT_TAN,
    y: hy * fwd + hx * lat * HEADING_LAT_TAN,
  };
}

/* ★ R9.1：**行进节流**（替代"压制段停 1.8 秒"）：1 = 正常；0.25 = 猫腰慢进 */
function paceMulOf(unit) { return (unit._paceMul == null) ? 1 : unit._paceMul; }

/* 两角之差（-π..π） */
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ============================================================
   ★★★ R9.6：**实体为准的移动**（玩家定案："单位只能朝着朝向行走，
   但可以在转向的过程中移动" —— 横向恒为 0 ⇒ **漂移彻底消失**）
   ------------------------------------------------------------
   为什么必须这么做：旧版单位坐标 = **成员质心反推**（`unitCenterFromSoldiers`），
   于是任何成员级横向位移（分离力 / 各自找掩体 / 槽位重排 / 绕行）都会变成
   **整个单位的漂移** —— 玩家原话："本来漂移只是为了兜底，现在反过来漂移成了主流"。
   新规则（`battle.html?steer=0` 可切回旧行为做 A/B，确认后再删旧路径）：
     ① 单位坐标只由 `facing × speed × dt` 推进（**只有前向分量**）
     ② 朝向以有限角速度追目标；**转向过程中照常前进**（轨迹是收敛的弧，不是"停车转向"）
     ③ 被地形挡住 ⇒ 只在朝向 ±40° 内"**打方向**"再前进，**永不横移**
     ④ 成员（士兵/车辆）按队形槽位跟随（槽位**随朝向旋转**）+ **零均值分离**
        ⇒ 没有任何力量能把质心推歪；士兵不再各自跑去掩体/绕障（原地还击）
   ============================================================ */
const STEER_ENTITY = !/[?&]steer=0/.test(location.search);

/* 队形槽位质心（把队形对齐到实体位置；算一次缓存） */
function unitSlotCenter(unit) {
  if (unit._slotCX != null) return { x: unit._slotCX, y: unit._slotCY };
  let sx = 0, sy = 0, n = 0;
  for (const s of unit.soldiers) { sx += (s.ox || 0); sy += (s.oy || 0); n++; }
  unit._slotCX = n ? sx / n : 0;
  unit._slotCY = n ? sy / n : 0;
  return { x: unit._slotCX, y: unit._slotCY };
}

/* ★★★ R9.6.3：**车辆槽位质心**（与 unitSlotCenter 同一条道理）
   ------------------------------------------------------------
   旧版车辆槽位直接用原始 `v.ox/v.oy`（"车长×间距"网格 + 抖动）当**绝对**偏移，
   而网格在"最后一行没排满 / 抖动"时**均值 ≠ 0**（实测 2~4m）。
   这在旧模型里无害（单位坐标本来就由成员反推），但 R9.6 实体为准之后：
     · "在车上的兵"位置 = 车位置（`syncAboardSoldiers`）⇒ 他们的质心 = 实体 + R(θ)·车槽位均值
     · 画兵牌那一步又把 `u.x = 质心` 写回（R9.6 的遗留，已删）
   ⇒ **实体每帧被平移一次**（方向随朝向旋转）= "所有单位持续漂移、几十秒内冲到地图边/图外"，
      而且**与谁操控无关**（发生在绘制阶段，没命令的单位照样跑）。
   现在车辆槽位同样按"相对槽位质心"使用 ⇒ 零均值，车与步兵两套成员口径一致。 */
function unitVehicleSlotCenter(unit) {
  if (unit._vslotCX != null) return { x: unit._vslotCX, y: unit._vslotCY };
  let sx = 0, sy = 0, n = 0;
  for (const v of (unit.vehicles || [])) { sx += (v.ox || 0); sy += (v.oy || 0); n++; }
  unit._vslotCX = n ? sx / n : 0;
  unit._vslotCY = n ? sy / n : 0;
  return { x: unit._vslotCX, y: unit._vslotCY };
}

/* 实体这一帧的速度（米/秒）：乘车用"车队同速"，徒步用"全队地形采样"
   ★ R9.6.6：地形倍率加**下限 0.10** —— 表里"0 = 开不进去"是给**选路**用的判据（路线不走那里），
   但真被命令送到那种地形上时不能让单位**彻底冻住**（玩家最恨"永久卡住"）：留 10% 缓慢脱困。 */
const ENTITY_MIN_TERRAIN_MUL = 0.10;
function entitySpeedOf(unit) {
  const base = unit.speed || 5;
  if (unit.mounted && unit.vehicles && unit.vehicles.length) return base * (unit._fleetMul || 1);
  const tm = (unit._terrainMul == null) ? 1 : Math.max(ENTITY_MIN_TERRAIN_MUL, unit._terrainMul);
  return base * tm;
}

/* 行军/停稳计时（乘车判定与炮兵架设判定都要用） */
function syncMotionTimers(unit) {
  if (unit.stance === 'moving') {
    if (!unit._moveSince) unit._moveSince = battle.time;
    unit._staticSince = 0;
  } else {
    unit._moveSince = 0;
    if (!unit._staticSince) unit._staticSince = battle.time;
  }
}

/* 成员是否"按队形摆放" —— 炮兵架设中/已架设时**不动成员**（乘员要留在炮位） */
function membersFollowFormation(unit) {
  if (typeof unitDeployed === 'function' && unitDeployed(unit)) return false;
  if (unit._needsUndeploy) return false;
  return true;
}

/* ★★★ R9.6.3：把**实体**夹回地图（余量按编队半径给；余量必须小于半张地图，否则上下界会夹反）
   —— 单独成函数的原因：它现在有两个调用点（移动成功时 / 每帧无条件），
      必须只有一份实现，不然"夹反"这类问题会在两处各修一半。 */
function clampUnitEntityToMap(unit) {
  const mRaw = Math.max(40, unitArriveRadius(unit));      // ★ R9.6.4：余量 = 抵达半径（旧版 0.6×士兵铺开半径 = 53m）
  const m = (mRaw * 2 < MAP_W && mRaw * 2 < MAP_H) ? mRaw : 20;
  if (!isFinite(unit.x)) unit.x = MAP_W / 2;
  if (!isFinite(unit.y)) unit.y = MAP_H / 2;
  if (unit.x < m) unit.x = m; else if (unit.x > MAP_W - m) unit.x = MAP_W - m;
  if (unit.y < m) unit.y = m; else if (unit.y > MAP_H - m) unit.y = MAP_H - m;
}

/* ★ 实体运动：只朝朝向前进
   `isWaypoint = true` ⇒ 目标是**路线中间路点**：只转向、**绝不停车**（否则会在第一个路点停下，
   这正是"抵达判定那个圈"的另一半问题）；`false` ⇒ 终点，按停止半径/越过判定到位。 */
function moveUnitEntity(unit, target, dt, isWaypoint) {
  const dx = target.x - unit.x, dy = target.y - unit.y;
  const d = Math.hypot(dx, dy) || 1;
  /* ★ R9.6.4：抵达半径 = 单位占地（旧版用"士兵铺开半径 ×1.1"⇒ 240 人的排要停在 97m 外） */
  const stopR = unitArriveRadius(unit);
  let fx = Math.cos(unit.facing == null ? 0 : unit.facing);
  let fy = Math.sin(unit.facing == null ? 0 : unit.facing);
  /* ① 到位 / 已越过目标 ⇒ 停（"越过"这条专治"在终点附近绕圈"） */
  if (!isWaypoint && (d <= stopR || (d < stopR * 2.2 && (dx * fx + dy * fy) < 0))) {
    unit.stance = 'static';
    return false;
  }
  /* ② 转向：有限角速度；**首次出发直接对齐**（否则坦克要先原地转 3 秒才起步）。
     大角度（>100°）时转向速率给 1.8 倍，让"掉头"别拖太久。 */
  const wantF = Math.atan2(dy, dx);
  if (!unit._faceInit) { unit._faceInit = true; unit.facing = wantF; }
  else {
    const big = Math.abs(angleDiff(wantF, unit.facing)) > 1.75;
    unit.facing = navTurnToward(unit.facing, wantF, navTurnRateOf(unit) * (big ? 1.8 : 1) * dt);
  }
  fx = Math.cos(unit.facing); fy = Math.sin(unit.facing);
  /* ③ 速度：目标在侧后方 ⇒ 减速（把"掉头"做成小半径弧，而不是大回环） */
  const off = Math.abs(angleDiff(wantF, unit.facing));
  let spd = entitySpeedOf(unit) * paceMulOf(unit);
  if (off > 1.2) spd *= 0.35;
  else if (off > 0.6) spd *= 0.7;
  const step = Math.min(spd * dt, d);
  if (step <= 0) return false;
  /* ④ 前进：**只有前向分量**；被挡 ⇒ 在朝向 ±40° 内打方向再走，**永不横移** */
  const R = bodyRadiusOf(unit);
  let moved = false;
  const nx0 = unit.x + fx * step, ny0 = unit.y + fy * step;
  if (!isMoveBlockedAt(nx0, ny0, R) && !vehicleBlockedAt(unit, nx0, ny0, R)) { unit.x = nx0; unit.y = ny0; moved = true; }
  else {
    for (let i = 1; i <= 5 && !moved; i++) {
      for (const sgn of [1, -1]) {
        const a = unit.facing + sgn * (0.14 * i);      // ±8° ±16° ±24° ±32° ±40°
        const nx = unit.x + Math.cos(a) * step, ny = unit.y + Math.sin(a) * step;
        if (!isMoveBlockedAt(nx, ny, R) && !vehicleBlockedAt(unit, nx, ny, R)) { unit.x = nx; unit.y = ny; moved = true; break; }
      }
    }
  }
  if (moved) {
    /* ★ R9.6.1/2/3：边界余量按**编队半径**给（旧值固定 15m ⇒ 兵牌/成员会露到地图外）；
       余量必须小于半张地图，否则上下界会夹反（夹反时退回固定小余量）。实现见
       `clampUnitEntityToMap()` —— 单一实现，两个调用点共用。 */
    clampUnitEntityToMap(unit);
    unit.stance = 'moving';
  } else {
    /* 真过不去：本帧停（绕行点逻辑会接手）；顺便把"为什么停"记下来 */
    unit._holdMoveUntil = Math.max(unit._holdMoveUntil || 0, battle.time + 0.2);
  }
  return moved;
}

/* ★★★ R9.6.9：**步兵槽位不随朝向旋转**（玩家："别把步兵改成和汽车一样一同一个中心旋转，要改成以前那样"）
   ------------------------------------------------------------
   · 车辆是刚体 ⇒ 转向时槽位绕单位中心旋转本来就是**对的**（R7.6 起这么做）。
   · 步兵不是：整盘点阵绕单位中心甩过去（掉头 180° 时个别士兵要走 ≈2×编队半径 的弧）
     ⇒ 玩家看到的就是"步兵像车一样转圈"。旧版（存档 1.7.8 的 `placeSoldiers()`）是
     `s.x = unit.x + s.ox` —— **不旋转**，只有平移时整体跟队。
   ⚠ 摆放（placeMembersForUnit）与零均值纠正（recenterMembersOnUnit）**必须同口径**
     都走这个开关，否则质心 ≠ 实体 ⇒ 漂移会回来。 */
const SOLDIERS_ROTATE_WITH_FACING = false;

/* 成员按队形跟随（步兵槽位不旋转 / 车辆槽位随朝向旋转 + 平滑）—— 成员都不再"自己找路" */
function placeMembersForUnit(unit, dt) {
  if (!membersFollowFormation(unit)) return;
  const hx = Math.cos(unit.facing || 0), hy = Math.sin(unit.facing || 0);
  const k = 1 - Math.exp(-9 * dt);
  const sc = unitSlotCenter(unit);
  for (const s of unit.soldiers) {
    if (!s.alive || isSoldierAboard(s, unit)) continue;
    const ox = (s.ox || 0) - sc.x, oy = (s.oy || 0) - sc.y;
    const tx = SOLDIERS_ROTATE_WITH_FACING ? unit.x + (ox * hx - oy * hy) : unit.x + ox;
    const ty = SOLDIERS_ROTATE_WITH_FACING ? unit.y + (ox * hy + oy * hx) : unit.y + oy;
    s.x += (tx - s.x) * k;
    s.y += (ty - s.y) * k;
  }
  if (unit.vehicles && unit.vehicles.length) {
    const vsc = unitVehicleSlotCenter(unit);
    for (const v of unit.vehicles) {
      if (v.destroyed || v.abandoned) continue;
      if (!vehicleHasDriver(v, unit)) continue;
      const vox = (v.ox || 0) - vsc.x, voy = (v.oy || 0) - vsc.y;   // ★ R9.6.3：零均值槽位
      const tx = unit.x + (vox * hx - voy * hy), ty = unit.y + (vox * hy + voy * hx);
      if (pointInAnyBuilding(tx, ty)) continue;   // ★ R9.6.9：车不许摆进楼里（只有步兵能进建筑）
      v.x += (tx - v.x) * k;
      v.y += (ty - v.y) * k;
      v.facing = navTurnToward(v.facing == null ? unit.facing : v.facing, unit.facing,
                              navTurnRateOf(unit) * dt);
    }
  }
}

/* ★ R9.6.1：把成员夹回地图内 —— 旧路径里士兵/车辆各自夹边界，实体为准之后
   成员是"按队形摆"的 ⇒ 贴着地图边时会把成员摆到图外（玩家看到的"跑出地图"）。 */
function clampMembersToMap(unit) {
  for (const s of unit.soldiers) {
    if (!s.alive) continue;
    if (s.x < 10) s.x = 10; else if (s.x > MAP_W - 10) s.x = MAP_W - 10;
    if (s.y < 10) s.y = 10; else if (s.y > MAP_H - 10) s.y = MAP_H - 10;
  }
  for (const v of (unit.vehicles || [])) {
    if (v.destroyed) continue;
    if (v.x < 10) v.x = 10; else if (v.x > MAP_W - 10) v.x = MAP_W - 10;
    if (v.y < 10) v.y = 10; else if (v.y > MAP_H - 10) v.y = MAP_H - 10;
  }
}

/* ★★ 零均值化：把"分离/摆放造成的整体偏移"减回去 ⇒ **质心恒等于实体位置**
   —— 这才是"漂移 = 0"的数学保证：分离只在编队内部起作用，永远推不歪整个单位。
   （均值按"相对槽位的偏差"算 ⇒ 有伤亡时也不会把整个队形拽偏。） */
function recenterMembersOnUnit(unit) {
  if (!membersFollowFormation(unit)) return;
  const hx = Math.cos(unit.facing || 0), hy = Math.sin(unit.facing || 0);
  const sc = unitSlotCenter(unit);
  let sx = 0, sy = 0, n = 0;
  for (const s of unit.soldiers) {
    if (!s.alive || isSoldierAboard(s, unit)) continue;
    const ox = (s.ox || 0) - sc.x, oy = (s.oy || 0) - sc.y;
    /* ★ R9.6.9：与 `placeMembersForUnit` 同口径（步兵槽位不随朝向旋转） */
    const tx = SOLDIERS_ROTATE_WITH_FACING ? unit.x + (ox * hx - oy * hy) : unit.x + ox;
    const ty = SOLDIERS_ROTATE_WITH_FACING ? unit.y + (ox * hy + oy * hx) : unit.y + oy;
    sx += s.x - tx;
    sy += s.y - ty;
    n++;
  }
  if (n) {
    const dx = sx / n, dy = sy / n;
    if (Math.hypot(dx, dy) > 0.01) {
      for (const s of unit.soldiers) {
        if (!s.alive || isSoldierAboard(s, unit)) continue;
        s.x -= dx; s.y -= dy;
      }
    }
  }
  if (unit.vehicles && unit.vehicles.length) {
    let vx = 0, vy = 0, m = 0;
    const vsc = unitVehicleSlotCenter(unit);      // ★ R9.6.3：车辆槽位同样零均值（与 placeMembersForUnit 同口径）
    for (const v of unit.vehicles) {
      if (v.destroyed || v.abandoned || !vehicleHasDriver(v, unit)) continue;
      const vox = (v.ox || 0) - vsc.x, voy = (v.oy || 0) - vsc.y;
      vx += v.x - (unit.x + (vox * hx - voy * hy));
      vy += v.y - (unit.y + (vox * hy + voy * hx));
      m++;
    }
    if (m) {
      const dx = vx / m, dy = vy / m;
      if (Math.hypot(dx, dy) > 0.01) {
        for (const v of unit.vehicles) {
          if (v.destroyed || v.abandoned || !vehicleHasDriver(v, unit)) continue;
          v.x -= dx; v.y -= dy;
        }
      }
    }
  }
}

/* ★ R8：寻路层已整体删除（A* / 路网 / 车道 / 路线缓存 / 命令指纹 / 命令级承诺 全部移除）。
   单位移动 = 「朝目标点直线走 + 被挡/拥挤时找绕行点」（见 mover 的 8.1~8.3），
   下一阶段将换成「无状态共享代价场服务」（见 待办TODO.md 的 R8 章节）。 */
/* ★★ R3 车队：编队速度 = 最慢车（治"掉队发散"）+ 拉开太多就减速收拢
   —— 数学上：每辆车各按自己的地形倍率走时，落后那辆**永远追不上**（间距单调发散，
      实测能从几十米拉到 800m 直到整排弃车）。整列同速后间距有界 ✓ */
const COLUMN_REFORM_GAP = 55;     // 掉队超过这个距离 ⇒ 整列减慢
const COLUMN_MAX_GAP = 90;        // 掉队超过这个距离 ⇒ 整列大幅减速收拢

function fleetSpeedFactor(unit) {
  const vMob = unit.mobilityTypeMounted || unit.mobilityType || 'tracked';
  let minMul = 1.3, maxGap = 0;
  for (const v of unit.vehicles) {
    if (v.destroyed || v.abandoned) continue;
    const mul = terrainMobilityMulFor(vMob, getTerrainAt(v.x, v.y));
    if (mul < minMul) minMul = mul;
    const gap = Math.hypot(v.x - unit.x, v.y - unit.y);
    if (gap > maxGap) maxGap = gap;
  }
  let f = Math.max(0.15, Math.min(1.3, minMul));
  if (maxGap > COLUMN_MAX_GAP) f *= 0.35;
  else if (maxGap > COLUMN_REFORM_GAP) f *= 0.7;
  return f;
}
function farthestVehicle(unit) {
  let far = null, fd = -1;
  for (const v of unit.vehicles) {
    if (v.destroyed || v.abandoned) continue;
    const d = Math.hypot(v.x - unit.x, v.y - unit.y);
    if (d > fd) { fd = d; far = v; }
  }
  return far;
}
/* ★ 只弃「那一辆」：一辆车卡住不该让整排下车（旧版是整排弃车） */
function abandonOneVehicle(unit, v) {
  if (!v || v.abandoned) return;
  v.abandoned = true;
  for (const s of (v.crew || [])) { s.vehicle = null; s.onFoot = true; }
  for (const s of (v.passengers || [])) { s.vehicle = null; s.onFoot = true; }
  v.crew = []; v.passengers = [];
  const left = (unit.vehicles || []).filter(x => !x.destroyed && !x.abandoned);
  if (!left.length) abandonVehicles(unit);
}

/* 点到折线的最近投影 ⇒ { idx, t, d, x, y }（idx = 段起点索引） */
function projectOnPolyline(pts, px, py) {
  let best = { idx: 0, t: 0, d: Infinity, x: pts[0].x, y: pts[0].y };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    let t = (L2 > 0.01) ? ((px - a.x) * dx + (py - a.y) * dy) / L2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const qx = a.x + dx * t, qy = a.y + dy * t;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best.d) best = { idx: i - 1, t, d, x: qx, y: qy };
  }
  return best;
}
function polylineLen(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return n;
}
/* 切出折线上 a→b 之间的一段（含两端投影点；方向自动按 a→b） */
function polylineSlice(pts, a, b) {
  const out = [];
  const fwd = (a.idx < b.idx) || (a.idx === b.idx && a.t <= b.t);
  const A = fwd ? a : b, B = fwd ? b : a;
  out.push({ x: A.x, y: A.y });
  for (let i = A.idx + 1; i <= B.idx; i++) out.push({ x: pts[i].x, y: pts[i].y });
  out.push({ x: B.x, y: B.y });
  if (!fwd) out.reverse();
  return out;
}

/* 某点上的实际移动倍率（与运行时/烘焙同表）
   ★ R9.6.6：必须传**地形瓦片**（带 id）—— `getTerrainAt()` 现在也带 id 了，但这里保持
   直接取瓦片，避免再被"少一个字段"坑一次。 */
function mulAtPoint(x, y, mob) {
  return Math.max(0.05, terrainMobilityMulFor(mob, getGridTerrain(battle.gridMap, x, y)));
}
/* 沿折线走的**时间**（当量：米 ÷ 倍率）—— 每段取中点地形采样，够准且便宜 */
function polylineTime(pts, mob) {
  let t = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1) continue;
    t += L / mulAtPoint((a.x + b.x) / 2, (a.y + b.y) / 2, mob);
  }
  return t;
}

/* ============================================================
   ★★★ R9.6.6：**选路要代入"地形数值 × 单位数值"**
   ------------------------------------------------------------
   玩家定案："把地形的数值和单位的数值代入进去就可以了"。
   两张表一直都在（`TERRAIN_SPEED_TABLE` + `mobilityType/speed*`），但选路只看几何距离 ⇒
   轮式会往森林里钻、步兵白绕公路、长途明明直线更快还沿路走。
   规则（与运行时**同源**：`mobilityMulForTile`）：
       腿的代价 = 米 ÷ (单位速度 × 地形倍率)     倍率 0（开不进去）⇒ ∞ ⇒ 这条腿作废
   ============================================================ */
/* 本命令周期里这个单位"以什么身份、多快"走路 —— 与 `updateRideMode` 同一份事实，不新增判据
   ★ R9.6.7：**带目标点时会自动"车 / 步"二选一**：
     玩家实测"步兵（编制里有车）在城区/树林里被判不可通行" —— 那是拿**卡车**的机动类型去判地形
     （轮式在城区/树林 = 0）。步兵当然应该**下车走**：
       · 车过不去这条腿 ⇒ 用徒步档案（下车走过去）
       · 都能过 ⇒ 谁快用谁（车在公路上快、在城区里不如徒步）
     不传目标点（只给面板看）⇒ 维持"能坐车就按坐车"的展示口径。 */
function unitFootProfile(unit) {
  return { ride: false,
           mob: unit.mobilityTypeFoot || 'foot',
           speed: Math.max(0.5, unit.speedFoot || unit.speed || 5) };
}
function unitPlanProfile(unit, toX, toY) {
  const canRide = (typeof unitCanRide === 'function') ? unitCanRide(unit) : false;
  const ct = (unit._command && unit._command.type) || '';
  const combat = (ct === 'ATTACK' || ct === 'APPROACH' || ct === 'TAKE_COVER');
  const rideProf = (canRide && !combat && !unit.suppressed)
    ? { ride: true,
        mob: unit.mobilityTypeMounted || unit.mobilityType || 'tracked',
        speed: Math.max(0.5, unit.speedMounted || unit.speed || 5) }
    : null;
  const footProf = unitFootProfile(unit);
  if (!rideProf) return footProf;
  if (toX == null || toY == null) return rideProf;       // 只给面板看 ⇒ 按"能坐车就坐车"
  const tm = legTime(unit, { x: unit.x, y: unit.y }, { x: toX, y: toY }, rideProf);
  if (!isFinite(tm)) return footProf;                    // ★ 车过不去 ⇒ 下车走
  const tf = legTime(unit, { x: unit.x, y: unit.y }, { x: toX, y: toY }, footProf);
  if (!isFinite(tf)) return rideProf;
  return (tm <= tf) ? rideProf : footProf;               // 都能过 ⇒ 谁快用谁
}
/* 一段直腿的时间（秒）；**不可通行 ⇒ Infinity**。每 25m 采样一次（跨地形边界够细，且只在
   下达命令时算一次 ⇒ 代价可接受） */
function legTime(unit, a, b, prof) {
  const p = prof || unitPlanProfile(unit);
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1) return 0;
  const gm = battle.gridMap;
  if (!gm) return L / p.speed;
  const n = Math.max(1, Math.ceil(L / 25));
  const seg = L / n;                                 // ★ 每段中点采样 ⇒ Σ(seg) 正好等于 L（不留采样偏差）
  let t = 0;
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    const px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k;
    /* ★ R9.6.9：**乘车档案遇到建筑 = 这条腿作废**（"只有步兵可以进入建筑"）
       —— 与运行时 `vehicleBlockedAt()` 同判据 ⇒ 规划层与执行层不会打架：
          · 纯装甲/轮式单位 ⇒ 目标在楼里 ⇒ 命令被拒（不会再"开到楼前站住"）
          · 摩托化步兵 ⇒ 乘车档案 = ∞ ⇒ 自动退回徒步档案（下车进楼） */
    if (p.ride && pointInAnyBuilding(px, py)) return Infinity;
    const mul = mobilityMulForTile(p.mob,
      getGridTerrain(gm, px, py));
    if (!(mul > 0)) return Infinity;                 // 开不进去 ⇒ 这条腿作废
    t += seg / (p.speed * mul);
  }
  return t;
}
/* 折线的时间（秒）；任一点不可通行 ⇒ Infinity */
function pathTime(unit, pts, prof) {
  const p = prof || unitPlanProfile(unit);
  let t = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = legTime(unit, pts[i - 1], pts[i], p);
    if (!isFinite(d)) return Infinity;
    t += d;
  }
  return t;
}
/* ★ 普通「移动」的通行体检：**用单位自己的机动类型**判地形（旧版 `isStraightPathClear`
   只问"地形能不能过"，于是轮式被放行、开进森林就原地打滑 ⇒ 玩家看到的"永久卡住"）
   ★ R9.6.7：档案带上目标点 ⇒ 步兵（有车也）会退回徒步档案判 ⇒ **城区/树林不再被误判不可通行**。 */
function isStraightPathClearFor(unit, x, y) {
  if (!isStraightPathClear(unit.x, unit.y, x, y, 25)) return false;
  return isFinite(legTime(unit, { x: unit.x, y: unit.y }, { x, y }, unitPlanProfile(unit, x, y)));
}
/* 预计用时的中文（给命令 note / 面板用） */
function fmtEta(sec) {
  if (!isFinite(sec)) return '—';
  if (sec < 90) return Math.round(sec) + ' 秒';
  const m = sec / 60;
  if (m < 60) return (Math.round(m * 10) / 10) + ' 分钟';
  return (Math.round(m / 6) / 10) + ' 小时';
}



/* ============================================================
   ★★★ R7.5：机动身份 = **命令级**决定（不是帧级、也不是定时）
   ------------------------------------------------------------
   用户规格（原话）："AI 就像有一个不存在的玩家在操作他们，发出一个命令之后，
   在下一个命令没有到来之前就不会改变。" ⇒ 于是：
     · 身份（乘车 / 徒步）在**命令发出时**定一次（`force` = 本帧命令变更）
     · 命令期内不再重估 ⇒ `mobilityType` 不再来回翻 ⇒ 路线也不会被"身份变化"重算
     · 判据全部集中在这一处，别处只读：`_rideMode`（路线级意图）/ `_rideWant`（执行） */
function updateRideMode(unit, goalX, goalY, force) {
  /* ① 硬条件：没车 / 已弃车 ⇒ 徒步 */
  if (!unit.vehicles || !unit.vehicles.length || unit._vehiclesAbandoned) {
    unit._rideMode = 'foot';
    unit._ridePlanOk = false;
    unit._rideWant = false;
    unit._rideReason = '没车/弃车';
    return false;
  }
  /* ★★★ R9.6.7：**命令级的"乘车还是徒步"优先** —— 下令时已经按"地形数值 × 单位数值"算过
     （`ord.planRide`）。不照它的话，"步兵下车进城区/树林"会被执行层又拉回车上，
     而车在城区/树林的倍率是 0 ⇒ 玩家看到的又是"原地打滑 / 永久卡住"。 */
  const liveOrd = (typeof groupOrderOf === 'function') ? groupOrderOf(unit) : null;
  if (liveOrd && liveOrd.planRide === false) {
    unit._rideMode = 'foot';
    unit._ridePlanOk = true;
    unit._rideWant = false;
    unit._rideReason = '命令规划=徒步（车走不过去）';
    return false;
  }
  /* ② 命令是"战斗类"（接敌 / 接近 / 躲掩体）⇒ 徒步打（= 接敌就下车） */
  const ct = (unit._command && unit._command.type) || '';
  if (ct === 'ATTACK' || ct === 'APPROACH' || ct === 'TAKE_COVER') {
    unit._rideMode = 'foot'; unit._ridePlanOk = false; unit._rideWant = false;
    unit._rideReason = '战斗命令(' + ct + ')';
    return false;
  }
  /* ③ R8：寻路层已删 ⇒ 不再有"算车辆能不能开到目标"这一步（那需要路线规划）。
     现在的规则：有车就乘车；能不能过去交给执行层（地形倍率 0 = 开不动）。 */
  unit._ridePlanOk = true;
  unit._rideMode = 'ride';
  /* ⑤ 执行层：身份已经"定下来"了，这里只判**此刻能不能在车上**（车在附近 / 座位够 / 未压制）
     注：这里**不再改动 `_rideMode`** —— 车没跟上不再把身份改成徒步（那正是"上下车循环"的来源），
         而是"等车追上来"（车按 mounted 速度跟随，本来就会追上）。 */
  const near = vehicleNearUnit(unit, unit.mounted ? VEHICLE_STAY_MOUNTED_GAP : VEHICLE_NEAR_RADIUS);
  let rreason = '可乘车';
  if (unit._rideMode !== 'ride') rreason = '命令级身份=徒步';
  else if (!unitCanRide(unit)) rreason = '座位不够';
  else if (unit.suppressed) rreason = '被压制';
  else if (!near) {
    rreason = '车没跟上（等它追）';
    /* 只有"甩得太远且长期追不上"才弃车（硬事件，之后本场永久徒步） */
    const gap = unit._vehicleMaxDist || 0;
    if (gap > VEHICLE_ABANDON_GAP) {
      if (!unit._rideBlockedSince) unit._rideBlockedSince = battle.time;
      if (battle.time - unit._rideBlockedSince > VEHICLE_ABANDON_TIME) {
        const far = farthestVehicle(unit);
        if (far) abandonOneVehicle(unit, far); else abandonVehicles(unit);
        unit._rideBlockedSince = 0;
        unit._rideReason = '弃车';
      }
    } else {
      unit._rideBlockedSince = 0;
    }
  } else {
    unit._rideBlockedSince = 0;
  }
  /* ⑥ 唯一出口：本帧"要不要在车上"
     —— 未上车时要车在附近（避免"吸附瞬移"）；**已上车就不再因为车距被赶下车** */
  unit._rideWant = (unit._rideMode === 'ride') && !unit.suppressed &&
                   (!!unit.mounted || near);
  unit._rideReason = rreason;               // ★ 取证：本帧结论的原因（只读，不影响行为）
  return unit._rideWant;
}




/* ============================================================
   驻守建筑（红警式）：进楼拿掩体 + 按容量限人 + 单位专属
   —— 建筑数据早就齐了（hp/状态/外观/掩体/容量），差的就是"AI 会进去"这一步
   ============================================================ */
const GARRISON_CAPACITY_EQUIV = { '班': 10, '排': 30, '连': 100, '营': 400 };

/* 这栋楼能容纳多少士兵（容量按 capacityUnit 计） */
function garrisonCapacityOf(b) {
  const cap = getBuildingCapacity(b);
  if (!cap) return 0;
  const def = BUILDING_TYPES[b.type];
  const per = (def && GARRISON_CAPACITY_EQUIV[def.capacityUnit]) || 30;
  return cap * per;
}

function aliveSoldiersOf(unit) {
  let n = 0;
  for (const s of unit.soldiers) if (s.alive) n++;
  return n;
}

/* 每帧一次的驻守占用表：{ 建筑索引: 已占用士兵数 }
   （单位"预约"了但还没走到也算占用，避免一窝蜂往同一栋楼挤） */
function refreshGarrisonTable() {
  const gm = battle.gridMap;
  if (!gm || !gm.buildings || !gm.buildings.length) return {};
  if (battle._garrisonTime === battle.time && battle._garrisonTable) return battle._garrisonTable;
  const table = {};
  for (const u of battle.units) {
    if (!u.alive) { u._garrisonIdx = null; continue; }
    const idx = u._garrisonIdx;
    if (idx === null || idx === undefined) continue;
    const b = gm.buildings[idx];
    if (!b || getBuildingState(b) === 'collapsed') { u._garrisonIdx = null; continue; }
    const inside = isPointInBuilding(b, u.x, u.y);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const far = Math.hypot(cx - u.x, cy - u.y) > Math.max(b.w, b.h) * 1.5;
    if (!inside && far) { u._garrisonIdx = null; continue; }     // 早就走开了 → 释放
    table[idx] = (table[idx] || 0) + aliveSoldiersOf(u);
  }
  battle._garrisonTime = battle.time;
  battle._garrisonTable = table;
  return table;
}

/* 找一栋能驻守的楼：未塌 + 装得下 + 走得到（碉堡优先、就近优先） */
function findGarrisonBuilding(unit, maxDist) {
  const gm = battle.gridMap;
  if (!gm || !gm.buildings || !gm.buildings.length) return null;
  const alive = aliveSoldiersOf(unit);
  if (alive <= 0) return null;
  const table = refreshGarrisonTable();
  let best = null, bestScore = Infinity, bestIdx = -1;
  for (let i = 0; i < gm.buildings.length; i++) {
    const b = gm.buildings[i];
    if (getBuildingState(b) === 'collapsed') continue;
    const cap = garrisonCapacityOf(b);
    if (cap <= 0) continue;
    const mine = (unit._garrisonIdx === i);
    if (!mine) {
      const used = table[i] || 0;
      if (used + Math.min(alive, 8) > cap) continue;            // 装不下就算了
    }
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const d = Math.hypot(cx - unit.x, cy - unit.y);
    if (d > maxDist) continue;
    if (isPathBlocked(unit.x, unit.y, cx, cy, bodyRadiusOf(unit), 40)) continue;
    let score = d;
    if (mine) score *= 0.3;
    if (b.type === 'bunker') score *= 0.5;
    if (score < bestScore) { bestScore = score; best = b; bestIdx = i; }
  }
  if (!best) return null;
  return { b: best, idx: bestIdx };
}

/* 该单位此刻是否在楼里（且楼没塌） */
function unitIsGarrisoned(unit) {
  const gm = battle.gridMap;
  if (!gm || !gm.buildings || !gm.buildings.length) return false;
  const idx = unit._garrisonIdx;
  if (idx === null || idx === undefined) return false;
  const b = gm.buildings[idx];
  if (!b || getBuildingState(b) === 'collapsed') return false;
  return isPointInBuilding(b, unit.x, unit.y);
}

/* 该不该往楼里钻；返回移动目标（null = 不需要/不适用） */
function maybeGarrisonMove(unit, target) {
  const gm = battle.gridMap;
  if (!gm || !gm.buildings || !gm.buildings.length) return null;
  /* ★ R9.6.11：玩家刚让它离开建筑 ⇒ 15 秒内不许再钻楼
     （否则"迈出楼门一步就被 `maybeGarrisonMove` 拽回去" = 玩家说的"出不来"） */
  if (battle.time < (unit._noGarrisonUntil || 0)) return null;
  if (unit.isArtilleryUnit) return null;                       // 炮兵不钻楼
  if (unit.mounted) return null;                               // 乘车时不钻楼

  const noCover = getCoverAt(unit.x, unit.y) < 0.3;
  const enemyNear = (target && target.alive)
    ? Math.hypot(target.x - unit.x, target.y - unit.y)
    : Infinity;
  // ★ 与走位同一条判据：敌人已经进入"我能打到"的距离 且 自己暴露在开阔地 → 钻楼
  //   （旧条件用 unit.range（含最远武器）⇒ 敌人还在 1.2km 外就整体后撤进房）
  const tgG = getTerrainAt(unit.x, unit.y);
  const engaged = (target && target.alive) && canEngage(unit, target, enemyNear, tgG.rangeMul);
  const need = unit.suppressed || (noCover && engaged);
  if (!need) return null;
  if (battle.time < (unit._garrisonSearchAt || 0)) return null;

  const found = findGarrisonBuilding(unit, 450);
  if (!found) { unit._garrisonSearchAt = battle.time + 4; return null; }

  const b = found.b;
  unit._garrisonIdx = found.idx;                                // 预约（占用表会算进去）
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const d = Math.hypot(cx - unit.x, cy - unit.y);
  if (d < Math.max(b.w, b.h) * 0.55) return null;               // 已经进楼了 → 停下
  return { x: cx, y: cy, garrison: true };
}

/* ============================================================
   视野系统
   ============================================================ */
const BASE_VIEW_RANGE = 1000;         // ★ 平地基准视距（用户调整：3000 → 1000m）
const VIEW_FIRE_EXPOSE_TIME = 3;      // 开火后这段时间内"藏不住"
const VIEW_MOVE_EXPOSE = 0.5;         // 移动中的暴露系数（越小越暴露）
const SEEN_MEMORY_KEEP = 3;           // 视野记忆保留时长
const SEEN_MEMORY_STALE = 2;          // 失去接触后仍算"已知"的时长
const LOS_BLOCKED_AT = 1.0;           // 累计遮挡达到该值即完全遮挡
/* 隐蔽对"发现距离"的折减（线性：躲树林 = 40% 视距） */
const CONCEAL_MAX_EFFECT = 1.0;
/* 近距离保底：★ 这是绝对距离（不随视距缩水），否则视距调小后"贴脸还打不起来"。
   原来写的是"12% 视距（开阔地约 360m）"，基准降到 1000m 后 12% 只剩 120m，太贴脸了 */
const MIN_DISCOVER_FRACTION = 0.12;
const MIN_DISCOVER_ABS = 150;         // 绝对保底：150m 内必被发现（城区/树林/全隐蔽也适用）

/* 建筑：隐蔽度 / 观察视距倍率 */
const BUILDING_CONCEAL  = { cottage:0.80, midrise:0.85, highrise:0.85, tower:0.85, bunker:0.95 };
const BUILDING_SPOT_MOD = { cottage:0.35, midrise:0.28, highrise:0.25, tower:0.25, bunker:0.50 };

/* 观察视距：站在哪（地形 spotMod / 建筑物内）决定看得多远 */
function computeViewRange(unit) {
  let range = BASE_VIEW_RANGE;
  if (battle.gridMap) {
    const b = getUnitBuilding(unit, battle.gridMap);
    if (b) {
      range *= (BUILDING_SPOT_MOD[b.type] || 0.5);
    } else {
      const t = getGridTerrain(battle.gridMap, unit.x, unit.y);
      range *= (typeof t.spotMod === 'number') ? t.spotMod : 1;
    }
  }
  if ((unit.armor || 0) > 0) range *= 1.3;
  if (unit.suppressed) range *= 0.8;
  return range;
}

/* 暴露系数：0 = 完全暴露（藏不住），1 = 静止且没开火（可藏） */
function unitExposure(unit) {
  if (battle.time - (unit.lastFiredTime || -999) < VIEW_FIRE_EXPOSE_TIME) return 0;
  if (unit.stance === 'moving') return VIEW_MOVE_EXPOSE;
  return 1;
}

/* 目标隐蔽度（0~1）：地形 + 建筑 + 被压制时趴得更低 */
function unitConcealment(unit) {
  let c = 0;
  if (battle.gridMap) {
    const t = getGridTerrain(battle.gridMap, unit.x, unit.y);
    c = t.conceal || 0;
    const b = getUnitBuilding(unit, battle.gridMap);
    if (b) c = Math.max(c, BUILDING_CONCEAL[b.type] || 0.8);
  }
  if (unit.suppressed) c = Math.min(1, c + 0.15);
  return Math.min(1, c);
}

function pointIsBlocking(x, y) {
  if (!battle.gridMap) return false;
  return !!getGridTerrain(battle.gridMap, x, y).blocksMove;
}

/* 线段与 AABB 是否相交（Liang–Barsky）—— 建筑遮挡视线用 */
function segmentIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else          { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}

/* ★ 视线累计遮挡点数（无等高线版）
   ── 注意：sightBlock 的语义是"每 100m 该地形的拦截值"（树林 0.5/100m、城区 0.7/100m、
      山丘 1.0/100m）。格子只有 5m，所以必须按 cellSize 折算，否则"两格树林就全黑"。
   - 沿"格边界超跳"(DDA) 只遍历真正穿过的格，起点格 / 终点格不计
   - 建筑对象与视线相交：完好 +1.0 / 坍塌 +0.5
   返回 >= LOS_BLOCKED_AT 即完全遮挡 */
const SIGHT_BLOCK_UNIT = 100;   // sightBlock 的计量长度（米）
const LOS_SAMPLE_STEP = 25;     // 视线采样步长（米）

function losBlockPoints(fx, fy, tx, ty) {
  const gm = battle.gridMap;
  if (!gm) return 0;
  ensureComposedGrid(gm);
  let sum = 0;

  /* 建筑遮挡（起点/终点在该楼内则跳过该楼） */
  if (gm.buildings && gm.buildings.length) {
    for (const b of gm.buildings) {
      if (isPointInBuilding(b, fx, fy) || isPointInBuilding(b, tx, ty)) continue;
      if (!segmentIntersectsRect(fx, fy, tx, ty, b.x, b.y, b.w, b.h)) continue;
      sum += (getBuildingState(b) === 'collapsed') ? 0.5 : 1.0;
      if (sum >= LOS_BLOCKED_AT) return sum;
    }
  }

  /* 地形格：★ 按固定步长采样（3km 视距下逐格 DDA 太贵；25m 步长精度足够） */
  const cs = gm.cellSize;
  const GW = gm.gw, GH = gm.gh, grid = gm._composedGrid;
  const dx = tx - fx, dy = ty - fy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return sum;
  const steps = Math.ceil(dist / LOS_SAMPLE_STEP);
  const per = (dist / steps) / SIGHT_BLOCK_UNIT;      // 每个采样点代表多少"100m 份额"
  for (let i = 1; i < steps; i++) {                   // 起点 / 终点不参与
    const t = i / steps;
    const gx = Math.floor((fx + dx * t) / cs);
    const gy = Math.floor((fy + dy * t) / cs);
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
    const tt = GRID_PALETTE[grid[gy * GW + gx]];
    if (tt && tt.sightBlock) {
      sum += tt.sightBlock * per;
      if (sum >= LOS_BLOCKED_AT) return sum;
    }
  }
  return sum;
}

/* 通视（累计遮挡 < 1 即通视） */
/* ============================================================
   体积碰撞（带半径）
   —— 以前只查"一个点"，所以会半个身子插进墙；也正因为点判定太脆，
      才有"卡住 1.5 秒就变幽灵穿墙"的兜底。这里改成带半径判定。
   ============================================================ */
const SOLDIER_BODY_RADIUS = 2;    // 士兵体积半径（米）：3m 太肥，老地图 5m 宽的墙缝会过不去
const VEHICLE_BODY_RADIUS = 4;    // 车辆默认体积半径（米）

/* 圆心 + 4 个正方向是否压到不可通行格 */
function isMoveBlockedAt(x, y, radius) {
  const gm = battle.gridMap;
  if (!gm) return false;
  if (radius <= 0) return pointIsBlocking(x, y);
  if (pointIsBlocking(x, y)) return true;
  if (pointIsBlocking(x + radius, y) || pointIsBlocking(x - radius, y)) return true;
  if (pointIsBlocking(x, y + radius) || pointIsBlocking(x, y - radius)) return true;
  return false;
}

/* ★★★ R9.6.9：**建筑对车辆硬阻断**（玩家："只有步兵可以进入建筑"）
   ------------------------------------------------------------
   建筑是**对象**（AABB），不是地形格 ⇒ 旧代码里车辆会直接开进楼体（"坦克藏进房子"）。
   规则：· 步兵（含已下车的摩托化步兵）**随便进**；
         · 车辆本体 / 乘车状态的单位实体 **不得进入楼体**；
         · 已经卡在楼里（异常/被挤进去）⇒ **放行**，允许自己开出来（绝不永久卡死）。 */
function pointInAnyBuilding(x, y) {
  const gm = battle.gridMap;
  if (!gm || !gm.buildings || !gm.buildings.length) return false;
  for (let i = gm.buildings.length - 1; i >= 0; i--) {
    const b = gm.buildings[i];
    if (getBuildingState(b) === 'collapsed') continue;
    if (isPointInBuilding(b, x, y)) return true;
  }
  return false;
}
function circleInAnyBuilding(x, y, radius) {
  if (pointInAnyBuilding(x, y)) return true;
  if (radius > 0) {
    if (pointInAnyBuilding(x + radius, y) || pointInAnyBuilding(x - radius, y)) return true;
    if (pointInAnyBuilding(x, y + radius) || pointInAnyBuilding(x, y - radius)) return true;
  }
  return false;
}
/* 此刻是否"在车上"（车在动 ⇒ 要避让楼体；步兵下车后随便进楼） */
function unitRidesNow(unit) {
  return !!(unit && unit.mounted && unit.vehicles && unit.vehicles.length);
}
/* 乘车单位能不能走到 (x,y)：楼体硬阻断（步兵恒放行） */
function vehicleBlockedAt(unit, x, y, radius) {
  if (!unitRidesNow(unit)) return false;
  if (circleInAnyBuilding(unit.x, unit.y, 0)) return false;   // 已在楼里 ⇒ 允许脱困
  return circleInAnyBuilding(x, y, radius);
}

/* 带半径的直线路径检查（step 可放宽做"粗查"，避免太贵） */
function isPathBlocked(x1, y1, x2, y2, radius, step) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return isMoveBlockedAt(x2, y2, radius);
  const st = step || Math.max(8, radius);
  const steps = Math.max(1, Math.ceil(dist / st));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (isMoveBlockedAt(x1 + dx * t, y1 + dy * t, radius)) return true;
  }
  return false;
}

/* 车辆能不能在这种地形里开（树林/城区/战壕/河流 ⇒ 开不进去，步兵只能下车走） */
function terrainAllowsVehicles(x, y) {
  const gm = battle.gridMap;
  if (!gm) return true;
  const t = getGridTerrain(gm, x, y);
  if (t.blocksMove) return false;
  return (typeof t.speedMul === 'number' ? t.speedMul : 1) >= 0.7;
}

/* 单位的"体积半径"（有车就按车算） */
function bodyRadiusOf(unit) {
  if (unit.vehicles && unit.vehicles.length) return VEHICLE_BODY_RADIUS;
  return SOLDIER_BODY_RADIUS;
}

/* ★★★ R9.6.4：**抵达半径 = 单位的"占地"**（不是"士兵铺开多远"）
   ------------------------------------------------------------
   旧版抵达半径 = `_formationRadius × 1.1`（= 士兵槽位的最远半径）。而士兵槽位是
   "按人数铺开的松散队形"：240 人的排展开半径 ≈ 88m ⇒ **抵达半径 ≈ 97m**
   （玩家实测原话："现在直接在距离 97m 的地方就停下来了"），选中圈也跟着变成一个大黄圈。
   "到没到"应该只看**单位实体**有没有到点，与"兵撒得多开"无关 ⇒ 改用编制 footprint。
   （footprint：排 100 / 分队 80 / 班 50 / 火力组 25 ⇒ 抵达半径 40 / 32 / 20 / 18，带车 ×1.1） */
const ARRIVE_R_MIN = 18, ARRIVE_R_MAX = 45;
function unitArriveRadius(unit) {
  const fp = (unit && ECHELON_FOOTPRINT[unit.echelon]) || 100;
  const r = fp * 0.4 * ((unit && unit.vehicles && unit.vehicles.length) ? 1.1 : 1);
  return Math.max(ARRIVE_R_MIN, Math.min(ARRIVE_R_MAX, r));
}

/* 点到线段的最短距离 */
function pointSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/* 单位的"私人空间"半径（只用于绕行，不是硬碰撞） */
function unitSpaceRadius(u) {
  const base = (u.vehicles && u.vehicles.length) ? 45 : 30;
  return base * (u.stance === 'moving' ? 0.85 : 1);
}

/* ★ 路径是否贴着"站着不动的单位"
   —— 以前避障只认地形，完全不认单位；于是炮兵一架好就钉死，
      后面的步兵推不动也绕不过去，只能堵在屁股后面。 */
function isPathCrowded(mover, x1, y1, x2, y2) {
  const myR = (mover.vehicles && mover.vehicles.length) ? 15 : 10;
  const segLen = Math.hypot(x2 - x1, y2 - y1);
  for (const o of battle.units) {
    if (o === mover || !o.alive) continue;
    if (o.stance === 'moving') continue;            // 都在动 → 交给分离力
    const r = unitSpaceRadius(o) + myR;
    if (Math.hypot(o.x - x1, o.y - y1) > r + segLen) continue;   // 粗筛
    if (pointSegDist(o.x, o.y, x1, y1, x2, y2) < r) return true;
  }
  return false;
}


/* 卡死兜底：朝"当前朝向 ±60°"挪 3~8m，且必须确实往前；每 8 秒最多一次。
   —— 旧版从 angle=0（+X，正右）螺旋找点 ⇒ 表现就是"每秒向右瞬移 10m"，必须去掉。 */
function unstickUnit(unit, radius, targetX, targetY) {
  // ★ 已停用：任何"把整个单位挪一截"的做法在画面上都是"瞬移"
  //   （玩家报告：红方朝下、蓝方朝上每几秒瞬移 5m —— 就是这里沿 facing 位移造成的）
  //   现在改由「_holdMoveUntil 放弃本次移动 + 重新算流场路径」处理。
  return false;
  // eslint-disable-next-line no-unreachable
  if (battle.time < (unit._lastUnstickAt || -9999) + 8) return false;
  const r0 = radius || SOLDIER_BODY_RADIUS;
  let dx = (targetX === undefined) ? Math.cos(unit.facing || 0) : (targetX - unit.x);
  let dy = (targetY === undefined) ? Math.sin(unit.facing || 0) : (targetY - unit.y);
  if (!isFinite(dx) || !isFinite(dy) || (dx === 0 && dy === 0)) {
    dx = Math.cos(unit.facing || 0);
    dy = Math.sin(unit.facing || 0);
  }
  const baseAng = Math.atan2(dy, dx);
  const curDist = Math.hypot(dx, dy);
  const mustApproach = (targetX !== undefined && targetY !== undefined);
  for (let r = 3; r <= 8; r += 2.5) {
    for (let k = -3; k <= 3; k++) {                       // ±60°，每 20°
      const a = baseAng + k * (Math.PI / 9);
      const nx = unit.x + Math.cos(a) * r;
      const ny = unit.y + Math.sin(a) * r;
      if (nx < 20 || nx > MAP_W - 20 || ny < 20 || ny > MAP_H - 20) continue;
      if (isMoveBlockedAt(nx, ny, r0)) continue;
      if (mustApproach) {
        const newDist = Math.hypot(targetX - nx, targetY - ny);
        if (newDist > curDist - r * 0.5) continue;        // 必须真的更接近目标
      }
      const mx = nx - unit.x, my = ny - unit.y;
      for (const s of unit.soldiers) if (s.alive) { s.x += mx; s.y += my; }
      for (const v of (unit.vehicles || [])) if (!v.destroyed) { v.x += mx; v.y += my; }
      unit.x = nx; unit.y = ny;
      unit.lastPosX = nx; unit.lastPosY = ny;
      unit._lastUnstickAt = battle.time;
      return true;
    }
  }
  return false;
}

/* ============================================================
   ★ 视野显示（isovist）：视距圆 + 半透明可见区，被挡方向挖成透明
   —— 玩家要求："正常是一个圈，圆的底色半透明，被遮挡看不见的地方全透明"
   ============================================================ */
let visionOverlay = false;              // L 键开关
const VISION_RAY_COUNT = 180;           // 每 2° 一条射线
const VISION_MAX_STEPS = 60;            // 每条射线最多采样多少点
const VISION_RECOMPUTE_SEC = 0.35;      // 每个单位的视野多边形重算间隔
const VISION_GRID_TTL = 5;              // 视线网格（含建筑）重建周期（秒）
const VISION_BLD_BLOCK = 5.0;           // 建筑在视线网格里的"每 100m 遮挡值"（穿透 ~20m 即全挡）

/* 视线网格：把地形 sightBlock 与【建筑栅格化】烘成与地图格同分辨率的两张表
   - terr[i] = 地形每 100m 遮挡值（树林 0.5 / 城区 0.7 / 山丘 0 …）
   - bld[i]  = 1+建筑下标（0 = 无建筑）—— 用于"跳过观察者自己所在的楼"
   建筑额外外扩 1.5 格：避免射线采样步长（十几米）"一步跨过"一栋 20m 的小楼 */
function buildSightGrid(gm) {
  if (!gm) return null;
  const need = gm.gw * gm.gh;
  if (gm._sightGrid && gm._sightGrid.n === need &&
      battle.time - (gm._sightGridAt || -999) < VISION_GRID_TTL) {
    return gm._sightGrid;
  }
  ensureComposedGrid(gm);
  /* 地形层：只在"地图合成结果变了"时重算（3.6M 格的大图每 5 秒全扫一遍太浪费）
     —— 用 _composedGrid 的数组身份当缓存键：每次 gmRecomposeAll 都会换新数组 */
  let terr = gm._sightTerr;
  if (!terr || gm._sightTerrFor !== gm._composedGrid || terr.length !== need) {
    terr = new Float32Array(need);
    for (let i = 0; i < need; i++) {
      const t = GRID_PALETTE[gm._composedGrid[i]];
      terr[i] = (t && t.sightBlock) || 0;
    }
    gm._sightTerr = terr;
    gm._sightTerrFor = gm._composedGrid;
  }
  const bld = new Int32Array(need);
  const bs = gm.buildings || [];
  if (bs.length) {
    const cs = gm.cellSize;
    const pad = cs * 1.5;
    for (let bi = 0; bi < bs.length; bi++) {
      const b = bs[bi];
      if (getBuildingState(b) === 'collapsed') continue;   // 塌了就不挡
      const x0 = Math.max(0, Math.floor((b.x - pad) / cs));
      const y0 = Math.max(0, Math.floor((b.y - pad) / cs));
      const x1 = Math.min(gm.gw - 1, Math.ceil((b.x + b.w + pad) / cs));
      const y1 = Math.min(gm.gh - 1, Math.ceil((b.y + b.h + pad) / cs));
      for (let gy = y0; gy <= y1; gy++) {
        const row = gy * gm.gw;
        for (let gx = x0; gx <= x1; gx++) bld[row + gx] = bi + 1;
      }
    }
  }
  gm._sightGrid = { terr, bld, n: need, cs: gm.cellSize };
  gm._sightGridAt = battle.time;
  return gm._sightGrid;
}

/* 某点落在哪个建筑里（查视线网格，0 = 不在任何建筑内） */
function sightBuildingAt(sg, gm, x, y) {
  if (!sg || !gm) return 0;
  const gx = Math.floor(x / gm.cellSize), gy = Math.floor(y / gm.cellSize);
  if (gx < 0 || gx >= gm.gw || gy < 0 || gy >= gm.gh) return 0;
  return sg.bld[gy * gm.gw + gx];
}

/* 射线推进：从单位出发沿一个方向走到视距，返回"这个方向能看多远"
   —— 地形按 sightBlock 累加；建筑（除观察者自己所在那栋）按硬挡处理 */
function visionReachAt(unit, sg, gm, ang, viewRange, myBld, step) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const cs = gm.cellSize, GW = gm.gw, GH = gm.gh;
  let sum = 0, reach = 0;
  for (let s = 1; s <= VISION_MAX_STEPS; s++) {
    const d = Math.min(viewRange, s * step);
    const gx = Math.floor((unit.x + dx * d) / cs);
    const gy = Math.floor((unit.y + dy * d) / cs);
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return reach;   // 出图 = 看不到
    const k = gy * GW + gx;
    let blk = sg.terr[k];
    const bi = sg.bld[k];
    if (bi && bi !== myBld) blk = Math.max(blk, VISION_BLD_BLOCK);
    if (blk > 0) {
      sum += blk * (step / SIGHT_BLOCK_UNIT);
      if (sum >= LOS_BLOCKED_AT) return d;                        // 这个方向被挡死
    }
    reach = d;
    if (d >= viewRange) break;
  }
  return reach;
}

/* 取单位当前帧的视野多边形（缓存：移动 <20m 且视距变化 <8% 且未超过 0.35s 就复用） */
function visionPolyOf(unit) {
  const gm = battle.gridMap;
  if (!gm) return null;
  const V = computeViewRange(unit);
  const c = unit._visPoly;
  if (c && battle.time - c.t < VISION_RECOMPUTE_SEC &&
      Math.hypot(unit.x - c.x, unit.y - c.y) < 20 &&
      Math.abs(V - c.V) / Math.max(1, c.V) < 0.08) {
    return c;
  }
  const sg = buildSightGrid(gm);
  const myBld = sightBuildingAt(sg, gm, unit.x, unit.y);
  const step = Math.max(8, V / VISION_MAX_STEPS);
  const pts = new Float32Array(VISION_RAY_COUNT);
  for (let i = 0; i < VISION_RAY_COUNT; i++) {
    const ang = (i / VISION_RAY_COUNT) * Math.PI * 2;
    pts[i] = visionReachAt(unit, sg, gm, ang, V, myBld, step);
  }
  unit._visPoly = { pts, V, x: unit.x, y: unit.y, t: battle.time, n: VISION_RAY_COUNT };
  return unit._visPoly;
}

/* 画视野：视距圆（虚线参考）+ 可见区多边形（半透明填充）
   —— 多边形之外不填色 = 完全透明，正好表达"被遮挡的地方看不见" */
function drawVisionOverlay() {
  if (!battle.gridMap) return;
  const sides = (viewMode === 'blue') ? ['blue']
              : (viewMode === 'red') ? ['red']
              : ['blue', 'red'];
  // 只画镜头附近的单位（视距已降到 1000m 基准，边距按 1200m 足够）
  const margin = 1200;
  const halfW = canvasW / 2 / camera.zoom, halfH = canvasH / 2 / camera.zoom;
  const x0 = camera.x - halfW - margin, x1 = camera.x + halfW + margin;
  const y0 = camera.y - halfH - margin, y1 = camera.y + halfH + margin;

  ctx.save();
  for (const side of sides) {
    ctx.fillStyle   = side === 'blue' ? 'rgba(96, 165, 250, 0.11)' : 'rgba(248, 113, 113, 0.11)';
    ctx.strokeStyle = side === 'blue' ? 'rgba(96, 165, 250, 0.32)' : 'rgba(248, 113, 113, 0.32)';
    ctx.lineWidth = 1 / camera.zoom;
    let drawn = 0;
    for (const u of battle.units) {
      if (!u.alive || u.side !== side) continue;
      if (u.x < x0 || u.x > x1 || u.y < y0 || u.y > y1) continue;
      if (++drawn > 40) break;                               // 性能护栏
      const poly = visionPolyOf(u);
      if (!poly) continue;
      // ① 视距圆（虚线 = 理论视距上限）
      ctx.setLineDash([12 / camera.zoom, 8 / camera.zoom]);
      ctx.beginPath();
      ctx.arc(u.x, u.y, poly.V, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // ② 可见区多边形
      ctx.beginPath();
      for (let i = 0; i < poly.n; i++) {
        const ang = (i / poly.n) * Math.PI * 2;
        const r = poly.pts[i];
        const px = u.x + Math.cos(ang) * r;
        const py = u.y + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function hasLineOfSight(fx, fy, tx, ty) {
  return losBlockPoints(fx, fy, tx, ty) < LOS_BLOCKED_AT;
}

function computeVisibleEnemies(unit) {
  const result = [];
  const V = computeViewRange(unit);
  const seen = new Set();

  if (!unit._seenMemory) unit._seenMemory = new Map();

  for (const [id, t] of unit._seenMemory) {
    if (battle.time - t > SEEN_MEMORY_KEEP) unit._seenMemory.delete(id);
  }

  for (const other of battle.units) {
    if (!other.alive || other.side === unit.side) continue;
    const dx = other.x - unit.x, dy = other.y - unit.y;
    const dist = Math.hypot(dx, dy);
    // ★ ① 发现距离 = max(绝对保底150m, 观察视距×12%, 视距×(1−隐蔽×暴露))
    const concealEff = unitConcealment(other) * unitExposure(other) * CONCEAL_MAX_EFFECT;
    const discover = Math.max(MIN_DISCOVER_ABS,
                              Math.max(V * MIN_DISCOVER_FRACTION, V * (1 - concealEff)));
    if (dist > discover) continue;
    // ★ ② 累计遮挡 < 1 才通视（树林 0.5 / 城区 0.7 / 山丘 1.0 / 建筑 1.0）
    if (losBlockPoints(unit.x, unit.y, other.x, other.y) >= LOS_BLOCKED_AT) continue;
    result.push(other);
    seen.add(other.id);
    unit._seenMemory.set(other.id, battle.time);
  }

  for (const other of battle.units) {
    if (!other.alive || other.side === unit.side) continue;
    if (seen.has(other.id)) continue;
    const lastSeen = unit._seenMemory.get(other.id);
    if (lastSeen && battle.time - lastSeen < SEEN_MEMORY_STALE) {
      result.push(other);
      seen.add(other.id);
    }
  }

  if (unit.isArtilleryUnit) {
    for (const other of battle.units) {
      if (!other.alive || other.side === unit.side) continue;
      if (!unitHasArtilleryFire(other)) continue;      // ★ R9.6.11：迫击炮也算（玩家要求）
      if (seen.has(other.id)) continue;
      const firedAgo = battle.time - (other.lastArtilleryFireTime || -999);
      if (firedAgo < COUNTER_BATTERY_MEMORY) {
        result.push({
          id: 'ghost_' + other.id,
          x: other.lastArtilleryFireX,
          y: other.lastArtilleryFireY,
          alive: true,
          hpArmor: other.hpArmor,
          hpArmorMax: other.hpArmorMax,
          hpPersonnel: other.hpPersonnel,
          hpPersonnelMax: other.hpPersonnelMax,
          isArtillery: true,
          isArtilleryUnit: true,
          isGhost: true,
          side: other.side,
        });
        seen.add(other.id);
      }
    }
  }

  return result;
}

function computeTeamVisibleEnemies(unit) {
  const teamSeen = new Map();
  for (const friend of battle.units) {
    if (!friend.alive || friend.side !== unit.side) continue;
    if (!friend.visibleEnemies) continue;
    for (const e of friend.visibleEnemies) {
      if (e.alive && !teamSeen.has(e.id)) {
        teamSeen.set(e.id, e);
      }
    }
  }
  for (const e of (unit.visibleEnemies || [])) {
    if (!teamSeen.has(e.id)) {
      teamSeen.set(e.id, e);
    }
  }

  if (unit.isArtilleryUnit) {
    for (const other of battle.units) {
      if (!other.alive || other.side === unit.side) continue;
      if (!unitHasArtilleryFire(other)) continue;      // ★ R9.6.11：迫击炮也算（玩家要求）
      if (teamSeen.has(other.id)) continue;
      const firedAgo = battle.time - (other.lastArtilleryFireTime || -999);
      if (firedAgo < COUNTER_BATTERY_MEMORY) {
        teamSeen.set('ghost_' + other.id, {
          id: 'ghost_' + other.id,
          x: other.lastArtilleryFireX,
          y: other.lastArtilleryFireY,
          alive: true,
          hpArmor: other.hpArmor,
          hpArmorMax: other.hpArmorMax,
          hpPersonnel: other.hpPersonnel,
          hpPersonnelMax: other.hpPersonnelMax,
          isArtillery: true,
          isArtilleryUnit: true,
          isGhost: true,
          side: other.side,
        });
      }
    }
  }
  return Array.from(teamSeen.values());
}

function isSpottedBy(side, u) {
  return battle.units.some(other =>
    other.alive && other.side === side &&
    other.visibleEnemies && other.visibleEnemies.some(e => e.id === u.id)
  );
}

/* ============================================================
   前沿观察员标记系统
   ============================================================ */
function updateFrontlineMarks() {
  if (!battle._marks) battle._marks = { blue: new Map(), red: new Map() };

  const now = battle.time;
  for (const side of ['blue', 'red']) {
    for (const [id, mark] of battle._marks[side]) {
      if (now - mark.t > FRONTLINE_MARK_TTL) battle._marks[side].delete(id);
      else if (!mark.unit || !mark.unit.alive) battle._marks[side].delete(id);
    }
  }

  if (!battle._nextMarkUpdate || battle.time >= battle._nextMarkUpdate) {
    battle._nextMarkUpdate = battle.time + 0.5;

    for (const u of battle.units) {
      if (!u.alive || u.isArtilleryUnit) continue;
      if (!u.visibleEnemies || !u.visibleEnemies.length) continue;

      for (const enemy of u.visibleEnemies) {
        if (enemy.isGhost || !enemy.alive) continue;
        const priority = (enemy.armor || 0) > 0 ? 2 : 1;
        battle._marks[u.side].set(enemy.id, {
          unit: enemy,
          t: now,
          reporter: u.id,
          priority,
        });
      }
    }
  }
}

function pickArtilleryMission(unit) {
  if (!battle._marks) return null;
  const marks = battle._marks[unit.side];
  if (!marks || marks.size === 0) return null;

  let best = null, bestScore = -Infinity;
  for (const mark of marks.values()) {
    if (!mark.unit || !mark.unit.alive) continue;
    const dist = Math.hypot(mark.unit.x - unit.x, mark.unit.y - unit.y);
    if (dist > unit.range) continue;

    let score = 1000 - dist * 0.1;
    score += mark.priority * 200;
    score += (1 - mark.unit.hpPersonnel / mark.unit.hpPersonnelMax) * 150;
    if (score > bestScore) { bestScore = score; best = mark.unit; }
  }
  return best;
}

/* ============================================================
   5) 从节点提取武器（含分组）
   ============================================================ */
function extractWeaponsFromNode(node) {
  const lib = getEquipmentLibrary();
  const weaponMap = new Map();
  let totalPersonnel = 0, equipHp = 0, maxArmor = 0, crewTotal = 0, capacityTotal = 0;

  forEachNode(node, n => {
    totalPersonnel += n.personnel || 0;
    for (const e of (n.equipment || [])) {
      const eq = lib[e.eqId];
      if (!eq) continue;
      const c = e.count || 0;
      if (c <= 0) continue;
      const s = eq.stats || {};
      if (typeof s.armor === 'number' && s.armor > 0) maxArmor = Math.max(maxArmor, s.armor);
      if (typeof s.hp === 'number') equipHp += s.hp * c;
      if (typeof s.crew === 'number') crewTotal += s.crew * c;
      if (typeof s.capacity === 'number') capacityTotal += s.capacity * c;

      const hasAttack =
        (typeof s.antiPersonnel === 'number' && s.antiPersonnel > 0) ||
        (typeof s.antiArmor     === 'number' && s.antiArmor     > 0) ||
        (typeof s.antiAir       === 'number' && s.antiAir       > 0);
      if (!hasAttack) continue;

      if (!weaponMap.has(e.eqId)) {
        weaponMap.set(e.eqId, {
          eqId: e.eqId, name: eq.name, category: eq.category,
          count: 0, antiPersonnel: 0, antiArmor: 0, antiAir: 0, ammo: 0,
          penetration: 0, rangeRaw: 0, fireInterval: 0, deployTime: 0,
          minRangeRaw: 0,
          avgDmgPerShot: 0,
          isArtillery: false,
        });
      }
      const w = weaponMap.get(e.eqId);
      w.count += c;
      if (eq.stats && typeof eq.stats.ammo === 'number') w.ammo += eq.stats.ammo * c;   // ★ R9：备弹按件累加
      if (typeof s.antiPersonnel === 'number') w.antiPersonnel += s.antiPersonnel * c;
      if (typeof s.antiArmor     === 'number') w.antiArmor     += s.antiArmor * c;
      if (typeof s.antiAir       === 'number') w.antiAir       += s.antiAir * c;
      if (typeof s.penetration   === 'number') w.penetration = Math.max(w.penetration, s.penetration);
      if (typeof s.range         === 'number') w.rangeRaw = Math.max(w.rangeRaw, s.range);
      if (typeof s.minRange      === 'number') w.minRangeRaw = Math.max(w.minRangeRaw, s.minRange);
      if (typeof s.fireInterval  === 'number') {
        w.fireInterval = w.fireInterval === 0 ? s.fireInterval : Math.min(w.fireInterval, s.fireInterval);
      }
      if (typeof s.deployTime    === 'number') w.deployTime = Math.max(w.deployTime, s.deployTime);
      if (typeof s.disposable === 'string' && s.disposable === 'yes') {
        w.disposable = true;
      }
      const shotDmg =
        (typeof s.antiPersonnel === 'number' ? s.antiPersonnel : 0) +
        (typeof s.antiArmor     === 'number' ? s.antiArmor * 0.5 : 0);
      if (shotDmg > w.avgDmgPerShot) w.avgDmgPerShot = shotDmg;
    }
  });

  const weapons = [];
  for (const w of weaponMap.values()) {
    w.range = Math.max(50, w.rangeRaw);
    w.isArtillery = (w.category === 'artillery');
    if (w.fireInterval <= 0) w.fireInterval = 1.2;
    if (w.deployTime < 0) w.deployTime = 0;
    if (!w.isArtillery) w.deployTime = 0;

    const total = w.count;
    if (total <= WEAPON_GROUP_SIZE) {
      weapons.push(_buildWeaponInstance(w, total, total, 0));
    } else {
      const groupCount = Math.min(WEAPON_MAX_GROUPS, Math.ceil(total / WEAPON_GROUP_SIZE));
      const base = Math.floor(total / groupCount);
      const extra = total % groupCount;
      for (let i = 0; i < groupCount; i++) {
        const groupSize = base + (i < extra ? 1 : 0);
        weapons.push(_buildWeaponInstance(w, groupSize, total, i));
      }
    }
  }
  return { weapons, totalPersonnel, equipHp, maxArmor, crewTotal, capacityTotal };
}

function _buildWeaponInstance(template, groupSize, totalSize, groupIndex) {
  const ratio = totalSize > 0 ? groupSize / totalSize : 1;
  const inst = {
    eqId: template.eqId,
    name: template.name,
    category: template.category,
    count: groupSize,
    _shooters: groupSize,
    antiPersonnel: template.antiPersonnel * ratio,
    antiArmor: template.antiArmor * ratio,
    antiAir: template.antiAir * ratio,
    penetration: template.penetration,
    rangeRaw: template.rangeRaw,
    range: template.range,
    minRangeRaw: template.minRangeRaw,
    fireInterval: template.fireInterval,
    deployTime: template.deployTime,
    disposable: template.disposable,
    ammoMax: Math.max(0, Math.round(template.ammo || 0)),   // ★ R9：备弹池
    ammo: Math.max(0, Math.round(template.ammo || 0)),
    isArtillery: template.isArtillery,
    _groupIndex: groupIndex,
    _groupTotal: totalSize,
    cooldown: Math.random() * 0.4 + groupIndex * 0.04,
    deployed: template.deployTime <= 0,
    deployProgress: template.deployTime <= 0 ? template.deployTime : 0,
    target: null,
    targetCacheTime: -1,
  };
  const shotDmg = inst.antiPersonnel + inst.antiArmor * 0.5;
  inst.avgDmgPerShot = shotDmg;
  inst.blastRadius = Math.min(400, 60 + Math.sqrt(Math.max(1, shotDmg)) * 8);
  return inst;
}

const GAME_SPEED_MULT = 2.2;   // 全局时间压缩：所有移动 ×2.2，让战术战斗在有限时长内完成
const FOOT_SPEED_KMH = 8;     // 徒步突击速度（km/h）
function deriveSpeed(kmh) {
  return Math.max(0.5, (kmh / 3.6) * GAME_SPEED_MULT);
}

function computeSubtreeMobility(node, lib) {
  let totalPersonnel = 0;
  let totalCapacity = 0;
  let rideMobility = 0;
  let maxMobility = 0;
  let hasTowedArty = false;
  let hasNonTowedArty = false;
  let hasTowingVehicle = false;
  let hasArmored = false;
  let hasTransport = false;
  let vehicleMobilityType = null;

  forEachNode(node, n => {
    totalPersonnel += n.personnel || 0;
    for (const e of (n.equipment || [])) {
      const eq = lib[e.eqId];
      if (!eq || !eq.stats) continue;
      const s = eq.stats;
      const c = e.count || 0;
      const cat = eq.category;

      if (typeof s.mobility === 'number' && s.mobility > 0) {
        if (s.mobility > maxMobility) {
          maxMobility = s.mobility;
          if (cat === 'armored_vehicle' || cat === 'support') {
            vehicleMobilityType = s.mobilityType || 'wheeled';
          }
        }
      }
      if (cat === 'armored_vehicle') hasArmored = true;

      if (cat === 'artillery') {
        const isTowed = (s.towed === undefined) || (s.towed === 'yes');
        if (isTowed) hasTowedArty = true;
        else hasNonTowedArty = true;
      }

      if (['armored_vehicle', 'support', 'aircraft'].includes(cat)) {
        const cap = (s.capacity || 0) * c;
        if (cap > 0) {
          totalCapacity += cap;
          hasTransport = true;
          const mob = Math.max(s.mobility || 0, s.speed || 0);
          if (mob > rideMobility) rideMobility = mob;
        }
        if (cat === 'support' && (s.mobility || 0) >= 30) {
          hasTowingVehicle = true;
        }
      }
    }
  });

  let speed, mobilityType;
  if (hasTowedArty && !hasTowingVehicle) {
    speed = deriveSpeed(2);
    mobilityType = 'foot';
  } else if (hasTowedArty && hasTowingVehicle) {
    speed = deriveSpeed(Math.max(rideMobility, maxMobility));
    mobilityType = vehicleMobilityType || 'wheeled';
  } else if (totalPersonnel > 0 && totalCapacity >= totalPersonnel && rideMobility > 0) {
    // 全员可乘车（人数 <= 载员）→ 用载具机动速度
    speed = deriveSpeed(rideMobility);
    mobilityType = vehicleMobilityType || 'wheeled';
  } else if (hasArmored && !hasTransport && totalPersonnel > 0) {
    // 纯装甲战斗车辆（坦克等无载员）+ 乘员 → 用载具机动速度
    speed = deriveSpeed(maxMobility);
    mobilityType = vehicleMobilityType || 'tracked';
  } else if (totalPersonnel > 0) {
    speed = deriveSpeed(FOOT_SPEED_KMH);
    mobilityType = 'foot';
  } else if (maxMobility > 0) {
    speed = deriveSpeed(maxMobility);
    mobilityType = vehicleMobilityType || 'wheeled';
  } else {
    speed = deriveSpeed(FOOT_SPEED_KMH);
    mobilityType = 'foot';
  }

  return { speed, mobilityType };
}

function deriveUnitStats(node) {
  const data = extractWeaponsFromNode(node);
  let hpPersonnel = data.totalPersonnel * HP_PER_SOLDIER;
  if (hpPersonnel <= 0) hpPersonnel = 100;

  // 乘员判定：缺员 → 可开动的载具减少（结构/防护折减）
  const crewFactor = Math.min(1, data.totalPersonnel / Math.max(1, data.crewTotal));

  const hpArmor = data.equipHp * crewFactor;   // 车辆结构耐久
  // 防护厚度按"被载具覆盖的乘员比例"折减：乘车/乘员受装甲保护，徒步暴露
  const coverage = data.totalPersonnel > 0
    ? Math.min(1, (data.crewTotal + data.capacityTotal) / data.totalPersonnel)
    : 1;
  const armor = data.maxArmor * coverage * crewFactor;

  let maxRange = 0;
  for (const w of data.weapons) maxRange = Math.max(maxRange, w.range);
  if (maxRange <= 0) maxRange = 100;

  const hasArtilleryWeapon = data.weapons.some(w => w.isArtillery);

  const lib = getEquipmentLibrary();
  const mobility = computeSubtreeMobility(node, lib);

  return {
    hpPersonnel, hpPersonnelMax: hpPersonnel,
    hpArmor, hpArmorMax: hpArmor,
    armor,
    facing: 0,
    weapons: data.weapons,
    range: maxRange,
    hasArtilleryWeapon,
    speed: mobility.speed,
    mobilityType: mobility.mobilityType,
    isMechanized: mobility.mobilityType !== 'foot',
    target: null, targetCacheTime: -1, targetLockUntil: 0,
    lastPosX: 0, lastPosY: 0, lastCheckTime: 0,
    stuckTime: 0, ghostUntil: 0,   // ghostUntil 已废弃（穿墙兜底已移除）
    retreating: false, retreatUntil: 0,
    lastFiredTime: 0,
    stance: 'moving',
    coverTarget: null,
    coverSearchCooldown: 0,
    suppression: 0,
    suppressed: false,
    suppressedUntil: 0,
    lastHitTime: -999,
    inCoverSince: 0,
    lastArtilleryFireTime: -999,
    lastArtilleryFireX: 0,
    lastArtilleryFireY: 0,
    needRelocateUntil: 0,
    relocateTarget: null,
    _lastArtyShotAt: 0,
  };
}

const AT_GUN_NODE_TYPES = ['anti_tank'];
const AAA_NODE_TYPES = ['aaa'];

const SUPPORT_FIRE_TYPES = [
  'artillery', 'mlrs', 'towed_w', 'towed_t',
];

const COMPANION_SUPPORT_TYPES = [
  'mortar', 'anti_tank', 'aaa',
];

/* ---------- 单兵位置展开（S1 可视化：仅渲染，不参与战斗判定）---------- */
const SOLDIER_RENDER_CAP = 240;
/* ★★★ R9.6.12：**排内单兵间距**（玩家："排组内以及排与排之间太密集了，一轮炮击一个排就没了"）
   ------------------------------------------------------------
   基准（玩家给的参照，用它反推间距）：
     · 立交桥 5×2.5 km = **12.5 km²**、**双方共 1100 人** ⇒ **88 人/km²**
       ⇔ 平均每人 **~10,900 m² ≈ 104m 见方**（单方若占半图 ≈ 92 人/km² ⇒ 每人 ~10,900 m²）
   按这个比例：
     · 排内单兵间距 = **22 m**（每人 484 m²；配掩体/起伏后接近真实"疏开队形"）
       —— 旧值 12.8m ⇒ 163 m²/人，是基准的 **3 倍密集**，这才是"排内太挤"的根
     · 它同时决定编队半径：30 人排 ≈ **56m 半径（正面 ~112m）**，与 ECHELON_FOOTPRINT 的"排 100m"对齐；
       240 人 ≈ 162m（现实中 240 人按 22m 间距本来就要铺 ~300m 正面）
   ⚠ 数值再大就会挤压"抵达半径/边界余量"的合理性（R9.6.2 的教训），所以这里一步不跨太大。 */
const SOLDIER_SPACING = 22;

function _mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* 生成 n 名士兵相对单位中心的偏移（米），松散班组队形，稳定不抖动
   ★ R9.6.2：**间距不再随人数放大** —— 旧公式 `SOLDIER_SPACING × (1 + √n × 0.18)`
   在 n=240（排级）时间距被放大到 **30m** ⇒ 整个单位铺开成**直径 ~440m 的大饼**，
   `_formationRadius` 也变成 ~220m（所有"抵达半径/边界余量"都被它带偏）。
   旧代码里"单位坐标 = 成员质心"所以看不出；R9.6 实体为准之后，玩家看到的就是
   "**一开局所有单位朝四周高速散开、还跑到图外**"。
   现在间距固定 ≈ `SOLDIER_SPACING × 1.6`（≈12.8m，略大于 12m 的士兵分离半径，
   这样分离力不会让队形反复膨胀），半径随 √t 增长 ⇒ 240 人的排半径 ≈ 93m（正常）。 */
function generateSoldierOffsets(count, seed) {
  const n = Math.max(1, Math.min(SOLDIER_RENDER_CAP, Math.round(count || 1)));
  const rng = _mulberry32(seed >>> 0);
  const spacing = SOLDIER_SPACING;                 // ★ R9.6.12：22m（间距即最终值，不再 ×1.6）
  const teamSize = 4;
  const teams = Math.ceil(n / teamSize);
  const out = [];
  for (let t = 0; t < teams; t++) {
    const ringR = spacing * (0.4 + Math.sqrt(t) * 0.9);
    const ringA = (t / teams) * Math.PI * 2 + rng() * 0.5;
    const cx = Math.cos(ringA) * ringR;
    const cy = Math.sin(ringA) * ringR * 0.75;
    for (let k = 0; k < teamSize && out.length < n; k++) {
      const a = (k / teamSize) * Math.PI * 2 + rng() * 0.6;
      const r = rng() * spacing * 0.5;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  }
  return out;
}

/* ---------- 单兵实体：每个士兵 = 一名主武器 + 独立血量 ---------- */
const SOLDIER_MAX_PER_UNIT = 240;

/* true ：没配到具体轻武器的士兵默认算一支步枪（"人手一支"的口径）
   false：严格按装备数量 —— 没配到枪的士兵就是没枪（火力完全由装备决定） */
const SMALL_ARMS_PER_MAN = true;

function makeSoldier(offset, item) {
  const s = item ? item.stats : {};
  const antiPersonnel = typeof s.antiPersonnel === 'number' ? s.antiPersonnel : 0;
  const antiArmor = typeof s.antiArmor === 'number' ? s.antiArmor : 0;
  const shotDmg = antiPersonnel + antiArmor * 0.5;
  const isArtillery = item ? (item.category === 'artillery') : false;
  return {
    ox: offset.x, oy: offset.y,
    x: 0, y: 0,
    hp: HP_PER_SOLDIER, hpMax: HP_PER_SOLDIER,
    alive: true,
    suppression: 0,
    suppressed: false,
    inCoverSince: 0,
    lastHitTime: -999,
    coverTarget: null,
    // 载具相关：乘车时 vehicle 指向所乘车辆、onFoot=false
    vehicle: null,
    onFoot: true,
    // 没有个人武器的士兵（车辆乘员/操作员）→ weapon = null
    weapon: item ? {
      name: item ? item.name : '步枪',
      category: item ? item.category : 'small_arms',
      isArtillery,
      antiPersonnel, antiArmor,
      penetration: typeof s.penetration === 'number' ? s.penetration : 0,
      range: Math.max(50, typeof s.range === 'number' ? s.range : 100),
      minRange: typeof s.minRange === 'number' ? s.minRange : 0,
      fireInterval: (typeof s.fireInterval === 'number' && s.fireInterval > 0) ? s.fireInterval : 1.2,
      deployTime: (typeof s.deployTime === 'number' && s.deployTime > 0) ? s.deployTime : 0,
      deployProgress: 0,
      deployed: !(typeof s.deployTime === 'number' && s.deployTime > 0),
      ammoMax: (typeof s.ammo === 'number' && s.ammo > 0) ? s.ammo : 120,   // ★ R9：备弹
      ammo: (typeof s.ammo === 'number' && s.ammo > 0) ? s.ammo : 120,
      blastRadius: Math.min(400, 60 + Math.sqrt(Math.max(1, shotDmg)) * 8),
      cooldown: Math.random() * 0.5,
      target: null, targetCacheTime: -1,
    } : null,
  };
}

function expandToSoldiers(node) {
  const lib = getEquipmentLibrary();
  const items = [];
  forEachNode(node, n => {
    for (const e of (n.equipment || [])) {
      const eq = lib[e.eqId];
      if (!eq || !eq.stats) continue;
      if (equipmentIsEntity(eq)) continue;   // ★ 车辆/火炮 → 独立实体，不发给个人
      const c = e.count || 0;
      if (c <= 0) continue;
      items.push({ name: eq.name, category: eq.category, stats: eq.stats, count: c });
    }
  });

  const slots = [];
  for (const it of items) for (let i = 0; i < it.count; i++) slots.push(it);

  let n = 0;
  forEachNode(node, nn => { n += nn.personnel || 0; });
  n = Math.max(1, Math.min(SOLDIER_MAX_PER_UNIT, Math.round(n)));

  // ★ 只有轻武器才是"人手一支"。车辆/火炮不再补发给多出来的士兵（这正是
  //   之前"炮/装甲火力按人数算"的根源：多出来的兵每人领了一门炮）。
  //   SMALL_ARMS_PER_MAN=false → 严格按装备数量：没配到枪就是没枪。
  const def = SMALL_ARMS_PER_MAN ? (items.find(i => i.category === 'small_arms') || null) : null;
  const offsets = generateSoldierOffsets(n, hashString(node.id || 'root'));
  const soldiers = [];
  for (let i = 0; i < n; i++) {
    soldiers.push(makeSoldier(offsets[i], i < slots.length ? slots[i] : def));
  }
  return soldiers;
}

/* ============================================================
   11.5) 载具 / 火炮实体（S-F）
   —— 每件"重装备"= 一个独立实体：车体（装甲/结构）+ 自带武器 + 操作员座席
   ============================================================ */
const VEHICLE_MAX_PER_UNIT = 40;       // 每单位车辆实体上限（性能保护）
const VEHICLE_ENTITY_CATEGORIES = [
  'armored_vehicle', 'aircraft', 'artillery', 'at_gun', 'anti_air', 'support',
];

/* 这件装备是否需要"独立实体 + 操作员"（车辆 / 火炮 / 牵引炮 / 防空 / 支援车） */
function equipmentIsEntity(eq) {
  if (!eq || !eq.stats) return false;
  const s = eq.stats;
  if (VEHICLE_ENTITY_CATEGORIES.includes(eq.category)) {
    if (eq.category === 'support') return (s.capacity || 0) > 0 || (s.hp || 0) > 0;
    return true;
  }
  // 其他类别：只要有载员或装甲，也按实体处理
  return (s.capacity || 0) > 0 || (s.armor || 0) > 0;
}

function vehicleKindOf(category) {
  if (category === 'artillery' || category === 'at_gun' || category === 'anti_air') return 'gun';
  if (category === 'aircraft') return 'air';
  if (category === 'support') return 'truck';
  return 'armor';
}

function makeVehicle(eq, index) {
  const s = eq.stats || {};
  const kind = vehicleKindOf(eq.category);
  const hasWeapon =
    (typeof s.antiPersonnel === 'number' && s.antiPersonnel > 0) ||
    (typeof s.antiArmor     === 'number' && s.antiArmor     > 0) ||
    (typeof s.antiAir       === 'number' && s.antiAir       > 0);
  const hp = Math.max(1, typeof s.hp === 'number' ? s.hp : 100);
  const deployTime = (typeof s.deployTime === 'number' && s.deployTime > 0) ? s.deployTime : 0;
  // ★ 火炮：改"杀伤半径"模型（老装备库没这两个字段时，用 对人员伤害 兜底换算）
  const lethalRadius = (typeof s.lethalRadius === 'number' && s.lethalRadius > 0)
    ? s.lethalRadius
    : Math.max(5, Math.round(6 + (s.antiPersonnel || 30) * 0.4));
  const suppressRadius = (typeof s.suppressRadius === 'number' && s.suppressRadius > 0)
    ? s.suppressRadius
    : Math.round(lethalRadius * 2.5);
  return {
    eqId: eq.id, name: eq.name, category: eq.category, kind,
    mobilityType: s.mobilityType || (kind === 'air' ? 'air' : kind === 'armor' ? 'tracked' : 'wheeled'),
    mobility: Math.max(s.mobility || 0, s.speed || 0),
    x: 0, y: 0, ox: 0, oy: 0, facing: 0,
    hp, hpMax: hp,
    armor: Math.max(0, typeof s.armor === 'number' ? s.armor : 0),
    crewNeeded: Math.max(1, Math.round(s.crew || 0) + (s.crew ? 0 : 1)),
    capacity: Math.max(0, Math.round(s.capacity || 0)),
    crew: [], passengers: [],
    destroyed: false,
    _index: index,
    hitRadius: kind === 'air' ? 5 : (kind === 'gun' ? 3 : (kind === 'truck' ? 4.5 : 4)),
    weapon: hasWeapon ? {
      name: eq.name,
      category: eq.category,
      isArtillery: eq.category === 'artillery',
      antiPersonnel: s.antiPersonnel || 0,
      antiArmor: s.antiArmor || 0,
      antiAir: s.antiAir || 0,
      penetration: s.penetration || 0,
      range: Math.max(50, s.range || 100),
      minRange: s.minRange || 0,
      fireInterval: (typeof s.fireInterval === 'number' && s.fireInterval > 0) ? s.fireInterval : 1.2,
      deployTime,
      deployProgress: 0,
      deployed: deployTime <= 0,
      disposable: s.disposable === 'yes',
      lethalRadius,
      suppressRadius,
      cooldown: Math.random() * 0.5 + index * 0.03,
      target: null, targetCacheTime: -1,
      _shooters: 1,
    } : null,
  };
}

/* 车辆的有效乘员数（活着的操作员） */
function aliveCrewOf(vehicle) {
  let n = 0;
  for (const s of vehicle.crew) if (s.alive) n++;
  return n;
}
/* 缺员 → 战斗力打折（≥1 人即可操作，但打不准 / 装填慢） */
function vehicleCrewFactor(vehicle) {
  const alive = aliveCrewOf(vehicle);
  if (alive <= 0) return 0;
  return Math.min(1, alive / Math.max(1, vehicle.crewNeeded));
}
function vehicleCanFight(vehicle) {
  return !vehicle.destroyed && !vehicle.abandoned && !!vehicle.weapon && aliveCrewOf(vehicle) > 0;
}

/* ---------- 载具受击 ---------- */

/* 挑一辆被打中的车（离来弹方向近的权重高） */
function pickVehicleVictim(unit, fromX, fromY) {
  const cands = [];
  let total = 0;
  for (const v of unit.vehicles) {
    if (v.destroyed || v.abandoned) continue;   // ★ 弃车不再替单位挡伤害
    const d = Math.hypot(v.x - fromX, v.y - fromY) || 1;
    const w = 1 / (1 + d * 0.002);
    cands.push({ v, w });
    total += w;
  }
  if (!cands.length) return null;
  if (total <= 0) return cands[0].v;
  let r = Math.random() * total;
  for (const c of cands) { r -= c.w; if (r <= 0) return c.v; }
  return cands[cands.length - 1].v;
}

/* 车辆报废：车内人员大量伤亡 + 爆炸 */
function destroyVehicle(unit, v) {
  if (v.destroyed) return;
  v.destroyed = true;
  v.hp = 0;
  spendTickets(unit.side, TICKETS_PER_VEHICLE);     // ★ 载具损毁扣票
  const inside = [];
  for (const s of v.crew) if (s.alive) inside.push(s);
  for (const s of v.passengers) if (s.alive) inside.push(s);
  for (const s of inside) damageSoldierAt(unit, s, HP_PER_SOLDIER * 1.6);
  battle.explosions.push({
    x: v.x, y: v.y, age: 0, maxAge: 0.9,
    radius: v.armor > 0 ? 70 : 40,
    death: true,
  });
  syncUnitArmorAggregate(unit);
  // 座位不够了 → 全员下车
  if (unit.mounted && !unitCanRide(unit)) setUnitMounted(unit, false);
}

/* 打中一辆车：先判穿深 vs 车体装甲，再伤结构 / 车内乘员 */
function damageVehicle(unit, v, weapon, fm, attacker, dist) {
  if (v.destroyed) return;
  const distFalloff = Math.max(0.3, 1 - (dist / Math.max(1, weapon.range)) * 0.5);
  const pen = weapon.penetration * distFalloff;
  const vArmor = v.armor * armorAngleMultiplier(attacker, { x: v.x, y: v.y, facing: v.facing });

  if (vArmor > 0 && pen < vArmor) {
    // 未击穿：只崩掉一点结构
    v.hp = Math.max(0, v.hp - weapon.antiArmor * 0.05 * fm);
  } else {
    v.hp = Math.max(0, v.hp - weapon.antiArmor * fm);
    // 击穿 → 车内乘员伤亡
    const inside = [];
    for (const s of v.crew) if (s.alive) inside.push(s);
    for (const s of v.passengers) if (s.alive) inside.push(s);
    if (inside.length) {
      const dmgPer = (weapon.antiPersonnel + weapon.antiArmor * 0.15) * fm;
      const victims = Math.max(1, Math.round(inside.length * 0.35));
      for (let k = 0; k < victims && inside.length; k++) {
        const idx = Math.floor(Math.random() * inside.length);
        const s = inside.splice(idx, 1)[0];
        if (s.alive) damageSoldierAt(unit, s, dmgPer);
      }
    }
  }
  if (v.hp <= 0) destroyVehicle(unit, v);
}

/* 从节点构建车辆实体，并把士兵分配到车（操作员 → 载员 → 徒步） */
function buildUnitVehicles(node, soldiers) {
  const lib = getEquipmentLibrary();
  const vehicles = [];
  forEachNode(node, n => {
    for (const e of (n.equipment || [])) {
      const eq = lib[e.eqId];
      if (!eq || !equipmentIsEntity(eq)) continue;
      const c = e.count || 0;
      for (let i = 0; i < c && vehicles.length < VEHICLE_MAX_PER_UNIT; i++) {
        vehicles.push(makeVehicle(eq, vehicles.length));
      }
    }
  });

  for (const s of soldiers) { s.vehicle = null; s.onFoot = true; }
  if (!vehicles.length) return vehicles;

  // 1) 操作员：平均分配（宁可每辆都缺员，也不让后半截车队趴窝）
  const pool = soldiers.slice();
  for (let i = 0; i < vehicles.length && pool.length; i++) {
    const v = vehicles[i];
    const leftVehicles = vehicles.length - i;
    let take = Math.ceil(pool.length / leftVehicles);
    if (take > v.crewNeeded) take = v.crewNeeded;
    if (take < 1) take = 1;
    v.crew = pool.splice(0, take);
    for (const s of v.crew) { s.vehicle = v; s.onFoot = false; }
  }

  // 2) 载员：按座位塞满
  for (const v of vehicles) {
    let seats = v.capacity;
    while (seats > 0 && pool.length) {
      const s = pool.shift();
      v.passengers.push(s);
      s.vehicle = v;
      s.onFoot = false;
      seats--;
    }
  }
  // 3) 剩下的士兵没有车 → 徒步步兵（pool 里剩下的保持 onFoot=true）

  // 4) 车辆编队槽位：★ 间距按"车长"算（14m），不再套用士兵的 8m 间距
  const offs = generateVehicleOffsets(vehicles.length, hashString(node.id || 'veh'), 14);
  vehicles.forEach((v, i) => {
    v.ox = offs[i] ? offs[i].x : 0;
    v.oy = offs[i] ? offs[i].y : 0;
  });

  return vehicles;
}

/* 全员都有座（含操作员席位）→ 才能整队乘车 */
function unitCanRide(unit) {
  if (!unit.vehicles || !unit.vehicles.length) return false;
  if (unit._vehiclesAbandoned) return false;
  let alive = 0;
  for (const s of unit.soldiers) if (s.alive) alive++;
  if (alive <= 0) return false;
  let seats = 0;
  for (const v of unit.vehicles) {
    if (v.destroyed || v.abandoned) continue;
    seats += v.crewNeeded + v.capacity;
  }
  return seats >= alive;
}

/* ★ 车是不是已经开到了单位身边（"能上车"的前提）
   —— 上车 = 士兵坐标吸附到车，所以"车不在附近"就绝不能上车 */
function vehicleNearUnit(unit, radius) {
  const rad = radius || VEHICLE_NEAR_RADIUS;
  if (!unit.vehicles || !unit.vehicles.length) return false;
  let alive = 0, near = 0, dmax = 0;
  for (const v of unit.vehicles) {
    if (v.destroyed || v.abandoned) continue;
    alive++;
    const d = Math.hypot(v.x - unit.x, v.y - unit.y);
    dmax = Math.max(dmax, d);
    if (d <= rad) near++;
  }
  unit._vehicleMaxDist = alive ? dmax : 0;
  return alive > 0 && near >= Math.max(1, Math.ceil(alive * VEHICLE_NEAR_RATIO));
}

/* ★ 弃车：车被甩下又追不上 → 本场永久转为徒步单位
   （比"无限等车 / 把士兵吸附回去瞬移"都诚实；载具留在原地作为战场残迹） */
function abandonVehicles(unit) {
  if (unit._vehiclesAbandoned) return;
  unit._vehiclesAbandoned = true;
  unit.mounted = false;
  for (const v of unit.vehicles || []) {
    if (!v.destroyed) v.abandoned = true;
  }
  unit.speed = unit.speedFoot || unit.speed;
  unit.mobilityType = 'foot';
  unit._rideBlockedSince = 0;
}

/* 单位装甲汇总（血条 / "是否装甲目标"判定用）
   —— ★ 弃车（abandoned）不算：车被丢在几百米外，徒步单位不该再被当成装甲目标 */
function syncUnitArmorAggregate(unit) {
  let hp = 0, hpMax = 0, armor = 0;
  for (const v of (unit.vehicles || [])) {
    if (v.destroyed || v.abandoned) { hpMax += v.hpMax; continue; }
    hp += Math.max(0, v.hp);
    hpMax += v.hpMax;
    armor = Math.max(armor, v.armor);
  }
  unit.hpArmor = hp;
  unit.hpArmorMax = hpMax;
  unit.armor = armor;
}

/* ---------- 乘车 / 下车 ---------- */

/* 此刻这个兵是否"在车上"：
   乘车状态 → 全员在车上；下车状态 → 只有"自带武器车辆"的操作员留在车上操作武器 */
function isSoldierAboard(s, unit) {
  if (!s || !s.alive || !s.vehicle) return false;
  if (s.vehicle.destroyed) return false;
  if (s.vehicle.abandoned) return false;      // ★ 已弃车 → 谁都不在车上
  if (unit.mounted) return true;
  return !!s.vehicle.weapon && s.vehicle.crew.indexOf(s) >= 0;
}

/* 车辆此刻有没有驾驶员（有在车上的操作员才开得动） */
function vehicleHasDriver(v, unit) {
  if (v.destroyed) return false;
  for (const s of v.crew) {
    if (s.alive && isSoldierAboard(s, unit)) return true;
  }
  return false;
}

/* 把"在车上的士兵"位置同步到车辆（乘车时画面上只看得见车） */
function syncAboardSoldiers(unit) {
  if (!unit.vehicles || !unit.vehicles.length) return;
  for (const v of unit.vehicles) {
    if (v.destroyed) continue;
    for (const s of v.crew) {
      if (s.alive && isSoldierAboard(s, unit)) { s.x = v.x; s.y = v.y; }
    }
    for (const s of v.passengers) {
      if (s.alive && isSoldierAboard(s, unit)) { s.x = v.x; s.y = v.y; }
    }
  }
}

/* ★★ R7.1：`unitWantsRide()` 已**删除** —— 它和 updateRideMode() 是两套平行判据
   （它有"持续行军 / 未压制 / 接敌就下车"，而 updateRideMode 只看"车能不能到"），
   两者互相打脸才会造成"上车↔下车"来回切。判据现在全在唯一的决策者
   `updateRideMode()`（见文件上方），执行点只读 `unit._rideWant`。 */


/* 切换乘车状态（下车时非操作员散到车外） */
function setUnitMounted(unit, mounted) {
  if (!!unit.mounted === !!mounted) return;
  // ★ 双保险：允许上车前必须确认"车真的在附近"（否则吸附 = 瞬移）
  if (mounted && !vehicleNearUnit(unit, VEHICLE_NEAR_RADIUS * 1.8)) return;
  unit.mounted = !!mounted;
  unit._mountChangedAt = battle.time;
  if (unit.mounted) {
    unit.speed = unit.speedMounted;
    unit.mobilityType = unit.mobilityTypeMounted || unit.mobilityType;
    syncAboardSoldiers(unit);
    return;
  }
  /* 下车：散到「单位质心周围、朝前进方向的半圆」，不再以各自车辆为圆心
     —— 旧代码以车为锚，而车可能卡在几百米外的林边/楼外 ⇒ 一下车整队往车那边偏 */
  const back = (unit.facing || 0) + Math.PI;
  const cx = unit.x, cy = unit.y;
  for (const s of unit.soldiers) {
    if (!s.alive || isSoldierAboard(s, unit)) continue;
    const a = back + (Math.random() - 0.5) * Math.PI * 1.1;   // 后方 ±99°
    const r = 10 + Math.random() * 12;                        // 10~22m
    let nx = Math.max(15, Math.min(MAP_W - 15, cx + Math.cos(a) * r));
    let ny = Math.max(15, Math.min(MAP_H - 15, cy + Math.sin(a) * r));
    if (isMoveBlockedAt(nx, ny, SOLDIER_BODY_RADIUS)) { nx = cx; ny = cy; }
    s.x = nx;
    s.y = ny;
  }
  const footLeft = unit.soldiers.some(s => s.alive && !isSoldierAboard(s, unit));
  if (footLeft) {
    unit.speed = unit.speedFoot;
    unit.mobilityType = unit.mobilityTypeFoot || 'foot';
  }
}

/* 该单位"需要架设"的武器清单（车上的炮 + 已下车士兵手里的家伙） */
function unitDeployWeapons(unit) {
  const out = [];
  for (const v of (unit.vehicles || [])) {
    if (v.destroyed || v.abandoned) continue;
    const w = v.weapon;
    if (w && w.deployTime > 0) out.push(w);
  }
  for (const s of unit.soldiers) {
    if (!s.alive) continue;
    if (isSoldierAboard(s, unit)) continue;
    const w = s.weapon;
    if (w && w.deployTime > 0) out.push(w);
  }
  return out;
}

/* 有没有武器已经架设完毕（炮已部署 → 钉死原地，不被推走、要走得先拆收） */
function unitDeployed(unit) {
  for (const w of unitDeployWeapons(unit)) {
    if (w.deployed) return true;
  }
  return false;
}

/* ★ 车辆编队槽位：按"车长 + 间距"排成行列（老代码直接套用士兵的 8m 间距 ×1.6，
   车与车只隔 ~13m 且没有车-车分离，所以整连会叠成一坨） */
function generateVehicleOffsets(count, seed, spacing) {
  const n = Math.max(1, Math.min(VEHICLE_MAX_PER_UNIT, Math.round(count || 1)));
  const rng = _mulberry32(seed >>> 0);
  const sp = spacing || 14;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / perRow);
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow), col = i % perRow;
    const jx = (rng() - 0.5) * sp * 0.14;
    const jy = (rng() - 0.5) * sp * 0.14;
    out.push({
      x: (col - (perRow - 1) / 2) * sp + jx,
      y: (row - (rows - 1) / 2) * sp * 0.85 + jy,
    });
  }
  return out;
}

/* 车-车分离：按车体尺寸互相推开（同单位内 O(k²)，k ≤ 40 可接受） */
function separateVehiclesLocal(unit, dt) {
  const list = unit.vehicles;
  if (!list || list.length < 2) return;
  const F = 8;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.destroyed) continue;
    const ra = a.hitRadius || VEHICLE_BODY_RADIUS;
    let px = 0, py = 0;
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const b = list[j];
      if (b.destroyed) continue;
      const minD = ra + (b.hitRadius || VEHICLE_BODY_RADIUS) + 5;   // 车体 + 安全间距
      const dx = a.x - b.x, dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0.01 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const f = 1 - d / minD;
        px += (dx / d) * f;
        py += (dy / d) * f;
      }
    }
    if (px !== 0 || py !== 0) {
      const cx = Math.max(-2, Math.min(2, px));
      const cy = Math.max(-2, Math.min(2, py));
      /* ★ R9.1：推挤也过"朝向投影"（横向 ×0.25）⇒ 不再把整列推向一侧（= 漂移） */
      const pr = headingProject(cx, cy, unit.facing);
      const nx = a.x + pr.x * F * dt;
      const ny = a.y + pr.y * F * dt;
      if (!isMoveBlockedAt(nx, ny, ra)) {
        a.x = Math.max(15, Math.min(MAP_W - 15, nx));
        a.y = Math.max(15, Math.min(MAP_H - 15, ny));
      }
    }
  }
}

/* 车辆本体不许开进楼里（★ R9.6.9）——已卡在楼里则放行（脱困优先，绝不永久卡死） */
function vehicleEnterBuildingBlocked(v, x, y, radius) {
  if (circleInAnyBuilding(v.x, v.y, 0)) return false;
  return circleInAnyBuilding(x, y, radius);
}

/* 把车辆摆到单位周围 */
function placeVehicles(unit) {
  if (!unit.vehicles) return;
  const hx = Math.cos(unit.facing || 0), hy = Math.sin(unit.facing || 0);
  const vsc = unitVehicleSlotCenter(unit);            // ★ R9.6.3：零均值槽位（与成员摆放同口径）
  for (const v of unit.vehicles) {
    const vox = (v.ox || 0) - vsc.x, voy = (v.oy || 0) - vsc.y;
    const nx = unit.x + (vox * hx - voy * hy);
    const ny = unit.y + (vox * hy + voy * hx);
    if (pointInAnyBuilding(nx, ny)) continue;   // ★ R9.6.9：车不摆进楼里
    v.x = nx;
    v.y = ny;
    v.facing = unit.facing || 0;
  }
}

/* 车辆朝编队槽位前进（带体积半径；被挡住就侧移绕障）
   —— ★ 速度与地形倍率都用「车自己的」：旧代码用 unit.speed，
      而下车后 unit.speed = speedFoot ⇒ 车按徒步速度爬，永远追不上步兵 */
function moveVehicleToward(unit, v, actualTarget, dt) {
  /* ★ 槽位随【行进朝向】旋转 —— 旧版 ox/oy 是固定世界偏移 ⇒ 一转弯车就得横穿到固定位置，
     队形被撕开（"跟着集体转弯，整个队伍被拉的很开"）。
     ★ R8：车道（预设动画）已随寻路层删除。 */
  const hx = Math.cos(unit.facing || 0), hy = Math.sin(unit.facing || 0);
  const slotX = actualTarget.x + (v.ox * hx - v.oy * hy);
  const slotY = actualTarget.y + (v.ox * hy + v.oy * hx);
  const dx = slotX - v.x, dy = slotY - v.y;
  const d = Math.hypot(dx, dy);
  const R = v.hitRadius || VEHICLE_BODY_RADIUS;
  /* ★★ R7.6：车体**只能朝自己的朝向走**（旧版直接朝槽位平移 ⇒ 车会"横着漂"，正是玩家看到的怪象）。
     越野：先按转向速率把车头转过去，再沿车头前进 + **限幅的横向修正**（≤±45° 分量）；
     车道：中线即路径，照旧朝车道位走（最后强制朝向 = 道路方向）。 */
  let mvx = dx / (d || 1), mvy = dy / (d || 1);
  if (d > 0.01) {
    const wantF = Math.atan2(dy, dx);
    v.facing = navTurnToward((v.facing == null ? wantF : v.facing), wantF, navTurnRateOf(unit) * dt);
    const fx = Math.cos(v.facing), fy = Math.sin(v.facing);
    /* ★ R9.1：横向修正的限幅从 0.7（≈±40°）收紧到 **±14°**（与"朝向锥"同一个常量）
       —— 旧值允许车"斜着蹭出 40°"，正是玩家看到的"车横着漂" */
    const fwdComp = Math.max(0, fx * mvx + fy * mvy);
    const latRaw = fx * mvy - fy * mvx;                       // 槽位在车头的左/右
    const lat = Math.max(-fwdComp * HEADING_LAT_TAN, Math.min(fwdComp * HEADING_LAT_TAN, latRaw));
    mvx = fx + (-fy) * lat;
    mvy = fy + ( fx) * lat;
    const ml = Math.hypot(mvx, mvy) || 1;
    mvx /= ml; mvy /= ml;
  }
  if (d > 4) {
    const vSpeed = unit.speedMounted || unit.speed || 5;
    const step = Math.min(vSpeed * (unit._fleetMul || 1) * paceMulOf(unit) * dt, d);   // ★ 整列同速 + R9.1 行进节流
    const nx = v.x + mvx * step;
    const ny = v.y + mvy * step;
    if (!isMoveBlockedAt(nx, ny, R) && !vehicleEnterBuildingBlocked(v, nx, ny, R)) {
      v.x = nx; v.y = ny;
    } else {
      const perpX = -dy / d, perpY = dx / d;
      /* ★ 去掉 Math.random：按车的固定属性决定绕行侧，并且**记住** ⇒ 不会左右乱抖、
         也不会被随机甩进城区（这一步同时治了"抽振"和"车进城区"） */
      if (v._side !== 1 && v._side !== -1) v._side = (v.ox > 0.01) ? 1 : -1;
      const ss = (unit._repathUntil > battle.time && unit._repelSide) ? unit._repelSide : v._side;
      /* ★★ R9.1：被挡住**不再"纯侧移"**（纯侧移 = 横着漂，玩家一眼就能看出来）
         —— 改成"把车头转向绕行侧，再沿车头前进"：看起来就是车在打方向绕障。 */
      const wantF2 = Math.atan2(dy * 0.5 + perpY * ss, dx * 0.5 + perpX * ss);
      v.facing = navTurnToward((v.facing == null ? wantF2 : v.facing), wantF2, navTurnRateOf(unit) * dt);
      const fx2 = Math.cos(v.facing), fy2 = Math.sin(v.facing);
      const nx2 = v.x + fx2 * step, ny2 = v.y + fy2 * step;
      if (!isMoveBlockedAt(nx2, ny2, R) && !vehicleEnterBuildingBlocked(v, nx2, ny2, R)) { v.x = nx2; v.y = ny2; }
    }
  }
  v.x = Math.max(15, Math.min(MAP_W - 15, v.x));
  v.y = Math.max(15, Math.min(MAP_H - 15, v.y));
}

/* 对某个具体士兵造成伤害；返回是否击杀 */
function damageSoldierAt(unit, s, dmg) {
  if (!s || !s.alive || dmg <= 0) return false;
  const actual = Math.min(dmg, s.hp);
  s.hp -= actual;
  unit.hpPersonnel = Math.max(0, unit.hpPersonnel - actual);
  if (s.hp <= 0) {
    s.alive = false;
    spendTickets(unit.side, TICKETS_PER_SOLDIER);   // ★ 阵亡扣票
    addCorpse(s.x, s.y, unit.side);                 // ★ R9.6.11：阵亡地点留一个灰点（局内永久）
    if (!unit.soldiers.some(x => x.alive)) {
      unit.alive = false;
      battle.explosions.push({ x: unit.x, y: unit.y, age: 0, maxAge: 1.2, radius: 80, death: true });
    }
    return true;
  }
  return false;
}

/* 按几何挑选被命中的士兵：越暴露（掩体差）、越靠近来弹方向 → 权重越高 */
function pickTargetSoldier(unit, fromX, fromY, skipAboard) {
  if (!unit || !unit.soldiers || !unit.soldiers.length) return null;
  let total = 0;
  const cands = [];
  for (const s of unit.soldiers) {
    if (!s.alive) continue;
    if (skipAboard && isSoldierAboard(s, unit)) continue;
    const d = Math.hypot(s.x - fromX, s.y - fromY) || 1;
    const exposure = coverFactorAt(s.x, s.y, false);   // 1 = 完全暴露
    const w = exposure * exposure / (1 + d * 0.002);
    cands.push({ s, w });
    total += w;
  }
  if (!cands.length) return null;
  if (total <= 0) return cands[0].s;
  let r = Math.random() * total;
  for (const c of cands) { r -= c.w; if (r <= 0) return c.s; }
  return cands[cands.length - 1].s;
}

/* 伤害一个随机存活的士兵（区域伤害用；返回是否击杀） */
function damageSoldier(unit, dmg) {
  if (dmg <= 0) return false;
  const alive = [];
  for (const s of unit.soldiers) if (s.alive) alive.push(s);
  if (!alive.length) return false;
  const s = alive[Math.floor(Math.random() * alive.length)];
  return damageSoldierAt(unit, s, dmg);
}

/* 把士兵摆到单位周围（世界坐标 = 单位中心 + 编队偏移） */
function placeSoldiers(unit) {
  if (!unit.soldiers) return;
  for (const s of unit.soldiers) {
    s.x = unit.x + s.ox;
    s.y = unit.y + s.oy;
  }
}

/* ============================================================
   同单位内士兵分离（避免重叠）
   ★★★ R9.4：**空间网格版** —— 旧版是 O(k²)：k=240 ⇒ 单单位每帧 5.7 万次判定；
     而它只在 `!unit.mounted` 时跑 ⇒ **一旦"整队下车"，所有原本"乘车跳过"的单位瞬间都变徒步
     并全量付这个成本 ⇒ 帧时间从几 ms 涨到几百 ms = 玩家看到的"整个网页卡死"**
     （DOM 面板照样能点，所以还能继续点别的单位下车 ⇒ 越点越卡）。
     网格 cell = 分离半径 R，每个兵只看自己所在格 + 周围 3×3 格 ⇒ 平均 O(k)。
   ============================================================ */
function separateSoldiersLocal(unit, dt) {
  const list = unit.soldiers;
  if (!list || list.length < 2) return;
  const R = SOLDIER_SEP_RADIUS, R2 = R * R, inv = 1 / R;
  const grid = unit._sepGrid || (unit._sepGrid = new Map());
  const pool = unit._sepPool || (unit._sepPool = []);
  grid.clear();
  let used = 0;
  /* ① 装桶（复用数组，零分配） */
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive) continue;
    const key = (Math.floor(a.x * inv) * 73856093) ^ (Math.floor(a.y * inv) * 19349663);
    let arr = grid.get(key);
    if (!arr) {
      arr = pool[used] || (pool[used] = []);
      arr.length = 0;
      pool[used] = arr;
      used++;
      grid.set(key, arr);
    }
    arr.push(i);
  }
  /* ② 每个兵只和 3×3 邻格里的兵比（12m 半径内的一定在临格） */
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive) continue;
    const cx = Math.floor(a.x * inv), cy = Math.floor(a.y * inv);
    let px = 0, py = 0;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const arr = grid.get(((cx + ox) * 73856093) ^ ((cy + oy) * 19349663));
        if (!arr) continue;
        for (let q = 0; q < arr.length; q++) {
          const j = arr[q];
          if (j === i) continue;
          const b = list[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 0.001 && d2 < R2) {
            const d = Math.sqrt(d2);
            const f = 1 - d / R;
            px += (dx / d) * f;
            py += (dy / d) * f;
          }
        }
      }
    }
    if (px === 0 && py === 0) continue;
    const cpx = Math.max(-SOLDIER_SEP_MAX, Math.min(SOLDIER_SEP_MAX, px));
    const cpy = Math.max(-SOLDIER_SEP_MAX, Math.min(SOLDIER_SEP_MAX, py));
    /* ★ R9.1：横向压到 1/4（否则"左右邻居互相挤"会把整个单位推歪 = 漂移） */
    const pr = headingProject(cpx, cpy, unit.facing);
    a.x += pr.x * SOLDIER_SEP_FORCE * dt;
    a.y += pr.y * SOLDIER_SEP_FORCE * dt;
  }
}

/* 单位中心 = 存活士兵质心（后续 S-B 独立走位时由士兵反推单位位置） */
function unitCenterFromSoldiers(unit) {
  let sx = 0, sy = 0, n = 0;
  for (const s of unit.soldiers) {
    if (!s.alive) continue;
    sx += s.x; sy += s.y; n++;
  }
  if (!n) return null;
  return { x: sx / n, y: sy / n };
}

function buildUnitsFromArmy(savedData, side, targetEchelon, selectionSet, maxUnits) {
  const limit = maxUnits || MAX_UNITS_PER_SIDE;
  const nodes = extractSelectedUnits(savedData, selectionSet, targetEchelon, limit);
  const units = [];
  for (const item of nodes) {
    const node = item.node;
    const path = item.path;
    const parentNode = item.parentNode;
    const stats = deriveUnitStats(node);
    let personnel = 0;
    forEachNode(node, n => personnel += n.personnel || 0);
    const soldiers = expandToSoldiers(node);
    const vehicles = buildUnitVehicles(node, soldiers);
    const unit = {
      id: 'u_' + Math.random().toString(36).slice(2, 8),
      side, name: node.name || '未知单位',
      type: node.type, echelon: node.echelon,
      custom: node.custom || null,
      personnel,
      x: 0, y: 0, alive: true,
      formationPath: path,
      formationAngle: 0,
      formationIndex: 0,
      formationCount: 1,
      unitLabel: node.name || '',
      parentLabel: parentNode ? (parentNode.name || '') : '',
      isArtilleryUnit: SUPPORT_FIRE_TYPES.includes(node.type),
      isSupportUnit: COMPANION_SUPPORT_TYPES.includes(node.type),
      _artyRole: SUPPORT_FIRE_TYPES.includes(node.type) ? 'support' : null,
      isATGunUnit: AT_GUN_NODE_TYPES.includes(node.type),
      isAAAUnit: AAA_NODE_TYPES.includes(node.type),
      // 密度感知
      _densityCacheTime: 0,
      _densityPerception: 0,
      _densityOffset: null,
      _densityWeight: 1,
      soldiers,
      vehicles,
      mounted: false,
      ...stats,
      hpPersonnel: soldiers.length * HP_PER_SOLDIER,
      hpPersonnelMax: soldiers.length * HP_PER_SOLDIER,
    };
    // ★ 乘车机动 / 徒步机动分开算；装甲按车辆汇总（不再按"人数够不够"打折）
    let vehMob = 0, vehType = null;
    for (const v of vehicles) {
      if (v.mobility > vehMob) { vehMob = v.mobility; vehType = v.mobilityType; }
    }
    unit.speedMounted = vehMob > 0 ? deriveSpeed(vehMob) : stats.speed;
    unit.speedFoot = deriveSpeed(FOOT_SPEED_KMH);
    unit.mobilityTypeMounted = vehType || stats.mobilityType;
    unit.mobilityTypeFoot = 'foot';
    unit.speed = vehicles.length ? unit.speedFoot : stats.speed;
    unit.mobilityType = vehicles.length ? 'foot' : stats.mobilityType;
    if (vehicles.length) syncUnitArmorAggregate(unit);
    // 编队半径（士兵相对单位中心的最大摊开距离）—— 站位时要从射程里扣掉它，
    // 才能保证"整个队形"都在射程内（这是编队数据，不是魔法乘数）
    let formR = 0;
    for (const s of soldiers) formR = Math.max(formR, Math.hypot(s.ox || 0, s.oy || 0));
    unit._formationRadius = formR;
    // 只有带"需架设武器"（迫击炮/火炮/反坦克武器）的单位才需要每帧查架设状态
    unit._hasDeployWeapons =
      vehicles.some(v => v.weapon && v.weapon.deployTime > 0) ||
      soldiers.some(s => s.weapon && s.weapon.deployTime > 0);
    units.push(unit);
  }
  return units;
}

function assignFormationSlots(units) {
  const groups = new Map();
  for (const u of units) {
    const path = u.formationPath || '';
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : 'root';
    const key = u.side + '|' + parentPath;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  for (const arr of groups.values()) {
    const n = arr.length;
    arr.forEach((u, i) => {
      u.formationAngle = (i / n) * Math.PI * 2 + Math.PI * 0.25;
      u.formationIndex = i;
      u.formationCount = n;
    });
  }
}

/* 出生落点若压在障碍上 → 就近找一个可通行点（只在开局布阵时用） */
/* 就近找空位：★ 用"圈数"而不是浮点自增循环，且硬上限 60 圈
   —— 旧写法 `for (let r = 30; r <= maxR; r += 30)` 在 maxR 失控（Infinity/NaN）时会死循环，
      而它正好在"点击开始"的布阵阶段被调用 ⇒ 表现就是整页卡死。 */
function findNearbyFreeSpot(x, y, maxR, radius) {
  if (!isMoveBlockedAt(x, y, radius)) return { x, y };
  const rings = Math.min(60, Math.max(1, Math.ceil((maxR || 60) / 30)));
  for (let k = 1; k <= rings; k++) {
    const r = 30 * k;
    if (!(r < MAP_W * 2)) break;                 // 双保险：半径离谱就停
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const nx = x + Math.cos(a) * r;
      const ny = y + Math.sin(a) * r;
      if (nx < 20 || nx > MAP_W - 20 || ny < 20 || ny > MAP_H - 20) continue;
      if (!isMoveBlockedAt(nx, ny, radius)) return { x: nx, y: ny };
    }
  }
  return null;
}

/* 按"出生区"布阵：网格排布 + 自动扩容 + 避让障碍
   —— 老逻辑是把单位按同心圆塞在一个点上，出生区小的时候会全部叠在一起被挤飞 */
function layoutUnits(units, role) {
  const n = units.length;
  if (!n) return;
  const side = units[0].side;
  const gm = battle.gridMap;
  if (gm) ensureSpawns(gm);

  /* 单位占地（按编制层级，有车再放大） */
  let fp = 60;
  for (const u of units) {
    let f = ECHELON_FOOTPRINT[u.echelon] || 60;
    if (u.vehicles && u.vehicles.length) f = Math.max(f, 90);
    fp = Math.max(fp, Math.min(220, f));
  }

  let sp = (gm && gm.spawns) ? gm.spawns[side] : null;
  if (!spawnIsValid(sp)) {
    const cx0 = side === 'blue' ? MAP_W * 0.08 : MAP_W * 0.5;
    sp = { x: cx0 - 500, y: MAP_H * 0.2, w: 1000, h: MAP_H * 0.6 };
  }

  /* 网格：先按出生区形状定列数，再按"排布也要有间距"反推 */
  const cols = Math.max(1, Math.round(Math.sqrt(n * (sp.w / Math.max(1, sp.h)))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const spacing = Math.max(fp * 1.5, Math.sqrt(spawnArea(sp) / Math.max(1, n)) * 1.15);

  /* 出生区装不下 → 以中心为锚点往外扩（不超出地图） */
  let w = Math.min(Math.max(sp.w, cols * spacing), MAP_W - 80);
  let h = Math.min(Math.max(sp.h, rows * spacing), MAP_H - 80);
  let cx = sp.x + sp.w / 2, cy = sp.y + sp.h / 2;
  cx = Math.max(w / 2 + 40, Math.min(MAP_W - w / 2 - 40, cx));
  cy = Math.max(h / 2 + 40, Math.min(MAP_H - h / 2 - 40, cy));

  const x0 = cx - ((cols - 1) * spacing) / 2;
  const y0 = cy - ((rows - 1) * spacing) / 2;

  /* ★ 出生区是多边形时：只挑"圈内"的点，从质心往外铺（支持 L 形/凹形/多块不相连）
     —— 装不下就逐级缩小间距重试；实在装不下才退回老的包围盒网格 */
  let slots = null;
  if (spawnHasPolys(sp)) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const trial = collectSpawnSlots(sp, spacing * Math.pow(0.75, attempt));
      if (trial.length >= n) { slots = trial; break; }
    }
  }

  units.forEach((u, i) => {
    let x, y;
    if (slots) {
      const s = slots[i % slots.length];
      x = s.x; y = s.y;
      // 槽位不够时（同一格被多个单位用）螺旋微偏，避免完全重叠（后面的分离力会推开）
      if (i >= slots.length) {
        const k = Math.floor(i / slots.length), a = k * 2.39996;
        x += Math.cos(a) * spacing * 0.35 * k;
        y += Math.sin(a) * spacing * 0.35 * k;
      }
    } else {
      const col = i % cols, row = Math.floor(i / cols);
      x = x0 + col * spacing;
      y = y0 + row * spacing;
    }
    const R = bodyRadiusOf(u);
    if (isMoveBlockedAt(x, y, R)) {
      const free = findNearbyFreeSpot(x, y, Math.max(60, spacing * 0.6), R);
      if (free) { x = free.x; y = free.y; }
    }
    u.x = Math.max(20, Math.min(MAP_W - 20, x));
    u.y = Math.max(20, Math.min(MAP_H - 20, y));
    placeSoldiers(u);
    placeVehicles(u);
    u.lastPosX = u.x;
    u.lastPosY = u.y;
  });
}

/* 在出生区（含多块多边形）内、按 step 打点，返回"圈内"的点，按到质心距离排序
   ★ 用"格数"而不是"浮点自增"来遍历：后者在 w/h 异常大或步长异常小时会变成死循环
     （点开始就整页卡死的典型成因），这里最多 200×200 = 4 万点，硬上限。 */
function collectSpawnSlots(sp, step) {
  const out = [];
  const st = Math.max(20, step || 60);
  const maxN = 200;
  const nxCount = Math.min(maxN, Math.max(1, Math.ceil((sp.w || 1) / st)));
  const nyCount = Math.min(maxN, Math.max(1, Math.ceil((sp.h || 1) / st)));
  const dx = (sp.w || 1) / nxCount, dy = (sp.h || 1) / nyCount;
  const c = spawnCenter(sp);
  for (let i = 0; i < nxCount; i++) {
    const x = sp.x + (i + 0.5) * dx;
    for (let j = 0; j < nyCount; j++) {
      const y = sp.y + (j + 0.5) * dy;
      if (!pointInSpawn(sp, x, y)) continue;
      out.push({ x, y, d: Math.hypot(x - c.x, y - c.y) });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

/* ============================================================
   6) 兵牌预加载
   ============================================================ */
function getSymbolImage(type, echelon, custom) {
  const key = type + '|' + echelon + '|' + (custom ? JSON.stringify(custom) : '');
  if (symbolCache.has(key)) return symbolCache.get(key);
  let svgStr;
  try { svgStr = buildSymbol(type, echelon, custom); }
  catch (e) { return null; }
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.loaded = false;
  img.onload = () => { img.loaded = true; URL.revokeObjectURL(url); };
  img.onerror = () => { URL.revokeObjectURL(url); };
  img.src = url;
  symbolCache.set(key, img);
  return img;
}
function preloadAllSymbols(units) {
  return new Promise(resolve => {
    let pending = 0;
    units.forEach(u => {
      const img = getSymbolImage(u.type, u.echelon, u.custom);
      if (img && !img.loaded) {
        pending++;
        const onDone = () => { pending--; if (pending === 0) resolve(); };
        img.addEventListener('load', onDone, { once: true });
        img.addEventListener('error', onDone, { once: true });
      }
    });
    if (pending === 0) resolve();
    setTimeout(resolve, 1500);
  });
}

/* ============================================================
   7) 参战部队选择弹窗
   ============================================================ */
function openUnitSelector() {
  const blueKey = $('blue-army').value;
  const redKey = $('red-army').value;
  if (!blueKey || !redKey) return;

  let saves = {};
  try { saves = JSON.parse(localStorage.getItem(SAVES_KEY) || '{}'); }
  catch (e) { return; }
  const blueSaved = saves[blueKey];
  const redSaved  = saves[redKey];
  if (!blueSaved || !redSaved) { Dlg.alert('存档丢失'); return; }

  let blueRoot, redRoot;
  try {
    blueRoot = deserializeOrg(JSON.parse(JSON.stringify(blueSaved.data)));
    redRoot  = deserializeOrg(JSON.parse(JSON.stringify(redSaved.data)));
  } catch (e) { Dlg.alert('反序列化失败：' + e.message); return; }

  const echelon = $('echelon').value || 'platoon';
  const maxSoldiers = getMapMaxSoldiers();

  if (!unitSelection.blue) {
    unitSelection.blue = new Set();
    autoSelectEchelon(blueRoot, echelon, unitSelection.blue);
  }
  if (!unitSelection.red) {
    unitSelection.red = new Set();
    autoSelectEchelon(redRoot, echelon, unitSelection.red);
  }

  const old = $('_unit_selector');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = '_unit_selector';
  overlay.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;
    background:rgba(15,23,42,.7);display:flex;align-items:center;justify-content:center;
    z-index:2147483647;padding:16px;`;

  const modal = document.createElement('div');
  modal.style.cssText = `background:#131f36;color:#e2e8f0;border:1px solid #334155;
    border-radius:12px;width:min(1100px,96vw);max-height:92vh;
    display:flex;flex-direction:column;overflow:hidden;
    box-shadow:0 20px 40px rgba(0,0,0,.5);`;

  modal.innerHTML = `
    <div style="padding:14px 20px;border-bottom:1px solid #334155;
      display:flex;align-items:center;justify-content:space-between;">
      <h3 style="margin:0;font-size:15px;font-weight:700;">👥 选择参战部队</h3>
      <button id="_us_close" style="background:none;border:none;color:#94a3b8;
        font-size:22px;cursor:pointer;padding:0 4px;">×</button>
    </div>
    <div style="padding:10px 20px;background:#0f172a;border-bottom:1px solid #334155;
      display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px;">
      <span style="color:#94a3b8;">当前编制层级：<b style="color:#7cb1f0;">${ECHELONS[echelon]?.name || echelon}</b></span>
      <span style="color:#94a3b8;">建议参战人数：<b style="color:#fbbf24;">${maxSoldiers.toLocaleString()}</b> 人/侧</span>
      <button id="_us_select_level" style="font:inherit;font-size:12px;padding:4px 10px;
        border-radius:4px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;
        cursor:pointer;">按层级全选</button>
      <button id="_us_select_all" style="font:inherit;font-size:12px;padding:4px 10px;
        border-radius:4px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;
        cursor:pointer;">全选所有子节点</button>
      <span style="color:#64748b;margin-left:auto;">勾选上级会<b style="color:#94a3b8;">自动勾选并锁定</b>全部下级 · 建议人数仅供参考，超出也能开战</span>
    </div>
    <div style="flex:1;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;gap:0;">
      <div style="overflow-y:auto;border-right:1px solid #334155;padding:10px;">
        <div style="font-size:12px;font-weight:700;color:#60a5fa;padding:4px 8px;margin-bottom:6px;
          background:rgba(59,130,246,.1);border-radius:4px;
          display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span>蓝方 · ${escapeHtml(blueKey)}</span>
          <span style="display:flex;gap:6px;align-items:center;">
            <span id="_us_blue_count" style="color:#94a3b8;font-weight:400;">0 选中</span>
            <button id="_us_blue_clear" style="font:inherit;font-size:11px;padding:2px 8px;
              border-radius:4px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;
              cursor:pointer;">清空</button>
          </span>
        </div>
        <div id="_us_blue_tree"></div>
      </div>
      <div style="overflow-y:auto;padding:10px;">
        <div style="font-size:12px;font-weight:700;color:#f87171;padding:4px 8px;margin-bottom:6px;
          background:rgba(239,68,68,.1);border-radius:4px;
          display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span>红方 · ${escapeHtml(redKey)}</span>
          <span style="display:flex;gap:6px;align-items:center;">
            <span id="_us_red_count" style="color:#94a3b8;font-weight:400;">0 选中</span>
            <button id="_us_red_clear" style="font:inherit;font-size:11px;padding:2px 8px;
              border-radius:4px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;
              cursor:pointer;">清空</button>
          </span>
        </div>
        <div id="_us_red_tree"></div>
      </div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid #334155;display:flex;
      gap:8px;justify-content:flex-end;">
      <button id="_us_cancel" style="font:inherit;font-size:13px;padding:8px 14px;
        border-radius:6px;cursor:pointer;border:1px solid #334155;
        background:#1e293b;color:#e2e8f0;">取消</button>
      <button id="_us_ok" style="font:inherit;font-size:13px;padding:8px 14px;
        border-radius:6px;cursor:pointer;border:1px solid #3b82f6;
        background:#3b82f6;color:#fff;font-weight:600;">确定</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.documentElement.appendChild(overlay);

  const blueTreeEl = modal.querySelector('#_us_blue_tree');
  const redTreeEl  = modal.querySelector('#_us_red_tree');
  const blueCountEl = modal.querySelector('#_us_blue_count');
  const redCountEl  = modal.querySelector('#_us_red_count');

  function updateCounts() {
    const bc = unitSelection.blue.size;
    const rc = unitSelection.red.size;
    const unitCap = getMapMaxUnits();
    const bs = selectionSoldiers(blueRoot, unitSelection.blue);
    const rs = selectionSoldiers(redRoot, unitSelection.red);
    const blueOver = maxSoldiers > 0 && bs > maxSoldiers;
    const redOver  = maxSoldiers > 0 && rs > maxSoldiers;
    const blueUnitOver = bc > unitCap;
    const redUnitOver  = rc > unitCap;
    blueCountEl.textContent = bc + ' 个单位 ≈ ' + bs.toLocaleString() + ' 人' +
      (blueOver ? `  ⚠ 超建议 ${(bs - maxSoldiers).toLocaleString()} 人` : '') +
      (blueUnitOver ? `  ⚠ 兵牌上限 ${unitCap}，超出将随机取 ${unitCap} 个` : '');
    redCountEl.textContent  = rc + ' 个单位 ≈ ' + rs.toLocaleString() + ' 人' +
      (redOver ? `  ⚠ 超建议 ${(rs - maxSoldiers).toLocaleString()} 人` : '') +
      (redUnitOver ? `  ⚠ 兵牌上限 ${unitCap}，超出将随机取 ${unitCap} 个` : '');
    blueCountEl.style.color = blueOver ? '#f87171' : (bs > maxSoldiers * 0.6 ? '#fcd34d' : '#94a3b8');
    redCountEl.style.color  = redOver ? '#f87171' : (rs > maxSoldiers * 0.6 ? '#fcd34d' : '#94a3b8');
  }

  const blueRenderer = renderTreeInto(blueTreeEl, blueRoot, unitSelection.blue, updateCounts, maxSoldiers);
  const redRenderer  = renderTreeInto(redTreeEl,  redRoot,  unitSelection.red,  updateCounts, maxSoldiers);
  updateCounts();

  modal.querySelector('#_us_select_level').addEventListener('click', () => {
    unitSelection.blue.clear();
    unitSelection.red.clear();
    autoSelectEchelon(blueRoot, echelon, unitSelection.blue);
    autoSelectEchelon(redRoot,  echelon, unitSelection.red);
    blueRenderer.sync();
    redRenderer.sync();
    updateCounts();
  });
  modal.querySelector('#_us_select_all').addEventListener('click', () => {
    unitSelection.blue.clear();
    unitSelection.red.clear();
    if (blueRoot.children && blueRoot.children.length) {
      blueRoot.children.forEach((c, i) => unitSelection.blue.add(String(i)));
    } else {
      unitSelection.blue.add('');
    }
    if (redRoot.children && redRoot.children.length) {
      redRoot.children.forEach((c, i) => unitSelection.red.add(String(i)));
    } else {
      unitSelection.red.add('');
    }
    blueRenderer.sync();
    redRenderer.sync();
    updateCounts();
  });
  modal.querySelector('#_us_blue_clear').addEventListener('click', () => {
    unitSelection.blue.clear();
    blueRenderer.sync();
    updateCounts();
  });
  modal.querySelector('#_us_red_clear').addEventListener('click', () => {
    unitSelection.red.clear();
    redRenderer.sync();
    updateCounts();
  });

  modal.querySelector('#_us_close').addEventListener('click', () => overlay.remove());
  modal.querySelector('#_us_cancel').addEventListener('click', () => overlay.remove());
  modal.querySelector('#_us_ok').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function renderTreeInto(container, rootNode, selectionSet, onChange, maxSoldiers) {
  function doRender() {
    container.innerHTML = '';

    const estMemo = new Map();
    const est = (node) => {
      if (!estMemo.has(node)) estMemo.set(node, estimateSoldiers(node));
      return estMemo.get(node);
    };
    const countSelectedSoldiers = () => {
      let s = 0;
      forEachWithPath(rootNode, (node, path) => {
        if (path && selectionSet.has(path)) s += est(node);
      });
      return s;
    };

    function renderNode(node, depth, path, ancestorSelected) {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:8px;
        padding:4px 6px;padding-left:${depth * 14 + 6}px;
        border-radius:4px;font-size:12px;user-select:none;
        transition:background .12s;`;

      const isDirectlySelected = selectionSet.has(path);
      const isDisabled = ancestorSelected;
      const isChecked = isDirectlySelected || ancestorSelected;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.disabled = isDisabled;
      cb.style.cssText = 'margin:0;flex-shrink:0;';
      if (isDisabled) cb.style.cursor = 'not-allowed';

      const symWrap = document.createElement('div');
      symWrap.style.cssText = `width:32px;height:26px;flex-shrink:0;
        display:flex;align-items:center;justify-content:center;
        background:#dce8f7;border-radius:3px;overflow:hidden;`;
      try {
        const svg = buildSymbol(node.type, node.echelon, node.custom);
        symWrap.innerHTML = svg.replace(
          /<svg([^>]*)>/,
          '<svg$1 style="width:100%;height:100%;display:block;">'
        );
      } catch (e) {
        symWrap.textContent = '?';
      }

      const nameSpan = document.createElement('span');
      nameSpan.textContent = node.name || '(未命名)';
      nameSpan.style.cssText = 'flex:1;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      if (node.children && node.children.length) {
        nameSpan.style.fontWeight = '600';
      }

      const echSpan = document.createElement('span');
      echSpan.textContent = ECHELONS[node.echelon]?.name || '';
      echSpan.style.cssText = 'color:#64748b;font-size:10px;flex-shrink:0;';

      const soldierSpan = document.createElement('span');
      soldierSpan.textContent = '≈' + est(node).toLocaleString() + '人';
      soldierSpan.style.cssText = 'color:#fbbf24;font-size:10px;flex-shrink:0;';

      row.appendChild(cb);
      row.appendChild(symWrap);
      row.appendChild(nameSpan);
      row.appendChild(echSpan);
      row.appendChild(soldierSpan);

      if (isDisabled) {
        // 由上级单位自动勾选 → 锁定：勾选态可见，但不允许单独改动
        row.style.opacity = '0.7';
        row.style.cursor = 'not-allowed';
        const lockSpan = document.createElement('span');
        lockSpan.textContent = '🔒';
        lockSpan.title = '已由上级单位自动勾选（锁定）';
        lockSpan.style.cssText = 'font-size:10px;flex-shrink:0;';
        row.appendChild(lockSpan);
      } else {
        row.style.cursor = 'pointer';

        const tryToggle = () => {
          if (isDirectlySelected) {
            applySelection(path, false, selectionSet);
          } else {
            // 建议参战人数只作"参考"：超出时闪红警告，但不阻止选择
            if (maxSoldiers > 0 && countSelectedSoldiers() + est(node) > maxSoldiers) {
              row.style.background = 'rgba(239,68,68,.3)';
              setTimeout(() => { row.style.background = ''; }, 250);
            }
            applySelection(path, true, selectionSet);
          }
          if (onChange) onChange();
          doRender();
        };

        cb.addEventListener('change', e => {
          e.stopPropagation();
          tryToggle();
        });
        row.addEventListener('click', e => {
          if (e.target !== cb) tryToggle();
        });
        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(59,130,246,.1)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
      }

      container.appendChild(row);

      const nextAncestorSelected = ancestorSelected || isDirectlySelected;
      if (node.children && node.children.length) {
        node.children.forEach((c, i) => {
          renderNode(c, depth + 1, path ? `${path}/${i}` : String(i), nextAncestorSelected);
        });
      }
    }

    if (rootNode.children && rootNode.children.length) {
      rootNode.children.forEach((c, i) => renderNode(c, 0, String(i), false));
    } else {
      renderNode(rootNode, 0, '', false);
    }
  }

  doRender();
  return { sync: doRender };
}

/* ============================================================
   8) 开始 / 暂停 / 重置
   ============================================================ */
async function startBattle() {
  const blueKey = $('blue-army').value;
  const redKey  = $('red-army').value;
  let echelon = $('echelon').value || 'platoon';
  selectedMapId = $('battle-map')?.value || selectedMapId;
  const mode  = $('battle-mode').value || 'encounter';
  if (!blueKey || !redKey) return;

  if (!SUPPORTED_ECHELONS.includes(echelon)) {
    Dlg.alert('此版本仅支持排级及以下。已自动降级到排级。');
    echelon = 'platoon';
    $('echelon').value = 'platoon';
  }

  let saves = {};
  try { saves = JSON.parse(localStorage.getItem(SAVES_KEY) || '{}'); }
  catch (e) { return; }
  const blueSaved = saves[blueKey];
  const redSaved  = saves[redKey];
  if (!blueSaved || !redSaved) { Dlg.alert('存档已丢失'); return; }

  let blueRoot, redRoot;
  try {
    blueRoot = deserializeOrg(JSON.parse(JSON.stringify(blueSaved.data)));
    redRoot  = deserializeOrg(JSON.parse(JSON.stringify(redSaved.data)));
  } catch (e) { Dlg.alert('编制反序列化失败：' + e.message); return; }

  if (!unitSelection.blue) {
    unitSelection.blue = new Set();
    autoSelectEchelon(blueRoot, echelon, unitSelection.blue);
  }
  if (!unitSelection.red) {
    unitSelection.red = new Set();
    autoSelectEchelon(redRoot, echelon, unitSelection.red);
  }
  // 「建议参战人数」只作参考：大幅超出（>2×）时提醒一次，仍可选择继续
  const suggestedSoldiers = getMapMaxSoldiers();
  const selSoldiers = Math.max(
    selectionSoldiers(blueRoot, unitSelection.blue),
    selectionSoldiers(redRoot,  unitSelection.red)
  );
  if (suggestedSoldiers > 0 && selSoldiers > suggestedSoldiers * 2) {
    const ok = await Dlg.confirm(
      `当前参战人数约 ${selSoldiers.toLocaleString()} 人/侧，\n` +
      `已远超该地图建议的 ${suggestedSoldiers.toLocaleString()} 人。\n\n` +
      `继续可能会导致加载变慢、帧率下降。\n仍要开战吗？`
    );
    if (!ok) return;
  }

  const maxUnits = getMapMaxUnits();
  const blueUnits = buildUnitsFromArmy(blueRoot, 'blue', echelon, unitSelection.blue, maxUnits);
  const redUnits  = buildUnitsFromArmy(redRoot,  'red',  echelon, unitSelection.red,  maxUnits);
  assignFormationSlots(blueUnits);
  assignFormationSlots(redUnits);

  if (!blueUnits.length || !redUnits.length) {
    Dlg.alert('任一方没有可参战的单位。请点击「👥 选择参战」调整。');
    return;
  }

  // ★ 未选地图 → 从**官方地图池**里随机挑一张（R9.6.10：不再写死 4 个 id）
  if (!selectedMapId || !GRID_MAPS[selectedMapId]) {
    const pool = Object.values(GRID_MAPS).filter(gm => gm && !gm._isUserMap);
    const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    if (pick) {
      selectedMapId = pick.id;
      const mapSel = $('battle-map');
      if (mapSel) mapSel.value = selectedMapId;
    }
  }
  MAP_W = GRID_MAPS[selectedMapId].w;
  MAP_H = GRID_MAPS[selectedMapId].h;

  battle.mode = mode;              // ★ 必须在 generateTerrain 之前（遭遇战自动据点 / 攻防守方初占都要用到）
  generateTerrain();

  if (mode === 'encounter') {
    layoutUnits(blueUnits, 'neutral');
    layoutUnits(redUnits, 'neutral');
  } else if (mode === 'assault') {
    layoutUnits(blueUnits, 'attacker');
    layoutUnits(redUnits, 'defender');
  } else if (mode === 'defend') {
    layoutUnits(redUnits, 'attacker');
    layoutUnits(blueUnits, 'defender');
  }

  /* ★★★ R9.6.11：**建筑状态每局重置**（上一局塌了的楼不能带到这一局） */
  resetBuildingsForBattle();

  battle.units = [...blueUnits, ...redUnits];
  battle._groups = {};
  /* ★★★ R9.5：新一局 ⇒ **清空命令层与选中**（否则会拿上一局的玩家命令指挥新部队） */
  if (typeof Cmd !== 'undefined') Cmd.state = {};
  battle.selection = [];
  battle.orderToast = null;
  battle.boxSel = null;
  battle.clickMark = null;                // ★ R9.5d
  battle.playerRide = {};                 // ★ R9.5c：新一局 ⇒ 上下车意图清空
  battle._marks = null;
  battle._nextMarkUpdate = 0;
  battle._nextArtyRoleCheck = 0;
  battle._houseOccupants = {};
  battle._bldOccTime = -1;       // ★ R9.6.9：楼内占用表（每帧重算）
  battle._lastObjCheck = 0;
  battle._lastCaptureMsg = null;
  initTickets();                     // ★ 票池 = 胜利分 = 士气池

  for (const u of battle.units) {
    const path = u.formationPath || '';
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : 'root';
    u._groupKey = u.side + '|' + parentPath;
    if (!battle._groups[u._groupKey]) {
      battle._groups[u._groupKey] = { objectiveId: null, lockUntil: 0, stance: 'assault', nextStanceCheck: 0 };
    }
  }
  for (const gk of Object.keys(battle._groups)) {
    battle._groups[gk].stance = 'assault';
    assignGroupRoles(gk, null);
  }

  battle.tracers = [];
  battle.explosions = [];
  battle.shells = [];
  battle.corpses = [];               // ★ R9.6.11：尸体灰点（局内永久）
  battle.time = 0;
  battle.ended = false;
  battle.paused = false;
  battle.nextObjectiveCheck = 0;
  battle.blueName = blueKey;
  battle.redName = redKey;

  $('hint').classList.add('hidden');
  $('result-overlay').classList.add('hidden');
  const pauseBtn = $('btn-pause');
  pauseBtn.disabled = false;
  pauseBtn.textContent = '⏸ 暂停';
  pauseBtn.classList.remove('active-pause');

  resetCamera();
  drawBattlefield();
  await preloadAllSymbols(battle.units);

  battle.running = true;
  battle.lastTime = performance.now();
  requestAnimationFrame(gameLoop);
}

function togglePause() {
  if (!battle.running) return;
  battle.paused = !battle.paused;
  const btn = $('btn-pause');
  btn.textContent = battle.paused ? '▶ 继续' : '⏸ 暂停';
  btn.classList.toggle('active-pause', battle.paused);
  if (!battle.paused) {
    battle.lastTime = performance.now();
    requestAnimationFrame(gameLoop);
  }
}

function resetBattle() {
  battle.running = false;
  battle.paused = false;
  battle.ended = false;
  battle.units = [];
  battle._groups = {};
  battle._marks = null;
  battle._nextMarkUpdate = 0;
  battle._nextArtyRoleCheck = 0;
  battle.tracers = [];
  battle.explosions = [];
  battle.shells = [];
  battle.corpses = [];               // ★ R9.6.11：重置也要清尸体
  battle.objectives = [];
  battle.tickets = null;
  battle.pointCount = null;
  battle.gridMap = null;
  battle.gridCanvas = null;
  battle._houseOccupants = null;
  battle.time = 0;
  MAP_W = 2000; MAP_H = 1300;
  $('hint').classList.remove('hidden');
  $('result-overlay').classList.add('hidden');
  $('btn-pause').disabled = true;
  resetCamera();
  drawBattlefield();
}

/* ============================================================
   9) 主循环
   ============================================================ */
/* ★ R7.7：**永不停机**。旧版"连续异常 > 600 帧 ⇒ `battle.running = false`"——
   一旦触发，末尾的 `requestAnimationFrame` 就不再执行 ⇒ **rAF 链彻底断掉**，
   玩家看到的就是"突然全体不动了，而且再也动不了"（连 HUD 都不再更新）。
   现在：异常一律"记录 + 显示在页面上"，主循环**一定继续**（宁可画面降级，也不让战场冻死）。 */
/* ★ R7.7：弹幕 / 爆炸 / 炮弹上限（治"战斗后期越来越重 ⇒ 彻底卡死"） */
const MAX_TRACERS = 1500;
const MAX_EXPLOSIONS = 400;
const MAX_SHELLS = 120;

/* ★★★ R9.6.11：**曳光弹的"物理"**（玩家反馈："曳光弹现在长得像激光一样不太好"）
   ------------------------------------------------------------
   旧版：每发弹 push 一条"枪口 → 目标"的**整条直线**，0.25 秒淡出 ⇒ 看起来就是从枪口
         连到目标的一根激光。现在改成**一小段亮痕沿弹道前进**：
     · TRACER_SPEED：弹头速度（m/s）—— 曳光弹一亮就飞出去，所以看起来是"短划在动"
     · TRACER_DASH ：亮痕长度（米）—— 太长就又变激光了（130m ≈ 步枪弹 0.15 秒的行程）
     · TRACER_LIFE ：存活时间（秒）—— 打不到头的远距离弹会在空中淡掉（真实感）
   仅对**直射武器**生效；炮兵走 `battle.shells`（抛物线炮弹），不受影响。 */
const TRACER_SPEED = 900;
const TRACER_DASH = 130;
const TRACER_LIFE = 0.45;

function gameLoopFrame(timestamp) {
  if (!battle.running) return;
  const dt = Math.min(0.05, (timestamp - battle.lastTime) / 1000);
  battle.lastTime = timestamp;
  if (battle.paused) return;

  const scaledDt = Math.min(0.1, dt * battle.speed);



  /* ★ 帧耗时看门狗：只在"这一帧明显超时"时打印一次，直接指出是逻辑还是绘制慢
     —— 以后万一还有卡顿，按 F12 看 Console 就能定位（也便于我远程诊断）。*/
  const _tA = performance.now();
  if (!battle.ended) {
    updateBattle(scaledDt);
    battle.time += scaledDt;
    if (battle.time >= MAX_BATTLE_TIME) endBattle(decideTimeoutWinner(), '时间到');
  }
  const _tB = performance.now();

  for (const s of battle.shells) {
    s.t += scaledDt;
    const p = Math.min(1, s.t / s.duration);
    s.x = s.sx + (s.tx - s.sx) * p;
    s.y = s.sy + (s.ty - s.sy) * p;
    if (s.t >= s.duration && !s.done) {
      s.done = true;
      applyArtilleryBlast(s);
    }
  }
  battle.shells = battle.shells.filter(s => !s.done);

  /* ★ R7.7：弹幕 / 爆炸 / 炮弹**加上限** —— 旧版只有"按年龄过滤"，战斗越打越激烈时它们无界增长
     （几十秒的炮击就能堆到几千条弹道）⇒ 绘制与炮击结算越来越重 ⇒ **几分钟后整个卡死**。 */
  if (battle.tracers.length > MAX_TRACERS) battle.tracers.splice(0, battle.tracers.length - MAX_TRACERS);
  if (battle.explosions.length > MAX_EXPLOSIONS) battle.explosions.splice(0, battle.explosions.length - MAX_EXPLOSIONS);
  if (battle.shells.length > MAX_SHELLS) battle.shells.splice(0, battle.shells.length - MAX_SHELLS);

  drawBattlefield();
  renderDebugOverlay();
  const _tC = performance.now();
  const _logicMs = _tB - _tA, _drawMs = _tC - _tB;
  battle._logicMs = _logicMs; battle._drawMs = _drawMs;      // ★ R7.7：屏上诊断条要用
  /* ★★ R8：慢帧取证 —— 记住最近 40 次"明显卡顿"的帧，并指出**是哪一段慢**：
     ① 顶栏显示最近一次峰值  ② dev-panel 的「📋 卡顿取证」按钮 / F8 导出（console.table + 剪贴板 JSON） */
  if (!battle._slow) battle._slow = [];
  if (_logicMs + _drawMs > 40) {
    const pf = battle._prof || {};
    const n = k => Math.round((pf[k] || 0) * 10) / 10;
    const parts = [['分离', n('sep')], ['视野', n('vis')], ['密度', n('dens')], ['AI', n('ai')], ['移动', n('move')]];
    parts.sort((a, b) => b[1] - a[1]);
    const rec = {
      t: Math.round(battle.time * 10) / 10,
      逻辑: Math.round(_logicMs), 绘制: Math.round(_drawMs), 单位: battle.units.length,
      最慢段: parts[0][0] + ' ' + parts[0][1] + 'ms',
      分离: n('sep'), 视野: n('vis'), 密度: n('dens'), AI: n('ai'), 移动: n('move'),
      其它: Math.max(0, Math.round(_logicMs - (pf.sep || 0) - (pf.vis || 0) - (pf.dens || 0) - (pf.ai || 0) - (pf.move || 0))),
      视野层: visionOverlay ? '开' : '关',
    };
    battle._slow.push(rec);
    if (battle._slow.length > 40) battle._slow.shift();
    battle._slowPeak = rec;
  }
  if (_logicMs > 120 || _drawMs > 120) {
    console.warn(`[perf] 帧超时：逻辑 ${_logicMs.toFixed(0)}ms ／ 绘制 ${_drawMs.toFixed(0)}ms` +
                 `（单位 ${battle.units.length} · 视野层 ${visionOverlay ? '开' : '关'}` +
                 `）`);
  }

  battle.tracers.forEach(t => t.age += dt);
  battle.tracers = battle.tracers.filter(t => t.age < TRACER_LIFE);   // ★ R9.6.11：短划需要更长的"飞行时间"
  battle.explosions.forEach(e => e.age += dt);
  battle.explosions = battle.explosions.filter(e => e.age < (e.maxAge || 0.9));

}

/* ★★ 主循环自愈（本次修的"单位不动"根因防护）
   ------------------------------------------------------------
   旧版：帧内任何异常（逻辑或绘制）都会**中断 gameLoop** ⇒ 末尾的
   requestAnimationFrame 不再执行 ⇒ 整个战场冻住，控制台只剩刷错。
   这次就是这样：寻路诊断面板里一个删除残留的变量 `rc` 抛 ReferenceError
   （按 P 或拖动窗口 ⇒ resizeCanvas ⇒ drawBattlefield 都会触发）⇒ 单位不动。
   现在：捕获 → 每秒最多打印一次 → **继续下一帧**；R7.7 起**永不停机**（异常上屏，见 drawBattleHud）。 */
function gameLoop(timestamp) {
  if (!battle.running) return;
  try {
    gameLoopFrame(timestamp);
    battle._loopErrs = 0;                     // ★ 这一帧成功 ⇒ 计数清零（只看"连续"异常）
  } catch (err) {
    battle._loopErrs = (battle._loopErrs || 0) + 1;
    battle._loopErrMsg = (err && (err.message || String(err))) || '未知异常';
    const now = performance.now();
    if (now - (battle._loopErrAt || 0) > 1000) {
      battle._loopErrAt = now;
      console.error(`[loop] 已捕获帧异常（连续第 ${battle._loopErrs} 次，主循环继续跑）`, err);
    }
    /* ★ R7.7：**不再停机** —— 旧版"连续异常 > 600 ⇒ battle.running = false"会让 rAF 链彻底断掉
       ⇒ 战场永久冻死（而且在画面上完全看不出来）。
       现在只在屏上标出来（见 drawBattleHud 的红色诊断行），主循环一定继续。 */
  }
  if (battle.running && !battle.paused) requestAnimationFrame(gameLoop);
}

function assignArtilleryRoles() {
  for (const side of ['blue', 'red']) {
    const myArty = battle.units.filter(u =>
      u.alive && u.side === side && u.isArtilleryUnit
    );
    if (!myArty.length) continue;

    const ghostSet = new Set();
    for (const a of myArty) {
      for (const e of (a.visibleEnemies || [])) {
        if (e.isGhost && e.alive) ghostSet.add(e.id);
      }
    }
    const ghostCount = ghostSet.size;

    const marks = battle._marks ? battle._marks[side] : null;
    const hasFrontlineTargets = marks && marks.size > 0;

    myArty.sort((a, b) => (a.formationIndex || 0) - (b.formationIndex || 0));

    const counterCount = Math.min(ghostCount, Math.ceil(myArty.length / 2));
    const supportCount = hasFrontlineTargets
      ? Math.min(myArty.length - counterCount, myArty.length)
      : 0;

    for (let i = 0; i < myArty.length; i++) {
      const a = myArty[i];
      let newRole;
      if (i < counterCount) newRole = 'counter';
      else if (i < counterCount + supportCount) newRole = 'support';
      else newRole = 'counter';

      if (a._artyRole !== newRole) {
        a._artyRole = newRole;
        a.target = null;
        a.targetCacheTime = -1;
        for (const w of a.weapons) {
          w.target = null;
          w.targetCacheTime = -1;
        }
      }
    }
  }
}

function evaluateArtilleryRelocation(unit) {
  if (!unit.isArtilleryUnit) return;

  if (unit._lastArtyShotAt && battle.time - unit._lastArtyShotAt < ARTY_RELOCATE_COOLDOWN) return;
  if (unit._needsUndeploy || unit._relocateTarget) return;

  let threat = 0;
  let tx = 0, ty = 0, tw = 0;

  for (const e of battle.units) {
    if (!e.alive || e.side === unit.side || e.isArtilleryUnit) continue;
    const d = Math.hypot(e.x - unit.x, e.y - unit.y);
    if (d < ARTY_THREAT_RADIUS) {
      const w = 1 - d / ARTY_THREAT_RADIUS;
      threat += w * 2;
      tx += e.x * w; ty += e.y * w; tw += w;
    }
  }

  const exposedFor = battle.time - (unit.lastArtilleryFireTime || -999);
  if (exposedFor > 3 && exposedFor < 20) threat += 1.2;

  if (unit.visibleEnemies) {
    let ghostNear = 0;
    for (const e of unit.visibleEnemies) {
      if (e.isGhost && e.alive) {
        const d = Math.hypot(e.x - unit.x, e.y - unit.y);
        if (d < 2000) ghostNear++;
      }
    }
    if (ghostNear > 0) threat += 0.8;
  }

  if (threat < 1.2) return;

  let dirX, dirY;
  if (tw > 0.01) {
    dirX = unit.x - (tx / tw);
    dirY = unit.y - (ty / tw);
  } else {
    const a = Math.random() * Math.PI * 2;
    dirX = Math.cos(a); dirY = Math.sin(a);
  }
  const len = Math.hypot(dirX, dirY) || 1;
  dirX /= len; dirY /= len;

  const dist = ARTILLERY_RELOCATE_MIN + Math.random() * (ARTILLERY_RELOCATE_MAX - ARTILLERY_RELOCATE_MIN);
  const ntx = Math.max(50, Math.min(MAP_W - 50, unit.x + dirX * dist));
  const nty = Math.max(50, Math.min(MAP_H - 50, unit.y + dirY * dist));

  unit._relocateTarget = { x: ntx, y: nty };
  unit._needsUndeploy = true;
}

function evaluateGroupStance(groupKey) {
  const gs = battle._groups && battle._groups[groupKey];
  if (!gs) return;
  if (battle.time < (gs.nextStanceCheck || 0)) return;
  gs.nextStanceCheck = battle.time + 3 + Math.random() * 3;

  const units = battle.units.filter(u => u.alive && u._groupKey === groupKey);
  if (!units.length) return;

  const side = units[0].side;
  const isDefender = (battle.mode === 'assault' && side === 'red') ||
                     (battle.mode === 'defend' && side === 'blue');

  const totalHp = units.reduce((s, u) => s + u.hpPersonnel, 0);
  const totalHpMax = units.reduce((s, u) => s + u.hpPersonnelMax, 0);
  const hpRatio = totalHpMax > 0 ? totalHp / totalHpMax : 1;

  let nearbyEnemies = 0, nearbyAllies = 0;
  const cx = units.reduce((s, u) => s + u.x, 0) / units.length;
  const cy = units.reduce((s, u) => s + u.y, 0) / units.length;
  for (const u of battle.units) {
    if (!u.alive) continue;
    const d = Math.hypot(u.x - cx, u.y - cy);
    if (d < 1500) {
      if (u.side === side) nearbyAllies++;
      else nearbyEnemies++;
    }
  }

  let newStance;
  if (hpRatio < 0.35) newStance = 'reserve';
  else if (isDefender) newStance = 'defend';
  else if (nearbyEnemies > nearbyAllies * 1.5) newStance = 'defend';
  else newStance = 'assault';

  if (gs.stance === newStance) return;
  gs.stance = newStance;
  gs.lockUntil = battle.time + 8;
}

function updateBattle(dt) {
  const aliveBlue = battle.units.filter(u => u.side === 'blue' && u.alive);
  const aliveRed  = battle.units.filter(u => u.side === 'red'  && u.alive);
  if (!aliveBlue.length && !aliveRed.length) return endBattle('draw', '两败俱伤');
  if (!aliveBlue.length) return endBattle('red',  '蓝方全军覆没');
  if (!aliveRed.length)  return endBattle('blue', '红方全军覆没');

  updateObjectiveControl();
  updateFrontlineMarks();

  /* ★ R9.5：选中列表清理（阵亡的剔除）+ 命令条信息每 0.5 秒刷新一次（不用每帧动 DOM） */
  if (battle.selection && battle.selection.length) {
    battle.selection = battle.selection.filter(u => u.alive);
  }
  if (!battle._nextCmdbarAt || battle.time >= battle._nextCmdbarAt) {
    battle._nextCmdbarAt = battle.time + 0.5;
    if (battle.playerSide) updateCmdBar();
  }

  /* ★ 胜利分 / 据点：结束判定 */
  if (battle.tickets) {
    if (battle.tickets.blue <= 0 && battle.tickets.red <= 0) return endBattle('draw', '双方战意耗尽');
    if (battle.tickets.blue <= 0) return endBattle('red',  '蓝方战意耗尽（胜利分归零）');
    if (battle.tickets.red  <= 0) return endBattle('blue', '红方战意耗尽（胜利分归零）');
  }
  const defSide = defenderSide();
  if (defSide && battle.objectives && battle.objectives.length) {
    const atk = defSide === 'blue' ? 'red' : 'blue';
    if (battle.objectives.every(o => o.owner === atk)) {
      return endBattle(atk, '攻方占领全部据点');
    }
  }

  if (!battle._nextArtyRoleCheck || battle.time >= battle._nextArtyRoleCheck) {
    assignArtilleryRoles();
    battle._nextArtyRoleCheck = battle.time + 2;
  }

  if (battle._groups) {
    for (const gk of Object.keys(battle._groups)) {
      /* ★★★ R9.5b：**玩家操控的阵营不算 AI 战法** —— 执行层不许替玩家做决定
         （战法会改变推进节奏/找掩体倾向，玩家会看成"部队不听我的自己动"）。 */
      if (battle.playerSide && gk.indexOf(battle.playerSide + '|') === 0
          && !(battle.aiEnabled && battle.aiEnabled[battle.playerSide])) continue;
      /* ★★★ R9.2：**旧战法自动评估让位** —— 组里有"带战法的现行命令"时，战法由将军层定
         （`ord.stance` → `mirrorGroupStance`），这里不许再抢写，否则又是"两个写者"。
         没有命令时（`?gen=0` / 脚本没给）才继续用这套旧的自动评估（兜底，机制不删）。 */
      const co = (typeof Cmd !== 'undefined') ? Cmd.current(gk) : null;
      if (!co || co.done || !co.stance) evaluateGroupStance(gk);
    }
  }

  /* ============================================================
     ★★★ R9：命令层 + 将军层（每帧）
     ------------------------------------------------------------
     顺序：先判定**上一轮命令**是否完成（到达 / 目标消灭 / 已就位），
           再让将军思考并下发新命令。
     · 将军（ai-general.js）每 3~6 秒想一次，**只调用 Cmd.issue()**，
       绝不直接改 moveTarget / objectiveId ⇒ "谁在意图"从 6 处收敛成 1 处。
     · 这里只做两件事，且都用 try/catch 包住 —— 命令层出问题绝不能让
       整个战场停摆（旧版"一个异常 ⇒ rAF 链断掉 ⇒ 永久冻死"的教训）。
     ============================================================ */
  if (typeof Cmd !== 'undefined') {
    try { Cmd.tick(); } catch (e) { console.error('[Cmd] tick 异常：', e); }
  }
  if (window.General) {
    try { window.General.tick(); } catch (e) { console.error('[General] tick 异常：', e); }
  }

  /* ★★ R9.2：把命令层的**据点 + 战法**镜像进组状态（执行层只读这两个字段）
     —— 这样"执行层读 gs.objectiveId / gs.stance"的老机制**一行都不用改**。 */
  if (typeof Cmd !== 'undefined' && battle._groups) {
    for (const gk of Object.keys(battle._groups)) {
      const o = Cmd.current(gk);
      if (!o || o.done) continue;
      if (o.objectiveId && o.type !== 'SET_STANCE') mirrorGroupObjective(gk, o.objectiveId);
      if (o.stance) mirrorGroupStance(gk, o.stance);
    }
  }

  /* ★ R8：每帧清零分段计时（只统计，不改行为）—— 用来回答"整体静止到底是哪一段慢" */
  battle._prof = { sep: 0, vis: 0, dens: 0, ai: 0, move: 0 };
  for (const unit of battle.units) {
    if (!unit.alive) continue;
    try {
      evaluateArtilleryRelocation(unit);
      updateUnit(unit, dt);
    } catch (err) {
      // ★ 单个单位抛异常不能静默中断"后续所有单位"的更新（会表现为全战场停摆/零射击）
      if (!battle._unitErrorLogged) {
        battle._unitErrorLogged = true;
        console.error('updateUnit 异常（本帧已跳过该单位）：', unit && unit.name, err);
      }
    }
  }
}

/* ============================================================
   9.5) 胜利分（票池）+ 渐进占领
   票池 = 胜利分 = 士气池：阵亡 / 载具 / 据点差 bleed / （攻防）据点被攻占
   ============================================================ */
function defenderSide() {
  if (battle.mode === 'assault') return 'red';
  if (battle.mode === 'defend')  return 'blue';
  return null;
}
function attackerSide() {
  const d = defenderSide();
  return d ? (d === 'blue' ? 'red' : 'blue') : null;
}

function initTickets() {
  const men = side => battle.units
    .filter(u => u.side === side && u.alive)
    .reduce((a, u) => a + u.soldiers.length, 0);
  const base = Math.max(TICKETS_MIN, men('blue'), men('red'));
  const defSide = defenderSide();
  battle.tickets = {
    blue: base + (defSide === 'blue' ? ASSAULT_DEFENDER_BONUS : 0),
    red:  base + (defSide === 'red'  ? ASSAULT_DEFENDER_BONUS : 0),
  };
  battle.ticketsMax = { blue: battle.tickets.blue, red: battle.tickets.red };
  battle.pointCount = { blue: 0, red: 0, neutral: (battle.objectives || []).length };
}

function spendTickets(side, n) {
  if (!battle.tickets || !side || !n) return;
  battle.tickets[side] = Math.max(0, battle.tickets[side] - n);
}

/* 据点被攻占（★ 只在攻防战给一次性奖励；遭遇战靠持续 bleed） */
function onObjectiveCaptured(o, side) {
  const defSide = defenderSide();
  if (!defSide) return;
  if (side === defSide) return;                      // 守方夺回自己的点 → 不给
  spendTickets(defSide, CAPTURE_BONUS);
  battle._lastCaptureMsg = { side, name: o.name, t: battle.time };
}

/* 每秒结算：据点差 → 让"少点的一方"持续掉票 */
function updateTickets() {
  if (!battle.tickets || !battle.objectives || !battle.objectives.length) return;
  let blue = 0, red = 0;
  for (const o of battle.objectives) {
    if (o.owner === 'blue') blue++;
    else if (o.owner === 'red') red++;
  }
  battle.pointCount = { blue, red, neutral: battle.objectives.length - blue - red };
  const diff = blue - red;
  if (diff > 0) spendTickets('red', diff * TICKET_BLEED_PER_POINT);
  else if (diff < 0) spendTickets('blue', -diff * TICKET_BLEED_PER_POINT);
}

/* 超时判胜：遭遇战比票；攻防战守方胜（攻方已拿下 ≥ 半数据点则攻方胜） */
function decideTimeoutWinner() {
  const defSide = defenderSide();
  if (defSide) {
    const atk = defSide === 'blue' ? 'red' : 'blue';
    const pts = battle.objectives || [];
    const taken = pts.filter(o => o.owner === atk).length;
    if (pts.length && taken * 2 >= pts.length) return atk;
    return defSide;
  }
  const t = battle.tickets;
  if (!t) return 'draw';
  if (t.blue > t.red) return 'blue';
  if (t.red > t.blue) return 'red';
  return 'draw';
}

/* 遭遇战没有据点时自动生成中立争夺点（否则 AI 没有目标函数） */
function autoEncounterObjectives(gm) {
  const r = Math.max(180, Math.round(Math.min(gm.w, gm.h) * 0.08));
  const pts = [];
  const alongX = gm.w >= gm.h;
  for (let i = 0; i < ENCOUNTER_AUTO_POINTS; i++) {
    const t = (i + 1) / (ENCOUNTER_AUTO_POINTS + 1);
    pts.push({
      x: Math.round(alongX ? gm.w * t : gm.w * 0.5),
      y: Math.round(alongX ? gm.h * 0.5 : gm.h * t),
      r, name: '争夺点 ' + (i + 1), _auto: true,
    });
  }
  return pts;
}

function updateObjectiveControl() {
  if (!battle.objectives || !battle.objectives.length) return;
  if (battle.time < battle.nextObjectiveCheck) return;
  const dt = Math.min(2.5, Math.max(0.2, battle.time - (battle._lastObjCheck || battle.time - 1)));
  battle._lastObjCheck = battle.time;
  battle.nextObjectiveCheck = battle.time + 1;

  for (const o of battle.objectives) {
    let blue = 0, red = 0;
    const r2 = o.r * o.r;
    for (const u of battle.units) {
      if (!u.alive) continue;
      // S-E：占点按"士兵人数"判定（不是兵牌数）
      for (const s of u.soldiers) {
        if (!s.alive) continue;
        const dx = s.x - o.x, dy = s.y - o.y;
        if (dx * dx + dy * dy < r2) {
          if (u.side === 'blue') blue++;
          else red++;
        }
      }
    }
    o.blueCount = blue;
    o.redCount = red;

    /* ★ 渐进占领：cap ∈ [-1, +1]（+1 = 蓝方完全控制，-1 = 红方完全控制） */
    if (o.cap === undefined || o.cap === null) o.cap = 0;
    const net = blue - red;
    if (net !== 0) {
      const rate = Math.min(1, Math.abs(net) / CAPTURE_MEN_FULL) / CAPTURE_SECONDS;
      o.cap = Math.max(-1, Math.min(1, o.cap + Math.sign(net) * rate * dt));
    }
    /* 易主：只有推到 ±1 才换主人（中间是"争夺中"，原主保留） */
    if (o.cap >= 1) {
      if (o.owner !== 'blue') { o.owner = 'blue'; onObjectiveCaptured(o, 'blue'); }
    } else if (o.cap <= -1) {
      if (o.owner !== 'red') { o.owner = 'red'; onObjectiveCaptured(o, 'red'); }
    }
  }

  updateTickets();
}

/* ============================================================
   10) 压制系统
   ============================================================ */
/* 士兵级压制：抑制 (x,y) 半径内的士兵（弹雨落点附近的人被压住） */
function applySuppressionAt(unit, x, y, amount, radius) {
  if (!unit || !unit.alive || !unit.soldiers) return;
  const r2 = radius * radius;
  const now = battle.time;
  for (const s of unit.soldiers) {
    if (!s.alive) continue;
    const dx = s.x - x, dy = s.y - y;
    if (dx * dx + dy * dy > r2) continue;
    /* ★ 每人每秒预算：无论落多少发，这个士兵每秒最多被加 SUPP_MAX_PER_SEC
       （旧模型"每发事件 +0.22"，250 发/秒 ⇒ 0.03 秒压满 ⇒ 双方互相钉死） */
    if (s._suppWindow === undefined || now - s._suppWindow > 1) {
      s._suppWindow = now;
      s._suppAcc = 0;
    }
    const room = SUPP_MAX_PER_SEC - (s._suppAcc || 0);
    if (room <= 0) continue;
    const add = Math.min(room, amount);
    s._suppAcc = (s._suppAcc || 0) + add;
    s.suppression = Math.min(1.5, (s.suppression || 0) + add);
    s.lastHitTime = now;
  }
}

/* 压制状态更新（士兵级）；单位压制状态 = "过半士兵被压制"（供 AI 用） */
function updateSuppression(unit, dt) {
  if (!unit.soldiers) return;
  let aliveCount = 0, suppressedCount = 0, suppSum = 0;
  for (const s of unit.soldiers) {
    if (!s.alive) continue;
    aliveCount++;

    const cover = getCoverAt(s.x, s.y);
    if (cover >= 0.35) {
      if (!s.inCoverSince) s.inCoverSince = battle.time;
    } else {
      s.inCoverSince = 0;
    }

    s.suppression = Math.max(0, (s.suppression || 0) - dt * SUPPRESSION_DECAY);
    suppSum += s.suppression;

    if (!s.suppressed && s.suppression > SUPPRESSION_THRESHOLD) {
      s.suppressed = true;
      s.suppressedUntil = battle.time + SUPPRESSION_NOFIRE_TIME;
    }

    if (s.suppressed) {
      const noFireFor = battle.time - (s.lastHitTime || 0);
      const inCoverFor = s.inCoverSince ? battle.time - s.inCoverSince : 0;
      if (noFireFor > SUPPRESSION_NOFIRE_TIME || inCoverFor > SUPPRESSION_INCOVER_TIME) {
        s.suppressed = false;
        s.suppression = 0;
        s.coverTarget = null;
      } else {
        suppressedCount++;
      }
    }
  }
  unit.suppressed = aliveCount > 0 && suppressedCount * 2 >= aliveCount;
  /* ★ 连续压制水平（0~1）：决策层与调试用；只有达到 SUPP_HARD 才算"被彻底压住" */
  unit.suppressionLevel = aliveCount > 0 ? Math.min(1, suppSum / aliveCount) : 0;
}

/* ============================================================
   11) 目标选择 & 移动
   ============================================================ */
/* ★★ R9：备弹（弹药）—— 打光 ⇒ 该武器打不出去（从火力清单/选靶里剔除）
   · 每件武器一份（士兵手里的枪 / 车上的炮）；开火一次扣 1（见 fireAt）；补给点可补 */
function weaponDry(w) { return !!w && w.ammo != null && w.ammo <= 0; }
function unitAmmoRatio(unit) {
  let cur = 0, max = 0;
  const acc = (w) => { if (!w || w.ammoMax == null) return; cur += Math.max(0, w.ammo || 0); max += Math.max(0, w.ammoMax || 0); };
  for (const s of (unit.soldiers || [])) if (s.alive) acc(s.weapon);
  for (const v of (unit.vehicles || [])) if (!v.destroyed && !v.abandoned) acc(v.weapon);
  return max > 0 ? cur / max : 1;
}

function pickWeaponTarget(weapon, unit) {
  if (weaponDry(weapon)) return null;   // ★ R9：弹药打光 ⇒ 不选靶 ⇒ 打不出去
  const visible = unit.visibleEnemies || [];

  const armored = visible.filter(t => t.alive && (t.armor || 0) > 0);
  const soft    = visible.filter(t => t.alive && (t.armor || 0) === 0);

  const isAT = weapon.category === 'at_weapon' ||
               weapon.category === 'at_gun' ||
               (weapon.penetration > 200 && weapon.antiArmor > weapon.antiPersonnel * 3);
  const isAP = weapon.category === 'small_arms' ||
               (weapon.antiPersonnel > weapon.antiArmor * 5);

  let candidates;
  if (weapon.isArtillery) {
    const realArty = visible.filter(t => t.alive && t.isArtilleryUnit && !t.isGhost);
    const ghostArty = visible.filter(t => t.alive && t.isArtilleryUnit && t.isGhost);
    const softTargets = visible.filter(t => t.alive && !t.isArtilleryUnit);

    if (unit._artyRole === 'counter') {
      if (ghostArty.length) candidates = ghostArty;
      else if (realArty.length) candidates = realArty;
      else candidates = softTargets.length ? softTargets : visible;
    } else {
      const mission = pickArtilleryMission(unit);
      if (mission) candidates = [mission];
      else if (softTargets.length) candidates = softTargets;
      else if (realArty.length) candidates = realArty;
      else if (ghostArty.length) candidates = ghostArty;
      else candidates = visible;
    }
  } else if (isAT) {
    candidates = armored.length ? armored : soft;
  } else if (isAP) {
    candidates = soft.length ? soft : armored;
  } else {
    candidates = visible;
  }

  if (!candidates.length) return null;

  let best = null, bestScore = Infinity;
  for (const other of candidates) {
    const dx = other.x - unit.x, dy = other.y - unit.y;
    const dist = Math.hypot(dx, dy);
    if (dist > weapon.range) continue;
    let score = dist;
    if (weapon.penetration >= (other.armor || 0)) score *= 0.7;
    score *= 0.85 + (other.hpPersonnel / other.hpPersonnelMax) * 0.15;
    const otherCover = getCoverAt(other.x, other.y);
    score *= (1 - otherCover * 0.4);
    const otherSpeed = Math.max(1, other.speed || 10);
    score *= 0.8 + Math.min(1, otherSpeed / 50) * 0.4;
    if (score < bestScore) { bestScore = score; best = other; }
  }
  return best;
}

function approachTarget(unit, target, stopDist) {
  const angle = unit.formationAngle || 0;
  const spread = Math.min(150, stopDist * 0.6);
  const offX = Math.cos(angle) * spread;
  const offY = Math.sin(angle) * spread;
  const tx = target.x + offX;
  const ty = target.y + offY;

  const dx = tx - unit.x;
  const dy = ty - unit.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d <= stopDist * 0.5) return null;
  return {
    x: tx - (dx / d) * stopDist * 0.5,
    y: ty - (dy / d) * stopDist * 0.5,
  };
}

function isUnitInCombatZone(unit) {
  for (const u of battle.units) {
    if (!u.alive || u.side === unit.side) continue;
    if (Math.hypot(u.x - unit.x, u.y - unit.y) < COMBAT_ZONE_RADIUS) return true;
  }
  if (battle.objectives && battle.objectives.length) {
    for (const o of battle.objectives) {
      if (Math.hypot(o.x - unit.x, o.y - unit.y) < o.r * 3) return true;
    }
  }
  return false;
}

/* ============================================================
   密度感知系统
   ============================================================ */
function getUnitFootprint(unit) {
  let fp = ECHELON_FOOTPRINT[unit.echelon] || 50;

  const hitAgo = battle.time - (unit.lastHitTime || -999);
  if (hitAgo < 10) fp *= 1.8;

  const cover = getCoverAt(unit.x, unit.y);
  if (cover < 0.2) fp *= 1.3;
  else if (cover > 0.6) fp *= 0.8;

  if (unit.visibleEnemies) {
    for (const e of unit.visibleEnemies) {
      if (e.isGhost) { fp *= 1.5; break; }
    }
  }

  return fp;
}

function getDensityWeight(unit) {
  if (unit.suppressed) return 0;
  if (unit.isArtilleryUnit) return 0;

  const role = unit._tacticalRole || 'main';
  const gs = battle._groups && battle._groups[unit._groupKey];
  const stance = gs ? (gs.stance || 'assault') : 'assault';

  let w = 1.0;

  if (role === 'main') w *= 0.5;
  else if (role === 'flank') w *= 0.7;
  else if (role === 'suppress') w *= 0.9;
  else if (role === 'reserve') w *= 1.2;
  else if (role === 'companion') w *= 0.8;

  if (stance === 'assault') w *= 0.7;
  else if (stance === 'defend') w *= 1.0;
  else if (stance === 'reserve') w *= 1.2;

  if (!isUnitInCombatZone(unit)) w *= 0.5;

  return w;
}

function computeDensityPerception(unit) {
  /* ★ R8 削峰：错峰（同视野）—— 旧版全场同帧一起算 ⇒ 每 0.3 秒一次同步尖峰 */
  if (unit._densNextAt == null) unit._densNextAt = battle.time + hashPhase(unit, DENSITY_UPDATE_INTERVAL);
  if (battle.time < unit._densNextAt) return;
  unit._densNextAt = battle.time + DENSITY_UPDATE_INTERVAL;
  unit._densityCacheTime = battle.time;

  const myFootprint = getUnitFootprint(unit);
  let pushX = 0, pushY = 0;
  let neighborCount = 0;
  let totalDist = 0;

  for (const other of battle.units) {
    if (other === unit || !other.alive) continue;
    if (other.side !== unit.side) continue;
    if (other._groupKey === unit._groupKey) continue;

    const dx = unit.x - other.x, dy = unit.y - other.y;
    const d = Math.hypot(dx, dy);
    if (d > DENSITY_SCAN_RADIUS || d < 1) continue;

    const otherFootprint = getUnitFootprint(other);
    const desired = myFootprint + otherFootprint;
    const crowdedThreshold = desired * DENSITY_CROWDED_THRESHOLD;

    totalDist += d;
    neighborCount++;

    if (d < crowdedThreshold) {
      const force = (crowdedThreshold - d) / crowdedThreshold;
      pushX += (dx / d) * force;
      pushY += (dy / d) * force;
    }
  }

  if (neighborCount === 0) {
    unit._densityPerception = 0;
    unit._densityOffset = null;
    return;
  }

  const avgDist = totalDist / neighborCount;
  const desiredAvg = myFootprint * 2 * 1.2;
  unit._densityPerception = (avgDist - desiredAvg) / desiredAvg;

  if (unit._densityOffset) {
    pushX = pushX * 0.6 + unit._densityOffset.x * 0.4;
    pushY = pushY * 0.6 + unit._densityOffset.y * 0.4;
  }

  const plen = Math.hypot(pushX, pushY);
  if (plen > 0.01) {
    unit._densityOffset = {
      x: pushX / plen * DENSITY_FORCE,
      y: pushY / plen * DENSITY_FORCE,
    };
  } else {
    unit._densityOffset = null;
  }
}

function applyDensityOffset(unit, moveTarget) {
  if (!moveTarget) return moveTarget;
  if (unit.isArtilleryUnit) return moveTarget;
  /* ★ R9.6：玩家操控的单位**不吃"密度横移"** —— 它们已经有"每个单位一个落点"
     （见 `unitTargetSlots`），再横移就是漂移。AI 的组命令仍靠它散开。 */
  if (STEER_ENTITY && typeof isPlayerCtl === 'function' && isPlayerCtl(unit)) return moveTarget;
  const w = unit._densityWeight || 0;
  if (w <= 0.01 || !unit._densityOffset) return moveTarget;
  return {
    x: moveTarget.x + unit._densityOffset.x * w,
    y: moveTarget.y + unit._densityOffset.y * w,
  };
}

/* ============================================================
   组角色 & 组目标
   ============================================================ */
function assignGroupRoles(groupKey, objective) {
  const lineUnits = [];
  const supportUnits = [];
  for (const u of battle.units) {
    if (!u.alive || u._groupKey !== groupKey || u.isArtilleryUnit) continue;
    if (u.isSupportUnit) supportUnits.push(u);
    else lineUnits.push(u);
  }
  if (!lineUnits.length && !supportUnits.length) return;

  lineUnits.sort((a, b) => (a.formationIndex || 0) - (b.formationIndex || 0));
  supportUnits.sort((a, b) => (a.formationIndex || 0) - (b.formationIndex || 0));

  const n = lineUnits.length;
  let roles;
  if (n === 0) roles = [];
  else if (n === 1) roles = ['main'];
  else if (n === 2) roles = ['main', 'flank'];
  else if (n === 3) roles = ['main', 'flank', 'suppress'];
  else if (n === 4) roles = ['main', 'main', 'flank', 'suppress'];
  else {
    roles = ['main', 'main', 'flank', 'flank', 'suppress'];
    while (roles.length < n) roles.push('reserve');
  }

  for (let i = 0; i < n; i++) {
    const u = lineUnits[i];
    u._tacticalRole = roles[i] || 'reserve';
    u._flankSide = (i % 2 === 0) ? 1 : -1;
    u._roleAssignedFor = objective ? objective._id : null;
  }

  for (const u of supportUnits) {
    u._tacticalRole = 'companion';
    u._flankSide = 1;
    u._roleAssignedFor = objective ? objective._id : null;
  }
}

const MIN_GARRISON = 2;

/* ============================================================
   ★★★ R9：**命令层 → 战术层**的唯一桥（cmd.js 是"组命令"唯一写者）
   ------------------------------------------------------------
   玩家定的减法规矩：将军层 / 玩家只负责"这一组去哪、打谁、守不守"，
   而"怎么摆队形、谁站哪个战位、炮兵站哪、支援 standoff 多少"**一行都不改**。
   做法：把命令里的 objectiveId **镜像**进 battle._groups[gk]（外加一个
   `cmdObjId` 标记"这个点是命令层指定的、不要重新评估"）
   ⇒ 下面原有的一整套目标 / 队形 / 分工 / 炮兵阵位逻辑照旧跑，
      改动面积最小 ⇒ 不可能引入新的抖动机制。
   ============================================================ */
function mirrorGroupObjective(groupKey, objectiveId) {
  if (!battle._groups) battle._groups = {};
  let gs = battle._groups[groupKey];
  if (!gs) {
    gs = battle._groups[groupKey] = { objectiveId: null, lockUntil: 0, stance: 'assault', nextStanceCheck: 0 };
  }
  gs.cmdObjId = objectiveId;
  if (gs.objectiveId === objectiveId) return;
  gs.objectiveId = objectiveId;
  gs.lockUntil = battle.time + 20;
  const o = battle.objectives.find(x => x._id === objectiveId);
  if (o) {
    assignGroupRoles(groupKey, o);
    for (const u of battle.units) {
      if (u._groupKey === groupKey) {
        u._slotAttemptStart = 0;
        u._wasAtSlot = false;
        u._wasOnRoad = undefined;
      }
    }
  }
}

/* ★★ R9.2：把命令里的**战法**镜像进组状态
   —— 执行层只"读" `battle._groups[gk].stance`（映射见 STANCE_TO_OPTION），
      这样"战法由谁决定"从"每个单位各算一遍"收敛成"将军按组算一次"。 */
function mirrorGroupStance(groupKey, stance) {
  if (!battle._groups) battle._groups = {};
  let gs = battle._groups[groupKey];
  if (!gs) {
    gs = battle._groups[groupKey] = { objectiveId: null, lockUntil: 0, stance: 'assault', nextStanceCheck: 0 };
  }
  if (gs.stance === stance) return;
  gs.stance = stance;
  gs.lockUntil = battle.time + 8;      // 换战法后 8 秒内不许被旧的自动评估翻回去
}

/* 该单位当前的**有效命令** —— ★ R9.5d：**单位级优先于组级**
   （玩家点谁命令谁 ⇒ `u:<id>` 只影响这一个单位；将军/脚本下的组命令整组一起动） */
function groupOrderOf(unit) {
  if (typeof Cmd === 'undefined' || !unit) return null;
  if (unit.id && typeof Cmd.current === 'function') {
    const uo = Cmd.current('u:' + unit.id);
    if (uo && !uo.done) return uo;
  }
  if (!unit._groupKey) return null;
  const o = Cmd.current(unit._groupKey);
  return (o && !o.done) ? o : null;
}

function computeObjectiveMove(unit, isDefender) {
  if (!battle.objectives || !battle.objectives.length) return null;

  /* ★ R9 命令层优先（cmd.js 是唯一写者）：
       · HOLD              ⇒ 原地固守（只保留"被压住找掩体"，由调用方处理）
       · 带 objectiveId    ⇒ 用命令指定的据点覆盖旧的"目标自动分配" */
  const gord0 = groupOrderOf(unit);
  if (gord0) {
    if (gord0.type === 'HOLD') {
      unit._cmdWhy = '命令HOLD（' + (gord0.src || 'ai') + '·' + (gord0.note || '') + '）';
      return null;
    }
    /* ★★ R9.2：**补给**命令 ⇒ 去补给点，进圈就停（停下来才开始按 3 秒计时回补） */
    if (gord0.type === 'RESUPPLY') {
      const sp = (battle.supplies || []).find(s => s.id === gord0.supplyId) || nearestSupplyFor([unit]);
      if (!sp) { unit._cmdWhy = '补给点不见了'; return null; }
      const d = Math.hypot(sp.x - unit.x, sp.y - unit.y);
      if (d <= Math.max(30, sp.r * 0.55)) { unit._cmdWhy = '已在补给点内（3 秒后开始回补）'; return null; }
      return { x: sp.x, y: sp.y };
    }
    if (gord0.objectiveId) mirrorGroupObjective(unit._groupKey || ('default_' + unit.side), gord0.objectiveId);
  }

  const mySide = unit.side;

  if (unit.isArtilleryUnit) {
    if (unit._relocateTarget) {
      const rd = Math.hypot(unit._relocateTarget.x - unit.x, unit._relocateTarget.y - unit.y);
      if (rd < 40) {
        unit._relocateTarget = null;
      } else {
        return { x: unit._relocateTarget.x, y: unit._relocateTarget.y };
      }
    }
    let bestObj = null, bestDist = Infinity;
    for (const o of battle.objectives) {
      const d = Math.hypot(o.x - unit.x, o.y - unit.y);
      if (d < bestDist) { bestDist = d; bestObj = o; }
    }
    if (!bestObj) return null;
    const standoff = Math.max(unit.range * 0.7, bestObj.r + 400);
    if (bestDist > standoff + 150) {
      const dx = bestObj.x - unit.x, dy = bestObj.y - unit.y;
      const d = Math.hypot(dx, dy) || 1;
      const tx = bestObj.x - (dx / d) * standoff;
      const ty = bestObj.y - (dy / d) * standoff;
      if (!isUnitInCombatZone(unit)) {
        return { x: tx, y: ty };
      }
      return { x: tx, y: ty };
    }
    return null;
  }

  if (unit.isSupportUnit) {
    const gKey = unit._groupKey || ('default_' + mySide);
    if (!battle._groups) battle._groups = {};
    if (!battle._groups[gKey]) {
      battle._groups[gKey] = { objectiveId: null, lockUntil: 0, stance: 'assault', nextStanceCheck: 0 };
    }
    const gs = battle._groups[gKey];
    let tObj = null;
    if (gs.objectiveId) {
      tObj = battle.objectives.find(o => o._id === gs.objectiveId);
    }
    if (!tObj && battle.objectives.length) {
      let bestDist = Infinity;
      for (const o of battle.objectives) {
        const d = Math.hypot(o.x - unit.x, o.y - unit.y);
        if (d < bestDist) { bestDist = d; tObj = o; }
      }
    }
    if (!tObj) return null;

    const standoff = Math.max(unit.range * 0.55, tObj.r + 150);
    const dToT = Math.hypot(tObj.x - unit.x, tObj.y - unit.y);

    if (dToT > standoff + 100) {
      const dx = tObj.x - unit.x, dy = tObj.y - unit.y;
      const dd = Math.hypot(dx, dy) || 1;
      const tx = tObj.x - (dx / dd) * standoff;
      const ty = tObj.y - (dy / dd) * standoff;
      if (!isUnitInCombatZone(unit)) {
        return { x: tx, y: ty };
      }
      return { x: tx, y: ty };
    }
    return null;
  }

  if (!battle._groups) battle._groups = {};
  const groupKey = unit._groupKey || ('default_' + mySide);
  if (!battle._groups[groupKey]) {
    battle._groups[groupKey] = { objectiveId: null, lockUntil: 0, stance: 'assault', nextStanceCheck: 0 };
  }
  const groupState = battle._groups[groupKey];

  let targetObj = null;

  if (groupState.objectiveId) {
    const found = battle.objectives.find(o => o._id === groupState.objectiveId);
    if (found) {
      const alliesIn = (mySide === 'blue' ? found.blueCount : found.redCount) || 0;
      const enemiesIn = (mySide === 'blue' ? found.redCount : found.blueCount) || 0;
      const stableForUs = (found.owner === mySide) && alliesIn >= 3 && alliesIn > enemiesIn;

      if (groupState.cmdObjId && groupState.cmdObjId === found._id) {
        targetObj = found;                    // ★ R9：命令层指定的据点 ⇒ 直接用，不再重新评估（不漂移）
      } else if (isDefender) {
        targetObj = found;
      } else {
        if (!stableForUs || battle.time < groupState.lockUntil) {
          targetObj = found;
        }
      }
    }
    if (!targetObj) groupState.objectiveId = null;
  }

  /* ★ R9：命令层已经指定了据点（cmdObjId）⇒ **禁止**再用旧的"自动分配目标"去挑点。
       若那个据点已不存在（编辑器删点等），本帧就不动，等命令层下一次思考重发。 */
  if (!targetObj && !groupState.cmdObjId) {
    const gkHash = (groupKey || '').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
    const gkOffset = (Math.abs(gkHash) % 1000) / 1000;

    const gsStance = groupState.stance || (isDefender ? 'defend' : 'assault');

    if (gsStance === 'defend' || isDefender) {
      let bestDist = Infinity;
      for (const o of battle.objectives) {
        const d = Math.hypot(o.x - unit.x, o.y - unit.y);
        if (d < bestDist) { bestDist = d; targetObj = o; }
      }
    } else if (gsStance === 'reserve') {
      let best = null, bestDist = Infinity;
      for (const o of battle.objectives) {
        if (o.owner === mySide) {
          const d = Math.hypot(o.x - unit.x, o.y - unit.y);
          if (d < bestDist) { bestDist = d; best = o; }
        }
      }
      targetObj = best;
      if (!targetObj) {
        let bd = Infinity;
        for (const o of battle.objectives) {
          const d = Math.hypot(o.x - unit.x, o.y - unit.y);
          if (d < bd) { bd = d; targetObj = o; }
        }
      }
    } else {
      let bestScore = Infinity;
      for (const o of battle.objectives) {
        if (o.owner === mySide) continue;
        const d = Math.hypot(o.x - unit.x, o.y - unit.y);
        const score = d - (o.r || 200) * 0.3 + gkOffset * 900 + Math.random() * 100;
        if (score < bestScore) { bestScore = score; targetObj = o; }
      }
      if (!targetObj) {
        let bestDist = Infinity;
        for (const o of battle.objectives) {
          const d = Math.hypot(o.x - unit.x, o.y - unit.y);
          if (d < bestDist) { bestDist = d; targetObj = o; }
        }
      }
    }

    if (targetObj) {
      groupState.objectiveId = targetObj._id;
      groupState.lockUntil = battle.time + 20;
      assignGroupRoles(groupKey, targetObj);
      for (const u of battle.units) {
        if (u._groupKey === groupKey) {
          u._slotAttemptStart = 0;
          u._wasAtSlot = false;
          u._wasOnRoad = undefined;
        }
      }
    }
  }

  if (!targetObj) return null;

  const alliesIn  = (mySide === 'blue' ? targetObj.blueCount : targetObj.redCount) || 0;
  const enemiesIn = (mySide === 'blue' ? targetObj.redCount : targetObj.blueCount) || 0;
  const distToObj = Math.hypot(targetObj.x - unit.x, targetObj.y - unit.y);

  let goInside = false;
  if (enemiesIn > 0) {
    goInside = true;
  } else if (alliesIn < MIN_GARRISON) {
    if (distToObj < targetObj.r * 1.5) goInside = true;
  } else if (!isDefender && targetObj.owner !== mySide) {
    goInside = true;
  }

  const myRole = unit._tacticalRole || 'main';
  if (myRole === 'suppress' || myRole === 'reserve') {
    goInside = false;
  }
  if (myRole === 'flank' && goInside) {
    const mainInCircle = battle.units.some(u =>
      u.alive && u._groupKey === unit._groupKey &&
      u._tacticalRole === 'main' &&
      Math.hypot(u.x - targetObj.x, u.y - targetObj.y) < targetObj.r
    );
    if (!mainInCircle) goInside = false;
  }

  if (goInside) {
    if (distToObj > targetObj.r * 0.8) {
      if (!isUnitInCombatZone(unit)) {
        return { x: targetObj.x, y: targetObj.y };
      }
      return { x: targetObj.x, y: targetObj.y };
    }
    return findInCircleCover(unit, targetObj);
  }

  const angle = unit.formationAngle || 0;
  const layer = Math.floor((unit.formationIndex || 0) / 4);

  const ddx = targetObj.x - unit.x, ddy = targetObj.y - unit.y;
  const dd = Math.hypot(ddx, ddy) || 1;
  const dirX = ddx / dd, dirY = ddy / dd;
  const perpX = -dirY, perpY = dirX;

  let tX, tY;
  if (myRole === 'flank') {
    const side = unit._flankSide || 1;
    const flankOffset = targetObj.r * (1.5 + layer * 0.2);
    const ringR = targetObj.r * (1.3 + layer * 0.15);
    tX = targetObj.x + perpX * side * flankOffset + Math.cos(angle) * ringR;
    tY = targetObj.y + perpY * side * flankOffset + Math.sin(angle) * ringR;
  } else if (myRole === 'suppress') {
    const ringR = targetObj.r * (1.8 + layer * 0.3);
    tX = targetObj.x - dirX * ringR * 0.7 + perpX * (Math.cos(angle) * ringR * 0.5);
    tY = targetObj.y - dirY * ringR * 0.7 + perpY * (Math.sin(angle) * ringR * 0.5);
  } else if (myRole === 'reserve') {
    const ringR = targetObj.r * (2.5 + layer * 0.3);
    tX = targetObj.x - dirX * ringR + Math.cos(angle) * ringR * 0.25;
    tY = targetObj.y - dirY * ringR + Math.sin(angle) * ringR * 0.25;
  } else {
    const ringR = targetObj.r * (isDefender ? (1.1 + layer * 0.35) : (1.2 + layer * 0.4));
    tX = targetObj.x + Math.cos(angle) * ringR;
    tY = targetObj.y + Math.sin(angle) * ringR;
  }

  const dToSlot = Math.hypot(tX - unit.x, tY - unit.y);
  const atSlot = dToSlot < 200;

  if (atSlot && !unit._wasAtSlot) unit._slotArrivedTime = battle.time;
  unit._wasAtSlot = atSlot;

  if (unit._lastMoveCheckTime === undefined) {
    unit._lastMoveCheckTime = battle.time;
    unit._lastMoveX = unit.x;
    unit._lastMoveY = unit.y;
  }
  if (battle.time - unit._lastMoveCheckTime > 2) {
    const movedFromCheck = Math.hypot(unit.x - unit._lastMoveX, unit.y - unit._lastMoveY);
    // ★ 阈值随速度自适应（老代码固定 <20m/2s，徒步单位只有 ~9.8m ⇒ 每个步兵都被误判成"卡住"→ 穿墙）
    const expect2 = Math.max(4, (unit.speed || 5) * 2 * 0.5);
    if (movedFromCheck < expect2 && !atSlot) {
      unit._avoidCache = null;                       // 重新绕行（不再穿墙）
      unit._repathUntil = battle.time + 3;
      unit._repelSide = (Math.random() < 0.5) ? 1 : -1;
    }
    unit._lastMoveCheckTime = battle.time;
    unit._lastMoveX = unit.x;
    unit._lastMoveY = unit.y;
  }

  if (!unit._slotAttemptStart) unit._slotAttemptStart = battle.time;
  const attemptTime = battle.time - unit._slotAttemptStart;

  if (attemptTime > 15 && !atSlot) {
    unit._slotAttemptStart = battle.time;
    return { x: tX, y: tY };
  }

  if (atSlot) {
    if (unitIsGarrisoned(unit)) return null;                  // 已经在楼里 → 待着
    const gMove = maybeGarrisonMove(unit, null);              // 附近有楼可钻 → 先进楼
    if (gMove) return gMove;
    if (getCoverAt(unit.x, unit.y) >= 0.35) return null;
    if (!unit.coverTarget || (unit.coverTarget.expiresAt && battle.time > unit.coverTarget.expiresAt)) {
      if (battle.time < (unit.coverSearchCooldown || 0)) return null;
      unit.coverTarget = findNearbyCover(unit, 200, null);
      if (unit.coverTarget) {
        unit.coverTarget.expiresAt = battle.time + COVER_TARGET_LIFETIME;
      } else {
        unit.coverSearchCooldown = battle.time + COVER_SEARCH_COOLDOWN;
      }
    }
    if (unit.coverTarget) {
      const cd = Math.hypot(unit.coverTarget.x - unit.x, unit.coverTarget.y - unit.y);
      if (cd < 18) { unit.coverTarget = null; return null; }
      return { x: unit.coverTarget.x, y: unit.coverTarget.y };
    }
    return null;
  }

  if (!isUnitInCombatZone(unit)) {
    return { x: tX, y: tY };
  }
  return { x: tX, y: tY };
}

function decideCommand(unit, target) {
  // ★ 只有"被彻底压住"才去躲；轻度压制继续打（只是打不准）
  if ((unit.suppressionLevel || 0) >= SUPP_HARD) return { type: 'TAKE_COVER' };
  if (target && target.alive) {
    const dist = Math.hypot(target.x - unit.x, target.y - unit.y);
    // ★ 与走位用同一条判据：能打到 → 就位打；打不到 → 接近
    const tg = getTerrainAt(unit.x, unit.y);
    if (canEngage(unit, target, dist, tg.rangeMul)) return { type: 'ATTACK', target };
    return { type: 'APPROACH', target };
  }
  const gs = battle._groups && battle._groups[unit._groupKey];
  if (gs && gs.objectiveId) {
    const o = battle.objectives.find(x => x._id === gs.objectiveId);
    if (o) {
      const d = Math.hypot(o.x - unit.x, o.y - unit.y);
      if (d < o.r * 1.5) return { type: 'GARRISON', objective: o };
      return { type: 'MOVE_TO', objective: o };
    }
  }
  return { type: 'HOLD' };
}

function updateCommand(unit, newCmd) {
  if (!unit._command) {
    unit._command = { ...newCmd, since: battle.time };
    unit._pendingCmd = null;
    return;
  }
  const cur = unit._command;
  if (cur.type === newCmd.type) {
    Object.assign(cur, newCmd);
    unit._pendingCmd = null;
    return;
  }
  if (!unit._pendingCmd || unit._pendingCmd.type !== newCmd.type) {
    unit._pendingCmd = { ...newCmd, since: battle.time };
    return;
  }
  if (battle.time - unit._pendingCmd.since > 0.4) {
    unit._command = { ...newCmd, since: battle.time };
    unit._pendingCmd = null;
  }
}

function findInCircleCover(unit, obj) {
  if (getCoverAt(unit.x, unit.y) >= 0.5) return null;
  if (!unit.coverTarget || (unit.coverTarget.expiresAt && battle.time > unit.coverTarget.expiresAt)) {
    unit.coverTarget = findNearbyCover(unit, 200, null);
    if (unit.coverTarget) {
      unit.coverTarget.expiresAt = battle.time + COVER_TARGET_LIFETIME;
    }
  }
  if (unit.coverTarget) {
    const cd = Math.hypot(unit.coverTarget.x - unit.x, unit.coverTarget.y - unit.y);
    if (cd < 15) { unit.coverTarget = null; return null; }
    return { x: unit.coverTarget.x, y: unit.coverTarget.y };
  }
  return null;
}

/* ============================================================
   ★ 交战判据（唯一真相来源）
   —— 原则：**能不能打到** 和 **该不该停下** 必须用同一条判据。
      以前走位用了一堆硬编码乘数（×1.05 / ×0.85 / ×1.2 / ×0.9 / ×0.7…），
      和开火判定完全脱节 ⇒ 必然出现"停在射程外干瞪眼"，
      而且换一把自定义射程的武器就会再坏一次。
      现在：停在哪 = 由"我的武器在这个距离上能不能打到"直接算出来。
   ============================================================ */
const ENGAGE_FRACTION = 0.6;   // 要求几成【火力】能打到才算进入交战距离（唯一参数，无量纲、与射程数值无关）

/* 收集该单位对"当前目标"的武器火力清单（打不穿的目标武器不计入） */
function unitFirepowerList(unit, target) {
  const tArmor = (target && target.armor) || 0;
  const list = [];
  const push = (w) => {
    if (!w || !w.range) return;
    if (tArmor > 0 && (w.penetration || 0) < tArmor && (w.antiArmor || 0) < 50) return;
    list.push({
      range: w.range,
      minRange: w.minRange || 0,
      weight: Math.max(1, (w.antiPersonnel || 0) + (w.antiArmor || 0)),   // 火力权重
    });
  };
  if (unit.soldiers) for (const s of unit.soldiers) { if (s.alive && !weaponDry(s.weapon)) push(s.weapon); }
  for (const v of (unit.vehicles || [])) { if (!v.destroyed && !weaponDry(v.weapon)) push(v.weapon); }
  return list;
}

/* 在 dist 距离上，能开火的火力占比 0~1（射程够 且 不小于最小射程） */
function firepowerFractionAt(unit, target, dist, rangeMul) {
  const list = unitFirepowerList(unit, target);
  if (!list.length) return 0;
  const rm = (rangeMul == null) ? 1 : rangeMul;
  let total = 0, good = 0;
  for (const w of list) {
    total += w.weight;
    if (dist <= w.range * rm && dist >= w.minRange) good += w.weight;
  }
  return total > 0 ? good / total : 0;
}

/* ★ 交战距离：火力占比达到 ENGAGE_FRACTION 的那个距离
   —— 完全由武器数据决定（加权分位）：
      500m 步枪 → 500 ／ 100m 冲锋枪 → 100 ／ 坦克主炮 3000 → 3000
      步兵连带 2 门迫击炮(5000) → 仍 500（迫击炮权重占比不到四成）
   带 0.5 秒缓存（武器构成变化很慢），避免每帧重算 */
function _computeEngageRange(unit, target, rangeMul) {
  const list = unitFirepowerList(unit, target);
  if (!list.length) return Math.max(80, (unit.range || 300) * 0.6);
  const rm = (rangeMul == null) ? 1 : rangeMul;
  list.sort((a, b) => (a.range * rm) - (b.range * rm));
  let total = 0;
  for (const w of list) total += w.weight;
  const need = total * ENGAGE_FRACTION;
  let acc = 0;
  for (const w of list) {
    acc += w.weight;
    if (acc >= need) return Math.max(60, w.range * rm);
  }
  return Math.max(60, list[list.length - 1].range * rm);
}

function engageRangeOf(unit, target, rangeMul) {
  const rm = (rangeMul == null) ? 1 : rangeMul;
  const key = ((target && target.id) || 'none') + '|' + rm;
  const c = unit._engageCache;
  if (c && c.key === key && battle.time - c.t < 0.5) return c.range;
  const range = _computeEngageRange(unit, target, rangeMul);
  unit._engageCache = { key, t: battle.time, range };
  return range;
}

/* ★ 唯一判据：现在这个距离能不能有效交战 */
function canEngage(unit, target, dist, rangeMul) {
  if (!target || !target.alive) return false;
  return dist <= engageRangeOf(unit, target, rangeMul);
}

/* ★ 推进到"恰好让整个队形进入射程"的位置
   —— 站位距离 = 交战距离 − 编队半径（编队半径是数据属性，不是魔法乘数）
      这样一到位，连最后排的士兵也在射程内 ⇒ 立刻能开火 */
function approachToEngage(unit, target, engageDist) {
  const dx = unit.x - target.x, dy = unit.y - target.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d <= engageDist) return null;
  const ux = dx / d, uy = dy / d;
  const perpX = -uy, perpY = ux;
  const standoff = unitStandoffFor(unit, engageDist);
  const maxLat = standoff * 0.6;
  const lateral = Math.sin((unit.formationAngle || 0) * 2.7) * maxLat;
  const radial = Math.sqrt(Math.max(standoff * standoff - lateral * lateral, 25));
  return {
    x: target.x + ux * radial + perpX * lateral,
    y: target.y + uy * radial + perpY * lateral,
  };
}

/* 站位距离：交战距离 − 编队半径（下限 50m，避免整队叠在一点） */
function unitStandoffFor(unit, engageDist) {
  return Math.max(50, engageDist - (unit._formationRadius || 0));
}

/* ============================================================
   ★ 决策层：六个战术选项（utility AI）
   —— 不再硬编码"必须推进到 X 米"，而是让单位按形势在选项里挑一个：
      HOLD 固守/呼叫火力 · BOUND 交替跃进 · ASSAULT 冲锋
      WITHDRAW 后撤 · FLANK 侧翼迂回 · REGROUP 脱离重整
   评分输入全部来自"已有的事实"（交战距离/覆盖率/掩体/压制/兵力比/票池/任务），
   想调"谁更愿意冲锋"只改 TACTICAL_WEIGHTS 的数字，逻辑不用动。
   ============================================================ */
const OPTION_CHECK_INTERVAL = 2;    // 每 2 秒重新评估一次
const OPTION_MIN_TIME = 5;          // 换选项的最小间隔（迟滞，防抖）
const OPTION_SWITCH_MARGIN = 0.40;  // 新选项得分要高这么多才值得换
/* ★ 选项"承诺时长"：选中后这段时间内不许换（除非被彻底压住）
   —— 旧版每 2 秒自由重评 ⇒ BOUND↔HOLD↔FLANK 来回切 = 走一半回头，
      表现就是"原地反复横跳 / 20m 折返跑 / 一抽一抽" */
const OPTION_COMMIT = { HOLD: 3, BOUND: 7, ASSAULT: 5, FLANK: 9, WITHDRAW: 5, REGROUP: 5 };
/* ★★ R9.2：**将军层的组战法 → 执行层的战术选项**（同一套机制，只是"谁决定"换了人） */
const STANCE_TO_OPTION = {
  assault: 'ASSAULT', bound: 'BOUND', hold: 'HOLD',
  flank: 'FLANK', reserve: 'REGROUP', withdraw: 'WITHDRAW',
};
// 交替跃进：跃进段要长于压制段（1.5s 走 / 1.5s 停 = 毛毛虫；4.5s 走 / 1.8s 停 = 像样的跃进）
const BOUND_MOVE_TIME = 4.5;
const BOUND_PAUSE_TIME = 1.8;
const ASSAULT_CLOSE_FACTOR = 0.5;   // 冲锋：压到交战距离的 50%（"冲锋"这条战法的参数）

const TACTICAL_WEIGHTS = {
  hold:     { outOfRange: 0.9, cover: 2.0, supp: 0.9, support: 0.6, weak: 0.3, defend: 1.0, pinned: 1.2 },
  bound:    { outOfRange: 1.2, noCover: 1.0, assault: 1.0, even: 0.3, supp: 1.2 },
  assault:  { canFire: 0.6, enemySupp: 1.6, edge: 1.6, morale: 0.6, supp: 1.4 },
  withdraw: { supp: 1.5, weak: 2.0, lowMorale: 1.2, noCover: 0.5, assault: 0.8, friends: 0.6 },
  regroup:  { supp: 1.7, weak: 1.1, assault: 1.0, friends: 1.3 },
  flank:    { even: 0.6, assault: 0.9, outOfRange: 0.9, calm: 0.6, cover: 0.6, engaged: 1.2 },
};

/* 单位附近能拿到的最大掩体（含自身点 + 四周 30m 采样 4 点）
   —— ★ 直接用"脚下那一格"的掩体会让选项来回翻：人往前走 10m 踩到掩体格 →
     HOLD 分暴涨 → 停下；下帧走出掩体格 → 又变回 BOUND → 走。
     表现就是"原地反复横跳"。改成"附近可取到的掩体"后曲线平滑。 */
function coverNear(x, y, r) {
  const rad = r || 30;
  let best = getCoverAt(x, y);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    best = Math.max(best, getCoverAt(x + Math.cos(a) * rad, y + Math.sin(a) * rad));
  }
  return best;
}

/* 局势评估：产出归一化因子（0~1 / -1~1） */
function assessSituation(unit, target) {
  const dist = (target && target.alive)
    ? Math.hypot(target.x - unit.x, target.y - unit.y) : Infinity;
  const engageR = engageRangeOf(unit, target);
  const canFire = dist <= engageR;

  let allies = 0, enemies = 0, friends800 = 0;
  for (const o of battle.units) {
    if (!o.alive) continue;
    const d = Math.hypot(o.x - unit.x, o.y - unit.y);
    if (d > 1500) continue;
    if (o.side === unit.side) { allies++; if (d <= 800) friends800++; }
    else enemies++;
  }
  const ratio = (allies + enemies) > 0 ? allies / (allies + enemies) : 0.5;

  const tk = battle.tickets, tkMax = battle.ticketsMax || { blue: 1, red: 1 };
  const morale = (tk && tkMax && tkMax[unit.side] > 0)
    ? Math.max(0, Math.min(1, tk[unit.side] / tkMax[unit.side])) : 1;

  let support = 0;
  for (const o of battle.units) {
    if (o.alive && o.side === unit.side && o.isArtilleryUnit) { support = 1; break; }
  }

  const gs = battle._groups && battle._groups[unit._groupKey];
  const stance = gs ? (gs.stance || 'assault') : 'assault';
  let assaultMission = 1;
  if (defenderSide() === unit.side) assaultMission = 0;
  else if (stance !== 'assault') assaultMission = 0.4;

  return {
    canFire: canFire ? 1 : 0,
    outOfRange: canFire ? 0 : 1,
    cover: Math.min(1, coverNear(unit.x, unit.y, 30) * 1.4),
    supp: Math.min(1, unit.suppressionLevel || 0),
    ratio,                                   // 0~1（0.5 = 均势）
    edge: (ratio - 0.5) * 2,                 // -1~1（正 = 我方占优）
    morale,                                  // 0~1
    friendNear: Math.min(1, friends800 / 3),  // 0~1：附近（800m）有多少友军可收拢
    enemySupp: Math.min(1, (target && target.suppressionLevel) || 0),
    support,                                 // 0/1
    assaultMission,
  };
}

/* 六个选项打分 */
function scoreTacticalOptions(s) {
  const W = TACTICAL_WEIGHTS;
  const even = 1 - Math.abs(s.ratio - 0.5) * 2;      // 势均力敌程度 0~1
  return {
    HOLD:     W.hold.outOfRange * s.outOfRange + W.hold.cover * s.cover
            + W.hold.supp * s.supp + W.hold.support * s.support
            + W.hold.weak * (1 - s.ratio) + W.hold.defend * (1 - s.assaultMission)
            - W.hold.pinned * s.supp,
    BOUND:    W.bound.outOfRange * s.outOfRange + W.bound.noCover * (1 - s.cover)
            + W.bound.assault * s.assaultMission + W.bound.even * even
            - W.bound.supp * s.supp,
    ASSAULT:  W.assault.canFire * s.canFire + W.assault.enemySupp * s.enemySupp
            + W.assault.edge * Math.max(0, s.edge) + W.assault.morale * s.morale
            - W.assault.supp * s.supp,
    WITHDRAW: W.withdraw.supp * s.supp + W.withdraw.weak * (1 - s.ratio)
            + W.withdraw.lowMorale * (1 - s.morale) + W.withdraw.noCover * (1 - s.cover)
            - W.withdraw.assault * s.assaultMission - W.withdraw.friends * s.friendNear,
    REGROUP:  W.regroup.supp * s.supp + W.regroup.weak * (1 - s.ratio)
            - W.regroup.assault * s.assaultMission + W.regroup.friends * s.friendNear,
    FLANK:    W.flank.even * even + W.flank.assault * s.assaultMission
            + W.flank.outOfRange * s.outOfRange + W.flank.calm * (1 - s.supp)
            + W.flank.cover * s.cover - W.flank.engaged * s.canFire,
  };
}

/* 选出当前战术选项（带迟滞，避免来回横跳） */
function updateTacticalOption(unit, target) {
  if (unit._optionAt && battle.time - unit._optionAt < OPTION_CHECK_INTERVAL) return;
  unit._optionAt = battle.time;
  if (unit.isArtilleryUnit || unit.isSupportUnit) { unit._option = 'HOLD'; return; }
  if (!target || !target.alive) { unit._option = null; return; }

  /* ★★★ R9.2：**战法由将军层定**（`ord.stance` → `battle._groups[gk].stance`）
     —— 本单位不再自己跑 utility 评分：那是"意图的第二个写者"，也是"每 2 秒重评一次 ⇒
        同组两个单位一个跃进一个据守 ⇒ 走两步停一下 / 原地横跳"的根源。
        下面那整套 TACTICAL_WEIGHTS 评分**保留为兜底**：只有"组里没有战法"时才用
        （`?gen=0` 将军停手、或脚本/玩家只下了一条不带战法的命令）。 */
  const gsForStance = battle._groups && battle._groups[unit._groupKey];
  if (gsForStance && gsForStance.stance && STANCE_TO_OPTION[gsForStance.stance]) {
    unit._option = STANCE_TO_OPTION[gsForStance.stance];
    unit._optionAt = battle.time;
    unit._optionCommitUntil = battle.time + (OPTION_COMMIT[unit._option] || 4);
    return;
  }

  /* ★★★ 承诺保护：正在执行的动作（跃进段/迂回段）不许被打断
     —— 否则 BOUND↔HOLD↔FLANK 来回切，走一半回头 ⇒ 原地横跳 / 20m 折返跑
        只有"被彻底压住"这种硬事件才允许打断（那会走 TAKE_COVER，与选项无关） */
  if (unit._option && battle.time < (unit._optionCommitUntil || 0)
      && (unit.suppressionLevel || 0) < SUPP_HARD) {
    return;
  }

  const factors = assessSituation(unit, target);
  const scores = scoreTacticalOptions(factors);
  let best = null, bestScore = -Infinity;
  for (const k of Object.keys(scores)) {
    if (scores[k] > bestScore) { best = k; bestScore = scores[k]; }
  }
  const cur = unit._option;
  const curScore = (cur && scores[cur] !== undefined) ? scores[cur] : -Infinity;
  if (cur && best !== cur) {
    const since = unit._optionSince || -9999;
    if (battle.time - since < OPTION_MIN_TIME && bestScore < curScore + OPTION_SWITCH_MARGIN) {
      best = cur; bestScore = curScore;          // 迟滞：还不到换的时候
    }
  }
  if (best !== unit._option) {
    unit._option = best;
    unit._optionSince = battle.time;
    // ★ 承诺时长：这段时间内不再重评（见文件上方 OPTION_COMMIT）
    unit._optionCommitUntil = battle.time + (OPTION_COMMIT[best] || 4);
    // ★ 换选项 → 清掉上一个动作的"承诺点"，否则残留目标会把单位往旧方向拽
    unit._boundTarget = null;
    unit._flankTarget = null;
  }
  unit._optionScore = bestScore;
  unit._optionFactors = factors;
}

function computeCombatMove(unit, target, dist, effectiveRange) {
  // ★ 驻守建筑（红警式）：在楼里且敌人已进入有效射程 → 待着打；
  //   敌人在射程之外 → 必须出楼继续前进（否则就是"远远下车站着看对方，也不前进"）
  if (unitIsGarrisoned(unit)) {
    if (target && target.alive && dist <= effectiveRange) return null;   // 能打到 → 楼里打
  } else {
    const g = maybeGarrisonMove(unit, target);
    if (g) return g;
  }
  const inCover = getCoverAt(unit.x, unit.y) >= 0.5;   // （保留给下方"就地就位"判断参考）
  void inCover;

  if (unit.isArtilleryUnit) {
    if (unit._relocateTarget) {
      const rd = Math.hypot(unit._relocateTarget.x - unit.x, unit._relocateTarget.y - unit.y);
      if (rd < 40) {
        unit._relocateTarget = null;
      } else {
        return { x: unit._relocateTarget.x, y: unit._relocateTarget.y };
      }
    }

    let minR = Infinity;
    for (const w of unit.weapons) {
      if (typeof w.minRangeRaw === 'number' && w.minRangeRaw > 0) {
        minR = Math.min(minR, w.minRangeRaw);
      }
    }
    if (!isFinite(minR) || minR <= 0) minR = 300;
    const dangerRange = Math.max(250, Math.min(800, minR * 0.6));
    if (dist < dangerRange) {
      const dx = target.x - unit.x, dy = target.y - unit.y;
      const d = Math.hypot(dx, dy) || 1;
      return { x: unit.x - (dx / d) * 250, y: unit.y - (dy / d) * 250, retreat: true };
    }
    unit._aiWhy = '炮兵就位（射程内不再前进）';
    return null;
  }

  if (unit.isSupportUnit) {
    const standoff = Math.max(unit.range * 0.7, 300);
    if (dist < standoff * 0.7) {
      const dx = target.x - unit.x, dy = target.y - unit.y;
      const d = Math.hypot(dx, dy) || 1;
      return { x: unit.x - (dx / d) * 200, y: unit.y - (dy / d) * 200 };
    }
    if (dist > standoff * 1.1) {
      return approachTarget(unit, target, standoff);
    }
    return null;
  }


  /* ★★★ 执行层：由决策层选出的战术选项决定"这一帧往哪走"
     —— 距离判据只有一个（engageDist = engageRangeOf(...)），选项只决定"走/停/往哪走" */
  const engageDist = effectiveRange;
  const opt = unit._option;

  switch (opt) {
    case 'BOUND':   return execBound(unit, target, dist, engageDist);
    case 'ASSAULT': return execAssault(unit, target, dist, engageDist);
    case 'WITHDRAW':return execWithdraw(unit, target, dist);
    case 'REGROUP': return execRegroup(unit, target, dist);
    case 'FLANK':   return execFlank(unit, target, dist, engageDist);
    case 'HOLD':    return execHold(unit, target);
    default: break;   // 还没评估出选项 → 落到下面的默认行为
  }

  /* 默认（尚未评估）：能打就到就位，打不到就推进——与旧行为一致 */
  if (dist > unitStandoffFor(unit, engageDist)) {
    unit.coverTarget = null;
    return approachToEngage(unit, target, engageDist);
  }
  return seekCoverOrHold(unit, target);
}

/* ---------- 选项执行：给出这一帧的移动目标（null = 不移动，就地打） ---------- */

/* 就地找掩体/趴下（HOLD 与各选项到位后的共用行为） */
function seekCoverOrHold(unit, target) {
  const curCover = getCoverAt(unit.x, unit.y);
  if (curCover >= 0.5) {
    unit.coverTarget = null;
    unit._coverArrivedTime = battle.time;
    unit._aiWhy = '据掩体射击（本来就在掩体里/城区/树林）';
    return null;                       // 已在掩体（含城区/战壕）→ 原地据掩体射击
  }
  if (!unit.coverTarget) {
    if (battle.time < (unit.coverSearchCooldown || 0)) return null;
    const dx = target.x - unit.x, dy = target.y - unit.y;
    const d = Math.hypot(dx, dy) || 1;
    const cand = findNearbyCover(unit, 150, { x: dx / d, y: dy / d });
    /* ★ 只接受"不往后退"的掩体：
       旧版半径 280m 且不管方向 ⇒ 会为了 200m 外的一堵墙整队往后跑 = 折返跑 */
    const ok = cand && (Math.hypot(cand.x - target.x, cand.y - target.y) <= d + 60);
    unit.coverTarget = ok ? cand : null;
    if (unit.coverTarget) {
      unit.coverTarget.expiresAt = battle.time + COVER_TARGET_LIFETIME;
    } else {
      unit.coverSearchCooldown = battle.time + COVER_SEARCH_COOLDOWN;
    }
  }
  if (unit.coverTarget) {
    const cd = Math.hypot(unit.coverTarget.x - unit.x, unit.coverTarget.y - unit.y);
    if (cd < 18) { unit.coverTarget = null; unit._coverArrivedTime = battle.time; return null; }
    return { x: unit.coverTarget.x, y: unit.coverTarget.y };
  }
  /* ★★ R9.1：**"能打到"才准原地趴** —— 旧版无条件 `return null`（就地卧倒/据守），
     于是**打不到的单位也一起停在射程外干瞪眼** ⇒ 这是"走走停停"的第二个来源。
     现在按"我的武器在这个距离能不能打到"分流：
       · 能打到 ⇒ 原地据守开火（这是战术，不是卡住）
       · 打不到 ⇒ **继续推进**到交战距离（速度 60%，不折返、不停顿） */
  if (target && target.alive) {
    const d = Math.hypot(target.x - unit.x, target.y - unit.y) || 1;
    const rm = getTerrainAt(unit.x, unit.y).rangeMul;
    const canShoot = unitFirepowerList(unit, target)
      .some(w => d <= w.range * rm && d >= (w.minRange || 0));
    if (canShoot) { unit._aiWhy = '就地据守开火'; return null; }
    const standoff = unitStandoffFor(unit, engageRangeOf(unit, target, rm));
    if (d > standoff + 8) {
      const ux = (unit.x - target.x) / d, uy = (unit.y - target.y) / d;
      unit._paceMul = 0.6;
      unit._aiWhy = '推进到交战距离';
      return { x: target.x + ux * standoff, y: target.y + uy * standoff };
    }
    unit._aiWhy = '就地据守开火';
    return null;
  }
  unit._aiWhy = '就地卧倒（附近没掩体）';
  return null;                          // 视野里没目标 → 就地卧倒射击
}

/* HOLD：固守（不前进；能打到就打，打不到就在原地等/呼叫火力） */
function execHold(unit, target) { return seekCoverOrHold(unit, target); }

/* BOUND：交替跃进 —— 跃进一段（4.5s 全速）→ "压制段"（1.8s 减速到 25% 继续走）
   ★ 三个关键点（旧版四个症状的根因全在这）：
     1) 跃进段"承诺一个点"，段内不再每帧重算 —— 旧版每帧按 dist 重算落点，
        目标随人前进不停往后缩 ⇒ 微修正 = 毛毛虫一抽一抽；
     2) 压制段**不再停下**（R9.1）：旧版 `return null` 停 1.8 秒 ⇒ 玩家看到的
        "所有单位走走停停"；现在改成 `_paceMul = 0.25`（猫腰慢进），
        既保留"跃进/压制"的节奏感，又不会停顿、不折返，射击照旧；
     3) 承诺点必定比现在更接近目标 + 有超时保护 ⇒ 不会往回窜，也不会永远够不着。 */
function execBound(unit, target, dist, engageDist) {
  const standoff = unitStandoffFor(unit, engageDist);
  if (dist <= standoff) { unit._boundTarget = null; return seekCoverOrHold(unit, target); }

  const cyc = BOUND_MOVE_TIME + BOUND_PAUSE_TIME;
  if (unit._boundOffset === undefined) unit._boundOffset = Math.random() * cyc;
  const inMove = ((battle.time + unit._boundOffset) % cyc) < BOUND_MOVE_TIME;
  /* ★★ R9.1：压制段**不再"停 1.8 秒"** —— 玩家看到的"所有单位走走停停"就是它。
     改成**减速到 25% 继续前进**："跃进"的观感靠速度差表达，而不是停顿：
       · 不停顿 ⇒ 不会"走一下停一下"   · 不折返 ⇒ 承诺点 `_boundTarget` 照旧保留
       · 射击照旧（压制段本来就是"边走边打"） */
  if (!inMove) { unit._paceMul = 0.25; unit._aiWhy = '交替跃进·压制段（慢进）'; }

  const remain = dist - standoff;
  if (!unit._boundTarget) {
    const step = Math.min(remain, Math.max(40, (unit.speed || 5) * BOUND_MOVE_TIME * 0.85));
    const ux = (unit.x - target.x) / dist, uy = (unit.y - target.y) / dist;
    unit._boundTarget = {
      x: target.x + ux * (dist - step),
      y: target.y + uy * (dist - step),
      until: battle.time + BOUND_MOVE_TIME * 1.6,     // 给足走完的时间（走不到也别硬追）
    };
  }
  const p = unit._boundTarget;
  if (battle.time > p.until) { unit._boundTarget = null; unit._aiWhy = '交替跃进·超时放弃'; return null; }
  // 到达阈值要小于步长（旧值 14m 会在"只差 5m 到位"时永远判"已到达"⇒ 原地不动）
  if (Math.hypot(p.x - unit.x, p.y - unit.y) < 8) { unit._boundTarget = null; unit._aiWhy = '交替跃进·已到位'; return null; }
  return p;
}

/* ASSAULT：冲锋 —— 压到近距离，赌对方先崩 */
function execAssault(unit, target, dist, engageDist) {
  const closeDist = Math.max(40, unitStandoffFor(unit, engageDist) * ASSAULT_CLOSE_FACTOR);
  if (dist <= closeDist) return seekCoverOrHold(unit, target);
  const ux = (unit.x - target.x) / dist, uy = (unit.y - target.y) / dist;
  return { x: target.x + ux * closeDist, y: target.y + uy * closeDist };
}

/* WITHDRAW：后撤 —— 优先撤进更好的掩体，没有就朝本方纵深退 */
function execWithdraw(unit, target, dist) {
  const cov = findNearbyCover(unit, 400, null);
  if (cov && (cov.cover || 0) > getCoverAt(unit.x, unit.y) + 0.1) return { x: cov.x, y: cov.y };
  const ux = (unit.x - target.x) / (dist || 1), uy = (unit.y - target.y) / (dist || 1);
  const rear = friendlyRearDir(unit);
  const dx = ux * 0.6 + rear.x * 0.4, dy = uy * 0.6 + rear.y * 0.4;
  const l = Math.hypot(dx, dy) || 1;
  return { x: unit.x + (dx / l) * 300, y: unit.y + (dy / l) * 300 };
}

/* REGROUP：脱离接触、向友军靠拢重整 */
function execRegroup(unit, target, dist) {
  let best = null, bestD = Infinity;
  for (const o of battle.units) {
    if (!o.alive || o === unit || o.side !== unit.side) continue;
    const d = Math.hypot(o.x - unit.x, o.y - unit.y);
    if (d > 1800 || d < 60) continue;
    if (d < bestD) { bestD = d; best = o; }
  }
  if (best) return { x: best.x, y: best.y };
  const ux = (unit.x - target.x) / (dist || 1), uy = (unit.y - target.y) / (dist || 1);
  return { x: unit.x + ux * 250, y: unit.y + uy * 250 };
}

/* FLANK：侧翼迂回 —— 绕到目标侧后
   ★ 承诺一个迂回点（默认 9 秒内不重算）：旧版每帧按"当前方位角 +81°"重算，
     而人一动方位角就变 ⇒ 目标点跟着转 ⇒ 表现就是**绕着敌人无限转圈/折返跑** */
function execFlank(unit, target, dist, engageDist) {
  const standoff = unitStandoffFor(unit, engageDist);
  const side = unit._flankSide || (unit._flankSide = (unit.id % 2 === 0 ? 1 : -1));
  const p = unit._flankTarget;
  if (!p || battle.time > (p.until || 0)) {
    const ang = Math.atan2(unit.y - target.y, unit.x - target.x) + side * Math.PI * 0.45;
    unit._flankTarget = {
      x: target.x + Math.cos(ang) * standoff,
      y: target.y + Math.sin(ang) * standoff,
      until: battle.time + 9,
    };
  }
  const q = unit._flankTarget;
  if (Math.hypot(q.x - unit.x, q.y - unit.y) < 30) {
    unit._flankTarget = null;
    return seekCoverOrHold(unit, target);          // 绕到位 → 就地据守/找掩体
  }
  return q;
}

/* 本方"纵深方向"（用于撤退/重整）：朝最近的本方据点，没有就朝本方出生区 */
function friendlyRearDir(unit) {
  let best = null, bestD = Infinity;
  for (const o of (battle.objectives || [])) {
    if (o.owner !== unit.side) continue;
    const d = Math.hypot(o.x - unit.x, o.y - unit.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  if (best) {
    const dx = best.x - unit.x, dy = best.y - unit.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }
  const spawn = (battle.gridMap && battle.gridMap.spawns) ? battle.gridMap.spawns[unit.side] : null;
  if (spawn) {
    const sc = spawnCenter(spawn);            // ★ 多边形取面积质心，矩形取中心
    const cx = sc.x, cy = sc.y;
    const dx = cx - unit.x, dy = cy - unit.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }
  return { x: 0, y: 0 };
}

/* 调试浮层用：选项得分 + 关键因子一行字（"为什么选它"） */
function unitOptionScoreText(u) {
  if (typeof u._optionScore !== 'number') return '';
  const f = u._optionFactors;
  if (!f) return ' ' + u._optionScore.toFixed(1);
  return ` ${u._optionScore.toFixed(1)}·兵${Math.round(f.ratio * 100)}%·掩${f.cover.toFixed(1)}·压${f.supp.toFixed(2)}`;
}

function computeSuppressedMove(unit) {
  const curCover = getCoverAt(unit.x, unit.y);

  if (curCover >= 0.5) return null;

  if (unit._coverArrivedTime && battle.time - unit._coverArrivedTime < 3) return null;

  // 掩体目标：★ 只在"没有目标 / 目标过期 / 目标变得很差"时才重新搜索
  //    （旧代码每 3.5 秒重搜一次，而搜索的采样是"按坐标播种"的 ⇒ 人一动结果就变 ⇒ 原地抽搐）
  if (unit.coverTarget) {
    const expired = unit.coverTarget.expiresAt && battle.time > unit.coverTarget.expiresAt;
    const worse = (unit.coverTarget.cover || 0) < curCover + 0.1;
    if (expired && worse) unit.coverTarget = null;
  }
  if (!unit.coverTarget) {
    if (battle.time < (unit.coverSearchCooldown || 0)) return null;
    const found = findNearbyCover(unit, 400, null);
    if (found && found.cover > curCover + 0.1) {
      unit.coverTarget = found;
      unit.coverTarget.expiresAt = battle.time + COVER_TARGET_LIFETIME;
    } else {
      unit.coverTarget = null;
      unit.coverSearchCooldown = battle.time + COVER_SEARCH_COOLDOWN;
    }
  }
  if (unit.coverTarget) {
    const cd = Math.hypot(unit.coverTarget.x - unit.x, unit.coverTarget.y - unit.y);
    if (cd < 18) {            // 到达阈值（原来 40m 比首档半径 15m 还大 ⇒ 一找到就判"已到达"）
      unit.coverTarget = null;
      unit._coverArrivedTime = battle.time;
      return null;
    }
    return { x: unit.coverTarget.x, y: unit.coverTarget.y };
  }

  // ★ 找不到掩体 → 就地趴下（不再"每帧换一个随机方向乱窜"，
  //   那正是平地上被压制时"小范围抽搐"的根因）
  return null;
}

function terrainMobilityMul(unit, tg) {
  return terrainMobilityMulFor(unit.mobilityType, tg);
}

/* ============================================================
   ★★ R9.2（L1）：**步兵速度全队一次采样**（加权平均，**不用 min**）
   ------------------------------------------------------------
   旧版逐人采样地形（`getTerrainAt(s.x, s.y)`）⇒ 队首踩到硬地跑得快、队尾在软地爬
   ⇒ 队伍被拉成一条长蛇、看起来"快的在等慢的"。L1 先做最省事的一步：
   以单位质心 + 前后左右 25m 共 5 点取平均，全队共用 ⇒ 队形不会被拉散。
   （每 0.25 秒缓存一次；L2 的"锚点驱动 + 落后弹簧"以后再做，见 待办TODO.md）
   ============================================================ */
function unitTerrainMulSample(unit) {
  if (unit._terrainMulAt != null && battle.time - unit._terrainMulAt < 0.25) return unit._terrainMul;
  const R = 25;
  const sum = terrainMobilityMul(unit, getTerrainAt(unit.x, unit.y))
            + terrainMobilityMul(unit, getTerrainAt(unit.x + R, unit.y))
            + terrainMobilityMul(unit, getTerrainAt(unit.x - R, unit.y))
            + terrainMobilityMul(unit, getTerrainAt(unit.x, unit.y + R))
            + terrainMobilityMul(unit, getTerrainAt(unit.x, unit.y - R));
  unit._terrainMul = sum / 5;
  unit._terrainMulAt = battle.time;
  return unit._terrainMul;
}

/* ============================================================
   ★★★ R9.2：**补给点** —— 圈内停留 ≥3 秒 ⇒ 每秒回补 20%（按每件武器的 ammoMax 比例）
   ------------------------------------------------------------
   为什么按"比例"而不是"发数"：步枪 120 发 / 火箭筒 1 发 / 榴弹炮 40 发，
   按发数补会让火箭筒 1 秒补满、步枪永远补不满；按 ammoMax 比例才一致（约 5 秒补满一件）。
   ★ 第一版：补给点**无限**（不做消耗），先把手感跑通。
   ============================================================ */
const RS_DWELL = 3.0;      // 站圈内多久算"停稳"
const RS_RATE  = 0.20;     // 每秒回补 ammoMax 的 20%

/* 点 (x,y) 最近的补给点（不限距离；没有补给点 ⇒ null） */
function nearestSupplyTo(x, y) {
  let best = null, bd = Infinity;
  for (const s of (battle.supplies || [])) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
/* 一组单位最近的补给点（cmd.js 体检用：玩家没点名补给点就自动挑最近的） */
function nearestSupplyFor(us) {
  if (!us || !us.length) return null;
  let cx = 0, cy = 0;
  for (const u of us) { cx += u.x; cy += u.y; }
  return nearestSupplyTo(cx / us.length, cy / us.length);
}
/* 本单位此刻是否站在某个补给点的圈内 */
function supplyAt(unit) {
  for (const s of (battle.supplies || [])) {
    if (Math.hypot(s.x - unit.x, s.y - unit.y) <= s.r) return s;
  }
  return null;
}
/* 每帧：圈内停留 ≥3 秒 ⇒ 回补弹药 */
function updateResupply(unit, dt) {
  const sup = supplyAt(unit);
  if (!sup) {
    unit._inSupplySince = null; unit._resupplyDwell = 0; unit._resupplying = false; return;
  }
  if (unit._inSupplySince == null) unit._inSupplySince = battle.time;
  const dwell = battle.time - unit._inSupplySince;
  unit._resupplyDwell = dwell;
  if (dwell < RS_DWELL) { unit._resupplying = false; return; }
  unit._resupplying = true;
  const gain = RS_RATE * dt;
  const refill = (w) => {
    if (!w || w.ammoMax == null || !(w.ammoMax > 0)) return;
    if (w.ammo < w.ammoMax) w.ammo = Math.min(w.ammoMax, w.ammo + w.ammoMax * gain);
  };
  for (const s of (unit.soldiers || [])) if (s.alive) refill(s.weapon);
  for (const v of (unit.vehicles || [])) if (!v.destroyed && !v.abandoned) refill(v.weapon);
}

/* ★★ R9.2：目标点不可通行 ⇒ 吸附到最近可通行处（150m 内环形搜索，带缓存）
   —— 治"轮式开进树林 = 顶着墙原地打滑（看起来永久卡住）"。
      吸附只改目标点，不改走法（仍然是"直线 + 被挡就找绕行点"）。 */
function snapTargetPassable(unit, mt) {
  const R = bodyRadiusOf(unit);
  const key = Math.round(mt.x) + ',' + Math.round(mt.y) + '|' + (unit.mobilityType || '');
  if (unit._snapKey === key) return unit._snapTarget || mt;
  unit._snapKey = key;
  unit._snapTarget = null;
  if (isMoveBlockedAt(mt.x, mt.y, R)) {
    const spot = findNearbyFreeSpot(mt.x, mt.y, 150, R);
    if (spot && (Math.abs(spot.x - mt.x) > 0.5 || Math.abs(spot.y - mt.y) > 0.5)) {
      unit._snapTarget = { x: spot.x, y: spot.y };
    }
  }
  return unit._snapTarget || mt;
}

/* ============================================================
   ★★ R9.2（快速移动）：**最近公路投影 → 沿折线 → 直线收尾**
   ------------------------------------------------------------
   玩家定案：只做"投影 + 沿折线取点"，**不做 A\\***。
   路点表在**下达命令时算一次**（挂在命令 `ord.route` 上），mover 只负责"走到下一个路点"。
   ============================================================ */
/* 点 (x,y) 到折线段的投影（含段内参数 t） */
function projectOnSeg(x, y, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? ((x - a.x) * vx + (y - a.y) * vy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + vx * t, y: a.y + vy * t, t };
}
/* 全地图公路里离 (x,y) 最近的点：{ road, seg, i, x, y, dist } */
function nearestRoadPoint(gm, x, y) {
  if (!gm || !gm.roads || !gm.roads.length) return null;
  let best = null, bd = Infinity;
  for (const r of gm.roads) {
    const pts = r.pts || [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = projectOnSeg(x, y, pts[i], pts[i + 1]);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = { road: r, seg: i, t: p.t, i: (p.t < 0.5 ? i : i + 1), x: p.x, y: p.y, dist: d };
      }
    }
  }
  return best;
}
/* ★★★ R9.5c：**"这里是公路吗"（地形格版）**
   ------------------------------------------------------------
   为什么需要：**预设/老地图的公路是"刷在地形格子里的"**（`gLine(gm,…, 'road')` ⇒ 合成格里有 road 格），
   而它们的 `gm.roads`（矢量折线）是**空的** ⇒ 老的 `planFastRoute` 立刻 `return null`
   ⇒ **"快速移动"退化成直线**（玩家看到"点了快速移动还是走直线"）。
   所以判定"在路上"必须走**地形格**，不能只看矢量折线。 */
function roadTileAt(gm, x, y) {
  if (!gm || typeof getGridTerrain !== 'function') return false;
  const t = getGridTerrain(gm, x, y);
  return !!(t && t.id === ROAD_TILE_ID);
}

/* 离 (x,y) 最近的道路格（螺旋扫描：每 2 格一圈、每圈错开相位 ⇒ 不会漏掉 ≥2 格宽的路）
   null = maxR 内没有路 */
function nearestRoadTile(gm, x, y, maxR) {
  if (roadTileAt(gm, x, y)) return { x, y, d: 0 };
  const cs = gm.cellSize;
  for (let r = cs; r <= maxR; r += cs * 2) {
    const n = Math.max(8, Math.min(64, Math.round(2 * Math.PI * r / (cs * 3))));
    for (let a = 0; a < n; a++) {
      const th = a / n * Math.PI * 2 + r;                  // +r：每圈相位错开
      const px = x + Math.cos(th) * r, py = y + Math.sin(th) * r;
      if (px < 0 || py < 0 || px > gm.w || py > gm.h) continue;
      if (roadTileAt(gm, px, py)) return { x: px, y: py, d: r };
    }
  }
  return null;
}

/* ★★★ R9.5c：**栅格公路版的"快速移动"路点表**（预设/老地图专用）
   ------------------------------------------------------------
   同样**不做 A\***，规则是"**朝目标迈一步 → 吸附回路面**"：
     ① 接入最近的公路格
     ② 每步：按"到目标的方位"迈 `step`，落点若不路上就**吸附到最近的公路格**
        （预设地图的主路是 100m 宽的"带"、小巷只有 40m ⇒ 不吸附的话一步就跨出去、
         立刻判定"跟丢" ⇒ 退化成直线，这正是玩家看到的"快速移动没用"）
        每个候选方向都要"离目标更近"才接受；左右偏 ±20°~±70° 用来跟弯道
     ③ 连续两步都跟不动 ⇒ 直线收尾到目标
   代价：只在**下达命令时算一次**，每步只有几次地形格查询（吸附是螺旋扫描，路上就直接命中）。 */
function planFastRouteByGrid(unit, tx, ty) {
  const gm = battle.gridMap;
  if (!gm || !gm.w) return null;
  const prof = unitPlanProfile(unit, tx, ty);               // ★ R9.6.6/7：地形 × 单位（含"车过不去就下车走"）
  const info = { kind: 'none', mob: prof.mob, speed: prof.speed, ride: prof.ride, eta: Infinity, why: '' };
  unit._fastRouteInfo = info;
  const tStraight = legTime(unit, { x: unit.x, y: unit.y }, { x: tx, y: ty }, prof);
  const pin = nearestRoadTile(gm, unit.x, unit.y, 2500);
  if (!pin) { info.kind = 'straight'; info.eta = tStraight; info.why = '附近没公路⇒改直线'; return null; }
  const route = [];
  if (pin.d > 30) route.push({ x: pin.x, y: pin.y });       // ① 接入公路
  const step = Math.max(120, Math.min(400, Math.hypot(tx - pin.x, ty - pin.y) / 20));
  const TURNS = [0, 0.35, -0.35, 0.7, -0.7, 1.2, -1.2];
  const JUNCTION_TOL = 150, LEAVE_BACK = 260;
  let cx = pin.x, cy = pin.y, guard = 0, stall = 0, nonImprove = 0;
  let bestD = Math.hypot(tx - cx, ty - cy), bestIdx = route.length;
  while (guard++ < 80) {
    const dTo = Math.hypot(tx - cx, ty - cy);
    if (dTo < step * 0.9) break;
    const base = Math.atan2(ty - cy, tx - cx);
    let pick = null, pickScore = -Infinity, pickD = dTo, improved = false;
    let fb = null, fbScore = -Infinity, fbD = dTo;          // 兜底：平走/微绕（过路口/弯道）
    for (let i = 0; i < TURNS.length; i++) {
      const th = base + TURNS[i];
      const px = cx + Math.cos(th) * step, py = cy + Math.sin(th) * step;
      if (px < 0 || py < 0 || px > gm.w || py > gm.h) continue;
      const snap = roadTileAt(gm, px, py) ? { x: px, y: py } : nearestRoadTile(gm, px, py, step * 0.7);
      if (!snap) continue;
      /* ★ R9.6.6：这一步的**时间代价**（地形倍率 × 单位速度）—— 开不过去的地形直接不选；
         剩余距离按"落点的地形倍率"估 ⇒ 宁可多绕 100m 公路，也不扎进慢地形。 */
      const stepT = legTime(unit, { x: cx, y: cy }, snap, prof);
      if (!isFinite(stepT)) continue;
      const nd = Math.hypot(tx - snap.x, ty - snap.y);
      const mulHere = Math.max(0.05, mobilityMulForTile(prof.mob, getGridTerrain(gm, snap.x, snap.y)));
      const score = -(stepT + nd / (prof.speed * mulHere)) - Math.abs(TURNS[i]) * 2;
      /* ★ 不许"回头"：以"从接入点到当前点"的**净行进方向**为轴，
         新点在该轴上的投影不许明显倒退（否则会在"最接近点"附近来回乒乓 ——
         那里距离面是平的，任何基于距离的判据都失效）。 */
      const progX = cx - pin.x, progY = cy - pin.y;
      const progLen = Math.hypot(progX, progY);
      if (progLen > step) {
        const ux = progX / progLen, uy = progY / progLen;
        const newProj = (snap.x - pin.x) * ux + (snap.y - pin.y) * uy;
        if (newProj < progLen - step * 0.15) continue;
      }
      /* ★ 首选"真的在靠近"；只有**找不到任何靠近的走法**时才用"平走/微绕"兜底
         —— 否则会沿着公路乱逛（测试用例 B 从 21 个路点涨到 52 个）。 */
      if (nd < dTo - 5) {
        if (score > pickScore) { pickScore = score; pick = { x: snap.x, y: snap.y }; pickD = nd; improved = true; }
      } else if (nd <= dTo + JUNCTION_TOL) {
        if (score > fbScore) { fbScore = score; fb = { x: snap.x, y: snap.y }; fbD = nd; }
      }
    }
    if (!pick) { pick = fb; pickD = fbD; improved = false; }
    if (!pick) { if (++stall >= 4) break; continue; }
    stall = 0;
    if (!improved && ++nonImprove >= 6) break;               // 兜底最多连着走 6 步（≈2.4km）
    if (improved) nonImprove = 0;
    cx = pick.x; cy = pick.y;
    route.push({ x: cx, y: cy });
    if (pickD < bestD - 1) { bestD = pickD; bestIdx = route.length; }   // 新的"最近点"
    if (pickD > bestD + LEAVE_BACK) break;                   // 已经越过最近点 ⇒ 该下路了
  }
  route.length = Math.min(route.length, bestIdx);           // ★ 只在最近点下路（丢掉绕远的路点）
  /* ★ R9.6.6：预计用时（沿路 + 最后一段直插）；**直线更快 ⇒ 干脆走直线**（返回 null） */
  const eta = pathTime(unit, route, prof)
            + legTime(unit, route[route.length - 1], { x: tx, y: ty }, prof);
  if (!isFinite(eta) || (isFinite(tStraight) && tStraight * fastRoadWorseRatio(prof) < eta)) {
    info.kind = 'straight';
    info.eta = tStraight;
    info.why = isFinite(tStraight) ? '沿公路绕太远⇒改直线' : '附近没公路⇒改直线';
    return null;
  }
  route.push({ x: tx, y: ty });                             // ③ 最后一段直线
  info.kind = 'grid'; info.eta = eta;
  return route.length > 1 ? route : null;
}

/* ============================================================
   ★★★ R9.6.5：快速移动 = **投影点起步 + 多段公路接力**
   ------------------------------------------------------------
   玩家实测两处不对（截图：黄线 = 实际、绿线 = 期望）：
     ① **直道中段的单位会先"回头"**：路线是从"最近的那个顶点"开始走的，而一条直道只有
        两个顶点 ⇒ 单位先开回端点、再沿路走。现在改成**从投影点（seg + t）起步**：
        同段直接走、跨段只补"行进方向上的顶点"，**绝不先往回退**。
     ② **到路口不能换路**：旧版只沿一条路走到"离目标最近的点"就下路，然后一条长直线横穿
        （穿过岔路/建筑/城区）。现在改成**接力**：沿当前路开到"离目标那条路最近的点"（≈路口），
        换到那条路继续走，最多换 `FAST_HOP_MAX` 次；只有"目标离这条路的最近点 ≤ FAST_LEAVE_MAX"
        才下路走直线收尾。
   **仍然不做 A\***：全部是"投影 + 折线取点 + 有界接力"，代价 = 下达命令时算一次。
   ============================================================ */
const FAST_LEAVE_MAX = 300;      // 目标离线 ≤300m ⇒ 视为"就在这条路上"，下路走直线收尾
const FAST_JUNCTION_R = 180;     // 换路判定：路口的另一条路在 180m 内就算接得上
/* ★ R9.6.11：**换路上限 6 → 24**（玩家实测："快速移动好像距离远一点就识别不到道路"）
   —— 6 跳只够 6 个路口，长距离跨路网会**半路截断**（路线走一段就变直线）。 */
const FAST_HOP_MAX = 24;
/* ★ R9.6.11：**"沿公路 vs 直线"的取舍改成倍率**（旧版只要沿路慢一点点就退回直线，
   于是长距离（路线更绕）动辄"直线更快⇒改直线" = 玩家看到的"识别不到道路"）。
   玩家按的是「快速移动」= 明确要求走公路 ⇒ 只有沿路慢到离谱才放弃：
     · 乘车：慢 2.5 倍以上才改直线（公路有 1.7~1.9× 速度加成，绕 2.5 倍仍值）
     · 徒步：公路没有速度加成 ⇒ 绕 1.25 倍以上就改直线（和旧行为基本一致） */
const FAST_ROAD_WORSE_RIDE = 2.5;
const FAST_ROAD_WORSE_FOOT = 1.25;
function fastRoadWorseRatio(prof) {
  return (prof && prof.ride) ? FAST_ROAD_WORSE_RIDE : FAST_ROAD_WORSE_FOOT;
}

/* 单条公路上的最近投影 { seg, t, x, y, dist }（seg = 段序号，t = 段内参数） */
function nearestOnRoad(road, x, y) {
  const pts = (road && road.pts) || [];
  let best = null, bd = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = projectOnSeg(x, y, pts[i], pts[i + 1]);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = { seg: i, t: p.t, x: p.x, y: p.y, dist: d }; }
  }
  return best;
}

/* 两条线段的最近点对；返回 r1 段上的点与参数 s
   ★ 平行/共线（含 den 被浮点误差算成 0）必须单独处理：旧写法 `s=0, t=…` 会把点对判成
     "r1 的起点 ↔ r2 的某个端点"，于是**"路口"被算到离路口几公里外的端点**（测试当场抓到：
     直路 A 与横路 C 平行时，路口被判到 (0,0)，接力直接失败 ⇒ 退回一条长直线）。 */
function segSegClosest(a, b, c, d) {
  const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y;
  const wx = a.x - c.x, wy = a.y - c.y;
  const A = ux * ux + uy * uy, B = ux * vx + uy * vy, C = vx * vx + vy * vy;
  const D = ux * wx + uy * wy, E = vx * wx + vy * wy;
  const den = A * C - B * B;
  if (den < 1e-9) {
    let best = null, bd = Infinity;
    for (const v of [c, d]) {
      const p = projectOnSeg(v.x, v.y, a, b);      // r2 端点 → r1
      const q = projectOnSeg(p.x, p.y, c, d);      // 再投回 r2 量距离
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      if (dist < bd) { bd = dist; best = { s: p.t, t: q.t, x: p.x, y: p.y, dist }; }
    }
    return best || { s: 0, t: 0, x: a.x, y: a.y, dist: Math.hypot(a.x - c.x, a.y - c.y) };
  }
  let s = (B * E - C * D) / den, t = (A * E - B * D) / den;
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));
  const px = a.x + ux * s, py = a.y + uy * s;
  const qx = c.x + vx * t, qy = c.y + vy * t;
  return { s, t, x: px, y: py, dist: Math.hypot(px - qx, py - qy) };
}

/* r1 上离 r2 最近的点（= 两条路的"路口"）：{ seg, t, x, y, dist } */
function nearestPointRoadToRoad(r1, r2) {
  const p1 = (r1 && r1.pts) || [], p2 = (r2 && r2.pts) || [];
  let best = null, bd = Infinity;
  for (let i = 0; i + 1 < p1.length; i++) {
    for (let j = 0; j + 1 < p2.length; j++) {
      const c = segSegClosest(p1[i], p1[i + 1], p2[j], p2[j + 1]);
      if (c.dist < bd) { bd = c.dist; best = { seg: i, t: c.s, x: c.x, y: c.y, dist: c.dist }; }
    }
  }
  return best;
}

/* 沿一条公路从 from 走到 to：**只补"行进方向上的顶点"**（同段 ⇒ 一个顶点都不加）
   —— 这就是"直道中段不再回头"的关键：绝不去够背后那个顶点。 */
function followRoad(road, from, to, route) {
  const pts = (road && road.pts) || [];
  if (!from || !to || pts.length < 2) return;
  const fs = from.seg | 0, ts = to.seg | 0;
  if (ts > fs) for (let i = fs + 1; i <= ts; i++) route.push({ x: pts[i].x, y: pts[i].y });
  else if (ts < fs) for (let i = fs; i >= ts + 1; i--) route.push({ x: pts[i].x, y: pts[i].y });
}

/* 除 except 之外、离 (x,y) 最近的公路投影（路口换路用）；maxR 内没有 ⇒ null */
function nearestRoadPointExcept(gm, x, y, except, maxR) {
  if (!gm || !gm.roads || !gm.roads.length) return null;
  let best = null, bd = maxR;
  for (const r of gm.roads) {
    if (r === except) continue;
    const p = nearestOnRoad(r, x, y);
    if (p && p.dist < bd) { bd = p.dist; best = { road: r, seg: p.seg, t: p.t, x: p.x, y: p.y, dist: p.dist }; }
  }
  return best;
}


/* ★★★ R9.6.6：**沿某条公路的"最优下路方案"**（时间代价；不含目标点本身）
   —— 在本路的折线上每到一个候选点，都算一次"沿路走到这里 + 从这点直插目标"要多久，
      取最快的那点当**下路点**。返回 { pts:[…下路点], eta:秒 }；全不可行 ⇒ null。
   它同时取代了旧版写死的 `FAST_LEAVE_MAX = 300m`：
     轮式面前是森林 ⇒ 直插 = ∞ ⇒ 必然"沿路走到底"；步兵面前畅通 ⇒ 该早下就早下。 */
function estimateOnRoad(unit, road, from, tx, ty, prof) {
  const pts = (road && road.pts) || [];
  if (pts.length < 2 || !from) return null;
  const q = nearestOnRoad(road, tx, ty) || from;
  const trail = [{ x: from.x, y: from.y }];
  followRoad(road, from, q, trail);
  trail.push({ x: q.x, y: q.y });
  /* 沿路时间的前缀和（一次算完；任一段开不过去 ⇒ 后面全是 ∞） */
  const pre = [0];
  for (let i = 1; i < trail.length; i++) {
    const d = legTime(unit, trail[i - 1], trail[i], prof);
    pre.push(isFinite(d) && isFinite(pre[i - 1]) ? pre[i - 1] + d : Infinity);
  }
  /* 候选下路点：均匀抽稀到 ≤24 个（防"路点几百个的地图"在下令那一下卡顿）+ 必带最后一个 */
  const stride = Math.max(1, Math.ceil(trail.length / 24));
  const cands = [];
  for (let i = 0; i < trail.length; i += stride) cands.push(i);
  if (cands[cands.length - 1] !== trail.length - 1) cands.push(trail.length - 1);
  let best = null;
  for (const i of cands) {
    if (!isFinite(pre[i])) break;              // 连路都开不过去（不该发生）⇒ 后面免谈
    const tOff = legTime(unit, trail[i], { x: tx, y: ty }, prof);
    if (!isFinite(tOff)) continue;             // 从这点直插过不去 ⇒ 看下一个候选
    const eta = pre[i] + tOff;
    if (!best || eta < best.eta) best = { pts: trail.slice(0, i + 1), eta };
  }
  return best;
}


/* ★★★ R9.6.6：快速移动的完整路点表 = **投影点起步 → 沿路 → （路口换路）×N → 直线收尾**
   选路判据 = **时间代价（地形数值 × 单位数值）**，不再是几何距离：
     · 方案 A：沿当前路走到 `estimateOnRoad()` 给的最优下路点 → 直插目标
     · 方案 B：沿当前路开到"离目标那条路最近的点"（≈路口）→ 换路（1 跳前瞻再比一次时间）
     · 两案都比"直线（越野）"慢 ⇒ 返回 null，让调用方走直线（note 写明"直线更快"）
   （算不出来 ⇒ null；`gm.roads` 为空则改用"道路格"版。） */
function planFastRoute(unit, tx, ty) {
  const gm = battle.gridMap;
  if (!gm) return null;
  const prof = unitPlanProfile(unit, tx, ty);          // ★ R9.6.6/7：地形 × 单位（含"车过不去就下车走"）
  const info = { kind: 'none', mob: prof.mob, speed: prof.speed, ride: prof.ride, eta: Infinity, why: '' };
  unit._fastRouteInfo = info;
  const gTgt = nearestRoadPoint(gm, tx, ty);           // 目标侧最近的路（接力目标）
  if (!gm.roads || !gm.roads.length) {
    /* ★★★ R9.5c：这张地图**没有矢量公路**（预设/老地图：公路刷在格子里的）
       ⇒ 改用"道路格"版本（同一条规则：沿公路走，不做 A*）。
       ★ R9.6.11：**只有"真的没有矢量公路"才走这条分支** —— 旧判据还有一条
       "目标离路网 >2500m 也切过去"，那会让**远距离快速移动**在矢量公路上整个失效
       （玩家实测："好像移动距离较远时就不行"）：矢量版被换成了道路格版，
       而矢量公路地图里根本没有 road 格 ⇒ 立刻"附近没公路⇒改直线"。 */
    const g = planFastRouteByGrid(unit, tx, ty);
    unit._fastRouteKind = g ? 'grid' : 'none';
    return g;
  }
  const tStraight = legTime(unit, { x: unit.x, y: unit.y }, { x: tx, y: ty }, prof);  // 越野直插
  const route = [];
  const visited = {};
  const keyOf = (r) => (r.id || ('idx' + gm.roads.indexOf(r)));
  let cur = { x: unit.x, y: unit.y };
  let forced = null;                                   // 路口刚换上的那条路（下一轮强制走它）
  let hopEta = Infinity;                               // 最近一次算出来的"整条方案"预计用时

  for (let hop = 0; hop < FAST_HOP_MAX; hop++) {
    let pin = null, R = null;
    if (forced && !visited[keyOf(forced)]) {           // ① 路口换路：优先走刚接上的那条
      const p = nearestOnRoad(forced, cur.x, cur.y);
      if (p && p.dist <= FAST_JUNCTION_R * 2) { R = forced; pin = p; }
      forced = null;
    }
    if (!R) {                                          // 否则：离当前位置最近的公路
      pin = nearestRoadPoint(gm, cur.x, cur.y);
      if (!pin || pin.dist > 2500) break;
      R = pin.road;
    }
    if (visited[keyOf(R)]) break;                      // 走过这条路 ⇒ 收尾（防乒乓）
    visited[keyOf(R)] = 1;
    const tIn = legTime(unit, { x: cur.x, y: cur.y }, { x: pin.x, y: pin.y }, prof);   // 接入代价

    /* ② 方案 A：就沿这条路（在"沿路 + 直插"最优处下路） */
    const A = estimateOnRoad(unit, R, pin, tx, ty, prof);
    const etaA = (A && isFinite(tIn)) ? tIn + A.eta : Infinity;

    /* ③ 方案 B：沿这条路到"离目标那条路最近的点"（≈路口）再换路；1 跳前瞻估时间 */
    let jr = null, alt = null, etaB = Infinity, jToAlt = 0;
    if (gTgt.road !== R) {
      jr = nearestPointRoadToRoad(R, gTgt.road);
      if (jr) {
        alt = nearestRoadPointExcept(gm, jr.x, jr.y, R, FAST_JUNCTION_R);
        if (alt) {
          const trail = [{ x: pin.x, y: pin.y }];
          followRoad(R, pin, jr, trail);
          trail.push({ x: jr.x, y: jr.y });
          const tToJ = pathTime(unit, trail, prof);
          const altProj = nearestOnRoad(alt.road, jr.x, jr.y);
          const ahead = altProj ? estimateOnRoad(unit, alt.road, altProj, tx, ty, prof) : null;
          jToAlt = legTime(unit, { x: jr.x, y: jr.y }, { x: alt.x, y: alt.y }, prof);
          if (isFinite(tToJ) && ahead && isFinite(jToAlt)) etaB = tIn + tToJ + jToAlt + ahead.eta;
        }
      }
    }

    if (!isFinite(etaA) && !isFinite(etaB)) break;      // 两条路都过不去 ⇒ 交给直线兜底
    if (pin.dist > 40) route.push({ x: pin.x, y: pin.y });   // 接入公路（**投影点**，不是顶点）

    if (isFinite(etaA) && etaA <= etaB) {              // ④ 时间更短 ⇒ 沿这条路走完
      for (const p of A.pts) route.push({ x: p.x, y: p.y });
      hopEta = etaA;
      break;
    }
    /* ⑤ 否则：沿这条路开到路口 jr，换到 alt 继续（下一轮再按时间二选一） */
    const seg = [];
    followRoad(R, pin, jr, seg);
    for (const p of seg) route.push({ x: p.x, y: p.y });
    route.push({ x: jr.x, y: jr.y });
    cur = { x: alt.x, y: alt.y };
    forced = alt.road;
    if (alt.dist > 40) route.push({ x: alt.x, y: alt.y });
    hopEta = etaB;
  }

  /* ⑥ 收尾：沿路方案 vs 直线（按**时间 × 倍率**比；直线过不去 = ∞ ⇒ 必然选沿路）
     ★ R9.6.11：倍率见 `fastRoadWorseRatio()` —— 玩家按「快速移动」就是要走公路。 */
  if (route.length && isFinite(hopEta) && (!isFinite(tStraight) || hopEta <= tStraight * fastRoadWorseRatio(prof))) {
    route.push({ x: tx, y: ty });
    info.kind = 'vector'; info.eta = hopEta;
    unit._fastRouteKind = 'vector';
    return route.length > 1 ? route : null;
  }
  info.kind = 'straight';
  info.eta = tStraight;
  info.why = isFinite(tStraight)
    ? (route.length ? '沿公路绕太远⇒改直线' : '附近没公路⇒改直线')
    : '附近没公路⇒改直线';
  return null;
}

/* 按「机动类型」算地形倍率（车辆跟随要用车自己的类型，不能用下车后的 foot）
   ★ 唯一真相在 grid-maps.js 的 mobilityMulForTile —— 烘焙/运行时同源，否则"车不贴公路" */
function terrainMobilityMulFor(mt, tg) {
  return mobilityMulForTile(mt, tg);
}

/* ★ R7.7：NaN 守卫 —— 单位的坐标一旦被污染成 NaN / Infinity，它会**永远"消失 / 不动"**
   （而且会顺着路径计算传染给邻居）。这里直接把它（连同士兵与载具）复位到最近的可用位置，
   并清掉路线让它重新规划。 */
function healUnitPosition(unit) {
  const gm = battle.gridMap;
  let px = MAP_W / 2, py = MAP_H / 2, found = false;
  if (gm && gm.w) {
    const cx = gm.w / 2, cy = gm.h / 2;
    for (let r = 0; r <= 2500 && !found; r += 50) {
      for (let k = 0; k < 12; k++) {
        const a = k * Math.PI / 6;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (x < 20 || y < 20 || x > gm.w - 20 || y > gm.h - 20) continue;
        if (pointIsBlocking(x, y)) continue;
        px = x; py = y; found = true; break;
      }
    }
  }
  unit.x = px; unit.y = py;
  unit.lastPosX = px; unit.lastPosY = py;
  for (const s of unit.soldiers) { s.x = px; s.y = py; }
  for (const v of (unit.vehicles || [])) { v.x = px; v.y = py; }
  unit._avoidCache = null;
  if (!unit._nanHealLogged) {
    unit._nanHealLogged = true;
    console.warn('[nav] 单位坐标出现 NaN，已复位到最近可通行点：', unit.name || unit.id);
  }
}

function updateUnit(unit, dt) {
  /* ★ R7.7：NaN 守卫放最前面（坐标一旦污染，后面所有计算都会跟着坏） */
  if (!isFinite(unit.x) || !isFinite(unit.y)) healUnitPosition(unit);

  /* ★★★ R9.6.2：**地图尺寸自愈** —— `MAP_W/MAP_H` 必须与当前战场地图一致。
     一旦它俩是旧值/0/未定义，"把目标点夹进地图"这一步就会把目标夹到**错误的角落**
     （玩家反馈："一开局所有单位朝地图四个角跑、还跑出地图"）。
     这里每帧校正一次（代价 = 两次比较）。 */
  const gmNow = battle.gridMap;
  if (gmNow && gmNow.w > 0 && (MAP_W !== gmNow.w || MAP_H !== gmNow.h)) {
    MAP_W = gmNow.w; MAP_H = gmNow.h;
  }

  /* ===== 0. 房屋占用管理（光栅模式：用格子坐标哈希） ===== */
  if (battle.gridMap) {
    const gm = battle.gridMap;
    const gx = Math.floor(unit.x / gm.cellSize);
    const gy = Math.floor(unit.y / gm.cellSize);
    const inHouse = getGridTerrain(gm, unit.x, unit.y).id === 'house';
    const key = inHouse ? (gy * gm.gw + gx) : null;
    if (unit._houseKey !== key) {
      if (unit._houseKey !== null && unit._houseKey !== undefined) {
        const oldHouses = battle._houseOccupants || {};
        if (oldHouses[unit._houseKey] === unit.id) delete oldHouses[unit._houseKey];
      }
      unit._houseKey = key;
      if (key !== null) {
        if (!battle._houseOccupants) battle._houseOccupants = {};
        battle._houseOccupants[key] = unit.id;
      }
    }
  }

  /* ===== 1. 卡墙检测（不再"穿墙兜底"！） =====
     ★ 老逻辑有两个致命问题：
       ① 阈值 fixed "0.5 秒内挪动 < 3m 就算卡" —— 徒步单位速度只有 ~2.4m/0.5s，
          于是几乎每个步兵单位都会被误判为"卡住"，然后每 1.5 秒变一次幽灵穿墙；
       ② 兜底手段是"幽灵 1.5 秒无视阻挡" —— 这就是玩家看到的"卡一下然后穿模"。
     现在：阈值随速度自适应；兜底改为「重新绕行 → 挪到最近可通行处（≤25m）」。 */
  if (battle.time - unit.lastCheckTime > 0.5) {
    const moved = Math.hypot(unit.x - unit.lastPosX, unit.y - unit.lastPosY);
    const expect = Math.max(1, (unit.speed || 5) * 0.5 * 0.5);   // 0.5 秒内至少该走的距离
    if (unit.stance === 'moving' && moved < expect) {
      unit.stuckTime = (unit.stuckTime || 0) + 0.5;
      if (unit.stuckTime >= 1.5) {
        unit._avoidCache = null;                                 // 强制重新找绕行点
        unit._repelSide = (Math.random() < 0.5) ? 1 : -1;        // 固定往一侧绕，避免左右抖
        unit._repathUntil = battle.time + 3;
        /* ★ R7.5.1：受阻**不再申请重算路线**（命令级承诺：路线不中途换）。
           这里全是"就地解决"：重找绕行点 / 固定绕行侧 / 沿走廊挤过去；
           真走不动就下面 8 秒那条"停 2 秒再走"。
           —— 旧版每 1.5 秒申请一次、3 秒冷却 ⇒ 全场单位每 3 秒一起跑 A* = 周期性整体卡顿。 */
      }
      /* ★★ R9.2：卡住 >6 秒 ⇒ **上报命令层**（清掉本组命令，让将军下一轮换个目标/方向）
         —— 治"车辆进了不可通行地形就永久顶墙"：不再死顶，而是重新决策。
            5 秒冷却，避免频繁打断；单位自己也会被 `snapTargetPassable` 拉出不可通行点。 */
      if (unit.stuckTime >= 6 && unit._groupKey && typeof Cmd !== 'undefined'
          && battle.time > (unit._cmdStuckReportAt || 0) + 5) {
        const co = groupOrderOf(unit);            // ★ R9.5d：有效命令（单位级优先）
        /* ★★★ R9.5b：**玩家的命令只有玩家能取消** ——
           旧版这里会把"卡住 >6 秒"的组命令直接 `Cmd.clear` 掉，
           于是玩家的移动命令在几秒后被静默丢弃 ⇒ 部队"自己动起来"、
           玩家看到的就是"我的命令被覆盖"。现在只对 AI/脚本的命令清。 */
        if (co && !co.done && co.src !== 'player') {
          unit._cmdStuckReportAt = battle.time;
          Cmd.clear(co.groupKey || unit._groupKey, '单位卡住 >6 秒（' + (unit._idleWhy || '未知') + '）');
        } else if (co && !co.done && co.src === 'player') {
          unit._cmdStuckReportAt = battle.time;      // 只记时间（画面/DEV 面板会显示"已卡住 Ns"）
        }
      }
      /* ★★ R8：**阈值错峰 + 缩短停顿** —— 旧版是固定"卡 8 秒 ⇒ 停 2 秒"：
         一批单位同时被堵住时会在**同一帧**一起触发 ⇒ 全军一起停 2 秒
         （这正是玩家看到的"整体静止一下"）。现在每个单位一个固定随机阈值（8~13 秒）、
         停顿 1.2 秒 ⇒ 永远不会整体同步。 */
      const stuckLimit = 8 + (unit._stuckPhase === undefined ? (unit._stuckPhase = Math.random() * 5) : unit._stuckPhase);
      if (unit.stuckTime >= stuckLimit) {
        // ★ 绝不"挪一截"！（旧实现会沿朝向位移 3~8m ⇒ 玩家看到的就是
        //   "红方朝下、蓝方朝上每几秒瞬移 5m"）
        //   改为：放弃本次移动**0.35 秒**（R9.1：1.2 → 0.35，只当"擦墙打滑"处理），
        //   让局部避障/队列自然疏通（**不换路**）
        unit._holdMoveUntil = battle.time + 0.35;
        unit._avoidCache = null;
        unit.stuckTime = 0;
      }
    } else {
      unit.stuckTime = 0;
    }
    unit.lastPosX = unit.x;
    unit.lastPosY = unit.y;
    unit.lastCheckTime = battle.time;
  }

  /* ===== 2. 压制状态更新 ===== */
  updateSuppression(unit, dt);

  /* ===== 3. 分离力 ===== */
  const _p0 = performance.now();     // ★ R8 分段计时
  const unitInHouse = isInHouse(unit.x, unit.y);
  const sepRadius = unitInHouse ? SEPARATION_RADIUS * 0.35 : SEPARATION_RADIUS;
  let sepX = 0, sepY = 0;
  for (const other of battle.units) {
    if (other === unit || !other.alive) continue;
    const otherInHouse = isInHouse(other.x, other.y);
    if (unitInHouse !== otherInHouse) continue;
    const dx = unit.x - other.x, dy = unit.y - other.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 0.001 && d2 < sepRadius * sepRadius) {
      const d = Math.sqrt(d2);
      const force = (1 - d / sepRadius);
      sepX += (dx / d) * force;
      sepY += (dy / d) * force;
    }
  }
  // S-B：单位级分离改为整体推动该单位的士兵（乘车时推车，人跟着车走）
  // ★ 分离力不再"无差别推"：停稳的少推、炮已架好的完全不推（历史遗留：炮兵被推着挪窝）
  if (sepX !== 0 || sepY !== 0) {
    let pushMul = 1;
    if (unit.stance !== 'moving') pushMul = 0.15;
    if (unit._hasDeployWeapons && unitDeployed(unit)) pushMul = 0;
    /* ★ R8：路线/车道已删除 ⇒ 分离力不再需要"跟随路线时减弱"（观感问题改由 steer 层统一处理） */
    // ★ 开局 3 秒内分离力大幅减弱：出生布阵若有轻微重叠，也不要把单位"弹飞"
    if (battle.time < 3) pushMul *= 0.25;
    if (pushMul > 0) {
      const cx = Math.max(-SEPARATION_MAX, Math.min(SEPARATION_MAX, sepX));
      const cy = Math.max(-SEPARATION_MAX, Math.min(SEPARATION_MAX, sepY));
      const pushX = cx * SEPARATION_FORCE * dt * pushMul;
      const pushY = cy * SEPARATION_FORCE * dt * pushMul;
      if (unit.mounted && unit.vehicles && unit.vehicles.length) {
        for (const v of unit.vehicles) { if (!v.destroyed) { v.x += pushX; v.y += pushY; } }
      } else {
        for (const s of unit.soldiers) { s.x += pushX; s.y += pushY; }
      }
    }
  }

  /* ===== 4. 视野更新 ===== */
  profAdd('sep', performance.now() - _p0);     // ★ R8：分离力这一段（整单位 O(n) 邻接扫描）
  const _p1 = performance.now();
  if (!unit.visibleEnemies) unit.visibleEnemies = [];
  /* ★ R8 削峰：**错峰** —— 旧版所有单位在同一帧一起重算 ⇒ 每 0.3 秒一次"全场同步尖峰"
     （玩家看到的就是"每隔几秒整体静止一下"）。间隔仍是 0.3s，只加一个固定相位摊到不同帧。 */
  if (unit._visNextAt == null) unit._visNextAt = battle.time + hashPhase(unit, 0.3);
  if (battle.time >= unit._visNextAt) {
    unit.visibleEnemies = computeVisibleEnemies(unit);
    if (unit.isArtilleryUnit) {
      unit.visibleEnemies = computeTeamVisibleEnemies(unit);
    }
    unit.visibilityCacheTime = battle.time;
    unit._visNextAt = battle.time + 0.3;
  }
  profAdd('vis', performance.now() - _p1);     // ★ R8：视野这一段

  /* ===== 4.5 密度感知 ===== */
  const _p2 = performance.now();
  computeDensityPerception(unit);
  unit._densityWeight = getDensityWeight(unit);
  profAdd('dens', performance.now() - _p2);
  const _p3 = performance.now();

  /* ===== 5. 目标选择 ===== */
  let target = null;
  if ((unit.suppressionLevel || 0) >= SUPP_HARD) {
    unit.target = null;                       // ★ 只有极端压制才丢失目标
  } else if (unit.visibleEnemies.length) {
    const stillVisible = unit.target && unit.visibleEnemies.some(e => e.id === unit.target.id);
    const lockValid = unit.target && unit.target.alive && stillVisible &&
      battle.time < (unit.targetLockUntil || 0);
    if (!lockValid && (battle.time - unit.targetCacheTime > TARGET_CACHE_INTERVAL ||
        !unit.target || !unit.target.alive || !stillVisible)) {
      let best = null, bestScore = Infinity, unhurtable = 0;
      const tgSelf = getTerrainAt(unit.x, unit.y);
      for (const other of unit.visibleEnemies) {
        const dx = other.x - unit.x, dy = other.y - unit.y;
        const dist = Math.hypot(dx, dy) || 1;
        /* ★★★ 能力筛选（治"无 AT 手段的步兵锁定坦克一路送死"）：
           unitFirepowerList 已剔除「打不穿装甲」的武器 → 清单为空 = 我对它没有任何有效火力。
           这种情况它不该当我的主目标：交给有能力的友军（P1-4 呼叫），我去打我能打的。 */
        const fpList = unitFirepowerList(unit, other);
        if (!fpList.length) { unhurtable++; continue; }
        let score = dist;
        if (unitHasArtilleryFire(other) && unitHasArtilleryFire(unit)) score *= 0.4;   // ★ R9.6.11：反炮兵优先（含迫击炮）
        // 能在当前距离就打到它多少火力 → 越全越想打（0.80 ~ 1.35）
        const fpFrac = firepowerFractionAt(unit, other, dist, tgSelf.rangeMul);
        score *= 1.35 - Math.min(1, fpFrac) * 0.55;
        score *= 0.85 + (other.hpPersonnel / other.hpPersonnelMax) * 0.15;
        const otherCover = getCoverAt(other.x, other.y);
        score *= (1 - otherCover * 0.4);
        const otherSpeed = Math.max(1, other.speed || 10);
        score *= 0.8 + Math.min(1, otherSpeed / 50) * 0.4;
        if (score < bestScore) { bestScore = score; best = other; }
      }
      unit._noEngageableTarget = (!best && unhurtable > 0);   // 留给 EVADE（P1-4）用
      unit.target = best;
      unit.targetCacheTime = battle.time;
      unit.targetLockUntil = battle.time + TARGET_LOCK_TIME;
    }
    target = unit.target;
  } else {
    const staleVisible = unit.target && unit.visibleEnemies.some(e => e.id === unit.target.id);
    if (unit.target && unit.target.alive && staleVisible &&
        battle.time < (unit.targetLockUntil || 0)) {
      target = unit.target;
    } else {
      unit.target = null;
      target = null;
    }
  }

  /* ===== 6. 计算移动 ===== */
  const isDefender =
    (battle.mode === 'assault' && unit.side === 'red') ||
    (battle.mode === 'defend'  && unit.side === 'blue');

  let moveTarget = null;
  /* ★ R9.1：**行进节流**每帧复位（只有 execBound 的"压制段"会把它压到 0.25；
     旧版那里是 `return null` 直接停 1.8 秒 ⇒ 玩家看到的"所有单位走走停停"） */
  unit._paceMul = 1;

  const cmd = decideCommand(unit, target);
  updateCommand(unit, cmd);
  const activeCmd = unit._command;

  /* ★ R9：本组现行的**集团命令**（将军 / 玩家给的）。它决定"去哪 / 打谁 / 守不守"；
       执行层（怎么走、开火、上下车、架设）一律不变 —— 这就是这轮"只换两层"的边界。 */
  const gord = groupOrderOf(unit);

  // ★ 决策层：每 2 秒评估一次战术选项（HOLD/BOUND/ASSAULT/…），决定"走/停/往哪走"的意图
  updateTacticalOption(unit, activeCmd.target || target);

  if (activeCmd.type === 'TAKE_COVER') {
    moveTarget = computeSuppressedMove(unit);
  } else if (activeCmd.type === 'ATTACK' || activeCmd.type === 'APPROACH') {
    const atkTarget = activeCmd.target || target;
    if (atkTarget && atkTarget.alive) {
      const dx = atkTarget.x - unit.x, dy = atkTarget.y - unit.y;
      const dist = Math.hypot(dx, dy) || 1;
      const tg = getTerrainAt(unit.x, unit.y);
      let effectiveRange;
      if (unit.isArtilleryUnit) {
        effectiveRange = unit.range * tg.rangeMul * 0.9;
      } else {
        // ★ 交战距离 = "火力占比达标"处的距离（完全由武器数据决定，无硬编码乘数）
        effectiveRange = engageRangeOf(unit, atkTarget, tg.rangeMul);
      }
      moveTarget = computeCombatMove(unit, atkTarget, dist, effectiveRange);
    } else if (gord && gord.type === 'ATTACK' && gord.x != null) {
      /* ★ R9：组级 ATTACK 命令带着"敌情位置"（将军把最后一次看到的敌人位置随命令下发）
         ⇒ 本组里**看不见敌人**的单位也知道往哪推进，不再原地干等到组级重算 */
      moveTarget = { x: gord.x, y: gord.y };
      unit._aiWhy = null;
    } else {
      moveTarget = computeObjectiveMove(unit, isDefender);
    }
  } else if (activeCmd.type === 'MOVE_TO' || activeCmd.type === 'GARRISON' || activeCmd.type === 'HOLD') {
    moveTarget = computeObjectiveMove(unit, isDefender);
  }

  /* ============================================================
     ★★★ R9.3：**玩家命令优先于执行层的"自己决定"**
     ------------------------------------------------------------
     玩家从 DEV 面板下的命令（`src === 'player'`）必须**看得见效果**，否则就是
     "点了没反应 / 命令不遵守"。这里只覆盖"要不要动 / 往哪动"，
     开火 / 掩体 / 队形 / 上下车细节一律照旧。
     （之前的 bug：玩家的 `MOVE_TO` 只带 x/y、不带 `objectiveId`，
       而 `computeObjectiveMove` 只认 objectiveId ⇒ 命令被完全忽略。）
     ============================================================ */
  if (gord && gord.src === 'player' && !gord.done) {
    if ((gord.type === 'MOVE_TO' || gord.type === 'RESUPPLY' || gord.type === 'GARRISON') && gord.x != null) {
      moveTarget = { x: gord.x, y: gord.y };      // 玩家点了哪儿就去哪儿（快速移动的路点在下面 8.1 覆盖）
    } else if (gord.type === 'ATTACK' && gord.x != null && !(target && target.alive)) {
      /* ★★★ R9.5b：玩家点了「攻击 x/y」但本单位**看不见**敌人 ⇒ 推进到玩家点的位置。
         （看不见时旧代码会落回 `computeObjectiveMove` ⇒ 玩家去了完全不相干的地方
           = "我的命令被覆盖"。看得见敌人时不走这条：让下面的交战逻辑算出交战距离。） */
      moveTarget = { x: gord.x, y: gord.y };
      unit._cmdWhy = '玩家命令：攻击（推进到指定位置）';
    } else if (gord.type === 'HOLD' && activeCmd.type !== 'TAKE_COVER') {
      moveTarget = null;
      unit._cmdWhy = '玩家命令：固守';
    } else if (gord.type === 'TAKE_COVER') {
      moveTarget = computeSuppressedMove(unit);
      if (!moveTarget) unit._cmdWhy = '玩家命令：找掩体（附近没有可用掩体）';
    } else if (gord.type === 'WITHDRAW') {
      const e = (unit.visibleEnemies && unit.visibleEnemies[0]) || target;
      let ex, ey;
      if (e && e.alive) {
        const d = Math.hypot(unit.x - e.x, unit.y - e.y) || 1;
        ex = unit.x + (unit.x - e.x) / d * 500;   // 背离最近敌人 500m
        ey = unit.y + (unit.y - e.y) / d * 500;
      } else {
        const a = (unit.facing || 0) + Math.PI;   // 没敌人 ⇒ 沿反朝向后撤 400m
        ex = unit.x + Math.cos(a) * 400;
        ey = unit.y + Math.sin(a) * 400;
      }
      moveTarget = { x: Math.max(50, Math.min(MAP_W - 50, ex)),
                     y: Math.max(50, Math.min(MAP_H - 50, ey)) };
    }
  }

  /* ★★ R8：记下"为什么没有移动目标"（只读，不改行为）—— 用来回答"为什么整体静止" */
  unit._idleWhy = moveTarget ? null
    : (unit._cmdWhy || (activeCmd.type === 'HOLD' ? ('命令HOLD（选项 ' + (unit._option || '-') + '）')
       : (unit._aiWhy || ('AI未给移动目标（' + activeCmd.type + '）'))));
  unit._cmdWhy = null;
  unit._aiWhy = null;

  // ★ 密度偏移
  if (moveTarget) {
    moveTarget = applyDensityOffset(unit, moveTarget);
  }


  /* ★ 卡死后的"冷却"：放弃本次移动，稍后自然疏通（不再位移） */
  if (battle.time < (unit._holdMoveUntil || 0)) { moveTarget = null; unit._idleWhy = '卡住·缓0.35秒'; }

  /* ★★ R8 DEV：**手动操控**（?dev=1）
     —— 被玩家点过目的地的单位：**位置一律听玩家的**（AI 仍负责选目标 / 开火 / 上下车）。
        到达（< max(20m, 1.2×编队半径)）⇒ 自动解除，交回 AI。
     ★★★ R9.5b：玩家操控的那一方**不吃这一套**（`_manualDest` 是 DEV 的单兵手动目的地，
        要是它还生效，就会把玩家从命令条下的组命令挤掉 ⇒ "命令被覆盖"）。 */
  if (unit._manualDest && !isPlayerCtl(unit)) {
    const md = unit._manualDest;
    if (Math.hypot(md.x - unit.x, md.y - unit.y) < Math.max(20, unitArriveRadius(unit) * 1.2)) {
      unit._manualDest = null;                  // 到达 ⇒ 解除
    } else {
      moveTarget = { x: md.x, y: md.y };
    }
  }

  /* ★★★ R9.2：**空闲兜底已整段删除**（原来的 `nearestFreeObjective` + 环上分散落点）
     —— 它是"意图的第三个写者"：命令层已经表态（HOLD / 已到点）时，它还会把人拽去据点，
        于是玩家看到"要走不走 / 走两秒停一下"。
     现在将军层覆盖到**所有组**（每 3~6 秒必有一条现行命令）⇒ 不再需要兜底：
       · 要"永远有下一条命令" ⇒ 改将军层的规则（`js/ai-general.js`），不在执行层塞兜底
       · `?gen=0`（将军层停手）时行为回到"原有 AI 自己决定"（decideCommand / computeObjectiveMove） */

  /* ★★ R9.2：**快速移动（沿公路）** —— 路点表在下达命令时算好了（`gord.route`），
     这里只消费：**"穿过该点的垂面"或"已经很近"**才 pop 掉；走完 ⇒ 走最后那段直线。
     ★★★ R9.6（P2）：旧版是"走到 **40m** 内就 pop" ⇒ **每段都往里切一点**，
     整条路径越走越偏（玩家图上那个"圈"）。现在改成"过点"判定：
       · 相对**本段起点**算"是否已经越过该路点"（垂面判定）⇒ 线段被完整走完，不再切角
       · 只有在"已经很近（≤0.45×编队半径）"时才允许提前 pop（防止贴着路点转圈）
     玩家手动目的地（`_manualDest`）优先级更高，上面已经覆盖。 */
  if (gord && gord.fast && gord.route && gord.route.length && !unit._manualDest) {
    const legKey = (gord.groupKey || '') + ':' + Math.round(gord.x) + ',' + Math.round(gord.y);
    if (unit._legKey !== legKey) {                 // 换了命令 ⇒ 本段起点 = 当前位置
      unit._legKey = legKey;
      unit._legFrom = { x: unit.x, y: unit.y };
    }
    while (gord.route.length) {
      const wp = gord.route[0];
      const wd = Math.hypot(wp.x - unit.x, wp.y - unit.y);
      let passed = false;
      const lf = unit._legFrom;
      if (lf) {
        const ldx = wp.x - lf.x, ldy = wp.y - lf.y;
        const ll = Math.hypot(ldx, ldy);
        if (ll > 1) passed = ((unit.x - wp.x) * ldx + (unit.y - wp.y) * ldy) / ll > 0;
      }
      if (!passed && wd > Math.max(14, unitArriveRadius(unit) * 0.5)) break;
      unit._legFrom = { x: wp.x, y: wp.y };
      gord.route.shift();
    }
    if (gord.route.length) moveTarget = { x: gord.route[0].x, y: gord.route[0].y };
  }

  /* ★★ R9.2：**目标点落在本单位不可通行的地形上 ⇒ 吸附到最近可通行处**
     —— 旧版轮式开进树林（速度表 0）就是"顶着墙原地打滑"，看起来像永久卡住。
        只做一次 150m 内的环形搜索（带缓存），走法仍然是"直线 + 绕行点"，不引入寻路。 */
  if (moveTarget) moveTarget = snapTargetPassable(unit, moveTarget);

  /* ★★ R9.6.1：**目标点也要夹进地图** —— 地图编辑器允许把据点放在最边缘（甚至角落），
     旧代码会把单位一路送到图边、兵牌一半露在外（玩家看到的"跑出地图"）。
     ★ R9.6.2：余量同样必须小于半张地图，否则会把目标夹到**错误的角落**（夹反 = 所有单位
     都飞向同一个点）。夹反/地图尺寸异常时退回固定小余量。 */
  if (moveTarget) {
    const tRaw = Math.max(30, unitArriveRadius(unit));
    const mT = (tRaw * 2 < MAP_W && tRaw * 2 < MAP_H) ? tRaw : 10;
    const cx2 = Math.max(mT, Math.min(MAP_W - mT, moveTarget.x));
    const cy2 = Math.max(mT, Math.min(MAP_H - mT, moveTarget.y));
    if (cx2 !== moveTarget.x || cy2 !== moveTarget.y) moveTarget = { x: cx2, y: cy2 };
  }

  /* ============================================================
     ★★★ R9.5b：**玩家操控的阵营 ⇒ 执行层彻底放手**（"我自己动"的根治）
     ------------------------------------------------------------
     上面这一大段（`decideCommand` / `updateTacticalOption` / `computeObjectiveMove` /
     卡住停顿 / `_manualDest`）全是**执行层自己决定**的逻辑，它们不知道"这一方是玩家在带"。
     将军层关掉只是"没人发命令"，执行层照样推着部队跑 ⇒ 玩家看到：
       · "明明我操控，他们还是自己动"
       · "我的命令被覆盖"
     ⇒ 在**最后一步**强制表态（放在 `snapTargetPassable` 之后 ⇒ 谁也别想再改）：
        有活着的玩家命令：严格照命令走（只对"待在原地做事"的命令清掉移动目标）
        没有命令        ：**原地待命**（照旧开火还击，见下面的交战逻辑）
     ============================================================ */
  if (isPlayerCtl(unit)) {
    const live = (gord && gord.src === 'player' && !gord.done) ? gord : null;
    if (!live) {
      moveTarget = null;
      unit._idleWhy = '玩家操控：没有命令 ⇒ 原地待命（右键下达 / 「👁 显示→AI 接管」可让它自己打）';
    } else {
      const t = live.type;
      /* ★★★ R9.6.11：**玩家让它走 ⇒ 立刻解除驻守**（玩家要求"允许单位从建筑当中出来"）
         —— 旧行为：楼里有兵、敌人又在射程内 ⇒ `computeCombatMove` 把它钉在楼里；
            就算勉强走出去，`maybeGarrisonMove` 下一帧又把它拽回楼里（"出不来"的观感）。
         规则：玩家下令 移动/补给/攻击/找掩体/撤退 ⇒ ① 释放驻守 ② **15 秒内不许再钻楼**。 */
      if (t === 'MOVE_TO' || t === 'RESUPPLY' || t === 'ATTACK' ||
          t === 'TAKE_COVER' || t === 'WITHDRAW') {
        if (unit._garrisonIdx != null) { unit._garrisonIdx = null; unit._houseKey = null; }
        unit._noGarrisonUntil = battle.time + 15;
      }
      const stay = (t === 'HOLD' || t === 'BOARD' || t === 'DISMOUNT' ||
                    t === 'SET_STANCE' || t === 'FIRE_MISSION' ||
                    (t === 'MOVE_TO' && live.x == null));
      if (stay) moveTarget = null;              // 这些命令就是"待在原地做别的事"
      unit._cmdWhy = '玩家命令：'
        + (((typeof CMD_TYPE_CN === 'object') && CMD_TYPE_CN[t]) || t)
        + (unit.stuckTime >= 6 ? ('（已卡住 ' + Math.round(unit.stuckTime) + 's，按 0 可取消）') : '');
      if (!moveTarget) unit._idleWhy = unit._cmdWhy;   // 让 DEV 面板/顶栏显示"为什么没动"
    }
  }

  /* ★★★ R9.6.2：**目标点体检**（把"飞向图外/角落"变成"原地待命 + 说出原因"）
     —— 目标点非有限值 / 明显出图 / 落在图外，一律**丢弃**：这种目标只会让单位
     径直飞向地图边缘。丢掉之后本帧不动（并且把原因写进 `_idleWhy`，诊断面板/命令条看得到）。 */
  if (moveTarget && (!isFinite(moveTarget.x) || !isFinite(moveTarget.y)
      || moveTarget.x < -50 || moveTarget.y < -50
      || moveTarget.x > MAP_W + 50 || moveTarget.y > MAP_H + 50)) {
    if (!unit._badTargetLogged) {
      unit._badTargetLogged = true;
      console.warn('[nav] 目标点非法 ⇒ 已丢弃（单位原地待命）：',
                   unit.name || unit.id,
                   '目标=' + moveTarget.x + ',' + moveTarget.y,
                   '图=' + MAP_W + '×' + MAP_H,
                   '组令=' + (gord ? (gord.type + '/' + gord.src) : '无'),
                   '为什么=' + (unit._cmdWhy || unit._aiWhy || '-'));
    }
    unit._idleWhy = '目标点非法/出图 ⇒ 原地待命（' + Math.round(moveTarget.x) + ',' + Math.round(moveTarget.y) + '）';
    moveTarget = null;
  }

  /* ★ R9.6.1：记下这一帧最终要去哪（诊断用：把**所有单位**的目标都画出来） */
  unit._aimX = moveTarget ? moveTarget.x : null;
  unit._aimY = moveTarget ? moveTarget.y : null;

  /* ===== 6.5 炮兵拆收读条（读真实武器：车辆 + 已下车士兵） ===== */
  if (unit._needsUndeploy) {
    let allUndeployed = true;
    for (const w of unitDeployWeapons(unit)) {
      if (!w.deployed) continue;
      if (w._undeployProgress === undefined) w._undeployProgress = w.deployTime;
      w._undeployProgress -= dt;
      w.deployProgress = Math.max(0, w._undeployProgress);
      if (w._undeployProgress <= 0) {
        w.deployed = false;
        w.deployProgress = 0;
        w._undeployProgress = undefined;
      } else {
        allUndeployed = false;
      }
    }
    if (allUndeployed) {
      unit._needsUndeploy = false;
    } else {
      moveTarget = null;
    }
  }

  /* ===== 7. 架设 / 拆收：炮已架好却要走 → 先拆收，拆完才动 ===== */
  if (moveTarget && !unit._needsUndeploy && !unit._relocateTarget && unitDeployed(unit)) {
    unit._needsUndeploy = true;
    moveTarget = null;
  }

  unit.stance = moveTarget ? 'moving' : 'static';
  // 记录"持续行军 / 停稳"的起始时间（乘车与架设判定都要用）
  syncMotionTimers(unit);

  /* ===== 7.5 上车 / 下车（S-F：载具实体化）===== */
  if (unit.vehicles && unit.vehicles.length) {
    let want = updateRideMode(unit, moveTarget ? moveTarget.x : null, moveTarget ? moveTarget.y : null, false);
    /* ★ R9.3：玩家的「上车 / 下车」命令**优先** —— 否则 AI 的 updateRideMode 每帧又切回去，
       表现就是"按了 D / 上车，单位自己又爬回车上（命令不生效）" */
    if (gord && !gord.done && gord.src === 'player' && (gord.type === 'BOARD' || gord.type === 'DISMOUNT')) {
      want = (gord.type === 'BOARD');
    }
    /* ★★★ R9.5c：**粘性上下车意图**（玩家操控的组）——
       命令层的 DISMOUNT 一旦"完成"（人都下来了），执行层下一帧 `updateRideMode`
       又会算出"要坐车" ⇒ 单位立刻爬回车上 = 玩家看到的"**点下车秒上车**"。
       玩家的上下车是**状态**而不是一次性动作 ⇒ 记在 `battle.playerRide`，一直生效到玩家改主意。 */
    if (isPlayerCtl(unit) && unit._groupKey) {
      const pr = battle.playerRide || {};
      /* ★ R9.5d：先看**单位级**意图（玩家点谁命令谁），再看组级（兼容旧的组级命令） */
      const want2 = Object.prototype.hasOwnProperty.call(pr, unit.id) ? pr[unit.id]
                  : (Object.prototype.hasOwnProperty.call(pr, unit._groupKey) ? pr[unit._groupKey] : undefined);
      if (want2 !== undefined) want = !!want2;
    }
    const lastChange = (unit._mountChangedAt === undefined) ? -9999 : unit._mountChangedAt;
    /* 0.4 秒防抖：同一个结论不要重复写（否则上下车在画面上会闪）
       ★★ R9.4：**失败退避** —— `setUnitMounted` 在"上车但车不在附近"时会**直接返回**，
       旧写法于是**每 0.4 秒重试一次**（玩家的"上车"命令 + 车没跟上来 ⇒ 这个组等于被卡住，
       而且每 0.4 秒重跑一次成员重排 = 卡顿源）。现在失败后 2.5 秒内不再试，并记失败次数。 */
    if (want !== !!unit.mounted && battle.time - lastChange > 0.4
        && battle.time - (unit._mountFailAt || -9999) > 2.5) {
      const before = !!unit.mounted;
      setUnitMounted(unit, want);
      if (!!unit.mounted === before) {
        unit._mountFailAt = battle.time;
        unit._mountFails = (unit._mountFails || 0) + 1;
      } else {
        unit._mountFails = 0;
      }
    }
  }

  /* ===== 8. 执行移动（含避障） ===== */
  profAdd('ai', performance.now() - _p3);      // ★ R8：目标/命令/战术 + 上下车 这一段
  const _p4 = performance.now();
  if (moveTarget) {
    let actualTarget = moveTarget;

    /* --- 8.1/8.2 贪婪绕行：被挡 / 拥挤时找一个绕行点 --- */
    if (unit._avoidCache) {
      const expired = battle.time > unit._avoidCache.expiresAt;
      const arrived = Math.hypot(unit._avoidCache.x - unit.x, unit._avoidCache.y - unit.y) < 30;
      const pathClear = !isPathBlocked(unit.x, unit.y, moveTarget.x, moveTarget.y, bodyRadiusOf(unit))
                     && !isPathCrowded(unit, unit.x, unit.y, moveTarget.x, moveTarget.y);
      if (expired || arrived || pathClear) {
        unit._avoidCache = null;
      } else {
        actualTarget = unit._avoidCache;
      }
    }

    /* --- 8.2 没有缓存 → 检查是否需要避障 --- */
    if (!unit._avoidCache) {
      if (isPathBlocked(unit.x, unit.y, moveTarget.x, moveTarget.y, bodyRadiusOf(unit)) ||
          isPathCrowded(unit, unit.x, unit.y, moveTarget.x, moveTarget.y)) {
        const avoid = findAvoidanceWaypoint(unit, moveTarget.x, moveTarget.y);
        if (avoid) {
          unit._avoidCache = {
            x: avoid.x, y: avoid.y,
            /* ★ R9.1：0.8 → **3 秒**。旧值太短 ⇒ 绕行点每 0.8 秒过期重算一次，
               在"挡一下 / 通一下"的边界上来回切 ⇒ 画面上就是一抽一抽。 */
            expiresAt: battle.time + 3,
          };
          actualTarget = avoid;
        }
      }
    }
    /* 8.1/8.2 结束 */

    /* --- 8.3 移动：★ R9.6 实体为准（默认） / 旧的"成员各自走位"（?steer=0 对照） --- */
    if (STEER_ENTITY) {
      /* ★★★ R9.6：**只有实体在走** —— 单位坐标由"朝向 × 速度"推进（横向恒 0），
         成员按队形跟随（槽位随朝向旋转）+ 零均值分离 ⇒ 漂移为 0。 */
      if (unit.mounted && unit.vehicles.length) unit._fleetMul = fleetSpeedFactor(unit);
      else unitTerrainMulSample(unit);
      /* 还有剩余路点 ⇒ 当前目标是**中间路点**：只转向、不停车（停车会在第一个路点卡住） */
      const aimIsWaypoint = !!(gord && gord.fast && gord.route && gord.route.length && !unit._manualDest);
      moveUnitEntity(unit, actualTarget, dt, aimIsWaypoint);
      /* ★★★ R9.6.3：**每帧都把实体夹回地图**（旧版只在"这一帧走过"时才夹）——
         没有命令的单位（玩家操控、原地待命）永远不会调到 `moveUnitEntity` 里的那段夹取，
         一旦有任何来源把坐标写偏（历史遗留的"质心回写"/手动操控/复活），
         兵牌就会**永久停在图外**（玩家看到的"跑出地图、再也不回来"）。 */
      clampUnitEntityToMap(unit);
      placeMembersForUnit(unit, dt);
      syncAboardSoldiers(unit);
      syncMotionTimers(unit);
    } else if (unit.mounted && unit.vehicles.length) {
      unit._fleetMul = fleetSpeedFactor(unit);   // ★ 整列同速 + 拉开太多就减速收拢
      for (const v of unit.vehicles) {
        if (!vehicleHasDriver(v, unit)) continue;
        moveVehicleToward(unit, v, actualTarget, dt);
      }
      syncAboardSoldiers(unit);
    } else {
      /* ★ R9.2（L1）：步兵**全队一次地形采样**（车辆那边由 fleetSpeedFactor 处理自己那套） */
      unitTerrainMulSample(unit);
      for (const s of unit.soldiers) {
        if (!s.alive) continue;
        if (isSoldierAboard(s, unit)) continue;   // 留在车上操作武器的人不走路
        const sSpeedMult = s.suppressed ? SUPPRESSED_SPEED_MULT : 1;
        let slotX = actualTarget.x + s.ox;
        let slotY = actualTarget.y + s.oy;
        // 被压制且没掩体 → 就近找掩体（★ 目标必须稳定：到了就清、真没有就冷静 2 秒趴着，
        //   旧代码每 3.5 秒重搜一次，而采样是按坐标播种的 ⇒ 人一动结果就变 ⇒ 原地抽搐）
        if (s.suppressed && getCoverAt(s.x, s.y) < 0.5) {
          if (s.coverTarget) {
            const cdC = Math.hypot(s.coverTarget.x - s.x, s.coverTarget.y - s.y);
            if (cdC < 12) s.coverTarget = null;            // 到了
            else if (cdC > 260) s.coverTarget = null;      // 太远，放弃
          }
          if (!s.coverTarget && battle.time >= (s._coverSearchAt || 0)) {
            const curCov = getCoverAt(s.x, s.y);
            const found = findNearbyCoverAt(s.x, s.y, 160);
            if (found && found.cover > curCov + 0.1) s.coverTarget = found;
            else s._coverSearchAt = battle.time + 2;       // 附近真没掩体 → 冷静 2 秒
          }
          if (s.coverTarget) { slotX = s.coverTarget.x; slotY = s.coverTarget.y; }
        }
        const sdx = slotX - s.x;
        const sdy = slotY - s.y;
        const sd = Math.hypot(sdx, sdy);
        if (sd <= 4) continue;
        /* ★★ R9.2（L1）：步兵速度**全队共用**（`unitTerrainMulSample`，见 8.3 之前算的那一次）
           —— 旧版这里是 `getTerrainAt(s.x, s.y)` 逐人采样 ⇒ 队首快队尾慢、队伍被拉长 */
        const cone = headingConeDir(sdx / sd, sdy / sd, unit.facing);
        if (!cone) continue;                    // 槽位在正后方 ⇒ 本帧不前进（等朝向转过来）
        const sstep = Math.min(unit.speed * (unit._terrainMul == null ? 1 : unit._terrainMul)
                               * sSpeedMult * paceMulOf(unit) * dt, sd);
        const snx = s.x + cone.x * sstep;
        const sny = s.y + cone.y * sstep;
        // ★ 带体积半径的碰撞（不再有点穿墙）
        if (!isMoveBlockedAt(snx, sny, SOLDIER_BODY_RADIUS)) {
          s.x = snx; s.y = sny;
        } else {
          // 侧移绕障：卡死时固定往一侧绕，避免左右抖
          const perpX = -sdy / sd, perpY = sdx / sd;
          /* ★ R7.6：绕行侧"一次定死"（旧版 `Math.random()` **每帧重掷** ⇒ 左右乱抖 = 玩家看到的"漂移"） */
          if (s._side !== 1 && s._side !== -1) s._side = (Math.random() < 0.5) ? 1 : -1;
          const ss = (unit._repathUntil > battle.time && unit._repelSide) ? unit._repelSide
                   : s._side;
          /* ★ R9.1：绕行侧移**也先过朝向锥**（≤14°）；只有"锥算不出来"（目标在正后方）时
             才允许纯侧移 —— 那是真·贴墙的最后手段，不是常态漂移 */
          const raw = { x: perpX * ss, y: perpY * ss };
          const cs = headingConeDir(raw.x, raw.y, unit.facing);
          const dx2 = cs ? cs.x : raw.x, dy2 = cs ? cs.y : raw.y;
          const sx2 = s.x + dx2 * sstep;
          const sy2 = s.y + dy2 * sstep;
          if (!isMoveBlockedAt(sx2, sy2, SOLDIER_BODY_RADIUS)) { s.x = sx2; s.y = sy2; }
        }
        s.x = Math.max(15, Math.min(MAP_W - 15, s.x));
        s.y = Math.max(15, Math.min(MAP_H - 15, s.y));
      }
      // 有驾驶员的车跟着编队走（坦克 / 步战车伴随步兵）
      if (unit.vehicles.length) {
        for (const v of unit.vehicles) {
          if (!vehicleHasDriver(v, unit)) continue;
          moveVehicleToward(unit, v, actualTarget, dt);
        }
      }
      syncAboardSoldiers(unit);
    }
    /* ★★ R7.6（**只在 ?steer=0 的旧路径里**）：朝向以有限角速度追行进方向。
       R9.6 起，朝向的推进/约束由 `moveUnitEntity()` 负责（实体为准那条路径）。 */
    if (!STEER_ENTITY) {
      const wantFacing = Math.atan2(actualTarget.y - unit.y, actualTarget.x - unit.x);
      /* ★ R9.1：**首次**出发直接对齐朝向 —— 单位开局朝向都是 0（正东），
         不特判的话"只能朝朝向走"会让它先原地转 1 秒（坦克 180° 要 3.7 秒）才起步。
         转到方向之后，之后一律按转向速率平滑转。 */
      if (!unit._faceInit) { unit._faceInit = true; unit.facing = wantFacing; }
      else unit.facing = navTurnToward(
        (unit.facing == null ? wantFacing : unit.facing), wantFacing, navTurnRateOf(unit) * dt);
    }
  }

  /* ★★ R9.2：补给点回补（站圈内 ≥3 秒 ⇒ 每秒补 20% 备弹；离开即清零） */
  updateResupply(unit, dt);

  /* ===== 9. 武器部署与开火 ===== */
  profAdd('move', performance.now() - _p4);    // ★ R8：执行移动这一段
  const tgHere = getTerrainAt(unit.x, unit.y);
  const isMoving = unit.stance === 'moving';

  // ★ 持续移动 0.4 秒才算"真移动"
  if (isMoving) {
    if (!unit._moveStartTime) unit._moveStartTime = battle.time;
  } else {
    unit._moveStartTime = 0;
  }
  const movingDuration = unit._moveStartTime ? (battle.time - unit._moveStartTime) : 0;
  const realMoved = isMoving && movingDuration > 0.4;

  // ★ 车辆 / 火炮开火：一门炮 = 一次射击（火力由"装备数量"决定，不再由人数决定）
  if (!unit._needsUndeploy && !unit._relocateTarget && unit.vehicles.length) {
    for (const v of unit.vehicles) {
      if (!vehicleCanFight(v)) continue;
      const w = v.weapon;

      // 需架设的火炮：移动中拆收；要"停稳 2 秒"才真正开始架设（避免 stance 抖动导致进度反复归零）
      if (w.deployTime > 0) {
        let crewAboard = false;
        for (const cs of v.crew) {
          if (cs.alive && isSoldierAboard(cs, unit)) { crewAboard = true; break; }
        }
        const settled = unit.stance !== 'moving' && (battle.time - (unit._staticSince || 0) > 2);
        if (!settled || !crewAboard) {
          w.deployProgress = 0;
          w.deployed = false;
        } else {
          w.deployProgress = Math.min(w.deployTime, w.deployProgress + dt);
          w.deployed = w.deployProgress >= w.deployTime;
        }
        if (!w.deployed) continue;
      }
      if (w.cooldown > 0) { w.cooldown -= dt; continue; }

      const stillVisibleV = w.target && unit.visibleEnemies.some(e => e.id === w.target.id);
      if (battle.time - w.targetCacheTime > TARGET_CACHE_INTERVAL ||
          !w.target || !w.target.alive || !stillVisibleV) {
        w.target = pickWeaponTarget(w, unit);
        w.targetCacheTime = battle.time;
      }
      if (!w.target) continue;
      if (w.target.isGhost) {
        const freshV = unit.visibleEnemies.find(e => e.id === w.target.id);
        if (freshV) w.target = freshV;
        else { w.target = null; continue; }
      }

      const vdx = w.target.x - v.x;
      const vdy = w.target.y - v.y;
      const vdist = Math.hypot(vdx, vdy);
      const vRange = w.range * tgHere.rangeMul;
      if (vdist > vRange) continue;
      if (w.minRange > 0 && vdist < w.minRange) continue;

      /* ★ R7.6：行驶中车头 = 行进朝向（不被瞄准瞬移覆盖 ⇒ 车不会"横着漂"）；停车时才转炮口 */
      if (unit.stance !== 'moving') v.facing = Math.atan2(vdy, vdx);
      const cf = vehicleCrewFactor(v);        // 缺员 → 打不准、装填慢
      fireAt(unit, w.target, w, vdist, 0.45 + 0.55 * cf, v.x, v.y);
      w.cooldown = w.fireInterval * (0.75 + Math.random() * 0.55) * (1 + (1 - cf) * 1.5);
      unit.lastFiredTime = battle.time;
    }
  }

  // 士兵独立开火：只用个人武器，且必须已经下车（车上的人用车的武器）
  // ★ 同时记录"为什么没开火"，供调试浮层（按 D）诊断
  const fs = unit._firingStats || (unit._firingStats = {
    gated: 0, shooters: 0, hardSupp: 0, aboard: 0, noWeapon: 0,
    deploying: 0, cooling: 0, noTarget: 0, outRange: 0, fired: 0,
  });
  fs.gated = fs.shooters = fs.hardSupp = fs.aboard = fs.noWeapon = 0;
  fs.deploying = fs.cooling = fs.noTarget = fs.outRange = fs.fired = 0;

  if (!unit._needsUndeploy && !unit._relocateTarget) {
    for (const s of unit.soldiers) {
      if (!s.alive) continue;
      fs.shooters++;
      if (s.suppressed && (s.suppression || 0) >= SUPP_HARD) { fs.hardSupp++; continue; }  // ★ 只有极端压制才抬不起头
      if (isSoldierAboard(s, unit)) { fs.aboard++; continue; }
      const w = s.weapon;
      if (!w) { fs.noWeapon++; continue; }             // 没有个人武器（车辆乘员 / 操作员）

      // 需架设的武器（迫击炮/火炮）：移动中拆收；"停稳 2 秒"后才开始架设
      if (w.deployTime > 0) {
        if (unit.stance === 'moving' || battle.time - (unit._staticSince || 0) < 2) {
          w.deployProgress = 0;
          w.deployed = false;
        } else {
          w.deployProgress = Math.min(w.deployTime, w.deployProgress + dt);
          w.deployed = w.deployProgress >= w.deployTime;
        }
        if (!w.deployed) { fs.deploying++; continue; }
      }

      if (w.cooldown > 0) { w.cooldown -= dt; fs.cooling++; continue; }

      const stillVisible = w.target && unit.visibleEnemies.some(e => e.id === w.target.id);
      if (battle.time - w.targetCacheTime > TARGET_CACHE_INTERVAL ||
          !w.target || !w.target.alive || !stillVisible) {
        w.target = pickWeaponTarget(w, unit);
        w.targetCacheTime = battle.time;
      }
      if (!w.target) { fs.noTarget++; continue; }
      if (w.target.isGhost) {
        const fresh = unit.visibleEnemies.find(e => e.id === w.target.id);
        if (fresh) w.target = fresh;
        else { w.target = null; fs.noTarget++; continue; }
      }

      const dx = w.target.x - s.x;
      const dy = w.target.y - s.y;
      const dist = Math.hypot(dx, dy);
      const effRange = w.range * tgHere.rangeMul;
      if (dist > effRange) { fs.outRange++; continue; }
      if (w.minRange > 0 && dist < w.minRange) { fs.outRange++; continue; }

      /* ★ R7.6：行驶中朝向 = 行进朝向（停车时才转向射击方向） */
      if (unit.stance !== 'moving') unit.facing = Math.atan2(dy, dx);
      // ★ 被压制 ≠ 禁火：只打折命中与射速
      const pinned = (s.suppression || 0) >= SUPPRESSION_THRESHOLD;
      const fireMul = pinned ? SUPPRESSED_FIRE_MUL : 1;
      const rateMul = pinned ? SUPPRESSED_RATE_MUL : 1;
      fireAt(unit, w.target, w, dist, fireMul, s.x, s.y);
      w.cooldown = w.fireInterval * (0.75 + Math.random() * 0.55) / rateMul;
      unit.lastFiredTime = battle.time;
      fs.fired++;
    }
  } else {
    fs.gated = 1;      // 被拆收/转移闸门挡住（整单位不开火）
  }

  // S-B：士兵间分离 + 车-车分离 + 位置
  // ★★★ R9.6：**实体为准** —— 分离只允许在编队内部起作用，最后做一次**零均值化**
  //   （成员被摆到"实体 + 旋转后的零均值槽位"，所以看起来仍然规整）。
  // ★★★ R9.6.3：**"漂移 = 0" 的数学保证换成了更强的一条**：
  //   **实体坐标只有 `moveUnitEntity()` 会推进**（+ 上下车/复位的少数显式调用），
  //   成员级的任何位移（分离力 / 各自找掩体 / 夹边界 / 上车）**都不可能**改到实体坐标。
  //   旧版这里靠"质心恒等于实体"来保证，但绘制阶段还有一处 `u.x = 存活士兵质心`
  //   的回写（已删）——那条回写每帧把实体往成员质心拖 = 玩家看到的"持续漂移/冲出去"。
  //   （`?steer=0` 时走旧路径：成员各自走位 + 单位位置 = 存活士兵质心。）
  if (!unit.mounted) separateSoldiersLocal(unit, dt);
  if (unit.vehicles && unit.vehicles.length) separateVehiclesLocal(unit, dt);
  syncAboardSoldiers(unit);
  if (STEER_ENTITY) {
    recenterMembersOnUnit(unit);
    if (unit.stance !== 'moving') placeMembersForUnit(unit, dt);   // 停下时把队形摆回来（含车辆）
    clampMembersToMap(unit);                // ★ R9.6.1：成员不许露到地图外
    /* ★★★ R9.6.3：**夹完边界再同步"在车上的兵"**（旧顺序是先同步后夹 ⇒ 车上兵被拉到图边、
       与自己的车脱节；而他们又会被质心统计算进去 ⇒ 又一次坐标污染）。 */
    syncAboardSoldiers(unit);
  } else {
    const center = unitCenterFromSoldiers(unit);
    if (center) { unit.x = center.x; unit.y = center.y; }
  }
  if (unit.vehicles && unit.vehicles.length) syncUnitArmorAggregate(unit);

  /* ★★★ R9.6.3：**诊断用的一帧位移**（米）—— 面板上直接看得到。
     "没有移动目标却在持续位移" = 坐标被别的代码偷写（R9.6.3 之前就是绘制阶段的
     质心回写，玩家看到的"持续漂移"）。有了这个数，下次复现不用再猜。 */
  if (unit._dbgPX != null) {
    unit._frameStep = Math.hypot(unit.x - unit._dbgPX, unit.y - unit._dbgPY);
    if (unit._frameStep > unit._dbgMaxStep) { unit._dbgMaxStep = unit._frameStep; unit._dbgMaxStepAt = battle.time; }
  } else {
    unit._dbgMaxStep = 0; unit._dbgMaxStepAt = 0;
  }
  unit._dbgPX = unit.x; unit._dbgPY = unit.y;
}

/* ============================================================
   12) 开火
   ============================================================ */

/* 二项分布采样：n 支武器各自独立判定，命中 k 支 */
function _gaussRandom() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
function sampleBinomial(n, p) {
  n = Math.round(n);
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (n <= 16) {
    let h = 0;
    for (let i = 0; i < n; i++) if (Math.random() < p) h++;
    return h;
  }
  const mean = n * p;
  const sd = Math.sqrt(mean * (1 - p));
  return Math.max(0, Math.min(n, Math.round(mean + sd * _gaussRandom())));
}

function fireAt(attacker, target, weapon, dist, fireMul, originX, originY) {
  const fm = (fireMul == null ? 1 : fireMul);
  const ox = (originX == null ? attacker.x : originX);
  const oy = (originY == null ? attacker.y : originY);
  if (weapon.isArtillery) {
    attacker.lastArtilleryFireTime = battle.time;
    attacker.lastArtilleryFireX = ox;
    attacker.lastArtilleryFireY = oy;
    if (attacker.isArtilleryUnit) {
      attacker._lastArtyShotAt = battle.time;
    }

    // ★ 散布跟口径/距离挂钩：杀伤半径变小后，固定 80m 散布会让炮弹几乎全部打空
    const scatter = ARTILLERY_SCATTER_BASE + dist * 0.006 + (weapon.lethalRadius || 30) * 0.3;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * scatter;
    const tx = target.x + Math.cos(a) * r;
    const ty = target.y + Math.sin(a) * r;

    const duration = Math.min(2.5, 0.4 + dist / 3000);
    battle.shells.push({
      sx: ox, sy: oy,
      tx, ty,
      x: ox, y: oy,
      t: 0,
      duration,
      side: attacker.side,
      weapon,
      target,
      lethalRadius: weapon.lethalRadius || 30,
      suppressRadius: weapon.suppressRadius || (weapon.lethalRadius || 30) * 2.5,
      fireMul: fm,
      done: false,
    });
    return;
  }

  /* ★ R9：开火消耗备弹（打光就不再打） */
  if (weapon.ammo != null) { if (weapon.ammo <= 0) return; weapon.ammo -= 1; }

  /* ★★★ R9.6.9：**命中率改成真实交火量级**（治玩家反馈的"步兵见面交火一秒就结束"）
     ------------------------------------------------------------
     旧值 `0.85 − 0.3×(d/r)` = 200m 上 0.73（几乎不脱靶），配合"单兵 0.12 秒一发 +
     6 伤害 / 10 血（两发一条命）" ⇒ 单兵 3.6 杀/秒、30 人排 ~110 杀/秒、240 人排 876 杀/秒
     ⇒ 对面一个排 **0.27 秒**打空（实测就是"一秒结束"）。
     新值：近距 10% / 远距 2%（再叠移动、目标移动、压制、掩体）。
     ★ 下限必须同步降到 0.02：旧下限 0.15 会把新公式整个盖掉（那就等于没改）。 */
  let baseChance = 0.10 - (dist / weapon.range) * 0.08;
  // 移动中开火惩罚：载具（无稳定器）惩罚更重
  if (attacker.stance === 'moving') {
    baseChance *= ((attacker.armor || 0) > 0 ? 0.5 : 0.75);
  }
  // 目标移动惩罚
  if (target.stance === 'moving') baseChance *= 0.85;
  const hitChance = Math.max(0.02, baseChance);

  // 齐射修复：一次射击事件 = 组内 N 支武器各自独立判定（二项分布），
  // 命中 k 支则造成 k/N 的聚合伤害，消除"全中或全不中"。
  const shooters = Math.max(1, Math.round(weapon._shooters || weapon.count || 1));
  let hits;
  if (weapon.disposable) {
    hits = (Math.random() < hitChance) ? 1 : 0;
  } else {
    hits = sampleBinomial(shooters, hitChance);
  }

  battle.tracers.push({
    x1: ox, y1: oy,
    x2: target.x, y2: target.y,
    age: 0, side: attacker.side,
    weaponCategory: weapon.category,
  });

  applySuppressionAt(target, target.x, target.y, hits > 0 ? 0.06 : 0.03, 120);

  if (hits <= 0) return;
  applyDirectDamage(attacker, target, weapon, dist, fm * (hits / shooters), ox, oy);
}

/* 装甲入射角系数：正面 1.0 / 侧面 0.65 / 后部 0.4 */
function armorAngleMultiplier(attacker, target) {
  if (!attacker) return 1;
  const facing = target.facing || 0;
  const incoming = Math.atan2(target.y - attacker.y, target.x - attacker.x);
  let rel = incoming - facing;
  rel = ((rel + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const abs = Math.abs(rel);
  if (abs < Math.PI / 3) return 1.0;
  if (abs < (Math.PI * 2) / 3) return 0.65;
  return 0.4;
}

function applyDirectDamage(attacker, target, weapon, dist, fireMul, originX, originY) {
  const fm = (fireMul == null ? 1 : fireMul);
  const sx = (originX == null ? attacker.x : originX);
  const sy = (originY == null ? attacker.y : originY);

  // ★ 目标还有活着的车 → 一律按"车"结算（用车辆自己的装甲 / 结构 / 车内乘员）
  if (target.vehicles && target.vehicles.length) {
    const v = pickVehicleVictim(target, sx, sy);
    if (v) { damageVehicle(target, v, weapon, fm, attacker, dist); return; }
  }

  // 距离衰减：穿深随距离下降（最大射程处约衰减一半）
  const distFalloff = Math.max(0.3, 1 - (dist / Math.max(1, weapon.range)) * 0.5);
  const effectivePen = weapon.penetration * distFalloff;
  // 角度衰减：侧后装甲打折；软目标 armor=0 必然击穿
  const targetArmor = (target.armor || 0) * armorAngleMultiplier(attacker, target);
  const penetrated = targetArmor <= 0 || effectivePen >= targetArmor;

  if (!penetrated) {
    // 跳弹 / 未击穿：只造成极轻微结构损伤，不伤人员
    if (target.hpArmor > 0) {
      target.hpArmor -= Math.min(target.hpArmor, weapon.antiArmor * 0.05 * fm);
    }
    return;
  }

  // 击穿：先打结构
  if (target.hpArmor > 0) {
    target.hpArmor -= Math.min(target.hpArmor, weapon.antiArmor * fm);
  }

  // 按几何挑选"被打中的那一个士兵"（越暴露、越靠近来弹 → 越可能被选中）
  const victim = pickTargetSoldier(target, sx, sy);
  if (!victim) return;

  // 建筑本体挨子弹（用被击中士兵的位置）
  if (battle.gridMap && battle.gridMap.buildings) {
    for (let i = battle.gridMap.buildings.length - 1; i >= 0; i--) {
      const b = battle.gridMap.buildings[i];
      if (getBuildingState(b) === 'collapsed') continue;
      if (isPointInBuilding(b, victim.x, victim.y)) {
        const def = BUILDING_TYPES[b.type];
        if (def.selfDamageMul.bullet > 0) {
          b.hp = Math.max(0, b.hp - weapon.antiArmor * def.selfDamageMul.bullet * fm);
        }
        break;
      }
    }
  }

  // 该士兵自己的掩体
  const coverFactor = coverFactorAt(victim.x, victim.y, false);
  let personnelDamage;
  if (target.hpArmor > 0) {
    // 装甲车辆被击穿但尚未报废：乘员在车内仍受部分防护
    personnelDamage = weapon.antiPersonnel * 0.5 * coverFactor * fm;
  } else {
    // 软目标 / 车辆已报废：直接杀伤
    personnelDamage = (weapon.antiPersonnel + weapon.antiArmor * 0.15) * coverFactor * fm;
  }
  damageSoldierAt(target, victim, personnelDamage);
}

function applyArtilleryBlast(shell) {
  const { tx, ty, weapon, side } = shell;
  const fm = (shell.fireMul == null ? 1 : shell.fireMul);
  // ★ 杀伤半径模型：圈内阵亡（掩体打折）、外圈只压制
  const R  = Math.max(5, shell.lethalRadius || 30);
  const RS = Math.max(R, shell.suppressRadius || R * 2.5);

  /* ★ 建筑本体挨炮火（建筑按杀伤半径的 1.5 倍计） */
  if (battle.gridMap && battle.gridMap.buildings) {
    const buildR = R * 1.5;
    for (const b of battle.gridMap.buildings) {
      const stateBefore = getBuildingState(b);
      if (stateBefore === 'collapsed') continue;

      // AABB 最近点
      const nx = Math.max(b.x, Math.min(tx, b.x + b.w));
      const ny = Math.max(b.y, Math.min(ty, b.y + b.h));
      const dist = Math.hypot(nx - tx, ny - ty);
      if (dist > buildR) continue;

      const falloff = 1 - dist / buildR;
      const def = BUILDING_TYPES[b.type];
      const dmg = weapon.antiArmor * 1.6 * falloff * def.selfDamageMul.shell * fm;
      b.hp = Math.max(0, b.hp - dmg);

      const stateAfter = getBuildingState(b);
      if (stateAfter !== stateBefore) {
        if (stateAfter === 'collapsed') {
          // 坍塌瞬间：里面的人 90% 伤害
          applyBuildingCollapseDamage(b, 0.90);
        } else if (stateBefore === 'intact') {
          // 完好 → 破损：15% 伤害
          applyBuildingCollapseDamage(b, 0.15);
        } else if (stateBefore === 'damaged' && stateAfter === 'severe') {
          // 破损 → 严重：15% 伤害
          applyBuildingCollapseDamage(b, 0.15);
        }
      }
    }
  }

  /* ★ 打单位：逐士兵判定（在车上的人受车体保护，只吃车辆伤害） */
  for (const u of battle.units) {
    if (!u.alive) continue;
    if (u.side === side) continue;
    const udist = Math.hypot(u.x - tx, u.y - ty);
    if (udist > RS + 150) continue;   // 单位中心远在圈外（散兵可能仍在圈内，留余量）

    // 载具：落点在杀伤圈内才算直接命中
    if (u.vehicles && u.vehicles.length) {
      for (const v of u.vehicles) {
        if (v.destroyed) continue;
        const vd = Math.hypot(v.x - tx, v.y - ty);
        if (vd > R) continue;
        const vFall = 1 - vd / R;
        const armorAbsorb = Math.max(0.15, 1 - v.armor / 1000);
        v.hp = Math.max(0, v.hp - weapon.antiArmor * 1.5 * vFall * fm * armorAbsorb);
        if (v.hp <= 0) destroyVehicle(u, v);
      }
      syncUnitArmorAggregate(u);
    } else if (u.hpArmor > 0 && udist <= R) {
      // 无载具单位：结构损伤（爆炸冲击）：装甲越厚，结构受损越小
      const armorAbsorb = (u.armor || 0) > 0 ? Math.max(0.15, 1 - u.armor / 1000) : 1;
      u.hpArmor -= Math.min(u.hpArmor, weapon.antiArmor * 1.5 * (1 - udist / R) * fm * armorAbsorb);
    }

    // 人员：逐士兵判定 —— 内圈（杀伤半径）按掩体折扣判死；外圈（压制半径）只压制
    for (const s of u.soldiers) {
      if (!s.alive) continue;
      if (isSoldierAboard(s, u)) continue;   // 在车上 → 受车体保护
      const sd = Math.hypot(s.x - tx, s.y - ty);
      if (sd > RS) continue;

      const sup = 0.95 * (1 - sd / RS);
      if (sup > 0) {
        s.suppression = Math.min(1.5, (s.suppression || 0) + sup);
        s.lastHitTime = battle.time;
      }
      if (sd > R) continue;
      /* ★★★ R9.6.12：**杀伤圈内不再"必死"**（玩家："一轮炮击一个排就没了"）
         ------------------------------------------------------------
         旧值：开阔地 `coverFactorAt(x,y,true)` = 1 ⇒ `killChance` = 1（圈内 **100%** 阵亡），
         配合旧排内间距 12.8m（一个 30 人排只占 ~4,000 m²）⇒ 一轮 12 发就能整排蒸发。
         现实：卧倒 / 弹坑 / 起伏 / 破片分布 ⇒ 圈内阵亡率约 **50~60%**，且**随半径递减**（圈心最狠）。
         现在：`0.55 × 半径衰减 × 掩体系数` ⇒ 开阔地圈心 0.55 / 圈边 0.30；
         硬掩体继续打折（树林 ≈0.30、建筑 ≈0.10）。 */
      const radial = 1 - 0.45 * (sd / R);                 // 圈心 1.0 → 圈边 0.55
      const killChance = Math.max(0.05, Math.min(1, coverFactorAt(s.x, s.y, true) * 0.55 * radial));
      if (Math.random() < killChance) damageSoldierAt(u, s, s.hp + 1);
    }
  }

  battle.explosions.push({
    x: tx, y: ty,
    age: 0, maxAge: 0.9,
    radius: R,
    suppressRadius: RS,
    isArty: true,
  });
}

/* ============================================================
   13) 结算
   ============================================================ */
function endBattle(winner, reason) {
  if (battle.ended) return;
  battle.ended = true;
  const blueTotal = battle.units.filter(u => u.side === 'blue').length;
  const redTotal  = battle.units.filter(u => u.side === 'red').length;
  const blueAlive = battle.units.filter(u => u.side === 'blue' && u.alive).length;
  const redAlive  = battle.units.filter(u => u.side === 'red'  && u.alive).length;
  const tk = battle.tickets || { blue: 0, red: 0 };
  const pc = battle.pointCount || { blue: 0, red: 0, neutral: 0 };
  const titleEl = $('result-title');
  titleEl.classList.remove('victory-blue', 'victory-red', 'draw');
  if (winner === 'blue') { titleEl.textContent = '🏆 蓝方胜利'; titleEl.classList.add('victory-blue'); }
  else if (winner === 'red') { titleEl.textContent = '🏆 红方胜利'; titleEl.classList.add('victory-red'); }
  else { titleEl.textContent = '⏱ 平局'; titleEl.classList.add('draw'); }

  $('result-content').innerHTML = `
    <div class="result-stats">
      <div class="result-side blue">
        <div class="side-name">${escapeHtml(battle.blueName)}</div>
        <div class="stat">存活 <b>${blueAlive}</b> / ${blueTotal}</div>
        <div class="stat">阵亡 <b>${blueTotal - blueAlive}</b></div>
        <div class="stat">胜利分 <b>${Math.round(Math.max(0, tk.blue))}</b> · 据点 <b>${pc.blue}</b></div>
      </div>
      <div class="result-vs">VS</div>
      <div class="result-side red">
        <div class="side-name">${escapeHtml(battle.redName)}</div>
        <div class="stat">存活 <b>${redAlive}</b> / ${redTotal}</div>
        <div class="stat">阵亡 <b>${redTotal - redAlive}</b></div>
        <div class="stat">胜利分 <b>${Math.round(Math.max(0, tk.red))}</b> · 据点 <b>${pc.red}</b></div>
      </div>
    </div>
    <div class="result-reason">${reason ? '胜负原因：' + escapeHtml(reason) : ''}</div>
    <div class="result-duration">战斗时长：${battle.time.toFixed(1)} 秒 · 战场 ${Math.round(MAP_W)}×${Math.round(MAP_H)} m</div>
  `;
  setTimeout(() => {
    $('result-overlay').classList.remove('hidden');
    battle.running = false;
  }, 900);
}

/* ============================================================
   14) 渲染
   ============================================================ */
/* 载具 / 火炮：用不同形状绘制（车体 / 轮 / 炮管），而不是圆点 */
function drawVehicles(unit, alpha) {
  if (!unit.vehicles || !unit.vehicles.length) return;
  const isBlue = unit.side === 'blue';
  const body   = isBlue ? '#3b82f6' : '#ef4444';
  const bodyDk = isBlue ? '#1e3a8a' : '#7f1d1d';
  const L = Math.max(7, 9 * camera.zoom);
  const W = L * 0.5;

  for (const v of unit.vehicles) {
    const p = w2s(v.x, v.y);
    ctx.save();
    if (v.destroyed || v.abandoned) {
      // 残骸 / ★ 被遗弃（乘员徒步走了）：黑色叉（遗弃的淡一些、加灰底点提示"没人了"）
      ctx.globalAlpha = alpha * (v.abandoned ? 0.42 : 0.5);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.sx - L * 0.4, p.sy - L * 0.4);
      ctx.lineTo(p.sx + L * 0.4, p.sy + L * 0.4);
      ctx.moveTo(p.sx + L * 0.4, p.sy - L * 0.4);
      ctx.lineTo(p.sx - L * 0.4, p.sy + L * 0.4);
      ctx.stroke();
      if (v.abandoned) {
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, Math.max(1.6, L * 0.16), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      continue;
    }
    ctx.globalAlpha = alpha;
    ctx.translate(p.sx, p.sy);
    ctx.rotate((v.facing || 0) + Math.PI / 2);   // 车头朝上
    ctx.lineWidth = 1.1;

    if (v.kind === 'gun') {
      /* 火炮：炮管 + 防盾 + 两个轮 + 两条大架 */
      ctx.fillStyle = bodyDk;
      ctx.fillRect(-1.4, -L * 0.6, 2.8, L * 0.95);
      ctx.fillStyle = body;
      ctx.fillRect(-W * 0.5, -L * 0.12, W, L * 0.28);
      ctx.beginPath();
      ctx.arc(-W * 0.55, L * 0.12, 1.9, 0, Math.PI * 2);
      ctx.arc( W * 0.55, L * 0.12, 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = body;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-1, L * 0.12); ctx.lineTo(-W * 0.6, L * 0.62);
      ctx.moveTo( 1, L * 0.12); ctx.lineTo( W * 0.6, L * 0.62);
      ctx.stroke();
    } else if (v.kind === 'truck') {
      /* 支援车：车厢 + 驾驶室 + 四个轮 */
      ctx.fillStyle = body;
      ctx.fillRect(-W / 2, -L / 2, W, L);
      ctx.fillStyle = bodyDk;
      ctx.fillRect(-W / 2, -L / 2, W, L * 0.28);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-W / 2 - 1.2, -L * 0.3, 1.4, L * 0.2);
      ctx.fillRect( W / 2 - 0.2, -L * 0.3, 1.4, L * 0.2);
      ctx.fillRect(-W / 2 - 1.2,  L * 0.12, 1.4, L * 0.2);
      ctx.fillRect( W / 2 - 0.2,  L * 0.12, 1.4, L * 0.2);
    } else {
      /* 装甲车辆：车体 + 履带/车轮 + 炮塔 + 炮管 */
      const tracked = (v.mobilityType === 'tracked' || v.mobilityType === 'halftrack');
      ctx.fillStyle = body;
      ctx.fillRect(-W / 2, -L / 2, W, L);
      ctx.fillStyle = '#0f172a';
      if (tracked) {
        ctx.fillRect(-W / 2 - 1.7, -L / 2, 1.8, L);
        ctx.fillRect( W / 2 - 0.1, -L / 2, 1.8, L);
      } else {
        ctx.fillRect(-W / 2 - 1.2, -L * 0.32, 1.4, L * 0.18);
        ctx.fillRect( W / 2 - 0.2, -L * 0.32, 1.4, L * 0.18);
        ctx.fillRect(-W / 2 - 1.2,  L * 0.14, 1.4, L * 0.18);
        ctx.fillRect( W / 2 - 0.2,  L * 0.14, 1.4, L * 0.18);
      }
      if (v.weapon) {
        ctx.fillStyle = bodyDk;
        ctx.beginPath();
        ctx.arc(0, 0, W * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = bodyDk;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(0, -W * 0.3);
        ctx.lineTo(0, -L * 0.95);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function drawBattlefield() {
  if (!ctx) return;
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.save();
  ctx.translate(canvasW / 2 - camera.x * camera.zoom,
                canvasH / 2 - camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);

  ctx.fillStyle = '#0e1726';
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  const gs = 100;
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.55)';
  ctx.lineWidth = 1 / camera.zoom;
  for (let x = 0; x <= MAP_W; x += gs) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke();
  }
  for (let y = 0; y <= MAP_H; y += gs) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)';
  ctx.lineWidth = 1.2 / camera.zoom;
  for (let x = 0; x <= MAP_W; x += 500) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke();
  }
  for (let y = 0; y <= MAP_H; y += 500) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
  ctx.lineWidth = 3 / camera.zoom;
  ctx.strokeRect(0, 0, MAP_W, MAP_H);

  ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
  ctx.setLineDash([40, 40]);
  ctx.lineWidth = 2 / camera.zoom;
  ctx.beginPath();
  ctx.moveTo(MAP_W / 2, 0);
  ctx.lineTo(MAP_W / 2, MAP_H);
  ctx.stroke();
  ctx.setLineDash([]);

  drawTerrain();
  drawRoads();                 // ★ 矢量公路（老地图没 roads ⇒ 什么都不画）
  drawSupplies();              // ★ R9.2 补给点（地图没配 ⇒ 自动放了两个）
  drawPlayerSelection();       // ★ R9.5 选中的单位（金色圈）
  drawPlayerOrders();          // ★ R9.5d 命令目标点 + 实际路线（"我点到哪 / 怎么走"）
  /* ★ R8 DEV：手动操控的选中圈 / 目标标记（dev-panel.js 提供；非 DEV 时空操作） */
  if (window.DevPanel) DevPanel.drawWorldMarkers();
  drawObjectiveRings();
  // ★ 视野显示（isovist）：画在地形之上、建筑与兵牌之下 ⇒ 视野像"地上的光"，
  //   被建筑挡掉的方向自然不被填充（完全透明），而建筑和兵牌依旧清晰可见
  if (visionOverlay) drawVisionOverlay();

  /* ★★★ R9.6.11：**曳光弹 = 短划 + 弹头**（旧版画"枪口→目标"的整条直线 ⇒ 像激光）
     —— 每个 tracer 只画一小段亮痕，位置 = 弹头速度 × 年龄（沿弹道往目标飞），
        弹头前 40m 更亮一点（"曳光"的观感就是亮头 + 拖尾）。炮兵不走这里（用 shells）。 */
  for (const t of battle.tracers) {
    const tdx = t.x2 - t.x1, tdy = t.y2 - t.y1;
    const tLen = Math.hypot(tdx, tdy) || 1;
    const ux = tdx / tLen, uy = tdy / tLen;
    const fade = Math.max(0, 1 - t.age / TRACER_LIFE);
    const a = fade * 0.8;
    if (a <= 0.02) continue;
    const head = Math.min(tLen, TRACER_SPEED * t.age);
    const tail = Math.max(0, head - Math.min(tLen, TRACER_DASH));
    ctx.strokeStyle = (t.side === 'blue')
      ? `rgba(255, 238, 170, ${a})`
      : `rgba(255, 220, 150, ${a})`;
    ctx.lineWidth = 1.3 / camera.zoom;
    ctx.beginPath();
    ctx.moveTo(t.x1 + ux * tail, t.y1 + uy * tail);
    ctx.lineTo(t.x1 + ux * head, t.y1 + uy * head);
    ctx.stroke();
    /* 弹头：更短更亮（≤40m） */
    const hl = Math.min(head, 40);
    ctx.strokeStyle = (t.side === 'blue') ? `rgba(255, 255, 255, ${a * 0.95})` : `rgba(255, 248, 226, ${a * 0.95})`;
    ctx.lineWidth = 2.1 / camera.zoom;
    ctx.beginPath();
    ctx.moveTo(t.x1 + ux * (head - hl), t.y1 + uy * (head - hl));
    ctx.lineTo(t.x1 + ux * head, t.y1 + uy * head);
    ctx.stroke();
  }

  for (const e of battle.explosions) {
    const maxAge = e.maxAge || 0.7;
    const p = e.age / maxAge;
    const alpha = Math.max(0, 1 - p);

    if (e.isArty) {
      const r = e.radius * p;
      ctx.strokeStyle = `rgba(255, 200, 80, ${alpha * 0.9})`;
      ctx.lineWidth = 5 / camera.zoom;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 180, 60, ${alpha * 0.3})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
      // ★ 压制圈（外圈淡色虚线）——一眼就能看出口径大小
      if (e.suppressRadius) {
        const rs = e.suppressRadius * (0.35 + 0.65 * p);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = `rgba(255, 210, 110, ${alpha * 0.3})`;
        ctx.lineWidth = 2 / camera.zoom;
        ctx.beginPath();
        ctx.arc(e.x, e.y, rs, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (p < 0.35) {
        const flashAlpha = (1 - p / 0.35) * 0.95;
        ctx.fillStyle = `rgba(255, 255, 220, ${flashAlpha})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 20 / camera.zoom * (1 - p / 0.35), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (e.death) {
      const baseR = e.radius || 80;
      if (p < 0.25) {
        const q = p / 0.25;
        ctx.fillStyle = `rgba(255, 255, 255, ${(1 - q) * 0.95})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, baseR * (0.3 + q * 0.8), 0, Math.PI * 2);
        ctx.fill();
      } else if (p < 0.6) {
        const q = (p - 0.25) / 0.35;
        const r = baseR * (1.0 + q * 1.2);
        const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        grad.addColorStop(0, `rgba(255, 255, 200, ${(1 - q) * 0.9})`);
        grad.addColorStop(0.4, `rgba(255, 140, 40, ${(1 - q) * 0.75})`);
        grad.addColorStop(1, `rgba(120, 30, 0, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const q = (p - 0.6) / 0.4;
        const r = baseR * (2.2 + q * 1.8);
        const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        grad.addColorStop(0, `rgba(80, 80, 80, ${(1 - q) * 0.6})`);
        grad.addColorStop(1, `rgba(40, 40, 40, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const radius = (e.radius || 60) * (0.3 + p * 0.7);
      ctx.fillStyle = `rgba(251, 191, 36, ${alpha * 0.7})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const s of battle.shells) {
    const p = Math.min(1, s.t / s.duration);
    const prevP = Math.max(0, p - 0.08);
    const px = s.sx + (s.tx - s.sx) * prevP;
    const py = s.sy + (s.ty - s.sy) * prevP;
    const grad = ctx.createLinearGradient(px, py, s.x, s.y);
    grad.addColorStop(0, 'rgba(255, 220, 120, 0)');
    grad.addColorStop(1, 'rgba(255, 245, 180, 0.95)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5 / camera.zoom;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 240, 160, 0.55)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6 / camera.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff8c0';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.5 / camera.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'butt';
  }

  ctx.restore();

  /* ★★★ R9.6.11：**尸体灰点**（玩家要求：阵亡地点留灰点、**局内永久保存**）
     —— 画在地面上（建筑 / 兵牌 / 单兵之下），只画视口内的 ⇒ 每帧成本就是几个 arc。 */
  if (battle.corpses && battle.corpses.length) {
    const cr = Math.max(0.8, Math.min(2.4, 1.3 * camera.zoom));
    ctx.fillStyle = 'rgba(125, 120, 116, 0.72)';
    for (const c of battle.corpses) {
      const cp = w2s(c.x, c.y);
      if (cp.sx < -20 || cp.sx > canvasW + 20 || cp.sy < -20 || cp.sy > canvasH + 20) continue;
      ctx.beginPath();
      ctx.arc(cp.sx, cp.sy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ★ R9.6.9：楼内占用先算一次（楼顶血量条 / 楼内士兵只留兵牌） */
  refreshBuildingOccupancy();
  drawBattleBuildings();

  for (const u of battle.units) {
    if (!u.alive || !u.isArtilleryUnit) continue;
    const firedAgo = battle.time - (u.lastArtilleryFireTime || -999);
    if (firedAgo > 8) continue;
    const p = w2s(u.lastArtilleryFireX, u.lastArtilleryFireY);
    const alpha = 1 - firedAgo / 8;
    ctx.strokeStyle = `rgba(251, 146, 60, ${alpha * 0.8})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = `rgba(251, 146, 60, ${alpha})`;
    ctx.textAlign = 'center';
    ctx.fillText('EXPOSED', p.sx, p.sy - 34);
  }

  const symH = SYM_SCREEN_W * (SYM_H / SYM_W);
  for (const u of battle.units) {
    if (!u.alive) continue;

    let alpha = 1;
    const spottedByBlue = isSpottedBy('blue', u);
    const spottedByRed  = isSpottedBy('red', u);

    if (viewMode === 'both') {
      const revealed = (u.side === 'blue') ? spottedByRed : spottedByBlue;
      if (!revealed) alpha = 0.15;
    } else if (viewMode === 'blue') {
      if (u.side === 'red' && !spottedByBlue) alpha = 0.12;
    } else if (viewMode === 'red') {
      if (u.side === 'blue' && !spottedByRed) alpha = 0.12;
    }

    ctx.globalAlpha = alpha;

    /* ★★★ R9.6.3：兵牌位置 = **实体位置**（R9.6 起"实体为准"）
       —— 这里**绝不能再写回** `u.x = 存活士兵质心`：那是 R9.6 之前"成员为准"的遗留。
          它是在**绘制阶段**把实体拖向成员质心，而"在车上的兵"的位置 = 车位置
          （车辆槽位均值 ≠ 0，见 `unitVehicleSlotCenter` 的说明）⇒ 实体被**每帧平移一次**、
          方向随朝向旋转 ⇒ 玩家看到的"所有单位持续漂移、几十秒内冲到地图边/图外"，
          **与谁操控无关**（没有命令的单位照样跑，因为这一步在绘制里、绕过了命令层）。 */
    const p = w2s(u.x, u.y);
    const cullM = 100 + 320 * camera.zoom;   // 放宽裁剪，避免屏外单位导致屏内士兵被隐掉
    if (p.sx < -cullM || p.sx > canvasW + cullM) { ctx.globalAlpha = 1; continue; }
    if (p.sy < -cullM || p.sy > canvasH + cullM) { ctx.globalAlpha = 1; continue; }

    // ① 兵牌（指挥层）：画在最底层；近距离能看见单兵时自动半透明，避免挡住人和车
    const isBlue = u.side === 'blue';
    const baseColor = isBlue ? '59, 130, 246' : '239, 68, 68';
    const img = getSymbolImage(u.type, u.echelon, u.custom);
    const bx = p.sx - SYM_SCREEN_W / 2;
    const by = p.sy - symH / 2;
    const symbolsFaded = showIndividuals && camera.zoom >= SOLDIER_DOT_MIN_ZOOM;

    ctx.globalAlpha = alpha * (symbolsFaded ? 0.28 : 1);
    if (img && img.loaded) {
      ctx.drawImage(img, bx, by, SYM_SCREEN_W, symH);
    } else {
      ctx.fillStyle = `rgb(${baseColor})`;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (u.suppressed) {
      const pulse = 0.5 + 0.5 * Math.sin(battle.time * 8);
      ctx.strokeStyle = `rgba(251, 191, 36, ${0.5 + 0.5 * pulse})`;
      ctx.lineWidth = 2.5;
    } else {
      ctx.strokeStyle = isBlue ? 'rgba(96, 165, 250, 0.9)' : 'rgba(248, 113, 113, 0.9)';
      ctx.lineWidth = 1.4;
    }
    ctx.strokeRect(bx - 1.5, by - 1.5, SYM_SCREEN_W + 3, symH + 3);
    ctx.globalAlpha = alpha;

    // ② 载具实体：不同形状（乘车时画面上只有车，看不见人）
    if (u.vehicles && u.vehicles.length) drawVehicles(u, alpha);

    // ③ 单兵可视化（相机拉近时，画"没有上车"的士兵小点）—— 画在兵牌之上，不被遮挡
    if (showIndividuals && u.soldiers && u.soldiers.length && camera.zoom >= SOLDIER_DOT_MIN_ZOOM) {
      const dotColor = (u.side === 'blue') ? '96, 165, 250' : '248, 113, 113';
      const dotR = Math.max(1, Math.min(4, 1.7 * camera.zoom));
      ctx.fillStyle = `rgba(${dotColor}, 0.92)`;
      for (let i = 0; i < u.soldiers.length; i++) {
        const s = u.soldiers[i];
        if (!s.alive) continue;
        if (isSoldierAboard(s, u)) continue;   // 在车上 → 只画车
        /* ★ R9.6.9：进了建筑 ⇒ **只留兵牌**（玩家要求：隐藏进入建筑的士兵）
           —— 判据两条（任一成立即隐藏）：
              · 该士兵的坐标就在楼体内（行军穿过楼体的一段也看不到人）
              · 整个单位**停在楼里**（驻守）—— 排级单位铺开半径比楼大，只按坐标裁会漏掉大半 */
        if (u._bldOccupied && (u.stance !== 'moving'
            || isPointInBuilding(u._bldOccupied, s.x, s.y))) continue;
        const sp = w2s(s.x, s.y);
        ctx.beginPath();
        ctx.arc(sp.sx, sp.sy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    let deployRatio = 0;
    let undeployRatio = 0;
    let cooldownRatio = 0;

    // 拆收进度（炮兵转移时）：读真实武器（车辆 + 已下车士兵）
    const undeployingWeapons = unitDeployWeapons(u).filter(w => w._undeployProgress !== undefined);
    if (undeployingWeapons.length) {
      let minProg = 1;
      for (const w of undeployingWeapons) {
        minProg = Math.min(minProg, w._undeployProgress / w.deployTime);
      }
      undeployRatio = minProg;
    } else {
      // 架设/冷却进度：读"车辆武器"+"已下车士兵的武器"
      let sum = 0, n = 0, maxCd = 0;
      const scanRingWeapon = (w) => {
        if (!w) return;
        if (w.deployTime > 0) {
          n++;
          sum += Math.min(1, (w.deployProgress || 0) / w.deployTime);
        }
        if (w.cooldown > 0 && w.fireInterval >= COOLDOWN_RING_MIN_INTERVAL) {
          maxCd = Math.max(maxCd, w.cooldown / w.fireInterval);
        }
      };
      for (const v of (u.vehicles || [])) {
        if (v.destroyed || v.abandoned) continue;
        scanRingWeapon(v.weapon);
      }
      for (const s of u.soldiers) {
        if (!s.alive) continue;
        if (isSoldierAboard(s, u)) continue;
        scanRingWeapon(s.weapon);
      }
      if (n > 0) {
        const avg = sum / n;
        deployRatio = avg >= 1 ? 0 : avg;   // 全部架好则不显示进度环
      } else {
        cooldownRatio = maxCd;
      }
    }

    if (undeployRatio > 0) {
      const radius = SYM_SCREEN_W * 0.72;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * undeployRatio);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (deployRatio > 0) {
      const radius = SYM_SCREEN_W * 0.72;
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * deployRatio);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.2)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (cooldownRatio > 0) {
      const radius = SYM_SCREEN_W * 0.72;
      ctx.strokeStyle = 'rgba(129, 140, 248, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooldownRatio);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(129, 140, 248, 0.18)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    const barW = SYM_SCREEN_W;
    const barH = 3;
    const pctP = u.hpPersonnel / u.hpPersonnelMax;
    const pctA = u.hpArmorMax > 0 ? (u.hpArmor / u.hpArmorMax) : 0;
    const pY = by - 6;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(p.sx - barW / 2, pY, barW, barH);
    ctx.fillStyle = pctP > 0.6 ? '#22c55e' : pctP > 0.3 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(p.sx - barW / 2, pY, barW * pctP, barH);
    if (u.hpArmorMax > 0) {
      const aY = pY + barH + 1;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(p.sx - barW / 2, aY, barW, barH - 0.5);
      ctx.fillStyle = '#60a5fa';
      ctx.fillRect(p.sx - barW / 2, aY, barW * pctA, barH - 0.5);
    }

    if (showUnitLabels && u.unitLabel) {
      const labelY = by + symH + 1;
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeText(u.unitLabel, p.sx, labelY);
      ctx.fillStyle = isBlue ? '#bfdbfe' : '#fecaca';
      ctx.fillText(u.unitLabel, p.sx, labelY);

      if (u.parentLabel) {
        ctx.font = '8px system-ui, sans-serif';
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeText(u.parentLabel, p.sx, labelY + 10);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.fillText(u.parentLabel, p.sx, labelY + 10);
      }
    }

    if (u.suppressed) {
      ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', p.sx + SYM_SCREEN_W / 2 + 5, by - 3);
    }

    ctx.globalAlpha = 1;
  }

  drawBattleHud();
  drawPlayerOverlay();                 // ★ R9.5 框选矩形 + 命令提示（屏幕坐标）
  drawScaleBar();
  if (battle.sh.legend) drawLegend();   // ★ R9.5 图例默认关（收进「👁 显示」）
  drawViewModeIndicator();
}

/* ★★★ R9.6.9：**建筑占用表**（每帧一次；绘制期用）
   —— 有单位在楼里 ⇒ ① 楼顶画血量条 ② 楼里的士兵点**隐藏**（只留兵牌）。
   判据 = "单位中心在楼体内"（`getUnitBuilding`）⇒ AI 驻守、玩家命令走进楼里都算。
   缓存 `u._bldOccupied` 给同帧的单兵绘制用（省一次 单位×建筑 的 AABB 扫描）。 */
function refreshBuildingOccupancy() {
  const gm = battle.gridMap;
  const bs = (gm && gm.buildings) || [];
  if (battle._bldOccTime === battle.time) return;
  battle._bldOccTime = battle.time;
  for (const b of bs) { b._occBlue = 0; b._occRed = 0; }
  for (const u of battle.units) {
    u._bldOccupied = null;
    if (!u.alive || !bs.length) continue;
    const b = getUnitBuilding(u, gm);
    if (!b) continue;
    u._bldOccupied = b;
    if (u.side === 'blue') b._occBlue += aliveSoldiersOf(u);
    else                   b._occRed  += aliveSoldiersOf(u);
  }
}

function drawBattleBuildings() {
  if (!battle.gridMap || !battle.gridMap.buildings) return;
  const z = camera.zoom;
  for (const b of battle.gridMap.buildings) {
    const def = BUILDING_TYPES[b.type];
    if (!def) continue;
    const p1 = w2s(b.x, b.y);
    const bScreenW = b.w * z;
    if (bScreenW < 2) continue;
    const scale = bScreenW / def.pxW;
    const ox = def.dhPx * 0.5;
    const oy = def.dhPx;
    const sx = p1.sx - ox * scale;
    const sy = p1.sy - oy * scale;
    const drawW = (def.pxW + ox) * scale;
    const drawH = (def.pxH + oy) * scale;

    const img = getBattleBuildingImage(b);
    if (img && img.loaded) {
      ctx.drawImage(img, sx, sy, drawW, drawH);
    } else {
      ctx.fillStyle = 'rgba(120, 120, 130, 0.5)';
      ctx.fillRect(p1.sx, p1.sy, bScreenW, b.h * z);
    }

    /* ★ R9.6.9：**楼里有单位 ⇒ 楼顶显示建筑血量条**（玩家要求）
       颜色 = 占据方（蓝/红）；双方都有人 = 灰（争夺中）。 */
    if (b._occBlue || b._occRed) {
      ctx.save();                                   // ★ 不让 textAlign / fillStyle 泄漏给后面的兵牌与标签
      const bw = Math.max(26, bScreenW);
      const bh = 4;
      const bbx = p1.sx, bby = sy - 8;
      const ratio = Math.max(0, Math.min(1, (b.hp == null ? def.hpMax : b.hp) / (def.hpMax || 1)));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(bbx - 1, bby - 1, bw + 2, bh + 2);
      let col = 'rgba(203, 213, 225, 0.95)';
      if (b._occBlue && !b._occRed) col = 'rgba(96, 165, 250, 0.95)';
      else if (b._occRed && !b._occBlue) col = 'rgba(248, 113, 113, 0.95)';
      ctx.fillStyle = col;
      ctx.fillRect(bbx, bby, bw * ratio, bh);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('🏠 ' + Math.round(ratio * 100) + '%', bbx, bby - 3);
      ctx.restore();
    }
  }
}

function drawViewModeIndicator() {
  const labels = {
    all: '🌐 全图视野',
    both: '👁 双方视野之和',
    blue: '👁 蓝方视野',
    red:  '👁 红方视野',
  };
  const colors = {
    all: 'rgba(148, 163, 184, 0.9)',
    both: 'rgba(168, 85, 247, 0.9)',
    blue: 'rgba(96, 165, 250, 0.9)',
    red:  'rgba(248, 113, 113, 0.9)',
  };
  const label = labels[viewMode];
  const color = colors[viewMode];
  ctx.font = 'bold 13px system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  const padX = 12;
  /* ★ R9：视野胶囊移到**右上角** —— 旧版在顶部中央 (y=8)，和战况条 (y=10~40) 完全重叠 */
  const bx = canvasW - 14 - (tw + padX * 2);
  const by = 34;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw + padX * 2, 24, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + padX + tw / 2, by + 12);

  /* ★ R9：长提示**只在按 V/L 后 4 秒内显示**（旧版常驻在 y=46 ⇒ 和诊断条重叠） */
  if (battle.time - (battle._viewHintAt || -99) < 4) {
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.textAlign = 'right';
    ctx.fillText('按 V 切换视野（全图 → 双方 → 蓝 → 红） · 按 L 显示视野范围（圆内半透明=看得见，被挡处透明）',
                 canvasW - 16, by + 32);
  }
}

function drawBattleHud() {
  if (!battle.tickets) return;
  const tk = battle.tickets;
  const tkMax = battle.ticketsMax || { blue: 1, red: 1 };
  const pc = battle.pointCount || { blue: 0, red: 0, neutral: 0 };
  const w = Math.min(600, canvasW - 32), h = 30;
  const x0 = (canvasW - w) / 2, y0 = 10;

  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, 6); else ctx.rect(x0, y0, w, h);
  ctx.fill();
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.95)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const numW = 62, midW = 200;
  const barW = Math.max(40, (w - numW * 2 - midW - 24) / 2);
  const barH = 9;
  const by = y0 + h / 2 - barH / 2;
  const bx = x0 + 10 + numW;
  const rx = x0 + w - 10 - numW - barW;
  const bRatio = Math.max(0, Math.min(1, tk.blue / (tkMax.blue || 1)));
  const rRatio = Math.max(0, Math.min(1, tk.red / (tkMax.red || 1)));

  // 蓝方条（从左往右缩）
  ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(bx, by, barW * bRatio, barH);

  // 红方条（从右往左缩）
  ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
  ctx.fillRect(rx, by, barW, barH);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(rx + barW * (1 - rRatio), by, barW * rRatio, barH);

  // 中间：据点数 + 剩余时间
  const remain = Math.max(0, MAX_BATTLE_TIME - battle.time);
  const mm = Math.floor(remain / 60);
  const ss = Math.floor(remain % 60);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`⬤${pc.blue} ⬤${pc.neutral} ⬤${pc.red}   ⏱ ${mm}:${String(ss).padStart(2, '0')}`,
               x0 + w / 2, y0 + h / 2);

  // 两侧数字
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#93c5fd';
  ctx.fillText(`蓝 ${Math.round(Math.max(0, tk.blue))}`, x0 + 10, y0 + h / 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fca5a5';
  ctx.fillText(`红 ${Math.round(Math.max(0, tk.red))}`, x0 + w - 10, y0 + h / 2);

  /* ★★ R7.7：**屏上诊断条** —— 以后"卡一下"不用开 F12：看这行数字就知道是逻辑重还是绘制重。
     逻辑 = updateBattle 的耗时；绘制 = drawBattlefield + overlay 的耗时；规划 = 每秒现算路线的次数。
     （>100ms 就会出现肉眼可见的"整场静止一下"：因为 gameLoopFrame 把 dt 封顶在 0.05s，
       慢帧里仿真几乎不前进，而且那一帧画面不刷新。） */
  const dm = battle._logicMs || 0, dw = battle._drawMs || 0;
  const pk = battle._slowPeak;
  /* ★ R8：本帧"有多少单位没有移动目标 / 主要因为什么"（直接回答"为什么整体静止"） */
  let idleN = 0;
  const tally = {};
  for (const u of battle.units) {
    if (!u.alive || !u._idleWhy) continue;
    idleN++;
    tally[u._idleWhy] = (tally[u._idleWhy] || 0) + 1;
  }
  let topWhy = null;
  for (const k in tally) if (!topWhy || tally[k] > tally[topWhy]) topWhy = k;
  const hot = (dm > 50 || dw > 50 || !!pk);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  /* ★★★ R9.5：**诊断行默认关掉** —— 玩家界面只需要"战况 + 命令反馈"，
     逻辑/绘制 ms、停止原因、命令流水这些收进顶栏「👁 显示 → 诊断」。 */
  if (battle.sh.diag) {
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = hot ? '#fca5a5' : 'rgba(148, 163, 184, 0.85)';
    ctx.fillText(`逻辑 ${dm.toFixed(0)}ms · 绘制 ${dw.toFixed(0)}ms · 异常 ${battle._loopErrs || 0} · 单位 ${battle.units.length}`
                 + (pk ? ` ｜ 峰值 ${pk.逻辑}ms（${pk.最慢段} · 视野层${pk.视野层}）` : '')
                 + (idleN ? ` ｜ 停止 ${idleN}（${topWhy}×${tally[topWhy]}）` : ''),
                 canvasW / 2, y0 + h + 6);
  }
  if (battle._loopErrs > 0) {             // 帧异常：永远显示（这是"出事了"的信号）
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillText(`⚠ 帧异常（连续 ${battle._loopErrs} 次）：${String(battle._loopErrMsg || '').slice(0, 90)}`,
                 canvasW / 2, y0 + h + (battle.sh.diag ? 19 : 6));
  }
  /* 命令层状态：只在诊断模式显示（玩家要看的是命令条 + 选中圈） */
  if (typeof Cmd !== 'undefined' && battle.sh.diag) {
    const cs = Cmd.summary();
    let resup = 0;
    for (const u of battle.units) if (u.alive && u._resupplying) resup++;
    const lastRej = cs.rejects.length ? cs.rejects[cs.rejects.length - 1].msg : '';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.fillText('命令 ' + cs.active + ' 条'
                 + (resup ? (' · 补给中 ' + resup) : '')
                 + (lastRej ? (' ｜ ' + lastRej) : ''),
                 canvasW / 2, y0 + h + 32);
  }
  /* 命令被拒 / 提示：**永远显示**（玩家必须看得到"为什么没下达成功"） */
  if (typeof Cmd !== 'undefined' && Cmd.toast && Cmd.toast.until > battle.time) {
    ctx.fillStyle = '#fca5a5';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(Cmd.toast.msg, canvasW / 2, y0 + h + (battle.sh.diag ? 50 : 24));
  }
  ctx.restore();
}

function drawScaleBar() {
  const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const target = 120;
  let best = nice[0];
  for (const L of nice) {
    if (L * camera.zoom <= target) best = L;
    else break;
  }
  const barPx = best * camera.zoom;
  if (barPx < 30) return;
  const x0 = 20, y0 = canvasH - 26;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 6);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + barPx, y0);
  ctx.lineTo(x0 + barPx, y0 - 6);
  ctx.stroke();
  ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(best >= 1000 ? (best/1000).toFixed(1) + ' km' : best + ' m', x0 + barPx/2, y0 - 8);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
  ctx.font = '11px system-ui, sans-serif';
  const mPerPx = 1 / camera.zoom;
  ctx.fillText(`地图 ${Math.round(MAP_W)} × ${Math.round(MAP_H)} m · 1px ≈ ${mPerPx.toFixed(1)} m`, canvasW - 16, 12);
}

function drawLegend() {
  const items = [
    { color: 'rgba(22, 90, 40, 0.9)',    label: '树林',   hint: '减速/隐蔽' },
    { color: 'rgba(170, 120, 55, 0.85)', label: '山丘',   hint: '视野/射程+' },
    { color: 'rgba(140, 145, 160, 1)',   label: '房屋',   hint: '进驻/掩护' },
    { color: 'rgba(55, 65, 85, 1)',      label: '公路',   hint: '加速' },
    { color: 'rgba(60, 110, 170, 0.9)',  label: '河流',   hint: '减速/掩护' },
    { color: 'rgba(200, 205, 215, 1)',   label: '石墙',   hint: '阻挡/掩护' },
    { color: 'rgba(250, 204, 21, 0.9)',  label: '据点',   hint: 'AI 争夺' },
    { color: 'rgba(140, 140, 150, 0.9)', label: '建筑', hint: '进驻/掩体' },
    { color: 'rgba(251, 191, 36, 0.95)', label: '压制',   hint: '! 拒绝还击' },
  ];

  const lw = 180;
  const lh = items.length * 22 + 24;
  const lx = 20;
  const ly = canvasH - lh - 50;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(lx, ly, lw, lh, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('图例', lx + 12, ly + 8);

  ctx.font = '11px system-ui, sans-serif';
  items.forEach((it, i) => {
    const y = ly + 28 + i * 22;
    ctx.fillStyle = it.color;
    ctx.fillRect(lx + 12, y + 4, 14, 12);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
    ctx.lineWidth = 0.7;
    ctx.strokeRect(lx + 12, y + 4, 14, 12);
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.fillText(it.label, lx + 34, y + 5);
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(it.hint, lx + lw - 12, y + 5);
  });
}

/* ============================================================
   地形绘制
   ============================================================ */
/* ★★ R9.2：**补给点**（在世界坐标下画 —— 与 drawRoads / drawTerrain 同一坐标系，
   主渲染已经做了 translate+scale ⇒ 这里绝不能再调 w2s，否则缩放/拖动时会乱跑） */
function drawSupplies() {
  const list = battle.supplies || [];
  if (!list.length) return;
  const z = camera.zoom || 1;
  ctx.save();
  for (const s of list) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
    ctx.fill();
    ctx.setLineDash([14 / z, 10 / z]);
    ctx.lineWidth = 2 / z;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.r * z > 22) {                       // 够近才写字，不然全图都是字
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(1 / z, 1 / z);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('📦', 0, -8);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(186, 230, 253, 0.95)';
      ctx.fillText(s.name, 0, 9);
      ctx.restore();
    }
  }
  ctx.restore();
}

/* ★ 矢量公路（R4）：在**世界坐标**下描线（与 drawTerrain 同一坐标系 ——
   主渲染已经做了 translate+scale 相机变换，这里绝不能再调 w2s，否则会双重变换 ⇒ 缩放/拖动时乱跑） */
function drawRoads() {
  const gm = battle.gridMap;
  if (!gm || !gm.roads || !gm.roads.length) return;
  const col = GRID_PALETTE[GRID_IDX[ROAD_TILE_ID]].color;
  const path = (rd) => {
    ctx.beginPath();
    ctx.moveTo(rd.pts[0].x, rd.pts[0].y);
    for (let i = 1; i < rd.pts.length; i++) ctx.lineTo(rd.pts[i].x, rd.pts[i].y);
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  /* ★ 两遍：先画**所有**路基，再画**所有**路面。
     单条路"路基+路面"连着画的话，后画的路基会横切先画的路面 ⇒ 路口一道黑缝。 */
  for (const pass of [0, 1]) {
    for (const rd of gm.roads) {
      if (!rd.pts || rd.pts.length < 2) continue;
      path(rd);
      if (pass === 0) { ctx.strokeStyle = 'rgba(18,24,34,0.6)'; ctx.lineWidth = rd.w + 2; }
      else            { ctx.strokeStyle = col;                       ctx.lineWidth = rd.w; }
      ctx.stroke();
    }
  }
  /* 宽路：中心虚线（世界坐标，缩放自动跟随） */
  ctx.setLineDash([10, 12]);
  ctx.strokeStyle = 'rgba(226,232,240,0.32)';
  ctx.lineWidth = 0.8;
  for (const rd of gm.roads) {
    if (!rd.pts || rd.pts.length < 2 || rd.w < 8) continue;
    path(rd);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawTerrain() {
  if (!battle.gridCanvas) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(battle.gridCanvas, 0, 0, MAP_W, MAP_H);
  ctx.imageSmoothingEnabled = true;
}

function drawObjectiveRings() {
  if (!battle.objectives || !battle.objectives.length) return;

  for (const o of battle.objectives) {
    const owner = o.owner || null;
    let strokeColor, fillColor, glowColor;
    if (owner === 'blue') {
      strokeColor = 'rgba(96, 165, 250, 0.95)';
      fillColor = 'rgba(59, 130, 246, 0.08)';
      glowColor = 'rgba(96, 165, 250, 0.35)';
    } else if (owner === 'red') {
      strokeColor = 'rgba(248, 113, 113, 0.95)';
      fillColor = 'rgba(239, 68, 68, 0.08)';
      glowColor = 'rgba(248, 113, 113, 0.35)';
    } else {
      strokeColor = 'rgba(250, 204, 21, 0.95)';
      fillColor = 'rgba(250, 204, 21, 0.04)';
      glowColor = 'rgba(250, 204, 21, 0.3)';
    }

    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 10 / camera.zoom;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3.5 / camera.zoom;
    ctx.setLineDash([24 / camera.zoom, 14 / camera.zoom]);
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    /* ★ 占领进度（拔河环）：cap ∈ [-1,1]，(cap+1)/2 = 蓝方占的比例 */
    const cap = (typeof o.cap === 'number') ? o.cap : 0;
    const shareBlue = (cap + 1) / 2;
    if (shareBlue > 0.01 && shareBlue < 0.99) {
      const a0 = -Math.PI / 2;
      const aMid = a0 + Math.PI * 2 * shareBlue;
      ctx.lineWidth = 9 / camera.zoom;
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.95)';
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, a0, aMid);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.95)';
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, aMid, a0 + Math.PI * 2);
      ctx.stroke();
    }

    const label = o.name || '';
    if (label) {
      const fontSize = 22 / camera.zoom;
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width;
      const lx = o.x;
      const ly = o.y - o.r - 30 / camera.zoom;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      ctx.roundRect(lx - tw / 2 - 10 / camera.zoom, ly - fontSize * 0.7,
                    tw + 20 / camera.zoom, fontSize * 1.4, 6 / camera.zoom);
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.stroke();
      ctx.fillStyle = strokeColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly);
    }
  }
}

/* ============================================================
   15) AI 调试浮层（按 D 键切换）
   ============================================================ */
let debugOverlayVisible = false;
let _debugOverlayEl = null;
let _debugLastUpdate = 0;

function ensureDebugOverlay() {
  if (_debugOverlayEl) return _debugOverlayEl;
  const el = document.createElement('div');
  el.id = '_debug_overlay';
  document.body.appendChild(el);
  _debugOverlayEl = el;
  return el;
}

function inferUnitCommand(u) {
  if (u.suppressed) return { cmd: 'TAKE_COVER', color: '#fbbf24' };
  if (u.isArtilleryUnit) {
    if (u._needsUndeploy) return { cmd: 'UNDEPLOY', color: '#fb923c' };
    if (u._relocateTarget) return { cmd: 'RELOCATING', color: '#a78bfa' };
    const ago = battle.time - (u.lastArtilleryFireTime || -999);
    if (ago < 8) {
      return { cmd: 'FIRED ' + ago.toFixed(1) + 's', color: '#fb923c' };
    }
    if (u.target && u.target.alive) {
      const tname = u.target.name || u.target.id.slice(0, 6);
      return { cmd: 'ARTY→' + tname, color: '#f87171' };
    }
    return { cmd: 'ARTY READY', color: '#fbbf24' };
  }
  if (u._command) {
    const t = u._command.type;
    if (t === 'ATTACK') {
      const tn = u._command.target?.name || u._command.target?.id?.slice(0,6) || '?';
      return { cmd: 'ATTACK:' + tn, color: '#f87171' };
    }
    if (t === 'APPROACH') return { cmd: 'APPROACH', color: '#fb923c' };
    if (t === 'TAKE_COVER') return { cmd: 'TAKE_COVER', color: '#fbbf24' };
    if (t === 'MOVE_TO') return { cmd: 'MOVE_TO@' + (u._command.objective?.name || '?'), color: '#a78bfa' };
    if (t === 'GARRISON') return { cmd: 'GARRISON@' + (u._command.objective?.name || '?'), color: '#34d399' };
    if (t === 'HOLD') return { cmd: 'HOLD', color: '#94a3b8' };
  }
  const gs = battle._groups && battle._groups[u._groupKey];
  if (gs && gs.objectiveId) {
    const o = battle.objectives.find(x => x._id === gs.objectiveId);
    if (o) {
      const d = Math.hypot(u.x - o.x, u.y - o.y);
      if (d < o.r * 0.8) {
        return { cmd: 'CAPTURE@' + o.name, color: '#60a5fa' };
      }
      if (u.stance === 'moving') {
        return { cmd: 'MOVE_TO@' + o.name, color: '#a78bfa' };
      }
      return { cmd: 'GARRISON@' + o.name, color: '#34d399' };
    }
  }
  if (u.stance === 'moving') return { cmd: 'MOVE_TO?', color: '#a78bfa' };
  return { cmd: 'HOLD', color: '#94a3b8' };
}

function renderDebugOverlay() {
  if (!debugOverlayVisible || !_debugOverlayEl) return;

  const now = performance.now();
  if (now - _debugLastUpdate < 300) return;
  _debugLastUpdate = now;

  if (!battle.units.length) {
    _debugOverlayEl.innerHTML = '<div style="color:#64748b;">尚无战斗数据</div>';
    return;
  }

  const bySide = { blue: new Map(), red: new Map() };
  for (const u of battle.units) {
    if (!u.alive) continue;
    const gk = u._groupKey || 'ungrouped';
    if (!bySide[u.side].has(gk)) bySide[u.side].set(gk, []);
    bySide[u.side].get(gk).push(u);
  }

  let html = '';

  if (battle.objectives.length) {
    html += '<div class="dbg-h">据点</div>';
    for (const o of battle.objectives) {
      const b = o.blueCount || 0, r = o.redCount || 0;
      const own = o.owner || '-';
      const color = own === 'blue' ? '#60a5fa' : own === 'red' ? '#f87171' : '#fbbf24';
      html += `<div class="dbg-row">
        <span>${escapeHtml(o.name)}</span>
        <span style="color:${color}">B:${b} R:${r} [${own}]</span>
      </div>`;
    }
  }

  for (const side of ['blue', 'red']) {
    const sideName = side === 'blue' ? '蓝方' : '红方';
    const color = side === 'blue' ? '#60a5fa' : '#f87171';
    html += `<div class="dbg-h" style="color:${color};">${sideName}</div>`;
    const groups = bySide[side];
    if (groups.size === 0) {
      html += `<div style="color:#64748b;">（全灭）</div>`;
      continue;
    }
    for (const [gk, units] of groups) {
      const gs = battle._groups && battle._groups[gk];
      let gTargetName = '无';
      if (gs && gs.objectiveId) {
        const o = battle.objectives.find(x => x._id === gs.objectiveId);
        if (o) gTargetName = o.name;
      }
      let groupLabel = '';
      for (const u of units) {
        if (u.parentLabel) { groupLabel = u.parentLabel; break; }
      }
      if (!groupLabel) groupLabel = gk.split('|')[1] || gk;

      const stance = gs && gs.stance ? gs.stance : '-';
      const stanceColor = stance === 'assault' ? '#f87171'
                        : stance === 'defend' ? '#60a5fa'
                        : stance === 'reserve' ? '#94a3b8'
                        : '#64748b';

      html += `<div class="dbg-g">[${escapeHtml(groupLabel)}] <span style="color:${stanceColor};font-size:10px;">${stance}</span> 目标: ${escapeHtml(gTargetName)} <span style="color:#64748b;">(${units.length}单位)</span></div>`;

      for (const u of units) {
        const { cmd, color: c } = inferUnitCommand(u);
        const label = u.unitLabel || u.name || u.id.slice(0, 6);
        let role, roleColor;
        if (u.isArtilleryUnit) {
          role = u._artyRole || 'artillery';
          roleColor = role === 'counter' ? '#ef4444'
                    : role === 'support' ? '#22c55e'
                    : '#fbbf24';
        } else {
          role = u._tacticalRole || '-';
          roleColor = role === 'main' ? '#f87171'
                    : role === 'flank' ? '#a78bfa'
                    : role === 'suppress' ? '#fb923c'
                    : role === 'companion' ? '#f97316'
                    : role === 'reserve' ? '#94a3b8'
                    : '#64748b';
        }

        // 密度感知显示
        let densityStr = '';
        if (!u.isArtilleryUnit && u._densityOffset) {
          const perc = u._densityPerception || 0;
          const tag = perc < -0.2 ? '太挤' : perc > 0.4 ? '偏空' : '舒适';
          const dc = perc < -0.2 ? '#ef4444' : perc > 0.4 ? '#fbbf24' : '#22c55e';
          densityStr = `<span style="color:${dc};font-size:9px;margin-left:4px;">密度:${tag}(${perc.toFixed(1)})</span>`;
        }

        const dbgType = (u.type || '?') + (u.isArtilleryUnit ? ' ⚠ARTY' : (u.isSupportUnit ? ' ⚙SUP' : ''));
        html += `<div class="dbg-u">
          <span style="color:${roleColor};font-weight:700;min-width:56px;">[${role}]</span>
          <span>${escapeHtml(label)}</span>
          <span style="color:#64748b;font-size:10px;margin-left:4px;">${escapeHtml(dbgType)}</span>
          ${densityStr}
          <span style="color:${c};margin-left:auto;">${escapeHtml(cmd)}</span>
        </div>`;
      }
    }
  }

  /* ★ 火线诊断：为什么没开火（按 D 打开调试浮层查看）
     列含义：射手 / 无枪 / 在车 / 极压 / 架设中 / 冷却 / 无目标 / 超射程 → 本帧实际开火数 */
  {
    const list = battle.units.filter(u => u.alive && u._firingStats);
    // ★ 按"离镜头中心最近"排序：你看哪就显示哪（不再因为人数少而被步兵排挤掉，比如坦克）
    list.sort((a, b) =>
      Math.hypot(a.x - camera.x, a.y - camera.y) - Math.hypot(b.x - camera.x, b.y - camera.y));
    html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #334155;font-weight:700;">🔫 火线诊断（离镜头最近的 6 个单位）</div>`;
    html += `<div style="color:#64748b;font-size:9px;margin-bottom:3px;">射手/无枪/在车/极压/架设/冷却/无目标/超射程 → 开火</div>`;
    for (const u of list.slice(0, 6)) {
      const f = u._firingStats;
      const dist = u.target ? Math.round(Math.hypot(u.target.x - u.x, u.target.y - u.y)) : -1;
      const eng = Math.round(engageRangeOf(u, u.target || null));
      const cov = u.target
        ? Math.round(firepowerFractionAt(u, u.target,
            Math.hypot(u.target.x - u.x, u.target.y - u.y), 1) * 100)
        : 0;
      const col = f.fired > 0 ? '#22c55e' : '#f87171';
      const optName = u._option || '—';
      const optCol = { HOLD: '#94a3b8', BOUND: '#38bdf8', ASSAULT: '#f97316',
                       WITHDRAW: '#facc15', REGROUP: '#a78bfa', FLANK: '#22d3ee' }[optName] || '#64748b';
      html += `<div class="dbg-u" style="font-size:10px;">
        <span style="min-width:64px;color:#e2e8f0;">${escapeHtml((u.name || '').slice(0, 6))}</span>
        <span style="color:#94a3b8;">${f.shooters}/${f.noWeapon}/${f.aboard}/${f.hardSupp}/${f.deploying}/${f.cooling}/${f.noTarget}/${f.outRange}</span>
        <span style="color:${col};margin-left:auto;">→${f.fired}</span>
        <span style="color:#64748b;margin-left:4px;">目标${dist >= 0 ? dist + 'm' : '无'} 交战${eng}m 覆盖${cov}% 压制${(u.suppressionLevel || 0).toFixed(2)}${f.gated ? ' ⛔闸门' : ''}${(u.vehicles && u.vehicles.length) ? ` 车距${Math.round(u._vehicleMaxDist || 0)}m${u._vehiclesAbandoned ? '(弃车)' : (vehicleNearUnit(u) ? '(已就位)' : '(追赶中)')}` : ''}${u._noEngageableTarget ? ' ⚠无有效目标' : ''}</span>
        <span style="color:${optCol};margin-left:4px;">【${optName}${unitOptionScoreText(u)}】</span>
      </div>`;
    }
  }

  _debugOverlayEl.innerHTML = html;
}

window.addEventListener('DOMContentLoaded', () => {
  ensureDebugOverlay();
});

window.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.key === 'd' || e.key === 'D') {
    debugOverlayVisible = !debugOverlayVisible;
    ensureDebugOverlay().style.display = debugOverlayVisible ? 'block' : 'none';
    if (debugOverlayVisible) renderDebugOverlay();
  }
});
