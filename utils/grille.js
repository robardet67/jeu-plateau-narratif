// Logique de progression : grille de race (par joueur) et grille d'allegeance (partagee
// entre tous les porteurs d'une meme allegeance dans la partie).
// Le rang N+1 se deverrouille quand tous les objectifs du rang N sont valides.
// Tous les objectifs demarrent 'ouvert' (aucun etat ferme).

async function obtenirParametre(db, cle) {
  const ligne = await db.get('SELECT valeur FROM parametres WHERE cle = ?', [cle]);
  return ligne ? ligne.valeur : null;
}

async function compterValide(db, joueurId) {
  const row = await db.get("SELECT COUNT(*) AS n FROM grille_objectifs WHERE joueur_id = ? AND statut = 'valide'", [joueurId]);
  return row.n;
}

async function lireConfigPartie(db, partieId) {
  const partie = await db.get('SELECT * FROM parties WHERE id = ?', [partieId]);
  if (!partie) return { nbRepRace: 3, configObj: [2, 2, 2] };
  let configObj;
  try { configObj = JSON.parse(partie.config_objectifs_race || '[2,2,2]'); } catch { configObj = [2, 2, 2]; }
  return { nbRepRace: partie.nb_representants_race ?? 3, configObj };
}

async function lireConfigPartieAllegeance(db, partieId) {
  const partie = await db.get('SELECT * FROM parties WHERE id = ?', [partieId]);
  if (!partie) return { nbRepAlleg: 2, configObjAlleg: [2, 2, 2] };
  let configObjAlleg;
  try { configObjAlleg = JSON.parse(partie.config_objectifs_allegeance || '[2,2,2]'); } catch { configObjAlleg = [2, 2, 2]; }
  return { nbRepAlleg: partie.nb_representants_allegeance ?? 2, configObjAlleg };
}

// ------ GRILLE DE RACE (par joueur) ------

async function estJoueurTermine(db, joueurId) {
  const joueur = await db.get('SELECT * FROM joueurs WHERE id = ?', [joueurId]);
  if (!joueur) return false;

  const { nbRepRace, configObj } = await lireConfigPartie(db, joueur.partie_id);
  const requisRace = configObj.slice(0, nbRepRace).reduce((s, n) => s + n, 0);
  if ((await compterValide(db, joueurId)) < requisRace) return false;

  const { nbRepAlleg, configObjAlleg } = await lireConfigPartieAllegeance(db, joueur.partie_id);
  const requisAlleg = configObjAlleg.slice(0, nbRepAlleg).reduce((s, n) => s + n, 0);

  const allegeanceIds = (await db.all('SELECT allegeance_id FROM joueur_allegeances WHERE joueur_id = ?', [joueurId]))
    .map((r) => r.allegeance_id);

  for (const allegeanceId of allegeanceIds) {
    const row = await db.get(
      "SELECT COUNT(*) AS n FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND statut = 'valide'",
      [allegeanceId, joueur.partie_id]
    );
    if (row.n < requisAlleg) return false;
  }

  return true;
}

async function assurerLigneGrille(db, joueurId, partieId, rang, position, statutParDefaut) {
  const existante = await db.get(
    'SELECT * FROM grille_objectifs WHERE joueur_id = ? AND rang = ? AND position = ?',
    [joueurId, rang, position]
  );

  if (existante) {
    if (existante.statut === 'masque' && statutParDefaut !== 'masque') {
      await db.run('UPDATE grille_objectifs SET statut = ? WHERE id = ?', [statutParDefaut, existante.id]);
      return { ...existante, statut: statutParDefaut };
    }
    return existante;
  }

  const dejaUtilises = (await db.all('SELECT objectif_id FROM grille_objectifs WHERE partie_id = ?', [partieId]))
    .map((r) => r.objectif_id);
  const exclusion = dejaUtilises.length ? dejaUtilises : [0];
  const placeholders = exclusion.map(() => '?').join(',');

  let objectif = await db.get(
    `SELECT * FROM objectifs WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`,
    exclusion
  );
  if (!objectif) objectif = await db.get('SELECT * FROM objectifs ORDER BY RANDOM() LIMIT 1');
  if (!objectif) return null;

  const r = await db.run(
    'INSERT INTO grille_objectifs (joueur_id, partie_id, rang, position, objectif_id, statut) VALUES (?, ?, ?, ?, ?, ?)',
    [joueurId, partieId, rang, position, objectif.id, statutParDefaut]
  );

  return db.get('SELECT * FROM grille_objectifs WHERE id = ?', [r.lastInsertRowid]);
}

