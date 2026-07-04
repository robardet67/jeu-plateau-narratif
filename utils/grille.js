// Logique de progression : grille de race (par joueur) et grille d'allegeance (partagee
// entre tous les porteurs d'une meme allegeance dans la partie).
// Le rang N+1 se deverrouille quand tous les objectifs du rang N sont valides.
// Tous les objectifs demarrent 'ouvert' (aucun etat ferme).

function obtenirParametre(db, cle) {
  const ligne = db.prepare('SELECT valeur FROM parametres WHERE cle = ?').get(cle);
  return ligne ? ligne.valeur : null;
}

function compterValide(db, joueurId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM grille_objectifs WHERE joueur_id = ? AND statut = 'valide'")
    .get(joueurId).n;
}

function lireConfigPartie(db, partieId) {
  const partie = db.prepare('SELECT * FROM parties WHERE id = ?').get(partieId);
  if (!partie) return { nbRepRace: 3, configObj: [2, 2, 2] };
  let configObj;
  try { configObj = JSON.parse(partie.config_objectifs_race || '[2,2,2]'); } catch { configObj = [2, 2, 2]; }
  return { nbRepRace: partie.nb_representants_race ?? 3, configObj };
}

function lireConfigPartieAllegeance(db, partieId) {
  const partie = db.prepare('SELECT * FROM parties WHERE id = ?').get(partieId);
  if (!partie) return { nbRepAlleg: 2, configObjAlleg: [2, 2, 2] };
  let configObjAlleg;
  try { configObjAlleg = JSON.parse(partie.config_objectifs_allegeance || '[2,2,2]'); } catch { configObjAlleg = [2, 2, 2]; }
  return { nbRepAlleg: partie.nb_representants_allegeance ?? 2, configObjAlleg };
}

// ------ GRILLE DE RACE (par joueur) ------

function estJoueurTermine(db, joueurId) {
  const joueur = db.prepare('SELECT * FROM joueurs WHERE id = ?').get(joueurId);
  if (!joueur) return false;

  // Condition 1 : tous les objectifs de race valides par ce joueur
  const { nbRepRace, configObj } = lireConfigPartie(db, joueur.partie_id);
  const requisRace = configObj.slice(0, nbRepRace).reduce((s, n) => s + n, 0);
  if (compterValide(db, joueurId) < requisRace) return false;

  // Condition 2 : toutes les allegeances du joueur completement validees (peu importe qui a valide)
  const { nbRepAlleg, configObjAlleg } = lireConfigPartieAllegeance(db, joueur.partie_id);
  const requisAlleg = configObjAlleg.slice(0, nbRepAlleg).reduce((s, n) => s + n, 0);

  const allegeanceIds = db
    .prepare('SELECT allegeance_id FROM joueur_allegeances WHERE joueur_id = ?')
    .all(joueurId)
    .map((r) => r.allegeance_id);

  for (const allegeanceId of allegeanceIds) {
    const { n: valideAlleg } = db
      .prepare(
        "SELECT COUNT(*) AS n FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND statut = 'valide'"
      )
      .get(allegeanceId, joueur.partie_id);
    if (valideAlleg < requisAlleg) return false;
  }

  return true;
}

