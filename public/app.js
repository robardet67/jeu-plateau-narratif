const socket = io();

let etatCourant = { code: null, joueurId: null, pseudo: null, estHote: false, partieStatut: null };
let joueursPartieEnCache = [];
let etatJoueur = null;
let rangAffiche = null;
let allegeanceAffichee = null;
let rangAllegeanceAffiche = null;
let vueAvantChangement = null;

let scenarioImages = [];
let scenarioIndexActuel = 0;
let parametresGlobaux = { tableau_de_bord_actif: false };

async function requeteJSON(url, options = {}) {
  const reponse = await fetch(url, options);
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(donnees.error || 'Erreur inconnue');
  return donnees;
}

// --- Navigation ---

function afficherVue(id) {
  document.querySelectorAll('#app > section').forEach((s) => s.classList.add('cachee'));
  document.getElementById(id).classList.remove('cachee');
}

function vueActuelleId() {
  const s = [...document.querySelectorAll('#app > section')].find((el) => !el.classList.contains('cachee'));
  return s ? s.id : null;
}

// --- Modaux ---

function fermerTousLesModaux() {
  document.querySelectorAll('.modal').forEach((m) => m.classList.add('cachee'));
}

function ouvrirModal(id) {
  fermerTousLesModaux();
  document.getElementById(id).classList.remove('cachee');
}

document.querySelectorAll('.btn-fermer-modal').forEach((btn) => {
  btn.addEventListener('click', () => btn.dataset.cible && document.getElementById(btn.dataset.cible).classList.add('cachee'));
});

document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('cachee'); });
});

// --- Ouverture de la modal de creation ---

document.getElementById('btn-ouvrir-commencer').addEventListener('click', ouvrirModalCreation);

document.getElementById('btn-reprendre-partie').addEventListener('click', ouvrirReprendrePartie);

async function ouvrirReprendrePartie() {
  const partie = await requeteJSON('/api/partie-active').catch(() => ({ active: false }));

  if (!partie.active || !['en_attente', 'en_cours'].includes(partie.statut)) {
    return alert('Aucune partie en cours pour le moment.');
  }

  const joueurs = partie.joueurs || [];
  if (joueurs.length === 0) {
    return alert('Aucun joueur inscrit dans cette partie.');
  }

  // Initialise le contexte (code + statut) avant d'entrer dans le flux joueur
  etatCourant = { code: partie.code, joueurId: null, pseudo: null, estHote: false, partieStatut: partie.statut };

  // Charge les ressources necessaires au jeu apres reconnexion
  [parametresGlobaux, scenarioImages] = await Promise.all([
    requeteJSON('/api/parametres').catch(() => ({})),
    requeteJSON('/api/scenario').catch(() => [])
  ]);

  // "Nouveau joueur" masque si la partie est deja en cours
  document.getElementById('changer-section-nouveau').classList.toggle('cachee', partie.statut === 'en_cours');

  vueAvantChangement = 'accueil';
  chargerListeJoueursExistants();
  afficherVue('ecran-changer-joueur');
}