async function deverrouillerRang(db, joueurId, partieId, rang) {
  const { configObj } = await lireConfigPartie(db, partieId);
  const nbPositions = configObj[rang - 1] ?? 2;
  for (let pos = 1; pos <= nbPositions; pos++) {
    await assurerLigneGrille(db, joueurId, partieId, rang, pos, 'ouvert');
  }
}

async function verifierDeverrouillages(db, joueurId, partieId) {
  const { nbRepRace, configObj } = await lireConfigPartie(db, partieId);
  for (let rang = 1; rang <= nbRepRace - 1; rang++) {
    const nbPositions = configObj[rang - 1] ?? 2;
    const row = await db.get(
      "SELECT COUNT(*) AS n FROM grille_objectifs WHERE joueur_id = ? AND rang = ? AND statut = 'valide'",
      [joueurId, rang]
    );
    if (row.n >= nbPositions) {
      await deverrouillerRang(db, joueurId, partieId, rang + 1);
    }
  }
}

async function validerObjectif(db, { joueurId, ligneId }) {
  const ligne = await db.get('SELECT * FROM grille_objectifs WHERE id = ? AND joueur_id = ?', [ligneId, joueurId]);
  if (!ligne) throw new Error('Case de grille introuvable');
  if (ligne.statut !== 'ouvert') throw new Error('Cet objectif doit etre ouvert pour etre valide');

  await db.run(
    "UPDATE grille_objectifs SET statut = 'valide', completed_at = datetime('now') WHERE id = ?",
    [ligne.id]
  );

  return { ligne, partieTerminee: await estJoueurTermine(db, joueurId), partieId: ligne.partie_id };
}

// ------ GRILLE D'ALLEGEANCE (partagee entre porteurs) ------

async function deverrouillerRangAllegeance(db, allegeanceId, partieId, rang) {
  const { configObjAlleg } = await lireConfigPartieAllegeance(db, partieId);
  const nbPositions = configObjAlleg[rang - 1] ?? 2;
  for (let pos = 1; pos <= nbPositions; pos++) {
    const existante = await db.get(
      'SELECT * FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND rang = ? AND position = ?',
      [allegeanceId, partieId, rang, pos]
    );
    if (existante && existante.statut === 'masque') {
      await db.run("UPDATE grille_allegeance SET statut = 'ouvert' WHERE id = ?", [existante.id]);
    }
  }
}

async function verifierDeverrouillagesAllegeance(db, allegeanceId, partieId) {
  const { nbRepAlleg, configObjAlleg } = await lireConfigPartieAllegeance(db, partieId);
  for (let rang = 1; rang <= nbRepAlleg - 1; rang++) {
    const nbPositions = configObjAlleg[rang - 1] ?? 2;
    const row = await db.get(
      "SELECT COUNT(*) AS n FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND rang = ? AND statut = 'valide'",
      [allegeanceId, partieId, rang]
    );
    if (row.n >= nbPositions) {
      await deverrouillerRangAllegeance(db, allegeanceId, partieId, rang + 1);
    }
  }
}

async function validerObjectifAllegeance(db, { allegeanceId, partieId, ligneId, joueurId }) {
  const ligne = await db.get(
    'SELECT * FROM grille_allegeance WHERE id = ? AND allegeance_id = ? AND partie_id = ?',
    [ligneId, allegeanceId, partieId]
  );
  if (!ligne) throw new Error('Case de grille allegeance introuvable');
  if (ligne.statut !== 'ouvert') throw new Error('Cet objectif doit etre ouvert pour etre valide');

  await db.run(
    "UPDATE grille_allegeance SET statut = 'valide', completed_at = datetime('now'), completed_by_joueur_id = ? WHERE id = ?",
    [joueurId, ligne.id]
  );

  return { ligne };
}

