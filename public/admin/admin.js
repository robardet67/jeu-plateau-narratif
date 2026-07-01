const ecranConnexion = document.getElementById('ecran-connexion');
const ecranAdmin = document.getElementById('ecran-admin');
const indicateurSync = document.getElementById('indicateur-sync');

let racesEnCache = [];
let representantsEnCache = [];

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
    document.getElementById('select-race-dialogues')
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
      ${race.image ? `<img src="${race.image}" alt="${race.nom}" />` : ''}
      <div>
        <strong>${race.nom}</strong>
        <div>${race.description || ''}</div>
      </div>
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
    <form class="formulaire" style="width:100%">
      <input name="nom" type="text" value="${race.nom}" required />
      <textarea name="description">${race.description || ''}</textarea>
      <label class="champ-fichier">Nouvelle image (optionnel)
        <input name="image" type="file" accept="image/*" />
      </label>
      <div class="element-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="bouton-secondaire btn-annuler">Annuler</button>
      </div>
    </form>
  `;
  li.querySelector('.btn-annuler').addEventListener('click', () => chargerRaces());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/races/${race.id}`, {
      method: 'PUT',
      body: new FormData(e.target)
    });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });
}

document.getElementById('form-nouvelle-race').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultat = await requeteJSON('/api/races', { method: 'POST', body: new FormData(e.target) });
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
    await chargerRepresentants();
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
    await chargerRepresentants();
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
  await chargerRepresentants();
});

// --- Dialogues ---

async function chargerReprésentantsPourDialogues() {
  const raceId = document.getElementById('select-race-dialogues').value;
  if (!raceId) return;

  const representants = await requeteJSON(`/api/races/${raceId}/representants`);
  const select = document.getElementById('select-representant-dialogues');
  const valeurPrecedente = select.value;
  select.innerHTML = representants.map((r) => `<option value="${r.id}">${r.nom}</option>`).join('');
  if (valeurPrecedente) select.value = valeurPrecedente;

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
document.getElementById('champ-prenom-test').addEventListener('input', chargerDialogues);

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

// --- Chargement global ---

async function chargerTout() {
  await chargerRaces();
  await chargerRepresentants();
  await chargerReprésentantsPourDialogues();
}

vérifierSession();
