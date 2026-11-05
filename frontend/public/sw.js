// Service worker de la PWA (#212), volontairement minimal : le jeu a besoin du
// réseau, le hors-ligne n'est pas un objectif.
//
// - Seule la page d'erreur réseau est mise en cache. Le HTML, les assets, /api et
//   /ws ne le sont jamais : un déploiement atteint donc les joueurs dès la
//   navigation suivante, et ce fichier ne peut pas servir une ancienne version.
// - Les navigations passent par le réseau et la réponse est rendue telle quelle :
//   une URL inconnue garde son vrai 404, les pages pré-rendues restent celles de
//   nginx. La page d'erreur ne remplace qu'un échec réseau.
//
// Pour retirer la PWA, déployer un sw.js qui se désinscrit : supprimer ce fichier
// laisserait l'ancien service worker actif chez les joueurs.

// Remplacé à la compilation par scripts/prerender.mjs : chaque build qui change
// produit un nouveau service worker, signal de mise à jour pour les onglets ouverts.
const BUILD_ID = '__BUILD_ID__';
const CACHE_PREFIX = 'chouine-offline-';
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  // Sans respondWith, le navigateur traite la requête comme s'il n'y avait pas de
  // service worker : assets, appels à l'API, etc.
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/api/') || pathname === '/ws' || pathname.startsWith('/ws/')) return;

  event.respondWith(
    fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
  );
});
