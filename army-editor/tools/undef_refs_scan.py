# -*- coding: utf-8 -*-
"""undef_refs_scan.py —— 【诊断工具，不属于 9 套离线测试】（不进 CI 判定）

干什么：扫 js/*.js（+ 各 .html 的内联脚本），找出"**被使用、但全项目从未声明**"的标识符。
         专治"删函数/删系统时漏掉调用点留下的残骸"——这类残留的表现是
         **运行到那一行才抛 ReferenceError**，而它可能挂在主循环/绘制里 ⇒ 整场冻住。

为什么写它：R7 删掉旧的乘车/路线决策层后，`drawNavPanel()` 里漏了一个 `rc`
         （旧"车代价/步代价"比较的局部变量）⇒ 按 P 或拖动窗口（resize ⇒ 重绘）
         就抛 `ReferenceError: rc is not defined` ⇒ 主循环的 requestAnimationFrame
         不再执行 ⇒ **单位全部不动**。这种 bug 看代码很难发现，扫一遍就出来了。
         顺手还逮到 3 个老 bug：`getEquipment`（装备选择弹窗点了没反应）、
         `ROUTE_SUFFIX`（打开含 routes 的老地图 ⇒ 编辑器绘制崩）、`root_node`（恒真死条件）。

怎么跑：python -X utf8 tools/undef_refs_scan.py
        （PowerShell 重定向容易变 UTF-16，所以同时把报告写到 tools/undef_refs_last.txt）

判定：输出 `OK：没有未声明的标识符` = 干净；否则逐条列出 `文件 行号 名字`，人工判断真伪。

原理：① 逐字符词法器把注释/字符串/模板串/正则体替换成空格（保留换行 ⇒ 行号不变）；
      ② 收集声明（function/var-let-const 多声明符/参数/catch/箭头/方法/隐式全局/window.X）；
      ③ 收集使用（排除 `.属性`、`{键:}`，三元 `a ? b : c` 除外）；
      ④ 差集 = 可疑。声明**跨文件汇总**（这些 js 都是普通脚本，共享全局作用域）。

已知局限：词法器是启发式的（正则/除号按上下文猜、模板插值按花括号配平）。
        每个文件跑完会自检"词法状态是否归位"，未归位的会在报告里以 `!!` 标出
        ⇒ 那种文件的结论偏保守（可能少报，不会误报）。
"""
import sys, io, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js')

BUILTINS = set("""
window document navigator location history screen console Math JSON Object Array String Number Boolean
Date RegExp Error TypeError RangeError EvalError SyntaxError ReferenceError Map Set WeakMap WeakSet Promise
Proxy Reflect Symbol BigInt Infinity NaN undefined this super new typeof instanceof in of delete void yield
await async function return if else for while do switch case default break continue try catch finally throw
class extends static get set let const var
requestAnimationFrame cancelAnimationFrame setTimeout setInterval clearTimeout clearInterval queueMicrotask
structuredClone performance alert confirm prompt fetch Request Response Headers FormData AbortController
URL URLSearchParams Blob File FileReader Image Audio AudioContext
HTMLCanvasElement ImageData CanvasRenderingContext2D OffscreenCanvas createImageBitmap Path2D DOMParser
XMLSerializer DOMException
localStorage sessionStorage indexedDB caches crypto atob btoa TextEncoder TextDecoder
Float64Array Float32Array Int32Array Int16Array Int8Array Uint8Array Uint16Array Uint32Array Uint8ClampedArray
ArrayBuffer DataView BigInt64Array BigUint64Array
getComputedStyle matchMedia devicePixelRatio innerWidth innerHeight addEventListener removeEventListener
dispatchEvent CustomEvent Event KeyboardEvent MouseEvent PointerEvent TouchEvent WheelEvent DragEvent
isNaN isFinite parseFloat parseInt encodeURIComponent decodeURIComponent encodeURI decodeURI
escape unescape globalThis arguments eval
true false null
""".split())

IDENT_RE = re.compile(r'(?<![\w$.])([A-Za-z_$][\w$]*)')

_REGEX_AFTER_WORD = set("""return typeof instanceof in of new delete void do else case yield await""".split())
_last_state = []                 # 每次 blank_literals 之后记录残留的词法状态（自检用）
_REGEX_AFTER_CH = set("(,=:[!&|?{};+-*%~^<>")

def regex_can_start(prev_ch, last_word):
    """`/` 是正则还是除号：看前面是"值结束"还是"期待值"。"""
    if last_word in _REGEX_AFTER_WORD:
        return True
    return prev_ch == '' or prev_ch in _REGEX_AFTER_CH

