/* ============================================================
   hex-core.js —— 回合制六角格兵棋：**唯一真相**
   ------------------------------------------------------------
   玩家定案（R10）：
     · 基础棋子 = **班**（9~10 人）；单兵是棋子内部的明细（不占棋盘）
     · 六角格 = **正六边形，边长 100 m**（pointy-top + odd-r 偏移）
     · 火力等级 FLV = **1~12 级**（12 = 最强）
     · 三张**固定 CRT**：反人员 / 反装甲 / 炮击
     · **射程表（FLV）跟着装备库实时变**，CRT 一格不改
     · 结果代号：软目标 `S`(压制) `K`(死1人) `2K` `3K`
                 硬目标 `S` `Km`(动力坏) `Kf`(武器坏) `K`(击毁)
   本文件只放**纯函数与常量**（不碰 DOM）⇒ 浏览器与离线脚本共用同一套算法。
   ============================================================ */

/* ---------- 1) 六角格几何（正六边形，尖顶朝上） ---------- */
const HEX_EDGE = 100;                        // 边长 a（米）—— 改这一个数就能换尺度
const HEX_W = Math.sqrt(3) * HEX_EDGE;       // 格宽 = √3·a
const HEX_H = 2 * HEX_EDGE;                  // 格高（两尖点之间）= 2a
const HEX_ROW_STEP = 1.5 * HEX_EDGE;         // 行间距 = 1.5a

/* 行列(odd-r 偏移) → 世界坐标（hex 中心）
   x = W·(col + odd/2) + W/2 ； y = ROW_STEP·row + EDGE
   （加偏移是为了让最左上那格的**顶点**正好落在 (0,0)，方便整张图贴边） */
function hexCenter(col, row) {
  const odd = (((row % 2) + 2) % 2);
  const x = HEX_W * (col + 0.5 * odd) + HEX_W / 2;
  const y = HEX_EDGE + HEX_ROW_STEP * row;
  return { x, y };
}

/* 世界坐标 → 行列（axial 四舍五入 再转 odd-r） */
function worldToHex(x, y) {
  const ax = (x - HEX_W / 2) / HEX_EDGE;
  const ay = (y - HEX_EDGE) / HEX_EDGE;
  const q = (Math.sqrt(3) / 3) * ax - (1 / 3) * ay;
  const r = (2 / 3) * ay;
  let cx = q, cz = r, cy = -cx - cz;
  let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
  const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  const odd = ((rz % 2) + 2) % 2;
  return { col: rx + (rz - odd) / 2, row: rz };
}

/* odd-r 偏移 → cube（算距离用） */
function offsetToCube(col, row) {
  const odd = ((row % 2) + 2) % 2;
  const x = col - (row - odd) / 2;
  const z = row;
  return { x, z, y: -x - z };
}
/* 两格之间的格数（六角格距离）；任一格为空返回一个大数（防调用方漏判） */
function hexDistance(a, b) {
  if (!a || !b) return 9999;
  const A = offsetToCube(a.col, a.row), B = offsetToCube(b.col, b.row);
  return Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z));
}

/* 六个邻居（odd-r：奇数行整体右移半格） */
const _NB_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const _NB_ODD  = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
function hexNeighbors(col, row) {
  const t = (((row % 2) + 2) % 2) ? _NB_ODD : _NB_EVEN;
  const out = [];
  for (const [dc, dr] of t) out.push({ col: col + dc, row: row + dr });
  return out;
}

/* 六边形顶点（画格子用）：尖顶朝上 ⇒ 顶点角 = -90° + 60°·i */
function hexCorners(cx, cy, edge) {
  const a = edge || HEX_EDGE;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const ang = (-90 + 60 * i) * Math.PI / 180;
    out.push({ x: cx + a * Math.cos(ang), y: cy + a * Math.sin(ang) });
  }
  return out;
}

/* ---------- 2) 地形 → 移动成本（MP）与视线/掩体 ---------- */
/* ★ R10.18：**1 回合 = 60 秒**（玩家："我希望每个回合的模拟时间为 1 分钟，所以将单位的移动力也根据这个做调整"）
   ------------------------------------------------------------
   一格 = 100 m ⇒ 每回合能走的格数 = 速度(m/min) ÷ 100。按"战术速度"（含展开/观察/短停）折算：
     · 徒步 2 格  = 200 m/min ≈ 12 km/h（武装跃进/小跑；树林成本 2 ⇒ 1 格 ≈ 6 km/h）
     · 轮式 8 格  = 800 m/min ≈ 48 km/h（公路；越野成本 2 ⇒ 4 格 ≈ 24 km/h）
     · 履带 6 格  = 600 m/min ≈ 36 km/h（越野成本 1 ⇒ 6 格；树林成本 2 ⇒ 3 格 ≈ 18 km/h）
     · 半履带 6 格 / 空中 10 格（1000 m/min ≈ 60 km/h 低空盘旋/攻击航线）
   ★ 只有"徒步 4→2"是真变化：旧值 400 m/min ≈ 24 km/h，对徒步来说是一分钟冲刺，撑不住。 */
const TURN_SECONDS = 60;
const MP_MAX = { foot: 2, wheeled: 8, tracked: 6, halftrack: 6, air: 10 };
/* 格成本：Infinity = 进不去（墙/建筑对车辆） */
const MP_COST = {
  foot:      { empty:1, road:1, forest:2, hill:2, house:2, river:3, trench:2, wall:Infinity, swamp:3 },
  wheeled:   { empty:2, road:1, forest:Infinity, hill:Infinity, house:Infinity, river:Infinity,
               trench:Infinity, wall:Infinity, swamp:Infinity },
  tracked:   { empty:1, road:1, forest:2, hill:2, house:Infinity, river:3, trench:2, wall:Infinity, swamp:3 },
  halftrack: { empty:1, road:1, forest:2, hill:2, house:Infinity, river:3, trench:2, wall:Infinity, swamp:3 },
  air:       { empty:1, road:1, forest:1, hill:1, house:1, river:1, trench:1, wall:1, swamp:1 },
};
/* 视线拦截（每格算一次，累计 ≥1 = 完全遮挡）—— 与战场版同一口径 */
const HEX_SIGHT = { empty:0, road:0, forest:0.5, hill:0.5, house:0.7, river:0, trench:0, wall:0.5, swamp:0 };
/* 掩体（守方 FLV 降档用） */
const HEX_COVER = { empty:0, road:0, forest:0.3, hill:0.15, house:0.5, river:0.1, trench:0.35, wall:0.4, swamp:0.1 };

/* ---------- 3) 地图 → 六角格（一次烘焙，缓存在 gm._hex） ---------- */
/* ★ R10.23：**格内地形 = 格内面积占比最大的地形**（玩家定案）
   ------------------------------------------------------------
   "地图用的是实时战斗里面的地图直接套上六角格来用，单个六角格内属于什么地形
     就是用那个六角格内占比最高的地形来算。"
   旧做法：中心 + 6 个方向（0.62a）共 7 点采样投票 —— 一条 10m 宽的路、5m 宽的河
           只要这 7 个点没踩中，整格就"没有"；反过来擦到一点就整格算路。
   新做法：把 5m 栅格**按面积**累加进它所在的六角格（worldToHex 归格）：
     · 主地形 = 面积最大的那个（平局按 HEX_TERR_ORDER 的"硬度"）
     · 公路   = 叠加属性：路面面积 ≥ HEX_ROAD_SHARE 就算这一格有路
                （10m 路横穿一格 ≈ 1730㎡ / 25981㎡ ≈ 6.7%；4m 窄路 ≈ 2.6%；只擦角 ≈ 0.5%）
     · 建筑   = 矢量建筑覆盖 ≥ HEX_BUILD_SHARE 才判"城区"
   代价：O(栅格数) 一次遍历（实测：立交桥 50 万格 ≈ 30ms、卡朗唐 144 万格 ≈ 60ms、
         巴斯通涅 180 万格 ≈ 72ms），缓存在 gm._hex。 */
const HEX_BAKE_VER = 3;            // 烘焙算法版本：改算法就 +1 ⇒ 旧缓存自动作废
const HEX_ROAD_SHARE = 0.015;      // 路面 ≥ 1.5% 格面积 ⇒ 这一格有公路
const HEX_WATER_SHARE = 0.05;      // 水面 ≥ 5% 格面积 ⇒ 这一格算"水域"（叠加属性，挡车）
const HEX_BUILD_SHARE = 0.30;      // 矢量建筑 ≥ 30% 格面积 ⇒ 这一格是城区
const HEX_AREA = 1.5 * Math.sqrt(3) * HEX_EDGE * HEX_EDGE;   // 正六边形面积 = 3√3/2·a²
/* 面积并列时的优先顺序（越靠前越"硬"：对战斗影响大的赢） */
const HEX_TERR_ORDER = ['house', 'forest', 'hill', 'swamp', 'river', 'trench', 'wall', 'road', 'empty'];
function hexTerrRank(id) {
  const i = HEX_TERR_ORDER.indexOf(id);
  return i < 0 ? HEX_TERR_ORDER.length : i;
}
/* 调色板下标 → 地形 id（hex-core.js 可以单独加载；没有 grid-maps.js 时按空表处理） */
let _hexPalIds = null;
function hexPaletteIds() {
  if (_hexPalIds) return _hexPalIds;
  _hexPalIds = [];
  if (typeof GRID_PALETTE !== 'undefined' && Array.isArray(GRID_PALETTE)) {
    GRID_PALETTE.forEach((p, i) => { _hexPalIds[i] = (p && p.id) || 'empty'; });
  }
  return _hexPalIds;
}
function hexRoadIdx() { return hexPaletteIds().indexOf('road'); }
/* ★ R10.13：**六角格编辑器**产出的地图不走 5m 光栅烘焙
   ------------------------------------------------------------------
   地图编辑器里"我画的每一格"就是兵棋里"打起来的每一格" —— 不做采样、不做投票，
   避免"画的树林变草地"这种对不上的事。地图对象长这样：
     gm.hexData = { cols, rows,
                    terr:   ['empty','forest',...],   // 每格地形 id（长度 cols*rows）
                    road:   [0,1,...],                // 每格有没有公路（叠加属性）
                    obj:    [-1,0,-1,...],            // 每格属于第几个据点（-1 = 没有）
                    deploy: ['','blue','red',...] }   // 部署区（可选）
   gm.objectives 的**半径按格数**（rHex）算归属，见第 3 节 bakeHexMap / 第 12 节胜利条件。 */