async function ouvrirModalCreation() {
  const partie = await requeteJSON('/api/partie-active').catch(() => ({ active: false }));
  if (!partie.active) {
    return alert("Aucune partie n'est configuree par le maitre du jeu pour le moment.");
  }
  if (partie.statut !== 'en_attente') {
    return alert('La partie a deja demarre, impossible de la rejoindre.');
  }

  const [races, allegeances] = await Promise.all([
    requeteJSON('/api/races'),
    requeteJSON('/api/allegeances')
  ]);

  const racesPrises = new Set((partie.joueurs || []).filter((j) => j.race_id).map((j) => j.race_id));

  // Grille des races
  const grilleRaces = document.getElementById('grille-choix-races');
  grilleRaces.innerHTML = '';
  if (races.length === 0) {
    grilleRaces.innerHTML = '<p style="opacity:.6">Aucune race configuree.</p>';
  }
  races.forEach((race) => {
    const prise = racesPrises.has(race.id);
    const carte = document.createElement('div');
    carte.className = 'carte-choix-race' + (prise ? ' indisponible' : '');
    carte.dataset.id = race.id;
    const image = race.representant1?.image_depart;
    carte.innerHTML = `
      ${image ? `<img src="${image}" alt="${race.nom}" />` : '<div class="placeholder-race">&#127775;</div>'}
      <div class="nom-choix">${race.nom}</div>
      ${prise ? '<div class="badge-prise">Prise</div>' : ''}
    `;
    if (!prise) {
      carte.addEventListener('click', () => {
        document.querySelectorAll('.carte-choix-race.selectionnee').forEach((el) => el.classList.remove('selectionnee'));
        carte.classList.add('selectionnee');
      });
    }
    grilleRaces.appendChild(carte);
  });

  // Grille des allegeances
  const grilleAllegeances = document.getElementById('grille-choix-allegeances');
  grilleAllegeances.innerHTML = '';
  if (allegeances.length === 0) {
    grilleAllegeances.innerHTML = '<p style="opacity:.6">Aucune allegeance disponible.</p>';
  }
  allegeances.forEach((a) => {
    const carte = document.createElement('div');
    carte.className = 'carte-choix-allegeance';
    carte.dataset.id = a.id;
    carte.innerHTML = `
      ${a.portrait ? `<img src="${a.portrait}" alt="${a.nom}" class="img-allegeance" />` : '<div class="placeholder-allegeance">&#10024;</div>'}
      <div class="nom-choix">${a.nom}</div>
    `;
    carte.addEventListener('click', () => {
      const selectionnee = carte.classList.contains('selectionnee');
      if (selectionnee) {
        carte.classList.remove('selectionnee');
      } else {
        const nb = document.querySelectorAll('.carte-choix-allegeance.selectionnee').length;
        if (nb < 2) carte.classList.add('selectionnee');
      }
    });
    grilleAllegeances.appendChild(carte);
  });

  document.getElementById('erreur-commencer').classList.add('cachee');
  ouvrirModal('modal-commencer');
}

// --- Rejoindre la partie ---

document.getElementById('btn-commencer-partie').addEventListener('click', rejoindrePartie);

async function rejoindrePartie() {
  const pseudo = document.getElementById('commencer-pseudo').value.trim();
  const erreurEl = document.getElementById('erreur-commencer');
  erreurEl.classList.add('cachee');

  if (!pseudo) {
    erreurEl.textContent = 'Entrez votre pseudo';
    erreurEl.classList.remove('cachee');
    return;
  }

  const raceEl = document.querySelector('.carte-choix-race.selectionnee');
  if (!raceEl) {
    erreurEl.textContent = 'Choisissez votre race';
    erreurEl.classList.remove('cachee');
    return;
  }

  const raceId = parseInt(raceEl.dataset.id);
  const allegeanceIds = [...document.querySelectorAll('.carte-choix-allegeance.selectionnee')].map((el) =>
    parseInt(el.dataset.id)
  );

  try {
    const data = await requeteJSON('/api/partie-active/rejoindre', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pseudo, race_id: raceId, allegeance_ids: allegeanceIds })
    });

    etatCourant = { code: data.code, joueurId: data.joueurId, pseudo, estHote: false, partieStatut: null };
    fermerTousLesModaux();

    parametresGlobaux = await requeteJSON('/api/parametres');
    scenarioImages = await requeteJSON('/api/scenario');

    socket.emit('rejoindre_partie', { code: data.code, joueurId: data.joueurId });
  } catch (err) {
    erreurEl.textContent = err.message;
    erreurEl.classList.remove('cachee');
  }
}

// --- Hub (village) ---

