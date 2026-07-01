const socket = io();

let etatCourant = { code: null, joueurId: null, pseudo: null, estHote: false };
let racesEnCache = [];
let joueursPartieEnCache = [];
let etatJoueur = null;
let rangAffiche = null; // rang actuellement ouvert sur la page individuelle
let caseAffichee = null; // case actuellement ouverte sur la page de detail

let scenarioImages = [];
let scenarioIndexActuel = 0;
let parametresGlobaux = { tableau_de_bord_actif: false };

async function requeteJSON(url, options = {}) {
  const reponse = await fetch(url, options);
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(donnees.error || 'Erreur inconnue');
  return donnees;
}

// --- Navigation entre les vues ---

function afficherVue(id) {
  document
    .querySelectorAll('#app > section')
    .forEach((section) => section.classList.add('cachee'));
  document.getElementById(id).classList.remove('cachee');
}

// --- Modaux (commencer / scenario) ---

function fermerTousLesModaux() {
  document.querySelectorAll('.modal').forEach((modal) => modal.classList.add('cachee'));
}

function ouvrirModal(id) {
  fermerTousLesModaux();
  document.getElementById(id).classList.remove('cachee');
}

function fermerModal(id) {
  document.getElementById(id).classList.add('cachee');
}

document.getElementById('btn-ouvrir-commencer').addEventListener('click', async () => {
  const partie = await requeteJSON('/api/partie-active').catch(() => ({ active: false }));
  if (!partie.active) {
    return alert("Aucune partie n'est configuree par le maitre du jeu pour le moment.");
  }
  if (partie.statut !== 'en_attente') {
    return alert('La partie a deja demarre, impossible de la commencer.');
  }
  ouvrirModal('modal-commencer');
});

document.querySelectorAll('.btn-fermer-modal').forEach((bouton) => {
  bouton.addEventListener('click', () => fermerModal(bouton.dataset.cible));
});

document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('cachee');
  });
});

// --- Connexion a la partie active (unique, sans code : creee/configuree par le MJ) ---

async function commencerPartie() {
  const pseudo = document.getElementById('commencer-pseudo').value.trim();
  const erreurEl = document.getElementById('erreur-commencer');
  erreurEl.classList.add('cachee');
  if (!pseudo) return alert('Entrez un pseudo');

  try {
    const data = await requeteJSON('/api/partie-active/rejoindre', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pseudo })
    });
    demarrerPartie(data.code, data.joueurId, pseudo);
  } catch (err) {
    erreurEl.textContent = err.message;
    erreurEl.classList.remove('cachee');
  }
}

document.getElementById('btn-commencer-partie').addEventListener('click', commencerPartie);

async function demarrerPartie(code, joueurId, pseudo) {
  etatCourant = { code, joueurId, pseudo, estHote: false };
  fermerModal('modal-commencer');

  racesEnCache = await requeteJSON('/api/races');
  parametresGlobaux = await requeteJSON('/api/parametres');
  scenarioImages = await requeteJSON('/api/scenario');

  socket.emit('rejoindre_partie', { code, joueurId });
}

// --- Choix de la race ---

function afficherChoixRace() {
  const listeEl = document.getElementById('liste-choix-races');
  listeEl.innerHTML = '';

  const racesPrises = new Map();
  joueursPartieEnCache.forEach((j) => {
    if (j.race_id && j.id !== etatCourant.joueurId) racesPrises.set(j.race_id, j.pseudo);
  });

  racesEnCache.forEach((race) => {
    const prisePar = racesPrises.get(race.id);
    const bouton = document.createElement('button');
    bouton.textContent = prisePar ? `${race.nom} (deja jouee par ${prisePar})` : race.nom;
    bouton.disabled = !!prisePar;
    if (!prisePar) {
      bouton.addEventListener('click', () => {
        socket.emit('choix_race', { joueurId: etatCourant.joueurId, raceId: race.id });
      });
    }
    listeEl.appendChild(bouton);
  });

  afficherVue('ecran-choix-race');
}

// --- Etape 1 : page des representants ---

