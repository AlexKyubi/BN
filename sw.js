const CACHE_NAME = 'bonus-navigator-v11';
const urlsToCache = [
  './',
  './index.html',
  './assets/styles/style.css?v=1.3.0',
  './assets/scripts/app.js?v=1.3.0',
  './dashboard.html',
  './public/manifest.json?v=1.3.0'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Runtime fetch-перехват отключен намеренно.
// Это убирает overhead и предупреждение DevTools о no-op fetch handler.
