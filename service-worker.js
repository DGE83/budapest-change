// =========================================================================
// Service worker : met en cache une liste blanche de fichiers de l'app shell
// pour un fonctionnement hors ligne.
//
// Deux stratégies, strictement séparées :
//  - app shell (liste blanche same-origin) : stale-while-revalidate (le cache
//    répond immédiatement, le réseau met à jour le cache en arrière-plan) ;
//  - API du taux (api.frankfurter.dev) : network-first stricte, jamais servie
//    depuis un cache. Le taux n'est JAMAIS stocké ici ; le repli hors ligne est
//    géré côté page via localStorage (voir app.js). L'API renvoie
//    "Cache-Control: public, max-age=86400" : sans ce traitement, le navigateur
//    resservait sa copie de la veille (bug du taux périmé du 13/11/2026).
//
// Tout le reste (autres origines, fichiers hors liste blanche) n'est pas
// intercepté : la requête part directement au réseau.
// =========================================================================

// Incrémenter cette version à chaque déploiement pour que les clients
// téléchargent le nouvel app shell et purgent l'ancien cache.
const VERSION = 'v5';
const PREFIXE_CACHE = 'change-budapest-';
const CACHE_APP_SHELL = `${PREFIXE_CACHE}${VERSION}`;

// Origine de l'API du taux : traitée en network-first, jamais mise en cache.
const ORIGINE_API_TAUX = 'https://api.frankfurter.dev';

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

// Télécharge un fichier de l'app shell en contournant le cache HTTP du
// navigateur (cache: 'reload'). Sans cela, l'installation d'une nouvelle
// version pouvait recopier dans le nouveau cache l'ancienne copie encore
// présente dans le cache HTTP : l'app ne se mettait pas à jour.
async function mettreEnCacheFrais(cache, chemin) {
  const reponse = await fetch(chemin, { cache: 'reload' });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status} pour ${chemin}`);
  await cache.put(chemin, reponse);
}

// Installation : on pré-remplit le cache avec l'app shell. Chaque fichier est
// mis en cache indépendamment (Promise.allSettled) pour qu'un seul fichier
// manquant ou en échec ne bloque pas l'installation de tous les autres.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_APP_SHELL).then(async (cache) => {
      const resultats = await Promise.allSettled(
        FICHIERS_APP_SHELL.map((chemin) => mettreEnCacheFrais(cache, chemin))
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

// Network-first stricte pour l'API du taux : la requête repart toujours au
// réseau avec cache: 'no-store', donc ni le cache HTTP du navigateur ni le
// Cache Storage ne peuvent fournir une réponse. Rien n'est mis en cache ici :
// en cas d'échec réseau, l'erreur remonte à app.js, qui affiche le dernier
// taux mémorisé en localStorage avec sa vraie date.
function reseauUniquement(request) {
  return fetch(request, { cache: 'no-store' });
}

// Récupération des requêtes :
//  - GET vers l'API du taux : network-first stricte (jamais de cache) ;
//  - GET de même origine dont le chemin est dans la liste blanche de l'app
//    shell : stale-while-revalidate ;
//  - tout le reste part directement au réseau, sans passer par respondWith().
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === ORIGINE_API_TAUX) {
    event.respondWith(reseauUniquement(request));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (!CHEMINS_AUTORISES.has(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_APP_SHELL).then(async (cache) => {
      const reponseEnCache = await cache.match(request);

      // Mise à jour en arrière-plan : revalidation forcée auprès du serveur
      // (cache: 'no-cache' -> requête conditionnelle, 304 si rien n'a changé),
      // pour que le cache HTTP du navigateur ne masque pas un redéploiement.
      // Seules les réponses valides et de même origine ("basic") sont mises en
      // cache (jamais une réponse opaque/erreur).
      const miseAJourReseau = fetch(request, { cache: 'no-cache' })
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
