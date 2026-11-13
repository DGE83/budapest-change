// =========================================================================
// Convertisseur EUR <-> HUF pour un voyageur à Budapest
// Taux officiel BCE récupéré via l'API gratuite Frankfurter.
// Réponse de l'API (vérifiée avec curl) :
// {"amount":1.0,"base":"EUR","date":"2026-11-05","rates":{"HUF":363.18}}
// Toute donnée externe (saisie utilisateur, réponse API, localStorage) est
// validée strictement avant usage : voir validerTaux(), analyserMontant(),
// dateEstValide() et les lectures de localStorage ci-dessous.
// =========================================================================

// Repères de prix usuels à Budapest (fourchettes en HUF, modifiables librement).
// L'équivalent en euros est recalculé automatiquement avec le taux réaliste du moment.
const REPERES_PRIX_BUDAPEST = [
  { libelle: 'Café en terrasse', hufMin: 600, hufMax: 900 },
  { libelle: 'Bière (0,5 l) au bar', hufMin: 900, hufMax: 1500 },
  { libelle: 'Plat du jour (menü) le midi', hufMin: 2500, hufMax: 3500 },
  { libelle: 'Repas au restaurant (par personne)', hufMin: 4000, hufMax: 7000 },
  { libelle: 'Ticket de transport public', hufMin: 450, hufMax: 450 },
  { libelle: 'Course en taxi (trajet urbain moyen)', hufMin: 2500, hufMax: 4500 },
];

const URL_API = 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=HUF';
const URL_API_HISTORIQUE_BASE = 'https://api.frankfurter.dev/v1';
const DELAI_TIMEOUT_MS = 8000;

// Bornes de validation d'une saisie utilisateur
const RE_MONTANT = /^\d+(\.\d{0,2})?$/;
const MAX_EUR = 10000000;
const MAX_HUF = 3000000000;

// Clés utilisées dans le localStorage pour mémoriser les réglages/dernier taux
const CLE_MARGE = 'change-budapest-marge';
const CLE_TAUX_BRUT = 'change-budapest-taux-brut';
const CLE_DATE_TAUX = 'change-budapest-date-taux';
const CLE_DERNIERE_MAJ = 'change-budapest-derniere-maj';
const CLE_HISTORIQUE = 'change-budapest-historique';
const CLE_THEME = 'change-budapest-theme';

// Références aux éléments du DOM
const champEur = document.getElementById('champ-eur');
const champHuf = document.getElementById('champ-huf');
const curseurMarge = document.getElementById('curseur-marge');
const valeurMargeAffichee = document.getElementById('valeur-marge');
const infoTauxBrut = document.getElementById('info-taux-brut');
const infoTauxReel = document.getElementById('info-taux-reel');
const infoDateTaux = document.getElementById('info-date-taux');
const infoMaj = document.getElementById('info-maj');
const messageErreur = document.getElementById('message-erreur');
const indicateurHorsLigne = document.getElementById('indicateur-hors-ligne');
const indicateurPerime = document.getElementById('indicateur-perime');
const conteneurGraphique = document.getElementById('conteneur-graphique');
const infoMinMax = document.getElementById('info-min-max');
const listeReperes = document.getElementById('liste-reperes');
const btnTheme = document.getElementById('btn-theme');
const btnReinit = document.getElementById('btn-reinit');
const btnActualiser = document.getElementById('btn-actualiser');

// Formateurs de nombres au format français (espace pour les milliers, virgule décimale)
const formatEur = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatHuf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const formatTaux = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
// Affichage du taux BCE/réaliste : toujours 2 décimales (le calcul interne garde, lui, la pleine précision)
const formatTauxAffiche = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// État de l'application
let tauxBrut = null;       // taux BCE EUR -> HUF (toujours une valeur déjà validée par validerTaux/tauxEstValide)
let dateTaux = null;       // date renvoyée par l'API (toujours déjà validée par dateEstValide)
let marge = 3;             // marge en %, 3% par défaut
let dernierChampModifie = 'huf'; // sert à savoir quel champ recalculer après un changement de marge (HUF -> EUR par défaut)
let derniereMajDate = null; // date/heure du dernier taux obtenu avec succès (ou repris du cache)

