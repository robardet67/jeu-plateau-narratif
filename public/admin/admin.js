const ecranConnexion = document.getElementById('ecran-connexion');
const ecranAdmin = document.getElementById('ecran-admin');
const indicateurSync = document.getElementById('indicateur-sync');

let racesEnCache = [];
let objectifsEnCache = [];
let allegeancesEnCache = [];

async function requeteJSON(url, options = {}) {
  const reponse = await fetch(url, options);
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const erreur = new Error(donnees.error || 'Erreur inconnue');
    erreur.donnees = donnees;
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

// --- Races (avec representants integres inline) ---

async function chargerRaces() {
  racesEnCache = await requeteJSON('/api/races');

  const liste = document.getElementById('liste-races');
  liste.innerHTML = '';
  racesEnCache.forEach((race) => liste.appendChild(creerElementRace(race)));

  const selectFond = document.getElementById('select-race-fond');
  const valeurPrecedente = selectFond.value;
  selectFond.innerHTML = racesEnCache.map((r) => `<option value="${r.id}">${r.nom}</option>`).join('');
  if (valeurPrecedente) selectFond.value = valeurPrecedente;
}

function creerElementRace(race) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.style.flexDirection = 'column';
  li.style.alignItems = 'stretch';
  const apercuPortrait = race.image_portrait
    ? `<img src="${race.image_portrait}" alt="portrait" style="width:48px;height:48px;object-fit:cover;border-radius:.25rem;margin-right:.5rem" />`
    : '';
  li.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="element-infos">${apercuPortrait}<strong>${race.nom}</strong></div>
      <div class="element-actions">
        <button class="btn-modifier">Modifier</button>
        <button class="btn-supprimer bouton-danger">Supprimer</button>
      </div>
    </div>
    <div style="margin-top:.75rem;border-top:1px solid rgba(255,255,255,.1);padding-top:.75rem">
      <h4 style="margin:0 0 .4rem;font-size:.875rem">Portrait de la race (affiché sur le hub)</h4>
      <form class="form-portrait-race formulaire-ligne" enctype="multipart/form-data">
        <input name="image" type="file" accept="image/png,image/jpeg" />
        <button type="submit">Enregistrer le portrait</button>
        ${race.image_portrait ? '<button type="button" class="btn-supprimer-portrait bouton-danger">Supprimer</button>' : ''}
      </form>
    </div>
    <div class="section-representants" style="margin-top:.75rem;border-top:1px solid rgba(255,255,255,.1);padding-top:.75rem">
      <ul class="liste-reps-race liste-elements" style="margin:0 0 .5rem"></ul>
      <form class="form-rep-race formulaire" enctype="multipart/form-data">
        <h4 style="margin:0 0 .4rem;font-size:.875rem">Ajouter un representant (max. 3)</h4>
        <input name="nom" type="text" placeholder="Nom du representant" required />
        <textarea name="description" placeholder="Description (optionnel)"></textarea>
        <label class="champ-fichier">Image de depart (PNG)<input name="image_depart" type="file" accept="image/png" required /></label>
        <label class="champ-fichier">Image de sourire (PNG)<input name="image_sourire" type="file" accept="image/png" required /></label>
        <button type="submit" class="btn-creer-rep">Creer le representant</button>
      </form>
    </div>
  `;

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifRace(li, race));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm(`Supprimer la race "${race.nom}" et tous ses representants ?`)) return;
    const resultat = await requeteJSON(`/api/races/${race.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });

  li.querySelector('.form-portrait-race').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fichier = e.target.querySelector('input[type="file"]').files[0];
    if (!fichier) return;
    const resultat = await requeteJSON(`/api/races/${race.id}/portrait`, {
      method: 'PUT',
      body: new FormData(e.target)
    });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });

  const btnSupprimerPortrait = li.querySelector('.btn-supprimer-portrait');
  if (btnSupprimerPortrait) {
    btnSupprimerPortrait.addEventListener('click', async () => {
      if (!confirm('Supprimer le portrait de cette race ?')) return;
      const resultat = await requeteJSON(`/api/races/${race.id}/portrait`, { method: 'DELETE' });
      afficherSync(resultat.synchronisation);
      await chargerTout();
    });
  }

  li.querySelector('.form-rep-race').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/races/${race.id}/representants`, {
      method: 'POST',
      body: new FormData(e.target)
    });
    afficherSync(resultat.synchronisation);
    e.target.reset();
    await rafraichirRepresentantsRace(li, race.id);
  });

  rafraichirRepresentantsRace(li, race.id);
  return li;
}

async function rafraichirRepresentantsRace(li, raceId) {
  const reps = await requeteJSON(`/api/races/${raceId}/representants`);
  const liste = li.querySelector('.liste-reps-race');
  liste.innerHTML = '';
  const btnCreer = li.querySelector('.btn-creer-rep');
  if (btnCreer) btnCreer.disabled = reps.length >= 3;
  const rafraichir = () => rafraichirRepresentantsRace(li, raceId);
  reps.forEach((rep) => liste.appendChild(creerElementRepresentant(rep, rafraichir)));
}

function afficherFormulaireModifRace(li, race) {
  li.innerHTML = `
    <form class="formulaire" style="width:100%">
      <input name="nom" type="text" value="${race.nom}" required />
      <input name="texte_hub" type="text" placeholder="Texte affiché sur le hub (laissez vide pour utiliser le nom)" value="${race.texte_hub || ''}" />
      <div class="element-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="bouton-secondaire btn-annuler">Annuler</button>
      </div>
    </form>
  `;
  li.querySelector('.btn-annuler').addEventListener('click', () => chargerRaces());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const resultat = await requeteJSON(`/api/races/${race.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: fd.get('nom'), texte_hub: fd.get('texte_hub') })
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

