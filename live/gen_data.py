# -*- coding: utf-8 -*-
"""生成 pages/data.js：Free-TV IPTV 电视直播数据集。"""
import json, re, os, sys

sys.path.insert(0, '/workspace/iptv-classifier/classifier')
from country_meta import COUNTRY_META

SEED_DIR = '/workspace/iptv-classifier/data'
# (slug, 语言_en, 语言_cn, 类别, 专题)
FILES = {
    'playlist_france.m3u8':        ('france', 'French',  '法语', 'country', None),
    'playlist_usa.m3u8':           ('usa',    'English', '英语', 'country', None),
    'playlist_uk.m3u8':            ('uk',     'English', '英语', 'country', None),
    'playlist_japan.m3u8':         ('japan',  'Japanese', '日语', 'country', None),
    'playlist_china.m3u8':         ('china',  'Chinese', '汉语', 'country', None),
    'playlist_zz_news_en.m3u8':    (None,     'English', '英语', 'theme',  'news'),
}


def parse_m3u(path, slug, lang_en, lang_cn, category, theme):
    chs = []
    lines = open(path, encoding='utf-8').read().splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('#EXTINF'):
            m_logo = re.search(r'tvg-logo="([^"]*)"', line)
            m_cou = re.search(r'tvg-country="([^"]*)"', line)
            m_grp = re.search(r'group-title="([^"]*)"', line)
            name = line.split(',', 1)[1].strip() if ',' in line else line
            j = i + 1
            while j < len(lines) and lines[j].startswith('#'):
                j += 1
            url = lines[j].strip() if j < len(lines) else ''
            logo = m_logo.group(1) if m_logo else ''
            meta = COUNTRY_META.get(slug) if slug else None
            code = (m_cou.group(1) if m_cou else (meta.get('code') if meta else '')) or ''
            chs.append({
                'name': name, 'logo': logo, 'url': url,
                'group': m_grp.group(1) if m_grp else '',
                'country': slug or '', 'countryName': (meta.get('name') if meta else ''),
                'code': code, 'region': (meta.get('region') if meta else ''),
                'lang': lang_en, 'langCN': lang_cn,
                'category': category, 'theme': theme or '',
            })
            i = j + 1
        else:
            i += 1
    return chs


all_channels = []
cid = 0
for fn, (slug, lang_en, lang_cn, cat, theme) in FILES.items():
    p = os.path.join(SEED_DIR, fn)
    if not os.path.exists(p):
        continue
    for c in parse_m3u(p, slug, lang_en, lang_cn, cat, theme):
        cid += 1
        c['id'] = 'c%04d' % cid
        all_channels.append(c)

countries = []
for slug, meta in COUNTRY_META.items():
    countries.append({
        'slug': slug, 'name': meta['name'], 'name_en': meta['name_en'],
        'code': meta['code'], 'region': meta['region'], 'region_en': meta['region_en'],
        'language': meta['language'], 'language_en': meta['language_en'],
    })
countries.sort(key=lambda x: (x['region'], x['name_en']))

