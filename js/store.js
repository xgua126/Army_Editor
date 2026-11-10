/* ============================================================
   store.js — ★ R10.38：**存档方式整体换掉**（不再"保存到浏览器"）
   ------------------------------------------------------------
   玩家的反馈：
     "保存到浏览器功能超级多用户反映会出现浏览器保存上限保存不了的问题，
      而且很容易丢失，所以这个功能肯定是不能用了"
   现在分三层，各管一件事：

   ① **文件 = 正式存档**（不会再因为"浏览器 5MB 上限"存不进去，也能放网盘/U 盘）
        · 桌面 Chrome/Edge：`showSaveFilePicker` 真·另存为，同名文件下次**直接覆盖**
        · 手机：优先 `navigator.share`（存到「文件」/发微信 都行），没有就下载
        · 任何环境都能用的兜底：`<a download>`
   ② **IndexedDB = 本机缓存/草稿**（容量按磁盘算，不是 5MB；不会报"配额已满"）
        · 让"刷新页面 / 关掉再打开"还能看到自己上次做的东西
        · 没有 IDB（file:// 被禁用等）就只用内存，绝不抛错
   ③ **localStorage = 只读兼容**：老版本存在这里的存档会被**一次性搬进 IDB**，
        并给一个「清理旧存档释放空间」的按钮（清完就不再碰它）

   对外 API（其它模块只认这些）：
     Store.ready               → Promise（IDB 就绪；页面不必等它，先用同步缓存渲染）
     Store.get(key, fallback)  → 同步读（内存）
     Store.set(key, value)     → 写内存 + 异步写 IDB（失败静默）
     Store.del(key)
     Store.saveFile(name, obj, opts) → Promise<{ok, how}>   // 另存为/分享/下载
     Store.openFile()                → Promise<{ok, name, data}>
     Store.bundle() / Store.applyBundle(obj)                 // 一键打包全部
     Store.legacyBytes() / Store.clearLegacy()
   ============================================================ */
