const CACHE_NAME = 'bonus-navigator-v2';
const urlsToCache = [
  './',
  './index.html',
  './assets/styles/style.css',
  './assets/scripts/app.js',
  './public/manifest.json'
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

// Стратегия кэширования: Network First (сначала сеть, потом кэш)
self.addEventListener('fetch', (event) => {
  // Игнорируем не-GET запросы
  if (event.request.method !== 'GET') {
    return;
  }

  // Для Google Sheets - network first
  if (event.request.url.includes('docs.google.com')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Кэшируем успешный ответ
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Если нет сети, берем из кэша
          return caches.match(event.request);
        })
    );
  } 
  // Для остальных файлов - cache first
  else {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response;
          }
          
          return fetch(event.request)
            .then((response) => {
              if (!response || response.status !== 200 || response.type !== 'basic') {
                return response;
              }
              
              const responseToCache = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
              });
              
              return response;
            })
            .catch(() => {
              // Возвращаем что-то для офлайна если нужно
              return new Response('Offline - файл не найден в кэше');
            });
        })
    );
  }
});
