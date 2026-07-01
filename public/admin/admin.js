const ecranConnexion = document.getElementById('ecran-connexion');
const ecranAdmin = document.getElementById('ecran-admin');
const indicateurSync = document.getElementById('indicateur-sync');

let racesEnCache = [];
let representantsEnCache = [];
let objectifsEnCache = [];

async function requeteJSON(url, options = {}) {
  const reponse = await fetch(url, options);
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(donnees.error || 'Erreur inconnue');
  return donnees;
}

function afficherSync(sync) {
  if (!sync) return;
  indicateurSync.classList.remove('succes', 'echec');
  if (sync.pushed) {
    indicateurSync.textContent = 'Synchronise sur GitHub';
    indicateurSync.classList.add('succes');
  } else {
    indicateurSync.textContent = `Non synchronise (${sync.raison || 'erreur'})`;
    indicateurSync.classList.add('echec');
  }
}

// --- Connexion / session ---

async function vérifierSession() {
  const { connecte } = await requeteJSON('/api/admin/session');
  if (connecte) {
    ecranConnexion.classList.add('cachee');
    ecranAdmin.classList.remove('cachee');
    await chargerTout();
  } else {
    ecranConnexion.classList.remove('cachee');
    ecranAdmin.classList.add('cachee');
  }
}

document.getElementById('form-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const motDePasse = document.getElementById('champ-mot-de-passe').value;
  const erreurEl = document.getElementById('erreur-connexion');
  erreurEl.classList.add('cachee');
  try {
    await requeteJSON('/api/admin/connexion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motDePasse })
    });
    document.getElementById('champ-mot-de-passe').value = '';
    await vérifierSession();
  } catch (err) {
    erreurEl.textContent = err.message;
    erreurEl.classList.remove('cachee');
  }
});

document.getElementById('btn-deconnexion').addEventListener('click', async () => {
  await requeteJSON('/api/admin/deconnexion', { method: 'POST' });
  await vérifierSession();
});

document.getElementById('btn-quitter-admin').addEventListener('click', () => {
  window.location.href = '/';
});

document.getElementById('btn-afficher-mdp').addEventListener('click', () => {
  document.getElementById('panneau-mot-de-passe').classList.toggle('cachee');
});

document.getElementById('form-mot-de-passe').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ancien = document.getElementById('ancien-mdp').value;
  const nouveau = document.getElementById('nouveau-mdp').value;
  const messageEl = document.getElementById('message-mdp');
  try {
    await requeteJSON('/api/admin/mot-de-passe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ancien, nouveau })
    });
    messageEl.textContent = 'Mot de passe modifie avec succes.';
    messageEl.classList.remove('cachee');
    e.target.reset();
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.classList.remove('cachee');
  }
});

// --- Onglets ---

document.querySelectorAll('.onglet').forEach((bouton) => {
  bouton.addEventListener('click', () => {
    document.querySelectorAll('.onglet').forEach((b) => b.classList.remove('actif'));
    document.querySelectorAll('.contenu-onglet').forEach((c) => c.classList.add('cachee'));
    bouton.classList.add('actif');
    document.getElementById(`onglet-${bouton.dataset.onglet}`).classList.remove('cachee');
  });
});

// --- Races ---

async function chargerRaces() {
  racesEnCache = await requeteJSON('/api/races');

  const liste = document.getElementById('liste-races');
  liste.innerHTML = '';
  racesEnCache.forEach((race) => liste.appendChild(creerElementRace(race)));

  const selects = [
    document.getElementById('select-race-representants'),
    document.getElementById('select-race-dialogues'),
    document.getElementById('select-race-fond')
  ];
  selects.forEach((select) => {
    const valeurPrecedente = select.value;
    select.innerHTML = racesEnCache
      .map((r) => `<option value="${r.id}">${r.nom}</option>`)
      .join('');
    if (valeurPrecedente) select.value = valeurPrecedente;
  });
}

