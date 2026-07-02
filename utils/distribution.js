// Distribution des objectifs au lancement d'une partie : chaque joueur recoit 6
// objectifs (3 rangs x 2 positions). Chaque objectif est unique dans la partie :
// un meme objectif ne peut pas etre attribue a deux joueurs differents.

function piocherUnObjectif(db, exclus) {
  const exclusion = exclus.size ? [...exclus] : [0];
  const placeholders = exclusion.map(() => '?').join(',');
  const trouve = db
    .prepare(`SELECT * FROM objectifs WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`)
    .get(...exclusion);
  // Repli si le pool est epuise (ne devrait pas arriver si la verification pre-lancement passe)
  return trouve || db.prepare('SELECT * FROM objectifs ORDER BY RANDOM() LIMIT 1').get();
}

function distribuer(db, { partieId, joueurIds }) {
  const insererCase = db.prepare(
    `INSERT INTO grille_objectifs (joueur_id, partie_id, rang, position, objectif_id, statut)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    // Un objectif ne peut etre attribue qu'a un seul joueur par partie
    const utilisesDansLaPartie = new Set();

    for (const joueurId of joueurIds) {
      for (const rang of [1, 2, 3]) {
        for (const position of [1, 2]) {
          // Rang 1 : les 2 cases sont immediatement visibles (ferme) au lancement
          const statutInitial = rang === 1 ? 'ferme' : 'masque';
          const objectif = piocherUnObjectif(db, utilisesDansLaPartie);
          insererCase.run(joueurId, partieId, rang, position, objectif.id, statutInitial);
          utilisesDansLaPartie.add(objectif.id);
        }
      }
    }
  });

  transaction();
}

module.exports = { distribuer };