function afficherHub() {
  if (!etatJoueur) return;

  const hubVillage = document.getElementById('hub-village');
  hubVillage.style.backgroundImage = etatJoueur.imageFond ? `url(${etatJoueur.imageFond})` : '';

  const hubPortraits = document.getElementById('hub-portraits');
  hubPortraits.innerHTML = '';

  // Portrait de race : rang 1, cliquable si nbRepRace > 0
  const rang1 = etatJoueur.rangs.find((r) => r.rang === 1);
  if (rang1 && etatJoueur.config.nbRepRace > 0) {
    const rep = rang1.representant;
    // Validé seulement quand TOUS les représentants de race sont complétés
    const toutesRaceValidees = etatJoueur.rangs.length > 0 &&
      etatJoueur.rangs.every((r) => r.toutesLesCasesValidees);
    // Portrait dédié de la race si disponible, sinon image du 1er représentant
    const imagePortrait = etatJoueur.imagePortraitRace
      || (rang1.toutesLesCasesValidees ? rep?.image_sourire || rep?.image_depart : rep?.image_depart);

    const div = document.createElement('div');
    div.className = 'portrait-race';
    div.innerHTML = `
      ${imagePortrait ? `<img src="${imagePortrait}" alt="${etatJoueur.raceNom}" />` : '<div class="placeholder-portrait">&#127775;</div>'}
      <div class="nom-portrait">${etatJoueur.texteHubRace || etatJoueur.raceNom || ''}</div>
      ${toutesRaceValidees ? '<div class="couronne">✅</div>' : ''}
    `;
    div.addEventListener('click', afficherParcoursRace);
    hubPortraits.appendChild(div);
  }

  // Portraits d'allegeances (cliquables si nbRepAlleg > 0)
  if (etatJoueur.allegeances && etatJoueur.allegeances.length > 0) {
    const divAlleg = document.createElement('div');
    divAlleg.className = 'portraits-allegeances';
    etatJoueur.allegeances.forEach((a) => {
      const div = document.createElement('div');
      const cliquable = etatJoueur.config.nbRepAlleg > 0;
      // Validé seulement quand TOUS les représentants de l'allégeance sont complétés
      const toutesAllegValidees = (a.rangs || []).length > 0 &&
        (a.rangs || []).every((r) => r.toutesLesCasesValidees);
      div.className = 'portrait-allegeance' + (cliquable ? ' portrait-cliquable' : '');
      div.innerHTML = `
        ${a.portrait ? `<img src="${a.portrait}" alt="${a.nom}" />` : '<div class="placeholder-allegeance-hub">&#10024;</div>'}
        <div class="nom-portrait">${a.texte_hub || a.nom}</div>
        ${toutesAllegValidees ? '<div class="couronne">✅</div>' : ''}
      `;
      if (cliquable) {
        div.addEventListener('click', () => afficherParcoursAllegeance(a.id));
      }
      divAlleg.appendChild(div);
    });
    hubPortraits.appendChild(divAlleg);
  }

  document.getElementById('btn-tableau-de-bord-hub').classList.toggle('cachee', !parametresGlobaux.tableau_de_bord_actif);

  afficherVue('ecran-hub');
}

document.getElementById('btn-retour-hub').addEventListener('click', afficherHub);

// --- Parcours race : grille des representants ---

function afficherParcoursRace() {
  if (!etatJoueur) return;

  const ecranRepresentants = document.getElementById('ecran-representants');
  ecranRepresentants.style.backgroundImage = etatJoueur.imageFond ? `url(${etatJoueur.imageFond})` : '';

  const grille = document.getElementById('grille-representants');
  grille.innerHTML = '';

  etatJoueur.rangs.forEach((rangInfo) => {
    const slot = document.createElement('div');
    slot.className = 'slot-representant';

    if (!rangInfo.deverrouille) {
      slot.classList.add('slot-bloque');
      const rep = rangInfo.representant;
      slot.innerHTML = rep?.image_depart
        ? `<img src="${rep.image_depart}" alt="${rep.nom}" /><div class="nom-slot">${rep.nom}</div>`
        : `<div class="silhouette-vide"></div><div class="nom-slot">Rang ${rangInfo.rang}</div>`;
      if (rangInfo.bloqueParConditionAllegeance) {
        slot.style.cursor = 'pointer';
        slot.addEventListener('click', () => afficherNotifCondition(etatJoueur.messageConditionAllegeance));
      }
    } else {
      const image = rangInfo.toutesLesCasesValidees
        ? rangInfo.representant.image_sourire || rangInfo.representant.image_depart
        : rangInfo.representant.image_depart;
      slot.innerHTML = `
        ${image ? `<img src="${image}" alt="${rangInfo.representant.nom}" />` : ''}
        <div class="nom-slot">${rangInfo.representant.nom}</div>
        ${rangInfo.toutesLesCasesValidees ? '<div class="couronne">✅</div>' : ''}
      `;
      slot.classList.add('slot-cliquable');
      slot.addEventListener('click', () => afficherRepresentantIndividuel(rangInfo.rang));
    }

    grille.appendChild(slot);
  });

  document.getElementById('btn-tableau-de-bord-representants').classList.toggle('cachee', !parametresGlobaux.tableau_de_bord_actif);

  afficherVue('ecran-representants');
}

document.getElementById('btn-retour-representants').addEventListener('click', afficherParcoursRace);

// --- Page individuelle d'un representant : objectifs inline ---