function hexMapSize(cols, rows) {
  const c = Math.max(1, cols | 0), r = Math.max(1, rows | 0);
  return { w: Math.round(HEX_W * c + HEX_W / 2), h: Math.round(HEX_H + HEX_ROW_STEP * (r - 1)) };
}
function bakeHexData(gm) {
  const hd = gm.hexData || {};
  const cols = Math.max(1, hd.cols | 0 || 1);
  const rows = Math.max(1, hd.rows | 0 || 1);
  if (gm._hex && gm._hex.cols === cols && gm._hex.rows === rows &&
      gm._hex.forW === gm.w && gm._hex.forH === gm.h) return gm._hex;
  const hexes = new Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const c = hexCenter(col, row);
      let terr = (hd.terr && hd.terr[i]) || 'empty';
      /* 公路是叠加属性：地形写成 road 也当"草地 + 公路" */
      let road = !!(hd.road && +hd.road[i]) || terr === 'road';
      if (terr === 'road') terr = 'empty';
      if (!(terr in HEX_SIGHT)) terr = 'empty';
      const obj = (hd.obj && hd.obj[i] != null) ? (hd.obj[i] | 0) : -1;
      const dep = (hd.deploy && hd.deploy[i]) || '';
      hexes[i] = {
        col, row, x: c.x, y: c.y, terr, road,
        bld: (hd.bld && +hd.bld[i]) || 0,          // ★ R10.36：格子里的建筑栋数（掩体/中立建筑）
        obj: (obj >= 0 ? obj : -1),
        deploy: (dep === 'blue' || dep === 'red') ? dep : '',
        sight: HEX_SIGHT[terr] == null ? 0 : HEX_SIGHT[terr],
        cover: HEX_COVER[terr] == null ? 0 : HEX_COVER[terr],
      };
    }
  }
  gm._hex = { ver: HEX_BAKE_VER, cols, rows, hexes, forW: gm.w, forH: gm.h };
  return gm._hex;
}
/* ★ R10.23：官方地图（5m 光栅 + 矢量公路）→ 六角格：**按面积占比**定地形 */
function bakeHexMap(gm) {
  if (!gm) return null;
  if (gm.hexData) return bakeHexData(gm);
  const rev = gm._rev || 0;
  if (gm._hex && gm._hex.ver === HEX_BAKE_VER && gm._hex.rev === rev &&
      gm._hex.forW === gm.w && gm._hex.forH === gm.h) return gm._hex;
  const cols = Math.max(1, Math.floor((gm.w - HEX_W / 2) / HEX_W) + 1);
  const rows = Math.max(1, Math.floor((gm.h - HEX_EDGE) / HEX_ROW_STEP) + 1);
  const hexes = new Array(cols * rows);
  const blds = gm.buildings || [];
  /* ★ 据点：半径从"米"改成"格"（老地图只有 r ⇒ 自动折算 rHex = r ÷ 100m） */
  const objs = gm.objectives || [];
  const objCell = objs.map(o => worldToHex(+o.x || 0, +o.y || 0));
  const objR = objs.map(o => (o.rHex != null)
    ? Math.max(1, o.rHex | 0)
    : Math.max(1, Math.round((+o.r || 300) / HEX_EDGE)));
  /* ★ 归一化：老地图只有 r（米）⇒ 算出来的 rHex 写回数据，之后一律按格 */
  for (let i = 0; i < objs.length; i++) objs[i].rHex = objR[i];

  /* ① 面积累加：每个 5m 格按**格心**归到某个六角格（与移动/视线同一套几何） */
  const ids = hexPaletteIds();
  const palN = Math.max(1, ids.length);
  const roadIdx = hexRoadIdx();
  const riverIdx = ids.indexOf('river');
  const nHex = cols * rows;
  const share = new Float64Array(nHex * palN);     // 每格：调色板各下标各占多少面积
  const area = new Float64Array(nHex);             // 每格：参与统计的总面积（地图边缘不满一格）
  const bldA = new Float64Array(nHex);             // 建筑覆盖面积
  const bldLast = new Int32Array(nHex).fill(-1);   // 去重：同一栋建筑只数一次
  const bldN = new Uint8Array(nHex);               // 覆盖该格的建筑栋数（掩体加成用）
  const cs = +gm.cellSize || 5;
  const cellA = cs * cs;
  const GW = gm.gw | 0, GH = gm.gh | 0;
  ensureComposedGrid(gm);
  const grid = gm._composedGrid;
  if (grid && GW > 0 && GH > 0) {
    for (let gy = 0; gy < GH; gy++) {
      const wy = (gy + 0.5) * cs;
      for (let gx = 0; gx < GW; gx++) {
        const p = worldToHex((gx + 0.5) * cs, wy);
        if (p.col < 0 || p.col >= cols || p.row < 0 || p.row >= rows) continue;
        const hi = p.row * cols + p.col;
        const idx = grid[gy * GW + gx] | 0;
        area[hi] += cellA;
        share[hi * palN + ((idx >= 0 && idx < palN) ? idx : 0)] += cellA;
      }
    }
  }
  /* ② 矢量建筑：同样按面积（step 取栅格尺寸 —— 建筑通常比 5m 大得多） */
  for (let bi = 0; bi < blds.length; bi++) {
    const b = blds[bi];
    const bx = +b.x || 0, by = +b.y || 0, bw = +b.w || 0, bh = +b.h || 0;
    if (bw <= 0 || bh <= 0) continue;
    const step = Math.max(cs, 5);
    for (let y = by + step / 2; y < by + bh; y += step) {
      for (let x = bx + step / 2; x < bx + bw; x += step) {
        const p = worldToHex(x, y);
        if (p.col < 0 || p.col >= cols || p.row < 0 || p.row >= rows) continue;
        const hi = p.row * cols + p.col;
        bldA[hi] += step * step;
        if (bldLast[hi] !== bi) { bldLast[hi] = bi; if (bldN[hi] < 255) bldN[hi]++; }
      }
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const c = hexCenter(col, row);
      /* 只保留格心落在地图内的格子（最右一列在奇数行会探出去半格） */
      const inside = (c.x <= gm.w + 0.5) && (c.y <= gm.h + 0.5);
      if (!inside) { hexes[i] = null; continue; }
      const A = area[i] > 0 ? area[i] : cellA;
      /* 主地形 = 面积最大的那个（路不抢主地形 —— 路是叠加属性）；平局按"硬度" */
      let terr = 'empty', best = -1, bestRank = 99;
      for (let k = 0; k < palN; k++) {
        if (k === roadIdx) continue;
        const v = share[i * palN + k];
        if (v <= 0) continue;
        const id = ids[k] || 'empty';
        const rank = hexTerrRank(id);
        if (v > best + 0.001 || (Math.abs(v - best) <= 0.001 && rank < bestRank)) {
          best = v; bestRank = rank; terr = id;
        }
      }
      if (!(terr in HEX_SIGHT)) terr = 'empty';
      /* 公路 = 叠加属性：路面面积占比 ≥ HEX_ROAD_SHARE 就算这一格有路 */
      const roadShare = roadIdx >= 0 ? (share[i * palN + roadIdx] / A) : 0;
      const road = roadShare >= HEX_ROAD_SHARE;
      /* ★ 水域同样是叠加属性：河只有 5~20m 宽，按"多数"永远打不过草地 ⇒
         单独记一个 water，让"过河"照旧按河的成本算（公路 = 桥，优先） */
      const waterShare = riverIdx >= 0 ? (share[i * palN + riverIdx] / A) : 0;
      const water = waterShare >= HEX_WATER_SHARE;
      /* 建筑占比 ⇒ 城区（比"中心点落在建筑里"更讲道理：小房子压不住一片树林） */
      const bShare = bldA[i] / HEX_AREA;
      if (bShare >= HEX_BUILD_SHARE && terr !== 'house') terr = 'house';
      /* 据点：格距 ≤ rHex（重叠时取最近的那个 —— 一格只归一个据点） */
      let obj = -1, objD = Infinity;
      for (let k = 0; k < objs.length; k++) {
        const d = hexDistance({ col, row }, objCell[k]);
        if (d <= objR[k] && d < objD) { objD = d; obj = k; }
      }
      hexes[i] = {
        col, row, x: c.x, y: c.y,
        terr, road, water, bld: bldN[i], obj,
        roadShare, waterShare, bldShare: bShare, terrShare: best > 0 ? best / A : 0,
        sight: HEX_SIGHT[terr] == null ? 0 : HEX_SIGHT[terr],
        cover: Math.min(0.6, (HEX_COVER[terr] == null ? 0 : HEX_COVER[terr]) + (bldN[i] ? 0.15 : 0)),
      };
    }
  }
  gm._hex = { ver: HEX_BAKE_VER, rev, cols, rows, hexes, forW: gm.w, forH: gm.h };
  return gm._hex;
}
/* ★ R10.36：**合并地图编辑器**保存时用 —— 把 5m 光栅 + 矢量建筑/公路/据点/出生区
   一次性烘焙成 hexData（之后兵棋直接照抄，不再现场采样）
   ------------------------------------------------------------
   · gm 必须是"光栅地图"（有 layers）；烘焙时临时把 gm.hexData 摘掉，
     否则 bakeHexMap 会走"照抄 hexData"的分支（永远算出旧结果）；
   · 出生区（多边形/矩形）→ deploy：格心落在圈里的格子归那一方 ⇒ 兵棋部署区
     就是作者画的那块地，不再按 20%/80% 硬切。
   · 返回的对象可以直接 JSON 存盘（Uint8 之类一律转成普通数字）。 */
function hexBakeToData(gm) {
  if (!gm) return null;
  const saved = gm.hexData;
  gm.hexData = null;
  gm._hex = null;
  let hx = null;
  try { hx = bakeHexMap(gm); } catch (e) { hx = null; }
  gm.hexData = saved || null;
  gm._hex = null;                       // 数据才是权威 ⇒ 下一回合重新按 hexData 建格
  if (!hx) return null;
  const cols = hx.cols, rows = hx.rows, n = cols * rows;
  const terr = new Array(n), road = new Array(n), bld = new Array(n),
        obj = new Array(n), deploy = new Array(n);
  for (let i = 0; i < n; i++) {
    const h = hx.hexes[i];
    if (!h) { terr[i] = 'empty'; road[i] = 0; bld[i] = 0; obj[i] = -1; deploy[i] = ''; continue; }
    terr[i] = h.terr || 'empty';
    road[i] = h.road ? 1 : 0;
    bld[i] = h.bld | 0;
    obj[i] = (h.obj == null ? -1 : (h.obj | 0));
    deploy[i] = '';
  }
  /* 出生区 → 部署区（蓝色先写、红色后写：真重叠时以后画的为准） */
  const sp = gm.spawns || {};
  if (typeof pointInSpawn === 'function') {
    for (const side of ['blue', 'red']) {
      const s = sp[side];
      if (!s) continue;
      for (let i = 0; i < n; i++) {
        const h = hx.hexes[i];
        if (!h) continue;
        try { if (pointInSpawn(s, h.x, h.y)) deploy[i] = side; } catch (e) {}
      }
    }
  }
  return { v: 1, cols, rows, terr, road, bld, obj, deploy };
}

function hexAt(hx, col, row) {
  if (!hx || col < 0 || row < 0 || col >= hx.cols || row >= hx.rows) return null;
  return hx.hexes[row * hx.cols + col] || null;
}
function hexOfWorld(hx, x, y) {
  const p = worldToHex(x, y);
  return hexAt(hx, p.col, p.row);
}
function hexKey(h) { return h ? (h.row * 10000 + h.col) : -1; }

/* 某格对某机动类型的移动成本（Infinity = 进不去） */
function hexMoveCost(hex, mob) {
  if (!hex) return Infinity;
  const row = MP_COST[mob] || MP_COST.foot;
  /* 公路优先：桥 / 涵洞一律按公路过 */
  if (hex.road) {
    const cr = row.road;
    return (cr == null || !isFinite(cr)) ? Infinity : cr;
  }
  /* ★ R10.23：水域是叠加属性（河太窄，按"多数"永远当不上主地形）⇒ 过河照旧按河的成本 */
  const key = (hex.water && row.river != null) ? 'river' : hex.terr;
  const c = row[key];
  return (c == null || !isFinite(c)) ? Infinity : c;
}

