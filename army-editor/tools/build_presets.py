# -*- coding: utf-8 -*-
"""build_presets.py —— **官方地图池构建工具**（换图时重跑一次即可）
   ① 体检三张自制地图 JSON（结构 / 体积构成）
   ② --write：生成 js/maps-presets.js（内联）+ 删掉 grid-maps.js 里的旧预设块
跑法：python -X utf8 tools/build_presets.py [--write]

用法（以后要换官方图）：
   1. 把新的导出 JSON 放到 army-editor/ 下（覆盖同名文件，或改下面的 SPECS）
   2. python -X utf8 tools/build_presets.py --write
   3. 刷新页面即可（html 里的下拉框会自动列出来 —— 它读的是 GRID_MAPS）
"""
import sys, io, os, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                    # army-editor/
JS = os.path.join(ROOT, 'js')
WRITE = '--write' in sys.argv

SPECS = [
    ('巴斯通涅 (1).json', 'bastogne',    '巴斯通涅'),
    ('立交桥 (1).json',   'interchange', '立交桥'),
    ('卡朗唐.json',       'carentan',    '卡朗唐'),
]

print('== ① 体检 ==')
objs = []
for fn, mid, name in SPECS:
    p = os.path.join(ROOT, fn)
    d = json.load(open(p, encoding='utf-8'))
    gw, gh = -(-d['w'] // d['cellSize']), -(-d['h'] // d['cellSize'])
    print('  %-20s %s×%s m · 格 %s×%s (%s万格)' % (fn, d['w'], d['h'], gw, gh, round(gw * gh / 1e4, 1)))
    print('       keys = %s' % list(d.keys()))
    for L in (d.get('layers') or []):
        print('       layer「%s」visible=%s rle=%d 个数' % (L.get('name'), L.get('visible'), len(L.get('rle') or [])))
    print('       routes=%s spawns=%s roads=%d 据点=%d 建筑=%d 补给=%d'
          % ('无' if not d.get('routes') else len(d['routes']),
             '无' if not d.get('spawns') else {k: (len(v) if isinstance(v, list) else v) for k, v in d['spawns'].items()},
             len(d.get('roads') or []), len(d.get('objectives') or []),
             len(d.get('buildings') or []), len(d.get('supplies') or [])))
    for tag in ('pretty', 'compact'):
        s = json.dumps(d, ensure_ascii=False) if tag == 'pretty' else json.dumps(d, ensure_ascii=False, separators=(',', ':'))
        print('       %s = %.0f KB' % (tag, len(s.encode('utf-8')) / 1024))
    d['id'] = mid
    d['name'] = name
    d.pop('routes', None)          # R8 起路线系统已删；这个字段没人读，纯占体积
    objs.append(d)

if not WRITE:
    print('\n（体检模式：没有写任何文件；加 --write 才生成）')
    sys.exit(0)

print('\n== ② 生成 js/maps-presets.js ==')
lines = []
for o in objs:
    lines.append('  ' + json.dumps(o, ensure_ascii=False, separators=(',', ':')))
body = ',\r\n'.join(lines)
head = (
"/* ============================================================\r\n"
"   maps-presets.js —— **官方地图池**（玩家自制地图，原样内联）\r\n"
"   ------------------------------------------------------------\r\n"
"   · 为什么是 .js 不是 .json：游戏是**双击 html 直接打开**的（file://），\r\n"
"     浏览器会拦掉 fetch / xhr 读本地 json（CORS）⇒ 官方图必须写进脚本里。\r\n"
"   · 由 `grid-maps.js` 的 `initGridMaps()` 调 `deserializeGridMap()` 反序列化进 GRID_MAPS。\r\n"
"   · 数据 = 地图编辑器「⬇ 导出」的 JSON 原样内联（只去掉没人读的旧 `routes` 字段）。\r\n"
"     要换图：在地图编辑器里导出 → 覆盖这里的对应项即可（或用 tools/build_presets.py 重生成）。\r\n"
"   ============================================================ */\r\n"
"const GRID_MAP_PRESETS = [\r\n"
)
tail = "\r\n];\r\n"
dst = os.path.join(JS, 'maps-presets.js')
with open(dst, 'w', encoding='utf-8', newline='') as f:
    f.write(head + body + tail)
print('  写入 %s（%.0f KB）' % (dst, os.path.getsize(dst) / 1024))

print('\n== ③ 删掉 grid-maps.js 里的旧预设（4 个 make*Map + 旧注册） ==')
gp = os.path.join(JS, 'grid-maps.js')
src = open(gp, encoding='utf-8', newline='').read()
A1 = '/* ============================================================\r\n   预设地图'
A2 = '/* ============================================================\r\n   兼容层：绘制函数写入'
i1, i2 = src.find(A1), src.find(A2)
assert i1 != -1 and i2 != -1 and i2 > i1, '锚点没找到'
old = src[i1:i2]
if 'makeStalingradMap' not in old:
    # 已经跑过一次（旧预设块被换成了 loadPresetMaps）⇒ 只更新 maps-presets.js 就够
    print('  旧预设块已经删过了 ⇒ 只更新 maps-presets.js，跳过这一步')
    print('\n完成。')
    sys.exit(0)
assert 'makeStalingradMap' in old and 'makeKoreaMap' in old and 'makeInterchangeMap' in old, '切到的不是旧预设块'
new_block = (
"/* ============================================================\r\n"
"   预设地图（**官方地图池** = js/maps-presets.js，由地图编辑器导出）\r\n"
"   ------------------------------------------------------------\r\n"
"   ★ R9.6.10：旧的 4 张\"代码生成预设\"（立交桥 / 斯大林格勒 / 库尔斯克 / 朝鲜丘陵）**整体删除**，\r\n"
"     改为加载三张**实景自制图**：巴斯通涅(9×5km) · 立交桥(5×2.5km) · 卡朗唐(8×4.5km)。\r\n"
"     这里只负责反序列化 —— 地图数据全在 maps-presets.js 里，改图不用动这个文件。\r\n"
"   ============================================================ */\r\n"
"function loadPresetMaps() {\r\n"
"  const list = (typeof GRID_MAP_PRESETS !== 'undefined' && Array.isArray(GRID_MAP_PRESETS))\r\n"
"    ? GRID_MAP_PRESETS : [];\r\n"
"  list.forEach(obj => {\r\n"
"    try {\r\n"
"      const gm = deserializeGridMap(obj);\r\n"
"      gm._isUserMap = false;              // ★ 官方地图（编辑器里不可删、下拉框里分组不同）\r\n"
"      GRID_MAPS[gm.id] = gm;\r\n"
"    } catch (e) { console.warn('官方地图加载失败：', obj && obj.id, e); }\r\n"
"  });\r\n"
"}\r\n"
"\r\n"
)
src = src[:i1] + new_block + src[i2:]
old_init = (
"(function initGridMaps() {\r\n"
"  GRID_MAPS.interchange = makeInterchangeMap();\r\n"
"  GRID_MAPS.stalingrad  = makeStalingradMap();\r\n"
"  GRID_MAPS.kursk       = makeKurskMap();\r\n"
"  GRID_MAPS.korea       = makeKoreaMap();\r\n"
"  loadUserMapsIntoMemory();\r\n"
"})();"
)
new_init = (
"(function initGridMaps() {\r\n"
"  loadPresetMaps();           // ★ R9.6.10：官方地图池（maps-presets.js）\r\n"
"  loadUserMapsIntoMemory();   // 编辑器里存过的用户地图（localStorage）\r\n"
"})();"
)
assert src.count(old_init) == 1, 'initGridMaps 锚点不唯一'
src = src.replace(old_init, new_init)
with open(gp, 'w', encoding='utf-8', newline='') as f:
    f.write(src)
print('  grid-maps.js：删掉 %d 字符（%d 行），并改写 initGridMaps' % (len(old), old.count('\n')))
print('\n完成。')
