// Distribution des objectifs au lancement d'une partie : chaque joueur recoit 9
// objectifs (3 rangs x 3 positions) tires totalement au hasard dans le pool CSV, sans
// doublon pour ce joueur (repli sur une repetition uniquement si le pool a moins de 9
// objectifs au total).

function piocherUnObjectif(db, exclus) {
  const exclusion = exclus.size ? [...exclus] : [0];
  const placeholders = exclusion.map(() => '?').join(',');
  const trouve = db
    .prepare(`SELECT * FROM objectifs WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`)
    .get(...exclusion);
  return trouve || db.prepare('SELECT * FROM objectifs ORDER BY RANDOM() LIMIT 1').get();
}

function distribuer(db, { partieId, joueurIds }) {
  const insererCase = db.prepare(
    `INSERT INTO grille_objectifs (joueur_id, partie_id, rang, position, objectif_id, statut)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    for (const joueurId of joueurIds) {
      const dejaUtilises = new Set();
      for (const rang of [1, 2, 3]) {
        for (const position of [1, 2, 3]) {
          const statutInitial = rang === 1 && position !== 3 ? 'ferme' : 'masque';
          const objectif = piocherUnObjectif(db, dejaUtilises);
          insererCase.run(joueurId, partieId, rang, position, objectif.id, statutInitial);
          dejaUtilises.add(objectif.id);
        }
      }
    }
  });

  transaction();
}

module.exports = { distribuer };
