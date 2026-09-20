/* ============================================================
 * api.js —— 电视直播「实时数据层」(window.TVAPI)
 * 数据全部来自 iptv-org 公开 API，浏览器端实时请求，不落本地数据文件。
 *   - 小端点(countries/languages/categories/regions/guides/logos) 启动即拉，用于丰富分类体系与真实台标
 *   - 大端点 channels.json(~30MB) 懒加载 + 流式下载进度 + IndexedDB 缓存(TTL)
 *   - 播放源从 streams.json(~50MB) 按 channel id 过滤(多画质/带 Referer/UA)，
 *     共享缓存后任意频道即时获取；失败降级到单频道 m3u、再降级本地 data.js
 *   - 内存缓存与在途请求挂在 window.top，跨页面 iframe 共享，相同接口不重复请求
 * 网络失败时优雅降级到本地 data.js(window.TV)，并在 UI 上提示「离线模式」。
 * 两个导航库(navTemplate.js / MpPageRouter.js)保持不变，本文件仅被业务页引用。
 * ============================================================ */
window.TVAPI = (function () {
  'use strict';

  // 多 host 回退。注意：iptv-org/api 的 master 分支已不再包含 .json 数据文件，
  // 数据现仅通过 GitHub Pages 发布，故首选 iptv-org.github.io/api/（README 标注的 live 端点），
  // raw.githubusercontent.com/.../master/ 作为后备（部分历史环境仍可访问）。
  const API_HOSTS = [
    'https://iptv-org.github.io/api/',
    'https://raw.githubusercontent.com/iptv-org/api/master/'
  ];
  const M3U_HOSTS = [
    'https://iptv-org.github.io/iptv/channels/',
    'https://raw.githubusercontent.com/iptv-org/iptv/master/channels/'
  ];
  const CACHE_TTL = 6 * 3600 * 1000; // 6h

  // ---------- 共享缓存（跨 iframe 复用，避免重复请求）----------
  // 每个业务页都是独立的 iframe，若只用本窗口内存缓存，跨页就会重复拉取同一接口
  // （尤其 30MB 的 channels.json / 50MB 的 streams.json）。同源下 window.top 被所有
  // 业务页 iframe 共享，故把内存缓存与「在途请求」挂到 window.top，实现全局去重。
  function sharedStore() {
    try {
      const root = (window.top && window.top !== window) ? window.top : window;
      if (!root.__TVAPI_CACHE__) root.__TVAPI_CACHE__ = { mem: {}, inflight: {}, logoMap: null };
      return root.__TVAPI_CACHE__;
    } catch (e) {
      if (!window.__TVAPI_CACHE__) window.__TVAPI_CACHE__ = { mem: {}, inflight: {}, logoMap: null };
      return window.__TVAPI_CACHE__;
    }
  }
  const _cache = sharedStore();
  const mem = _cache.mem;        // 共享内存缓存（channels/guides/streams 等大对象只拉一次）
  let _channels = null;          // 全量频道数组（本窗口索引，构建成本低）
  let _idx = null;               // 索引
  const _countryName = {};       // code -> name
  const _countryLangs = {};      // code -> [langCode]
  const _countryRegion = {};     // code -> regionName
  let _offline = false;          // 是否处于离线降级模式

  // ---------- IndexedDB 缓存(存放大文件) ----------
  let _db = null;
  function openDB() {
    return new Promise((res, rej) => {
      if (_db) return res(_db);
      if (!window.indexedDB) return rej(new Error('no-idb'));
      const rq = indexedDB.open('tvapi_cache', 1);
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
      rq.onsuccess = () => { _db = rq.result; res(_db); };
      rq.onerror = () => rej(rq.error || new Error('idb-open-error'));
      // 关键保护：某些隐私/沙箱环境 open() 既不 success 也不 error，会导致调用方永远 pending。
      // 这里加超时，最多 4s 后 reject，调用方（idbGet/idbSet）会回退到网络/本地数据，绝不阻塞 UI。
      setTimeout(() => rej(new Error('idb-open-timeout')), 4000);
    });
  }
  function idbGet(k) {
    return new Promise((res) => {
      openDB().then(db => {
        const tx = db.transaction('kv', 'readonly');
        const rq = tx.objectStore('kv').get(k);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      }).catch(() => res(null));
    });
  }
  function idbSet(k, v) {
    return new Promise((res) => {
      openDB().then(db => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      }).catch(() => res(false));
    });
  }

  // ---------- 网络：流式 fetch(带进度) + 多 host 回退 ----------
  // timeoutMs: 单端点整体超时保护(默认 120s)；大文件(如 guides.json ≈25MB)可传更长值
  async function fetchText(path, onProgress, timeoutMs) {
    let lastErr;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 120000); // 网络挂起保护
    try {
      for (const host of API_HOSTS) {
        try {
          const r = await fetch(host + path, { signal: ctrl.signal });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const reader = r.body.getReader();
          const chunks = []; let received = 0;
          const total = +r.headers.get('content-length') || 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); received += value.length;
            if (onProgress) onProgress(received, total);
          }
          const buf = new Uint8Array(received);
          let pos = 0; for (const c of chunks) { buf.set(c, pos); pos += c.length; }
          return new TextDecoder('utf-8').decode(buf);
        } catch (e) { lastErr = e; if (ctrl.signal.aborted) break; }
      }
    } finally {
      clearTimeout(timer);
    }
    throw lastErr || new Error('fetch failed: ' + path);
  }

  async function getJSON(name, onProgress, timeoutMs) {
    // 命中共享内存缓存：直接返回（并补暖本窗口的关联映射，幂等且廉价）
    if (mem[name]) { warmMaps(name, mem[name]); return mem[name]; }
    // 并发去重：同一接口的同名请求共享同一个在途 promise，避免并发各拉一次
    if (_cache.inflight[name]) return _cache.inflight[name];
    const p = (async function () {
      // 读缓存(后台启动)与拉网络(后台启动)并行竞争：谁先到用谁。
      // 这样即使 IndexedDB 不可用/挂起，也完全不影响实时数据返回速度。
      const cacheP = idbGet(name).then(function (c) {
        if (c && c.data && (Date.now() - c.ts) < CACHE_TTL) { mem[name] = c.data; warmMaps(name, c.data); return c.data; }
        throw new Error('no-cache');
      });
      const netP = fetchText(name + '.json', onProgress, timeoutMs).then(function (txt) {
        const data = JSON.parse(txt);
        mem[name] = data; warmMaps(name, data);
        // 后台写入缓存，不 await：大文件写入可能慢/挂起，绝不阻塞返回
        idbSet(name, { ts: Date.now(), data }).catch(function () {});
        return data;
      });
      try { return await Promise.race([netP, cacheP]); }
      catch (e) { return await netP; }   // 缓存未命中则等网络(网络失败则抛出，交由 withFallback 降级)
    })();
    _cache.inflight[name] = p;
    try { return await p; }
    finally { delete _cache.inflight[name]; }
  }

  // 把小端点的映射关系预热，供后续关联查询
  function warmMaps(name, data) {
    if (name === 'countries') {
      data.forEach(c => { _countryName[c.code] = c.name; _countryLangs[c.code] = c.languages || []; });
    } else if (name === 'regions') {
      data.forEach(rg => (rg.countries || []).forEach(co => { _countryRegion[co] = rg.name; }));
    }
  }

  // ---------- 小端点 ----------
  function getCountries() { return getJSON('countries'); }
  function getLanguages() { return getJSON('languages'); }
  function getCategories() { return getJSON('categories'); }
  function getRegions() { return getJSON('regions'); }
  // guides.json 约 25.6MB，给足超时(300s)并透传进度，避免大文件在慢网下被中断
  function getGuides(onProgress) { return getJSON('guides', onProgress, 300000); }

  // ---------- 大端点：全量频道 ----------
  // 频道 logo：logos.json 为数组 [{channel, feed, in_use, tags, width, height, format, url}]，
  // 按 channel(id) 映射到 logo URL；同一频道可能有多条，优选 in_use 的那条。
  async function getLogos() {
    if (_cache.logoMap) return _cache.logoMap;
    if (_cache.inflight['logos']) return _cache.inflight['logos'];
    const p = (async function () {
      const data = await getJSON('logos', null, 60000);
      const map = {};
      if (Array.isArray(data)) {
        data.forEach(function (x) {
          if (!x || !x.channel || !x.url) return;
          if (!map[x.channel] || x.in_use) map[x.channel] = x.url; // 优先保留 in_use 版本
        });
      } else if (data && typeof data === 'object') {
        Object.keys(data).forEach(function (k) { map[k] = data[k]; }); // 兼容 {id: url} 旧格式
      }
      _cache.logoMap = map;
      return map;
    })();
    _cache.inflight['logos'] = p;
    try { return await p; } finally { delete _cache.inflight['logos']; }
  }
  function getLogo(id) { return (_cache.logoMap && _cache.logoMap[id]) || ''; }
  // ---------- 实时探测：某频道首个播放源是否可播放 ----------
  let _hlsLoading = null;
  function ensureHls(cb) {
    if (window.Hls && window.Hls.isSupported()) { cb(); return; }
    if (_hlsLoading) { _hlsLoading.then(cb); return; }
    _hlsLoading = new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
      s.onload = () => res(); s.onerror = () => res();
      document.head.appendChild(s);
    });
    _hlsLoading.then(cb);
  }
  // 返回 'ok'(可播放) / 'bad'(不可播放) / 'unknown'(无法探测，如浏览器不支持 HLS 且无原生测法)
  function probeStream(id) {
    return new Promise((resolve) => {
      getStreamsForChannel(id).then(function (streams) {
        if (!streams || !streams.length) { resolve('bad'); return; }
        const s = streams[0]; // 已按画质降序，取最优源
        if (window.Hls && window.Hls.isSupported()) {
          ensureHls(function () {
            try {
              const hls = new window.Hls();
              const to = setTimeout(function () { try { hls.destroy(); } catch (e) {} resolve('bad'); }, 12000);
              hls.loadSource(s.url);
              hls.on(window.Hls.Events.MANIFEST_PARSED, function () { clearTimeout(to); try { hls.destroy(); } catch (e) {} resolve('ok'); });
              hls.on(window.Hls.Events.ERROR, function (e, data) { if (data && data.fatal) { clearTimeout(to); try { hls.destroy(); } catch (x) {} resolve('bad'); } });
            } catch (err) { resolve('bad'); }
          });
        } else if (s.url && /\.(m3u8|mp4|webm|ts|mkv|mov)(\?|$)/i.test(s.url)) {
          // 原生 video 探测（iOS Safari 等不支持 hls.js 但有原生 HLS）
          try {
            const v = document.createElement('video'); v.muted = true; v.preload = 'metadata';
            const to = setTimeout(function () { resolve('bad'); }, 12000);
            v.addEventListener('loadedmetadata', function () { clearTimeout(to); resolve('ok'); });
            v.addEventListener('canplay', function () { clearTimeout(to); resolve('ok'); });
            v.addEventListener('error', function () { clearTimeout(to); resolve('bad'); });
            v.src = s.url;
          } catch (e) { resolve('bad'); }
        } else { resolve('unknown'); }
      }).catch(function () { resolve('bad'); });
    });
  }
  async function getChannels(onProgress) {
    if (_channels) return _channels;
    // 与频道库并行拉取 logos（体量与频道库相比很小，几乎不增加首屏耗时），
    // 保证后续 norm() 能直接带上 logo
    const [arr] = await Promise.all([getJSON('channels', onProgress), getLogos()]);
    _channels = arr;
    buildIndex(arr);
    return arr;
  }
  function buildIndex(arr) {
    const byId = {}, byCountry = {}, byCategory = {};
    arr.forEach(ch => {
      byId[ch.id] = ch;
      if (ch.country) (byCountry[ch.country] = byCountry[ch.country] || []).push(ch);
      (ch.categories || []).forEach(cat => { (byCategory[cat] = byCategory[cat] || []).push(ch); });
    });
    _idx = { byId, byCountry, byCategory };
  }

  // ---------- 归一化：把 API 频道对象转成 UI 卡片兼容形状 ----------
  function norm(ch) {
    const code = ch.country || '';
    const cname = _countryName[code] || code;
    return {
      id: ch.id,
      name: ch.name,
      title: (ch.alt_names && ch.alt_names.length ? ch.alt_names[0] : ch.name), // 标题优先用别名首个，无则原 name
      alt: (ch.alt_names || []).join(' / '),
      code: code,
      countryName: cname,
      logo: getLogo(ch.id), // 优先用 iptv-org logos.json 的真实台标，缺失则回退渐变封面
      group: (ch.categories || []).join(' · '),
      langCN: (_countryLangs[code] || []).join('/'),
      category: (ch.categories || [])[0] || '',
      website: ch.website || '',
      raw: ch
    };
  }
  // 本地 data.js 频道 -> 兼容形状
  function normTV(ch) {
    return {
      id: ch.id, name: ch.name, title: (ch.alt || ch.name), alt: '', code: ch.code || '',
      countryName: ch.countryName || '', logo: ch.logo || '',
      group: ch.group || ch.langCN || '', langCN: ch.langCN || '',
      category: ch.category || '', website: '', raw: ch, _tv: true
    };
  }

  // ---------- 查询 ----------
  async function getChannel(id) {
    await getChannels();
    const raw = _idx.byId[id];
    return raw ? norm(raw) : null;
  }
  async function channelsByCountry(code) {
    await getChannels();
    return (_idx.byCountry[code] || []).map(norm);
  }
  async function channelsByCategory(cat) {
    await getChannels();
    return (_idx.byCategory[cat] || []).map(norm);
  }
  async function channelsByRegion(region) {
    await getChannels();
    const regions = await getRegions();
    const rg = regions.find(r => r.name === region || r.code === region);
    const set = new Set(rg ? (rg.countries || []) : []);
    return _channels.filter(c => set.has(c.country)).map(norm);
  }
  async function channelsByLanguage(langCode) {
    await getChannels();
    return _channels
      .filter(c => (_countryLangs[c.country] || []).indexOf(langCode) >= 0)
      .map(norm);
  }
  async function searchChannels(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return [];
    await getChannels();
    const hit = (s) => s && s.toLowerCase().indexOf(q) >= 0;
    return _channels.filter(c =>
      hit(c.name) || (c.alt_names || []).some(hit) ||
      hit(c.country) || hit(_countryName[c.country]) ||
      (c.categories || []).some(hit) || hit(c.network) || (c.owners || []).some(hit)
    ).map(norm);
  }
  async function popularCountries(limit) {
    await getChannels();
    const cnt = {};
    _channels.forEach(c => { if (c.country) cnt[c.country] = (cnt[c.country] || 0) + 1; });
    return Object.keys(cnt).map(k => ({
      code: k, name: _countryName[k] || k, count: cnt[k],
      region: _countryRegion[k] || '', flag: flagEmoji(k)
    })).sort((a, b) => b.count - a.count).slice(0, limit || 20);
  }
  async function categoryCounts() {
    await getChannels();
    const cnt = {};
    _channels.forEach(c => (c.categories || []).forEach(cat => { cnt[cat] = (cnt[cat] || 0) + 1; }));
    return cnt;
  }

  // ---------- 播放流：按需拉取单频道 m3u(轻量、实时) ----------
  function parseM3U(text) {
    const lines = text.split(/\r?\n/);
    const out = []; let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.indexOf('#EXTINF') === 0) {
        const mname = /tvg-name="([^"]*)"/.exec(line);
        const mg = /group-title="([^"]*)"/.exec(line);
        const ci = line.indexOf(',', 11);
        const fullName = ci >= 0 ? line.slice(ci + 1).trim() : '';
        const name = mname ? mname[1] : (fullName || '源');
        let j = i + 1; while (j < lines.length && lines[j].indexOf('#') === 0) j++;
        const url = (lines[j] || '').trim();
        if (!url) { i = j + 1; continue; }
        const q = /(2160p|1440p|1080p|720p|480p|360p|240p)/i.exec(fullName + ' ' + url);
        out.push({ url: url, title: name, quality: q ? q[1].toLowerCase() : '', group: mg ? mg[1] : '' });
        i = j + 1;
      } else i++;
    }
    return out;
  }
  // ---------- 播放流：主路径从 streams.json 按 channel id 过滤 ----------
  // streams.json 体量约 50MB，首次拉取较慢；但缓存(共享内存 + IndexedDB)后，
  // 任意频道的播放源都即时可得，绝不会重复下载。
  const QUALITY_ORDER = { '2160p': 7, '1440p': 6, '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1 };
  function byQualityDesc(a, b) {
    const qa = QUALITY_ORDER[(a.quality || '').toLowerCase()] || 0;
    const qb = QUALITY_ORDER[(b.quality || '').toLowerCase()] || 0;
    if (qb !== qa) return qb - qa;
    return (a.url || '').length - (b.url || '').length; // 同画质下短 URL 优先
  }
  async function getStreams(onProgress) {
    return getJSON('streams', onProgress, 300000); // 50MB，给足超时并透传进度
  }
  // 返回「有可用播放源」的频道 id 集合（来自 streams.json），用于过滤掉无源频道。
  // 复用共享缓存的 streams.json；首次加载 50MB 后，后续调用（含播放器）全部秒取。
  async function getStreamChannelIds() {
    if (_cache.streamIds) return _cache.streamIds;
    if (_cache.inflight['streamIds']) return _cache.inflight['streamIds'];
    const p = (async function () {
      const all = await getJSON('streams', null, 300000);
      const set = new Set();
      (all || []).forEach(function (s) { if (s && s.channel) set.add(s.channel); });
      _cache.streamIds = set;
      return set;
    })();
    _cache.inflight['streamIds'] = p;
    try { return await p; } finally { delete _cache.inflight['streamIds']; }
  }
  // 更彻底的过滤：输入/输出均为 norm 后的频道列表，仅保留在 streams.json 里有播放源的频道。
  // 流信息不可用时原样返回（离线/接口失败不破坏页面）。
  async function filterPlayable(list) {
    if (!Array.isArray(list)) return list;
    try {
      const ids = await getStreamChannelIds();
      const out = list.filter(function (c) { return ids.has(c.id); });
      return out.length ? out : list; // 全被过滤掉时保留原列表，避免空白页误导
    } catch (e) { return list; }
  }
  async function getStreamsForChannel(id, onProgress) {
    // 主路径：从全量 streams.json 中过滤出 channel === id 的所有播放源
    try {
      const all = await getJSON('streams', onProgress, 300000);
      const list = (all || []).filter(s => s && s.channel === id).map(function (s) {
        return {
          url: s.url,
          title: s.title || (s.quality ? s.quality + ' 源' : '播放源'),
          quality: (s.quality || '').toLowerCase(),
          referrer: s.referrer || '',
          userAgent: s.user_agent || '',
          labels: s.labels || []
        };
      }).sort(byQualityDesc);
      if (list.length) return list;
    } catch (e) { /* 落到降级 */ }
    // 降级1：单频道 m3u（轻量、实时）
    //try { return await getStreamsForChannelM3U(id); } catch (e) {}
    // 降级2：本地 data.js 的单一 url
    //const tv = window.TV && window.TV.getChannel && window.TV.getChannel(id);
    //if (tv && tv.url) return [{ url: tv.url, title: tv.name, quality: '', referrer: '', userAgent: '', labels: [] }];
    throw new Error('no stream for ' + id);
  }
  // 兜底：按频道 id 拉取单频道 m3u（iptv-org/iptv/channels/{id}.m3u）
  async function getStreamsForChannelM3U(id) {
    let lastErr;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000); // 单源抓取超时
    try {
      for (const host of M3U_HOSTS) {
        try {
          const r = await fetch(host + encodeURIComponent(id) + '.m3u', { signal: ctrl.signal });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const txt = await r.text();
          const list = parseM3U(txt).map(function (s) {
            return { url: s.url, title: s.title, quality: s.quality, referrer: '', userAgent: '', labels: [] };
          });
          if (list.length) return list;
          lastErr = new Error('empty');
        } catch (e) { lastErr = e; if (ctrl.signal.aborted) break; }
      }
    } finally { clearTimeout(timer); }
    throw lastErr || new Error('no m3u for ' + id);
  }

  // ---------- 降级封装 ----------
  async function withFallback(primary, fallback) {
    try { return await primary(); }
    catch (e) {
      _offline = true;
      if (fallback) { try { return await fallback(e); } catch (e2) { throw e; } }
      throw e;
    }
  }

  // ---------- 分类维度(实时优先，失败用本地) ----------
  async function allCountries() {
    return withFallback(
      async () => (await getCountries()).map(c => ({ code: c.code, name: c.name, flag: c.flag, languages: c.languages, region: _countryRegion[c.code] || '' })),
      () => (window.TV_COUNTRIES || []).map(c => ({ code: c.code, name: c.name, flag: flagEmoji(c.code), languages: [], region: c.region }))
    );
  }
  async function allCategories() {
    return withFallback(
      async () => {
        const cats = await getCategories();
        const cnt = await categoryCounts();
        return cats.map(c => ({ id: c.id, name: c.name, desc: c.description || '', count: cnt[c.id] || 0 }));
      },
      () => [{ id: 'news', name: '新闻直播', desc: '', count: 0 }]
    );
  }
  async function allLanguages() {
    return withFallback(
      async () => (await getLanguages()).map(l => ({ code: l.code, name: l.name })),
      () => (window.TV ? [] : [])
    );
  }
  async function allRegions() {
    return withFallback(
      async () => (await getRegions()).map(r => ({ code: r.code, name: r.name, countries: r.countries || [] })),
      () => []
    );
  }

  // ---------- 工具 ----------
  function flagEmoji(code) {
    if (!code || code.length !== 2) return '📺';
    const A = 0x1F1E6, base = 'A'.charCodeAt(0);
    return String.fromCodePoint.apply(null, code.toUpperCase().split('').map(c => A + (c.charCodeAt(0) - base)));
  }
  async function stats() {
    const [chs, cs, cats, langs] = await Promise.all([
      getChannels().then(a => a.length).catch(() => (window.TV_CHANNELS || []).length),
      getCountries().then(a => a.length).catch(() => (window.TV_COUNTRIES || []).length),
      getCategories().then(a => a.length).catch(() => 0),
      getLanguages().then(a => a.length).catch(() => 0)
    ]);
    return { channels: chs, countries: cs, categories: cats, languages: langs };
  }
  function isOffline() { return _offline; }
  async function clearCache() {
    Object.keys(_cache.mem).forEach(function (k) { _cache.mem[k] = null; });
    _cache.inflight = {}; _cache.logoMap = null;
    _channels = null; _idx = null;
    try { const db = await openDB(); db.transaction('kv', 'readwrite').objectStore('kv').clear(); } catch (e) {}
  }

  return {
    API_HOSTS: API_HOSTS,
    getCountries: getCountries, getLanguages: getLanguages, getCategories: getCategories,
    getRegions: getRegions, getGuides: getGuides, getChannels: getChannels, getLogos: getLogos, getLogo: getLogo,
    getChannel: getChannel, channelsByCountry: channelsByCountry, channelsByCategory: channelsByCategory,
    channelsByRegion: channelsByRegion, channelsByLanguage: channelsByLanguage, searchChannels: searchChannels,
    popularCountries: popularCountries, categoryCounts: categoryCounts,
    getStreamsForChannel: getStreamsForChannel, getStreams: getStreams, getStreamChannelIds: getStreamChannelIds,
    probeStream: probeStream,
    filterPlayable: filterPlayable,
    allCountries: allCountries, allCategories: allCategories, allLanguages: allLanguages, allRegions: allRegions,
    flagEmoji: flagEmoji, norm: norm, stats: stats, isOffline: isOffline, clearCache: clearCache
  };
})();