// -------------------------------------------------------------------------
// Accès sécurisés au localStorage (peut lever en navigation privée, quota
// dépassé, politique du navigateur, etc. : on ne doit jamais planter l'app)
// -------------------------------------------------------------------------

function lireLocalStorage(cle) {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}

function ecrireLocalStorage(cle, valeur) {
  try {
    localStorage.setItem(cle, valeur);
  } catch (erreur) {
    console.warn(`Écriture localStorage impossible pour "${cle}" :`, erreur);
  }
}

function supprimerLocalStorage(cle) {
  try {
    localStorage.removeItem(cle);
  } catch (erreur) {
    console.warn(`Suppression localStorage impossible pour "${cle}" :`, erreur);
  }
}

// -------------------------------------------------------------------------
// Validation des données (saisie utilisateur, réponses API, localStorage)
// -------------------------------------------------------------------------

// Valide strictement une saisie numérique : espaces (y compris les espaces
// insécables utilisés par le formatage fr-FR) supprimés, virgule acceptée
// comme séparateur décimal, puis comparaison à une forme exacte. Toute
// forme non conforme est rejetée plutôt qu'interprétée partiellement
// (ex. "100abc" ou "1e9" ne sont jamais lus comme un nombre).
function analyserMontant(texte, max) {
  if (typeof texte !== 'string') return NaN;
  const nettoye = texte.replace(/\s/g, '').replace(',', '.');
  if (!RE_MONTANT.test(nettoye)) return NaN;
  const n = parseFloat(nettoye);
  if (!Number.isFinite(n) || n < 0 || n > max) return NaN;
  return n;
}

// Vérifie qu'une chaîne est une date calendaire réelle au format AAAA-MM-JJ
// (rejette par exemple "2026-13-40", que le simple format regex laisserait passer)
function dateEstValide(texte) {
  if (typeof texte !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texte)) return false;
  const [annee, mois, jour] = texte.split('-').map(Number);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  return date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour;
}

// Un taux EUR -> HUF plausible : nombre fini et dans une fourchette réaliste.
// Évite d'accepter 0, une chaîne mal typée, ou une valeur aberrante renvoyée par l'API.
function tauxEstValide(huf) {
  return typeof huf === 'number' && Number.isFinite(huf) && huf >= 100 && huf <= 1000;
}

// Valide la forme complète d'une réponse de l'endpoint "latest" de l'API
function validerTaux(donnees) {
  return !!donnees
    && typeof donnees === 'object'
    && !!donnees.rates
    && typeof donnees.rates === 'object'
    && tauxEstValide(donnees.rates.HUF)
    && dateEstValide(donnees.date);
}

// -------------------------------------------------------------------------
// Fonctions utilitaires
// -------------------------------------------------------------------------

// Ajoute un paramètre anti-cache (horodatage) à une URL d'API.
// Ceinture-bretelles indispensable : l'API renvoie "Cache-Control: public,
// max-age=86400", et certaines versions de WebKit/iOS ignorent l'option
// `cache: 'no-store'` de fetch(). Avec une URL unique à chaque appel, aucun
// cache (navigateur, CDN, service worker) ne peut resservir une vieille réponse.
// Vérifié : l'API tolère ce paramètre supplémentaire (200, charge utile identique).
function urlSansCache(url) {
  const separateur = url.includes('?') ? '&' : '?';
  return `${url}${separateur}_=${Date.now()}`;
}