function creerElementRace(race) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.innerHTML = `
    <div class="element-infos">
      <strong>${race.nom}</strong>
    </div>
    <div class="element-actions">
      <button class="btn-modifier">Modifier</button>
      <button class="btn-supprimer bouton-danger">Supprimer</button>
    </div>
  `;

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifRace(li, race));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm(`Supprimer la race "${race.nom}" et tous ses representants ?`)) return;
    const resultat = await requeteJSON(`/api/races/${race.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });

  return li;
}

function afficherFormulaireModifRace(li, race) {
  li.innerHTML = `
    <form class="formulaire-ligne" style="width:100%">
      <input name="nom" type="text" value="${race.nom}" required />
      <div class="element-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="bouton-secondaire btn-annuler">Annuler</button>
      </div>
    </form>
  `;
  li.querySelector('.btn-annuler').addEventListener('click', () => chargerRaces());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nom = new FormData(e.target).get('nom');
    const resultat = await requeteJSON(`/api/races/${race.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom })
    });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });
}

document.getElementById('form-nouvelle-race').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nom = new FormData(e.target).get('nom');
  const resultat = await requeteJSON('/api/races', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom })
  });
  afficherSync(resultat.synchronisation);
  e.target.reset();
  await chargerTout();
});

// --- Representants ---

async function chargerRepresentants() {
  const raceId = document.getElementById('select-race-representants').value;
  if (!raceId) return;

  representantsEnCache = await requeteJSON(`/api/races/${raceId}/representants`);

  document.getElementById('compteur-representants').textContent = `(${representantsEnCache.length}/3)`;
  document.getElementById('form-nouveau-representant').querySelector('button[type=submit]').disabled =
    representantsEnCache.length >= 3;

  const liste = document.getElementById('liste-representants');
  liste.innerHTML = '';
  representantsEnCache.forEach((rep) => liste.appendChild(creerElementRepresentant(rep)));
}

function creerElementRepresentant(rep) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.innerHTML = `
    <div class="element-infos">
      ${rep.image_depart ? `<img src="${rep.image_depart}" alt="depart" />` : ''}
      ${rep.image_sourire ? `<img src="${rep.image_sourire}" alt="sourire" />` : ''}
      <div>
        <strong>Rang ${rep.rang} - ${rep.nom}</strong>
        <div>${rep.description || ''}</div>
      </div>
    </div>
    <div class="element-actions">
      <button class="btn-modifier">Modifier</button>
      <button class="btn-supprimer bouton-danger">Supprimer</button>
    </div>
  `;

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifRepresentant(li, rep));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm(`Supprimer le representant "${rep.nom}" ?`)) return;
    const resultat = await requeteJSON(`/api/representants/${rep.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });

  return li;
}

function afficherFormulaireModifRepresentant(li, rep) {
  li.innerHTML = `
    <form class="formulaire" style="width:100%" enctype="multipart/form-data">
      <input name="nom" type="text" value="${rep.nom}" required />
      <textarea name="description">${rep.description || ''}</textarea>
      <label class="champ-fichier">Nouvelle image de depart (PNG, optionnel)
        <input name="image_depart" type="file" accept="image/png" />
      </label>
      <label class="champ-fichier">Nouvelle image de sourire (PNG, optionnel)
        <input name="image_sourire" type="file" accept="image/png" />
      </label>
      <div class="element-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="bouton-secondaire btn-annuler">Annuler</button>
      </div>
    </form>
  `;
  li.querySelector('.btn-annuler').addEventListener('click', () => chargerRepresentants());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/representants/${rep.id}`, {
      method: 'PUT',
      body: new FormData(e.target)
    });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });
}

document.getElementById('select-race-representants').addEventListener('change', chargerRepresentants);

document.getElementById('form-nouveau-representant').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raceId = document.getElementById('select-race-representants').value;
  const resultat = await requeteJSON(`/api/races/${raceId}/representants`, {
    method: 'POST',
    body: new FormData(e.target)
  });
  afficherSync(resultat.synchronisation);
  e.target.reset();
  await chargerTout();
});

// --- Dialogues ---

async function chargerReprésentantsPourDialogues() {
  const raceId = document.getElementById('select-race-dialogues').value;
  if (!raceId) return;

  const representants = await requeteJSON(`/api/races/${raceId}/representants`);
  const select = document.getElementById('select-representant-dialogues');
  const valeurPrecedente = select.value;
  select.innerHTML = representants.map((r) => `<option value="${r.id}">${r.nom}</option>`).join('');
  if (valeurPrecedente && representants.some((r) => String(r.id) === valeurPrecedente)) {
    select.value = valeurPrecedente;
  }

  await chargerDialogues();
}

