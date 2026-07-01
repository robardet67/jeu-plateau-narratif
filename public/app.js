const socket = io();

const ecranAccueil = document.getElementById('accueil');
const ecranJeu = document.getElementById('jeu');
const codePartieAffiche = document.getElementById('code-partie-affiche');
const listeJoueurs = document.getElementById('liste-joueurs');
const messagesChat = document.getElementById('messages-chat');
const chatInput = document.getElementById('chat-input');
const panneauSelection = document.getElementById('selection-personnage');
const villageContenu = document.getElementById('village-contenu');
const village = document.getElementById('village');
const selectMaRace = document.getElementById('select-ma-race');
const listeMesRepresentants = document.getElementById('liste-mes-representants');
const btnValiderPersonnage = document.getElementById('btn-valider-personnage');

let etatCourant = { code: null, joueurId: null, pseudo: null, estHote: false };
let racesEnCache = [];
let representantsChoixEnCache = [];
let raceSelectionneeId = null;
let representantSelectionneId = null;

let scenarioImages = [];
let scenarioIndexActuel = 0;

// --- Creation / connexion a une partie ---

async function creerPartie() {
  const pseudo = document.getElementById('creer-pseudo').value.trim();
  const nom = document.getElementById('creer-nom-partie').value.trim();
  if (!pseudo) return alert('Entrez un pseudo');

  const reponse = await fetch('/api/parties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo, nom })
  });
  const data = await reponse.json();
  if (!reponse.ok) return alert(data.error || 'Erreur');

  demarrerPartie(data.code, data.joueurId, pseudo);
}