/* ---------- 4) 视线：沿线累计 sight ≥ 1 即遮挡 ---------- */
function hexLosBlocked(hx, a, b) {
  if (!a || !b) return true;
  const line = hexLine(a, b);
  let sum = 0;
  for (const p of line) {
    const h = hexAt(hx, p.col, p.row);
    if (!h) return true;
    sum += h.sight;
    if (sum >= 1) return true;
  }
  return false;
}

/* ---------- 5) 移动范围（Dijkstra；进入敌方 ZOC 后停） ---------- */
function hexReachable(hx, start, mp, mob, zocKeys) {
  const from = hexAt(hx, start.col, start.row);
  const cost = new Map(), came = new Map();
  if (!from) return { cost, came };
  cost.set(hexKey(from), 0);
  const q = [{ h: from, c: 0 }];
  while (q.length) {
    q.sort((a, b) => a.c - b.c);
    const cur = q.shift();
    if (cur.c > (cost.get(hexKey(cur.h)) || 0) + 1e-9) continue;
    /* ZOC：踩进敌方相邻格就停下（不能继续走） */
    if (cur.h !== from && zocKeys && zocKeys.has(hexKey(cur.h))) continue;
    for (const nb of hexNeighbors(cur.h.col, cur.h.row)) {
      const nh = hexAt(hx, nb.col, nb.row);
      if (!nh) continue;
      const step = hexMoveCost(nh, mob);
      if (!isFinite(step)) continue;
      const nc = cur.c + step;
      if (nc > mp + 1e-9) continue;
      const k = hexKey(nh);
      if (nc < (cost.get(k) == null ? Infinity : cost.get(k)) - 1e-9) {
        cost.set(k, nc); came.set(k, cur.h);
        q.push({ h: nh, c: nc });
      }
    }
  }
  return { cost, came };
}

/* ============================================================
   6) 编制 → 棋子（**基础棋子 = 班**；单兵只做明细）
   ------------------------------------------------------------
   · 步兵班：`members[]` 每人一把枪（掉人后 FLV 自动下降，不需要"掉级"规则）
   · 车辆：`kind:'veh'`，用 Km/Kf/K 三种损伤，不吃"人数"
   ============================================================ */
/* 注意：data.js 里已有同名概念 `ECHELONS`（映射对象）与 `ECHELON_ORDER`，
   这里用独立前缀，避免重复声明（本文件可单独加载） */
const HEX_ECHELONS = ['army','corps','division','brigade','regiment','battalion',
                      'company','platoon','section','squad','team','individual'];
const VEH_CATS = { armored_vehicle: 1, support: 1, aircraft: 1 };
const ART_CATS = { artillery: 1, infantry_arty: 1 };
const AT_CATS  = { at_weapon: 1, at_gun: 1 };
const SA_CATS  = { small_arms: 1 };          // 逐人配发的轻武器

function nodeSubtreeMen(node) {
  let men = 0;
  (function w(n) { men += (n.personnel || 0); (n.children || []).forEach(w); })(node);
  return men;
}
/* ---------- 装备解析：把编制里的一条装备，解析成"装备库对象" ----------
   ★ R10.6：玩家："单位的武器数据是不是还没带入武器库数值的啊"
   ------------------------------------------------------------------
   真凶：预设/老存档里的装备条目是 `{name:'突击步枪', count:15}` —— **只有名字、没有 eqId**，
        旧代码只查 `lib[e.eqId]` ⇒ 全部拿不到 ⇒ 棋子等于没枪（FLV 全 1）。
   现在的三级兜底（越靠前越"尊重玩家的库"）：
     ① eqId 命中当前装备库     → 用库里的数值（玩家改过装备库就生效）
     ② 名字命中当前装备库      → 同上（存档里的 eqId 失效/没写过也能对上）
     ③ 名字命中内置种子       → 用种子 stats 造一个**临时**对象（不写库、不污染）
     ④ 都不行                 → 记进 HEX_MISSING_EQUIP，开局时提示玩家 */
let _libNameIdx = null, _libNameIdxFor = null;
function libNameIndex(lib) {
  if (_libNameIdxFor === lib && _libNameIdx) return _libNameIdx;
  const m = new Map();
  if (lib) {
    for (const k in lib) {
      const e = lib[k];
      if (e && e.name && !m.has(e.name)) m.set(e.name, e);
    }
  }
  _libNameIdx = m;
  _libNameIdxFor = lib;
  return m;
}
const HEX_MISSING_EQUIP = [];
function takeMissingEquip() {
  const out = HEX_MISSING_EQUIP.slice();
  HEX_MISSING_EQUIP.length = 0;
  return out;
}
function resolveEquipment(lib, byName, entry) {
  if (!entry) return null;
  if (entry.eqId && lib && lib[entry.eqId]) return lib[entry.eqId];
  const nm = String(entry.name || '').trim();
  if (!nm) return null;
  const byN = byName && byName.get(nm);
  if (byN) return byN;
  if (typeof DEFAULT_EQUIPMENT_SEED !== 'undefined' && DEFAULT_EQUIPMENT_SEED) {
    const seed = DEFAULT_EQUIPMENT_SEED.find(s => s.name === nm);
    if (seed) {
      return {
        id: 'seed:' + seed.name, category: seed.category, name: seed.name,
        stats: JSON.parse(JSON.stringify(seed.stats || {})), _fromSeed: true,
      };
    }
  }
  if (HEX_MISSING_EQUIP.indexOf(nm) < 0) HEX_MISSING_EQUIP.push(nm);
  return null;
}

function nodeSubtreeItems(node, lib) {
  const map = new Map();
  const byName = libNameIndex(lib);
  (function w(n) {
    for (const e of (n.equipment || [])) {
      /* 数量：优先"实有"，没填就用"编制上限"（玩家常常只填上限） */
      const cnt = (e.count || 0) || (e.countMax || 0);
      if (!cnt) continue;
      const eq = resolveEquipment(lib, byName, e);
      if (!eq || !eq.stats) continue;
      const key = eq.id || ('n:' + (eq.name || '?'));
      const cur = map.get(key) || { eq, count: 0 };
      cur.count += cnt;
      map.set(key, cur);
    }
    (n.children || []).forEach(w);
  })(node);
  return Array.from(map.values());
}

let _counterSeq = 0;
function _mkMember(weapon, name) {
  return { alive: true, name: name || '', weapon: weapon || null,
           weapons: weapon ? [weapon] : [] };   // ★ 一人可以带多件（主武器 + 反坦克武器…）
}
/* 这件装备本身算不算"能开火的武器"
   （运输卡车 / 指挥车 / 工程车 这类没有 对人 / 穿深 / 杀伤半径 ⇒ 不发空气枪） */
function hasWeaponStats(st) {
  st = st || {};
  return (+st.antiPersonnel > 0) || (+st.penetration > 0) || (+st.lethalRadius > 0);
}

/* ★ R10.19：按**武器**给士兵起个像样的名字（面板逐人列表用）
   —— "步枪兵1 / 步枪兵2 / 机枪兵1 / 反坦克兵1 / 狙击手1"。
   同时记下 `m.role`，面板和日志都能直接用。 */
function roleNameOf(weapon) {
  const n = String((weapon && weapon.name) || '');
  const cat = weapon && weapon.cat;
  if (/机枪/.test(n)) return '机枪兵';
  if (/狙击/.test(n)) return '狙击手';
  if (/火箭|反坦克|导弹/.test(n)) return '反坦克兵';
  if (/迫击炮|榴弹炮|山炮|加农|火炮|火箭炮/.test(n) || (cat && ART_CATS[cat])) return '炮兵';
  if (/冲锋枪/.test(n)) return '冲锋枪手';
  if (/手枪/.test(n)) return '手枪兵';
  if (/步枪/.test(n)) return '步枪兵';
  return '步兵';
}
/* 给全班按"同类顺序"编号（原地改 m.name / m.role） */
function nameMembers(members) {
  const seq = {};
  for (const m of (members || [])) {
    const w = (m.weapons && m.weapons[0]) || m.weapon || null;
    const role = roleNameOf(w);
    seq[role] = (seq[role] || 0) + 1;
    m.role = role;
    m.name = role + seq[role];
  }
  return members;
}
function _weaponOf(stats, cat, name) {
  const s = stats || {};
  const ammo = (s.ammo == null ? 60 : +s.ammo);
  return {
    name: name || '', cat: cat || 'small_arms',
    antiPersonnel: +s.antiPersonnel || 0,
    antiArmor: +s.antiArmor || 0,
    penetration: +s.penetration || 0,
    range: Math.max(50, +s.range || 100),
    lethalRadius: +s.lethalRadius || 0,
    suppressRadius: +s.suppressRadius || 0,
    fireInterval: +s.fireInterval || 1,
    ammo: ammo, ammoMax: ammo,
  };
}