function texteAvecVariante(texte) {
  const prenom = document.getElementById('champ-prenom-test').value.trim() || '{nom}';
  return texte.replaceAll('{nom}', prenom);
}

async function chargerDialogues() {
  const representantId = document.getElementById('select-representant-dialogues').value;
  const liste = document.getElementById('liste-dialogues');
  liste.innerHTML = '';
  if (!representantId) return;

  const dialogues = await requeteJSON(`/api/representants/${representantId}/dialogues`);
  dialogues.forEach((dialogue) => liste.appendChild(creerElementDialogue(dialogue)));
}

function creerElementDialogue(dialogue) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.dataset.texteOriginal = dialogue.texte;
  li.innerHTML = `
    <div class="element-infos">
      <div>
        <strong>${dialogue.contexte}</strong>
        <div>${dialogue.texte}</div>
        <div class="apercu-dialogue">Apercu : ${texteAvecVariante(dialogue.texte)}</div>
      </div>
    </div>
    <div class="element-actions">
      <button class="btn-modifier">Modifier</button>
      <button class="btn-supprimer bouton-danger">Supprimer</button>
    </div>
  `;

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifDialogue(li, dialogue));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm('Supprimer ce dialogue ?')) return;
    const resultat = await requeteJSON(`/api/dialogues/${dialogue.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await chargerDialogues();
  });

  return li;
}

function afficherFormulaireModifDialogue(li, dialogue) {
  li.innerHTML = `
    <form class="formulaire" style="width:100%">
      <input name="contexte" type="text" value="${dialogue.contexte}" required />
      <textarea name="texte" required>${dialogue.texte}</textarea>
      <div class="element-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="bouton-secondaire btn-annuler">Annuler</button>
      </div>
    </form>
  `;
  li.querySelector('.btn-annuler').addEventListener('click', () => chargerDialogues());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const donnees = new FormData(e.target);
    const resultat = await requeteJSON(`/api/dialogues/${dialogue.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contexte: donnees.get('contexte'), texte: donnees.get('texte') })
    });
    afficherSync(resultat.synchronisation);
    await chargerDialogues();
  });
}

document.getElementById('select-race-dialogues').addEventListener('change', chargerReprésentantsPourDialogues);
document.getElementById('select-representant-dialogues').addEventListener('change', chargerDialogues);
document.getElementById('champ-prenom-test').addEventListener('input', () => {
  document.querySelectorAll('#liste-dialogues li').forEach((li) => {
    const apercu = li.querySelector('.apercu-dialogue');
    if (apercu) apercu.textContent = `Apercu : ${texteAvecVariante(li.dataset.texteOriginal)}`;
  });
});

