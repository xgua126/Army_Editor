# -*- coding: utf-8 -*-
"""生成 js/ms-catalog.js —— **只做陆地单位**的兵牌库，按兵种重新分类

数据源：Esri/joint-military-symbology-xml（MIL-STD-2525D + APP-6 的机器可读版，
        里面每条 <LegacySymbol Label="S*GPUCI---*****"> 就是一个现成的 15 位 SIDC，
        和 map.army 的 Formations 用的是同一套标准表）
★ R10.32：玩家要求「只要长方形边框的，其它（拱形/半圆……）都不是武器装备」
        —— 所以只收**陆地单位**（2525C 第 3 位 = G，画出来是长方形框），
        空中 / 海面 / 水下 / 太空 / 设施 / 装备 / 活动 / 民用 全部不要；
        分类也改成**按兵种**（步兵 / 装甲兵 / 炮兵 … 见 GROUP_ORDER）。
用法：python -X utf8 tools/gen_ms_catalog.py
      会写出没翻译到的英文标签（tools/_ma/miss.txt），照着往 tools/zh_glossary.py 里补
"""
import io
import os
import re
import json
import collections
import xml.etree.ElementTree as ET

from zh_glossary import ZH_PHRASES, ZH_WORDS

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'ms-src', 'jmsml')
OUT = os.path.join(HERE, '..', 'js', 'ms-catalog.js')
NS = '{http://disa.mil/JointMilSyML.xsd}'

# 大类（顺序 = 面板里的标签顺序）
SETS = [
    ('land_unit', '陆地单位', 'Land_Unit.xml'),
    ('land_equipment', '陆地装备', 'Land_Equipment.xml'),
    ('land_installation', '陆地设施', 'Land_Installation.xml'),
    ('air', '空中', 'Air.xml'),
    ('air_missile', '空中导弹', 'Air_Missile.xml'),
    ('sea_surface', '海面', 'Sea_Surface.xml'),
    ('sea_subsurface', '水下', 'Sea_Subsurface.xml'),
    ('mine_warfare', '水雷战', 'Mine_Warfare.xml'),
    ('space', '太空', 'Space.xml'),
    ('space_missile', '太空导弹', 'Space_Missile.xml'),
    ('activity', '活动', 'Activity.xml'),
    ('cyberspace', '网络', 'Cyberspace.xml'),
    ('land_civilian', '民用', 'Land_Civilian.xml'),
]

# ★ R10.32：只保留陆地单位（见文件头说明），其余 12 个表不再读
KEEP_SETS = ('land_unit',)
SETS = [s for s in SETS if s[0] in KEEP_SETS]

# 子分类（2525D Entity）中文
ZH_ENTITY = {
    'Unspecified': '其他',
    'Command and Control': '指挥控制',
    'Movement and Maneuver': '机动',
    'Fires': '火力',
    'Protection': '防护',
    'Intelligence': '情报',
    'Information': '信息',
    'Sustainment': '保障',
    'Naval': '海军',
    'Named Headquarters': '建制司令部',
    'Emergency Operation': '应急行动',
    'Law Enforcement': '执法',
    'Weapon/Weapon System': '武器/武器系统',
    'Vehicle': '车辆',
    'Engineer Vehicles and Equipment': '工程车辆与装备',
    'Utility Vehicles': '通用车辆',
    'Train': '列车',
    'Civilian Vehicle': '民用车辆',
    'Pack Animals': '驮畜',
    'Missile Support': '导弹保障',
    'Other Equipment': '其他装备',
    'Land Mines': '地雷',
    'Sensors': '传感器',
    'Manual Track': '人工航迹',
    'Military': '军用',
    'Civilian': '民用',
    'Installation': '军事设施',
    'Infrastructure': '基础设施',
    'Military Combatant': '军用战斗舰艇',
    'Military Noncombatant': '军用辅助舰船',
    'Civilian Noncombatant': '民用船舶',
    'Incident': '事件',
    'Civil Disturbance': '内乱',
    'Operation': '行动',
    'Fire Event': '火灾',
    'Hazard Materials': '危险品',
    'Transportation Incident': '运输事故',
    'Natural Event': '自然灾害',
    'Criminal Activity Incident': '犯罪事件',
    'Emergency Medical Operation': '应急医疗',
    'Emergency Operation': '应急行动',
    'Own Ship': '本舰',
    'Sea Mine-General': '水雷·通用',
    'Sea Mine Decoy': '水雷诱饵',
    'Mine-Like Echo (MILEC)-General': '疑似水雷回波·通用',
    'Negative Reacquisition-General': '负重捕·通用',
    'Obstructor': '障碍物',
    'General Mine Anchor': '通用锚雷',
    'Non-Mine Mine-Like Object (NMLO)-General': '非水雷疑似目标·通用',
    'Dive Report Location': '潜水上报表位置',
    'Unexploded Ordnance': '未爆弹药',
    'Weapon': '武器',
    'Fixed-Wing': '固定翼',
    'Rotary-Wing': '旋翼',
    'Lighter Than Air': '轻于空气航空器',
    'Decoy': '诱饵',
    'Missile': '导弹',
    'Space': '太空',
    'Air': '空中',
    'Surface': '水面',
    'Subsurface': '水下',
}