async function obtenirEtatAllegeance(db, allegeanceId, partieId) {
  const allegeance = await db.get('SELECT * FROM allegeances WHERE id = ?', [allegeanceId]);
  if (!allegeance) return null;

  const { nbRepAlleg, configObjAlleg } = await lireConfigPartieAllegeance(db, partieId);

  const rangsDebloquesRows = await db.all(
    "SELECT DISTINCT rang FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND statut != 'masque'",
    [allegeanceId, partieId]
  );
  const rangsDebloquesSet = new Set(rangsDebloquesRows.map((r) => r.rang));

  const rangs = [];
  for (let idx = 0; idx < nbRepAlleg; idx++) {
    const rang = idx + 1;
    const nbPositions = configObjAlleg[idx] ?? 2;
    const deverrouille = rangsDebloquesSet.has(rang);

    if (!deverrouille) {
      const representantBloque = await db.get(
        'SELECT id, nom, image_depart, image_sourire FROM representants_allegeance WHERE allegeance_id = ? AND rang = ?',
        [allegeanceId, rang]
      );
      rangs.push({ rang, deverrouille: false, representant: representantBloque || null, cases: [], toutesLesCasesValidees: false });
      continue;
    }

    const representant = await db.get(
      'SELECT * FROM representants_allegeance WHERE allegeance_id = ? AND rang = ?',
      [allegeanceId, rang]
    );
    const lignes = await db.all(
      'SELECT * FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND rang = ?',
      [allegeanceId, partieId, rang]
    );

    const cases = [];
    for (let posIdx = 0; posIdx < nbPositions; posIdx++) {
      const position = posIdx + 1;
      const ligne = lignes.find((l) => l.position === position);
      if (!ligne || ligne.statut === 'masque') {
        cases.push({ id: ligne ? ligne.id : null, position, statut: 'masque', objectif: null });
        continue;
      }
      const objectif = await db.get('SELECT * FROM objectifs WHERE id = ?', [ligne.objectif_id]);
      cases.push({ id: ligne.id, position, statut: ligne.statut, objectif });
    }

    rangs.push({
      rang,
      deverrouille: true,
      representant: representant || null,
      cases,
      toutesLesCasesValidees: cases.length > 0 && cases.every((c) => c.statut === 'valide'),
    });
  }

  const requis = configObjAlleg.slice(0, nbRepAlleg).reduce((s, n) => s + n, 0);
  const rowTotal = await db.get(
    "SELECT COUNT(*) AS n FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND statut = 'valide'",
    [allegeanceId, partieId]
  );

  return {
    allegeanceId,
    totalValide: rowTotal.n,
    toutesValidees: requis === 0 || rowTotal.n >= requis,
    rangs,
  };
}

// ------ ETAT JOUEUR COMPLET (race + allegeances) ------