document.getElementById('form-nouveau-dialogue').addEventListener('submit', async (e) => {
  e.preventDefault();
  const representantId = document.getElementById('select-representant-dialogues').value;
  if (!representantId) return alert('Choisissez un representant');

  const donnees = new FormData(e.target);
  const resultat = await requeteJSON(`/api/representants/${representantId}/dialogues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contexte: donnees.get('contexte'), texte: donnees.get('texte') })
  });
  afficherSync(resultat.synchronisation);
  e.target.reset();
  await chargerDialogues();
});

// --- Objectifs ---

async function chargerObjectifs() {
  objectifsEnCache = await requeteJSON('/api/objectifs');
  remplirFiltresObjectifs();
  afficherObjectifsFiltres();
}

function valeursDistinctes(cle) {
  return [...new Set(objectifsEnCache.map((o) => o[cle]).filter(Boolean))].sort();
}

function remplirFiltresObjectifs() {
  remplirUnFiltre('filtre-niveau', valeursDistinctes('niveau'));
  remplirUnFiltre('filtre-type', valeursDistinctes('type'));
  remplirUnFiltre('filtre-categorie', valeursDistinctes('categorie'));
}

function remplirUnFiltre(id, valeurs) {
  const select = document.getElementById(id);
  const valeurPrecedente = select.value;
  const optionParDefaut = select.options[0];
  select.innerHTML = '';
  select.appendChild(optionParDefaut);
  valeurs.forEach((v) => {
    const option = document.createElement('option');
    option.value = v;
    option.textContent = v;
    select.appendChild(option);
  });
  if (valeurPrecedente) select.value = valeurPrecedente;
}

function afficherObjectifsFiltres() {
  const niveau = document.getElementById('filtre-niveau').value;
  const type = document.getElementById('filtre-type').value;
  const categorie = document.getElementById('filtre-categorie').value;

  const filtres = objectifsEnCache.filter(
    (o) =>
      (!niveau || o.niveau === niveau) &&
      (!type || o.type === type) &&
      (!categorie || o.categorie === categorie)
  );

  const liste = document.getElementById('liste-objectifs');
  liste.innerHTML = '';
  filtres.forEach((o) => liste.appendChild(creerElementObjectif(o)));
}

function creerElementObjectif(objectif) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.innerHTML = `
    <div class="element-infos">
      <div>
        <strong>${objectif.description}</strong>
        <div class="compteur">${[objectif.niveau, objectif.type, objectif.categorie].filter(Boolean).join(' | ')}</div>
      </div>
    </div>
    <div class="element-actions">
      <button class="btn-modifier">Modifier</button>
      <button class="btn-supprimer bouton-danger">Supprimer</button>
    </div>
  `;

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifObjectif(li, objectif));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm('Supprimer cet objectif ?')) return;
    const resultat = await requeteJSON(`/api/objectifs/${objectif.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await chargerObjectifs();
  });

  return li;
}

function afficherFormulaireModifObjectif(li, objectif) {
  li.innerHTML = `
    <form class="formulaire" style="width:100%">
      <textarea name="description" required>${objectif.description}</textarea>
      <input name="niveau" type="text" placeholder="Niveau" value="${objectif.niveau || ''}" />
      <input name="type" type="text" placeholder="Type" value="${objectif.type || ''}" />
      <input name="categorie" type="text" placeholder="Categorie" value="${objectif.categorie || ''}" />
      <div class="element-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="bouton-secondaire btn-annuler">Annuler</button>
      </div>
    </form>
  `;
  li.querySelector('.btn-annuler').addEventListener('click', () => afficherObjectifsFiltres());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const donnees = new FormData(e.target);
    const resultat = await requeteJSON(`/api/objectifs/${objectif.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: donnees.get('description'),
        niveau: donnees.get('niveau'),
        type: donnees.get('type'),
        categorie: donnees.get('categorie')
      })
    });
    afficherSync(resultat.synchronisation);
    await chargerObjectifs();
  });
}

['filtre-niveau', 'filtre-type', 'filtre-categorie'].forEach((id) => {
  document.getElementById(id).addEventListener('change', afficherObjectifsFiltres);
});

document.getElementById('form-nouvel-objectif').addEventListener('submit', async (e) => {
  e.preventDefault();
  const donnees = new FormData(e.target);
  const resultat = await requeteJSON('/api/objectifs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: donnees.get('description'),
      niveau: donnees.get('niveau'),
      type: donnees.get('type'),
      categorie: donnees.get('categorie')
    })
  });
  afficherSync(resultat.synchronisation);
  e.target.reset();
  await chargerObjectifs();
});

document.getElementById('form-import-objectifs').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fichier = document.getElementById('champ-csv-objectifs').files[0];
  if (!fichier) return;

  const donnees = new FormData();
  donnees.append('fichier', fichier);

  const messageEl = document.getElementById('message-import-objectifs');
  try {
    const resultat = await requeteJSON('/api/objectifs/import', { method: 'POST', body: donnees });
    afficherSync(resultat.synchronisation);
    messageEl.textContent = `${resultat.importes} objectif(s) importe(s).`;
    messageEl.classList.remove('cachee');
    e.target.reset();
    await chargerObjectifs();
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.classList.remove('cachee');
  }
});

// --- Fonds (image de village par race) ---

function chargerFond() {
  const raceId = document.getElementById('select-race-fond').value;
  const apercu = document.getElementById('apercu-fond');
  if (!raceId) {
    apercu.style.backgroundImage = '';
    apercu.textContent = '';
    return;
  }

  const race = racesEnCache.find((r) => String(r.id) === String(raceId));
  if (race && race.image_fond) {
    apercu.style.backgroundImage = `url(${race.image_fond})`;
    apercu.textContent = '';
  } else {
    apercu.style.backgroundImage = '';
    apercu.textContent = 'Aucun fond defini pour cette race';
  }
}

document.getElementById('select-race-fond').addEventListener('change', chargerFond);

document.getElementById('form-fond').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raceId = document.getElementById('select-race-fond').value;
  if (!raceId) return alert('Choisissez une race');

  const resultat = await requeteJSON(`/api/races/${raceId}/fond`, {
    method: 'PUT',
    body: new FormData(e.target)
  });
  afficherSync(resultat.synchronisation);
  e.target.reset();
  await chargerTout();
});

document.getElementById('btn-supprimer-fond').addEventListener('click', async () => {
  const raceId = document.getElementById('select-race-fond').value;
  if (!raceId) return;
  if (!confirm('Supprimer le fond de cette race ?')) return;

  const resultat = await requeteJSON(`/api/races/${raceId}/fond`, { method: 'DELETE' });
  afficherSync(resultat.synchronisation);
  await chargerTout();
});

// --- Scenario (images ordonnees) ---

async function chargerScenario() {
  const images = await requeteJSON('/api/scenario');
  const liste = document.getElementById('liste-scenario');
  liste.innerHTML = '';
  images.forEach((image, index) => liste.appendChild(creerElementScenario(image, index, images.length)));
}

function creerElementScenario(image, index, total) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.innerHTML = `
    <div class="element-infos">
      <img class="miniature-scenario" src="${image.image}" alt="scenario" />
      <div>Position ${image.ordre}</div>
    </div>
    <div class="element-actions">
      <button class="btn-monter"${index === 0 ? ' disabled' : ''}>Monter</button>
      <button class="btn-descendre"${index === total - 1 ? ' disabled' : ''}>Descendre</button>
      <button class="btn-supprimer bouton-danger">Supprimer</button>
    </div>
  `;

  li.querySelector('.btn-monter').addEventListener('click', async () => {
    const resultat = await requeteJSON(`/api/scenario/${image.id}/deplacer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'haut' })
    });
    afficherSync(resultat.synchronisation);
    await chargerScenario();
  });
  li.querySelector('.btn-descendre').addEventListener('click', async () => {
    const resultat = await requeteJSON(`/api/scenario/${image.id}/deplacer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'bas' })
    });
    afficherSync(resultat.synchronisation);
    await chargerScenario();
  });
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm('Supprimer cette image du scenario ?')) return;
    const resultat = await requeteJSON(`/api/scenario/${image.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await chargerScenario();
  });

  return li;
}

document.getElementById('form-scenario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultat = await requeteJSON('/api/scenario', { method: 'POST', body: new FormData(e.target) });
  afficherSync(resultat.synchronisation);
  e.target.reset();
  await chargerScenario();
});