// --- Representants de race ---

function creerElementRepresentant(rep, rafraichir) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.style.flexDirection = 'column';
  li.style.alignItems = 'stretch';
  li.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
      <div class="element-infos" style="flex:1">
        ${rep.image_depart ? `<img src="${rep.image_depart}" alt="depart" />` : ''}
        ${rep.image_sourire ? `<img src="${rep.image_sourire}" alt="sourire" />` : ''}
        <div>
          <strong>Rang ${rep.rang} - ${rep.nom}</strong>
          <div>${rep.description || ''}</div>
        </div>
      </div>
      <div class="element-actions" style="flex-shrink:0">
        <button class="btn-modifier">Modifier</button>
        <button class="btn-supprimer bouton-danger">Supprimer</button>
      </div>
    </div>
    <div class="section-dialogues" style="margin-top:.75rem;border-top:1px solid rgba(255,255,255,.1);padding-top:.75rem">
      <p class="astuce" style="margin:0 0 .4rem">Dialogues — utilisez <code>{nom}</code> pour le prenom du joueur</p>
      <div class="dialogues-liste"></div>
      <form class="form-ajout-dialogue formulaire" style="margin-top:.5rem">
        <input name="contexte" type="text" placeholder="Contexte (ex: accueil, victoire)" required />
        <textarea name="texte" placeholder="Texte (ex: Bienvenue {nom} !)" required></textarea>
        <button type="submit" class="bouton-secondaire">+ Ajouter un dialogue</button>
      </form>
    </div>
  `;

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifRepresentant(li, rep, rafraichir));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm(`Supprimer le representant "${rep.nom}" ?`)) return;
    const resultat = await requeteJSON(`/api/representants/${rep.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await rafraichir();
  });

  li.querySelector('.form-ajout-dialogue').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    const resultat = await requeteJSON(`/api/representants/${rep.id}/dialogues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contexte: d.get('contexte'), texte: d.get('texte') })
    });
    afficherSync(resultat.synchronisation);
    e.target.reset();
    await rafraichirDialogues(li, rep.id);
  });

  rafraichirDialogues(li, rep.id);
  return li;
}

async function rafraichirDialogues(li, repId) {
  const dialogues = await requeteJSON(`/api/representants/${repId}/dialogues`);
  const conteneur = li.querySelector('.dialogues-liste');
  conteneur.innerHTML = '';

  if (dialogues.length === 0) {
    conteneur.innerHTML = '<p style="margin:0;opacity:.6;font-size:.875rem">Aucun dialogue.</p>';
    return;
  }

  dialogues.forEach((d) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;padding:.4rem 0;border-bottom:1px solid rgba(255,255,255,.07)';
    div.innerHTML = `
      <div style="flex:1">
        <strong style="font-size:.875rem">${d.contexte}</strong>
        <div style="font-size:.875rem;opacity:.8">${d.texte}</div>
      </div>
      <div class="element-actions" style="flex-shrink:0">
        <button class="btn-modifier-dialogue bouton-secondaire">Modifier</button>
        <button class="btn-supprimer-dialogue bouton-danger">Supprimer</button>
      </div>
    `;

    div.querySelector('.btn-modifier-dialogue').addEventListener('click', () => {
      div.innerHTML = `
        <form class="formulaire" style="width:100%">
          <input name="contexte" type="text" value="${d.contexte}" required />
          <textarea name="texte" required>${d.texte}</textarea>
          <div class="element-actions">
            <button type="submit">Enregistrer</button>
            <button type="button" class="btn-annuler bouton-secondaire">Annuler</button>
          </div>
        </form>
      `;
      div.querySelector('.btn-annuler').addEventListener('click', () => rafraichirDialogues(li, repId));
      div.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const resultat = await requeteJSON(`/api/dialogues/${d.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contexte: fd.get('contexte'), texte: fd.get('texte') })
        });
        afficherSync(resultat.synchronisation);
        await rafraichirDialogues(li, repId);
      });
    });

    div.querySelector('.btn-supprimer-dialogue').addEventListener('click', async () => {
      if (!confirm('Supprimer ce dialogue ?')) return;
      const resultat = await requeteJSON(`/api/dialogues/${d.id}`, { method: 'DELETE' });
      afficherSync(resultat.synchronisation);
      await rafraichirDialogues(li, repId);
    });

    conteneur.appendChild(div);
  });
}

