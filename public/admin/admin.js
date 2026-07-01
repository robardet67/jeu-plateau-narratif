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
        <strong>${rep.nom}</strong>
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
}

vérifierSession();
