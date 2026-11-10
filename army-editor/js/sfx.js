/* ============================================================
   sfx.js —— 极简音效（**全部用 WebAudio 现场合成**，不引入任何音频文件）
   ------------------------------------------------------------
   玩家："为移动射击炮击这些添加一些音效把不然现在太素了"
   ------------------------------------------------------------
   为什么不用 mp3/ogg：
     · 项目是"双击 html 就能玩"的纯静态页，加二进制资源会拖慢加载、还要管路径与缓存；
     · 这几种声音（枪声 / 炮声 / 车声 / 脚步 / UI）用噪声 + 正弦扫频就能做得够像；
     · 合成参数全在代码里 ⇒ 想调音色只改这一个文件。
   用法：Sfx.fire('soft' | 'at' | 'art') / Sfx.move('foot'|'wheeled'|...) /
         Sfx.undo() / Sfx.ui() / Sfx.toggle() / Sfx.isMuted()
   ★ 浏览器要求"用户手势后才能出声"：我们在第一次点击（移动/开火）时才创建 AudioContext，
     失败就静默降级（Node / 老浏览器 / 自动播放被拦）——**任何情况下都不抛异常**。
   ============================================================ */
const Sfx = (function () {
  const KEY = 'mil_sfx_muted';
  let ac = null, master = null, muted = false;
  try { muted = (localStorage.getItem(KEY) === '1'); } catch (e) { muted = false; }

  function ensure() {
    if (muted) return null;
    try {
      if (!ac) {
        const AC = (typeof window !== 'undefined') &&
                   (window.AudioContext || window.webkitAudioContext);
        if (!AC) return null;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.42;          // 总音量（别盖过玩家的 BGM）
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended' && ac.resume) ac.resume();
      return ac;
    } catch (e) { ac = null; master = null; return null; }
  }

  /* 一段白噪声（枪炮的"沙"都靠它） */
  function noise(a, dur) {
    const n = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource();
    src.buffer = buf;
    return src;
  }
  /* 一条"包络"输出：attack 很短、decay 到你给的时长 */
  function burst(a, o) {
    const t0 = a.currentTime + (o.delay || 0);
    const g = a.createGain();
    const peak = o.gain == null ? 0.6 : o.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let node = null;
    if (o.type === 'noise') {
      node = noise(a, o.dur + 0.02);
      if (o.filter) {
        const f = a.createBiquadFilter();
        f.type = o.filter;
        f.frequency.value = o.freq || 1200;
        if (o.q) f.Q.value = o.q;
        node.connect(f); f.connect(g);
      } else node.connect(g);
    } else {
      node = a.createOscillator();
      node.type = o.wave || 'sine';
      node.frequency.setValueAtTime(o.f0 || 220, t0);
      if (o.f1 && o.f1 !== o.f0) node.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
      node.connect(g);
    }
    g.connect(master);
    try { node.start(t0); node.stop(t0 + o.dur + 0.02); } catch (e) {}
  }

  const api = {
    isMuted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
      if (!muted) api.ui();               // 打开时给个反馈音
      return muted;
    },
    /* 枪炮：软目标=步枪/机枪，硬目标=反坦克/坦克炮，art=间瞄爆炸 */
    fire(kind) {
      const a = ensure(); if (!a) return;
      if (kind === 'art') {
        burst(a, { type: 'sine', f0: 110, f1: 34, dur: 0.55, gain: 0.75 });
        burst(a, { type: 'noise', filter: 'lowpass', freq: 900, dur: 0.45, gain: 0.5, delay: 0.01 });
        burst(a, { type: 'noise', filter: 'highpass', freq: 2600, dur: 0.12, gain: 0.22 });
      } else if (kind === 'at') {
        burst(a, { type: 'noise', filter: 'bandpass', freq: 700, q: 1.1, dur: 0.16, gain: 0.6 });
        burst(a, { type: 'sine', f0: 180, f1: 60, dur: 0.22, gain: 0.5 });
      } else {
        /* 一梭短点射（3 发），像班用自动武器 */
        for (let i = 0; i < 3; i++) {
          burst(a, { type: 'noise', filter: 'bandpass', freq: 2000 + i * 180, q: 1.6,
                     dur: 0.055, gain: 0.42, delay: i * 0.062 });
        }
        burst(a, { type: 'sine', f0: 220, f1: 120, dur: 0.09, gain: 0.25 });
      }
    },
    /* 移动：徒步 = 两下脚步；车辆 = 低频引擎 */
    move(mob) {
      const a = ensure(); if (!a) return;
      if (mob === 'foot') {
        burst(a, { type: 'noise', filter: 'lowpass', freq: 420, dur: 0.09, gain: 0.16 });
        burst(a, { type: 'noise', filter: 'lowpass', freq: 380, dur: 0.09, gain: 0.13, delay: 0.14 });
      } else if (mob === 'air') {
        burst(a, { type: 'sawtooth', f0: 90, f1: 150, dur: 0.42, gain: 0.16 });
        burst(a, { type: 'noise', filter: 'lowpass', freq: 1200, dur: 0.4, gain: 0.1 });
      } else {
        burst(a, { type: 'sawtooth', f0: 62, f1: 84, dur: 0.38, gain: 0.2 });
        burst(a, { type: 'noise', filter: 'lowpass', freq: 260, dur: 0.36, gain: 0.12 });
      }
    },
    /* 撤回 / 界面 */
    undo() {
      const a = ensure(); if (!a) return;
      burst(a, { type: 'sine', f0: 620, f1: 300, dur: 0.11, gain: 0.22, wave: 'triangle' });
    },
    ui() {
      const a = ensure(); if (!a) return;
      burst(a, { type: 'sine', f0: 880, f1: 880, dur: 0.05, gain: 0.12, wave: 'triangle' });
    },
  };
  return api;
})();
