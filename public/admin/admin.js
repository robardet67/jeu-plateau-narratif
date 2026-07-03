const ecranConnexion = document.getElementById('ecran-connexion');
const ecranAdmin = document.getElementById('ecran-admin');
const indicateurSync = document.getElementById('indicateur-sync');

let racesEnCache = [];
let representantsEnCache = [];
let objectifsEnCache = [];
let allegiancesEnCache = [];

async function requeteJSON(url, options = {}) {
  const reponse = await fetch(url, options);
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const erreur = new Error(donnees.error || 'Erreur inconnue');
    erreur.donnees = donnees; // conserve le corps complet (ex: emplacements partiels)
    throw erreur;
  }
  return donnees;
}

function afficherSync(sync) {
  if (!sync) return;
  indicateurSync.classList.remove('succes', 'echec');
  if (sync.pushed) {
    indicateurSync.textContent = 'Synchronise sur GitHub';
    indicateurSync.classList.add('succes');
  } else {
    const raison = sync.raison || '';
    // Raisons silencieuses : desactivation volontaire ou rien a commiter
    const silencieux =
      raison.includes('desactivee') ||
      raison.includes('aucun fichier');
    if (silencieux) {
      indicateurSync.textContent = '';
      return;
    }
    indicateurSync.textContent = `Non synchronise (${raison})`;
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

// --- Allegeances ---

async function chargerAllegiances() {
  allegiancesEnCache = await requeteJSON('/api/allegiances');

  const compteur = document.getElementById('compteur-allegiances');
  compteur.textContent = `(${allegiancesEnCache.length}/3)`;

  const btnSubmit = document.querySelector('#form-nouvelle-allegiance button[type=submit]');
  if (btnSubmit) btnSubmit.disabled = allegiancesEnCache.length >= 3;

  const liste = document.getElementById('liste-allegiances');
  liste.innerHTML = '';
  allegiancesEnCache.forEach((a) => liste.appendChild(creerElementAllegiance(a)));

  const select = document.getElementById('select-allegiance-representants');
  const valeurPrecedente = select.value;
  select.innerHTML = allegiancesEnCache.map((a) => `<option value="${a.id}">${a.nom}</option>`).join('');
  if (valeurPrecedente && allegiancesEnCache.some((a) => String(a.id) === valeurPrecedente)) {
    select.value = valeurPrecedente;
  }
}

function creerElementAllegiance(allegiance) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.innerHTML = `
    <div class="element-infos">
      ${allegiance.portrait ? `<img src="${allegiance.portrait}" alt="portrait" style="width:48px;height:48px;object-fit:cover;border-radius:.25rem" />` : ''}
      <strong>${allegiance.nom}</strong>
    </div>
    <div class="element-actions">
      <button class="btn-modifier">Modifier</button>
      <button class="btn-supprimer bouton-danger">Supprimer</button>
    </div>
  `;

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifAllegiance(li, allegiance));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm(`Supprimer l'allegiance "${allegiance.nom}" et tous ses representants ?`)) return;
    const resultat = await requeteJSON(`/api/allegiances/${allegiance.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });

  return li;
}

function afficherFormulaireModifAllegiance(li, allegiance) {
  li.innerHTML = `
    <form class="formulaire" style="width:100%" enctype="multipart/form-data">
      <input name="nom" type="text" value="${allegiance.nom}" required />
      <label class="champ-fichier">Nouveau portrait (PNG, optionnel)
        <input name="portrait" type="file" accept="image/png" />
      </label>
      <div class="element-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="bouton-secondaire btn-annuler">Annuler</button>
      </div>
    </form>
  `;
  li.querySelector('.btn-annuler').addEventListener('click', () => chargerAllegiances());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/allegiances/${allegiance.id}`, { method: 'PUT', body: new FormData(e.target) });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });
}

document.getElementById('form-nouvelle-allegiance').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultat = await requeteJSON('/api/allegiances', { method: 'POST', body: new FormData(e.target) });
  afficherSync(resultat.synchronisation);
  e.target.reset();
  await chargerTout();
});

// --- Representants d'allegiance ---