function afficherFormulaireModifRepresentant(li, rep, rafraichir) {
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
  li.querySelector('.btn-annuler').addEventListener('click', () => rafraichir());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/representants/${rep.id}`, {
      method: 'PUT',
      body: new FormData(e.target)
    });
    afficherSync(resultat.synchronisation);
    await rafraichir();
  });
}

// --- Allegeances (avec representants integres inline) ---

async function chargerAllegeances() {
  allegeancesEnCache = await requeteJSON('/api/allegeances');

  const compteur = document.getElementById('compteur-allegeances');
  compteur.textContent = `(${allegeancesEnCache.length}/3)`;

  const btnSubmit = document.querySelector('#form-nouvelle-allegeance button[type=submit]');
  if (btnSubmit) btnSubmit.disabled = allegeancesEnCache.length >= 3;

  const liste = document.getElementById('liste-allegeances');
  liste.innerHTML = '';
  allegeancesEnCache.forEach((a) => liste.appendChild(creerElementAllegeance(a)));
}

function creerElementAllegeance(allegeance) {
  const li = document.createElement('li');
  li.className = 'element-carte';
  li.style.flexDirection = 'column';
  li.style.alignItems = 'stretch';
  li.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="element-infos">
        ${allegeance.portrait ? `<img src="${allegeance.portrait}" alt="portrait" style="width:48px;height:48px;object-fit:cover;border-radius:.25rem" />` : ''}
        <strong>${allegeance.nom}</strong>
      </div>
      <div class="element-actions">
        <button class="btn-modifier">Modifier</button>
        <button class="btn-supprimer bouton-danger">Supprimer</button>
      </div>
    </div>
    <div style="margin-top:.75rem;border-top:1px solid rgba(255,255,255,.1);padding-top:.75rem">
      <h4 style="margin:0 0 .4rem;font-size:.875rem">Fond de l'ecran des representants d'allegeance</h4>
      <form class="form-fond-allegeance formulaire-ligne" enctype="multipart/form-data">
        <input name="image" type="file" accept="image/png,image/jpeg" />
        <button type="submit">Enregistrer le fond</button>
        ${allegeance.image_fond ? '<button type="button" class="btn-supprimer-fond-allegeance bouton-danger">Supprimer</button>' : ''}
      </form>
    </div>
    <div class="section-representants" style="margin-top:.75rem;border-top:1px solid rgba(255,255,255,.1);padding-top:.75rem">
      <ul class="liste-reps-allegeance liste-elements" style="margin:0 0 .5rem"></ul>
      <form class="form-rep-allegeance formulaire" enctype="multipart/form-data">
        <h4 style="margin:0 0 .4rem;font-size:.875rem">Ajouter un representant (max. 3)</h4>
        <input name="nom" type="text" placeholder="Nom du representant" required />
        <textarea name="dialogue" placeholder="Texte de dialogue (utilisez {nom} pour le prenom du joueur)"></textarea>
        <label class="champ-fichier">Image de depart (PNG)<input name="image_depart" type="file" accept="image/png" required /></label>
        <label class="champ-fichier">Image de sourire (PNG)<input name="image_sourire" type="file" accept="image/png" required /></label>
        <button type="submit" class="btn-creer-rep-allegeance">Creer le representant</button>
      </form>
    </div>
  `;

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifAllegeance(li, allegeance));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm(`Supprimer l'allegeance "${allegeance.nom}" et tous ses representants ?`)) return;
    const resultat = await requeteJSON(`/api/allegeances/${allegeance.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });

  li.querySelector('.form-fond-allegeance').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fichier = e.target.querySelector('input[type="file"]').files[0];
    if (!fichier) return;
    const resultat = await requeteJSON(`/api/allegeances/${allegeance.id}/fond`, {
      method: 'PUT',
      body: new FormData(e.target)
    });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });

  const btnSupprimerFond = li.querySelector('.btn-supprimer-fond-allegeance');
  if (btnSupprimerFond) {
    btnSupprimerFond.addEventListener('click', async () => {
      if (!confirm("Supprimer le fond de cette allegeance ?")) return;
      const resultat = await requeteJSON(`/api/allegeances/${allegeance.id}/fond`, { method: 'DELETE' });
      afficherSync(resultat.synchronisation);
      await chargerTout();
    });
  }

  li.querySelector('.form-rep-allegeance').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/allegeances/${allegeance.id}/representants`, {
      method: 'POST',
      body: new FormData(e.target)
    });
    afficherSync(resultat.synchronisation);
    e.target.reset();
    await rafraichirRepresentantsAllegeance(li, allegeance.id);
  });

  rafraichirRepresentantsAllegeance(li, allegeance.id);
  return li;
}

