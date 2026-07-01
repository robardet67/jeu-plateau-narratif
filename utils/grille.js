// Logique de la grille de progression d'un joueur : 3 rangs (les 3 representants de sa
// race) x 3 positions d'objectif = 9 cases. Deux joueurs n'ont jamais la meme race, donc
// le partage cooperatif/belliqueux se fait par coordonnee (rang, position), commune a
// tous les joueurs d'une partie quelle que soit leur race.

const { normaliser } = require('./texte');

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
  return compterValide(db, joueurId) >= 9;
}

// Reveille (masque -> statut demande) la case (joueur, rang, position) si elle a deja
// ete pre-distribuee par le MJ (Phase 4, voir utils/distribution.js). Si elle n'existe
// pas du tout (partie non configuree/lancee via l'admin), reste sur l'ancien
// comportement : partage avec un autre joueur deja present a cette coordonnee, sinon
// pioche aleatoire jamais utilisee par ce joueur.
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

  const partagee = db
    .prepare(
      'SELECT * FROM grille_objectifs WHERE partie_id = ? AND rang = ? AND position = ? AND joueur_id != ? LIMIT 1'
    )
    .get(partieId, rang, position, joueurId);

  let objectifId;
  let statut;
  let completedAt = null;

  if (partagee) {
    objectifId = partagee.objectif_id;
    statut = partagee.statut;
    completedAt = partagee.completed_at;
  } else {
    const dejaUtilises = db
      .prepare('SELECT objectif_id FROM grille_objectifs WHERE joueur_id = ?')
      .all(joueurId)
      .map((r) => r.objectif_id);
    const exclusion = dejaUtilises.length ? dejaUtilises : [0];
    const placeholders = exclusion.map(() => '?').join(',');
    const objectif =
      db
        .prepare(`SELECT * FROM objectifs WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`)
        .get(...exclusion) || db.prepare('SELECT * FROM objectifs ORDER BY RANDOM() LIMIT 1').get();
    if (!objectif) return null;
    objectifId = objectif.id;
    statut = statutParDefaut;
  }

  const resultat = db
    .prepare(
      'INSERT INTO grille_objectifs (joueur_id, partie_id, rang, position, objectif_id, statut, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(joueurId, partieId, rang, position, objectifId, statut, completedAt);

  return db.prepare('SELECT * FROM grille_objectifs WHERE id = ?').get(resultat.lastInsertRowid);
}

function deverrouillerRang(db, joueurId, partieId, rang) {
  assurerLigneGrille(db, joueurId, partieId, rang, 1, 'ferme');
  assurerLigneGrille(db, joueurId, partieId, rang, 2, 'ferme');
  assurerLigneGrille(db, joueurId, partieId, rang, 3, 'masque');
}

function verifierDeverrouillages(db, joueurId, partieId) {
  const total = compterValide(db, joueurId);
  if (total >= 1) deverrouillerRang(db, joueurId, partieId, 2);
  if (total >= 3) deverrouillerRang(db, joueurId, partieId, 3);
}

// La 3e case d'un rang se devoile (masque -> ferme) quand les 2 premieres DE CE MEME
// rang sont validees (independamment du total tous rangs confondus).
function verifierDevoilementPosition3(db, joueurId, rang) {
  const pos1 = db
    .prepare('SELECT statut FROM grille_objectifs WHERE joueur_id = ? AND rang = ? AND position = 1')
    .get(joueurId, rang);
  const pos2 = db
    .prepare('SELECT statut FROM grille_objectifs WHERE joueur_id = ? AND rang = ? AND position = 2')
    .get(joueurId, rang);

  if (pos1?.statut === 'valide' && pos2?.statut === 'valide') {
    db.prepare(
      "UPDATE grille_objectifs SET statut = 'ferme' WHERE joueur_id = ? AND rang = ? AND position = 3 AND statut = 'masque'"
    ).run(joueurId, rang);
  }
}