async function chargerRepresentantsAllegiance() {
  const allegianceId = document.getElementById('select-allegiance-representants').value;
  const liste = document.getElementById('liste-representants-allegiance');
  liste.innerHTML = '';
  if (!allegianceId) return;

  const reps = await requeteJSON(`/api/allegiances/${allegianceId}/representants`);
  const compteur = document.getElementById('compteur-representants-allegiance');
  compteur.textContent = `(${reps.length}/3)`;
  document.querySelector('#form-nouveau-representant-allegiance button[type=submit]').disabled = reps.length >= 3;
  reps.forEach((rep) => liste.appendChild(creerElementRepresentantAllegiance(rep)));
}

function creerElementRepresentantAllegiance(rep) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.innerHTML = `
    <div class="element-infos">
      ${rep.image_depart ? `<img src="${rep.image_depart}" alt="depart" />` : ''}
      ${rep.image_sourire ? `<img src="${rep.image_sourire}" alt="sourire" />` : ''}
      <div>
        <strong>Rang ${rep.rang} — ${rep.nom}</strong>
        <div>${rep.dialogue || '<em>aucun dialogue</em>'}</div>
      </div>
    </div>
    <div class="element-actions">
      <button class="btn-modifier">Modifier</button>
      <button class="btn-supprimer bouton-danger">Supprimer</button>
    </div>
  `;

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifRepresentantAllegiance(li, rep));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm(`Supprimer le representant "${rep.nom}" ?`)) return;
    const resultat = await requeteJSON(`/api/representants-allegiance/${rep.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await chargerRepresentantsAllegiance();
  });

  return li;
}

function afficherFormulaireModifRepresentantAllegiance(li, rep) {
  li.innerHTML = `
    <form class="formulaire" style="width:100%" enctype="multipart/form-data">
      <input name="nom" type="text" value="${rep.nom}" required />
      <textarea name="dialogue">${rep.dialogue || ''}</textarea>
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
  li.querySelector('.btn-annuler').addEventListener('click', () => chargerRepresentantsAllegiance());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/representants-allegiance/${rep.id}`, { method: 'PUT', body: new FormData(e.target) });
    afficherSync(resultat.synchronisation);
    await chargerRepresentantsAllegiance();
  });
}

document.getElementById('select-allegiance-representants').addEventListener('change', chargerRepresentantsAllegiance);

document.getElementById('form-nouveau-representant-allegiance').addEventListener('submit', async (e) => {
  e.preventDefault();
  const allegianceId = document.getElementById('select-allegiance-representants').value;
  if (!allegianceId) return alert("Choisissez une allegiance");
  const resultat = await requeteJSON(`/api/allegiances/${allegianceId}/representants`, { method: 'POST', body: new FormData(e.target) });
  afficherSync(resultat.synchronisation);
  e.target.reset();
  await chargerRepresentantsAllegiance();
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
  const liste = document.getElementById('liste-objectifs');
  liste.innerHTML = '';
  objectifsEnCache.forEach((o) => liste.appendChild(creerElementObjectif(o)));
}

function creerElementObjectif(objectif) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  const niveauBadge = objectif.niveau != null ? ` <span class="compteur">niv.${objectif.niveau}</span>` : '';
  li.innerHTML = `
    <div class="element-infos">
      <div><strong>${objectif.description}</strong>${niveauBadge}</div>
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
      <input name="niveau" type="number" min="1" placeholder="Niveau (optionnel)" value="${objectif.niveau ?? ''}" />
      <div class="element-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="bouton-secondaire btn-annuler">Annuler</button>
      </div>
    </form>
  `;
  li.querySelector('.btn-annuler').addEventListener('click', () => chargerObjectifs());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/objectifs/${objectif.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: new FormData(e.target).get('description'),
        niveau: new FormData(e.target).get('niveau')
      })
    });
    afficherSync(resultat.synchronisation);
    await chargerObjectifs();
  });
}

document.getElementById('form-nouvel-objectif').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultat = await requeteJSON('/api/objectifs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: new FormData(e.target).get('description'),
      niveau: new FormData(e.target).get('niveau')
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

  const mode = document.querySelector('input[name="mode-import"]:checked').value;

  if (mode === 'remplacer') {
    const total = objectifsEnCache.length;
    const msg = total > 0
      ? `Cette action supprimera definitivement les ${total} objectif(s) existants. Confirmer ?`
      : "Remplacer les objectifs existants ? (la liste est vide)";
    if (!confirm(msg)) return;
  }

  const donnees = new FormData();
  donnees.append('fichier', fichier);
  donnees.append('mode', mode);

  const messageEl = document.getElementById('message-import-objectifs');
  try {
    const resultat = await requeteJSON('/api/objectifs/import', { method: 'POST', body: donnees });
    afficherSync(resultat.synchronisation);
    const partieSupprime = resultat.supprimes > 0 ? ` (${resultat.supprimes} supprime(s))` : '';
    messageEl.textContent = `${resultat.importes} objectif(s) importe(s)${partieSupprime}.`;
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

// --- Salle d'attente / lancement de partie ---

let intervalSuivi = null;
let intervalJoueursConfig = null;

async function chargerPartieActive() {
  const partie = await requeteJSON('/api/admin/partie-active');

  document.getElementById('partie-aucune').classList.toggle('cachee', partie.active);
  document.getElementById('partie-configuration').classList.toggle('cachee', !partie.active || partie.statut !== 'en_attente');
  document.getElementById('partie-suivi').classList.toggle('cachee', !partie.active || partie.statut !== 'en_cours');

  if (intervalSuivi) {
    clearInterval(intervalSuivi);
    intervalSuivi = null;
  }
  if (intervalJoueursConfig) {
    clearInterval(intervalJoueursConfig);
    intervalJoueursConfig = null;
  }

  if (!partie.active) return;

  if (partie.statut === 'en_attente') {
    document.getElementById('partie-statut-badge').textContent = `(code interne : ${partie.code})`;
    afficherListeJoueursConfig(partie.joueurs);
    afficherProgressionLancement(partie);
    intervalJoueursConfig = setInterval(rafraichirJoueursConfig, 4000);
  } else if (partie.statut === 'en_cours') {
    await chargerSuiviPartie();
    intervalSuivi = setInterval(chargerSuiviPartie, 5000);
  }
}

function afficherListeJoueursConfig(joueurs) {
  const listeJoueursConfig = document.getElementById('liste-joueurs-config');
  listeJoueursConfig.innerHTML =
    joueurs
      .map((j) => {
        const statut = j.race_id ? '✓ race choisie' : '⏳ race non choisie';
        const connexion = j.connecte ? '' : ' (hors ligne)';
        return `<li>${j.pseudo}${connexion} — ${statut}</li>`;
      })
      .join('') || '<li>Aucun joueur pour le moment</li>';
}

function afficherProgressionLancement(partie) {
  const infoEl = document.getElementById('info-lancement-auto');
  const joueurs = partie.joueurs || [];
  const nbAttendu = partie.nb_joueurs_attendus || 0;
  const nbConnectes = joueurs.filter((j) => j.connecte).length;
  const nbPrets = joueurs.filter((j) => j.race_id).length;

  const lignes = [];

  if (nbAttendu > 0) {
    lignes.push(`Lancement auto : ${joueurs.length}/${nbAttendu} joueur(s) inscrits, ${nbPrets}/${nbAttendu} ont choisi leur race.`);
    if (joueurs.length >= nbAttendu && nbPrets < joueurs.length) {
      lignes.push('En attente : certains joueurs n\'ont pas encore choisi leur race.');
    } else if (joueurs.length < nbAttendu) {
      lignes.push(`En attente : ${nbAttendu - joueurs.length} joueur(s) supplementaire(s) doivent rejoindre.`);
    }
  } else {
    lignes.push('Lancement automatique desactive (0 joueurs attendus configure). Utilisez le bouton "Forcer le lancement".');
  }

  if (nbConnectes < joueurs.length) {
    lignes.push(`Attention : ${joueurs.length - nbConnectes} joueur(s) inscrit(s) mais non connecte(s) via socket.`);
  }

  infoEl.textContent = lignes.join(' ');
}

async function rafraichirJoueursConfig() {
  try {
    const partie = await requeteJSON('/api/admin/partie-active');
    if (!partie.active) return;
    if (partie.statut !== 'en_attente') {
      // La partie a ete lancee automatiquement pendant l'attente : recharger la vue complete
      await chargerPartieActive();
      return;
    }
    afficherListeJoueursConfig(partie.joueurs);
    afficherProgressionLancement(partie);
  } catch (err) {
    // Rafraichissement silencieux en arriere-plan : une erreur ponctuelle n'a pas besoin
    // d'interrompre le MJ.
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

// --- Configuration de partie (representants actifs + objectifs par rang) ---

function mettreAJourConfigObjectifs(conteneurId, nb) {
  const conteneur = document.getElementById(conteneurId);
  conteneur.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    const label = document.createElement('label');
    label.style.opacity = i > nb ? '0.4' : '1';
    label.innerHTML = `Rep ${i} — objectifs : <input type="number" min="1" max="3" value="2" data-rang="${i}" style="width:4rem" ${i > nb ? 'disabled' : ''} />`;
    conteneur.appendChild(label);
  }
}

function lireConfigObjectifs(conteneurId) {
  return [1, 2, 3].map((i) => {
    const input = document.querySelector(`#${conteneurId} [data-rang="${i}"]`);
    return input ? (parseInt(input.value) || 2) : 2;
  });
}

