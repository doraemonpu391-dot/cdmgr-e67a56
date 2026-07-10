// Shop-visit analytics aggregation — pure, DOM-free, UMD.
// Used by the management dashboard (browser) AND unit tests (Node).
//
// An event row looks like:
//   { t: ISO-time, src: 'Facebook', path: '/shop/', q: 'radiohead',
//     scr: '390x844', lang: 'zh-TW', ua: '...', ref: 'https://...' }
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.CDAnalytics = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function dayKey(iso) {
    // Local YYYY-MM-DD from an ISO timestamp (falls back to the raw first 10 chars)
    const d = new Date(iso);
    if (isNaN(d)) return String(iso || '').slice(0, 10);
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }

  function deviceOf(ua) {
    const s = String(ua || '').toLowerCase();
    if (/ipad|tablet/.test(s)) return '平板';
    if (/mobile|iphone|android/.test(s)) return '手機';
    if (!s) return '未知';
    return '桌機';
  }

  function browserOf(ua) {
    const s = String(ua || '');
    if (/Edg\//.test(s)) return 'Edge';
    if (/OPR\/|Opera/.test(s)) return 'Opera';
    if (/Chrome\//.test(s) && !/Chromium/.test(s)) return 'Chrome';
    if (/CriOS/.test(s)) return 'Chrome';
    if (/Firefox\//.test(s) || /FxiOS/.test(s)) return 'Firefox';
    if (/Safari\//.test(s)) return 'Safari';
    return '其他';
  }

  function tally(arr, keyFn) {
    const m = {};
    for (const x of arr) { const k = keyFn(x) || '(未知)'; m[k] = (m[k] || 0) + 1; }
    // → sorted array of {key, count} desc
    return Object.keys(m).map((k) => ({ key: k, count: m[k] }))
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
  }

  // Aggregate events into dashboard stats. `days` = trailing window for the daily series.
  function aggregateEvents(events, days) {
    const all = Array.isArray(events) ? events.filter((e) => e && e.t) : [];
    // Pageviews (造訪) vs search events; count dimensions over pageviews only.
    const list = all.filter((e) => e.ev !== 'search');
    days = days || 30;

    const total = list.length;
    const bySource = tally(list, (e) => e.src);
    const byDevice = tally(list, (e) => e.device || deviceOf(e.ua));
    const byBrowser = tally(list, (e) => e.browser || browserOf(e.ua));
    const byLang = tally(list, (e) => e.lang);
    // Search terms from ANY event carrying a query (pageview ?q= or a search event)
    const searches = tally(all.filter((e) => (e.q || '').trim()), (e) => e.q.trim());

    // Daily counts, filled for the trailing `days` days ending today
    const dayCount = {};
    for (const e of list) { const k = dayKey(e.t); dayCount[k] = (dayCount[k] || 0) + 1; }
    const series = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const tz = d.getTimezoneOffset() * 60000;
      const k = new Date(d - tz).toISOString().slice(0, 10);
      series.push({ day: k, count: dayCount[k] || 0 });
    }
    const windowTotal = series.reduce((s, x) => s + x.count, 0);

    const todayKey = dayKey(new Date().toISOString());
    const todayCount = dayCount[todayKey] || 0;

    // Recent activity feed shows both pageviews and searches (newest first)
    const recent = all.slice().sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 50);

    return { total, todayCount, windowTotal, days,
      bySource, byDevice, byBrowser, byLang, searches, series, recent };
  }

  // Build the Apps Script events endpoint URL.
  function buildEventsUrl(url, key, extra) {
    var u = String(url || '');
    u += (u.indexOf('?') === -1 ? '?' : '&') + 'action=events&key=' + encodeURIComponent(key || '');
    if (extra) u += '&' + extra;
    return u;
  }

  // Turn a raw Apps Script response body into { events } or { error }.
  // Google serves an HTML login/permission page when the web app isn't public —
  // that's the "Unexpected token '<'" case, so name it explicitly.
  function parseEventsResponse(text) {
    var t = String(text == null ? '' : text);
    var data;
    try { data = JSON.parse(t); }
    catch (e) {
      if (/^\s*<(!doctype|html)/i.test(t)) {
        return { error: 'Apps Script 回傳的是一個網頁而不是資料。多半是「部署 → 誰可以存取」沒設成「任何人」，或網址不是結尾 /exec 的網頁應用程式 URL。請到 Apps Script → 部署 → 管理部署作業，把存取權設為「任何人」並重新部署，再貼一次網址。' };
      }
      return { error: '回傳的不是 JSON：' + t.slice(0, 80) };
    }
    if (data && data.error) return { error: '讀取失敗：' + data.error + '（請確認密鑰 STATS_KEY 是否一致）' };
    return { events: (data && Array.isArray(data.events)) ? data.events : [] };
  }

  return { aggregateEvents, deviceOf, browserOf, dayKey, buildEventsUrl, parseEventsResponse };
});