# 这些修饰放名字**前面**（轻型步兵 / 空降野战炮兵）；其余放后面（通信区域）
PREFIX_MOD = (
    '轻型', '中型', '重型', '空降', '山地', '寒区', '摩托化', '两栖', '轮式', '履带',
    '牵引', '骑兵', '装甲', '自行', '无人', '教练', '侦察', '攻击', '特种', '战略',
    '战术', '远程', '近程', '中程', '高空', '低空', '增强', '数字', '远征', '扫雷',
    '布雷', '烟幕', '空中机动', '空中突击', '医疗', '补给', '运输', '搜索', '救援',
    '机械化', '军级', '战区级', '一类补给', '二类补给', '三类补给', '四类补给',
    '五类补给', '六类补给', '七类补给', '八类补给', '九类补给', '十类补给',
)


def clean(name):
    """把 2525C 标签里的 * 换成确定值：第 2 位（敌我）→ F，其余 → -"""
    out = []
    for i, ch in enumerate(name):
        if ch == '*':
            out.append('F' if i == 1 else '-')
        else:
            out.append(ch)
    return ''.join(out)


def norm(label):
    return re.sub(r'\s+', ' ', (label or '').replace('\u00a0', ' ')).strip()


def translate(label):
    """整条短语 → 逐词拼 → 失败返回 None"""
    label = norm(label)
    if not label:
        return ''
    if label in ZH_PHRASES:
        return ZH_PHRASES[label]
    parts = re.findall(r'\(([^)]*)\)', label)
    txt = re.sub(r'\([^)]*\)', ' ', label)
    words = re.findall(r"[A-Za-z0-9'\-\./]+", txt)
    zh = []
    for w in words:
        hit = ZH_WORDS.get(w)
        if hit is None and len(w) > 3 and w.endswith('s'):
            hit = ZH_WORDS.get(w[:-1])
        if hit is None and len(w) > 4 and w.endswith('es'):
            hit = ZH_WORDS.get(w[:-2])
        if hit is None:
            return None
        zh.append(hit)
    if not zh:
        return None
    extra = []
    for p in parts:
        pz = ZH_PHRASES.get(p) or ZH_WORDS.get(p)
        if pz:
            extra.append(pz)
    return ''.join(zh) + (('（' + '·'.join(extra) + '）') if extra else '')


# ★ R10.32：兵种分组（顺序 = 面板里小标题的顺序）
#   原来是 2525 的「指挥控制/机动/火力/防护/情报/保障」六分区——玩家看不懂，
#   改成按**兵种**。判定用 JMSML 的 Entity / EntityType 英文名（比中文名可靠）。
GROUP_ORDER = [
    '指挥与政工', '步兵', '装甲兵', '炮兵', '反坦克', '防空兵', '陆军航空兵',
    '侦察兵', '特种作战', '工程兵', '防化兵', '通信兵', '情报与电子战',
    '气象与测绘', '警备与宪兵', '医疗卫勤', '补给与维修', '运输与投送',
    '人事与行政', '其他',
]