def blank_literals(src):
    """注释 / 字符串内容 → 空格（保留换行）。
    ★ 必须支持**模板串里的 ${} 插值**（插值里的代码要照旧参与分析），
      否则形如 `a${x ? `b${y}` : ''}` 的嵌套模板会把后面一大段真代码误当字符串。"""
    out, i, n = [], 0, len(src)
    state, exc = ['code'], []        # state 栈 + 插值的花括号深度
    prev_ch, word, last_word, in_class = '', '', '', False
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        st = state[-1]
        if st == 'code':
            if c == '/' and nxt == '/':
                out.append('  '); i += 2; state.append('//'); continue
            if c == '/' and nxt == '*':
                out.append('  '); i += 2; state.append('/*'); continue
            if c == '/' and regex_can_start(prev_ch, last_word):
                out.append(' '); i += 1; in_class = False; state.append('regex'); continue
            if c in '\'"':
                out.append(' '); i += 1; prev_ch = ')'; word = ''; last_word = ''; state.append(c); continue
            if c == '`':
                out.append(' '); i += 1; prev_ch = ')'; word = ''; last_word = ''; state.append('`'); continue
            if exc:
                if c == '{':
                    exc[-1] += 1
                elif c == '}':
                    exc[-1] -= 1
                    if exc[-1] == 0:
                        exc.pop(); state.pop(); out.append(' '); i += 1; continue
            if c.isalnum() or c in '_$':
                word += c
            elif word:
                last_word = word; word = ''
            if not c.isspace():
                prev_ch = c
            out.append(c); i += 1; continue
        if st == '//':
            out.append(c if c == '\n' else ' '); i += 1
            if c == '\n':
                state.pop()
            continue
        if st == '/*':
            if c == '*' and nxt == '/':
                out.append('  '); i += 2; state.pop(); continue
            out.append('\n' if c == '\n' else ' '); i += 1; continue
        if st in ('"', "'"):
            if c == '\\':
                out.append('  '); i += 2; continue
            if c == st:
                out.append(' '); i += 1; state.pop(); continue
            out.append('\n' if c == '\n' else ' '); i += 1; continue
        if st == 'regex':                        # 正则字面量（按"期待值"位置识别）
            if c == '\\':
                out.append('  '); i += 2; continue
            if c == '\n':                        # 没闭合 ⇒ 其实是除号，退回代码
                out.append('\n'); i += 1; state.pop(); continue
            if c == '[':
                in_class = True
            elif c == ']':
                in_class = False
            elif c == '/' and not in_class:
                out.append(' '); i += 1; prev_ch = ')'; word = ''; last_word = ''
                state.pop(); continue
            out.append(' '); i += 1; continue
        # 模板串
        if c == '\\':
            out.append('  '); i += 2; continue
        if c == '`':
            out.append(' '); i += 1; state.pop(); continue
        if c == '$' and nxt == '{':
            out.append('  '); i += 2; exc.append(1); state.append('code'); continue
        out.append('\n' if c == '\n' else ' '); i += 1
    _last_state.append(list(state))
    return ''.join(out)


def split_top(seg):
    """按最外层逗号切分（忽略括号/花括号里的逗号）。"""
    parts, cur, depth = [], '', 0
    for ch in seg:
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(cur); cur = ''
        else:
            cur += ch
    parts.append(cur)
    return parts

def decl_names(seg):
    """把 `a = 1, b, {c: d} = o` 这类声明串变成 {a, b, d}。"""
    names = set()
    for p in split_top(seg):
        q = p
        m = re.search(r'(?<![=!<>+\-*/])=(?!=)', q)     # 第一个赋值等号
        if m:
            q = q[:m.start()]
        else:
            m2 = re.search(r'\b(?:of|in)\b', q)
            if m2:
                q = q[:m2.start()]
        q = re.sub(r'\b[A-Za-z_$][\w$]*\s*:', '', q)     # 去掉 {k: v} 的键
        names |= set(re.findall(r'[A-Za-z_$][\w$]*', q))
    return names

def params_of(text, start):
    depth, i, names = 0, start, set()
    while i < len(text):
        if text[i] == '(':
            depth += 1
        elif text[i] == ')':
            depth -= 1
            if depth == 0:
                break
        i += 1
    for m in re.finditer(r'[A-Za-z_$][\w$]*', text[start + 1:i]):
        names.add(m.group(0))
    return names