function afficherRepresentantIndividuel(rang) {
  const rangInfo = etatJoueur?.rangs.find((r) => r.rang === rang);
  if (!rangInfo || !rangInfo.representant) return;

  rangAffiche = rang;

  const image = rangInfo.toutesLesCasesValidees
    ? rangInfo.representant.image_sourire || rangInfo.representant.image_depart
    : rangInfo.representant.image_depart;

  const imgEl = document.getElementById('image-representant-individuel');
  imgEl.src = image || '';
  imgEl.style.display = image ? '' : 'none';

  document
    .getElementById('couronne-representant-individuel')
    .classList.toggle('cachee', !rangInfo.toutesLesCasesValidees);

  const dialoguesEl = document.getElementById('dialogues-representant-individuel');
  dialoguesEl.innerHTML = (rangInfo.representant.dialogues || []).map((d) => `<p>${d.texte}</p>`).join('');

  const enveloppesEl = document.getElementById('enveloppes-objectifs');
  enveloppesEl.innerHTML = '';

  rangInfo.cases.forEach((c) => {
    const carte = document.createElement('div');
    carte.className = 'carte-enveloppe';

    if (c.statut === 'ouvert') {
      carte.innerHTML = `
        <span class="texte-obj">${c.objectif.description}</span>
        <button class="btn-valider-obj">Valider</button>
      `;
      carte.querySelector('.btn-valider-obj').addEventListener('click', () => {
        demanderConfirmationValidation(c.objectif.description, () => {
          socket.emit('grille_valider', { joueurId: etatCourant.joueurId, ligneId: c.id });
        });
      });
    } else if (c.statut === 'valide') {
      carte.classList.add('valide');
      carte.innerHTML = `<span class="texte-obj">${c.objectif.description}</span><span class="coche">&#9989;</span>`;
    } else {
      carte.classList.add('masque');
      carte.innerHTML = '<span>???</span>';
    }

    enveloppesEl.appendChild(carte);
  });

  document.getElementById('btn-tableau-de-bord-individuel').classList.toggle('cachee', !parametresGlobaux.tableau_de_bord_actif);

  afficherVue('ecran-representant-individuel');
}

// --- Parcours allegeance : grille des representants ---

function afficherParcoursAllegeance(allegeanceId) {
  if (!etatJoueur) return;
  allegeanceAffichee = allegeanceId;

  const alleg = etatJoueur.allegeances.find((a) => a.id === allegeanceId);
  if (!alleg) return;

  const ecran = document.getElementById('ecran-parcours-allegeance');
  ecran.style.backgroundImage = etatJoueur.imageFond ? `url(${etatJoueur.imageFond})` : '';

  const grille = document.getElementById('grille-reps-allegeance');
  grille.innerHTML = '';

  (alleg.rangs || []).forEach((rangInfo) => {
    const slot = document.createElement('div');
    slot.className = 'slot-representant';

    if (!rangInfo.deverrouille) {
      slot.classList.add('slot-bloque');
      const rep = rangInfo.representant;
      slot.innerHTML = rep?.image_depart
        ? `<img src="${rep.image_depart}" alt="${rep.nom}" /><div class="nom-slot">${rep.nom}</div>`
        : `<div class="silhouette-vide"></div><div class="nom-slot">Rang ${rangInfo.rang}</div>`;
    } else {
      const image = rangInfo.toutesLesCasesValidees
        ? rangInfo.representant.image_sourire || rangInfo.representant.image_depart
        : rangInfo.representant.image_depart;
      slot.innerHTML = `
        ${image ? `<img src="${image}" alt="${rangInfo.representant.nom}" />` : ''}
        <div class="nom-slot">${rangInfo.representant.nom}</div>
        ${rangInfo.toutesLesCasesValidees ? '<div class="couronne">✅</div>' : ''}
      `;
      slot.classList.add('slot-cliquable');
      slot.addEventListener('click', () => afficherRepAllegeanceIndividuel(allegeanceId, rangInfo.rang));
    }

    grille.appendChild(slot);
  });

  document.getElementById('btn-tableau-de-bord-allegeance').classList.toggle('cachee', !parametresGlobaux.tableau_de_bord_actif);

  afficherVue('ecran-parcours-allegeance');
}

document.getElementById('btn-retour-hub-allegeance').addEventListener('click', afficherHub);

// --- Page individuelle d'un representant d'allegeance : objectifs inline ---

