// =========================================================================
// Convertisseur EUR <-> HUF pour un voyageur à Budapest
// Taux officiel BCE récupéré via l'API gratuite Frankfurter.
// Réponse de l'API (vérifiée avec curl) :
// {"amount":1.0,"base":"EUR","date":"2026-11-05","rates":{"HUF":363.18}}
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
let tauxBrut = null;       // taux BCE EUR -> HUF
let dateTaux = null;       // date renvoyée par l'API
let marge = 3;             // marge en %, 3% par défaut
let dernierChampModifie = 'eur'; // sert à savoir quel champ recalculer après un changement de marge
let derniereMajDate = null; // date/heure du dernier taux obtenu avec succès (ou repris du cache)

// -------------------------------------------------------------------------
// Fonctions utilitaires
// -------------------------------------------------------------------------

// Transforme un texte saisi par l'utilisateur (avec virgule ou point) en nombre
function analyserNombre(texte) {
  if (typeof texte !== 'string') return NaN;
  const nettoye = texte.trim().replace(/\s/g, '').replace(',', '.');
  if (nettoye === '') return NaN;
  return parseFloat(nettoye);
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
  infoDateTaux.textContent = dateTaux || '—';
}

// Affiche l'heure de la dernière actualisation réussie (ou reprise du cache)
function afficherHeureMaj() {
  infoMaj.textContent = derniereMajDate ? derniereMajDate.toLocaleTimeString('fr-FR') : '—';
}

