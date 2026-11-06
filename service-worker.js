// =========================================================================
// Service worker : met en cache une liste blanche de fichiers de l'app shell
// pour un fonctionnement hors ligne.
// Stratégie pour ces fichiers : stale-while-revalidate (le cache répond
// immédiatement, le réseau met à jour le cache en arrière-plan).
// Tout le reste (API Frankfurter, toute origine externe, fichiers hors
// liste blanche) n'est jamais intercepté : la requête part directement au
// réseau, le repli sur le dernier taux connu étant déjà géré côté page via
// localStorage (voir app.js).
// =========================================================================

// Incrémenter cette version à chaque déploiement pour que les clients
// téléchargent le nouvel app shell et purgent l'ancien cache.
const VERSION = 'v3';
const PREFIXE_CACHE = 'change-budapest-';
const CACHE_APP_SHELL = `${PREFIXE_CACHE}${VERSION}`;

// Liste blanche des fichiers de l'app shell (vérifiés présents à ces chemins exacts)
const FICHIERS_APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

const CHEMINS_AUTORISES = new Set(FICHIERS_APP_SHELL);

// Installation : on pré-remplit le cache avec l'app shell. Chaque fichier est
// mis en cache indépendamment (Promise.allSettled) pour qu'un seul fichier
// manquant ou en échec ne bloque pas l'installation de tous les autres.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_APP_SHELL).then(async (cache) => {
      const resultats = await Promise.allSettled(
        FICHIERS_APP_SHELL.map((chemin) => cache.add(chemin))
      );
      resultats.forEach((resultat, i) => {
        if (resultat.status === 'rejected') {
          console.warn(`Échec de mise en cache de "${FICHIERS_APP_SHELL[i]}" :`, resultat.reason);
        }
      });
      return self.skipWaiting(); // active la nouvelle version sans attendre la fermeture des onglets
    })
  );
});

// Activation : on supprime les anciens caches de cette app (anciennes versions),
// jamais un cache d'une autre origine/app
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms
          .filter((nom) => nom.startsWith(PREFIXE_CACHE) && nom !== CACHE_APP_SHELL)
          .map((nom) => caches.delete(nom))
      ))
      .then(() => self.clients.claim()) // prend le contrôle immédiat des pages ouvertes
  );
});

// Récupération des requêtes : on n'intercepte que les GET de même origine dont
// le chemin est explicitement dans la liste blanche de l'app shell. Tout le
// reste (API Frankfurter, autres origines, fichiers non listés) part
// directement au réseau, sans passer par respondWith().
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!CHEMINS_AUTORISES.has(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_APP_SHELL).then(async (cache) => {
      const reponseEnCache = await cache.match(request);

      // Mise à jour en arrière-plan : seules les réponses valides et de même
      // origine ("basic") sont mises en cache (jamais une réponse opaque/erreur)
      const miseAJourReseau = fetch(request)
        .then((reponseReseau) => {
          if (reponseReseau.ok && reponseReseau.type === 'basic') {
            cache.put(request, reponseReseau.clone());
          }
          return reponseReseau;
        })
        .catch(() => null);

      if (reponseEnCache) return reponseEnCache;

      const reponseReseau = await miseAJourReseau;
      if (reponseReseau) return reponseReseau;

      // Hors ligne et rien en cache : on retombe sur l'app shell pour une navigation
      if (request.mode === 'navigate') {
        return caches.match('/index.html');
      }
      return Response.error();
    })
  );
});