function afficherRepAllegeanceIndividuel(allegeanceId, rang) {
  if (!etatJoueur) return;
  const alleg = etatJoueur.allegeances.find((a) => a.id === allegeanceId);
  if (!alleg) return;
  const rangInfo = (alleg.rangs || []).find((r) => r.rang === rang);
  if (!rangInfo || !rangInfo.representant) return;

  allegeanceAffichee = allegeanceId;
  rangAllegeanceAffiche = rang;

  const image = rangInfo.toutesLesCasesValidees
    ? rangInfo.representant.image_sourire || rangInfo.representant.image_depart
    : rangInfo.representant.image_depart;

  const imgEl = document.getElementById('image-rep-allegeance');
  imgEl.src = image || '';
  imgEl.style.display = image ? '' : 'none';

  document.getElementById('couronne-rep-allegeance').classList.toggle('cachee', !rangInfo.toutesLesCasesValidees);

  const dialoguesEl = document.getElementById('dialogues-rep-allegeance');
  const dialogue = rangInfo.representant.dialogue;
  dialoguesEl.innerHTML = dialogue ? `<p>${dialogue}</p>` : '';

  const objectifsEl = document.getElementById('objectifs-rep-allegeance');
  objectifsEl.innerHTML = '';

  rangInfo.cases.forEach((c) => {
    const carte = document.createElement('div');
    carte.className = 'carte-enveloppe';

    if (c.statut === 'ouvert') {
      carte.innerHTML = `
        <span class="texte-obj">${c.objectif.description}</span>
        <button class="btn-valider-obj">Valider</button>
      `;
      carte.querySelector('.btn-valider-obj').addEventListener('click', () => {
        demanderConfirmationValidation(c.objectif.description, () => {
          socket.emit('grille_valider_allegeance', {
            joueurId: etatCourant.joueurId,
            allegeanceId,
            partieId: etatJoueur.partieId,
            ligneId: c.id
          });
        });
      });
    } else if (c.statut === 'valide') {
      carte.classList.add('valide');
      carte.innerHTML = `<span class="texte-obj">${c.objectif.description}</span><span class="coche">&#9989;</span>`;
    } else {
      carte.classList.add('masque');
      carte.innerHTML = '<span>???</span>';
    }

    objectifsEl.appendChild(carte);
  });

  document.getElementById('btn-tableau-de-bord-rep-allegeance').classList.toggle('cachee', !parametresGlobaux.tableau_de_bord_actif);

  afficherVue('ecran-rep-allegeance-individuel');
}

document.getElementById('btn-retour-parcours-allegeance').addEventListener('click', () => {
  if (allegeanceAffichee) afficherParcoursAllegeance(allegeanceAffichee);
  else afficherHub();
});

// --- Changer de joueur ---

function afficherEcranChangerJoueur() {
  vueAvantChangement = vueActuelleId();

  // "Nouveau joueur" n'est utile qu'en phase d'attente ; en cours de partie, la liste suffit
  document.getElementById('changer-section-nouveau').classList.toggle(
    'cachee',
    etatCourant.partieStatut === 'en_cours'
  );

  chargerListeJoueursExistants();
  afficherVue('ecran-changer-joueur');
}

async function chargerListeJoueursExistants() {
  const liste = document.getElementById('liste-joueurs-existants');
  const vide = document.getElementById('changer-joueur-vide');
  liste.innerHTML = '<li style="opacity:.6;padding:.4rem 0">Chargement…</li>';
  vide.classList.add('cachee');

  const [partie, races] = await Promise.all([
    requeteJSON('/api/partie-active').catch(() => ({ active: false, joueurs: [] })),
    requeteJSON('/api/races').catch(() => [])
  ]);

  const joueurs = partie.joueurs || [];
  const raceMap = {};
  races.forEach((r) => { raceMap[r.id] = r.nom; });

  liste.innerHTML = '';

  if (joueurs.length === 0) {
    vide.classList.remove('cachee');
    return;
  }

  joueurs.forEach((j) => {
    const estMoi = j.id === etatCourant.joueurId;
    const raceNom = j.race_id ? (raceMap[j.race_id] || 'Race #' + j.race_id) : 'Sans race';

    const li = document.createElement('li');
    li.className = 'element-carte element-joueur-session';
    li.innerHTML = `
      <div class="element-infos">
        <div>
          <strong>${j.pseudo}</strong>
          <span class="badge-info">${raceNom}</span>
          ${estMoi ? '<span class="badge-info badge-actuel">session actuelle</span>' : ''}
        </div>
      </div>
      ${!estMoi ? '<button class="btn-reprendre-joueur bouton-secondaire">Reprendre</button>' : ''}
    `;

    if (!estMoi) {
      li.querySelector('.btn-reprendre-joueur').addEventListener('click', () => {
        rejoindreJoueurExistant(j);
      });
    }

    liste.appendChild(li);
  });
}