function afficherPageRepresentants() {
  if (!etatJoueur) return;

  const ecranRepresentants = document.getElementById('ecran-representants');
  ecranRepresentants.style.backgroundImage = etatJoueur.imageFond ? `url(${etatJoueur.imageFond})` : '';

  const grille = document.getElementById('grille-representants');
  grille.innerHTML = '';

  etatJoueur.rangs.forEach((rangInfo) => {
    const slot = document.createElement('div');
    slot.className = 'slot-representant';

    if (!rangInfo.deverrouille || !rangInfo.representant) {
      slot.innerHTML = `
        <div class="silhouette">&#128274;</div>
        <div class="nom-slot">Rang ${rangInfo.rang}</div>
      `;
    } else {
      const image = rangInfo.toutesLesCasesValidees
        ? rangInfo.representant.image_sourire || rangInfo.representant.image_depart
        : rangInfo.representant.image_depart;
      slot.innerHTML = `
        ${image ? `<img src="${image}" alt="${rangInfo.representant.nom}" />` : ''}
        <div class="nom-slot">${rangInfo.representant.nom}</div>
        ${rangInfo.toutesLesCasesValidees ? '<div class="couronne">&#128081;</div>' : ''}
      `;
      slot.classList.add('slot-cliquable');
      slot.addEventListener('click', () => afficherRepresentantIndividuel(rangInfo.rang));
    }

    grille.appendChild(slot);
  });

  const btnDashboard1 = document.getElementById('btn-tableau-de-bord-representants');
  btnDashboard1.classList.toggle('cachee', !parametresGlobaux.tableau_de_bord_actif);

  afficherVue('ecran-representants');
}

document.getElementById('btn-retour-representants').addEventListener('click', afficherPageRepresentants);

// --- Etape 2 : page individuelle du representant ---

function afficherRepresentantIndividuel(rang) {
  const rangInfo = etatJoueur.rangs.find((r) => r.rang === rang);
  if (!rangInfo || !rangInfo.representant) return;

  rangAffiche = rang;

  const image = rangInfo.toutesLesCasesValidees
    ? rangInfo.representant.image_sourire || rangInfo.representant.image_depart
    : rangInfo.representant.image_depart;
  document.getElementById('image-representant-individuel').src = image || '';
  document
    .getElementById('couronne-representant-individuel')
    .classList.toggle('cachee', !rangInfo.toutesLesCasesValidees);

  const dialoguesEl = document.getElementById('dialogues-representant-individuel');
  dialoguesEl.innerHTML = (rangInfo.representant.dialogues || [])
    .map((d) => `<p>${d.texte}</p>`)
    .join('');

  const enveloppesEl = document.getElementById('enveloppes-objectifs');
  enveloppesEl.innerHTML = '';
  rangInfo.cases.forEach((c) => {
    const carte = document.createElement('div');
    carte.className = 'carte-enveloppe';

    if (c.statut === 'masque') {
      carte.classList.add('masque');
      carte.innerHTML = '<span>???</span>';
    } else if (c.statut === 'ferme') {
      carte.classList.add('cliquable');
      carte.innerHTML = '<span class="icone-enveloppe">&#9993;</span><span>Objectif scelle</span>';
      carte.addEventListener('click', () => ouvrirCaseObjectif(c));
    } else if (c.statut === 'ouvert') {
      carte.classList.add('cliquable');
      carte.innerHTML = `<span>${c.objectif.description}</span>`;
      carte.addEventListener('click', () => afficherDetailObjectif(c));
    } else if (c.statut === 'valide') {
      carte.classList.add('valide');
      carte.innerHTML = `<span>${c.objectif.description}</span><span class="coche">&#9989;</span>`;
    }

    enveloppesEl.appendChild(carte);
  });

  const btnDashboard2 = document.getElementById('btn-tableau-de-bord-individuel');
  btnDashboard2.classList.toggle('cachee', !parametresGlobaux.tableau_de_bord_actif);

  afficherVue('ecran-representant-individuel');
}

function ouvrirCaseObjectif(c) {
  socket.emit('grille_ouvrir', { joueurId: etatCourant.joueurId, ligneId: c.id });
  // etat_joueur reviendra du serveur ; on affiche directement le detail en attendant
  caseAffichee = c;
  afficherDetailObjectif(c);
}

// --- Etape 3 : detail d'un objectif ---

function afficherDetailObjectif(c) {
  caseAffichee = c;
  document.getElementById('texte-objectif-detail').textContent = c.objectif.description;

  const dejaValide = c.statut === 'valide';
  document.getElementById('objectif-deja-valide').classList.toggle('cachee', !dejaValide);
  document.getElementById('btn-valider-objectif').classList.toggle('cachee', dejaValide);

  afficherVue('ecran-objectif-detail');
}

document.getElementById('btn-valider-objectif').addEventListener('click', () => {
  if (!caseAffichee) return;
  if (!confirm('Confirmer la validation de cet objectif ?')) return;
  socket.emit('grille_valider', { joueurId: etatCourant.joueurId, ligneId: caseAffichee.id });
});

