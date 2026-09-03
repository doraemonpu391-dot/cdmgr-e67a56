// Service worker for the PWA build. Caches the app shell so it opens offline
// after the first visit. Only active when served over http(s) (not in Electron).
const CACHE = 'cdshop-v49';
const SHELL = './index.html';
const EXTRAS = ['./manifest.webmanifest', './pwa/icon-180.png', './pwa/icon-192.png', './pwa/icon-512.png'];
const WARM_TIMEOUT_MS = 3000;    // 有快取可退時，最多等網路這麼久
const COLD_TIMEOUT_MS = 10000;   // 完全沒有快取時（沒別的可顯示），等久一點再放棄

// cache:'reload' 繞過瀏覽器自己的 HTTP 快取。add/addAll 預設會走 HTTP 快取，而
// GitHub Pages 送 max-age=600 —— 於是新版 cache 有可能裝進「剛剛才讀到的舊
// index.html」，配上 cache-first 就是手機永久停在舊版。
function reloadReq(u){ return new Request(u, { cache: 'reload' }); }

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => {
    // 外殼一定要進快取；圖示抓失敗不該讓整個 install 失敗
    //（install 失敗 = 新版 sw 永遠不 activate = 手機靜默停在舊版，毫無跡象）
    EXTRAS.forEach((u) => { c.add(reloadReq(u)).catch(() => {}); });
    return c.add(reloadReq(SHELL));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // 只清自己這支 App 的舊版快取。Cache Storage 是整個網域共用的，同一個
  // doraemonpu391-dot.github.io 底下還有公開商品頁，不能把不認識的快取一起刪掉。
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE && /^cdshop-v\d+$/.test(k)).map((k) => caches.delete(k)));
  await self.clients.claim();
})().catch(() => {})));

function offlinePage(){
  return new Response(
    '<meta charset="utf-8"><body style="font:15px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;padding:32px;color:#e8e8ea;background:#0b0c11">'
    + '目前沒有網路，而且這台裝置還沒存下離線版本。<br>連上網路後重新開啟即可。</body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// 導覽（整個管理系統就是一個 index.html）：network-first，但最多等一段時間，
// 逾時就先給快取／離線頁。純 network-first 在「有訊號沒頻寬」的地方會卡到平台
// timeout，standalone PWA 沒有網址列可停，等同當掉。
//
// 壞回應一律不寫回快取：飯店 WiFi 登入頁（302→200）、GitHub Pages 部署空窗（404）
// 都會回 HTML，寫回去就會把離線外殼換成那一頁，之後離線永遠打不開。
//
// 刻意「不」在換版時強制重新導覽已開著的視窗：批次上架與快速新增的照片、欄位只存在
// 記憶體裡（按下送出才落地），強制重載會無聲清空。換版後把 App 關掉再開一次即可，
// 而且 HTML 既然是 network-first，之後改版不必再動 sw 版本，也就不會再遇到。
function handleNavigate(e){
  const net = fetch(new Request(SHELL, { cache: 'no-cache' })).then(async (res) => {
    if(!res.ok || res.redirected) throw new Error('bad response ' + res.status);
    try { const c = await caches.open(CACHE); await c.put(SHELL, res.clone()); } catch (err) {}
    return res;
  });
  // 逾時先給快取時，網路那條還在跑；waitUntil 讓瀏覽器別提早關掉 sw，
  // 否則「這次看到舊的、下次開就是新的」這個承諾不成立。
  e.waitUntil(net.catch(() => {}));
  return caches.match(SHELL).then((hit) => {
    const fallback = hit || offlinePage();
    const ms = hit ? WARM_TIMEOUT_MS : COLD_TIMEOUT_MS;
    return Promise.race([
      net.catch(() => fallback),
      new Promise((r) => setTimeout(() => r(fallback), ms))
    ]);
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;   // 跨網域（Google Fonts）直接放行
  if (req.mode === 'navigate') { e.respondWith(handleNavigate(e)); return; }
  // 其餘靜態檔（icon / manifest）維持 cache-first：內容不會就地改變。
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