/* 把子树变成 1~N 个棋子 */
function makeCounters(node, side, lib, label) {
  const items = nodeSubtreeItems(node, lib);
  const vehItems = items.filter(i => VEH_CATS[i.eq.category] && (i.eq.stats.hp || i.eq.stats.armor));
  const men = nodeSubtreeMen(node);
  const out = [];
  const baseName = label || node.name || '未命名';

  /* ① 纯车辆单位 ⇒ 一辆车一个棋子（最多 4 个） */
  if (vehItems.length && men <= 4 * vehItems.reduce((a, i) => a + i.count, 0) + 2) {
    /* ★ R10.12：车辆棋子也要能带"拖曳 / 支援武器"（山炮、迫击炮、反坦克炮…）
       ------------------------------------------------------------
       玩家截图：`75mm山炮 + 运输卡车` 的炮兵阵地被当成"纯卡车"棋子 ——
       旧代码只给车辆本身配武器，山炮（artillery 类别）**被整个丢掉** ⇒ 射程表 1 格、开火打不了。
       现在：把非轻武器、非车辆的装备（= 炮/反坦克炮/火箭筒…）摊开，
             按车辆棋子**轮流分配**（每门炮一个条目，一件不丢），挂到 `supports[]`。
             `eachWeapon()` 对车辆也会遍历 supports ⇒ 射程/火力/使用武器都会算上它们。 */
    const towed = items.filter(it => !SA_CATS[it.eq.category] && !VEH_CATS[it.eq.category])
      .map(it => Object.assign(_weaponOf(it.eq.stats, it.eq.category, it.eq.name), { count: it.count }));
    const gunPile = [];
    for (const g of towed) for (let k = 0; k < (g.count || 1); k++) gunPile.push(g);
    const groups = [];
    for (const v of vehItems) {
      const n = Math.min(4, v.count);
      for (let i = 0; i < n; i++) groups.push(v);
    }
    groups.forEach((v, i) => {
      const st = v.eq.stats;
      const mpType = st.mobilityType || 'tracked';
      /* 运输卡车 / 指挥车这类**没有武器数值**的装备不再发一把"射程 100m 的空气枪"
         （旧行为：射程表恒显示 1 格，玩家以为是 bug） */
      const sups = [];
      for (let k = i; k < gunPile.length; k += groups.length) {
        sups.push(Object.assign({}, gunPile[k], { count: 1 }));
      }
      const counter = {
        id: 'c' + (++_counterSeq), side, kind: 'veh',
        name: baseName + (groups.length > 1 ? '·' + (i + 1) : ''),
        type: node.type, echelon: node.echelon,
        armor: +st.armor || 0, mpType,
        mpMax: MP_MAX[mpType] || 5, mp: MP_MAX[mpType] || 5,
        weapons: hasWeaponStats(st) ? [_weaponOf(st, v.eq.category, v.eq.name)] : [],
        supports: sups,
        items: items.map(it => ({ eq: it.eq, count: it.count })),
        km: false, kf: false, fired: false, acted: null, suppressed: false, dead: false,
        node, hex: null,
      };
      initCounterAmmo(counter);                 // ★ R10.22：车载炮/拖曳炮弹药池
      out.push(counter);
    });
    return out;
  }

  /* ② 步兵班 ⇒ 一个棋子 + 单兵明细 */
  const sa = [];
  for (const it of items) {
    if (!SA_CATS[it.eq.category] && it.eq.category !== 'misc') continue;
    for (let i = 0; i < it.count; i++) sa.push(it);
  }
  const supports = items.filter(it => !SA_CATS[it.eq.category] && !VEH_CATS[it.eq.category])
    .map(it => Object.assign(_weaponOf(it.eq.stats, it.eq.category, it.eq.name), { count: it.count }));
  /* ★ 整班一件轻武器都没有（例如只填了车/支援武器，或装备名没对上库）
     ⇒ 配"制式步枪"兜底：否则 9 个人打出去的 raw 全是 0（FLV 恒为 1），
        玩家会以为"武器数值没带进来"。 */
  if (!sa.length) {
    const byName = libNameIndex(lib);
    const fb = resolveEquipment(lib, byName, { name: '突击步枪' }) ||
               resolveEquipment(lib, byName, { name: '步枪' }) ||
               { id: 'fallback:rifle', category: 'small_arms', name: '制式步枪',
                 stats: { antiPersonnel: 10, range: 400, fireInterval: 0.3, ammo: 120 } };
    sa.push({ eq: fb, count: Math.max(1, men || 9) });
  }
  const count = Math.max(1, men || sa.length || 9);
  const memberWeaponOf = (it) => (it && it.eq)
    ? _weaponOf(it.eq.stats, it.eq.category, it.eq.name) : null;
  const members = [];
  for (let i = 0; i < count; i++) {
    const it = sa[i % sa.length];
    members.push(_mkMember(memberWeaponOf(it), '兵' + (i + 1)));
  }
  /* ★ R10.10：**枪比人多时，多出来的枪一件也不能丢**
     ------------------------------------------------------------
     旧写法是 `members[i] = sa[i % sa.length]`，而 i 只到 count-1：
       · 12 人配「栓动步枪×12 + 重机枪×1」= 13 件 ⇒ 下标 12 的重机枪**被静默丢弃**
       ⇒ 现存武器里没有重机枪、射程只按步枪算（500m）⇒ 火力表只到 5 格（玩家截图就是这个）
       ⇒（R10.9 已把射程口径统一到 eachWeapon，但枪根本没进 members，口径再对也没用）
     现在：多出来的轻武器按"一人最多带 3 件"塞给已有成员；
           实在塞不下的进 extraSA，最后并入 supports（面板显示 [支援]xxx），**绝不丢**。
     ★ R10.22：**同一个人不许拿两件一样的武器**（玩家："一个人不应该拿到重复的武器"）
       —— 玩家截图里 步枪兵1 拿了「栓动步枪 + 反坦克导弹 + 反坦克导弹」，
          根因是下面 supports 的循环用 `find(件数<3)`，同一个人会被连续选中两次。 */
  function canTake(m, w) {
    if (!m || !w) return false;
    const ws = m.weapons || [];
    if (ws.length >= 3) return false;                  // 一人最多 3 件
    const key = w.name || '?';
    return !ws.some(x => (x.name || '?') === key);      // 手上已有的不重复发
  }
  /* 挑"最能接这件武器的人"：优先手上件数最少的（摊开，不堆在第一个兵身上） */
  function holderFor(w) {
    let best = null;
    for (const m of members) {
      if (!canTake(m, w)) continue;
      if (!best || (m.weapons || []).length < (best.weapons || []).length) best = m;
    }
    return best;
  }
  const extraSA = [];
  for (let i = count; i < sa.length; i++) {
    const w = memberWeaponOf(sa[i]);
    if (!w) continue;
    const m = holderFor(w);
    if (m) m.weapons.push(w);
    else extraSA.push(Object.assign({}, w, { count: 1 }));
  }
  /* ★ R10.8：把"支援武器"（火箭筒 / 反坦克炮 / 迫击炮…）分给具体的人
     —— 每人最多再带 2 件，剩下的留在 supports（需要多人操作/集中使用）。
     好处：① 面板能看出"谁扛着什么" ② 这个人被打死了，他那具火箭筒也一起没 */
  const leftover = [];
  for (const s of supports) {
    let rest = s.count || 1;
    for (let i = 0; i < (s.count || 1); i++) {
      const m = holderFor(s);                          // ★ R10.22：不会给同一个人两件一样的
      if (!m) break;
      m.weapons.push(s);
      rest--;
    }
    if (rest > 0) leftover.push(Object.assign({}, s, { count: rest }));
  }
  /* 多出来的轻武器同样不能丢（人手不够 / 每人 3 件已满）：挂进 supports 继续参与射程与火力 */
  for (const w of extraSA) leftover.push(w);
  /* ★ R10.19：**逐人起名**（玩家："如果有，如果没有就直接根据他们的武器自动给名字，
     步枪兵1步枪兵2机枪兵1之类的"）
     —— 主武器决定兵种称呼，同类按出现顺序编号；面板据此逐人列表（阵亡后黑掉）。 */
  nameMembers(members);
  const mpType = vehItems.length ? (vehItems[0].eq.stats.mobilityType || 'tracked') : 'foot';
  const counter = {
    id: 'c' + (++_counterSeq), side, kind: 'inf',
    name: baseName,
    type: node.type, echelon: node.echelon,
    members, supports: leftover,
    items: items.map(it => ({ eq: it.eq, count: it.count })),   // 编制里的**全部装备**（面板列清单用）
    mpType, mpMax: MP_MAX[mpType] || 2, mp: MP_MAX[mpType] || 2,
    fired: false, acted: null, suppressed: false, dead: false,
    node, hex: null,
  };
  initCounterAmmo(counter);                   // ★ R10.22：火炮/掷弹筒/反坦克武器弹药池
  out.push(counter);
  return out;
}

/* 从某方编制的根节点生成全部棋子 */
function buildCounters(root, side, targetEchelon) {
  if (!root) return [];
  const lib = (typeof getEquipmentLibrary === 'function') ? getEquipmentLibrary() : {};
  const wantIdx = HEX_ECHELONS.indexOf(targetEchelon || 'squad');
  const out = [];
  /* ★ R10.2：一路带着**上级链**（根 → 叶），棋子要按"旅/团/连/排/班"写番号 */
  (function walk(node, isRoot, path) {
    if (!node) return;
    const here = path.concat([{ name: node.name || '', echelon: node.echelon || '' }]);
    const idx = HEX_ECHELONS.indexOf(node.echelon);
    const isTarget = !isRoot && idx >= wantIdx && idx >= 0;
    if (isTarget) {
      const list = makeCounters(node, side, lib);
      list.forEach(c => { c.path = here; });
      out.push.apply(out, list);
      return;
    }
    (node.children || []).forEach(c => walk(c, false, here));
  })(root, true, []);
  /* 兜底：整份编制就是一层（比如存档里只有一个"连"，而玩家选的粒度是"班"），
     或者粒度过粗 ⇒ 至少把它当成一个棋子，别给玩家一张空棋盘。 */
  if (!out.length) {
    const list = makeCounters(root, side, lib);
    const only = [{ name: root.name || '', echelon: root.echelon || '' }];
    list.forEach(c => { c.path = only; });
    out.push.apply(out, list);
  }
  return out;
}

/* ---------- 7) FLV（火力等级）：装备库 → 1~12 级 ---------- */
const FLV_MAX = 12;
const DIE_FACTOR = [0.35, 0.50, 0.60, 0.70, 0.85, 1.00, 1.15, 1.30, 1.45, 1.60, 1.80];
/* 标定：raw = 这个值 ⇒ 正好 12 级（先钉死 CRT 顶格，再反推射程表）
   ------------------------------------------------------------
   ★ R10.7：hard 从 2000 改成 **264** —— 因为穿深换成**真实毫米**了：
     · M4A3 的 75mm 炮 @500m ≈ 66mm  ⇒ FLV = 12·√(66/264) ≈ 6   （中坦主炮的"标准强度"）
     · 虎式 88mm   @500m ≈ 120mm     ⇒ FLV ≈ 8
     · 现代 120/125mm APFSDS ≈ 400mm ⇒ FLV 顶格 12
     · 单兵火箭筒 ≈ 100mm（破甲）    ⇒ FLV ≈ 7
   soft 仍是 520（班≈5 / 排≈9 / 连=12），art 仍是 270。 */
const RAW12 = { soft: 520, hard: 264, art: 270 }; 
/* 地形对**守方**的 FLV 惩罚（CRT 整列左移，不另设"防御值"）
   —— 第一版给的是 −3/−2，实测"1 个班打树林里的 1 个班"几乎全是"无效果"，
      所以收敛到 −1/−2：一档 FLV 已经等于 CRT 上跨一个结果档，够重了。 */
const FLV_TERR_PENALTY = { empty:0, road:0, forest:1, hill:1, house:2, river:1, trench:1, wall:1, swamp:0 };

/* ============================================================
   ★ R10.36：**建筑 / 碉堡**（玩家定案）
   ------------------------------------------------------------
   玩家的原话：
     "建筑就改为放置在格内，然后将建筑会被损坏的效果移除，改为初始放置在地图上的为中立建筑，
      然后双方的工兵可以花费 3 回合修建碉堡，前提是必须不处于 ezoc 且没有被攻击的情况下，
      一旦被攻击或处于 ezoc 就会被打断，然后由双方工兵修建的碉堡为非中立碉堡，
      非中立碉堡在被敌方单位进驻时会自动销毁，单位进驻碉堡时会获得防御加成"
   落实成 4 条规则（都在本文件里，UI 只读）：
     ① 地图上**开局就有**的建筑 ⇒ 中立建筑（side = ''）：谁都能进驻、永远炸不坏；
     ② 工兵花 BUNKER_TURNS 个回合在脚下这一格修碉堡，施工期间
        **不能被敌方 ZOC 覆盖、也不能挨打**，否则当场打断（进度清零）；
     ③ 敌方单位**进驻**自己修的碉堡 ⇒ 碉堡自动销毁（不给敌人白捡工事）；
     ④ 站在建筑/碉堡里 ⇒ 守方 FLV 降档（defTerrShift）。
   ※ 建筑本身**没有 HP**：这张兵棋里它们不会被打坏（"损坏效果移除"）。
   ============================================================ */
const BUNKER_TURNS = 3;      // 修一座碉堡要几个回合
const BUNKER_FLV = 3;        // 碉堡：守方 FLV 降 3 档（比城区还硬）
const BUILDING_FLV = 2;      // 中立建筑：至少按"城区"算
const BLD_NEUTRAL = '';      // side = '' ⇒ 中立（地图上原有的建筑）

/* 现在是不是"工兵"（编制里的兵种类型；机步工兵也算） */
function isEngineer(c) {
  const t = String((c && (c.type || (c.node && c.node.type))) || '');
  return /engineer/.test(t);
}
function bldKeyOf(hex) { return hex ? (hex.row * 10000 + hex.col) : -1; }