// --- Parametres globaux ---

async function chargerParametres() {
  const parametres = await requeteJSON('/api/parametres');
  document.getElementById('case-tableau-de-bord').checked = parametres.tableau_de_bord_actif;
}

document.getElementById('case-tableau-de-bord').addEventListener('change', async (e) => {
  const resultat = await requeteJSON('/api/admin/parametres', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableau_de_bord_actif: e.target.checked })
  });
  afficherSync(resultat.synchronisation);
});

// --- Configuration de partie (Phase 4) ---

const NIVEAUX_FIXES = ['facile', 'moyen', 'difficile'];
const TYPES_FIXES = ['standard', 'coopératif', 'belliqueux'];
let intervalSuivi = null;

function optionsAvecVide(valeurs, valeurSelectionnee) {
  const options = ['<option value="">--</option>']
    .concat(valeurs.map((v) => `<option value="${v}" ${v === valeurSelectionnee ? 'selected' : ''}>${v}</option>`));
  return options.join('');
}

function construireTableEmplacements(emplacements) {
  const corps = document.getElementById('corps-table-emplacements');
  corps.innerHTML = '';
  const categories = valeursDistinctes('categorie');

  for (const rang of [1, 2, 3]) {
    for (const position of [1, 2, 3]) {
      const existant = emplacements.find((e) => e.rang === rang && e.position === position) || {};
      const tr = document.createElement('tr');
      tr.dataset.rang = rang;
      tr.dataset.position = position;
      tr.innerHTML = `
        <td>Rang ${rang} - Position ${position}</td>
        <td><select class="emplacement-niveau">${optionsAvecVide(NIVEAUX_FIXES, existant.niveau)}</select></td>
        <td><select class="emplacement-type">${optionsAvecVide(TYPES_FIXES, existant.type)}</select></td>
        <td><select class="emplacement-categorie">${optionsAvecVide(categories, existant.categorie)}</select></td>
      `;
      corps.appendChild(tr);
    }
  }
}

