/* ============================================================
 * api.js —— 电视直播「实时数据层」(window.TVAPI)
 * 数据全部来自 iptv-org 公开 API，浏览器端实时请求，不落本地数据文件。
 *   - 小端点(countries/languages/categories/regions/guides) 启动即拉，用于丰富分类体系
 *   - 大端点 channels.json(~30MB) 懒加载 + 流式下载进度 + IndexedDB 缓存(TTL)
 *   - 播放流按需拉取 channels/{id}.m3u(轻量、实时)，避免加载 50MB 的 streams.json
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

  // ---------- 内存缓存 ----------
  const mem = {};
  let _channels = null;          // 全量频道数组
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
    if (mem[name]) return mem[name];
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
  async function getChannels(onProgress) {
    if (_channels) return _channels;
    const arr = await getJSON('channels', onProgress);
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
      alt: (ch.alt_names || []).join(' / '),
      code: code,
      countryName: cname,
      logo: '', // 使用渐变封面，稳定无破图
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
      id: ch.id, name: ch.name, alt: '', code: ch.code || '',
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
  async function getStreamsForChannel(id) {
    let lastErr;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000); // 单源抓取超时
    try {
      for (const host of M3U_HOSTS) {
        try {
          const r = await fetch(host + encodeURIComponent(id) + '.m3u', { signal: ctrl.signal });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const txt = await r.text();
          const list = parseM3U(txt);
          if (list.length) return list;
          lastErr = new Error('empty');
        } catch (e) { lastErr = e; if (ctrl.signal.aborted) break; }
      }
    } finally { clearTimeout(timer); }
    // 降级：本地 data.js 的单一 url
    const tv = window.TV && window.TV.getChannel && window.TV.getChannel(id);
    if (tv && tv.url) return [{ url: tv.url, title: tv.name, quality: '', group: '' }];
    throw lastErr || new Error('no stream for ' + id);
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
    mem.countries = mem.languages = mem.categories = mem.regions = mem.guides = mem.channels = null;
    _channels = null; _idx = null;
    try { const db = await openDB(); db.transaction('kv', 'readwrite').objectStore('kv').clear(); } catch (e) {}
  }

  return {
    API_HOSTS: API_HOSTS,
    getCountries: getCountries, getLanguages: getLanguages, getCategories: getCategories,
    getRegions: getRegions, getGuides: getGuides, getChannels: getChannels,
    getChannel: getChannel, channelsByCountry: channelsByCountry, channelsByCategory: channelsByCategory,
    channelsByRegion: channelsByRegion, channelsByLanguage: channelsByLanguage, searchChannels: searchChannels,
    popularCountries: popularCountries, categoryCounts: categoryCounts,
    getStreamsForChannel: getStreamsForChannel,
    allCountries: allCountries, allCategories: allCategories, allLanguages: allLanguages, allRegions: allRegions,
    flagEmoji: flagEmoji, norm: norm, stats: stats, isOffline: isOffline, clearCache: clearCache
  };
})();
