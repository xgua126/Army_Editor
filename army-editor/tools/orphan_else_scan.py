# -*- coding: utf-8 -*-
"""orphan_else_scan.py —— 【诊断工具，不属于离线测试套件】抓「删掉 if 分支却留下 else」的语法残骸。

真实事故（R8 → 玩家复现）：
    地图编辑器里原本是
        if (XXX) { ... }                       ← 删「🛣 路线」工具时被整行删掉
        else if (roadDraw) { ... }
        else if (spawnDraw) { ... }
    第一行没了、后面两行还挂着 ⇒ 浏览器抛 `Uncaught SyntaxError: Unexpected token 'else'`
    （map-editor.js:1431）⇒ **整份 map-editor.js 不执行** ⇒ 编辑器界面看着在、
    点「保存 / 导入参考图」全无反应。运行时不会崩，所以光看控制台只有一行，很难定位。

    同类事故在 TODO §38~§40 已记录过一次（"按函数名批量删代码"必须用词法级扫描器），
    本工具就是那套"三件套"里缺的一件（另外两件：js_literal_check.py 管引号，
    undef_refs_scan.py 管"用了但没声明"）。

判据（词法级：注释 / 字符串 / 模板串 / 正则体先替换成空格，行号保持不变）：
  ① `else` 的前一个「有意义 token」是 `{`  ⇒ 一定是残骸（后面的 else 丢了 if/else-if）
  ② `else` 的前一个「有意义 token」不是 `}` / `;` ⇒ 疑似残骸（本项目一律带花括号，
     所以这条在本仓库里也当失败；如果以后写了 `if (a) foo()\nelse bar()` 这种无花括号体，
     会误报 —— 报出来人工看一眼即可）

跑法：python -X utf8 tools/orphan_else_scan.py
      python -X utf8 tools/orphan_else_scan.py --selftest    （验证扫描器本身有效）
"""
import sys, os, io, re, bisect

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js')
_AFTER_WORD = set("""return typeof instanceof in of new delete void do else case yield await""".split())
_AFTER_CH = set("(,=:[!&|?{};+-*%~^<>")


def strip(src):
    """把注释 / 字符串 / 模板串 / 正则体替换成空格（保留换行 ⇒ 行号不变）"""
    out, i, n = [], 0, len(src)
    prev_ch, word, last_word = '', '', ''
    in_class = False
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '/' and nxt == '/':
            while i < n and src[i] != '\n':
                out.append(' '); i += 1
            continue
        if c == '/' and nxt == '*':
            out.append(' '); out.append(' '); i += 2
            while i < n and not (src[i] == '*' and i + 1 < n and src[i + 1] == '/'):
                out.append('\n' if src[i] == '\n' else ' '); i += 1
            if i < n:
                out.append(' '); out.append(' '); i += 2
            continue
        if c == '/' and (last_word in _AFTER_WORD or prev_ch in _AFTER_CH):
            out.append(' '); i += 1; in_class = False
            while i < n:
                d = src[i]
                if d == '\\':
                    out.append(' ')
                    out.append('\n' if i + 1 < n and src[i + 1] == '\n' else ' ')
                    i += 2; continue
                if d == '\n':
                    break
                if d == '[':
                    in_class = True
                elif d == ']':
                    in_class = False
                elif d == '/' and not in_class:
                    out.append(' '); i += 1; break
                out.append(' '); i += 1
            prev_ch = ')'
            continue
        if c in '\'"`':
            q = c; out.append(' '); i += 1
            while i < n:
                d = src[i]
                if d == '\\':
                    out.append(' ')
                    out.append('\n' if i + 1 < n and src[i + 1] == '\n' else ' ')
                    i += 2; continue
                if d == q:
                    out.append(' '); i += 1; break
                out.append('\n' if d == '\n' else ' '); i += 1
            prev_ch = ')'
            continue
        if c.isalnum() or c in '_$':
            word += c
        elif word:
            last_word, word = word, ''
        if not c.isspace():
            prev_ch = c
        out.append(c); i += 1
    return ''.join(out)


def scan_text(src):
    """返回 [(行号, 原因), …]"""
    code = strip(src)
    line_of = [1]
    for idx, ch in enumerate(code):
        if ch == '\n':
            line_of.append(idx + 2)
    bad = []
    for m in re.finditer(r'\belse\b', code):
        head = code[:m.start()].rstrip()
        prev = head[-1] if head else ''
        ln = bisect.bisect_right(line_of, m.start())
        if prev == '{':
            bad.append((ln, '① `{` 后紧跟 `else` —— 前面的 if 分支被删掉了'))
        elif prev not in '};':
            bad.append((ln, '② `else` 前面是「%s」—— 疑似残骸' % (prev or '文件开头')))
    return bad


def scan(path):
    return scan_text(open(path, encoding='utf-8', errors='replace').read())


SELFTEST_BAD = """
function bind() {
  if (rightPress && !rightPress.moved) {
    else if (roadDraw) { cancelRoad(); render(); }
    else if (spawnDraw) { cancelSpawn(); render(); }
  }
}
"""

SELFTEST_GOOD = """
function bind() {
  if (rightPress && !rightPress.moved) {
    if (roadDraw) { cancelRoad(); render(); }
    else if (spawnDraw) { cancelSpawn(); render(); }
  }
  if (a) { x(); } else { y(); }
  if (b) x(); else y();
}
"""


def selftest():
    bad = scan_text(SELFTEST_BAD)
    good = scan_text(SELFTEST_GOOD)
    ok1 = len(bad) == 1 and bad[0][0] == 4
    ok2 = [w for _, w in good if w.startswith('①')] == []
    print('  自检① 坏样本被抓到（行 4 的 `{` 后 else）：%s  %s'
          % ('OK' if ok1 else 'FAIL', bad))
    print('  自检② 好样本不误报「`{` 后 else」：%s' % ('OK' if ok2 else 'FAIL'))
    return 0 if (ok1 and ok2) else 1


def main(argv):
    if '--selftest' in argv:
        return selftest()
    files = [f for f in sorted(os.listdir(JS)) if f.endswith('.js')]
    total = 0
    for f in files:
        bad = scan(os.path.join(JS, f))
        if bad:
            total += len(bad)
            print('FAIL %s' % f)
            for ln, why in bad:
                print('   line %d  %s' % (ln, why))
        else:
            print('OK   %s' % f)
    print('没有孤儿 else ✓' if not total else '%d 处可疑 ✗' % total)
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
