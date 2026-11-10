/* ============================================================
   equipment.js — 装备类型定义 + 全局装备库管理
   ============================================================ */

const EQUIP_CATEGORIES = {
  small_arms: {
    name: '轻武器', icon: '🔫',
    desc: '步枪、机枪、狙击枪等个人武器',
    fields: [
      { key: 'antiPersonnel', name: '对人员伤害', unit: '',   min: 0, max: 200,   default: 10 },
      { key: 'range',         name: '射程',       unit: 'm',  min: 0, max: 5000,  default: 400 },
      { key: 'fireInterval',  name: '射击间隔',   unit: '秒', min: 0.05, max: 10, default: 0.3 },
      { key: 'ammo', name: '备弹（发）', unit: '发', min: 0, max: 99999, default: 120 },
    ]
  },
  at_weapon: {
    name: '单兵反装甲', icon: '🚀',
    desc: '单兵火箭筒、单兵反装甲导弹',
    fields: [
      { key: 'crew', name: '操作员数量', unit: '人', min: 0, max: 30, default: 1 },
      { key: 'antiArmor',    name: '对装甲伤害', unit: '',   min: 0, max: 2000,  default: 400 },
      { key: 'penetration',  name: '穿甲',       unit: 'mm', min: 0, max: 1500,  default: 500 },
      { key: 'range',        name: '射程',       unit: 'm',  min: 0, max: 10000, default: 800 },
      { key: 'fireInterval', name: '射击间隔',   unit: '秒', min: 0.5, max: 30, default: 8 },
      { key: 'ammo', name: '备弹（发）', unit: '发', min: 0, max: 99999, default: 120 },
      { key: 'deployTime',   name: '部署时间',   unit: '秒', min: 0, max: 60, default: 3 },
      { key: 'disposable',   name: '使用方式',   type: 'select', default: 'no',
        options: [
          { value: 'no',  label: '可重复使用' },
          { value: 'yes', label: '一次性（打完丢弃）' },
        ] },
    ]
  },
  infantry_arty: {
    name: '单兵火炮', icon: '💣',
    desc: '单兵迫击炮、掷弹筒、枪榴弹（近距支援，威力不宜过高）',
    fields: [
      { key: 'crew', name: '操作员数量', unit: '人', min: 0, max: 30, default: 2 },
      { key: 'antiPersonnel', name: '对人员伤害', unit: '',   min: 0, max: 100,   default: 20 },
      { key: 'antiArmor',     name: '对装甲伤害', unit: '',   min: 0, max: 500,   default: 20 },
      { key: 'penetration',   name: '穿甲',       unit: 'mm', min: 0, max: 500,   default: 30 },
      { key: 'range',         name: '最大射程',   unit: 'm',  min: 0, max: 8000,  default: 1500 },
      { key: 'minRange',      name: '最小射程',   unit: 'm',  min: 0, max: 1000,  default: 100 },
      { key: 'fireInterval',  name: '射击间隔',   unit: '秒', min: 0.5, max: 30, default: 4 },
      { key: 'ammo', name: '备弹（发）', unit: '发', min: 0, max: 99999, default: 120 },
      { key: 'deployTime',    name: '部署时间',   unit: '秒', min: 0, max: 60, default: 3 },
      { key: 'disposable',    name: '使用方式',   type: 'select', default: 'no',
        options: [
          { value: 'no',  label: '可重复使用' },
          { value: 'yes', label: '一次性（打完丢弃）' },
        ] },
    ]
  },
  artillery: {
    name: '火炮', icon: '💥',
    desc: '榴弹炮、火箭炮、迫击炮 —— 按"杀伤半径"结算：圈内阵亡、外圈只压制',
    fields: [
      { key: 'crew', name: '操作员数量', unit: '人', min: 0, max: 30, default: 6 },
      { key: 'lethalRadius',   name: '杀伤半径', unit: 'm',  min: 1, max: 200,   default: 30  },
      { key: 'suppressRadius', name: '压制半径', unit: 'm',  min: 1, max: 400,   default: 75  },
      { key: 'antiArmor',     name: '对装甲伤害', unit: '',   min: 0, max: 500,   default: 50  },
      { key: 'penetration',   name: '穿甲',       unit: 'mm', min: 0, max: 500,   default: 80  },
      { key: 'range',         name: '最大射程',   unit: 'm',  min: 0, max: 50000, default: 15000 },
      { key: 'minRange',      name: '最小射程',   unit: 'm',  min: 0, max: 5000,  default: 500 },
      { key: 'fireInterval',  name: '射击间隔',   unit: '秒', min: 0.5, max: 60, default: 8 },
      { key: 'ammo', name: '备弹（发）', unit: '发', min: 0, max: 99999, default: 120 },
      { key: 'deployTime',    name: '部署时间',   unit: '秒', min: 3, max: 60, default: 12 },
      /* ★ R10.33：自行火炮也要能填速度和行走方式（战斗系统按 mobility / mobilityType 算机动） */
      { key: 'mobility',      name: '速度',       unit: 'km/h', min: 0, max: 150, default: 40 },
      { key: 'mobilityType',  name: '机动方式',   type: 'select', default: 'tracked',
        options: [
          { value: 'tracked',   label: '全履带' },
          { value: 'halftrack', label: '半履带' },
          { value: 'wheeled',   label: '轮式' },
        ] },
      { key: 'towed',         name: '牵引方式',   type: 'select', default: 'yes',
        options: [
          { value: 'yes', label: '牵引式（需车辆牵引）' },
          { value: 'no',  label: '自行 / 便携式' },
        ] }
    ]
  },
  at_gun: {
    name: '反坦克火炮', icon: '🎯',
    desc: '牵引式反坦克炮、重型反坦克武器',
    fields: [
      { key: 'crew', name: '操作员数量', unit: '人', min: 0, max: 30, default: 5 },
      { key: 'antiArmor',    name: '对装甲伤害', unit: '',   min: 0, max: 2000,  default: 500 },
      { key: 'antiPersonnel',name: '对人员伤害', unit: '',   min: 0, max: 500,   default: 30  },
      { key: 'penetration',  name: '穿甲',       unit: 'mm', min: 0, max: 2000,  default: 700 },
      { key: 'range',        name: '射程',       unit: 'm',  min: 0, max: 10000, default: 2500 },
      { key: 'fireInterval', name: '射击间隔',   unit: '秒', min: 0.5, max: 30, default: 5 },
      { key: 'ammo', name: '备弹（发）', unit: '发', min: 0, max: 99999, default: 120 },
      { key: 'deployTime',   name: '部署时间',   unit: '秒', min: 0, max: 60, default: 8 },
      { key: 'towed',        name: '牵引方式',   type: 'select', default: 'yes',
        options: [
          { value: 'yes', label: '牵引式（需车辆牵引）' },
          { value: 'no',  label: '自行' },
        ] }
    ]
  },
  anti_air: {
    name: '防空武器', icon: '🛡️',
    desc: '高射炮、防空导弹',
    fields: [
      { key: 'crew', name: '操作员数量', unit: '人', min: 0, max: 30, default: 3 },
      { key: 'antiAir',       name: '对空伤害',   unit: '',   min: 0, max: 1000,  default: 200 },
      { key: 'antiPersonnel', name: '对人员伤害', unit: '',   min: 0, max: 500,   default: 50  },
      { key: 'antiArmor',     name: '对装甲伤害', unit: '',   min: 0, max: 500,   default: 20  },
      { key: 'penetration',   name: '穿甲',       unit: 'mm', min: 0, max: 500,   default: 30  },
      { key: 'range',         name: '射程',       unit: 'm',  min: 0, max: 30000, default: 5000 },
      { key: 'fireInterval',  name: '射击间隔',   unit: '秒', min: 0.05, max: 10, default: 0.3 },
      { key: 'ammo', name: '备弹（发）', unit: '发', min: 0, max: 99999, default: 120 },
      { key: 'deployTime',    name: '部署时间',   unit: '秒', min: 0, max: 60, default: 3 }
    ]
  },
  armored_vehicle: {
    name: '装甲车辆', icon: '🚙',
    desc: '坦克、步兵战车、装甲输送车',
    fields: [
      { key: 'crew', name: '操作员数量', unit: '人', min: 0, max: 30, default: 3 },
      { key: 'armor',         name: '装甲厚度',   unit: 'mm', min: 0, max: 1500,  default: 200 },
      { key: 'hp',            name: '结构耐久',   unit: '',   min: 0, max: 5000,  default: 500 },
      { key: 'antiPersonnel', name: '对人员伤害', unit: '',   min: 0, max: 200,   default: 30  },
      { key: 'antiArmor',     name: '对装甲伤害', unit: '',   min: 0, max: 2000,  default: 400 },
      { key: 'penetration',   name: '穿甲',       unit: 'mm', min: 0, max: 1500,  default: 500 },
      { key: 'range',         name: '射程',       unit: 'm',  min: 0, max: 10000, default: 3000 },
      { key: 'mobility',      name: '机动性',     unit: 'km/h', min: 0, max: 150, default: 60 },
      { key: 'capacity',      name: '载员数量',  unit: '人',   min: 0, max: 200,   default: 0 },
      { key: 'mobilityType',  name: '机动方式',   type: 'select', default: 'tracked',
        options: [
          { value: 'tracked',   label: '全履带' },
          { value: 'wheeled',   label: '轮式' },
          { value: 'halftrack', label: '半履带' },
        ] },
      { key: 'fireInterval',  name: '射击间隔',   unit: '秒', min: 0.5, max: 30, default: 3 },
      { key: 'ammo', name: '备弹（发）', unit: '发', min: 0, max: 99999, default: 120 },
    ]
  },
  aircraft: {
    name: '飞行器', icon: '✈️',
    desc: '直升机、固定翼飞机',
    fields: [
      { key: 'crew', name: '操作员数量', unit: '人', min: 0, max: 30, default: 2 },
      { key: 'hp',            name: '结构耐久',   unit: '',   min: 0, max: 3000,  default: 300 },
      { key: 'antiPersonnel', name: '对地伤害',   unit: '',   min: 0, max: 500,   default: 80  },
      { key: 'antiArmor',     name: '对装甲伤害', unit: '',   min: 0, max: 1000,  default: 300 },
      { key: 'antiAir',       name: '对空伤害',   unit: '',   min: 0, max: 1000,  default: 100 },
      { key: 'range',         name: '射程',       unit: 'm',  min: 0, max: 50000, default: 5000 },
      { key: 'speed',         name: '速度',       unit: 'km/h', min: 0, max: 3000, default: 300 },
      { key: 'capacity',      name: '载员数量',  unit: '人',   min: 0, max: 200,   default: 0   },
      { key: 'fireInterval',  name: '射击间隔',   unit: '秒', min: 0.1, max: 30, default: 1.5 },
      { key: 'ammo', name: '备弹（发）', unit: '发', min: 0, max: 99999, default: 120 },
    ]
  },
  support: {
    name: '支援车辆', icon: '🚚',
    desc: '运输、工程、医疗、补给车辆',
    fields: [
      { key: 'crew', name: '操作员数量', unit: '人', min: 0, max: 30, default: 1 },
      { key: 'hp',           name: '结构耐久',   unit: '',    min: 0, max: 1000,  default: 100 },
      { key: 'mobility',     name: '机动性',     unit: 'km/h', min: 0, max: 120,  default: 50  },
      { key: 'capacity',     name: '载员数量', unit: '人',    min: 0, max: 200,   default: 10  },
      { key: 'function',     name: '功能强度',   unit: '',    min: 0, max: 100,   default: 10  },
      { key: 'mobilityType', name: '机动方式',   type: 'select', default: 'wheeled',
        options: [
          { value: 'tracked',   label: '全履带' },
          { value: 'wheeled',   label: '轮式' },
          { value: 'halftrack', label: '半履带' },
        ] },
    ]
  },
  misc: {
    name: '其他', icon: '📦',
    desc: '不分类的装备',
    fields: []
  }
};