async function rafraichirRepresentantsAllegeance(li, allegeanceId) {
  const reps = await requeteJSON(`/api/allegeances/${allegeanceId}/representants`);
  const liste = li.querySelector('.liste-reps-allegeance');
  liste.innerHTML = '';
  const btnCreer = li.querySelector('.btn-creer-rep-allegeance');
  if (btnCreer) btnCreer.disabled = reps.length >= 3;
  const rafraichir = () => rafraichirRepresentantsAllegeance(li, allegeanceId);
  reps.forEach((rep) => liste.appendChild(creerElementRepresentantAllegeance(rep, rafraichir)));
}

function creerElementRepresentantAllegeance(rep, rafraichir) {
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

  li.querySelector('.btn-modifier').addEventListener('click', () => afficherFormulaireModifRepresentantAllegeance(li, rep, rafraichir));
  li.querySelector('.btn-supprimer').addEventListener('click', async () => {
    if (!confirm(`Supprimer le representant "${rep.nom}" ?`)) return;
    const resultat = await requeteJSON(`/api/representants-allegeance/${rep.id}`, { method: 'DELETE' });
    afficherSync(resultat.synchronisation);
    await rafraichir();
  });

  return li;
}

function afficherFormulaireModifAllegeance(li, allegeance) {
  li.innerHTML = `
    <form class="formulaire" style="width:100%" enctype="multipart/form-data">
      <input name="nom" type="text" value="${allegeance.nom}" required />
      <input name="texte_hub" type="text" placeholder="Texte affiché sur le hub (laissez vide pour utiliser le nom)" value="${allegeance.texte_hub || ''}" />
      <label class="champ-fichier">Nouveau portrait (PNG ou JPG, optionnel)
        <input name="portrait" type="file" accept="image/png,image/jpeg" />
      </label>
      <div class="element-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" class="bouton-secondaire btn-annuler">Annuler</button>
      </div>
    </form>
  `;
  li.querySelector('.btn-annuler').addEventListener('click', () => chargerAllegeances());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/allegeances/${allegeance.id}`, {
      method: 'PUT',
      body: new FormData(e.target)
    });
    afficherSync(resultat.synchronisation);
    await chargerTout();
  });
}

function afficherFormulaireModifRepresentantAllegeance(li, rep, rafraichir) {
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
  li.querySelector('.btn-annuler').addEventListener('click', () => rafraichir());
  li.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultat = await requeteJSON(`/api/representants-allegeance/${rep.id}`, {
      method: 'PUT',
      body: new FormData(e.target)
    });
    afficherSync(resultat.synchronisation);
    await rafraichir();
  });
}

document.getElementById('form-nouvelle-allegeance').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultat = await requeteJSON('/api/allegeances', { method: 'POST', body: new FormData(e.target) });
  afficherSync(resultat.synchronisation);
  e.target.reset();
  await chargerTout();
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
    await chargerObjectifs();
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
  li.style.flexDirection = 'column';
  li.style.alignItems = 'stretch';
  li.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="element-infos">
        <img class="miniature-scenario" src="${image.image}" alt="scenario" />
        <div>Position ${image.ordre}</div>
      </div>
      <div class="element-actions">
        <button class="btn-monter"${index === 0 ? ' disabled' : ''}>Monter</button>
        <button class="btn-descendre"${index === total - 1 ? ' disabled' : ''}>Descendre</button>
        <button class="btn-supprimer bouton-danger">Supprimer</button>
      </div>
    </div>
    <div style="margin-top:.5rem;border-top:1px solid rgba(255,255,255,.1);padding-top:.5rem">
      <form class="form-texte-scenario formulaire-ligne">
        <input name="texte" type="text" placeholder="Texte sous l'image (optionnel)" value="${image.texte ? image.texte.replace(/"/g, '&quot;') : ''}" style="flex:1" />
        <button type="submit">Enregistrer</button>
      </form>
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
  li.querySelector('.form-texte-scenario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const texte = new FormData(e.target).get('texte');
    const resultat = await requeteJSON(`/api/scenario/${image.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texte })
    });
    afficherSync(resultat.synchronisation);
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
  document.getElementById('case-condition-allegeance').checked = parametres.condition_dernier_rep_allegeance;
  document.getElementById('texte-message-condition').value = parametres.message_condition_allegeance || '';
  document.getElementById('section-message-condition').classList.toggle('cachee', !parametres.condition_dernier_rep_allegeance);
}

