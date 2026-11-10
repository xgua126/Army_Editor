# -*- coding: utf-8 -*-
"""js_literal_check.py —— 字符串字面量体检（专治"一个没转义的引号 ⇒ 整个文件解析失败"）

为什么写它（真实事故）：
  `changelog.js` 里写了 `` `stance==='static'` ``（**单引号没转义**）⇒
  **整个 changelog.js 解析失败** ⇒ 文件里的 `VERSION` 未定义 ⇒
  index.html 的内联脚本在第 439 行抛 `VERSION is not defined` ⇒
  它后面的 `const welcomeModal` 也没执行 ⇒ ui.js 再抛一次 `welcomeModal is not defined`。
  **一个字符、三个报错**，而且屏上完全看不出是哪个文件坏了。

  这类 bug 用 `undef_refs_scan.py` 抓不到 —— 它把 `static` 当 JS 关键字
  （类里的 `static foo()` 用得到），所以在词法白名单里 ⇒ 不报"未声明的标识符"。
  唯一稳的判据是**引号配平**。

三个检查：
  ① 字符串 / 模板串 / 注释是否闭合（到 EOF 时词法状态必须回到 code）
  ② 单引号或双引号字符串**闭合后紧跟标识符或中文** ⇒ 里面有一个没转义的同类引号
  ③ `--lines`：逐行"未被反斜杠转义的单引号"必须成对（changelog.js 是"一行一条"的数组）

跑法：python -X utf8 tools/js_literal_check.py js/*.js
      python -X utf8 tools/js_literal_check.py --lines js/changelog.js
"""
import sys, io, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js')

_REGEX_AFTER_WORD = set("""return typeof instanceof in of new delete void do else case yield await""".split())
_REGEX_AFTER_CH = set("(,=:[!&|?{};+-*%~^<>")
WORD = re.compile(r'[A-Za-z0-9_$\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]')


def scan(src):
    """一趟词法：返回 (可疑列表, 未闭合信息)。可疑 = (行号, 闭合后紧跟的内容)"""
    bad, i, n, line = [], 0, len(src), 1
    state, exc = ['code'], []          # 状态栈 + 模板插值的花括号深度
    str_start = None                   # 当前字符串/模板的起始行
    prev_ch, word, last_word, in_class = '', '', '', False
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        st = state[-1]
        if st == 'code':
            if c == '/' and nxt == '/':
                i += 2; state.append('//'); continue
            if c == '/' and nxt == '*':
                i += 2; state.append('/*'); continue
            if c == '/' and (last_word in _REGEX_AFTER_WORD or prev_ch == '' or prev_ch in _REGEX_AFTER_CH):
                i += 1; in_class = False; state.append('regex'); continue
            if c in '\'"`':
                str_start = line; state.append(c); i += 1
                prev_ch, word, last_word = ')', '', ''
                continue
            if exc:
                if c == '{':
                    exc[-1] += 1
                elif c == '}':
                    exc[-1] -= 1
                    if exc[-1] == 0:
                        exc.pop(); state.pop(); i += 1; continue
            if c.isalnum() or c in '_$':
                word += c
            elif word:
                last_word, word = word, ''
            if not c.isspace():
                prev_ch = c
            i += 1; continue
        if st == '//':
            if c == '\n':
                line += 1; state.pop()
            i += 1; continue
        if st == '/*':
            if c == '*' and nxt == '/':
                i += 2; state.pop(); continue
            if c == '\n':
                line += 1
            i += 1; continue
        if st in ('"', "'"):
            if c == '\\':
                i += 2; continue
            if c == st:
                i += 1; state.pop()
                if i < n and WORD.match(src[i]):                 # ★ ② 闭合后紧跟标识符/中文
                    bad.append((line, src[i:i + 48].split('\n')[0]))
                prev_ch, word, last_word = ')', '', ''
                continue
            if c == '\n':
                line += 1
            i += 1; continue
        if st == 'regex':
            if c == '\\':
                i += 2; continue
            if c == '\n':                                        # 没闭合 ⇒ 其实是除号
                line += 1; state.pop(); continue
            if c == '[':
                in_class = True
            elif c == ']':
                in_class = False
            elif c == '/' and not in_class:
                i += 1; state.pop(); prev_ch, word, last_word = ')', '', ''
                continue
            i += 1; continue
        # 模板串
        if c == '\\':
            i += 2; continue
        if c == '`':
            i += 1; state.pop()
            if i < n and WORD.match(src[i]):
                bad.append((line, src[i:i + 48].split('\n')[0]))
            continue
        if c == '$' and nxt == '{':
            i += 2; exc.append(1); state.append('code'); continue
        if c == '\n':
            line += 1
        i += 1
    left = state[-1]
    return bad, (None if left == 'code' else (left, str_start or line))


def odd_lines(path):
    """③ 逐行"未被反斜杠转义的单引号"必须成对"""
    out = []
    for i, l in enumerate(open(path, encoding='utf-8').read().split('\n'), 1):
        k, j = 0, 0
        while j < len(l):
            if l[j] == '\\':
                j += 2; continue
            if l[j] == "'":
                k += 1
            j += 1
        if k % 2:
            out.append((i, l[:90]))
    return out


def main(argv):
    do_lines = '--lines' in argv
    files = [a for a in argv if not a.startswith('--')]
    total = 0
    for p in files:
        path = p if os.path.isabs(p) else os.path.normpath(os.path.join(os.getcwd(), p))
        src = open(path, encoding='utf-8', errors='replace').read()
        bad, unclosed = scan(src)
        msgs = []
        if unclosed:
            msgs.append('  ① 有未闭合的 %s（从第 %s 行开始）—— 整个文件会解析失败'
                        % (unclosed[0], unclosed[1]))
        for ln, tail in bad:
            msgs.append('  ② line %d 字符串闭合后紧跟「%s」—— 里面有一个没转义的引号' % (ln, tail))
        if do_lines:
            for ln, t in odd_lines(path):
                msgs.append('  ③ line %d 奇数个单引号：%s' % (ln, t))
        if msgs:
            total += len(msgs)
            print('FAIL %s' % p)
            for m in msgs:
                print(m)
        else:
            print('OK   %s' % p)
    print('全部通过 ✓' if not total else '%d 处可疑 ✗' % total)
    return 1 if total else 0


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        args = [os.path.join(ROOT, f) for f in sorted(os.listdir(ROOT)) if f.endswith('.js')]
    sys.exit(main(args))