/* ---------- 全局装备库 CRUD ---------- */
const EQUIP_LIB_KEY = 'mil_equipment_lib_v1';

function getEquipmentLibrary() {
  /* ★ R10.38：装备库走 store.js（IndexedDB；localStorage 只读兼容） */
  try {
    if (typeof Store !== 'undefined') return Store.get(EQUIP_LIB_KEY, {}) || {};
    return JSON.parse(localStorage.getItem(EQUIP_LIB_KEY) || '{}');
  } catch (e) { return {}; }
}
function saveEquipmentLibrary(lib) {
  try {
    if (typeof Store !== 'undefined') { Store.set(EQUIP_LIB_KEY, lib); return; }
    localStorage.setItem(EQUIP_LIB_KEY, JSON.stringify(lib));
  } catch (e) { console.error('保存装备库失败：', e); }
}
function createEquipmentId() {
  return 'eq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}
function createEquipment(category, name, stats) {
  const cat = EQUIP_CATEGORIES[category] || EQUIP_CATEGORIES.misc;
  const finalStats = {};
  (cat.fields || []).forEach(f => {
    let v;
    if (f.type === 'select') {
      v = (stats && typeof stats[f.key] === 'string') ? stats[f.key] : f.default;
    } else {
      v = (stats && typeof stats[f.key] === 'number') ? stats[f.key] : f.default;
    }
    finalStats[f.key] = v;
  });
  return { id: createEquipmentId(), category, name: name || '未命名装备', stats: finalStats };
}
function findOrCreateEquipment(lib, name) {
  const found = Object.values(lib).find(e => e.name === name);
  if (found) return found;
  const seed = DEFAULT_EQUIPMENT_SEED.find(s => s.name === name);
  const eq = seed
    ? createEquipment(seed.category, seed.name, seed.stats)
    : createEquipment('misc', name, {});
  lib[eq.id] = eq;
  return eq;
}
function upgradeNodeEquipmentReferences(node) {
  const lib = getEquipmentLibrary();
  let dirty = false;
  let libDirty = false;

  forEachNode(node, n => {
    if (!n.equipment || !n.equipment.length) return;
    n.equipment.forEach(e => {
      // 已有 eqId 且在库中 → 跳过
      if (e.eqId && lib[e.eqId]) return;

      // 1) 优先按名字找库里的（可能 eqId 变了但名字还在）
      const byName = Object.values(lib).find(x => x.name === e.name);
      if (byName) {
        e.eqId = byName.id;
        e.name = byName.name;
        dirty = true;
        return;
      }

      // 2) 库里没有 → 从默认种子重建
      const seed = DEFAULT_EQUIPMENT_SEED.find(s => s.name === e.name);
      if (seed) {
        const eq = createEquipment(seed.category, seed.name, seed.stats);
        lib[eq.id] = eq;
        e.eqId = eq.id;
        e.name = eq.name;
        dirty = true;
        libDirty = true;
        return;
      }

      // 3) 种子也没有 → 用 misc 类别创建占位（保留名字不丢失）
      const eq = createEquipment('misc', e.name || '未知装备', {});
      lib[eq.id] = eq;
      e.eqId = eq.id;
      e.name = eq.name;
      dirty = true;
      libDirty = true;
    });
  });

  if (libDirty) saveEquipmentLibrary(lib);
  return dirty;
}

// ★ 全树修复：加载存档/预设/首次打开时调用
function autoRepairRootEquipment(rootNode) {
  if (!rootNode) return 0;
  const lib = getEquipmentLibrary();
  const before = Object.keys(lib).length;
  upgradeNodeEquipmentReferences(rootNode);
  const after = Object.keys(getEquipmentLibrary()).length;
  return after - before;  // 返回新增的装备数
}
/* ============================================================
   默认装备种子
   ============================================================ */
const DEFAULT_EQUIPMENT_SEED = [
  // —— 轻武器 ——
  /* ★★ R9.6.9：射速从"全自动扫射"改成**点射节奏**（治"交火 1 秒结束"）。
     旧值（突击步枪 0.12s = 500 发/分）是"枪的机械射速"，而**单兵**打的是
     "瞄准—点射—修正"的有效射速；配合新命中率（近 10% / 远 2%），
     一个排 vs 一个排 ≈ 30 秒 ~ 2 分钟拉锯。 */
  { category:'small_arms', name:'突击步枪',   stats:{ ammo:120, antiPersonnel:6,  range:500,  fireInterval:0.6 } },
  { category:'small_arms', name:'半自动步枪', stats:{ ammo:120, antiPersonnel:5,  range:450,  fireInterval:0.8 } },
  { category:'small_arms', name:'冲锋枪',     stats:{ ammo:180, antiPersonnel:4,  range:200,  fireInterval:0.5 } },
  { category:'small_arms', name:'狙击步枪',   stats:{ ammo:60, antiPersonnel:15, range:1000, fireInterval:1.5 } },
  { category:'small_arms', name:'手枪',       stats:{ ammo:40, antiPersonnel:3,  range:50,   fireInterval:0.5 } },
  { category:'small_arms', name:'轻机枪',     stats:{ ammo:500, antiPersonnel:8,  range:600,  fireInterval:0.5 } },
  { category:'small_arms', name:'重机枪',     stats:{ ammo:900, antiPersonnel:15, range:1000, fireInterval:0.6 } },

  // —— 单兵反装甲 ——（★ R10.7：penetration 改成**真实毫米**；破甲弹不随距离衰减）
  { category:'at_weapon', name:'单兵火箭筒',     stats:{ ammo:1, antiArmor:300, penetration:100, range:300,  fireInterval:20, deployTime:3, disposable:'yes' } },
  { category:'at_weapon', name:'反坦克导弹',     stats:{ ammo:6, crew:2, antiArmor:500, penetration:600, range:4000, fireInterval:10, deployTime:8, disposable:'no'  } },
  { category:'at_weapon', name:'单兵反坦克导弹', stats:{ ammo:1, crew:2, antiArmor:600, penetration:700, range:2500, fireInterval:12, deployTime:6, disposable:'yes' } },

  // —— 单兵火炮 ——（HE 弹，穿深按真实水平下调）
  { category:'infantry_arty', name:'掷弹筒',     stats:{ ammo:30, crew:1, antiPersonnel:18, antiArmor:20, penetration:20, range:500,  minRange:30, fireInterval:5, deployTime:6, disposable:'no' } },
  { category:'infantry_arty', name:'枪榴弹',     stats:{ ammo:20, crew:1, antiPersonnel:15, antiArmor:15, penetration:20, range:400,  minRange:20, fireInterval:6, deployTime:5, disposable:'no' } },

  // —— 火炮 ——（HE：穿深只作"对装甲"参考，真实水平很低）
  { category:'artillery', name:'迫击炮',      stats:{ ammo:60, crew:3, lethalRadius:20, suppressRadius:55,  antiArmor:20,  penetration:25,  range:5000,  minRange:100,  fireInterval:6,  deployTime:10, towed:'no'  } },
  { category:'artillery', name:'自行火炮',    stats:{ ammo:40, crew:4, lethalRadius:55, suppressRadius:130, antiArmor:100, penetration:60, range:30000, minRange:500,  fireInterval:12, deployTime:15, towed:'no'  } },
  { category:'artillery', name:'多管火箭炮',  stats:{ ammo:40, crew:3, lethalRadius:70, suppressRadius:180, antiArmor:120, penetration:60, range:40000, minRange:5000, fireInterval:25, deployTime:30, towed:'no'  } },
  { category:'artillery', name:'轻型榴弹炮',  stats:{ ammo:60, lethalRadius:30, suppressRadius:75,  antiArmor:50,  penetration:45,  range:12000, minRange:300,  fireInterval:10, deployTime:12, towed:'yes' } },
  { category:'artillery', name:'75mm山炮',    stats:{ ammo:60, lethalRadius:20, suppressRadius:50,  antiArmor:40,  penetration:40,  range:9000,  minRange:200,  fireInterval:10, deployTime:12, towed:'yes' } },
  { category:'artillery', name:'155mm榴弹炮', stats:{ ammo:40, crew:8, lethalRadius:50, suppressRadius:120, antiArmor:120, penetration:70, range:25000, minRange:1000, fireInterval:20, deployTime:25, towed:'yes' } },
  { category:'artillery', name:'M142 HIMARS', stats:{ ammo:12, crew:3, lethalRadius:60, suppressRadius:160, antiArmor:150, penetration:80, range:80000, minRange:8000, fireInterval:20, deployTime:25, towed:'no'  } },

  // —— 反坦克火炮 ——（★ R10.7：AP 弹真实穿深 @500m）
  { category:'at_gun', name:'37mm反坦克炮',  stats:{ ammo:60, crew:4, antiArmor:200, antiPersonnel:15, penetration:48,  range:1500, fireInterval:4, deployTime:6, towed:'yes' } },
  { category:'at_gun', name:'57mm反坦克炮',  stats:{ ammo:50, antiArmor:350, antiPersonnel:20, penetration:90,  range:2000, fireInterval:5, deployTime:8, towed:'yes' } },
  { category:'at_gun', name:'88mm反坦克炮',  stats:{ ammo:40, crew:6, antiArmor:700, antiPersonnel:40, penetration:120, range:3000, fireInterval:5, deployTime:10, towed:'yes' } },

  // —— 防空武器 ——
  { category:'anti_air', name:'自行高炮', stats:{ antiAir:150, antiPersonnel:40, antiArmor:30, penetration:30, range:4000,  fireInterval:0.15, deployTime:3 } },
  { category:'anti_air', name:'防空导弹', stats:{ crew:4, antiAir:500, antiPersonnel:10, antiArmor:20, penetration:20, range:12000, fireInterval:8,    deployTime:6 } },

  // —— 装甲车辆 ——（★ R10.7：armor / penetration 换成**真实毫米**，正面装甲口径）
  { category:'armored_vehicle', name:'主战坦克',   stats:{ crew:4, armor:400,  hp:1200, antiPersonnel:30, antiArmor:600, penetration:400,  range:3000, mobility:60,  capacity:0,  mobilityType:'tracked',   fireInterval:3 } },
  { category:'armored_vehicle', name:'步兵战车',   stats:{ armor:35,   hp:400,  antiPersonnel:30, antiArmor:150, penetration:60,   range:2000, mobility:70,  capacity:8,  mobilityType:'tracked',   fireInterval:1 } },
  { category:'armored_vehicle', name:'装甲侦察车', stats:{ armor:15,   hp:250,  antiPersonnel:20, antiArmor:80,  penetration:30,   range:1500, mobility:100, capacity:4,  mobilityType:'wheeled',   fireInterval:0.5 } },
  { category:'armored_vehicle', name:'装甲输送车', stats:{ crew:2, armor:38,   hp:300,  antiPersonnel:15, antiArmor:40,  penetration:20,   range:1000, mobility:80,  capacity:10, mobilityType:'tracked',   fireInterval:0.5 } },
  { category:'armored_vehicle', name:'虎式坦克',   stats:{ crew:5, armor:102,  hp:1500, antiPersonnel:35, antiArmor:700, penetration:120,  range:3000, mobility:40,  capacity:0,  mobilityType:'tracked',   fireInterval:4 } },
  { category:'armored_vehicle', name:'M4A3谢尔曼', stats:{ crew:5, armor:51,   hp:800,  antiPersonnel:25, antiArmor:400, penetration:66,   range:2500, mobility:50,  capacity:0,  mobilityType:'tracked',   fireInterval:3 } },

  // —— 飞行器 ——
  { category:'aircraft', name:'AH-64E阿帕奇', stats:{ hp:400, antiPersonnel:200, antiArmor:500, antiAir:50, range:8000, speed:280, capacity:0,  fireInterval:1 } },
  { category:'aircraft', name:'UH-60M黑鹰',   stats:{ crew:3, hp:300, antiPersonnel:30,  antiArmor:0,   antiAir:0,  range:500,  speed:280, capacity:12, fireInterval:1 } },
  { category:'aircraft', name:'CH-47F支奴干', stats:{ crew:3, hp:400, antiPersonnel:20,  antiArmor:0,   antiAir:0,  range:500,  speed:280, capacity:30, fireInterval:1 } },

  // —— 支援车辆 ——
  { category:'support', name:'指挥车',   stats:{ crew:2, hp:150, mobility:60, capacity:5,  function:50, mobilityType:'wheeled' } },
  { category:'support', name:'工程车',   stats:{ crew:2, hp:200, mobility:50, capacity:10, function:60, mobilityType:'wheeled' } },
  { category:'support', name:'通信车',   stats:{ crew:2, hp:150, mobility:60, capacity:6,  function:80, mobilityType:'wheeled' } },
  { category:'support', name:'运输卡车', stats:{ hp:100, mobility:70, capacity:30, function:20, mobilityType:'wheeled' } },
  { category:'support', name:'油罐车',   stats:{ hp:100, mobility:60, capacity:5,  function:40, mobilityType:'wheeled' } },
  { category:'support', name:'救护车',   stats:{ hp:100, mobility:70, capacity:10, function:70, mobilityType:'wheeled' } },
];

/* ============================================================
   装备库数值迁移
   用途：当种子数值调整时，自动升级"未被用户改过"的装备
   ============================================================ */
const EQUIP_META_KEY = 'mil_equipment_meta_v1';
const EQUIP_SEED_VERSION = 8;

const EQUIP_MIGRATIONS = [
  {
    version: 2,
    targets: {
      '掷弹筒':      { old: { antiPersonnel: 50,  fireInterval: 4,  deployTime: 3  },
                       new: { antiPersonnel: 18,  fireInterval: 5,  deployTime: 6  } },
      '枪榴弹':      { old: { antiPersonnel: 40,  fireInterval: 5,  deployTime: 2  },
                       new: { antiPersonnel: 15,  fireInterval: 6,  deployTime: 5  } },
      '迫击炮':      { old: { antiPersonnel: 80,  fireInterval: 3,  deployTime: 4  },
                       new: { antiPersonnel: 25,  fireInterval: 6,  deployTime: 10 } },
      '自行火炮':    { old: { antiPersonnel: 200, fireInterval: 8,  deployTime: 10 },
                       new: { antiPersonnel: 70,  fireInterval: 12, deployTime: 15 } },
      '多管火箭炮':  { old: { antiPersonnel: 300, fireInterval: 15, deployTime: 18 },
                       new: { antiPersonnel: 100, fireInterval: 25, deployTime: 30 } },
      '轻型榴弹炮':  { old: { antiPersonnel: 120, fireInterval: 6,  deployTime: 8  },
                       new: { antiPersonnel: 45,  fireInterval: 10, deployTime: 12 } },
      '75mm山炮':    { old: { antiPersonnel: 100, fireInterval: 6,  deployTime: 8  },
                       new: { antiPersonnel: 35,  fireInterval: 10, deployTime: 12 } },
      '155mm榴弹炮': { old: { antiPersonnel: 250, fireInterval: 10, deployTime: 15 },
                       new: { antiPersonnel: 80,  fireInterval: 20, deployTime: 25 } },
      'M142 HIMARS': { old: { antiPersonnel: 350, fireInterval: 12, deployTime: 15 },
                       new: { antiPersonnel: 120, fireInterval: 20, deployTime: 25 } },
    },
  },
  {
    version: 3,
    // 补齐 crew（操作员数量）字段：老装备没有该字段
    fillMissing: ['crew'],
  },
  {
    version: 4,
    // 火炮改"杀伤半径"模型：补齐 lethalRadius / suppressRadius（老装备的 antiPersonnel 不再使用）
    fillMissing: ['lethalRadius', 'suppressRadius'],
  },
  {
    version: 5,
    removeFields: { small_arms: ['antiArmor'] },
  },
  {
    version: 6,
    fillMissing: ['ammo'],   // 备弹（若旧库没有，取 seed 同名值，否则取类别默认）
  },
  {
    /* ★ R9.6.9 v7：轻武器射速 → 点射节奏（治"交火 1 秒结束"）
       —— 只更新"还是默认旧值"的装备；玩家自己改过射速的会被 skip 并提示（见 migrateEquipmentLibrary）。 */
    version: 7,
    targets: {
      '突击步枪':   { old: { fireInterval: 0.12 }, new: { fireInterval: 0.6 } },
      '半自动步枪': { old: { fireInterval: 0.5  }, new: { fireInterval: 0.8 } },
      '冲锋枪':     { old: { fireInterval: 0.08 }, new: { fireInterval: 0.5 } },
      '手枪':       { old: { fireInterval: 0.2  }, new: { fireInterval: 0.5 } },
      '轻机枪':     { old: { fireInterval: 0.15 }, new: { fireInterval: 0.5 } },
      '重机枪':     { old: { fireInterval: 0.2  }, new: { fireInterval: 0.6 } },
    },
  },
  {
    /* ★★ R10.7 v8：`armor` / `penetration` 从"游戏数值"换成**真实毫米**
       —— 这样"谢尔曼 75mm(66mm) vs 谢尔曼 76/51mm"、"虎式 88mm(120mm) vs 谢尔曼"
       这些差距才分得出来；玩家自己改过的字段会被跳过并提示。 */
    version: 8,
    targets: {
      'M4A3谢尔曼':    { old: { armor: 500,  penetration: 500  }, new: { armor: 51,  penetration: 66  } },
      '虎式坦克':      { old: { armor: 1000, penetration: 1000 }, new: { armor: 102, penetration: 120 } },
      '主战坦克':      { old: { armor: 800,  penetration: 900  }, new: { armor: 400, penetration: 400 } },
      '步兵战车':      { old: { armor: 200,  penetration: 200  }, new: { armor: 35,  penetration: 60  } },
      '装甲侦察车':    { old: { armor: 100,  penetration: 100  }, new: { armor: 15,  penetration: 30  } },
      '装甲输送车':    { old: { armor: 120,  penetration: 50   }, new: { armor: 38,  penetration: 20  } },
      '单兵火箭筒':    { old: { penetration: 350 }, new: { penetration: 100 } },
      '反坦克导弹':    { old: { penetration: 700 }, new: { penetration: 600 } },
      '单兵反坦克导弹':{ old: { penetration: 800 }, new: { penetration: 700 } },
      '37mm反坦克炮':  { old: { penetration: 250 }, new: { penetration: 48  } },
      '57mm反坦克炮':  { old: { penetration: 450 }, new: { penetration: 90  } },
      '88mm反坦克炮':  { old: { penetration: 800 }, new: { penetration: 120 } },
      '自行高炮':      { old: { penetration: 50  }, new: { penetration: 30  } },
      '防空导弹':      { old: { penetration: 30  }, new: { penetration: 20  } },
      '掷弹筒':        { old: { penetration: 30  }, new: { penetration: 20  } },
      '枪榴弹':        { old: { penetration: 25  }, new: { penetration: 20  } },
      '迫击炮':        { old: { penetration: 30  }, new: { penetration: 25  } },
      '自行火炮':      { old: { penetration: 150 }, new: { penetration: 60  } },
      '多管火箭炮':    { old: { penetration: 150 }, new: { penetration: 60  } },
      '轻型榴弹炮':    { old: { penetration: 80  }, new: { penetration: 45  } },
      '75mm山炮':      { old: { penetration: 60  }, new: { penetration: 40  } },
      '155mm榴弹炮':   { old: { penetration: 180 }, new: { penetration: 70  } },
      'M142 HIMARS':   { old: { penetration: 180 }, new: { penetration: 80  } },
    },
  },
];

function migrateEquipmentLibrary() {
  let meta = {};
  try { meta = (typeof Store !== 'undefined') ? (Store.get(EQUIP_META_KEY, {}) || {}) : JSON.parse(localStorage.getItem(EQUIP_META_KEY) || '{}'); } catch (e) {}
  const currentVer = meta.seedVersion || 1;
  if (currentVer >= EQUIP_SEED_VERSION) return { updated: 0, skipped: 0 };

  const lib = getEquipmentLibrary();
  let updatedFields = 0;
  let skippedFields = 0;
  const skippedNames = new Set();
  const updatedNames = new Set();

  for (const migration of EQUIP_MIGRATIONS) {
    if (migration.version <= currentVer) continue;

    /* v5: remove fields */
    if (migration.removeFields) {
      for (const eq of Object.values(lib)) {
        const keys = migration.removeFields[eq.category];
        if (!keys) continue;
        for (const key of keys) {
          if (eq.stats[key] === undefined) continue;
          delete eq.stats[key];
          updatedFields++;
          updatedNames.add(eq.name);
        }
      }
      continue;
    }

    if (migration.fillMissing) {
      // 补齐缺失字段（例如给老装备补 crew）
      for (const eq of Object.values(lib)) {
        for (const key of migration.fillMissing) {
          if (eq.stats[key] !== undefined) continue;
          const cat = EQUIP_CATEGORIES[eq.category];
          const field = cat && (cat.fields || []).find(f => f.key === key);
          const seed = DEFAULT_EQUIPMENT_SEED.find(s => s.name === eq.name);
          const v = (seed && seed.stats && typeof seed.stats[key] === 'number')
            ? seed.stats[key]
            : (field ? field.default : 0);
          eq.stats[key] = v;
          updatedFields++;
          updatedNames.add(eq.name);
        }
      }
      continue;
    }

    for (const [name, spec] of Object.entries(migration.targets)) {
      const eq = Object.values(lib).find(e => e.name === name);
      if (!eq) continue;
      for (const key of Object.keys(spec.new)) {
        if (eq.stats[key] === spec.old[key]) {
          eq.stats[key] = spec.new[key];
          updatedFields++;
          updatedNames.add(name);
        } else {
          skippedFields++;
          skippedNames.add(name);
        }
      }
    }
  }

  if (updatedFields > 0) saveEquipmentLibrary(lib);
  meta.seedVersion = EQUIP_SEED_VERSION;
  try {
    if (typeof Store !== 'undefined') Store.set(EQUIP_META_KEY, meta);
    else localStorage.setItem(EQUIP_META_KEY, JSON.stringify(meta));
  } catch (e) {}

  if (updatedNames.size > 0) {
    console.log(`✅ 装备数值已升级（${updatedFields} 个字段）：${[...updatedNames].join('、')}`);
  }
  if (skippedNames.size > 0) {
    console.warn(
      `⚠ 以下装备的部分字段因你已自定义，未被自动更新：\n` +
      `   ${[...skippedNames].join('、')}\n` +
      `   如需使用新数值，请在装备库中手动修改。`
    );
  }
  return { updated: updatedFields, skipped: skippedFields };
}

function seedEquipmentLibraryIfEmpty() {
  const lib = getEquipmentLibrary();
  if (Object.keys(lib).length > 0) {
    // ★ 库非空 → 尝试数值迁移
    try { migrateEquipmentLibrary(); } catch (e) { console.warn('装备迁移失败：', e); }
    return 0;
  }
  DEFAULT_EQUIPMENT_SEED.forEach(seed => {
    const eq = createEquipment(seed.category, seed.name, seed.stats);
    lib[eq.id] = eq;
  });
  saveEquipmentLibrary(lib);
  try {
    if (typeof Store !== 'undefined') Store.set(EQUIP_META_KEY, { seedVersion: EQUIP_SEED_VERSION });
    else localStorage.setItem(EQUIP_META_KEY, JSON.stringify({ seedVersion: EQUIP_SEED_VERSION }));
  } catch (e) {}
  console.log('✅ 已导入默认装备库，共 ' + DEFAULT_EQUIPMENT_SEED.length + ' 件');
  return DEFAULT_EQUIPMENT_SEED.length;
}


// ★ 每次加载自动尝试迁移（幂等）
try { migrateEquipmentLibrary(); } catch (e) { console.warn('装备迁移失败：', e); }