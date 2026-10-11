// Service worker של "שיחה שקטה"
// - מאפשר להתקין את האתר כאפליקציה
// - דף האפליקציה: קודם מהרשת (כדי לקבל תמיד את הגרסה העדכנית), ואם אין רשת - מהמטמון
// - קבצים אחרים (אייקונים, manifest): מהמטמון, ומתעדכנים ברקע
// לא נוגע בחיבורים לשרת השיחה (WebSocket) ולא בשום כתובת חיצונית.

const CACHE_PREFIX = 'silent-chat-';
const CACHE = CACHE_PREFIX + 'v1';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // מוחקים רק מטמונים ישנים של האפליקציה הזו - לא של אפליקציות אחרות באותו דומיין
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const isAppPage = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
          if (res.ok && isAppPage) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
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