async function obtenirEtatJoueur(db, joueurId) {
  const joueur = await db.get('SELECT * FROM joueurs WHERE id = ?', [joueurId]);
  if (!joueur) return null;

  const race = joueur.race_id ? await db.get('SELECT * FROM races WHERE id = ?', [joueur.race_id]) : null;
  const partie = joueur.partie_id ? await db.get('SELECT * FROM parties WHERE id = ?', [joueur.partie_id]) : null;

  let configObj, nbRepRace;
  try { configObj = JSON.parse(partie?.config_objectifs_race || '[2,2,2]'); } catch { configObj = [2, 2, 2]; }
  nbRepRace = partie?.nb_representants_race ?? 3;

  let configObjAlleg, nbRepAlleg;
  try { configObjAlleg = JSON.parse(partie?.config_objectifs_allegeance || '[2,2,2]'); } catch { configObjAlleg = [2, 2, 2]; }
  nbRepAlleg = partie?.nb_representants_allegeance ?? 2;

  const total = await compterValide(db, joueurId);

  const rangsDebloquesRows = await db.all(
    "SELECT DISTINCT rang FROM grille_objectifs WHERE joueur_id = ? AND statut != 'masque'",
    [joueurId]
  );
  const rangsDebloquesSet = new Set(rangsDebloquesRows.map((r) => r.rang));

  const conditionActive = (await obtenirParametre(db, 'condition_dernier_rep_allegeance')) === 'true';
  const messageCondition =
    (await obtenirParametre(db, 'message_condition_allegeance')) ||
    "Terminez l'ensemble de vos quetes d'allegeance pour debloquer l'acces a ce personnage.";

  const rangs = [];
  for (let idx = 0; idx < nbRepRace; idx++) {
    const rang = idx + 1;
    const nbPositions = configObj[idx] ?? 2;
    let deverrouille = rangsDebloquesSet.has(rang) && !!race;
    let bloqueParConditionAllegeance = false;

    if (deverrouille && conditionActive && rang === nbRepRace && joueur.partie_id) {
      const allegeancesJoueur = await db.all('SELECT allegeance_id FROM joueur_allegeances WHERE joueur_id = ?', [joueurId]);
      if (allegeancesJoueur.length > 0) {
        let toutesValides = true;
        for (const ja of allegeancesJoueur) {
          const etatAlleg = await obtenirEtatAllegeance(db, ja.allegeance_id, joueur.partie_id);
          if (!etatAlleg || etatAlleg.rangs.length === 0) continue;
          if (!etatAlleg.rangs.every((r) => r.toutesLesCasesValidees)) {
            toutesValides = false;
            break;
          }
        }
        if (!toutesValides) {
          deverrouille = false;
          bloqueParConditionAllegeance = true;
        }
      }
    }

    if (!deverrouille) {
      const representantBloque = race
        ? await db.get('SELECT id, nom, image_depart, image_sourire FROM representants WHERE race_id = ? AND rang = ?', [race.id, rang])
        : null;
      rangs.push({ rang, deverrouille: false, bloqueParConditionAllegeance, representant: representantBloque || null, cases: [], toutesLesCasesValidees: false });
      continue;
    }

    const representant = race
      ? await db.get('SELECT * FROM representants WHERE race_id = ? AND rang = ?', [race.id, rang])
      : null;

    const lignes = await db.all('SELECT * FROM grille_objectifs WHERE joueur_id = ? AND rang = ?', [joueurId, rang]);

    const cases = [];
    for (let posIdx = 0; posIdx < nbPositions; posIdx++) {
      const position = posIdx + 1;
      const ligne = lignes.find((l) => l.position === position);
      if (!ligne || ligne.statut === 'masque') {
        cases.push({ id: ligne ? ligne.id : null, position, statut: 'masque', objectif: null });
        continue;
      }
      const objectif = await db.get('SELECT * FROM objectifs WHERE id = ?', [ligne.objectif_id]);
      cases.push({ id: ligne.id, position, statut: ligne.statut, objectif });
    }

    let dialogues = [];
    if (representant) {
      const rows = await db.all('SELECT * FROM dialogues WHERE representant_id = ?', [representant.id]);
      dialogues = rows.map((d) => ({ ...d, texte: d.texte.replaceAll('{nom}', joueur.pseudo) }));
    }

    rangs.push({
      rang,
      deverrouille: true,
      representant: representant ? { ...representant, dialogues } : null,
      cases,
      toutesLesCasesValidees: cases.length > 0 && cases.every((c) => c.statut === 'valide'),
    });
  }

  const allegeancesBase = await db.all(
    'SELECT a.id, a.nom, a.portrait, a.texte_hub, a.image_fond FROM joueur_allegeances ja JOIN allegeances a ON a.id = ja.allegeance_id WHERE ja.joueur_id = ?',
    [joueurId]
  );

  const allegeances = [];
  if (joueur.partie_id) {
    for (const a of allegeancesBase) {
      const etat = await obtenirEtatAllegeance(db, a.id, joueur.partie_id);
      allegeances.push({ id: a.id, nom: a.nom, portrait: a.portrait, texte_hub: a.texte_hub || null, image_fond: a.image_fond || null, ...(etat || {}) });
    }
  } else {
    allegeances.push(...allegeancesBase);
  }

  return {
    joueurId,
    partieId: joueur.partie_id,
    pseudo: joueur.pseudo,
    raceId: race ? race.id : null,
    raceNom: race ? race.nom : null,
    imageFond: race ? race.image_fond : null,
    imagePortraitRace: race ? (race.image_portrait || null) : null,
    texteHubRace: race ? (race.texte_hub || null) : null,
    totalValide: total,
    partieTerminee: await estJoueurTermine(db, joueurId),
    config: { nbRepRace, configObjectifs: configObj, nbRepAlleg, configObjectifsAlleg: configObjAlleg },
    messageConditionAllegeance: messageCondition,
    allegeances,
    rangs,
  };
}