GROUP_ID = {
    '指挥与政工': 'lu_cmd', '步兵': 'lu_infantry', '装甲兵': 'lu_armor',
    '炮兵': 'lu_artillery', '反坦克': 'lu_antitank', '防空兵': 'lu_airdef',
    '陆军航空兵': 'lu_aviation', '侦察兵': 'lu_recon', '特种作战': 'lu_sof',
    '工程兵': 'lu_engineer', '防化兵': 'lu_cbrn', '通信兵': 'lu_signal',
    '情报与电子战': 'lu_intel', '气象与测绘': 'lu_meteo', '警备与宪兵': 'lu_mp',
    '医疗卫勤': 'lu_medical', '补给与维修': 'lu_supply', '运输与投送': 'lu_transport',
    '人事与行政': 'lu_admin', '其他': 'lu_other',
}


def group_of(ent, typ):
    """Entity（作战职能）+ EntityType → 兵种分组"""
    e = (ent or '').lower().strip()
    t = (typ or '').lower().strip()

    def sw(*ks):
        return t.startswith(ks)

    if e == 'command and control':
        if sw('signal', 'tactical satellite'):
            return '通信兵'
        return '指挥与政工'                      # 民事 / 军事信息支援（心理战）
    if e == 'movement and maneuver':
        if sw('infantry'):
            return '步兵'
        if sw('armor'):
            return '装甲兵'
        if sw('antitank'):
            return '反坦克'
        if sw('army aviation', 'aviation', 'unmanned aerial'):
            return '陆军航空兵'
        if sw('reconnaissance'):
            return '侦察兵'
        if sw('special', 'sea air land'):
            return '特种作战'
        return '其他'                            # 两栖登陆支援 / 战斗部队
    if e == 'fires':
        if sw('air defense'):
            return '防空兵'
        if sw('meteorological', 'survey'):
            return '气象与测绘'
        return '炮兵'                            # 野战炮兵 / 迫击炮 / 导弹 / 炮侦 / 舰炮联络
    if e == 'intelligence':
        return '情报与电子战'
    if e == 'protection':
        if sw('chemical'):
            return '防化兵'
        if sw('engineer', 'explosive ordnance'):
            return '工程兵'
        if sw('security', 'military police', 'shore patrol', 'criminal investigation'):
            return '警备与宪兵'
        return '其他'                            # 机动增强 / 消防
    if e == 'sustainment':
        if sw('medical'):
            return '医疗卫勤'
        if sw('transportation', 'airport', 'sea port', 'railhead'):
            return '运输与投送'
        if sw('maintenance', 'supply', 'us supply class', 'ordnance',
              'quartermaster', 'water'):
            return '补给与维修'
        return '人事与行政'                      # 行政/财务/军法/邮政/宗教/殡葬…
    if e == 'law enforcement':
        return '警备与宪兵'
    return '其他'