document.getElementById('config-nb-rep-race').addEventListener('input', (e) => {
  mettreAJourConfigObjectifs('config-obj-race', parseInt(e.target.value) || 0);
});
document.getElementById('config-nb-rep-allegiance').addEventListener('input', (e) => {
  mettreAJourConfigObjectifs('config-obj-allegiance', parseInt(e.target.value) || 0);
});

// Initialisation des sous-formulaires au chargement
mettreAJourConfigObjectifs('config-obj-race', parseInt(document.getElementById('config-nb-rep-race').value) || 2);
mettreAJourConfigObjectifs('config-obj-allegiance', parseInt(document.getElementById('config-nb-rep-allegiance').value) || 2);

document.getElementById('btn-forcer-lancement').addEventListener('click', async () => {
  if (!confirm('Forcer le lancement maintenant ? La partie demarrera meme si tous les joueurs n\'ont pas choisi leur race.')) return;
  const msgEl = document.getElementById('message-lancement');
  msgEl.classList.add('cachee');
  try {
    await requeteJSON('/api/admin/partie-active/lancer', { method: 'POST' });
    await chargerPartieActive();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.classList.remove('cachee');
  }
});

document.getElementById('btn-reinitialiser-partie').addEventListener('click', async () => {
  if (!confirm('Annuler cette partie et revenir a la creation ? Les joueurs connectes seront deconnectes.')) return;
  await requeteJSON('/api/admin/partie-active/reinitialiser', { method: 'POST' });
  await chargerPartieActive();
});