// Formate une date en "JJ/MM à HH:MM" (fuseau local)
function formaterDateHeureCourte(date) {
  const jourMois = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const heureMin = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${jourMois} à ${heureMin}`;
}

// Affiche ou masque le message d'erreur
function afficherErreur(texte) {
  if (texte) {
    messageErreur.textContent = texte;
    messageErreur.hidden = false;
  } else {
    messageErreur.hidden = true;
  }
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

// Compte les jours ouvrés (lun-ven) strictement après dateDebut, jusqu'à dateFin inclus.
// La BCE ne publie pas de taux le samedi ni le dimanche : ces jours ne comptent pas comme "retard".
function compterJoursOuvres(dateDebut, dateFin) {
  let compte = 0;
  const curseur = new Date(dateDebut);
  curseur.setDate(curseur.getDate() + 1);
  while (curseur <= dateFin) {
    const jourSemaine = curseur.getDay(); // 0 = dimanche, 6 = samedi
    if (jourSemaine !== 0 && jourSemaine !== 6) compte++;
    curseur.setDate(curseur.getDate() + 1);
  }
  return compte;
}

function joursCalendairesEntre(dateDebut, dateFin) {
  const MS_PAR_JOUR = 24 * 60 * 60 * 1000;
  return Math.round((dateFin - dateDebut) / MS_PAR_JOUR);
}

// Affiche un avertissement si le taux affiché est trop ancien :
// plus de 3 jours calendaires, ou plus de 1 jour ouvré (hors week-end, normal côté BCE).
function majIndicateurPerime() {
  if (!tauxBrut || !dateTaux) {
    indicateurPerime.hidden = true;
    return;
  }
  const dateRef = new Date(`${dateTaux}T00:00:00`);
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);

  const diffCalendaire = joursCalendairesEntre(dateRef, aujourdhui);
  const diffOuvres = compterJoursOuvres(dateRef, aujourdhui);

  if (diffCalendaire > 3 || diffOuvres > 1) {
    indicateurPerime.textContent = `⚠️ Taux périmé (daté du ${dateRef.toLocaleDateString('fr-FR')})`;
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
  const valeurEur = analyserNombre(champEur.value);
  if (isNaN(valeurEur)) {
    champHuf.value = '';
    return;
  }
  const huf = valeurEur * calculerTauxEffectif();
  champHuf.value = formatHuf.format(Math.round(huf));
}

// Recalcule le champ EUR à partir de la valeur saisie dans le champ HUF
function convertirDepuisHuf() {
  if (tauxBrut === null) return;
  const valeurHuf = analyserNombre(champHuf.value);
  if (isNaN(valeurHuf)) {
    champEur.value = '';
    return;
  }
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
  listeReperes.innerHTML = '';
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

function lireCacheHistorique() {
  const brut = localStorage.getItem(CLE_HISTORIQUE);
  if (!brut) return null;
  try {
    return JSON.parse(brut);
  } catch {
    return null;
  }
}

// Dessine la courbe + met à jour le texte min/max à partir d'une liste de points {date, taux}
function afficherGraphique(points) {
  conteneurGraphique.innerHTML = '';

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
    if (enCache && enCache.dateCache === isoAujourdhui) {
      afficherGraphique(enCache.points);
      return;
    }
  }

  const dateDebut = new Date(aujourdhui);
  dateDebut.setDate(dateDebut.getDate() - 7);
  const url = `${URL_API_HISTORIQUE_BASE}/${formaterDateISO(dateDebut)}..${isoAujourdhui}?base=EUR&symbols=HUF`;

  try {
    const reponse = await fetch(url);
    if (!reponse.ok) throw new Error('Réponse historique invalide');
    const donnees = await reponse.json();
    const points = Object.keys(donnees.rates)
      .sort()
      .map((date) => ({ date, taux: donnees.rates[date].HUF }));

    localStorage.setItem(CLE_HISTORIQUE, JSON.stringify({ dateCache: isoAujourdhui, points }));
    afficherGraphique(points);
  } catch (erreur) {
    // Hors ligne ou API indisponible : on garde le dernier historique mémorisé, même périmé
    const enCache = lireCacheHistorique();
    if (enCache) {
      afficherGraphique(enCache.points);
    } else {
      infoMinMax.textContent = 'Historique indisponible hors ligne.';
    }
  }
}

// -------------------------------------------------------------------------
// Récupération du taux de change
// -------------------------------------------------------------------------

async function recupererTaux() {
  try {
    const reponse = await fetch(URL_API);
    if (!reponse.ok) throw new Error('Réponse API invalide');
    const donnees = await reponse.json();
    const nouveauTaux = donnees.rates && donnees.rates.HUF;
    if (!nouveauTaux) throw new Error('Taux HUF absent de la réponse');

    tauxBrut = nouveauTaux;
    dateTaux = donnees.date;
    derniereMajDate = new Date();

    // On mémorise ce taux pour pouvoir l'utiliser hors-ligne la prochaine fois
    localStorage.setItem(CLE_TAUX_BRUT, String(tauxBrut));
    localStorage.setItem(CLE_DATE_TAUX, dateTaux);
    localStorage.setItem(CLE_DERNIERE_MAJ, derniereMajDate.toISOString());

    afficherErreur(null);
  } catch (erreur) {
    // En cas d'échec, on retombe sur le dernier taux connu s'il existe
    const tauxMemorise = localStorage.getItem(CLE_TAUX_BRUT);
    const dateMemorisee = localStorage.getItem(CLE_DATE_TAUX);
    const majMemorisee = localStorage.getItem(CLE_DERNIERE_MAJ);

    if (tauxMemorise) {
      tauxBrut = parseFloat(tauxMemorise);
      dateTaux = dateMemorisee;
      derniereMajDate = majMemorisee ? new Date(majMemorisee) : null;
      afficherErreur('Impossible de récupérer le taux en direct. Dernier taux connu utilisé.');
    } else {
      afficherErreur('Impossible de récupérer le taux de change et aucun taux n\'est mémorisé.');
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
  const margeMemorisee = localStorage.getItem(CLE_MARGE);
  marge = margeMemorisee !== null ? parseFloat(margeMemorisee) : 3;
  curseurMarge.value = marge;
  valeurMargeAffichee.textContent = formatTaux.format(marge);
}

curseurMarge.addEventListener('input', () => {
  marge = parseFloat(curseurMarge.value);
  valeurMargeAffichee.textContent = formatTaux.format(marge);
  localStorage.setItem(CLE_MARGE, String(marge));
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
  champEur.focus();
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

function initialiserTheme() {
  const themeMemorise = localStorage.getItem(CLE_THEME); // 'clair', 'sombre' ou null (auto)
  appliquerTheme(themeMemorise);
}

btnTheme.addEventListener('click', () => {
  // On fait tourner les trois états : auto -> clair -> sombre -> auto ...
  const actuel = localStorage.getItem(CLE_THEME);
  let suivant;
  if (actuel === null) suivant = 'clair';
  else if (actuel === 'clair') suivant = 'sombre';
  else suivant = null;

  if (suivant === null) {
    localStorage.removeItem(CLE_THEME);
  } else {
    localStorage.setItem(CLE_THEME, suivant);
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

initialiserTheme();
initialiserMarge();
majIndicateurHorsLigne();
recupererTaux();
recupererHistorique(false);
