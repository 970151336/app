/* ============================================================
 * 电影天堂 —— 跨页状态共享（收藏 / 想看 / 观看历史）
 * 各页面是独立 iframe，全局变量无法互通；这里用 localStorage 持久化
 * + 以顶层 window(index) 为事件总线，任一子页修改后派发 'appstore'，
 * 其它 iframe 订阅刷新。同源下 window.top === index，可直接收发。
 * ============================================================ */
(function () {
  'use strict';
  const FAV = 'movie_favs';
  const WISH = 'movie_wish';
  const HIS = 'movie_history';
  const bus = window.top || window;

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function emit(type, id) {
    try { bus.dispatchEvent(new CustomEvent('appstore', { detail: { type: type, id: id } })); } catch (e) {}
  }
  function slim(d) {
    return {
      id: d.id, title: d.title, pic: d.pic, color: d.color, coverText: d.coverText,
      score: d.score, year: d.year, area: d.area, genre: d.genre, remarks: d.remarks
    };
  }

  const AppStore = {
    /* 收藏 */
    getFavs() { return read(FAV); },
    isFav(id) { return read(FAV).some(x => String(x.id) === String(id)); },
    toggleFav(d) {
      const list = read(FAV);
      const i = list.findIndex(x => String(x.id) === String(d.id));
      let added;
      if (i >= 0) { list.splice(i, 1); added = false; }
      else { list.unshift(slim(d)); added = true; }
      write(FAV, list); emit('fav', d.id); return added;
    },
    /* 想看 */
    getWishes() { return read(WISH); },
    isWish(id) { return read(WISH).some(x => String(x.id) === String(id)); },
    toggleWish(d) {
      const list = read(WISH);
      const i = list.findIndex(x => String(x.id) === String(d.id));
      let added;
      if (i >= 0) { list.splice(i, 1); added = false; }
      else { list.unshift(slim(d)); added = true; }
      write(WISH, list); emit('wish', d.id); return added;
    },
    /* 观看历史 */
    getHistory() { return read(HIS); },
    addHistory(d) {
      let list = read(HIS).filter(x => String(x.id) !== String(d.id));
      list.unshift(Object.assign({ ts: Date.now() }, slim(d)));
      if (list.length > 50) list = list.slice(0, 50);
      write(HIS, list); emit('history', d.id);
    },
    clearHistory() { write(HIS, []); emit('history', null); },
    /* 订阅：跨 iframe 实时同步 */
    subscribe(cb) {
      const h = (e) => { try { cb(e.detail); } catch (err) {} };
      bus.addEventListener('appstore', h);
      return () => bus.removeEventListener('appstore', h);
    }
  };
  window.AppStore = AppStore;
})();