def main():
    missing = collections.Counter()
    by_set = collections.OrderedDict()
    total = 0

    for set_id, set_zh, fname in SETS:
        path = os.path.join(SRC, fname)
        if not os.path.exists(path):
            continue
        root = ET.parse(path).getroot()

        ent_lab, type_lab, sub_lab, mod_lab = {}, {}, {}, {}
        for e in root.iter(NS + 'Entity'):
            ent_lab[e.attrib.get('ID')] = norm(e.attrib.get('Label'))
        for e in root.iter(NS + 'EntityType'):
            type_lab[e.attrib.get('ID')] = norm(e.attrib.get('Label'))
        for e in root.iter(NS + 'EntitySubType'):
            sub_lab[e.attrib.get('ID')] = norm(e.attrib.get('Label'))
        for sec in ('SectorOneModifiers', 'SectorTwoModifiers'):
            for s in root.iter(NS + sec):
                for m in s.iter(NS + 'Modifier'):
                    mod_lab[m.attrib.get('ID')] = norm(m.attrib.get('Label'))

        subs = collections.OrderedDict()
        seen = set()
        for ls in root.iter(NS + 'LegacySymbol'):
            label = ls.attrib.get('Label') or ''
            if len(label) != 15:
                continue
            if '*' in label[2:10]:          # 功能码里还有星号 = 不是具体符号
                continue
            sidc = clean(label)
            # ★ R10.32：只要「长方形框」的陆地单位——维度 G（地面）和 F（特种作战，同样是矩形框）。
            #   空中(A)/太空(P)/海面(S)/水下(U) 以及 E 开头的应急管理符号一律不进库。
            #   注意：milsymbol 不认 2525C 的 F 维度，会退化成一个只写「SF」的空框，
            #   所以还是先收进来，再由 tools/build_catalog.js 把第 3 位统一改成 G。
            if sidc[0] != 'S' or sidc[2] not in ('G', 'F'):
                continue
            if sidc in seen:
                continue
            seen.add(sidc)

            eid = ls.attrib.get('EntityID')
            type_en = type_lab.get(ls.attrib.get('EntityTypeID')) or ''
            sub_en = sub_lab.get(ls.attrib.get('EntitySubTypeID')) or ''
            mods_en = [mod_lab.get(ls.attrib.get('ModifierOneID')) or '',
                       mod_lab.get(ls.attrib.get('ModifierTwoID')) or '']
            ent_name = ent_lab.get(eid) or ''
            if type_en == 'Unspecified':
                type_en = ''
            if sub_en == 'Unspecified':
                sub_en = ''
            mods_en = [m for m in mods_en if m and m != 'Unspecified']

            base_en = sub_en or type_en or ent_name
            if not base_en:
                continue
            # 子类只是"轻型/中型/重型"这类限定词时，它算修饰，主体退回上一级
            sub_zh0 = translate(sub_en) if sub_en else ''
            if sub_en and sub_zh0 and sub_zh0.startswith(PREFIX_MOD) and (type_en or ent_name):
                mods_en = [sub_en] + mods_en
                base_en = type_en or ent_name
            # 名字 = 修饰 + 主体（中文习惯：轻型 + 步兵 = 轻型步兵），
            # "轻型/空降/山地…"放前面，其它修饰（区域/应急包…）跟后面
            base_zh = translate(base_en) or ''
            front, back = [], []
            for m in mods_en:
                z = translate(m)
                if not z:
                    continue
                if z.startswith(PREFIX_MOD):
                    front.append(z)
                else:
                    back.append(z)
            name_zh = ''.join(front) + base_zh + ''.join(back)
            # 去掉「通信通信应急包」这种相邻重复
            prev = None
            while prev != name_zh:
                prev = name_zh
                name_zh = re.sub(r'(.{2,8})\1', r'\1', name_zh)
            if not name_zh:
                missing[' '.join(mods_en + [base_en])] += 1
                name_zh = ' '.join(mods_en + [base_en])
            # 「步兵海军 / 工兵海军」→「海军步兵 / 海军工兵」
            if name_zh.endswith('海军') and len(name_zh) > 2:
                name_zh = '海军' + name_zh[:-2]
            sub_name = group_of(ent_name, type_en)
            subs.setdefault(sub_name, []).append({'n': name_zh, 's': sidc})
            total += 1

        by_set[set_id] = {'id': set_id, 'n': set_zh, 'subs': subs}

    # 先写 JSON（结构 + 中文名 + SIDC），再由 tools/build_catalog.js 校验/修正 SIDC 并写 js/ms-catalog.js
    os.makedirs(os.path.join(HERE, '_ma'), exist_ok=True)
    # ★ R10.32：面板要「一个兵种一个页签」，所以这里一类就输出一个兵种
    data = []
    for st in by_set.values():
        for k in GROUP_ORDER:
            items = st['subs'].get(k)
            if not items:
                continue
            data.append({'id': GROUP_ID[k], 'n': k, 'subs': [{'n': k, 'items': items}]})
    io.open(os.path.join(HERE, '_ma', 'catalog.json'), 'w', encoding='utf-8').write(
        json.dumps(data, ensure_ascii=False, indent=1))

    print('sets %d  items %d  missing-labels %d (%d items)' %
          (len(by_set), total, len(missing), sum(missing.values())))
    io.open(os.path.join(HERE, '_ma', 'miss.txt'), 'w', encoding='utf-8').write(
        '\n'.join('%s\t%d' % (k, v) for k, v in missing.most_common()))


if __name__ == '__main__':
    main()