async function rejoindrePartie() {
  const code = document.getElementById('rejoindre-code').value.trim();
  const pseudo = document.getElementById('rejoindre-pseudo').value.trim();
  if (!code || !pseudo) return alert('Entrez un code et un pseudo');

  const reponse = await fetch(`/api/parties/${code}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo })
  });
  const data = await reponse.json();
  if (!reponse.ok) return alert(data.error || 'Erreur');

  demarrerPartie(code, data.joueurId, pseudo);
}

async function demarrerPartie(code, joueurId, pseudo) {
  etatCourant = { code, joueurId, pseudo, estHote: false };
  codePartieAffiche.textContent = code;
  fermerModal('modal-creer');
  fermerModal('modal-rejoindre');
  ecranAccueil.classList.add('cachee');
  ecranJeu.classList.remove('cachee');

  racesEnCache = await fetch('/api/races').then((r) => r.json());
  selectMaRace.innerHTML = racesEnCache.map((r) => `<option value="${r.id}">${r.nom}</option>`).join('');
  if (racesEnCache.length) {
    raceSelectionneeId = racesEnCache[0].id;
    await chargerRepresentantsChoix();
  }

  const scenario = await fetch('/api/scenario').then((r) => r.json());
  scenarioImages = scenario;

  socket.emit('rejoindre_partie', { code, joueurId });
}

document.getElementById('btn-creer-partie').addEventListener('click', creerPartie);
document.getElementById('btn-rejoindre-partie').addEventListener('click', rejoindrePartie);

// --- Modaux de la page d'accueil (creer / rejoindre) ---

function ouvrirModal(id) {
  document.getElementById(id).classList.remove('cachee');
}

function fermerModal(id) {
  document.getElementById(id).classList.add('cachee');
}

document.getElementById('btn-ouvrir-creer').addEventListener('click', () => ouvrirModal('modal-creer'));
document.getElementById('btn-ouvrir-rejoindre').addEventListener('click', () => ouvrirModal('modal-rejoindre'));

document.querySelectorAll('.btn-fermer-modal').forEach((bouton) => {
  bouton.addEventListener('click', () => fermerModal(bouton.dataset.cible));
});

document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('cachee');
  });
});

// --- Selection race / representant ---

async function chargerRepresentantsChoix() {
  representantsChoixEnCache = await fetch(`/api/races/${raceSelectionneeId}/representants`).then((r) => r.json());
  representantSelectionneId = null;
  btnValiderPersonnage.disabled = true;

  listeMesRepresentants.innerHTML = '';
  representantsChoixEnCache.forEach((rep) => {
    const carte = document.createElement('div');
    carte.className = 'carte-representant-choix';
    carte.innerHTML = `
      ${rep.image_depart ? `<img src="${rep.image_depart}" alt="${rep.nom}" />` : ''}
      <div>${rep.nom}</div>
    `;
    carte.addEventListener('click', () => {
      representantSelectionneId = rep.id;
      document
        .querySelectorAll('.carte-representant-choix')
        .forEach((el) => el.classList.remove('selectionnee'));
      carte.classList.add('selectionnee');
      btnValiderPersonnage.disabled = false;
    });
    listeMesRepresentants.appendChild(carte);
  });
}

selectMaRace.addEventListener('change', () => {
  raceSelectionneeId = selectMaRace.value;
  chargerRepresentantsChoix();
});

btnValiderPersonnage.addEventListener('click', () => {
  if (!raceSelectionneeId || !representantSelectionneId) return;
  socket.emit('choix_personnage', {
    joueurId: etatCourant.joueurId,
    raceId: Number(raceSelectionneeId),
    representantId: Number(representantSelectionneId)
  });
});

function afficherVillage(raceId) {
  panneauSelection.classList.add('cachee');
  villageContenu.classList.remove('cachee');

  const race = racesEnCache.find((r) => Number(r.id) === Number(raceId));
  if (race && race.image_fond) {
    village.style.backgroundImage = `url(${race.image_fond})`;
  }
}

// --- Joueurs ---

function afficherJoueurs(joueurs) {
  listeJoueurs.innerHTML = '';
  joueurs.forEach((j) => {
    const li = document.createElement('li');
    li.textContent = `${j.pseudo}${j.est_hote ? ' (maitre du jeu)' : ''} - score: ${j.score} ${j.connecte ? '(en ligne)' : '(hors ligne)'}`;
    listeJoueurs.appendChild(li);
  });

  const moi = joueurs.find((j) => j.id === etatCourant.joueurId);
  if (moi) {
    etatCourant.estHote = moi.est_hote === 1 || moi.est_hote === true;
    if (moi.race_id && moi.representant_id) {
      afficherVillage(moi.race_id);
    }
  }
}

async function refreshJoueurs() {
  if (!etatCourant.code) return;
  const reponse = await fetch(`/api/parties/${etatCourant.code}`);
  const data = await reponse.json();
  if (reponse.ok) afficherJoueurs(data.joueurs);
}

// --- Chat ---

function ajouterMessageChat({ pseudo, texte }) {
  const li = document.createElement('li');
  li.textContent = `${pseudo}: ${texte}`;
  messagesChat.appendChild(li);
  messagesChat.scrollTop = messagesChat.scrollHeight;
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && chatInput.value.trim()) {
    socket.emit('message_chat', { pseudo: etatCourant.pseudo, texte: chatInput.value.trim() });
    chatInput.value = '';
  }
});

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
  controlesScenarioHote.classList.toggle('cachee', !etatCourant.estHote);
}

async function ouvrirScenario() {
  scenarioImages = await fetch('/api/scenario').then((r) => r.json());
  afficherImageScenario();
  modalScenario.classList.remove('cachee');
}

// Le bouton de la page d'accueil et celui du village ouvrent le meme visualiseur.
// Sans partie active, etatCourant.estHote reste a false : la navigation demeure
// reservee au maitre du jeu d'une partie en cours (le bouton d'accueil est en lecture seule).
document.getElementById('btn-scenario').addEventListener('click', ouvrirScenario);
document.getElementById('btn-scenario-accueil').addEventListener('click', ouvrirScenario);

document.getElementById('btn-fermer-scenario').addEventListener('click', () => {
  modalScenario.classList.add('cachee');
});

document.getElementById('btn-scenario-precedent').addEventListener('click', () => {
  if (!etatCourant.estHote || scenarioIndexActuel <= 0) return;
  socket.emit('scenario_naviguer', { index: scenarioIndexActuel - 1 });
});

document.getElementById('btn-scenario-suivant').addEventListener('click', () => {
  if (!etatCourant.estHote || scenarioIndexActuel >= scenarioImages.length - 1) return;
  socket.emit('scenario_naviguer', { index: scenarioIndexActuel + 1 });
});

// --- Evenements Socket.IO ---

socket.on('etat_partie', ({ partie, joueurs }) => {
  scenarioIndexActuel = partie.scenario_index || 0;
  afficherJoueurs(joueurs);
});
socket.on('joueur_maj', () => refreshJoueurs());
socket.on('joueur_deplace', () => refreshJoueurs());
socket.on('objectif_maj', () => refreshJoueurs());
socket.on('joueur_deconnecte', () => refreshJoueurs());
socket.on('message_chat', ajouterMessageChat);
socket.on('erreur', ({ message }) => alert(message));

socket.on('scenario_maj', ({ index }) => {
  scenarioIndexActuel = index;
  if (!modalScenario.classList.contains('cachee')) {
    afficherImageScenario();
  }
});