function rejoindreJoueurExistant(joueur) {
  etatCourant = { ...etatCourant, joueurId: joueur.id, pseudo: joueur.pseudo };
  // Remet a zero l'etat local : le serveur fait foi
  etatJoueur = null;
  rangAffiche = null;
  allegeanceAffichee = null;
  rangAllegeanceAffiche = null;
  // Le handler etat_partie declenchera afficherHub() ou ecran-attente-lancement
  socket.emit('rejoindre_partie', { code: etatCourant.code, joueurId: joueur.id });
}

document.getElementById('btn-nouveau-joueur-changer').addEventListener('click', ouvrirModalCreation);

document.getElementById('btn-retour-depuis-changer').addEventListener('click', () => {
  if (vueAvantChangement && vueAvantChangement !== 'ecran-changer-joueur') {
    afficherVue(vueAvantChangement);
  } else {
    afficherHub();
  }
});

document.querySelectorAll('.btn-changer-joueur').forEach((btn) => {
  btn.addEventListener('click', afficherEcranChangerJoueur);
});

// --- Tableau de bord global ---

async function afficherTableauDeBord() {
  const donnees = await requeteJSON(`/api/parties/${etatCourant.code}/tableau-de-bord`).catch(() => []);
  const conteneur = document.getElementById('contenu-tableau-de-bord');
  conteneur.innerHTML = '';

  donnees.forEach((joueurInfo) => {
    const nbQuetes = joueurInfo.quetes.length;
    const nbValides = joueurInfo.objectifsValides.length;

    const listeQuetes = nbQuetes > 0
      ? `<ul class="tdb-quetes">${joueurInfo.quetes.map((q) => {
          const suffixe = q.type === 'allegeance' ? ` <span class="tdb-alleg-tag">${q.nomAllegeance}</span>` : '';
          return `<li>Quête de ${q.nomRepresentant}${suffixe} : <strong>Validée</strong></li>`;
        }).join('')}</ul>`
      : '<p class="tdb-vide">Aucune quête achevée</p>';

    const listeObjectifs = nbValides > 0
      ? `<ul class="tdb-objectifs">${joueurInfo.objectifsValides.map((o) => {
          const src = o.type === 'allegeance'
            ? ` <span class="tdb-alleg-tag">${o.nomAllegeance}</span>`
            : '';
          return `<li>${o.description}${src}</li>`;
        }).join('')}</ul>`
      : '<p class="tdb-vide">Aucun objectif validé</p>';

    const raceLabel = joueurInfo.raceNom ? ` — ${joueurInfo.raceNom}` : '';
    const quetesLabel = nbQuetes === 1 ? '1 quête achevée' : `${nbQuetes} quêtes achevées`;

    const bloc = document.createElement('div');
    bloc.className = 'carte bloc-joueur-tableau';
    bloc.innerHTML = `
      <h3 class="tdb-joueur-nom">${joueurInfo.pseudo}<span class="tdb-race">${raceLabel}</span></h3>
      <p class="tdb-nb-quetes">${quetesLabel}</p>
      <h4 class="tdb-section-titre">Quêtes</h4>
      ${listeQuetes}
      <h4 class="tdb-section-titre">Objectifs validés</h4>
      ${listeObjectifs}
    `;
    conteneur.appendChild(bloc);
  });

  afficherVue('ecran-tableau-de-bord');
}

document.getElementById('btn-tableau-de-bord-hub').addEventListener('click', afficherTableauDeBord);
document.getElementById('btn-tableau-de-bord-representants').addEventListener('click', afficherTableauDeBord);
document.getElementById('btn-tableau-de-bord-individuel').addEventListener('click', afficherTableauDeBord);
document.getElementById('btn-tableau-de-bord-allegeance').addEventListener('click', afficherTableauDeBord);
document.getElementById('btn-tableau-de-bord-rep-allegeance').addEventListener('click', afficherTableauDeBord);
document.getElementById('btn-scenario-allegeance').addEventListener('click', ouvrirScenario);
document.getElementById('btn-retour-tableau-de-bord').addEventListener('click', () => {
  const vue = vueActuelleId();
  if (vue === 'ecran-tableau-de-bord') afficherHub();
});

// --- Notifications ---