/* 开局：把地图上的建筑全部登记成**中立**（hex.bld > 0 = 有矢量建筑，或地形就是城区） */
function initBuildings(hx) {
  const map = new Map();
  if (!hx || !hx.hexes) return map;
  for (const h of hx.hexes) {
    if (!h) continue;
    if ((h.bld | 0) > 0 || h.terr === 'house') {
      map.set(bldKeyOf(h), { side: BLD_NEUTRAL, kind: 'building', t: 0, by: '' });
    }
  }
  return map;
}
/* 这一格上的工事（没有 ⇒ null） */
function bldAt(map, hex) { return (map && hex) ? (map.get(bldKeyOf(hex)) || null) : null; }
/* 能不能在这里开工（工兵修碉堡）：空地、没有建筑、不在水上 */
function canBuildHere(map, hex) {
  if (!hex) return { ok: false, why: '地图外' };
  const b = bldAt(map, hex);
  if (b) return { ok: false, why: (b.kind === 'bunker' ? '这一格已经有碉堡了' : '这一格有建筑（直接进驻就行）') };
  if (hex.terr === 'river' || hex.water) return { ok: false, why: '水上/河上修不了' };
  return { ok: true, why: '' };
}
/* 守方地形修正：地形本身 + 建筑/碉堡**取大者**（不重复叠加两次） */
function defTerrShift(hex, bld) {
  let tp = FLV_TERR_PENALTY[(hex && hex.terr) || 'empty'] || 0;
  if (bld) tp = Math.max(tp, bld.kind === 'bunker' ? BUNKER_FLV : BUILDING_FLV);
  return tp;
}
/* 修碉堡的"这一回合能不能继续施工"（纯函数，wargame 每回合末问一次）
   zocKeys = 敌方 ZOC 格（zocKeysFor(...)）；hit = 这名工兵本回合挨过打 */
function buildTick(bld, hex, zocKeys, hit) {
  if (!bld || bld.kind !== 'site') return { ok: false, why: '这里没有在修的碉堡' };
  if (!hex) return { ok: false, why: '地图外' };
  if (zocKeys && zocKeys.has(bldKeyOf(hex))) return { ok: false, why: '处于敌方 ZOC' };
  if (hit) return { ok: false, why: '遭到攻击' };
  bld.t = (bld.t | 0) + 1;
  if (bld.t >= BUNKER_TURNS) { bld.kind = 'bunker'; return { ok: true, done: true, left: 0 }; }
  return { ok: true, done: false, left: BUNKER_TURNS - bld.t };
}

function falloffSoft(d, R) {
  const r = Math.max(1, R || 1);
  if (d >= r) return 0;                       // 超出射程：打不到
  return Math.max(0, 1 - Math.pow(d / r, 1.6));
}
function falloffHard(d, R) {
  const r = Math.max(1, R || 1);
  if (d >= r) return 0;
  return Math.max(0, 1 - 0.45 * Math.pow(d / r, 1.2));
}

/* ---------- 穿深随距离衰减（真实曲线，R10.7） ----------
   旧的 `falloffHard` 是"按射程比例衰减一半"，和真实数据对不上：
   75mm M3 在 500m 能穿 66mm、1000m 60mm、1500m 55mm、2000m 50mm
   —— 也就是**绝对距离**决定，而不是"占最大射程的百分比"。
   下面这张表按真实 AP/APCBC 的保留率标定（0m = 1.00），中间线性插值。
   ★ 破甲战斗部（火箭筒/反坦克导弹）**不随距离衰减**（HEAT 靠化学能）。 */
const PEN_CURVE = [
  [0, 1.00], [250, 0.96], [500, 0.92], [750, 0.88], [1000, 0.84],
  [1500, 0.76], [2000, 0.68], [2500, 0.61], [3000, 0.55], [4000, 0.45], [5000, 0.38],
];
const HEAT_CATS = { at_weapon: 1 };     // 单兵火箭筒 / 反坦克导弹 = 破甲（HEAT）

function penCurveAt(dM) {
  if (!(dM > 0)) return 1;
  const t = PEN_CURVE;
  for (let i = 1; i < t.length; i++) {
    if (dM <= t[i][0]) {
      const d0 = t[i - 1][0], r0 = t[i - 1][1], d1 = t[i][0], r1 = t[i][1];
      return r0 + (r1 - r0) * (dM - d0) / (d1 - d0);
    }
  }
  return t[t.length - 1][1];
}
/* 某件武器在 distM 米处的实际穿深（mm）；0 = 打不到 */
function penAt(w, distM) {
  if (!w) return 0;
  const pen = +w.penetration || 0;
  if (!(pen > 0)) return 0;
  const rng = Math.max(1, +w.range || 0);
  if (distM > rng) return 0;            // 超出武器射程
  if (HEAT_CATS[w.cat]) return pen;     // 破甲弹：穿深与距离无关
  return pen * penCurveAt(distM);
}

/* ★ kind 归一：`'at'`（CRT 表名）与 `'hard'`（火力键名）指同一件事。
   以前 resolveFire 传 'at'、表里只认 'hard' ⇒ 掉进默认分支用**对人员**火力，
   造成"射程表显示 6、开火判定 1、2D6 全无效"。 */
function rawKey(kind) {
  if (kind === 'hard' || kind === 'at') return 'hard';
  if (kind === 'art') return 'art';
  return 'soft';
}

/* 武器用途：决定"打哪种目标时用它"
   —— at = 专职反装甲（火箭筒 / 反坦克炮 / 坦克炮）；soft = 通用/打人 */
function weaponRole(w) {
  if (!w) return 'soft';
  const ap = +w.antiPersonnel || 0;
  const pen = +w.penetration || 0;
  if (pen >= 30 && ap < pen * 0.5) return 'at';
  return 'soft';
}

/* 一个棋子在 distHex 上的"原始火力点数"
   ------------------------------------------------------------
   ★ R10.8：按**目标类型**挑武器（玩家："攻击对应类型的单位时使用对应类型的武器"）
     · 打软目标 → 只用"通用/打人"武器（不会把反坦克火箭筒当步枪用）
     · 打硬目标 → 只用带穿深的武器
     · 间瞄(art) → 只用火炮的杀伤半径
     kind 省略时（算总量/表格用）软硬都算，保持旧行为。 */
function counterRaw(c, distHex, kind) {
  const d = Math.max(0, distHex || 0) * HEX_EDGE;
  const k = kind ? rawKey(kind) : null;
  let soft = 0, hard = 0, art = 0;

  const addSoft = (w, n, allowAT) => {
    if (!w || ART_CATS[w.cat]) return;
    if (!weaponHasAmmo(c, w)) return;              // ★ R10.22：弹尽的武器不出力
    if (!allowAT && weaponRole(w) === 'at') return;
    soft += (+w.antiPersonnel || 0) * n * falloffSoft(d, w.range);
  };
  const addHard = (w, n) => {
    if (!w || ART_CATS[w.cat]) return;
    if (!weaponHasAmmo(c, w)) return;              // ★ R10.22
    if (!(+w.penetration > 0)) return;
    hard += penAt(w, d) * n;
  };
  const addArt = (w, n) => {
    if (!w || !ART_CATS[w.cat]) return;
    if (!weaponHasAmmo(c, w)) return;              // ★ R10.22
    art += (+w.lethalRadius || 0) * n;
  };

  const wantSoft = (k === null || k === 'soft');
  const wantHard = (k === null || k === 'hard');
  const wantArt  = (k === null || k === 'art');

  if (c.kind === 'veh') {
    /* 车辆：主炮两用（HE 打人 + AP 打装甲），不做用途筛选。
       ★ R10.12：改走 eachWeapon() ⇒ 车辆挂的**拖曳炮/支援武器**（supports）也一起算
         （旧代码只遍历 c.weapons，炮兵阵地里的山炮永远 raw=0 ⇒ 炮击 FLV 恒 1） */
    eachWeapon(c, (w, n) => {
      if (wantArt) addArt(w, n);
      if (wantSoft) addSoft(w, n, true);
      if (wantHard) addHard(w, n);
    });
    if (c.kf) { soft *= 0.5; hard *= 0.5; }
  } else {
    eachWeapon(c, (w, n) => {
      if (wantArt) addArt(w, n);
      if (wantSoft) addSoft(w, n, false);
      if (wantHard) addHard(w, n);
    });
  }
  return { soft, hard, art };
}

/* 本次判定实际用到的武器（给面板显示"用什么东西打的"） */
function counterUsedWeapons(c, distHex, kind) {
  const d = Math.max(0, distHex || 0) * HEX_EDGE;
  const k = rawKey(kind);
  const map = new Map();
  const bump = (w, n) => {
    if (!w) return;
    const key = w.name || '?';
    const cur = map.get(key) || { name: key, count: 0, pen: w.penetration || 0,
                                  ap: w.antiPersonnel || 0, range: w.range || 0,
                                  ammo: null, limited: weaponUsesAmmo(w) };
    cur.count += (n || 1);
    cur.pen = Math.max(cur.pen, w.penetration || 0);
    cur.ap = Math.max(cur.ap, w.antiPersonnel || 0);
    if (cur.limited && c && c.ammo && c.ammo[key] != null) cur.ammo = c.ammo[key];
    map.set(key, cur);
  };
  const take = (w, n) => {
    if (!w) return;
    if (!weaponHasAmmo(c, w)) return;              // ★ R10.22：没弹的不算"本次使用"
    if (ART_CATS[w.cat]) { if (k === 'art') bump(w, n); return; }
    if (k === 'hard') { if (+w.penetration > 0 && penAt(w, d) > 0) bump(w, n); return; }
    if (weaponRole(w) === 'at') return;          // 反装甲武器不用于打人
    if ((+w.antiPersonnel || 0) > 0 && falloffSoft(d, w.range) > 0) bump(w, n);
  };
  /* ★ R10.12：车辆也走 eachWeapon（= 车载武器 + 拖曳/支援武器），口径只留一个 */
  eachWeapon(c, (w, n) => take(w, n));
  return Array.from(map.values());
}

/* raw → FLV（1~12）：√ 压缩 ⇒ 1 个班打不到 12 级，连/排集火才顶格 */
function flvFromRaw(raw, kind) {
  if (!(raw > 0)) return 1;
  const ref = RAW12[kind] || RAW12.soft;
  const v = FLV_MAX * Math.sqrt(raw / ref);
  return Math.max(1, Math.min(FLV_MAX, Math.round(v)));
}
/* 这个棋子在某距离上对某类目标的 FLV（含压制减半） */
function counterFlv(c, distHex, kind) {
  const raw = counterRaw(c, distHex, kind);      // ★ 按目标类型筛武器
  const key = rawKey(kind);
  let flv = flvFromRaw(raw[key], key);
  if (c.suppressed) flv = Math.max(1, Math.round(flv / 2));
  return flv;
}
/* 同上，但"完全打不到"时返回 null（火力表里显示 —，而不是误导性的 1） */
function flvAt(c, distHex, kind) {
  const raw = counterRaw(c, distHex, kind);
  const key = rawKey(kind);
  if (!(raw[key] > 0)) return null;
  return counterFlv(c, distHex, kind);
}
/* ============================================================
   ★ R10.9：遍历武器只留**一个口径**
   ------------------------------------------------------------
   踩过的坑：R10.8 把"一人多武器"引进 members[].weapons 之后，
   `counterRaw` 改了、`counterRangeHex` / `counterPenetration` 忘了改（还看 m.weapon），
   结果"反坦克导弹×2 / 重机枪"这些被分给具体士兵的武器**不参与射程与穿深**：
     · 射程表只到 5 格（步枪 500m），导弹的 4000m 没了
     · 打 600m 外的坦克直接被判"超出射程"
     · 穿深只算主武器 ⇒ 反装甲降档算错
   现在所有地方都走 eachWeapon()，新增武器来源只改这一处。
   ============================================================ */
