// =========================================================================
// Service worker : met en cache l'app shell pour un fonctionnement hors ligne.
// L'appel à l'API de taux de change n'est volontairement pas intercepté :
// il part toujours au réseau (network-first), le repli sur le dernier taux
// connu étant déjà géré côté page via localStorage (voir app.js).
// =========================================================================

// Incrémenter cette version à chaque déploiement pour que les clients
// téléchargent le nouvel app shell et purgent l'ancien cache.
const VERSION = 'v2';
const CACHE_APP_SHELL = `change-budapest-${VERSION}`;

const FICHIERS_APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

// Installation : on pré-remplit le cache avec l'app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_APP_SHELL)
      .then((cache) => cache.addAll(FICHIERS_APP_SHELL))
      .then(() => self.skipWaiting()) // active la nouvelle version sans attendre la fermeture des onglets
  );
});

// Activation : on supprime les anciens caches (anciennes versions)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms
          .filter((nom) => nom !== CACHE_APP_SHELL)
          .map((nom) => caches.delete(nom))
      ))
      .then(() => self.clients.claim()) // prend le contrôle immédiat des pages ouvertes
  );
});

// Récupération des requêtes
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Taux de change (api.frankfurter.dev) : on laisse passer directement au réseau.
  if (url.hostname === 'api.frankfurter.dev') {
    return;
  }

  if (event.request.method !== 'GET') return;

  // App shell : cache-first, avec mise à jour silencieuse du cache si le réseau répond
  event.respondWith(
    caches.match(event.request).then((reponseEnCache) => {
      if (reponseEnCache) return reponseEnCache;

      return fetch(event.request).then((reponseReseau) => {
        const copie = reponseReseau.clone();
        caches.open(CACHE_APP_SHELL).then((cache) => cache.put(event.request, copie));
        return reponseReseau;
      });
    })
  );
});