async function calculerClassement(db, partieId) {
  const joueurs = await db.all('SELECT id, pseudo FROM joueurs WHERE partie_id = ?', [partieId]);
  if (!joueurs.length) return [];

  const quetesRaceRows = await db.all(
    `SELECT joueur_id, rang FROM grille_objectifs WHERE partie_id = ?
     GROUP BY joueur_id, rang
     HAVING COUNT(*) > 0 AND COUNT(*) = SUM(CASE WHEN statut = 'valide' THEN 1 ELSE 0 END)`,
    [partieId]
  );
  const quetesRaceParJoueur = {};
  for (const r of quetesRaceRows) {
    quetesRaceParJoueur[r.joueur_id] = (quetesRaceParJoueur[r.joueur_id] || 0) + 1;
  }

  const quetesAllegRows = await db.all(
    `SELECT allegeance_id, rang FROM grille_allegeance WHERE partie_id = ?
     GROUP BY allegeance_id, rang
     HAVING COUNT(*) > 0 AND COUNT(*) = SUM(CASE WHEN statut = 'valide' THEN 1 ELSE 0 END)`,
    [partieId]
  );
  const quetesAllegParAllegeance = {};
  for (const r of quetesAllegRows) {
    quetesAllegParAllegeance[r.allegeance_id] = (quetesAllegParAllegeance[r.allegeance_id] || 0) + 1;
  }

  const joueurIds = joueurs.map((j) => j.id);
  const allegeancesRows = joueurIds.length
    ? await db.all(
        `SELECT joueur_id, allegeance_id FROM joueur_allegeances WHERE joueur_id IN (${joueurIds.map(() => '?').join(',')})`,
        joueurIds
      )
    : [];
  const allegeancesParJoueur = {};
  for (const r of allegeancesRows) {
    if (!allegeancesParJoueur[r.joueur_id]) allegeancesParJoueur[r.joueur_id] = [];
    allegeancesParJoueur[r.joueur_id].push(r.allegeance_id);
  }

  const raceValidesRows = await db.all(
    `SELECT joueur_id, COUNT(*) AS n FROM grille_objectifs WHERE partie_id = ? AND statut = 'valide' GROUP BY joueur_id`,
    [partieId]
  );
  const raceValidesParJoueur = {};
  for (const r of raceValidesRows) raceValidesParJoueur[r.joueur_id] = r.n;

  const allegValidesRows = await db.all(
    `SELECT allegeance_id, COUNT(*) AS n FROM grille_allegeance WHERE partie_id = ? AND statut = 'valide' GROUP BY allegeance_id`,
    [partieId]
  );
  const allegValidesParAllegeance = {};
  for (const r of allegValidesRows) allegValidesParAllegeance[r.allegeance_id] = r.n;

  const scores = joueurs.map((j) => {
    const allegeances = allegeancesParJoueur[j.id] || [];
    const quetes =
      (quetesRaceParJoueur[j.id] || 0) +
      allegeances.reduce((s, aId) => s + (quetesAllegParAllegeance[aId] || 0), 0);
    const valides =
      (raceValidesParJoueur[j.id] || 0) +
      allegeances.reduce((s, aId) => s + (allegValidesParAllegeance[aId] || 0), 0);
    return { id: j.id, pseudo: j.pseudo, quetes, valides };
  });

  scores.sort((a, b) => b.quetes - a.quetes || b.valides - a.valides);

  let rang = 1;
  for (let i = 0; i < scores.length; i++) {
    if (i > 0 && (scores[i].quetes !== scores[i - 1].quetes || scores[i].valides !== scores[i - 1].valides)) {
      rang = i + 1;
    }
    scores[i].rang = rang;
  }

  return scores;
}

module.exports = {
  obtenirParametre,
  compterValide,
  estJoueurTermine,
  assurerLigneGrille,
  deverrouillerRang,
  verifierDeverrouillages,
  validerObjectif,
  deverrouillerRangAllegeance,
  verifierDeverrouillagesAllegeance,
  validerObjectifAllegeance,
  obtenirEtatAllegeance,
  obtenirEtatJoueur,
  calculerClassement,
};