function eachWeapon(c, fn) {
  if (!c) return;
  if (c.kind === 'veh') {
    for (const w of (c.weapons || [])) fn(w, 1);
    /* ★ R10.12：车辆同样能带拖曳/支援武器（山炮、迫击炮、反坦克炮…）
       —— 炮兵阵地就是"卡车 + 炮"，这里漏掉它，炮就等于不存在。 */
    for (const s of (c.supports || [])) fn(s, s.count || 1);
    return;
  }
  for (const m of (c.members || [])) {
    if (!m.alive) continue;
    const ws = m.weapons || (m.weapon ? [m.weapon] : []);   // 兼容老数据
    for (const w of ws) fn(w, 1);
  }
  for (const s of (c.supports || [])) fn(s, s.count || 1);
}

/* ============================================================
   ★ R10.22：**弹药**（只给"有限弹药"的武器算：火炮 / 迫击炮 / 掷弹筒 / 枪榴弹 /
   反坦克武器 / 车载火炮；**步枪、机枪、手枪不管**——玩家："步兵步枪机枪的弹药就算了"）
   ------------------------------------------------------------
   · 每件有限弹药武器按 `stats.ammo × 件数` 汇成一个**按名字计数**的池子：
       c.ammo = { '75mm山炮': 60, '反坦克导弹': 12, ... }
     池子挂在棋子上（不是武器对象上）：支援武器会被多个成员共享引用，
     挂在武器上会出现"同一个弹夹被算好几份 / 漏算"。
   · 一次射击 = 每件**实际参与**的有限武器各消耗 1 发（`consumeAmmo`）。
   · 弹尽的武器不再出力（`counterRaw` / `counterPenetration` / `counterUsedWeapons` 都跳过）
     ⇒ "火箭筒打光了" = 反装甲 FLV 掉下来；"炮打光了" = 直接开不了火。
   ============================================================ */
const NO_AMMO_CATS = { small_arms: 1, misc: 1 };   // 无限弹药
function weaponUsesAmmo(w) {
  return !!(w && w.name && !NO_AMMO_CATS[w.cat]);
}
/* 这件武器现在还打得出弹药吗（没有池子 / 没登记 = 不卡，兼容老数据） */
function weaponHasAmmo(c, w) {
  if (!c || !weaponUsesAmmo(w)) return true;
  if (!c.ammo) return true;
  const left = c.ammo[w.name];
  if (left == null) return true;
  return left > 0;
}
/* 建棋子时汇总弹药（makeCounters 两个分支都调用） */
function initCounterAmmo(c) {
  const pool = {};
  eachWeapon(c, (w, n) => {
    if (!weaponUsesAmmo(w)) return;
    const per = Math.max(1, Math.round(+w.ammo || 0));
    pool[w.name] = (pool[w.name] || 0) + per * Math.max(1, n || 1);
  });
  c.ammo = pool;
  c.ammoMax = Object.assign({}, pool);
  return pool;
}
/* 消耗：返回 [{ name, left }]（给战报用） */
function consumeAmmo(c, distHex, kind) {
  if (!c || !c.ammo) return [];
  const out = [];
  for (const u of counterUsedWeapons(c, distHex, kind)) {
    const left = c.ammo[u.name];
    if (left == null || left <= 0) continue;
    c.ammo[u.name] = left - 1;
    out.push({ name: u.name, left: c.ammo[u.name] });
  }
  return out;
}
/* 这次射击是不是"只因为没弹才打不了"（不要误伤'没有合适武器'的判定） */
function ammoBlocked(c, distHex, kind) {
  if (!c || !c.ammo) return false;
  let anyLive = false, anyDry = false;
  eachWeapon(c, (w) => {
    if (!weaponUsesAmmo(w)) return;
    const left = c.ammo[w.name];
    if (left == null) return;
    if (left > 0) anyLive = true; else anyDry = true;
  });
  if (!anyDry || anyLive) return false;          // 还有别的能打
  const raw = counterRaw(c, distHex, kind);
  return !(raw[rawKey(kind)] > 0);               // 剩下的（步枪）也打不出这张表
}
function dryAmmoText(c) {
  if (!c || !c.ammo) return '';
  return Object.keys(c.ammo).filter(n => !(c.ammo[n] > 0)).join('、');
}

/* 直射射程（格）：取**全部武器**里最远的那件（间瞄火炮不算直射）。
   ★ R10.5：**不再封顶 6 格** —— 玩家："有些坦克实际射程非常高，只有 500m 甚至都展示不出来衰减的火力"。
     现在按 `floor(射程/HEX_EDGE)` 算真实格数（坦克 3000m = 30 格），
     UI 层再按地图实际尺寸标注"超出地图"。 */
function counterRangeHex(c) {
  let best = 0;
  eachWeapon(c, (w) => {
    if (!w || ART_CATS[w.cat]) return;
    best = Math.max(best, w.range || 0);
  });
  return Math.max(0, Math.floor(best / HEX_EDGE));
}
/* 反装甲穿深（取最强的一件，已按**真实距离曲线**衰减；HEAT 不衰减） */
function counterPenetration(c, distHex) {
  const d = Math.max(0, distHex || 0) * HEX_EDGE;
  let best = 0;
  eachWeapon(c, (w) => {
    if (!w) return;
    if (!weaponHasAmmo(c, w)) return;              // ★ R10.22：弹尽的火箭筒不再提供穿深
    best = Math.max(best, penAt(w, d));
  });
  return best;
}

/* ============================================================
   ★ R10.12：**间瞄（火炮）** —— 射程 / 选表 / 视线
   ------------------------------------------------------------
   玩家截图：`75mm山炮（射程 9000m）` 的炮兵阵地「射程 1 格、对人员 —、反装甲 —」、
             点敌人也打不了。
   三处都没接上：
     ① 装备根本没进棋子（车辆分支把山炮丢了）—— 见 makeCounters ①
     ② `counterRangeHex()` 只算直射（跳过了火炮）⇒ 射程判 0/1 格
     ③ 开火只分"反装甲 / 反人员"，**炮击表 art 从来没人用过**，视线也照旧要通
   现在：
     · `counterArtRangeHex()` = 最远的**火炮**能打多少格
     · `counterMaxRangeHex()` = 直射与间瞄取大者（射击许可 / 射程表 / 面板用）
     · `fireKindFor()` 决定查哪张表：硬目标→at；软目标能直射→soft，否则有炮→art
       （art 是间瞄：**不需要视线**，只要距离够）
   ============================================================ */
function counterArtRangeHex(c) {
  let best = 0;
  eachWeapon(c, (w) => {
    if (!w || !ART_CATS[w.cat]) return;
    best = Math.max(best, w.range || 0);
  });
  return Math.max(0, Math.floor(best / HEX_EDGE));
}
/* 这个棋子"够得着多远"（直射与间瞄取大者） */
function counterMaxRangeHex(c) {
  return Math.max(counterRangeHex(c), counterArtRangeHex(c));
}
/* 打这个目标该查哪张表（预览与结算共用，不许各算各的） */
function fireKindFor(atk, def, dist, los) {
  if (!atk) return 'soft';
  if (def && def.kind === 'veh') return 'at';          // 硬目标只走反装甲表
  const directOk = (dist <= counterRangeHex(atk)) && (los !== false);
  if (directOk) return 'soft';
  const art = counterArtRangeHex(atk);
  if (art > 0 && dist <= art) return 'art';            // 直射打不到 ⇒ 用炮（间瞄）
  return 'soft';
}

/* ============================================================
   ★ R10.20：**临机射击（机会射击）**
   ------------------------------------------------------------
   玩家："p1即可，我觉得不用设定次数上限，就只是每个单位移动时会触发一次就好了"
   ⇒ 规则：
     · 敌方棋子**移动途中**，任何"看得见它 + 直射射程够"的棋子自动打一发；
     · **同一个守方棋子，对同一次移动只触发一次**（不是每格一次；也不限每回合次数）；
     · 反应射击**不消耗**行动权（玩家明确不要次数上限 ⇒ 也不占用它自己回合的行动）；
     · 只有**直射**武器能临机：`counterRangeHex > 0`，炮兵（间瞄）自然被排除；
     · 火力 FLV **−1**（仓促射击），由 resolveFire 的 `opts.flvPenalty` 统一折算，
       保证"预览/结算/面板"只有一个口径。
   ============================================================ */
const OPP_FIRE_FLV_PENALTY = 1;

/* 这个射手能不能对"走到 hex 的那个敌人"打一发（纯判定，不结算） */
function opportunityShotFor(hx, shooter, hex, targetSide, targetKind) {
  if (!hx || !shooter || !hex || !shooter.hex) return null;
  if (shooter.dead) return null;
  if (targetSide && shooter.side === targetSide) return null;
  const rng = counterRangeHex(shooter);          // 只有直射武器（炮兵=0 ⇒ 自动排除）
  if (!(rng > 0)) return null;
  const d = hexDistance(shooter.hex, hex);
  if (d < 1 || d > rng) return null;
  if (hexLosBlocked(hx, shooter.hex, hex)) return null;
  const kind = (targetKind === 'veh') ? 'at' : 'soft';
  if (ammoBlocked(shooter, d, kind)) return null;   // ★ R10.22：没弹就别临机了
  return { dist: d, kind };
}

/* 走这条路径会吃到哪些临机射击（**纯函数**，可离线测）
   返回 [{ step, shooter, dist, kind }]，step = 路径下标（1..n），按 step 排序。 */
function opportunityTriggers(hx, counters, mover, path, side) {
  const out = [];
  if (!hx || !mover || !path || path.length < 2) return out;
  const used = new Set();
  for (let i = 1; i < path.length; i++) {
    const at = path[i];
    for (const s of (counters || [])) {
      if (!s || s === mover || s.dead || s.side === side || used.has(s.id)) continue;
      const chk = opportunityShotFor(hx, s, at, side, mover.kind);
      if (!chk) continue;
      used.add(s.id);                     // 同一次移动只触发一次（不是每格一次）
      out.push({ step: i, shooter: s, dist: chk.dist, kind: chk.kind });
    }
  }
  out.sort((a, b) => a.step - b.step);
  return out;
}


/* ============================================================
   8) 三张**固定 CRT**（骨架统一： eff = FLV × DIE_FACTOR[2D6]）
   ------------------------------------------------------------
   表只差"阈值" ⇒ ① 骰点越大绝不会更差 ② FLV 越高绝不会更差
   ------------------------------------------------------------
   软目标： —  S   K   2K   3K     （K/2K/3K = 毙 1/2/3 人）
   硬目标： —  S   Km  Kf   K      （动力坏 / 武器坏 / 击毁）
   炮击  ： —  S   K   2K   3K     （间瞄，阈值更宽松）
   ============================================================ */
const CRT_RULES = {
  soft: [[3, '—'], [5, 'S'], [8, 'K'], [11, '2K'], [Infinity, '3K']],
  at:   [[2, '—'], [3.5, 'S'], [5.5, 'Km'], [8, 'Kf'], [Infinity, 'K']],
  art:  [[3, '—'], [5, 'S'], [7, 'K'], [10, '2K'], [Infinity, '3K']],
};