document.getElementById('btn-retour-objectif').addEventListener('click', () => {
  if (rangAffiche) afficherRepresentantIndividuel(rangAffiche);
  else afficherPageRepresentants();
});

// --- Tableau de bord global ---

async function afficherTableauDeBord() {
  const donnees = await requeteJSON(`/api/parties/${etatCourant.code}/tableau-de-bord`).catch(() => []);
  const conteneur = document.getElementById('contenu-tableau-de-bord');
  conteneur.innerHTML = '';

  donnees.forEach((joueurInfo) => {
    const bloc = document.createElement('div');
    bloc.className = 'carte bloc-joueur-tableau';
    bloc.innerHTML = `
      <h3>${joueurInfo.pseudo} (${joueurInfo.objectifsValides.length} valides)</h3>
      <ul>
        ${joueurInfo.objectifsValides
          .map((o) => `<li>${o.description}${o.categorie ? ` <span class="compteur">(${o.categorie})</span>` : ''}</li>`)
          .join('')}
      </ul>
    `;
    conteneur.appendChild(bloc);
  });

  afficherVue('ecran-tableau-de-bord');
}

document.getElementById('btn-tableau-de-bord-representants').addEventListener('click', afficherTableauDeBord);
document.getElementById('btn-tableau-de-bord-individuel').addEventListener('click', afficherTableauDeBord);
document.getElementById('btn-retour-tableau-de-bord').addEventListener('click', () => afficherPageRepresentants());

// --- Notifications ---

