/* Service worker — application hors connexion.
   Stratégie : RÉSEAU D'ABORD (la nouvelle version est prise dès la prochaine
   ouverture avec du réseau), puis cache (usage hors connexion). Si le réseau
   met plus de 3,5 s à répondre, le cache est servi sans attendre — le réseau
   met le cache à jour en arrière-plan.
   Le nom du cache contient l'empreinte du build : chaque publication remplace
   la précédente et vide les anciens caches. */
const CACHE = 'bfr-fiche-sav-bf38e47181';
const FICHIERS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './favicon.png', './apple-touch-icon.png', './icon-opt1-192.png', './icon-opt1-512.png', './icon-opt2-192.png', './icon-opt2-512.png', './icon-opt3-192.png', './icon-opt3-512.png'];
const DELAI_RESEAU = 3500;

const delai = (ms) => new Promise((ok) => setTimeout(ok, ms));

function servir(requete, estPage) {
  const optionsFetch = estPage ? { cache: 'no-cache' } : {};
  const reseau = fetch(requete, optionsFetch).then((rep) => {
    if (rep && rep.ok) {
      const copie = rep.clone();
      caches.open(CACHE).then((c) => c.put(requete, copie)).catch(() => {});
    }
    return rep && rep.ok ? rep : null;
  }).catch(() => null);

  return Promise.race([reseau, delai(DELAI_RESEAU)]).then((vite) =>
    vite || caches.match(requete)
      .then((c) => c || (estPage ? caches.match('./') : null))
      .then((c) => c || reseau)
      .then((c) => c || new Response('Hors connexion', { status: 503 }))
  );
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'NOUVELLE_VERSION', version: 'bf38e47181' }));
      }))
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.action === 'skipWaiting') {
    self.skipWaiting();
  } else if (e.data && e.data.action === 'viderCache') {
    e.waitUntil(
      caches.keys().then((noms) => Promise.all(noms.map((n) => caches.delete(n))))
        .then(() => self.clients.claim())
    );
  }
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(servir(e.request, e.request.mode === 'navigate'));
});