function lireEmplacementsDepuisTable() {
  return [...document.querySelectorAll('#corps-table-emplacements tr')].map((tr) => ({
    rang: Number(tr.dataset.rang),
    position: Number(tr.dataset.position),
    niveau: tr.querySelector('.emplacement-niveau').value || null,
    type: tr.querySelector('.emplacement-type').value || null,
    categorie: tr.querySelector('.emplacement-categorie').value || null
  }));
}

// Minimum d'intervention du MJ : des que N et K sont renseignes (y compris les valeurs
// par defaut a l'ouverture), le serveur genere ET enregistre automatiquement les 9
// emplacements en piochant reellement dans le pool CSV (niveau croissant par position,
// K cooperatifs repartis, categories aleatoires parmi celles disponibles). Le bouton
// "Lancer la partie" est donc utilisable immediatement ; modifier reste optionnel.
async function genererConfigurationAutomatique() {
  const messageEl = document.getElementById('message-config-partie');
  messageEl.classList.add('cachee');

  const nombreJoueursPrevu = Number(document.getElementById('config-nombre-joueurs').value);
  const nombreCoopParJoueur = Number(document.getElementById('config-nombre-coop').value);
  if (!nombreJoueursPrevu || Number.isNaN(nombreCoopParJoueur)) return;

  try {
    const resultat = await requeteJSON('/api/admin/partie-active/generer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombreJoueursPrevu, nombreCoopParJoueur })
    });
    construireTableEmplacements(resultat.emplacements);
    afficherSync(resultat.synchronisation);
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.classList.remove('message-info');
    messageEl.classList.add('message-erreur');
    messageEl.classList.remove('cachee');
  }
}

document.getElementById('config-nombre-joueurs').addEventListener('change', genererConfigurationAutomatique);
document.getElementById('config-nombre-coop').addEventListener('change', genererConfigurationAutomatique);
// Le meme bouton sert de "regenerer" (nouveau tirage aleatoire) si le MJ n'aime pas le resultat.
document.getElementById('btn-proposer-config').addEventListener('click', genererConfigurationAutomatique);

async function chargerPartieActive() {
  const partie = await requeteJSON('/api/admin/partie-active');

  document.getElementById('partie-aucune').classList.toggle('cachee', partie.active);
  document.getElementById('partie-configuration').classList.toggle('cachee', !partie.active || partie.statut !== 'en_attente');
  document.getElementById('partie-suivi').classList.toggle('cachee', !partie.active || partie.statut !== 'en_cours');

  if (intervalSuivi) {
    clearInterval(intervalSuivi);
    intervalSuivi = null;
  }

  if (!partie.active) return;

  if (partie.statut === 'en_attente') {
    document.getElementById('partie-statut-badge').textContent = `(code interne : ${partie.code})`;
    document.getElementById('config-nombre-joueurs').value = partie.nombre_joueurs_prevu || 4;
    document.getElementById('config-nombre-coop').value = partie.nombre_coop_par_joueur || 0;

    const listeJoueursConfig = document.getElementById('liste-joueurs-config');
    listeJoueursConfig.innerHTML = partie.joueurs
      .map((j) => `<li>${j.pseudo}${j.race_id ? '' : ' (race non choisie)'}</li>`)
      .join('') || '<li>Aucun joueur pour le moment</li>';

    if (partie.emplacements && partie.emplacements.length === 9) {
      construireTableEmplacements(partie.emplacements);
    } else {
      // Partie fraichement creee : genere tout de suite avec les valeurs par defaut
      // affichees, pour que "Lancer la partie" soit utilisable sans aucune saisie.
      await genererConfigurationAutomatique();
    }
  } else if (partie.statut === 'en_cours') {
    await chargerSuiviPartie();
    intervalSuivi = setInterval(chargerSuiviPartie, 5000);
  }
}

async function chargerSuiviPartie() {
  const suivi = await requeteJSON('/api/admin/partie-active/suivi');
  const liste = document.getElementById('liste-suivi-joueurs');
  liste.innerHTML = suivi.joueurs
    .map(
      (j) =>
        `<li>${j.pseudo} - ${j.race_nom || 'sans race'} - ${j.connecte ? 'en ligne' : 'hors ligne'} - ${j.valides}/9 objectifs valides</li>`
    )
    .join('');
}