function crtEff(flv, roll) {
  const r = Math.max(2, Math.min(12, Math.round(roll)));
  return flv * DIE_FACTOR[r - 2];
}
/* ★ R10.11：三张表整体**向下平移一格**，顶上补一行
   ------------------------------------------------------------
   玩家："火力值为 1 的话也应该能够打出战果啊，调整一下那三张表格，
          直接将现在的数值向下平移然后再加一行就好了"
   旧：eff = FLV × DIE_FACTOR ⇒ FLV 1 最高只有 1.8，连 soft 的最低档 3 都够不到
       ⇒ 整行「—」，打也白打。
   现在：查表前先把 FLV + 1（crtRowFlv）：
     · 表里 FLV n 这一行 = 旧表 FLV n+1 那一行  ← 就是"数值向下平移一格"
     · 旧表 FLV 12 落到 FLV 11；顶上补出的新 FLV 12 行 = 13 × DIE_FACTOR
     · FLV 1 现在：对人员/炮击 2D6 11~12 压制（S），反装甲 12 点打坏机动（Km）
   ★ 骨架仍是 eff = FLV × DIE_FACTOR（不许另写公式）；偏移只写在 crtRowFlv() 一处，
     查表 crtLookup() 与展示/结算 resolveFire().eff 共用 crtEffRow()，不许各算各的。 */
const CRT_ROW_SHIFT = 1;
function crtRowFlv(flv) { return Math.max(1, Math.round(flv || 0)) + CRT_ROW_SHIFT; }
function crtEffRow(flv, roll) { return crtEff(crtRowFlv(flv), roll); }
/* 查表：eff 落在哪个档位 */
function crtLookup(kind, flv, roll) {
  const rules = CRT_RULES[kind] || CRT_RULES.soft;
  const eff = crtEffRow(flv, roll);
  for (const [max, code] of rules) if (eff < max) return code;
  return rules[rules.length - 1][1];
}
/* 结果代号的中文说明（同一个 K 在两张表里含义不同） */
function crtCodeLabel(kind, code) {
  if (code === '—') return '无效果';
  if (code === 'S') return '压制（该单位下回合火力减半）';
  if (kind === 'at') {
    if (code === 'Km') return '机动损坏（MP 减半）';
    if (code === 'Kf') return '武器损坏（火力减半）';
    if (code === 'K') return '击毁';
  }
  if (code === 'K') return '毙 1 人';
  if (code === '2K') return '毙 2 人';
  if (code === '3K') return '毙 3 人';
  return code;
}
/* 该档位会干掉几个人 */
function crtKills(code) {
  if (code === 'K') return 1;
  if (code === '2K') return 2;
  if (code === '3K') return 3;
  return 0;
}
/* 2D6 概率分布（UI 显示胜率用） */
function diceDist() {
  const cnt = new Array(13).fill(0);
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) cnt[a + b]++;
  return cnt.map(n => n / 36);
}
function roll2d6() {
  return 1 + Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6);
}

/* ---------- 9) 一次射击：能不能打 → 判定 → 落结果 ---------- */
function fireSituation(hx, atk, def) {
  const dist = hexDistance(atk.hex, def.hex);
  const los = !hexLosBlocked(hx, atk.hex, def.hex);
  /* ★ R10.12：射程 = 直射与间瞄取大者；选表与结算共用 fireKindFor() */
  const kind = fireKindFor(atk, def, dist, los);
  const range = counterMaxRangeHex(atk);
  let why = '';
  if (!atk.hex || !def.hex) why = '未部署';
  else if (atk.dead) why = '已被消灭';
  else if (def.dead) why = '目标已被消灭';
  else if (atk.acted === 'move') why = '本回合已移动（移动/攻击二选一）';
  else if (atk.acted === 'build') why = '本回合在修碉堡';
  else if (atk.acted === 'fire' || atk.fired) why = '本回合已射击';
  else if (dist < 1) why = '同一格内';
  else if (dist > range) why = '超出射程（' + range + ' 格）';
  /* 间瞄（炮击）不看视线 —— 只要距离够就能打 */
  else if (kind !== 'art' && !los) why = '视线被遮挡（没有火炮可间瞄）';
  /* ★ R10.22：弹尽（火炮打完 / 火箭筒打完且只剩步枪打不了这张表） */
  else if (ammoBlocked(atk, dist, kind)) why = '弹药耗尽（' + dryAmmoText(atk) + '）';
  return { ok: !why, why, dist, range, los, kind };
}

function resolveFire(hx, atk, def, opts) {
  opts = opts || {};
  const dist = hexDistance(atk.hex, def.hex);
  const los = (hx && atk && atk.hex && def && def.hex)
    ? !hexLosBlocked(hx, atk.hex, def.hex) : true;
  /* ★ R10.12：预览与结算必须**同一次选表**（旧代码结算处写死 soft ⇒ 炮击预览成炮击、结算成反人员） */
  const kind = opts.kind || fireKindFor(atk, def, dist, los);
  const roll = (opts.roll == null) ? roll2d6() : opts.roll;
  const notes = [];
  let flv = counterFlv(atk, dist, kind);
  /* ★ R10.20：临机射击是"仓促射击" ⇒ FLV 降档（唯一口径：预览/结算都走这里） */
  const flvPen = Math.max(0, opts.flvPenalty || 0);
  if (flvPen) { flv = Math.max(1, flv - flvPen); notes.push('仓促射击 → FLV −' + flvPen); }
  if (kind === 'art') notes.push('炮击（间瞄，不看视线）');
  if (atk.suppressed) notes.push('射手被压制 → FLV 减半');
  /* 反装甲：按**穿深 / 装甲比**分 5 档
     （换成真实毫米数值后，才分得出"谢尔曼打谢尔曼"和"谢尔曼打虎式"的差距） */
  if (kind === 'at' && (def.armor || 0) > 0) {
    const pen = counterPenetration(atk, dist);
    const arm = def.armor;
    const r = pen / arm;
    const tier = (r >= 2) ? 1 : (r >= 1.2) ? 0 : (r >= 0.9) ? -1 : (r >= 0.6) ? -2 : -3;
    if (tier > 0) flv = Math.min(FLV_MAX, flv + tier);
    else if (tier < 0) flv = Math.max(1, flv + tier);
    notes.push('穿深 ' + Math.round(pen) + 'mm / 装甲 ' + Math.round(arm) + 'mm' +
               (tier === 0 ? ' → 不修正' : (tier > 0 ? ' → FLV+' + tier : ' → FLV' + tier)));
  }
  /* 守方地形：整列左移（不另设"防御值"）
     ★ R10.36：建筑/碉堡也算进来（取大者：城区 2 / 中立建筑 2 / 碉堡 3），
        `opts.bld` 由调用方（hex-wargame）从 W.bld 里查出来传进来。 */
  const terr = (def.hex && def.hex.terr) || 'empty';
  const bld = (opts.bld !== undefined) ? opts.bld : null;
  const tp = defTerrShift(def.hex, bld);
  if (tp) {
    flv = Math.max(1, flv - tp);
    notes.push((bld ? (bld.kind === 'bunker' ? '碉堡' : '建筑') + '掩体' : '目标地形') +
               ' → FLV−' + tp);
  }
  let code = crtLookup(kind, flv, roll);
  /* ★ R10.14：**装甲目标不会被压制**（玩家："坦克应该是不会被压制住的"）
     ⇒ 反装甲表里的 S 对车辆算"无效果"。改在这里而不是改表：
       三张 CRT 是冻结的骨架（别的目标还要用 S），只把"谁吃压制"这条规则说清楚。 */
  if (code === 'S' && !suppressible(def)) {
    code = '—';
    notes.push('装甲目标不会被压制 → 无效果');
  }
  return {
    dist, kind, roll, flv, code, terr,
    label: crtCodeLabel(kind, code),
    eff: crtEffRow(flv, roll),
    usedWeapons: counterUsedWeapons(atk, dist, kind),   // ★ 这次到底用了哪些武器
    notes, atkId: atk.id, defId: def.id,
  };
}

/* ============================================================
   ★ R10.15：**间瞄散布**（玩家："给炮兵增加散布功能，炮弹落点有概率
   飘散到周围六格的任意一格，然后对落点造成杀伤"）
   ------------------------------------------------------------
   只有**炮击（kind='art'，间瞄）**才会散：直射打的是你瞄的那一格。
   散不散 → `ART_SCATTER_CHANCE`；散到哪 → 目标格的六个邻居里**均匀随机**一个
   （只挑地图上存在的格子）。落点由调用方（hex-wargame）决定打谁：
     · 落点有棋子 → 对**落点上的棋子**重新结算一次（地形/压制都按它算）
     · 落点是空格 → 这一炮白打（"偏弹"）
   ★ 机会值只写在这一个常量里，UI 只读它显示（不许各写一个 35%）。
   ============================================================ */
const ART_SCATTER_CHANCE = 0.35;
/* 返回"实际落点格"（hex 对象）；没散 = null。
   rnd 可注入（离线测试要确定性）—— 先用一次判"散不散"，再用一次选方向。 */
function artScatterHex(hx, targetHex, rnd) {
  if (!hx || !targetHex) return null;
  const rand = (typeof rnd === 'function') ? rnd : Math.random;
  if (!(rand() < ART_SCATTER_CHANCE)) return null;
  const cands = hexNeighbors(targetHex.col, targetHex.row)
    .filter(p => !!hexAt(hx, p.col, p.row));
  if (!cands.length) return null;
  const i = Math.min(cands.length - 1, Math.floor(rand() * cands.length));
  return hexAt(hx, cands[i].col, cands[i].row);
}

/* "这个目标吃不吃压制"（车辆=装甲目标 ⇒ 不吃） */
function suppressible(c) {
  return !(c && c.kind === 'veh');
}

/* 从班里去人（随机：谁暴露谁倒霉） */
function killMembers(c, n) {
  const alive = (c.members || []).filter(m => m.alive);
  let killed = 0;
  while (killed < n && alive.length) {
    const i = Math.floor(Math.random() * alive.length);
    alive[i].alive = false;
    alive.splice(i, 1);
    killed++;
  }
  if (c.kind === 'inf' && !(c.members || []).some(m => m.alive)) c.dead = true;
  return killed;
}

/* 落结果（就地改状态） */
function applyFireResult(res, atk, def) {
  const out = { code: res.code, killed: 0, suppressed: false,
                destroyed: false, mpCut: false, wpnCut: false };
  /* ★ R10.36：挨过打就记一笔 —— 正在修碉堡的工兵会因此**被打断**
     （不管这一炮有没有打出效果：挨打就是挨打） */
  if (res && res.code && res.code !== '—') def.hitThisTurn = true;
  if (res.code === '—') return out;
  /* ★ R10.14：装甲目标不会被压制（resolveFire 已经把 S 换成 —，这里再防一道） */
  if (res.code === 'S') {
    if (!suppressible(def)) return out;
    def.suppressed = true; out.suppressed = true; return out;
  }
  if (res.kind === 'at' && def.kind === 'veh') {
    if (res.code === 'Km') {
      def.km = true; def.mp = 0;
      def.mpMax = Math.max(1, Math.round(def.mpMax / 2));
      out.mpCut = true;
    } else if (res.code === 'Kf') { def.kf = true; out.wpnCut = true; }
    else if (res.code === 'K') { def.dead = true; out.destroyed = true; }
    return out;
  }
  const n = crtKills(res.code);
  if (def.kind === 'inf') out.killed = killMembers(def, n);
  else if (n >= 2) { def.dead = true; out.destroyed = true; }
  else if (n === 1) { def.suppressed = true; out.suppressed = true; }
  return out;
}