const Store = (() => {
  const DB_NAME = 'mil_store_v1';
  const STORE_NAME = 'kv';
  /* 老版本写在 localStorage 里的键（只读兼容 + 一次性迁移） */
  const LEGACY_KEYS = [
    'mil_org_saves_v1', 'mil_grid_maps_v1', 'mil_hex_maps_v1',
    'mil_equipment_lib_v1', 'mil_equipment_meta_v1', 'mil_autosave_v1',
  ];
  /* 打包导出时用到的键（一键备份全项目） */
  const BUNDLE_KEYS = {
    saves:   'mil_org_saves_v1',
    maps:    'mil_grid_maps_v1',
    hexMaps: 'mil_hex_maps_v1',
    equip:   'mil_equipment_lib_v1',
  };

  const mem = Object.create(null);
  const handles = Object.create(null);      // 文件名 → FileSystemFileHandle（同名覆盖）
  let lsOK = true, idbOK = true, db = null, dbP = null;

  /* ---------- 小工具 ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { lsOK = false; return null; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function parse(raw, fb) {
    if (raw == null) return fb;
    try { const v = JSON.parse(raw); return (v == null) ? fb : v; } catch (e) { return fb; }
  }
  function bytesOf(str) { return str ? (str.length * 2) : 0; }

  /* ① 同步兜底：先把 localStorage 里的老数据读进内存（首屏立刻能用） */
  for (const k of LEGACY_KEYS) {
    const raw = lsGet(k);
    if (raw != null) mem[k] = parse(raw, null);
  }

  /* ---------- ② IndexedDB ---------- */
  function openDB() {
    if (dbP) return dbP;
    dbP = new Promise(resolve => {
      let idb = null;
      try { idb = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB; } catch (e) { idb = null; }
      if (!idb) { idbOK = false; return resolve(null); }
      let req;
      try { req = idb.open(DB_NAME, 1); } catch (e) { idbOK = false; return resolve(null); }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { idbOK = false; resolve(null); };
      req.onblocked = () => resolve(null);
      /* 有些环境（file:// / 隐私模式）直接卡住不回调 ⇒ 1.2s 后放行，别拖住页面 */
      setTimeout(() => resolve(req.result || null), 1200);
    }).then(d => { db = d; return d; });
    return dbP;
  }

  function idbAll() {
    return new Promise(resolve => {
      if (!db) return resolve({});
      let tx;
      try { tx = db.transaction(STORE_NAME, 'readonly'); } catch (e) { return resolve({}); }
      const os = tx.objectStore(STORE_NAME);
      const out = {};
      try {
        const keysReq = os.getAllKeys();
        keysReq.onsuccess = () => {
          const keys = keysReq.result || [];
          if (!keys.length) return resolve(out);
          const valsReq = os.getAll();
          valsReq.onsuccess = () => {
            const vals = valsReq.result || [];
            keys.forEach((k, i) => { out[k] = vals[i]; });
            resolve(out);
          };
          valsReq.onerror = () => resolve(out);
        };
        keysReq.onerror = () => resolve(out);
      } catch (e) { resolve(out); }
    });
  }

  function idbPut(k, v) {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(v, k);
    } catch (e) { idbOK = false; }
  }
  function idbDel(k) {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(k);
    } catch (e) {}
  }

  /* ③ 就绪：把 IDB 里的数据合进内存；IDB 里没有的老数据顺手搬过去 */
  const ready = (async () => {
    await openDB();
    if (!db) return false;
    const all = await idbAll();
    for (const k of LEGACY_KEYS) {
      if (k in all) continue;
      const raw = lsGet(k);
      if (raw == null) continue;
      const v = parse(raw, null);
      if (v == null) continue;
      mem[k] = v;
      idbPut(k, v);
    }
    for (const k in all) mem[k] = all[k];
    try { window.dispatchEvent(new CustomEvent('store-ready')); } catch (e) {}
    return true;
  })();

  function get(k, fb) { return (k in mem && mem[k] != null) ? mem[k] : fb; }
  function set(k, v) { mem[k] = v; idbPut(k, v); return true; }
  function del(k) { delete mem[k]; idbDel(k); }

  /* ---------- 文件：正式存档 ---------- */
  function fileNameOf(name, ext) {
    const base = String(name || '军队编制').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    const e = ext || '.json';
    return /\.json$/i.test(base) ? base : base + e;
  }

  async function saveFile(filename, obj, opts) {
    opts = opts || {};
    const name = fileNameOf(filename, opts.ext);
    const text = JSON.stringify(obj, null, opts.pretty ? 2 : 0);
    const blob = new Blob([text], { type: 'application/json' });
    /* ① 另存为（桌面）：记住 handle ⇒ 同名再存直接覆盖同一个文件 */
    if (!opts.forceDownload && typeof window.showSaveFilePicker === 'function') {
      try {
        let h = handles[name];
        if (!h) {
          h = await window.showSaveFilePicker({
            suggestedName: name,
            types: [{ description: 'JSON 数据', accept: { 'application/json': ['.json'] } }],
          });
          handles[name] = h;
        }
        const w = await h.createWritable();
        await w.write(blob);
        await w.close();
        return { ok: true, how: 'picker', name: h.name || name };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, how: 'cancel' };
        /* 其它错误（file:// 权限 / 老浏览器）⇒ 掉到下载 */
      }
    }
    /* ② 手机：能"分享"就分享（存到「文件」/ 发微信最省事） */
    if (opts.share && typeof navigator !== 'undefined' && navigator.canShare && typeof File === 'function') {
      try {
        const f = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare({ files: [f] })) {
          await navigator.share({ files: [f], title: name });
          return { ok: true, how: 'share', name: name };
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, how: 'cancel' };
      }
    }
    /* ③ 下载（所有环境都能用） */
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 5000);
    return { ok: true, how: 'download', name: name };
  }

  async function openFile(accept) {
    /* ① 文件选择器（桌面） */
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const arr = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'JSON 数据', accept: { 'application/json': ['.json'] } }],
        });
        const f = await arr[0].getFile();
        return { ok: true, name: f.name, data: JSON.parse(await f.text()) };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, how: 'cancel' };
      }
    }
    /* ② <input type=file>（手机 / 老浏览器） */
    return await new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept || '.json,application/json';
      inp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(inp);
      let done = false;
      const fin = r => { if (done) return; done = true; try { inp.remove(); } catch (e) {} resolve(r); };
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) return fin({ ok: false, how: 'cancel' });
        try { fin({ ok: true, name: f.name, data: JSON.parse(await f.text()) }); }
        catch (e) { fin({ ok: false, how: 'error', error: e }); }
      });
      inp.addEventListener('cancel', () => fin({ ok: false, how: 'cancel' }));
      inp.click();
    });
  }

  /* ---------- 一键打包（编制 + 地图 + 装备库） ---------- */
  function bundle() {
    const out = { kind: 'mil-bundle', version: 1, time: Date.now(), app: '军队编制编辑器' };
    for (const k in BUNDLE_KEYS) out[k] = get(BUNDLE_KEYS[k], {});
    return out;
  }
  function applyBundle(b) {
    if (!b || typeof b !== 'object') return { ok: false, count: 0, why: '不是有效的打包文件' };
    let n = 0;
    for (const k in BUNDLE_KEYS) {
      const v = b[k];
      if (!v || typeof v !== 'object') continue;
      const key = BUNDLE_KEYS[k];
      const merged = Object.assign({}, get(key, {}));
      for (const id in v) { merged[id] = v[id]; n++; }
      set(key, merged);
    }
    return { ok: n > 0, count: n };
  }

  /* ---------- 老 localStorage：看看占了多少 / 一键清掉 ---------- */
  function legacyBytes() {
    let n = 0;
    for (const k of LEGACY_KEYS) n += bytesOf(lsGet(k));
    return n;
  }
  function clearLegacy() {
    let n = 0;
    for (const k of LEGACY_KEYS) { n += bytesOf(lsGet(k)); lsDel(k); }
    return n;
  }

  return {
    ready, get, set, del,
    saveFile, openFile, bundle, applyBundle,
    legacyBytes, clearLegacy,
    isIdbOK: () => idbOK,
    isLsOK: () => lsOK,
    LEGACY_KEYS, BUNDLE_KEYS,
  };
})();