document.getElementById('btn-creer-partie-active').addEventListener('click', async () => {
  await requeteJSON('/api/admin/partie-active/creer', { method: 'POST' });
  await chargerPartieActive();
});

document.getElementById('btn-enregistrer-config').addEventListener('click', async () => {
  const messageEl = document.getElementById('message-config-partie');
  messageEl.classList.add('cachee');

  const nombreJoueursPrevu = Number(document.getElementById('config-nombre-joueurs').value);
  const nombreCoopParJoueur = Number(document.getElementById('config-nombre-coop').value);
  const emplacements = lireEmplacementsDepuisTable();

  try {
    const resultat = await requeteJSON('/api/admin/partie-active/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombreJoueursPrevu, nombreCoopParJoueur, emplacements })
    });
    afficherSync(resultat.synchronisation);

    if (resultat.lancement?.lance) {
      messageEl.textContent = 'Configuration enregistree. Effectif complet : la partie vient de demarrer !';
    } else {
      messageEl.textContent = 'Configuration enregistree.';
    }
    messageEl.classList.remove('message-erreur');
    messageEl.classList.add('message-info');
    messageEl.classList.remove('cachee');

    // Rafraichit la vue (bascule automatiquement sur le suivi si la partie a demarre).
    await chargerPartieActive();
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.classList.remove('message-info');
    messageEl.classList.add('message-erreur');
    messageEl.classList.remove('cachee');
  }
});

document.getElementById('btn-verifier-pool').addEventListener('click', async () => {
  const messageEl = document.getElementById('message-verification-pool');
  // Verifie les valeurs actuellement affichees a l'ecran, pas la derniere config
  // enregistree en base (sinon "Verifier" avant tout "Enregistrer" controle du vide).
  const nombreJoueursPrevu = Number(document.getElementById('config-nombre-joueurs').value);
  const emplacements = lireEmplacementsDepuisTable();

  try {
    const resultat = await requeteJSON('/api/admin/partie-active/verifier-pool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombreJoueursPrevu, emplacements })
    });
    messageEl.textContent = resultat.suffisant
      ? 'Le pool est suffisant pour tous les emplacements.'
      : resultat.message;
    messageEl.classList.remove('cachee');
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.classList.remove('cachee');
  }
});

document.getElementById('btn-lancer-partie').addEventListener('click', async () => {
  if (!confirm('Lancer la partie ? La distribution des objectifs sera definitive.')) return;

  const messageEl = document.getElementById('message-lancement');
  messageEl.classList.add('cachee');
  try {
    // Sauvegarde d'abord l'etat actuel de la table (capture d'eventuels ajustements
    // manuels du MJ), puis lance : aucune action prealable n'est requise sinon.
    const nombreJoueursPrevu = Number(document.getElementById('config-nombre-joueurs').value);
    const nombreCoopParJoueur = Number(document.getElementById('config-nombre-coop').value);
    const emplacements = lireEmplacementsDepuisTable();
    await requeteJSON('/api/admin/partie-active/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombreJoueursPrevu, nombreCoopParJoueur, emplacements })
    });

    const resultat = await requeteJSON('/api/admin/partie-active/lancer', { method: 'POST' });
    afficherSync(resultat.synchronisation);
    await chargerPartieActive();
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.classList.remove('cachee');
  }
});

document.getElementById('btn-terminer-partie').addEventListener('click', async () => {
  if (!confirm('Terminer la partie manuellement pour tous les joueurs ?')) return;
  await requeteJSON('/api/admin/partie-active/terminer', { method: 'POST' });
  await chargerPartieActive();
});

// --- Chargement global ---
// Chaque mutation (races, representants, dialogues...) appelle chargerTout() afin que
// tous les selects/listes dependants (ex. Dialogues -> representants) restent synchronises,
// meme lorsqu'ils sont modifies depuis un autre onglet.

async function chargerTout() {
  await chargerRaces();
  await chargerRepresentants();
  await chargerReprésentantsPourDialogues();
  await chargerObjectifs();
  chargerFond();
  await chargerScenario();
  await chargerParametres();
  await chargerPartieActive();
}

vérifierSession();