function assurerLigneGrille(db, joueurId, partieId, rang, position, statutParDefaut) {
  const existante = db
    .prepare('SELECT * FROM grille_objectifs WHERE joueur_id = ? AND rang = ? AND position = ?')
    .get(joueurId, rang, position);

  if (existante) {
    if (existante.statut === 'masque' && statutParDefaut !== 'masque') {
      db.prepare('UPDATE grille_objectifs SET statut = ? WHERE id = ?').run(statutParDefaut, existante.id);
      return { ...existante, statut: statutParDefaut };
    }
    return existante;
  }

  const dejaUtilises = db
    .prepare('SELECT objectif_id FROM grille_objectifs WHERE partie_id = ?')
    .all(partieId)
    .map((r) => r.objectif_id);
  const exclusion = dejaUtilises.length ? dejaUtilises : [0];
  const placeholders = exclusion.map(() => '?').join(',');
  const objectif =
    db
      .prepare(`SELECT * FROM objectifs WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`)
      .get(...exclusion) || db.prepare('SELECT * FROM objectifs ORDER BY RANDOM() LIMIT 1').get();
  if (!objectif) return null;

  const resultat = db
    .prepare(
      'INSERT INTO grille_objectifs (joueur_id, partie_id, rang, position, objectif_id, statut) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(joueurId, partieId, rang, position, objectif.id, statutParDefaut);

  return db.prepare('SELECT * FROM grille_objectifs WHERE id = ?').get(resultat.lastInsertRowid);
}

function deverrouillerRang(db, joueurId, partieId, rang) {
  const { configObj } = lireConfigPartie(db, partieId);
  const nbPositions = configObj[rang - 1] ?? 2;
  for (let pos = 1; pos <= nbPositions; pos++) {
    assurerLigneGrille(db, joueurId, partieId, rang, pos, 'ouvert');
  }
}

function verifierDeverrouillages(db, joueurId, partieId) {
  const { nbRepRace, configObj } = lireConfigPartie(db, partieId);
  for (let rang = 1; rang <= nbRepRace - 1; rang++) {
    const nbPositions = configObj[rang - 1] ?? 2;
    const { n: valides } = db
      .prepare("SELECT COUNT(*) AS n FROM grille_objectifs WHERE joueur_id = ? AND rang = ? AND statut = 'valide'")
      .get(joueurId, rang);
    if (valides >= nbPositions) {
      deverrouillerRang(db, joueurId, partieId, rang + 1);
    }
  }
}

function validerObjectif(db, { joueurId, ligneId }) {
  const ligne = db.prepare('SELECT * FROM grille_objectifs WHERE id = ? AND joueur_id = ?').get(ligneId, joueurId);
  if (!ligne) throw new Error('Case de grille introuvable');
  if (ligne.statut !== 'ouvert') throw new Error("Cet objectif doit etre ouvert pour etre valide");

  db.prepare("UPDATE grille_objectifs SET statut = 'valide', completed_at = datetime('now') WHERE id = ?").run(ligne.id);

  return { ligne, partieTerminee: estJoueurTermine(db, joueurId), partieId: ligne.partie_id };
}

// ------ GRILLE D'ALLEGEANCE (partagee entre porteurs) ------

function deverrouillerRangAllegeance(db, allegeanceId, partieId, rang) {
  const { configObjAlleg } = lireConfigPartieAllegeance(db, partieId);
  const nbPositions = configObjAlleg[rang - 1] ?? 2;
  for (let pos = 1; pos <= nbPositions; pos++) {
    const existante = db
      .prepare(
        'SELECT * FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND rang = ? AND position = ?'
      )
      .get(allegeanceId, partieId, rang, pos);
    if (existante && existante.statut === 'masque') {
      db.prepare("UPDATE grille_allegeance SET statut = 'ouvert' WHERE id = ?").run(existante.id);
    }
  }
}

function verifierDeverrouillagesAllegeance(db, allegeanceId, partieId) {
  const { nbRepAlleg, configObjAlleg } = lireConfigPartieAllegeance(db, partieId);
  for (let rang = 1; rang <= nbRepAlleg - 1; rang++) {
    const nbPositions = configObjAlleg[rang - 1] ?? 2;
    const { n: valides } = db
      .prepare(
        "SELECT COUNT(*) AS n FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND rang = ? AND statut = 'valide'"
      )
      .get(allegeanceId, partieId, rang);
    if (valides >= nbPositions) {
      deverrouillerRangAllegeance(db, allegeanceId, partieId, rang + 1);
    }
  }
}

function validerObjectifAllegeance(db, { allegeanceId, partieId, ligneId, joueurId }) {
  const ligne = db
    .prepare('SELECT * FROM grille_allegeance WHERE id = ? AND allegeance_id = ? AND partie_id = ?')
    .get(ligneId, allegeanceId, partieId);
  if (!ligne) throw new Error("Case de grille allegeance introuvable");
  if (ligne.statut !== 'ouvert') throw new Error("Cet objectif doit etre ouvert pour etre valide");

  db.prepare(
    "UPDATE grille_allegeance SET statut = 'valide', completed_at = datetime('now'), completed_by_joueur_id = ? WHERE id = ?"
  ).run(joueurId, ligne.id);

  return { ligne };
}

function obtenirEtatAllegeance(db, allegeanceId, partieId) {
  const allegeance = db.prepare('SELECT * FROM allegeances WHERE id = ?').get(allegeanceId);
  if (!allegeance) return null;

  const { nbRepAlleg, configObjAlleg } = lireConfigPartieAllegeance(db, partieId);

  const rangsDebloquesSet = new Set(
    db
      .prepare(
        "SELECT DISTINCT rang FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND statut != 'masque'"
      )
      .all(allegeanceId, partieId)
      .map((r) => r.rang)
  );

  const rangs = Array.from({ length: nbRepAlleg }, (_, idx) => {
    const rang = idx + 1;
    const nbPositions = configObjAlleg[idx] ?? 2;
    const deverrouille = rangsDebloquesSet.has(rang);

    if (!deverrouille) {
      return { rang, deverrouille: false, representant: null, cases: [], toutesLesCasesValidees: false };
    }

    const representant = db
      .prepare('SELECT * FROM representants_allegeance WHERE allegeance_id = ? AND rang = ?')
      .get(allegeanceId, rang);

    const lignes = db
      .prepare('SELECT * FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND rang = ?')
      .all(allegeanceId, partieId, rang);

    const cases = Array.from({ length: nbPositions }, (_, posIdx) => {
      const position = posIdx + 1;
      const ligne = lignes.find((l) => l.position === position);
      if (!ligne || ligne.statut === 'masque') {
        return { id: ligne ? ligne.id : null, position, statut: 'masque', objectif: null };
      }
      const objectif = db.prepare('SELECT * FROM objectifs WHERE id = ?').get(ligne.objectif_id);
      return { id: ligne.id, position, statut: ligne.statut, objectif };
    });

    return {
      rang,
      deverrouille: true,
      representant: representant || null,
      cases,
      toutesLesCasesValidees: cases.length > 0 && cases.every((c) => c.statut === 'valide')
    };
  });

  const requis = configObjAlleg.slice(0, nbRepAlleg).reduce((s, n) => s + n, 0);
  const { n: totalValide } = db
    .prepare(
      "SELECT COUNT(*) AS n FROM grille_allegeance WHERE allegeance_id = ? AND partie_id = ? AND statut = 'valide'"
    )
    .get(allegeanceId, partieId);

  return {
    allegeanceId,
    totalValide,
    toutesValidees: requis === 0 || totalValide >= requis,
    rangs
  };
}

// ------ ETAT JOUEUR COMPLET (race + allegeances) ------

function obtenirEtatJoueur(db, joueurId) {
  const joueur = db.prepare('SELECT * FROM joueurs WHERE id = ?').get(joueurId);
  if (!joueur) return null;

  const race = joueur.race_id ? db.prepare('SELECT * FROM races WHERE id = ?').get(joueur.race_id) : null;
  const partie = joueur.partie_id ? db.prepare('SELECT * FROM parties WHERE id = ?').get(joueur.partie_id) : null;

  let configObj, nbRepRace;
  try { configObj = JSON.parse(partie?.config_objectifs_race || '[2,2,2]'); } catch { configObj = [2, 2, 2]; }
  nbRepRace = partie?.nb_representants_race ?? 3;

  let configObjAlleg, nbRepAlleg;
  try { configObjAlleg = JSON.parse(partie?.config_objectifs_allegeance || '[2,2,2]'); } catch { configObjAlleg = [2, 2, 2]; }
  nbRepAlleg = partie?.nb_representants_allegeance ?? 2;

  const total = compterValide(db, joueurId);

  const rangsDebloquesSet = new Set(
    db
      .prepare("SELECT DISTINCT rang FROM grille_objectifs WHERE joueur_id = ? AND statut != 'masque'")
      .all(joueurId)
      .map((r) => r.rang)
  );

  const rangs = Array.from({ length: nbRepRace }, (_, idx) => {
    const rang = idx + 1;
    const nbPositions = configObj[idx] ?? 2;
    const deverrouille = rangsDebloquesSet.has(rang) && !!race;

    if (!deverrouille) {
      return { rang, deverrouille: false, representant: null, cases: [], toutesLesCasesValidees: false };
    }

    const representant = race
      ? db.prepare('SELECT * FROM representants WHERE race_id = ? AND rang = ?').get(race.id, rang)
      : null;

    const lignes = db
      .prepare('SELECT * FROM grille_objectifs WHERE joueur_id = ? AND rang = ?')
      .all(joueurId, rang);

    const cases = Array.from({ length: nbPositions }, (_, posIdx) => {
      const position = posIdx + 1;
      const ligne = lignes.find((l) => l.position === position);
      if (!ligne || ligne.statut === 'masque') {
        return { id: ligne ? ligne.id : null, position, statut: 'masque', objectif: null };
      }
      const objectif = db.prepare('SELECT * FROM objectifs WHERE id = ?').get(ligne.objectif_id);
      return { id: ligne.id, position, statut: ligne.statut, objectif };
    });

    let dialogues = [];
    if (representant) {
      dialogues = db
        .prepare('SELECT * FROM dialogues WHERE representant_id = ?')
        .all(representant.id)
        .map((d) => ({ ...d, texte: d.texte.replaceAll('{nom}', joueur.pseudo) }));
    }

    return {
      rang,
      deverrouille: true,
      representant: representant ? { ...representant, dialogues } : null,
      cases,
      toutesLesCasesValidees: cases.length > 0 && cases.every((c) => c.statut === 'valide')
    };
  });

  // Allegeances du joueur avec leur etat de grille
  const allegeancesBase = db
    .prepare(
      'SELECT a.id, a.nom, a.portrait FROM joueur_allegeances ja JOIN allegeances a ON a.id = ja.allegeance_id WHERE ja.joueur_id = ?'
    )
    .all(joueurId);

  const allegeances = joueur.partie_id
    ? allegeancesBase.map((a) => {
        const etat = obtenirEtatAllegeance(db, a.id, joueur.partie_id);
        return { id: a.id, nom: a.nom, portrait: a.portrait, ...(etat || {}) };
      })
    : allegeancesBase;

  return {
    joueurId,
    partieId: joueur.partie_id,
    pseudo: joueur.pseudo,
    raceId: race ? race.id : null,
    raceNom: race ? race.nom : null,
    imageFond: race ? race.image_fond : null,
    totalValide: total,
    partieTerminee: estJoueurTermine(db, joueurId),
    config: { nbRepRace, configObjectifs: configObj, nbRepAlleg, configObjectifsAlleg: configObjAlleg },
    allegeances,
    rangs
  };
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
  obtenirEtatJoueur
};