def declared_of(code):
    d = set()
    for m in re.finditer(r'\bfunction\s+([A-Za-z_$][\w$]*)\s*\(', code):
        d.add(m.group(1))
        d |= params_of(code, code.index('(', m.start(1)))
    for m in re.finditer(r'\bfunction\s*\(', code):
        d |= params_of(code, code.index('(', m.start()))
    for m in re.finditer(r'\bcatch\s*\(([^)]*)\)', code):
        d |= set(re.findall(r'[A-Za-z_$][\w$]*', m.group(1)))
    for m in re.finditer(r'\b(?:var|let|const)\s+([^;\n]*)', code):
        d |= decl_names(m.group(1))
    for m in re.finditer(r'(?:^|[;{}\n)])\s*([A-Za-z_$][\w$]*)\s*=(?!=)', code):
        d.add(m.group(1))                       # 隐式全局 / 重新赋值
    for m in re.finditer(r'\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=', code):
        d.add(m.group(1))
    for m in re.finditer(r'\bclass\s+([A-Za-z_$][\w$]*)', code):
        d.add(m.group(1))
    for m in re.finditer(r'([A-Za-z_$][\w$]*)\s*=>', code):
        d.add(m.group(1))
    for m in re.finditer(r'\(([^()]*)\)\s*=>', code):
        d |= set(re.findall(r'[A-Za-z_$][\w$]*', m.group(1)))
    for m in re.finditer(r'\b([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{', code):
        d.add(m.group(1))                       # 对象简写方法 / 类方法
        # ★ 简写方法的**形参**以前漏收 ⇒ cmd.js 的 `issue(src, gk, type, p)` / `clear(gk, why)`
        #   之类的参数会被误报成"未声明的标识符"。这里补上。
        d |= params_of(code, code.index('(', m.start(1)))
    return d

def used_of(code):
    u = {}
    for m in IDENT_RE.finditer(code):
        name, p = m.group(1), m.start(1)
        nxt = code[m.end(1):m.end(1) + 40]
        prev = code[:p].rstrip()
        pc = prev[-1] if prev else ''
        ns = nxt.lstrip()
        if ns.startswith(':') and not ns.startswith('::') and \
           (pc in '{,' or '?' not in code[max(0, p - 60):p]):
            continue                            # 对象字面量的键 / 标签（三元 `a ? b : c` 除外）
        if ns.startswith('(') and pc in '{,':
            continue                            # 简写方法定义（已计入声明）
        u.setdefault(name, code.count('\n', 0, p) + 1)
    return u

files = {}
all_declared = set()
raw_declared = set()
for fn in sorted(os.listdir(ROOT)):
    if not fn.endswith('.js'):
        continue
    raw = open(os.path.join(ROOT, fn), encoding='utf-8', errors='replace').read()
    all_declared |= declared_of(blank_literals(raw))
    # ★ 兜底：不依赖词法器，直接在原文里找声明（跨文件引用一律算已声明，
    #   这样剩下的才是"全项目都查无此名"的真残留，比如 rc）
    raw_declared |= set(re.findall(r'\b(?:function|class|var|let|const)\s+([A-Za-z_$][\w$]*)', raw))
    raw_declared |= set(re.findall(r'\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=', raw))
# ★ 页面内联脚本与 js 共享同一全局作用域（welcomeModal/saveModal 这类就定义在 index.html 里）
PAGES = os.path.normpath(os.path.join(ROOT, '..'))
for fn in sorted(os.listdir(PAGES)):
    if not fn.endswith('.html'):
        continue
    raw = open(os.path.join(PAGES, fn), encoding='utf-8', errors='replace').read()
    raw_declared |= set(re.findall(r'\b(?:function|class|var|let|const)\s+([A-Za-z_$][\w$]*)', raw))
    raw_declared |= set(re.findall(r'\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=', raw))
merged = all_declared | raw_declared

report = []
for fn in sorted(os.listdir(ROOT)):
    if not fn.endswith('.js'):
        continue
    code = blank_literals(open(os.path.join(ROOT, fn), encoding='utf-8', errors='replace').read())
    lex_left = _last_state[-1]
    if lex_left != ['code']:
        report.append('!! %s 词法器状态残留 %s（该文件可能有代码被误当字符串 ⇒ 结果偏保守）'
                      % (fn, lex_left))
    bad = {k: v for k, v in used_of(code).items() if k not in merged and k not in BUILTINS}
    if not bad:
        continue
    report.append('== ' + fn + ' ==')
    for k, line in sorted(bad.items(), key=lambda kv: kv[1]):
        report.append('  %-30s line %s' % (k, line))
report.append('OK：没有未声明的标识符' if not report else '发现可疑标识符（逐条判断真伪）')
txt = '\n'.join(report)
print(txt)
with io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'undef_refs_last.txt'), 'w', encoding='utf-8') as f:
    f.write(txt + '\n')

