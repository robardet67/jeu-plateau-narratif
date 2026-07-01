const socket = io();

const ecranAccueil = document.getElementById('accueil');
const ecranJeu = document.getElementById('jeu');
const codePartieAffiche = document.getElementById('code-partie-affiche');
const listeJoueurs = document.getElementById('liste-joueurs');
const messagesChat = document.getElementById('messages-chat');
const chatInput = document.getElementById('chat-input');

let etatCourant = { code: null, joueurId: null, pseudo: null };

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

function demarrerPartie(code, joueurId, pseudo) {
  etatCourant = { code, joueurId, pseudo };
  codePartieAffiche.textContent = code;
  ecranAccueil.classList.add('cachee');
  ecranJeu.classList.remove('cachee');
  socket.emit('rejoindre_partie', { code, joueurId });
}

function afficherJoueurs(joueurs) {
  listeJoueurs.innerHTML = '';
  joueurs.forEach((j) => {
    const li = document.createElement('li');
    li.textContent = `${j.pseudo} - score: ${j.score} ${j.connecte ? '(en ligne)' : '(hors ligne)'}`;
    listeJoueurs.appendChild(li);
  });
}

function ajouterMessageChat({ pseudo, texte }) {
  const li = document.createElement('li');
  li.textContent = `${pseudo}: ${texte}`;
  messagesChat.appendChild(li);
  messagesChat.scrollTop = messagesChat.scrollHeight;
}

document.getElementById('btn-creer-partie').addEventListener('click', creerPartie);
document.getElementById('btn-rejoindre-partie').addEventListener('click', rejoindrePartie);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && chatInput.value.trim()) {
    socket.emit('message_chat', { pseudo: etatCourant.pseudo, texte: chatInput.value.trim() });
    chatInput.value = '';
  }
});

socket.on('etat_partie', ({ joueurs }) => afficherJoueurs(joueurs));
socket.on('joueur_maj', () => refreshJoueurs());
socket.on('joueur_deplace', () => refreshJoueurs());
socket.on('objectif_maj', () => refreshJoueurs());
socket.on('joueur_deconnecte', () => refreshJoueurs());
socket.on('message_chat', ajouterMessageChat);
socket.on('erreur', ({ message }) => alert(message));

async function refreshJoueurs() {
  if (!etatCourant.code) return;
  const reponse = await fetch(`/api/parties/${etatCourant.code}`);
  const data = await reponse.json();
  if (reponse.ok) afficherJoueurs(data.joueurs);
}