HELPERS = r'''
/* ============================================================
 * 电视直播数据集 —— 辅助方法（MpUI / TV / 联网拉取）
 * ============================================================ */
window.MpUI = (function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function gradFor(ch) {
    var s = (ch.code || '') + (ch.name || '');
    var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    var h2 = (h + 38) % 360;
    return 'linear-gradient(135deg, hsl(' + h + ',62%,42%), hsl(' + h2 + ',64%,30%))';
  }
  function channelCard(ch, opts) {
    opts = opts || {};
    var flag = window.TV.flagEmoji(ch.code);
    var grad = gradFor(ch);
    var cover = ch.logo
      ? '<img class="ch-logo" loading="lazy" src="' + esc(ch.logo) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
      : '<div class="ch-fill" style="background:' + grad + '">' + esc((ch.name || '?').trim().charAt(0).toUpperCase()) + '</div>';
    var sub = ch.countryName ? (flag + ' ' + ch.countryName) : (ch.group || '');
    return '<div class="ch-card" onclick="openChannel(\'' + esc(ch.id) + '\')">'
      + '<div class="ch-cover" style="background:' + grad + '">' + cover
      + '<span class="ch-live"><i></i>LIVE</span></div>'
      + '<div class="ch-name">' + esc(ch.name) + '</div>'
      + '<div class="ch-sub">' + esc(sub) + '</div></div>';
  }
  function lazyScan() { /* 预留：真实 logo 懒加载已在 onerror 内处理 */ }
  return { esc: esc, gradFor: gradFor, channelCard: channelCard, lazyScan: lazyScan };
})();

window.TV = (function () {
  var C = window.TV_COUNTRIES || [];
  var CH = window.TV_CHANNELS || [];
  function flagEmoji(code) {
    if (!code || code.length !== 2) return '📺';
    var A = 0x1F1E6, base = 'A'.charCodeAt(0);
    return String.fromCodePoint.apply(null, code.toUpperCase().split('').map(function (c) {
      return A + (c.charCodeAt(0) - base);
    }));
  }
  function byCountry(slug) { return CH.filter(function (x) { return x.country === slug; }); }
  function byLanguage(lang) { return CH.filter(function (x) { return x.lang === lang; }); }
  function byRegion(region) { return CH.filter(function (x) { return x.region === region; }); }
  function byCategory(cat) { return CH.filter(function (x) { return x.category === cat; }); }
  function byTheme(theme) { return CH.filter(function (x) { return x.theme === theme; }); }
  function countriesByRegion() {
    var g = {}; C.forEach(function (c) { (g[c.region] = g[c.region] || []).push(c); }); return g;
  }
  function allRegions() {
    var seen = {}, out = [];
    C.forEach(function (c) { if (!seen[c.region]) { seen[c.region] = 1; out.push(c.region); } });
    return out;
  }
  function allLanguages() {
    var seen = {}, out = [];
    C.forEach(function (c) { if (!seen[c.language_en]) { seen[c.language_en] = 1; out.push(c.language_en); } });
    out.sort(); return out;
  }
  function searchChannels(q) {
    q = (q || '').trim().toLowerCase(); if (!q) return [];
    return CH.filter(function (x) {
      return (x.name || '').toLowerCase().indexOf(q) >= 0
        || (x.countryName || '').toLowerCase().indexOf(q) >= 0
        || (x.langCN || '').indexOf(q) >= 0
        || (x.group || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  function getChannel(id) { return CH.filter(function (x) { return x.id === id; })[0] || null; }
  function popularCountries(limit) {
    var cnt = {}; CH.forEach(function (x) { if (x.country) cnt[x.country] = (cnt[x.country] || 0) + 1; });
    return Object.keys(cnt).map(function (k) {
      var m = C.filter(function (c) { return c.slug === k; })[0] || { slug: k, name: k, code: '', region: '' };
      return { slug: k, name: m.name, code: m.code, region: m.region, count: cnt[k] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, limit || 12);
  }
  function featured() {
    var seed = CH.filter(function (x) { return x.logo || /\.m3u8/i.test(x.url); });
    if (seed.length >= 5) return seed.slice(0, 5);
    return CH.slice(0, 5);
  }
  // ---- 联网拉取原始播放列表（浏览器端，需有外网；raw.githubusercontent 允许 CORS）----
  var LIVE_BASE = 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/';
  function parseM3U(text, slug) {
    var lines = text.split(/\r?\n/), out = [], i = 0, n = 0;
    var meta = null; C.forEach(function (c) { if (c.slug === slug) meta = c; });
    while (i < lines.length) {
      var line = lines[i];
      if (line.indexOf('#EXTINF') === 0) {
        var mlogo = /tvg-logo="([^"]*)"/.exec(line);
        var mcou = /tvg-country="([^"]*)"/.exec(line);
        var mgrp = /group-title="([^"]*)"/.exec(line);
        var name = (line.split(',', 1)[1] || '').trim();
        var j = i + 1; while (j < lines.length && lines[j].indexOf('#') === 0) j++;
        var url = (lines[j] || '').trim();
        n++; out.push({
          id: 'L' + slug + '_' + n, name: name, logo: mlogo ? mlogo[1] : '', url: url,
          group: mgrp ? mgrp[1] : '', country: slug || '', countryName: meta ? meta.name : '',
          code: (mcou ? mcou[1] : (meta ? meta.code : '')) || '', region: meta ? meta.region : '',
          lang: meta ? meta.language_en : '', langCN: meta ? meta.language : '',
          category: slug ? 'country' : 'theme', theme: ''
        });
        i = j + 1;
      } else i++;
    }
    return out;
  }
  var _loading = {};
  function loadCountryLive(slug) {
    if (_loading[slug]) return _loading[slug];
    _loading[slug] = fetch(LIVE_BASE + 'playlist_' + slug + '.m3u8').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.text();
    }).then(function (txt) {
      var fresh = parseM3U(txt, slug);
      var before = CH.length;
      fresh.forEach(function (c) { CH.push(c); window.TV_CHANNELS = CH; });
      return { added: CH.length - before, channels: fresh };
    });
    return _loading[slug];
  }
  return {
    flagEmoji: flagEmoji, byCountry: byCountry, byLanguage: byLanguage, byRegion: byRegion,
    byCategory: byCategory, byTheme: byTheme, countriesByRegion: countriesByRegion,
    allRegions: allRegions, allLanguages: allLanguages, searchChannels: searchChannels,
    getChannel: getChannel, popularCountries: popularCountries, featured: featured,
    LIVE_BASE: LIVE_BASE, parseM3U: parseM3U, loadCountryLive: loadCountryLive
  };
})();
'''

with open('/workspace/tv-live-app/pages/data.js', 'w', encoding='utf-8') as f:
    f.write('// 自动生成：Free-TV IPTV 电视直播数据集（解析自真实播放列表 + 88 国分类元数据）\n')
    f.write('window.TV_COUNTRIES = ' + json.dumps(countries, ensure_ascii=False) + ';\n')
    f.write('window.TV_CHANNELS = ' + json.dumps(all_channels, ensure_ascii=False) + ';\n')
    f.write(HELPERS)

print('countries:', len(countries), 'channels:', len(all_channels))
from collections import Counter
print('by region:', dict(Counter(c['region'] for c in all_channels)))
print('by country:', dict(Counter(c['country'] for c in all_channels)))
