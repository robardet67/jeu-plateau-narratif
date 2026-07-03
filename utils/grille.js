// Logique de la grille de progression d'un joueur.
// Chaque rang correspond a un representant de race. Le nombre de positions par rang
// est variable (config_objectifs_race de la partie). Tous les objectifs demarrent
// 'ouvert' (pas de ferme) ; le rang N+1 se deverrouille quand le rang N est complete.

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

function estJoueurTermine(db, joueurId) {
  const joueur = db.prepare('SELECT partie_id FROM joueurs WHERE id = ?').get(joueurId);
  if (!joueur) return false;
  const { nbRepRace, configObj } = lireConfigPartie(db, joueur.partie_id);
  const requis = configObj.slice(0, nbRepRace).reduce((s, n) => s + n, 0);
  return compterValide(db, joueurId) >= requis;
}

// Met a jour le statut d'une case existante (masque->ouvert) ou la cree a la volee si absente.
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

// Ouvre toutes les cases d'un rang (nombre variable selon config).
function deverrouillerRang(db, joueurId, partieId, rang) {
  const { configObj } = lireConfigPartie(db, partieId);
  const nbPositions = configObj[rang - 1] ?? 2;
  for (let pos = 1; pos <= nbPositions; pos++) {
    assurerLigneGrille(db, joueurId, partieId, rang, pos, 'ouvert');
  }
}

// Apres chaque validation, verifie si un rang est complete pour debloquer le suivant.
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

// Valide une case : le statut doit etre 'ouvert'.
function validerObjectif(db, { joueurId, ligneId }) {
  const ligne = db.prepare('SELECT * FROM grille_objectifs WHERE id = ? AND joueur_id = ?').get(ligneId, joueurId);
  if (!ligne) throw new Error('Case de grille introuvable');
  if (ligne.statut !== 'ouvert') throw new Error("Cet objectif doit etre ouvert pour etre valide");

  db.prepare("UPDATE grille_objectifs SET statut = 'valide', completed_at = datetime('now') WHERE id = ?").run(
    ligne.id
  );

  return { ligne, partieTerminee: estJoueurTermine(db, joueurId), partieId: ligne.partie_id };
}

// Construit l'etat complet de la grille d'un joueur avec positions variables.
function obtenirEtatJoueur(db, joueurId) {
  const joueur = db.prepare('SELECT * FROM joueurs WHERE id = ?').get(joueurId);
  if (!joueur) return null;

  const race = joueur.race_id ? db.prepare('SELECT * FROM races WHERE id = ?').get(joueur.race_id) : null;
  const partie = joueur.partie_id ? db.prepare('SELECT * FROM parties WHERE id = ?').get(joueur.partie_id) : null;

  let configObj, nbRepRace;
  try { configObj = JSON.parse(partie?.config_objectifs_race || '[2,2,2]'); } catch { configObj = [2, 2, 2]; }
  nbRepRace = partie?.nb_representants_race ?? 3;

  const total = compterValide(db, joueurId);
  const requis = configObj.slice(0, nbRepRace).reduce((s, n) => s + n, 0);

  // Un rang est debloq ue si ses cases existent avec un statut different de 'masque' en DB.
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

  const allegeances = db
    .prepare(
      'SELECT a.id, a.nom, a.portrait FROM joueur_allegeances ja JOIN allegeances a ON a.id = ja.allegeance_id WHERE ja.joueur_id = ?'
    )
    .all(joueurId);

  return {
    joueurId,
    pseudo: joueur.pseudo,
    raceId: race ? race.id : null,
    raceNom: race ? race.nom : null,
    imageFond: race ? race.image_fond : null,
    totalValide: total,
    partieTerminee: total >= requis && requis > 0,
    config: { nbRepRace, configObjectifs: configObj },
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
  obtenirEtatJoueur
};
