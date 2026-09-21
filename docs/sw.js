/* Service worker — met l'application en cache pour un usage hors connexion */
const CACHE = 'bfr-fiche-sav-v1';
const FICHIERS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((rep) => {
      const copie = rep.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copie)).catch(() => {});
      return rep;
    }).catch(() => caches.match('./index.html')))
  );
});