function afficherNotification(message) {
  const zone = document.getElementById('zone-notifications');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  zone.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// --- Confettis ---

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

// --- Liste des joueurs (attente + panneau) ---

function afficherJoueurs(joueurs) {
  joueursPartieEnCache = joueurs;

  // Panneau in-game (hub)
  const liste = document.getElementById('liste-joueurs');
  if (liste) {
    liste.innerHTML = '';
    joueurs.forEach((j) => {
      const li = document.createElement('li');
      li.textContent = `${j.pseudo}${j.est_hote ? ' (MJ)' : ''} ${j.connecte ? '' : '(hors ligne)'}`;
      liste.appendChild(li);
    });
  }

  // Liste d'attente
  const listeAttente = document.getElementById('liste-joueurs-attente');
  if (listeAttente) {
    listeAttente.innerHTML = '';
    joueurs.forEach((j) => {
      const li = document.createElement('li');
      li.textContent = `${j.pseudo}${j.est_hote ? ' (maitre du jeu)' : ''} ${j.connecte ? '(en ligne)' : '(hors ligne)'}`;
      listeAttente.appendChild(li);
    });
  }

  const moi = joueurs.find((j) => j.id === etatCourant.joueurId);
  if (moi) etatCourant.estHote = moi.est_hote === 1 || moi.est_hote === true;
}

// --- Scenario ---

const modalScenario = document.getElementById('modal-scenario');
const imageScenarioActuelle = document.getElementById('image-scenario-actuelle');
const texteScenarioActuel = document.getElementById('texte-scenario-actuel');
const scenarioVide = document.getElementById('scenario-vide');
const controlesScenario = document.getElementById('controles-scenario');
const scenarioPosition = document.getElementById('scenario-position');

function afficherImageScenario() {
  if (!scenarioImages.length) {
    imageScenarioActuelle.classList.add('cachee');
    texteScenarioActuel.classList.add('cachee');
    scenarioVide.classList.remove('cachee');
    controlesScenario.classList.add('cachee');
    return;
  }
  const diapo = scenarioImages[scenarioIndexActuel];
  imageScenarioActuelle.classList.remove('cachee');
  scenarioVide.classList.add('cachee');
  imageScenarioActuelle.src = diapo.image;
  scenarioPosition.textContent = `${scenarioIndexActuel + 1} / ${scenarioImages.length}`;
  controlesScenario.classList.remove('cachee');
  if (diapo.texte) {
    texteScenarioActuel.textContent = diapo.texte;
    texteScenarioActuel.classList.remove('cachee');
  } else {
    texteScenarioActuel.classList.add('cachee');
  }
}

async function ouvrirScenario() {
  scenarioImages = await requeteJSON('/api/scenario');
  scenarioIndexActuel = 0;
  afficherImageScenario();
  fermerTousLesModaux();
  modalScenario.classList.remove('cachee');
}

document.getElementById('btn-scenario-accueil').addEventListener('click', ouvrirScenario);
document.getElementById('btn-scenario-hub').addEventListener('click', ouvrirScenario);
document.getElementById('btn-scenario-representants').addEventListener('click', ouvrirScenario);
document.getElementById('btn-fermer-scenario').addEventListener('click', () => modalScenario.classList.add('cachee'));

document.getElementById('btn-scenario-precedent').addEventListener('click', () => {
  if (scenarioIndexActuel <= 0) return;
  scenarioIndexActuel--;
  afficherImageScenario();
});

document.getElementById('btn-scenario-suivant').addEventListener('click', () => {
  if (scenarioIndexActuel >= scenarioImages.length - 1) return;
  scenarioIndexActuel++;
  afficherImageScenario();
});

// --- Notification condition allegeance ---

function afficherNotifCondition(message) {
  document.getElementById('texte-notif-condition').textContent = message;
  document.getElementById('notif-condition-allegeance').classList.remove('cachee');
}

document.getElementById('btn-fermer-notif-condition').addEventListener('click', () => {
  document.getElementById('notif-condition-allegeance').classList.add('cachee');
});

// --- Confirmation de validation d'objectif ---

let _callbackConfirmation = null;

function demanderConfirmationValidation(description, onConfirmer) {
  document.getElementById('confirmation-description').textContent = description;
  _callbackConfirmation = onConfirmer;
  document.getElementById('ecran-confirmation-validation').classList.remove('cachee');
}

document.getElementById('btn-confirmer-validation').addEventListener('click', () => {
  document.getElementById('ecran-confirmation-validation').classList.add('cachee');
  if (_callbackConfirmation) {
    const cb = _callbackConfirmation;
    _callbackConfirmation = null;
    cb();
  }
});

document.getElementById('btn-annuler-validation').addEventListener('click', () => {
  document.getElementById('ecran-confirmation-validation').classList.add('cachee');
  _callbackConfirmation = null;
});

// --- Fin de partie ---

document.getElementById('btn-retour-accueil-fin').addEventListener('click', () => {
  window.location.href = '/';
});

function afficherFinDePartie({ classement }) {
  const liste = document.getElementById('classement-final');
  liste.innerHTML = classement.map((j) => {
    const quetesLabel = j.quetes === 1 ? 'quête achevée' : 'quêtes achevées';
    const validesLabel = j.valides === 1 ? 'objectif validé' : 'objectifs validés';
    return `<li class="ligne-classement">
      <span class="rang-final">${j.rang}.</span>
      <span class="pseudo-final">${j.pseudo}</span>
      <span class="score-final">${j.quetes} ${quetesLabel} · ${j.valides} ${validesLabel}</span>
    </li>`;
  }).join('');
  afficherVue('ecran-fin-partie');
  if (classement.length && classement[0].quetes > 0) lancerConfettis();
}

// --- Socket.IO ---

socket.on('etat_partie', async ({ partie, joueurs }) => {
  scenarioIndexActuel = partie.scenario_index || 0;
  etatCourant.partieStatut = partie.statut;
  afficherJoueurs(joueurs);

  const moi = joueurs.find((j) => j.id === etatCourant.joueurId);
  if (!moi) return;

  if (partie.statut === 'en_cours') {
    // Partie deja en cours (reconnexion) : recupere l'etat via REST
    const etat = await requeteJSON(`/api/joueurs/${etatCourant.joueurId}/etat`).catch(() => null);
    if (etat) {
      etatJoueur = etat;
      afficherHub();
    }
  } else {
    // Attente du lancement
    const infoEl = document.getElementById('attente-info-joueur');
    if (infoEl && moi.race_id) {
      const raceNom = joueurs.find((j) => j.id === etatCourant.joueurId)?.race_id;
      infoEl.textContent = `Vous avez rejoint la partie. En attente du lancement par le maitre du jeu.`;
    }
    afficherVue('ecran-attente-lancement');
  }
});

socket.on('joueur_maj', ({ joueurId, raceId }) => {
  const joueur = joueursPartieEnCache.find((j) => j.id === joueurId);
  if (joueur) joueur.race_id = raceId;
  afficherJoueurs(joueursPartieEnCache);
});

socket.on('joueur_deconnecte', ({ joueurId }) => {
  const joueur = joueursPartieEnCache.find((j) => j.id === joueurId);
  if (joueur) joueur.connecte = 0;
  afficherJoueurs(joueursPartieEnCache);
});

socket.on('erreur', ({ message }) => alert(message));
socket.on('notification', ({ message }) => afficherNotification(message));

socket.on('partie_lancee', () => {
  etatCourant.partieStatut = 'en_cours';
  // etat_joueur sera pousse directement par le serveur apres le lancement
});

socket.on('etat_joueur', (nouvelEtat) => {
  etatJoueur = nouvelEtat;

  if (nouvelEtat.partieTerminee) return; // partie_terminee gere l'affichage final

  const vue = vueActuelleId();
  const enTransition = !vue || ['accueil', 'ecran-attente-lancement'].includes(vue);

  if (enTransition) {
    if (etatCourant.partieStatut === 'en_cours') afficherHub();
    else afficherVue('ecran-attente-lancement');
  } else if (vue === 'ecran-hub') {
    afficherHub();
  } else if (vue === 'ecran-representants') {
    afficherParcoursRace();
  } else if (vue === 'ecran-representant-individuel' && rangAffiche) {
    afficherRepresentantIndividuel(rangAffiche);
  } else if (vue === 'ecran-parcours-allegeance' && allegeanceAffichee) {
    afficherParcoursAllegeance(allegeanceAffichee);
  } else if (vue === 'ecran-rep-allegeance-individuel' && allegeanceAffichee && rangAllegeanceAffiche) {
    afficherRepAllegeanceIndividuel(allegeanceAffichee, rangAllegeanceAffiche);
  }
});

socket.on('scenario_maj', () => {
  // Navigation locale independante : chaque joueur gere son propre index
});

socket.on('partie_terminee', afficherFinDePartie);
socket.on('partie_annulee', ({ message }) => { alert(message); window.location.href = '/'; });