// Effectue un fetch avec une limite de temps : abandonne la requête après
// `delaiMs` pour ne jamais laisser l'interface bloquée sur un réseau très lent.
// `cache: 'no-store'` : la réponse n'est ni lue ni écrite dans le cache HTTP,
// on interroge donc toujours réellement le réseau (c'était la cause du taux
// périmé affiché le 13/11/2026 alors que celui du 12/11 était publié).
async function fetchAvecTimeout(url, delaiMs = DELAI_TIMEOUT_MS) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), delaiMs);
  try {
    return await fetch(urlSansCache(url), {
      signal: controleur.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(minuteur);
  }
}

// Calcule le taux réaliste à partir du taux BCE brut et de la marge (en %)
function calculerTauxEffectif() {
  return tauxBrut * (1 - marge / 100);
}

// Formate une date locale en "AAAA-MM-JJ" (sans décalage UTC, contrairement à toISOString)
function formaterDateISO(date) {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}

// Affiche les informations de taux dans le bloc d'infos
function afficherInfosTaux() {
  if (tauxBrut === null) {
    infoTauxBrut.textContent = '—';
    infoTauxReel.textContent = '—';
    infoDateTaux.textContent = '—';
    return;
  }
  const tauxEffectif = calculerTauxEffectif();
  infoTauxBrut.textContent = `1 € = ${formatTauxAffiche.format(tauxBrut)} Ft`;
  infoTauxReel.textContent = `1 € = ${formatTauxAffiche.format(tauxEffectif)} Ft`;
  // "Date du taux" = date de publication renvoyée par la BCE via l'API,
  // à ne pas confondre avec "Dernière actualisation" ci-dessous.
  infoDateTaux.textContent = dateTaux ? new Date(`${dateTaux}T00:00:00`).toLocaleDateString('fr-FR') : '—';
}

// Affiche la date/heure du dernier succès réseau — pas l'heure du clic sur
// "Actualiser" : `derniereMajDate` n'est mis à jour que quand des données
// valides ont effectivement été reçues (voir recupererTaux), et il est
// restauré depuis le localStorage au démarrage.
// L'heure seule serait trompeuse pour un taux rapatrié la veille : on
// préfixe donc la date dès que le dernier succès n'est pas du jour même.
function afficherHeureMaj() {
  if (!derniereMajDate) {
    infoMaj.textContent = '—';
    return;
  }
  const heure = derniereMajDate.toLocaleTimeString('fr-FR');
  const estAujourdhui = formaterDateISO(derniereMajDate) === formaterDateISO(new Date());
  infoMaj.textContent = estAujourdhui
    ? `aujourd'hui à ${heure}`
    : `${derniereMajDate.toLocaleDateString('fr-FR')} à ${heure}`;
}

// Formate une date en "JJ/MM à HH:MM" (fuseau local)
function formaterDateHeureCourte(date) {
  const jourMois = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const heureMin = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${jourMois} à ${heureMin}`;
}

// Le même emplacement affiche deux types de messages distincts qui ne doivent
// jamais s'écraser l'un l'autre : une erreur de saisie (prioritaire, car elle
// concerne une action en cours de l'utilisateur) et le statut du taux réseau
// (cache / non actualisé / aucun taux). On les garde en mémoire séparément.
let messageSaisieActuel = null;
let messageStatutTauxActuel = null;

function rafraichirMessageEtat() {
  const texte = messageSaisieActuel || messageStatutTauxActuel;
  if (texte) {
    messageErreur.textContent = texte;
    messageErreur.hidden = false;
  } else {
    messageErreur.hidden = true;
  }
}

// Affiche ou masque le message d'erreur de saisie (champ EUR/HUF invalide)
function afficherErreurSaisie(texte) {
  messageSaisieActuel = texte || null;
  rafraichirMessageEtat();
}

// Affiche ou masque le message de statut du taux (cache / non actualisé / aucun taux)
function afficherStatutTaux(texte) {
  messageStatutTauxActuel = texte || null;
  rafraichirMessageEtat();
}

// Affiche ou masque l'indicateur "Hors ligne" selon l'état de la connexion
function majIndicateurHorsLigne() {
  if (navigator.onLine) {
    indicateurHorsLigne.hidden = true;
    return;
  }
  indicateurHorsLigne.textContent = derniereMajDate
    ? `📡 Hors ligne – taux du ${formaterDateHeureCourte(derniereMajDate)}`
    : '📡 Hors ligne – aucun taux disponible';
  indicateurHorsLigne.hidden = false;
}

window.addEventListener('online', majIndicateurHorsLigne);
window.addEventListener('offline', majIndicateurHorsLigne);

// Seuil au-delà duquel le taux affiché est signalé comme périmé.
// 3 jours calendaires : un week-end (vendredi -> lundi = 3 jours) ou un jour
// férié ne déclenche donc jamais de fausse alerte, puisque la BCE ne publie
// ni le samedi, ni le dimanche, ni les jours de fermeture TARGET.
// Entre 1 et 3 jours d'écart : aucun bandeau.
const SEUIL_PERIME_JOURS = 3;

function joursCalendairesEntre(dateDebut, dateFin) {
  const MS_PAR_JOUR = 24 * 60 * 60 * 1000;
  return Math.round((dateFin - dateDebut) / MS_PAR_JOUR);
}

// Affiche un avertissement uniquement si la date du taux a plus de 3 jours.
function majIndicateurPerime() {
  if (!tauxBrut || !dateTaux) {
    indicateurPerime.hidden = true;
    return;
  }
  const dateRef = new Date(`${dateTaux}T00:00:00`);
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);

  const ancienneteJours = joursCalendairesEntre(dateRef, aujourdhui);

  if (ancienneteJours > SEUIL_PERIME_JOURS) {
    indicateurPerime.textContent = `⚠️ Taux périmé (daté du ${dateRef.toLocaleDateString('fr-FR')}, ${ancienneteJours} jours)`;
    indicateurPerime.hidden = false;
  } else {
    indicateurPerime.hidden = true;
  }
}

// -------------------------------------------------------------------------
// Conversions entre les deux champs
// -------------------------------------------------------------------------

// Recalcule le champ HUF à partir de la valeur saisie dans le champ EUR
function convertirDepuisEur() {
  if (tauxBrut === null) return;
  const texte = champEur.value;
  if (texte.trim() === '') {
    champHuf.value = '';
    afficherErreurSaisie(null);
    return;
  }
  const valeurEur = analyserMontant(texte, MAX_EUR);
  if (!Number.isFinite(valeurEur)) {
    champHuf.value = '';
    afficherErreurSaisie('Montant EUR invalide.');
    return;
  }
  afficherErreurSaisie(null);
  const huf = valeurEur * calculerTauxEffectif();
  champHuf.value = formatHuf.format(Math.round(huf));
}

// Recalcule le champ EUR à partir de la valeur saisie dans le champ HUF
function convertirDepuisHuf() {
  if (tauxBrut === null) return;
  const texte = champHuf.value;
  if (texte.trim() === '') {
    champEur.value = '';
    afficherErreurSaisie(null);
    return;
  }
  const valeurHuf = analyserMontant(texte, MAX_HUF);
  if (!Number.isFinite(valeurHuf)) {
    champEur.value = '';
    afficherErreurSaisie('Montant HUF invalide.');
    return;
  }
  afficherErreurSaisie(null);
  const eur = valeurHuf / calculerTauxEffectif();
  champEur.value = formatEur.format(eur);
}

// Recalcule le champ "cible" en fonction du dernier champ modifié par l'utilisateur
// (utile après un changement de marge ou une actualisation du taux)
function recalculerSelonDernierChamp() {
  if (dernierChampModifie === 'huf') {
    convertirDepuisHuf();
  } else {
    convertirDepuisEur();
  }
}

// -------------------------------------------------------------------------
// Repères de prix à Budapest (recalculés avec le taux réaliste du moment)
// -------------------------------------------------------------------------

function afficherReperes() {
  listeReperes.replaceChildren();
  if (tauxBrut === null) return;

  const tauxEffectif = calculerTauxEffectif();

  REPERES_PRIX_BUDAPEST.forEach((repere) => {
    const estMontantFixe = repere.hufMin === repere.hufMax;
    const eurMin = repere.hufMin / tauxEffectif;
    const eurMax = repere.hufMax / tauxEffectif;

    const texteHuf = estMontantFixe
      ? `${formatHuf.format(repere.hufMin)} Ft`
      : `${formatHuf.format(repere.hufMin)}–${formatHuf.format(repere.hufMax)} Ft`;
    const texteEur = estMontantFixe
      ? `≈ ${formatEur.format(eurMin)} €`
      : `≈ ${formatEur.format(eurMin)}–${formatEur.format(eurMax)} €`;

    const li = document.createElement('li');

    const spanLibelle = document.createElement('span');
    spanLibelle.className = 'repere-libelle';
    spanLibelle.textContent = repere.libelle;

    const spanValeurs = document.createElement('span');
    spanValeurs.className = 'repere-valeurs';
    spanValeurs.textContent = `${texteHuf} (${texteEur})`;

    li.appendChild(spanLibelle);
    li.appendChild(spanValeurs);
    listeReperes.appendChild(li);
  });
}

// -------------------------------------------------------------------------
// Graphique SVG de l'évolution du taux sur 7 jours (pur, sans bibliothèque)
// -------------------------------------------------------------------------

// Relit l'historique en cache en le validant point par point : structure
// inattendue -> on repart d'un historique vide plutôt que de planter ou
// d'afficher une donnée corrompue.
function lireCacheHistorique() {
  const brut = lireLocalStorage(CLE_HISTORIQUE);
  if (!brut) return null;

  let analyse;
  try {
    analyse = JSON.parse(brut);
  } catch {
    return null;
  }

  if (!analyse || typeof analyse !== 'object' || !Array.isArray(analyse.points)) {
    return null;
  }

  const points = analyse.points
    .filter((p) => p && dateEstValide(p.date) && tauxEstValide(p.taux))
    .slice(-14);

  return { dateCache: typeof analyse.dateCache === 'string' ? analyse.dateCache : '', points };
}

// Dessine la courbe + met à jour le texte min/max à partir d'une liste de points {date, taux}
function afficherGraphique(points) {
  conteneurGraphique.replaceChildren();

  if (!points || points.length === 0) {
    infoMinMax.textContent = 'Historique indisponible.';
    return;
  }

  const valeurs = points.map((p) => p.taux);
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);

  const LARGEUR = 280;
  const HAUTEUR = 64;
  const MARGE = 6;
  const n = points.length;

  const position = (i, valeur) => {
    const x = n === 1 ? LARGEUR / 2 : MARGE + (i * (LARGEUR - 2 * MARGE)) / (n - 1);
    const y = max === min
      ? HAUTEUR / 2
      : HAUTEUR - MARGE - ((valeur - min) * (HAUTEUR - 2 * MARGE)) / (max - min);
    return [x, y];
  };

  const coords = points.map((p, i) => position(i, p.taux));

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${LARGEUR} ${HAUTEUR}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `Taux EUR vers HUF sur ${n} jours, de ${formatTauxAffiche.format(min)} à ${formatTauxAffiche.format(max)} forints`
  );

  const ligne = document.createElementNS(svgNS, 'polyline');
  ligne.setAttribute('class', 'ligne-graphique');
  ligne.setAttribute('points', coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  svg.appendChild(ligne);

  // Point mis en avant : le taux le plus récent de la période
  const [xDernier, yDernier] = coords[coords.length - 1];
  const point = document.createElementNS(svgNS, 'circle');
  point.setAttribute('class', 'point-graphique');
  point.setAttribute('cx', xDernier.toFixed(1));
  point.setAttribute('cy', yDernier.toFixed(1));
  point.setAttribute('r', '2.5');
  svg.appendChild(point);

  conteneurGraphique.appendChild(svg);

  infoMinMax.textContent = `Min 7j : ${formatTauxAffiche.format(min)} Ft · Max 7j : ${formatTauxAffiche.format(max)} Ft`;
}

// Récupère l'historique 7 jours (mis en cache localement pour la journée en cours)
async function recupererHistorique(force) {
  const aujourdhui = new Date();
  const isoAujourdhui = formaterDateISO(aujourdhui);

  if (!force) {
    const enCache = lireCacheHistorique();
    if (enCache && enCache.dateCache === isoAujourdhui && enCache.points.length > 0) {
      afficherGraphique(enCache.points);
      return;
    }
  }

  const dateDebut = new Date(aujourdhui);
  dateDebut.setDate(dateDebut.getDate() - 7);
  const url = `${URL_API_HISTORIQUE_BASE}/${formaterDateISO(dateDebut)}..${isoAujourdhui}?base=EUR&symbols=HUF`;

  try {
    const reponse = await fetchAvecTimeout(url);
    if (!reponse.ok) throw new Error('Réponse historique invalide');
    const donnees = await reponse.json();
    if (!donnees || typeof donnees.rates !== 'object') throw new Error('Historique mal formé');

    // Même validation que pour le taux courant, appliquée à chaque point
    const points = Object.keys(donnees.rates)
      .filter((date) => dateEstValide(date) && tauxEstValide(donnees.rates[date] && donnees.rates[date].HUF))
      .sort()
      .map((date) => ({ date, taux: donnees.rates[date].HUF }));

    if (points.length === 0) throw new Error('Aucun point valide dans la réponse');

    ecrireLocalStorage(CLE_HISTORIQUE, JSON.stringify({ dateCache: isoAujourdhui, points: points.slice(-14) }));
    afficherGraphique(points);
  } catch (erreur) {
    // Hors ligne, timeout, API indisponible ou données invalides : on garde le dernier historique
    // mémorisé (même périmé) plutôt que d'afficher une donnée douteuse
    const enCache = lireCacheHistorique();
    if (enCache && enCache.points.length > 0) {
      afficherGraphique(enCache.points);
    } else {
      conteneurGraphique.replaceChildren();
      infoMinMax.textContent = 'Historique indisponible hors ligne.';
    }
  }
}

// -------------------------------------------------------------------------
// Récupération du taux de change
// -------------------------------------------------------------------------

// Tente de recharger un taux précédemment validé depuis le localStorage.
// Ne modifie l'état en mémoire que si la valeur stockée est encore valide.
// Renvoie true si un taux de secours a été restauré.
// Trois informations sont mémorisées à chaque succès réseau : le taux, sa date
// de publication BCE, et l'heure de récupération — de sorte qu'hors réseau on
// affiche le dernier taux connu avec sa vraie date, jamais la date du jour.
function chargerTauxCache() {
  const tauxMemorise = lireLocalStorage(CLE_TAUX_BRUT);
  const dateMemorisee = lireLocalStorage(CLE_DATE_TAUX);
  const majMemorisee = lireLocalStorage(CLE_DERNIERE_MAJ);

  const huf = tauxMemorise !== null ? Number(tauxMemorise) : NaN;
  if (!tauxEstValide(huf) || !dateEstValide(dateMemorisee)) return false;

  const maj = majMemorisee ? new Date(majMemorisee) : null;
  if (maj && Number.isNaN(maj.getTime())) return false;

  tauxBrut = huf;
  dateTaux = dateMemorisee;
  derniereMajDate = maj;
  return true;
}

// Enregistre un taux fraîchement validé : taux, date BCE et heure de récupération.
function memoriserTaux() {
  ecrireLocalStorage(CLE_TAUX_BRUT, String(tauxBrut));
  ecrireLocalStorage(CLE_DATE_TAUX, dateTaux);
  ecrireLocalStorage(CLE_DERNIERE_MAJ, derniereMajDate.toISOString());
}

// Restaure le dernier taux connu et peint l'interface tout de suite, avant la
// moindre requête : hors réseau (ou sur réseau lent, jusqu'à 8 s de timeout),
// l'utilisateur voit le dernier taux avec sa date au lieu de "—".
function afficherTauxDeSecours() {
  if (!chargerTauxCache()) return;
  afficherInfosTaux();
  afficherHeureMaj();
  majIndicateurHorsLigne();
  majIndicateurPerime();
  afficherReperes();
  recalculerSelonDernierChamp();
}

// Récupère le taux courant. Trois issues distinctes sont possibles et jamais confondues :
// - réseau OK + données valides : le taux est actualisé, aucun message n'est affiché ;
// - échec réseau/timeout (ou réponse HTTP invalide) : repli sur le dernier taux connu,
//   avec le message "Taux en cache du JJ/MM à HH:MM" (ou "Aucun taux disponible" si rien n'est connu) ;
// - réponse reçue mais données corrompues/suspectes : jamais utilisées, le taux précédent
//   est conservé avec le message "Taux non actualisé".
async function recupererTaux() {
  let reponseOk = false;
  let donneesValides = false;

  try {
    const reponse = await fetchAvecTimeout(URL_API);
    if (reponse.ok) {
      reponseOk = true;
      const donnees = await reponse.json();
      if (validerTaux(donnees)) {
        donneesValides = true;
        tauxBrut = donnees.rates.HUF;
        dateTaux = donnees.date;
        derniereMajDate = new Date();

        // On ne mémorise que des données déjà validées
        memoriserTaux();
      }
    }
  } catch {
    // Réseau indisponible, timeout, ou réponse non-JSON : reponseOk reste à false
  }

  if (donneesValides) {
    afficherStatutTaux(null);
  } else if (reponseOk) {
    // La requête a abouti mais le contenu est invalide : on ne l'utilise jamais
    if (tauxBrut === null) chargerTauxCache();
    afficherStatutTaux(tauxBrut !== null
      ? `Taux non actualisé (donnée reçue invalide, taux du ${dateTaux} conservé).`
      : 'Taux non actualisé (donnée reçue invalide) et aucun taux disponible.');
  } else {
    // Échec réseau, timeout, ou réponse HTTP non OK
    if (tauxBrut === null) chargerTauxCache();
    if (tauxBrut === null) {
      afficherStatutTaux('Aucun taux disponible.');
    } else if (derniereMajDate) {
      afficherStatutTaux(`Taux du ${dateTaux} (récupéré le ${formaterDateHeureCourte(derniereMajDate)}).`);
    } else {
      // Taux mémorisé sans horodatage de récupération (stockage partiel) :
      // on n'invente pas d'heure, on s'en tient à la date du taux.
      afficherStatutTaux(`Taux du ${dateTaux} conservé (réseau indisponible).`);
    }
  }

  afficherInfosTaux();
  afficherHeureMaj();
  majIndicateurHorsLigne();
  majIndicateurPerime();
  afficherReperes();
  recalculerSelonDernierChamp();
}

// -------------------------------------------------------------------------
// Gestion de la marge (curseur 0 à 10 %, mémorisée dans localStorage)
// -------------------------------------------------------------------------

function initialiserMarge() {
  const margeMemorisee = lireLocalStorage(CLE_MARGE);
  const valeur = margeMemorisee !== null ? Number(margeMemorisee) : NaN;
  marge = Number.isFinite(valeur) && valeur >= 0 && valeur <= 10 ? valeur : 3;
  curseurMarge.value = marge;
  valeurMargeAffichee.textContent = formatTaux.format(marge);
}

curseurMarge.addEventListener('input', () => {
  marge = parseFloat(curseurMarge.value);
  valeurMargeAffichee.textContent = formatTaux.format(marge);
  ecrireLocalStorage(CLE_MARGE, String(marge));
  afficherInfosTaux();
  afficherReperes();
  recalculerSelonDernierChamp();
});

// -------------------------------------------------------------------------
// Saisie dans les champs EUR / HUF
// -------------------------------------------------------------------------

champEur.addEventListener('input', () => {
  dernierChampModifie = 'eur';
  convertirDepuisEur();
});

champHuf.addEventListener('input', () => {
  dernierChampModifie = 'huf';
  convertirDepuisHuf();
});

// -------------------------------------------------------------------------
// Boutons de montants rapides
// -------------------------------------------------------------------------

document.querySelectorAll('.btn-raccourci').forEach((bouton) => {
  bouton.addEventListener('click', () => {
    const devise = bouton.dataset.devise;
    const valeur = parseFloat(bouton.dataset.valeur);

    if (devise === 'eur') {
      champEur.value = formatEur.format(valeur);
      dernierChampModifie = 'eur';
      convertirDepuisEur();
    } else {
      champHuf.value = formatHuf.format(valeur);
      dernierChampModifie = 'huf';
      convertirDepuisHuf();
    }
  });
});

// -------------------------------------------------------------------------
// Réinitialisation des champs (pratique pour enchaîner plusieurs conversions)
// -------------------------------------------------------------------------

btnReinit.addEventListener('click', () => {
  champEur.value = '';
  champHuf.value = '';
  afficherErreurSaisie(null);
  champHuf.focus();
});

// -------------------------------------------------------------------------
// Actualisation manuelle (taux courant + historique 7 jours)
// -------------------------------------------------------------------------

btnActualiser.addEventListener('click', async () => {
  btnActualiser.disabled = true;
  btnActualiser.textContent = '⟳ Actualisation…';
  await Promise.all([recupererTaux(), recupererHistorique(true)]);
  btnActualiser.disabled = false;
  btnActualiser.textContent = '⟳ Actualiser';
});

// -------------------------------------------------------------------------
// Thème clair / sombre forcé par l'utilisateur
// -------------------------------------------------------------------------

function appliquerTheme(theme) {
  if (theme === 'clair' || theme === 'sombre') {
    document.documentElement.setAttribute('data-theme', theme === 'clair' ? 'light' : 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// Ne renvoie le thème mémorisé que s'il vaut exactement 'clair' ou 'sombre' ;
// toute autre valeur (absente, corrompue, ancien format) est traitée comme "auto"
function themeMemoriseValide() {
  const valeur = lireLocalStorage(CLE_THEME);
  return valeur === 'clair' || valeur === 'sombre' ? valeur : null;
}

function initialiserTheme() {
  appliquerTheme(themeMemoriseValide());
}

btnTheme.addEventListener('click', () => {
  // On fait tourner les trois états : auto -> clair -> sombre -> auto ...
  const actuel = themeMemoriseValide();
  let suivant;
  if (actuel === null) suivant = 'clair';
  else if (actuel === 'clair') suivant = 'sombre';
  else suivant = null;

  if (suivant === null) {
    supprimerLocalStorage(CLE_THEME);
  } else {
    ecrireLocalStorage(CLE_THEME, suivant);
  }
  appliquerTheme(suivant);
});

// -------------------------------------------------------------------------
// Service worker (mode hors ligne / installation PWA)
// -------------------------------------------------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((erreur) => {
      console.warn("Échec de l'enregistrement du service worker :", erreur);
    });
  });
}

// -------------------------------------------------------------------------
// Démarrage de l'application
// -------------------------------------------------------------------------

// Montant proposé à l'ouverture : un ordre de grandeur utile sur place
// (10 € ~ 3 600 Ft) plutôt qu'une valeur symbolique.
const MONTANT_EUR_PAR_DEFAUT = 10;

// Pré-remplit le champ EUR et calcule son équivalent en HUF. Ne fait rien si
// l'utilisateur a déjà saisi quelque chose (champ non vide).
function appliquerMontantParDefaut() {
  if (champEur.value.trim() !== '' || champHuf.value.trim() !== '') return;
  champEur.value = formatEur.format(MONTANT_EUR_PAR_DEFAUT);
  dernierChampModifie = 'eur';
  convertirDepuisEur(); // sans taux connu, la fonction sort sans rien écrire
}

initialiserTheme();
initialiserMarge();
majIndicateurHorsLigne();

// Le dernier taux connu est peint avant toute requête : l'écran n'est jamais
// vide, même hors réseau ou pendant les 8 s de timeout.
afficherTauxDeSecours();
appliquerMontantParDefaut();

// Puis on interroge le réseau ; dès qu'un taux frais arrive, recupererTaux()
// réaffiche tout et appelle recalculerSelonDernierChamp(), qui convertit le
// montant par défaut même si aucun taux n'était connu au démarrage.
recupererTaux();
recupererHistorique(false);

champHuf.focus(); // le HUF est la devise lue sur place : clavier numérique prêt dès l'ouverture