// Cherche un objectif de remplacement (meme niveau/type/categorie en priorite), avec un
// repli progressif si aucun objectif ne correspond exactement (pool trop petit).
function choisirObjectifRemplacement(db, objectifActuel, exclureIds = []) {
  const exclusion = [...new Set([objectifActuel.id, ...exclureIds])];
  const placeholders = exclusion.map(() => '?').join(',');

  let candidat = db
    .prepare(
      `SELECT * FROM objectifs WHERE niveau IS ? AND type IS ? AND categorie IS ? AND id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`
    )
    .get(objectifActuel.niveau, objectifActuel.type, objectifActuel.categorie, ...exclusion);
  if (candidat) return candidat;

  candidat = db
    .prepare(`SELECT * FROM objectifs WHERE type IS ? AND id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`)
    .get(objectifActuel.type, ...exclusion);
  if (candidat) return candidat;

  candidat = db
    .prepare(`SELECT * FROM objectifs WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`)
    .get(...exclusion);
  return candidat || null;
}

// Valide une case pour un joueur et propage l'effet cooperatif/belliqueux aux autres
// joueurs de la partie qui partagent la meme coordonnee (rang, position).
function validerObjectif(db, { joueurId, ligneId }) {
  const ligne = db.prepare('SELECT * FROM grille_objectifs WHERE id = ? AND joueur_id = ?').get(ligneId, joueurId);
  if (!ligne) throw new Error('Case de grille introuvable');
  if (ligne.statut !== 'ouvert') throw new Error("Cet objectif doit d'abord etre ouvert");

  const objectif = db.prepare('SELECT * FROM objectifs WHERE id = ?').get(ligne.objectif_id);

  db.prepare("UPDATE grille_objectifs SET statut = 'valide', completed_at = datetime('now') WHERE id = ?").run(
    ligne.id
  );

  const affectes = [];
  const type = normaliser(objectif.type);

  if (type === 'cooperatif' || type === 'belliqueux') {
    const autres = db
      .prepare(
        "SELECT * FROM grille_objectifs WHERE partie_id = ? AND rang = ? AND position = ? AND joueur_id != ? AND statut != 'valide'"
      )
      .all(ligne.partie_id, ligne.rang, ligne.position, joueurId);

    for (const autre of autres) {
      if (type === 'cooperatif') {
        db.prepare(
          "UPDATE grille_objectifs SET statut = 'valide', completed_at = datetime('now') WHERE id = ?"
        ).run(autre.id);
        affectes.push({ joueurId: autre.joueur_id, action: 'valide' });
      } else {
        const nouvel = choisirObjectifRemplacement(db, objectif, [autre.objectif_id]);
        if (nouvel) {
          const nouveauStatut = autre.statut === 'masque' ? 'masque' : 'ferme';
          db.prepare(
            'UPDATE grille_objectifs SET objectif_id = ?, statut = ?, completed_at = NULL WHERE id = ?'
          ).run(nouvel.id, nouveauStatut, autre.id);
          affectes.push({ joueurId: autre.joueur_id, action: 'remplace' });
        }
      }
    }
  }

  const joueursAVerifier = [joueurId, ...affectes.filter((a) => a.action === 'valide').map((a) => a.joueurId)];
  const partieTerminee = joueursAVerifier.some((jid) => estJoueurTermine(db, jid));

  return { ligne, objectif, affectes, partieTerminee, partieId: ligne.partie_id };
}

// Construit l'etat complet de la grille d'un joueur (races/representants deverrouilles,
// cases avec objectifs, dialogues avec {nom} substitue) pour l'envoyer au client.
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

    const cases = [1, 2, 3].map((position) => {
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
    partieTerminee: total >= 9,
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
  verifierDevoilementPosition3,
  choisirObjectifRemplacement,
  validerObjectif,
  obtenirEtatJoueur
};