/* ---------- 10) 回合钩子 ---------- */
/* 本方回合开始：恢复 MP、解禁射击/移动（压制要等本方回合**结束**才解除） */
function beginSideTurn(counters, side) {
  for (const c of counters) {
    if (c.side !== side || c.dead) continue;
    c.fired = false;
    c.acted = null;                 // ★ 移动/攻击二选一：新回合重新给一次行动权
    c.mp = c.km ? Math.max(1, Math.round(c.mpMax / 2)) : c.mpMax;
    c.hitThisTurn = false;          // ★ R10.36：上回合挨过打 ≠ 这回合还挨打（修碉堡要用）
  }
}
function endSideTurn(counters, side) {
  for (const c of counters) if (c.side === side) c.suppressed = false;
}

/* ---------- 11) 小工具（UI 用） ---------- */
function counterMen(c) {
  if (c.kind === 'veh') return c.dead ? 0 : 1;
  return (c.members || []).filter(m => m.alive).length;
}
function counterStrengthLabel(c) {
  if (c.kind === 'veh') {
    if (c.dead) return '击毁';
    return '装甲 ' + (c.armor || 0) + (c.km ? ' · 机动坏' : '') + (c.kf ? ' · 武器坏' : '');
  }
  return counterMen(c) + '/' + (c.members || []).length + ' 人';
}
function countersAlive(list, side) {
  return list.filter(c => !c.dead && (!side || c.side === side));
}
function zocKeysFor(hx, list, side) {
  const keys = new Set();
  for (const c of list) {
    if (c.side === side || c.dead || !c.hex) continue;
    for (const nb of hexNeighbors(c.hex.col, c.hex.row)) {
      const h = hexAt(hx, nb.col, nb.row);
      if (h) keys.add(hexKey(h));
    }
  }
  return keys;
}
/* 这一格上站着谁（同格最多 2 个棋子：1 步 1 车） */
function countersAt(list, hex, side) {
  return list.filter(c => !c.dead && c.hex && hex && c.hex.col === hex.col &&
                          c.hex.row === hex.row && (!side || c.side === side));
}
/* 射程表：1..N 格的 FLV（给面板/离线脚本共用） */
function flvLadder(c, kind, maxHex) {
  const n = maxHex || counterRangeHex(c);
  const out = [];
  for (let d = 1; d <= n; d++) out.push({ d, flv: counterFlv(c, d, kind) });
  return out;
}




/* 两格之间是否相邻 */
function hexAdjacent(a, b) {
  return hexDistance(a, b) === 1;
}
/* 一条攻击线经过的格子（起点/终点不含）—— 视线判定用 */
function hexLine(a, b) {
  const N = hexDistance(a, b);
  if (N === 0) return [];
  const A = offsetToCube(a.col, a.row), B = offsetToCube(b.col, b.row);
  const out = [];
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const fx = A.x + (B.x - A.x) * t, fy = A.y + (B.y - A.y) * t, fz = A.z + (B.z - A.z) * t;
    let rx = Math.round(fx), ry = Math.round(fy), rz = Math.round(fz);
    const dx = Math.abs(rx - fx), dy = Math.abs(ry - fy), dz = Math.abs(rz - fz);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    const odd = ((rz % 2) + 2) % 2;
    out.push({ col: rx + (rz - odd) / 2, row: rz });
  }
  return out;
}

/* ============================================================
   12) ★ R10.23：**部署区**（模式化） + **胜利目标**
   ------------------------------------------------------------
   玩家定案：
     · 部署做成**模式**：攻防 / 遭遇
         - 攻防：防守方拿 80% 部署区，剩下 20% 给进攻方
         - 遭遇：双方各 20%（中间 60% 是无人区）
     · 部署由玩家**手动摆**，也可以点「一键部署」自动铺开
     · 据点半径从"米"改成"格"（rHex），机制不变
     · 不再按据点算分：**开局设定胜利目标** —— 全歼 / 占领某点 / 防守某点 N 回合
   ============================================================ */

/* 出生锚点：优先用地图的 spawns（战场地图编辑器画的蓝/红出生区），没有就退回西/东边 */
function spawnAnchor(gm, side) {
  const sp = gm && gm.spawns && gm.spawns[side];
  if (sp && isFinite(sp.x) && isFinite(sp.w)) {
    return { x: (+sp.x) + (+sp.w) / 2, y: (+sp.y) + (+sp.h || 0) / 2 };
  }
  if (!gm) return { x: 0, y: 0 };
  return (side === 'blue')
    ? { x: 0, y: (+gm.h || 0) / 2 }
    : { x: +gm.w || 0, y: (+gm.h || 0) / 2 };
}
function spawnAnchors(gm) { return { blue: spawnAnchor(gm, 'blue'), red: spawnAnchor(gm, 'red') }; }

/* 部署比例（唯一真相） */
const DEPLOY_SHARE = { meeting: 0.20, attack: { defender: 0.80, attacker: 0.20 } };

/* 部署区：把"能站人的格子"按 d = |h−蓝锚| − |h−红锚| 从蓝方排到红方，再按模式切比例
     meeting（遭遇）: 蓝 = 前 20%，红 = 后 20%
     attack （攻防）: 防守方 = 靠自己那头的 80%，进攻方 = 靠对手那头的 20%
   ⇒ 返回 Set<hexKey>（UI 高亮与落子校验共用同一份结果） */
function deployZone(hx, side, mode, defender, anchors) {
  const out = new Set();
  if (!hx) return out;
  /* 六角格编辑器里**画了部署区**的图 ⇒ 尊重作者的画法（不再按 20%/80% 切）
     —— 手绘图没有"出生区"这个概念，作者涂的格子就是他的话 */
  const painted = new Set();
  for (let row = 0; row < hx.rows; row++) {
    for (let col = 0; col < hx.cols; col++) {
      const ph = hexAt(hx, col, row);
      if (ph && ph.deploy === side && isFinite(hexMoveCost(ph, 'foot'))) painted.add(hexKey(ph));
    }
  }
  if (painted.size) return painted;
  const A = anchors || { blue: { x: 0, y: 0 }, red: { x: 1, y: 0 } };
  const ab = A.blue || { x: 0, y: 0 }, ar = A.red || { x: 1, y: 0 };
  const cells = [];
  for (let row = 0; row < hx.rows; row++) {
    for (let col = 0; col < hx.cols; col++) {
      const h = hexAt(hx, col, row);
      if (!h || !isFinite(hexMoveCost(h, 'foot'))) continue;   // 石墙/深水这类站不了人
      const d = Math.hypot(h.x - ab.x, h.y - ab.y) - Math.hypot(h.x - ar.x, h.y - ar.y);
      cells.push({ h, d });
    }
  }
  if (!cells.length) return out;
  cells.sort((p, q) => (p.d - q.d) || (p.h.row - q.h.row) || (p.h.col - q.h.col));
  const n = cells.length;
  let share, fromBlueEnd;
  if (mode === 'attack') {
    const isDef = (side === defender);
    share = isDef ? DEPLOY_SHARE.attack.defender : DEPLOY_SHARE.attack.attacker;
    fromBlueEnd = ((defender === 'blue') === isDef);
  } else {
    share = DEPLOY_SHARE.meeting;
    fromBlueEnd = (side === 'blue');
  }
  const cnt = Math.max(1, Math.round(n * share));
  const from = fromBlueEnd ? 0 : Math.max(0, n - cnt);
  for (let i = from; i < Math.min(n, from + cnt); i++) out.add(hexKey(cells[i].h));
  return out;
}
/* 全图可部署格数（面板显示比例用） */
function deployableCount(hx) {
  let n = 0;
  if (!hx) return 0;
  for (let i = 0; i < hx.hexes.length; i++) {
    const h = hx.hexes[i];
    if (h && isFinite(hexMoveCost(h, 'foot'))) n++;
  }
  return n;
}

/* ---------- 胜利目标 ---------- */
/* 目标种类：annihilate 全歼 / capture 占领据点 / hold 防守据点 N 回合 */
function goalLabel(g) {
  if (!g) return '—';
  if (g.kind === 'capture') return '占领据点 ' + ((g.obj | 0) + 1);
  if (g.kind === 'hold') return '防守据点 ' + ((g.obj | 0) + 1) + ' 共 ' + Math.max(1, g.turns | 0 || 10) + ' 回合';
  return '全歼敌方';
}
/* 据点控制：圈内双方棋子数相减（净优势 > 0 ⇒ 控制；相等 ⇒ 争夺中） */
function objectiveControl(counters, objIndex) {
  let b = 0, r = 0;
  for (const c of (counters || [])) {
    if (c.dead || !c.hex || c.hex.obj !== objIndex) continue;
    if (c.side === 'blue') b++;
    else if (c.side === 'red') r++;
  }
  return { blue: b, red: r, owner: (b > r ? 'blue' : (r > b ? 'red' : null)) };
}
/* 胜利判定（纯函数）：goals = { blue:{kind,obj,turns}, red:{…} }，held = { blue:n, red:n }
   ⇒ null = 继续打；否则 { winner:'blue'|'red'|null, reason:'…' } */
function victoryGoals(counters, goals, held) {
  const aliveN = (s) => (counters || []).filter(c => !c.dead && c.side === s).length;
  const b = aliveN('blue'), r = aliveN('red');
  if (!b || !r) {                       // 全歼：一方棋子全没了
    return { winner: (!b && !r) ? null : (b ? 'blue' : 'red'), reason: '全歼' };
  }
  for (const s of ['blue', 'red']) {
    const g = (goals || {})[s];
    if (!g) continue;
    const oi = (g.obj == null) ? -1 : (g.obj | 0);
    if (g.kind === 'capture' && oi >= 0) {
      if (objectiveControl(counters, oi).owner === s) {
        return { winner: s, reason: '占领据点 ' + (oi + 1) };
      }
    } else if (g.kind === 'hold' && oi >= 0) {
      const turns = Math.max(1, (g.turns | 0) || 10);
      if (((held || {})[s] || 0) >= turns) {
        return { winner: s, reason: '守住据点 ' + (oi + 1) + ' ' + turns + ' 回合' };
      }
    }
  }
  return null;
}
/* 防守类目标的"回合结算"：本方回合结束时看一眼，控制住就 +1，丢了清零 */
function holdTick(counters, goals, held, side) {
  const h = held || { blue: 0, red: 0 };
  const g = (goals || {})[side];
  if (!g || g.kind !== 'hold' || g.obj == null || (g.obj | 0) < 0) return h;
  const ctl = objectiveControl(counters, g.obj | 0);
  h[side] = (ctl.owner === side) ? ((h[side] || 0) + 1) : 0;
  return h;
}
/* 超时（回合用完）判定：**剩余兵力**多的一方胜，相等平局（玩家：不再数据点分） */
function timeUpWinner(counters) {
  const men = (s) => (counters || []).filter(c => !c.dead && c.side === s)
    .reduce((a, c) => a + counterMen(c), 0);
  const b = men('blue'), r = men('red');
  return (b === r) ? null : (b > r ? 'blue' : 'red');
}

