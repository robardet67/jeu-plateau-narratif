// Logique de la grille de progression d'un joueur : 3 rangs (les 3 representants de sa
// race) x 2 positions d'objectif = 6 cases au total. Tous les objectifs sont identiques
// (pas de type cooperatif/belliqueux) et uniques par partie.

function obtenirParametre(db, cle) {
  const ligne = db.prepare('SELECT valeur FROM parametres WHERE cle = ?').get(cle);
  return ligne ? ligne.valeur : null;
}

function compterValide(db, joueurId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM grille_objectifs WHERE joueur_id = ? AND statut = 'valide'")
    .get(joueurId).n;
}

function estJoueurTermine(db, joueurId) {
  return compterValide(db, joueurId) >= 6;
}

// Reveille (masque -> ferme) les deux cases d'un rang. Si elles ont deja ete
// pre-distribuees, met a jour leur statut ; sinon les cree a la volee (cas de
// parties sans distribution prealable).
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
  assurerLigneGrille(db, joueurId, partieId, rang, 1, 'ferme');
  assurerLigneGrille(db, joueurId, partieId, rang, 2, 'ferme');
}

function verifierDeverrouillages(db, joueurId, partieId) {
  const total = compterValide(db, joueurId);
  if (total >= 1) deverrouillerRang(db, joueurId, partieId, 2);
  if (total >= 3) deverrouillerRang(db, joueurId, partieId, 3);
}

// Valide une case : pas d'effet sur les autres joueurs (plus de cooperatif/belliqueux).
function validerObjectif(db, { joueurId, ligneId }) {
  const ligne = db.prepare('SELECT * FROM grille_objectifs WHERE id = ? AND joueur_id = ?').get(ligneId, joueurId);
  if (!ligne) throw new Error('Case de grille introuvable');
  if (ligne.statut !== 'ouvert') throw new Error("Cet objectif doit d'abord etre ouvert");

  db.prepare("UPDATE grille_objectifs SET statut = 'valide', completed_at = datetime('now') WHERE id = ?").run(
    ligne.id
  );

  return { ligne, partieTerminee: estJoueurTermine(db, joueurId), partieId: ligne.partie_id };
}

// Construit l'etat complet de la grille d'un joueur (6 cases, 3 rangs x 2 positions).
function obtenirEtatJoueur(db, joueurId) {
  const joueur = db.prepare('SELECT * FROM joueurs WHERE id = ?').get(joueurId);
  if (!joueur) return null;

  const race = joueur.race_id ? db.prepare('SELECT * FROM races WHERE id = ?').get(joueur.race_id) : null;
  const total = compterValide(db, joueurId);

  const rangsDeverrouilles = new Set([1]);
  if (total >= 1) rangsDeverrouilles.add(2);
  if (total >= 3) rangsDeverrouilles.add(3);

  const rangs = [1, 2, 3].map((rang) => {
    const deverrouille = rangsDeverrouilles.has(rang) && !!race;
    if (!deverrouille) {
      return { rang, deverrouille: false, representant: null, cases: [], toutesLesCasesValidees: false };
    }

    const representant = db
      .prepare('SELECT * FROM representants WHERE race_id = ? AND rang = ?')
      .get(race.id, rang);

    const lignes = db
      .prepare('SELECT * FROM grille_objectifs WHERE joueur_id = ? AND rang = ?')
      .all(joueurId, rang);

    const cases = [1, 2].map((position) => {
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
      toutesLesCasesValidees: cases.every((c) => c.statut === 'valide')
    };
  });

  return {
    joueurId,
    raceId: race ? race.id : null,
    raceNom: race ? race.nom : null,
    imageFond: race ? race.image_fond : null,
    totalValide: total,
    partieTerminee: total >= 6,
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
