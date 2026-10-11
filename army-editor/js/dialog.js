/* ============================================================
   dialog.js —— **自定义弹窗**（替代浏览器 alert / confirm / prompt）
   ------------------------------------------------------------
   为什么必须换掉（玩家要求："把所有浏览器弹窗都换成自定义的弹窗"）：
     · 原生弹窗**阻塞主线程** —— 战斗循环 / 编辑器渲染在那几秒里完全冻住；
     · 样式不可控（暗色界面里突然弹一个白框，风格断裂）；
     · 部分浏览器会把"页面已打开多个对话框"直接拦掉（玩家点了没反应）。
   本模块是**非阻塞**的：弹窗期间游戏照常跑。
   用法（Promise 风格）：
     Dlg.alert('消息')                        → Promise<void>
     const ok = await Dlg.confirm('确定？')    → Promise<boolean>
     const s  = await Dlg.prompt('名字', '默认') → Promise<string|null>
   · Enter = 确定 · Esc = 取消 · 点背景 = 取消（alert 视为"看到了"）
   · 同时来多个弹窗 ⇒ **排队**显示（绝不叠成一堆）
   ============================================================ */
const Dlg = (() => {
  let mask = null, box = null, titleEl = null, msgEl = null, inputEl = null;
  let btnOk = null, btnCancel = null;
  let current = null;                 // { kind, resolve }
  const queue = [];

  function build() {
    if (mask) return;
    const cs = getComputedStyle(document.body);
    const $v = (n, fb) => {
      const v = cs.getPropertyValue(n).trim();
      return v || fb;
    };
    const cFg = $v('--fg', '#e8eef7');
    const cMuted = $v('--fg-muted', '#94a3b8');
    const cPanel = $v('--panel-bg', '#151d2b');
    const cBorder = $v('--border', '#2b3a52');
    const cBtn = $v('--legend-bg', '#1e293b');
    const cInput = $v('--input-border', '#334155');
    const cAccent = '#3b82f6';

    mask = document.createElement('div');
    mask.id = 'dlg-mask';
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.55);display:none;'
      + 'align-items:center;justify-content:center;z-index:2147483646;';

    box = document.createElement('div');
    box.style.cssText = `background:${cPanel};color:${cFg};border:1px solid ${cBorder};`
      + 'border-radius:12px;padding:18px 20px;width:min(440px,92vw);'
      + 'box-shadow:0 24px 60px rgba(0,0,0,.45);font:13px/1.6 system-ui,sans-serif;';

    box.innerHTML =
      `<h3 id="dlg-title" style="margin:0 0 12px;font-size:14px;padding-bottom:9px;border-bottom:1px solid ${cBorder};"></h3>`
      + `<div id="dlg-msg" style="white-space:pre-wrap;color:${cFg};max-height:46vh;overflow:auto;"></div>`
      + `<input id="dlg-input" type="text" style="display:none;width:100%;margin-top:12px;font:inherit;`
      + `padding:8px 10px;border:1px solid ${cInput};background:rgba(255,255,255,.04);color:${cFg};`
      + `border-radius:6px;box-sizing:border-box;outline:none;">`
      + `<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">`
      + `<button id="dlg-cancel" style="display:none;font:inherit;font-size:13px;padding:8px 14px;`
      + `border-radius:6px;cursor:pointer;border:1px solid ${cInput};background:${cBtn};color:${cFg};">取消</button>`
      + `<button id="dlg-ok" style="font:inherit;font-size:13px;padding:8px 14px;border-radius:6px;`
      + `cursor:pointer;border:1px solid ${cAccent};background:${cAccent};color:#fff;">确定</button>`
      + '</div>';

    mask.appendChild(box);
    document.body.appendChild(mask);

    titleEl = box.querySelector('#dlg-title');
    msgEl = box.querySelector('#dlg-msg');
    inputEl = box.querySelector('#dlg-input');
    btnOk = box.querySelector('#dlg-ok');
    btnCancel = box.querySelector('#dlg-cancel');

    btnOk.addEventListener('click', () => finish(true));
    btnCancel.addEventListener('click', () => finish(false));
    mask.addEventListener('click', e => { if (e.target === mask) finish(current && current.kind === 'alert'); });
    /* Enter / Esc：绑在 document 上（输入框焦点、按钮焦点都能用） */
    onKey = e => {
      if (!current) return;
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(current.kind === 'alert'); }
    };
  }

  function finish(ok) {
    if (!current) return;
    const c = current;
    current = null;
    let val = null;
    if (ok && c.kind === 'prompt') val = inputEl.value;
    mask.style.display = 'none';
    document.removeEventListener('keydown', onKey, true);
    c.resolve(c.kind === 'prompt' ? (ok ? val : null) : (c.kind === 'confirm' ? !!ok : undefined));
    const next = queue.shift();
    if (next) showNext(next);
  }

  function showNext(req) {
    build();
    current = req;
    titleEl.textContent = req.opts.title || (req.kind === 'prompt' ? '输入' : '提示');
    if (req.opts.html) msgEl.innerHTML = req.opts.html;
    else msgEl.textContent = req.opts.message == null ? '' : String(req.opts.message);
    msgEl.style.display = (req.opts.message == null && !req.opts.html) ? 'none' : 'block';
    btnCancel.style.display = (req.kind === 'alert') ? 'none' : 'inline-block';
    btnOk.textContent = req.opts.okText || '确定';
    btnCancel.textContent = req.opts.cancelText || '取消';
    if (req.kind === 'prompt') {
      inputEl.style.display = 'block';
      inputEl.value = (req.opts.value == null ? '' : String(req.opts.value));
      setTimeout(() => { inputEl.focus(); inputEl.select(); }, 30);
    } else {
      inputEl.style.display = 'none';
    }
    mask.style.display = 'flex';
    document.addEventListener('keydown', onKey, true);
  }

  function open(kind, opts) {
    const o = (typeof opts === 'string') ? { message: opts } : (opts || {});
    return new Promise(resolve => {
      const req = { kind, opts: o, resolve };
      if (current) queue.push(req);
      else showNext(req);
    });
  }

  return {
    alert:  (msg, opts) => open('alert',  Object.assign({}, opts, { message: msg })),
    confirm: (msg, opts) => open('confirm', Object.assign({}, opts, { message: msg })),
    prompt: (msg, def, opts) => open('prompt', Object.assign({}, opts, { message: msg, value: def })),
    isOpen: () => !!current,
  };
})();
window.Dlg = Dlg;