document.getElementById('btn-creer-partie-active').addEventListener('click', async () => {
  const nbJoueurs = parseInt(document.getElementById('config-nb-joueurs').value) || 0;
  const nbRepRace = parseInt(document.getElementById('config-nb-rep-race').value) || 0;
  const nbRepAllegiance = parseInt(document.getElementById('config-nb-rep-allegiance').value) || 0;

  const erreurEl = document.getElementById('erreur-config-partie');
  if (nbRepRace === 0 && nbRepAllegiance === 0) {
    erreurEl.textContent = "Il faut au moins 1 representant actif (race ou allegiance).";
    erreurEl.classList.remove('cachee');
    return;
  }
  erreurEl.classList.add('cachee');

  const configRace = JSON.stringify(lireConfigObjectifs('config-obj-race'));
  const configAllegiance = JSON.stringify(lireConfigObjectifs('config-obj-allegiance'));

  try {
    await requeteJSON('/api/admin/partie-active/creer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nb_joueurs_attendus: nbJoueurs,
        nb_representants_race: nbRepRace,
        nb_representants_allegiance: nbRepAllegiance,
        config_objectifs_race: configRace,
        config_objectifs_allegiance: configAllegiance
      })
    });
    await chargerPartieActive();
  } catch (err) {
    erreurEl.textContent = err.message;
    erreurEl.classList.remove('cachee');
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
  await chargerAllegiances();
  await chargerRepresentants();
  await chargerReprésentantsPourDialogues();
  await chargerObjectifs();
  chargerFond();
  await chargerScenario();
  await chargerParametres();
  await chargerPartieActive();
}

vérifierSession();