async function envoyerParametre(cle, valeur) {
  const resultat = await requeteJSON('/api/admin/parametres', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [cle]: valeur })
  });
  afficherSync(resultat.synchronisation);
}

document.getElementById('case-tableau-de-bord').addEventListener('change', (e) => {
  envoyerParametre('tableau_de_bord_actif', e.target.checked);
});

document.getElementById('case-condition-allegeance').addEventListener('change', (e) => {
  document.getElementById('section-message-condition').classList.toggle('cachee', !e.target.checked);
  envoyerParametre('condition_dernier_rep_allegeance', e.target.checked);
});

document.getElementById('texte-message-condition').addEventListener('change', (e) => {
  envoyerParametre('message_condition_allegeance', e.target.value);
});

// --- Salle d'attente / lancement de partie ---

let intervalSuivi = null;
let intervalJoueursConfig = null;

async function chargerPartieActive() {
  const partie = await requeteJSON('/api/admin/partie-active');

  document.getElementById('partie-aucune').classList.toggle('cachee', partie.active);
  document.getElementById('partie-configuration').classList.toggle('cachee', !partie.active || partie.statut !== 'en_attente');
  const suiviVisible = partie.active && (partie.statut === 'en_cours' || partie.statut === 'terminee');
  document.getElementById('partie-suivi').classList.toggle('cachee', !suiviVisible);
  if (suiviVisible) {
    document.getElementById('btn-terminer-partie').classList.toggle('cachee', partie.statut !== 'en_cours');
    document.getElementById('btn-rouvrir-partie').classList.toggle('cachee', partie.statut !== 'terminee');
  }

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
      await chargerPartieActive();
      return;
    }
    afficherListeJoueursConfig(partie.joueurs);
    afficherProgressionLancement(partie);
  } catch (err) {
    // Rafraichissement silencieux en arriere-plan
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

// Config race : objectifs par rang + niveau par slot
function mettreAJourConfigRace(nb) {
  const conteneur = document.getElementById('config-obj-race');
  conteneur.innerHTML = '';
  for (let rang = 1; rang <= 3; rang++) {
    const actif = rang <= nb;
    const div = document.createElement('div');
    div.style.cssText = `opacity:${actif ? 1 : 0.4};margin-bottom:.6rem`;
    div.innerHTML = `
      <label>Rep ${rang} — objectifs :
        <input type="number" min="1" max="3" value="2"
               id="race-nb-obj-rang-${rang}" style="width:3.5rem" ${actif ? '' : 'disabled'} />
      </label>
      <div id="race-niveaux-rang-${rang}" style="margin-left:1rem;margin-top:.2rem;display:flex;gap:.5rem;flex-wrap:wrap"></div>
    `;
    conteneur.appendChild(div);

    if (actif) {
      const inputNb = div.querySelector(`#race-nb-obj-rang-${rang}`);
      const niveauxDiv = div.querySelector(`#race-niveaux-rang-${rang}`);

      const rafraichirNiveaux = () => {
        const n = parseInt(inputNb.value) || 0;
        niveauxDiv.innerHTML = '';
        for (let pos = 1; pos <= n; pos++) {
          const lbl = document.createElement('label');
          lbl.style.fontSize = '.85rem';
          lbl.innerHTML = `Slot ${pos} niv.: <input type="number" min="1" max="99" value="${rang}"
            id="race-niv-rang-${rang}-pos-${pos}" style="width:3.2rem" />`;
          niveauxDiv.appendChild(lbl);
        }
      };
      inputNb.addEventListener('input', rafraichirNiveaux);
      rafraichirNiveaux();
    }
  }
}

function lireConfigRace() {
  const objectifs = [];
  const niveaux = [];
  for (let rang = 1; rang <= 3; rang++) {
    const nbInput = document.getElementById(`race-nb-obj-rang-${rang}`);
    const nb = nbInput && !nbInput.disabled ? (parseInt(nbInput.value) || 2) : 2;
    objectifs.push(nb);
    const nvsRang = [];
    for (let pos = 1; pos <= nb; pos++) {
      const nvInput = document.getElementById(`race-niv-rang-${rang}-pos-${pos}`);
      nvsRang.push(nvInput ? (parseInt(nvInput.value) || null) : null);
    }
    niveaux.push(nvsRang);
  }
  return { objectifs, niveaux };
}

// Config allegeance : objectifs par rang + niveau par slot
function mettreAJourConfigAllegeance(nb) {
  const conteneur = document.getElementById('config-obj-allegeance');
  conteneur.innerHTML = '';
  for (let rang = 1; rang <= 3; rang++) {
    const actif = rang <= nb;
    const div = document.createElement('div');
    div.style.cssText = `opacity:${actif ? 1 : 0.4};margin-bottom:.6rem`;
    div.innerHTML = `
      <label>Rep ${rang} — objectifs :
        <input type="number" min="1" max="3" value="2"
               id="alleg-nb-obj-rang-${rang}" style="width:3.5rem" ${actif ? '' : 'disabled'} />
      </label>
      <div id="alleg-niveaux-rang-${rang}" style="margin-left:1rem;margin-top:.2rem;display:flex;gap:.5rem;flex-wrap:wrap"></div>
    `;
    conteneur.appendChild(div);

    if (actif) {
      const inputNb = div.querySelector(`#alleg-nb-obj-rang-${rang}`);
      const niveauxDiv = div.querySelector(`#alleg-niveaux-rang-${rang}`);

      const rafraichirNiveaux = () => {
        const n = parseInt(inputNb.value) || 0;
        niveauxDiv.innerHTML = '';
        for (let pos = 1; pos <= n; pos++) {
          const lbl = document.createElement('label');
          lbl.style.fontSize = '.85rem';
          lbl.innerHTML = `Slot ${pos} niv.: <input type="number" min="1" max="99" value="${rang}"
            id="alleg-niv-rang-${rang}-pos-${pos}" style="width:3.2rem" />`;
          niveauxDiv.appendChild(lbl);
        }
      };
      inputNb.addEventListener('input', rafraichirNiveaux);
      rafraichirNiveaux();
    }
  }
}

function lireConfigAllegeance() {
  const objectifs = [];
  const niveaux = [];
  for (let rang = 1; rang <= 3; rang++) {
    const nbInput = document.getElementById(`alleg-nb-obj-rang-${rang}`);
    const nb = nbInput && !nbInput.disabled ? (parseInt(nbInput.value) || 2) : 2;
    objectifs.push(nb);
    const nvsRang = [];
    for (let pos = 1; pos <= nb; pos++) {
      const nvInput = document.getElementById(`alleg-niv-rang-${rang}-pos-${pos}`);
      nvsRang.push(nvInput ? (parseInt(nvInput.value) || null) : null);
    }
    niveaux.push(nvsRang);
  }
  return { objectifs, niveaux };
}

document.getElementById('config-nb-rep-race').addEventListener('input', (e) => {
  mettreAJourConfigRace(parseInt(e.target.value) || 0);
});
document.getElementById('config-nb-rep-allegeance').addEventListener('input', (e) => {
  mettreAJourConfigAllegeance(parseInt(e.target.value) || 0);
});

mettreAJourConfigRace(parseInt(document.getElementById('config-nb-rep-race').value) || 2);
mettreAJourConfigAllegeance(parseInt(document.getElementById('config-nb-rep-allegeance').value) || 2);

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
  const nbRepAllegeance = parseInt(document.getElementById('config-nb-rep-allegeance').value) || 0;

  const erreurEl = document.getElementById('erreur-config-partie');
  if (nbRepRace === 0 && nbRepAllegeance === 0) {
    erreurEl.textContent = "Il faut au moins 1 representant actif (race ou allegeance).";
    erreurEl.classList.remove('cachee');
    return;
  }
  erreurEl.classList.add('cachee');

  const { objectifs: objsRace, niveaux: niveauxRace } = lireConfigRace();
  const configRace = JSON.stringify(objsRace);
  const configNiveauxRace = JSON.stringify(niveauxRace);
  const { objectifs: objsAlleg, niveaux: niveauxAlleg } = lireConfigAllegeance();
  const configAllegeance = JSON.stringify(objsAlleg);
  const configNiveauxAllegeance = JSON.stringify(niveauxAlleg);

  try {
    await requeteJSON('/api/admin/partie-active/creer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nb_joueurs_attendus: nbJoueurs,
        nb_representants_race: nbRepRace,
        nb_representants_allegeance: nbRepAllegeance,
        config_objectifs_race: configRace,
        config_niveaux_race: configNiveauxRace,
        config_objectifs_allegeance: configAllegeance,
        config_niveaux_allegeance: configNiveauxAllegeance
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

document.getElementById('btn-rouvrir-partie').addEventListener('click', async () => {
  if (!confirm('Rouvrir la partie ? Les joueurs pourront a nouveau valider des objectifs.')) return;
  await requeteJSON('/api/admin/partie-active/rouvrir', { method: 'POST' });
  await chargerPartieActive();
});

// --- Chargement global ---

async function chargerTout() {
  await chargerRaces();
  await chargerAllegeances();
  await chargerObjectifs();
  chargerFond();
  await chargerScenario();
  await chargerParametres();
  await chargerPartieActive();
}

vérifierSession();
