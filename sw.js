// Service worker minimale: cache degli asset statici (icone, css, js).
// Le pagine HTML e le chiamate /api/* NON vengono mai servite dalla cache,
// perché richiedono sempre una sessione valida e dati aggiornati.
//
// Se cambi le icone o lo stile e non vedi l'aggiornamento sul telefono,
// alza CACHE_NAME: forza il service worker a ripartire da una cache pulita.
const CACHE_NAME = 'solco-v1';
const STATIC_ASSETS = [
  '/assets/style.css',
  '/assets/app.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/assets/') && event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