function afficherNotification(message) {
  const zone = document.getElementById('zone-notifications');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  zone.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// --- Confettis (fin de partie) ---

function lancerConfettis() {
  const zone = document.getElementById('zone-confettis');
  const couleurs = ['#caa54d', '#6c2c91', '#ecd08a', '#cbb8e0', '#4caf50'];

  for (let i = 0; i < 120; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.backgroundColor = couleurs[Math.floor(Math.random() * couleurs.length)];
    piece.style.animationDelay = `${Math.random() * 1.5}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    zone.appendChild(piece);
    setTimeout(() => piece.remove(), 5000);
  }
}

// --- Liste des joueurs ---

function afficherJoueurs(joueurs) {
  joueursPartieEnCache = joueurs;

  const liste = document.getElementById('liste-joueurs');
  liste.innerHTML = '';
  joueurs.forEach((j) => {
    const li = document.createElement('li');
    li.textContent = `${j.pseudo}${j.est_hote ? ' (maitre du jeu)' : ''} ${j.connecte ? '(en ligne)' : '(hors ligne)'}`;
    liste.appendChild(li);
  });

  const moi = joueurs.find((j) => j.id === etatCourant.joueurId);
  if (moi) {
    etatCourant.estHote = moi.est_hote === 1 || moi.est_hote === true;
  }
}

async function refreshJoueurs() {
  if (!etatCourant.code) return;
  const data = await requeteJSON(`/api/parties/${etatCourant.code}`).catch(() => null);
  if (data) afficherJoueurs(data.joueurs);
}

// --- Scenario (defilement reserve au maitre du jeu) ---

const modalScenario = document.getElementById('modal-scenario');
const imageScenarioActuelle = document.getElementById('image-scenario-actuelle');
const scenarioVide = document.getElementById('scenario-vide');
const controlesScenarioHote = document.getElementById('controles-scenario-hote');
const scenarioPosition = document.getElementById('scenario-position');

function afficherImageScenario() {
  if (!scenarioImages.length) {
    imageScenarioActuelle.classList.add('cachee');
    scenarioVide.classList.remove('cachee');
    controlesScenarioHote.classList.add('cachee');
    return;
  }

  imageScenarioActuelle.classList.remove('cachee');
  scenarioVide.classList.add('cachee');
  imageScenarioActuelle.src = scenarioImages[scenarioIndexActuel].image;
  scenarioPosition.textContent = `${scenarioIndexActuel + 1} / ${scenarioImages.length}`;

  // Hors partie (page d'accueil), tout le monde peut naviguer librement. Dans une partie,
  // le defilement synchronise reste reserve au maitre du jeu.
  const controlesMasques = !!etatCourant.code && !etatCourant.estHote;
  controlesScenarioHote.classList.toggle('cachee', controlesMasques);
}

async function ouvrirScenario() {
  scenarioImages = await requeteJSON('/api/scenario');
  if (!etatCourant.code) scenarioIndexActuel = 0;
  afficherImageScenario();
  fermerTousLesModaux();
  modalScenario.classList.remove('cachee');
}

document.getElementById('btn-scenario').addEventListener('click', ouvrirScenario);
document.getElementById('btn-scenario-accueil').addEventListener('click', ouvrirScenario);

document.getElementById('btn-fermer-scenario').addEventListener('click', () => {
  modalScenario.classList.add('cachee');
});

document.getElementById('btn-scenario-precedent').addEventListener('click', () => {
  if (scenarioIndexActuel <= 0) return;
  if (!etatCourant.code) {
    scenarioIndexActuel--;
    afficherImageScenario();
  } else if (etatCourant.estHote) {
    socket.emit('scenario_naviguer', { index: scenarioIndexActuel - 1 });
  }
});

document.getElementById('btn-scenario-suivant').addEventListener('click', () => {
  if (scenarioIndexActuel >= scenarioImages.length - 1) return;
  if (!etatCourant.code) {
    scenarioIndexActuel++;
    afficherImageScenario();
  } else if (etatCourant.estHote) {
    socket.emit('scenario_naviguer', { index: scenarioIndexActuel + 1 });
  }
});

// --- Fin de partie ---

document.getElementById('btn-retour-accueil-fin').addEventListener('click', () => {
  window.location.href = '/';
});

function afficherFinDePartie({ classement }) {
  const liste = document.getElementById('classement-final');
  liste.innerHTML = classement
    .map((j) => `<li>${j.pseudo} - ${j.valides} objectif(s) valide(s)</li>`)
    .join('');

  afficherVue('ecran-fin-partie');
  if (classement.length && classement[0].valides > 0) {
    lancerConfettis();
  }
}

// --- Evenements Socket.IO ---

socket.on('etat_partie', ({ partie, joueurs }) => {
  scenarioIndexActuel = partie.scenario_index || 0;
  etatCourant.partieStatut = partie.statut;
  afficherJoueurs(joueurs);

  const moi = joueurs.find((j) => j.id === etatCourant.joueurId);
  if (!moi || !moi.race_id) {
    afficherChoixRace();
    return;
  }

  if (partie.statut === 'en_cours') {
    socket.emit('choix_race', { joueurId: etatCourant.joueurId, raceId: moi.race_id });
  } else {
    afficherVue('ecran-attente-lancement');
  }
});

socket.on('joueur_maj', () => refreshJoueurs());
socket.on('joueur_deconnecte', () => refreshJoueurs());
socket.on('erreur', ({ message }) => alert(message));
socket.on('notification', ({ message }) => afficherNotification(message));

// Le MJ (admin) a lance la partie : les objectifs viennent d'etre distribues.
socket.on('partie_lancee', () => {
  etatCourant.partieStatut = 'en_cours';
  const moi = joueursPartieEnCache.find((j) => j.id === etatCourant.joueurId);
  if (moi && moi.race_id) {
    socket.emit('choix_race', { joueurId: etatCourant.joueurId, raceId: moi.race_id });
  }
});

socket.on('etat_joueur', (nouvelEtat) => {
  etatJoueur = nouvelEtat;

  // Reconnexion / premier chargement : sans etat de vue en cours, aller aux representants.
  const vueActuelle = [...document.querySelectorAll('#app > section')].find(
    (s) => !s.classList.contains('cachee')
  );

  if (nouvelEtat.partieTerminee) return; // partie_terminee gere l'affichage final

  const enAttenteDeLancement = [
    'ecran-choix-race',
    'accueil',
    'ecran-attente-lancement'
  ].includes(vueActuelle && vueActuelle.id);

  if (!vueActuelle || enAttenteDeLancement) {
    if (etatCourant.partieStatut === 'en_cours') {
      afficherPageRepresentants();
    } else {
      afficherVue('ecran-attente-lancement');
    }
  } else if (vueActuelle.id === 'ecran-representants') {
    afficherPageRepresentants();
  } else if (vueActuelle.id === 'ecran-representant-individuel' && rangAffiche) {
    afficherRepresentantIndividuel(rangAffiche);
  } else if (vueActuelle.id === 'ecran-objectif-detail' && caseAffichee) {
    const rangInfo = etatJoueur.rangs.find((r) => r.rang === rangAffiche);
    const miseAJour = rangInfo && rangInfo.cases.find((c) => c.id === caseAffichee.id);
    if (miseAJour) afficherDetailObjectif(miseAJour);
  }
});

socket.on('scenario_maj', ({ index }) => {
  scenarioIndexActuel = index;
  if (!modalScenario.classList.contains('cachee')) {
    afficherImageScenario();
  }
});

socket.on('partie_terminee', afficherFinDePartie);
