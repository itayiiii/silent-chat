// Service worker של "שיחה שקטה"
// - מאפשר להתקין את האתר כאפליקציה
// - דף האפליקציה וקובצי הקוד (.js): קודם מהרשת (כדי לקבל תמיד את הגרסה העדכנית), ואם אין רשת - מהמטמון
// - קבצים אחרים (אייקונים, manifest): מהמטמון, ומתעדכנים ברקע
// - קבצי הבינה המלאכותית (ai/, כ-44MB) לא עוברים כאן: ה-worker שלהם שומר אותם במטמון משלו (silent-chat-ai-v1)
// לא נוגע בחיבורים לשרת השיחה (WebSocket) ולא בשום כתובת חיצונית.

const CACHE_PREFIX = 'silent-chat-';
const CACHE = CACHE_PREFIX + 'v2';
const AI_CACHE_PREFIX = CACHE_PREFIX + 'ai-';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './lib/qrcode.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // מוחקים רק מטמונים ישנים של האפליקציה הזו - לא של אפליקציות אחרות באותו דומיין, ולא את הבינה המלאכותית
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE && !k.startsWith(AI_CACHE_PREFIX))
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function fromNetworkFirst(req, cacheKey) {
  return fetch(req)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(cacheKey || req, copy));
      }
      return res;
    })
    .catch(() => caches.match(cacheKey || req));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/ai/')) return;   // the AI files: straight from the network into the worker's own cache

  if (req.mode === 'navigate') {
    const isAppPage = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    event.respondWith(isAppPage ? fromNetworkFirst(req, './index.html')
      : fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  if (url.pathname.endsWith('.js')) {   // code: always the newest (the page and its code must match)
    event.respondWith(fromNetworkFirst(req));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fromNetwork = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fromNetwork;
    })
  );
});
