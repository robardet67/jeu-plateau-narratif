// Distribution des objectifs au lancement d'une partie : chaque joueur recoit 9
// objectifs (3 rangs x 3 positions) tires au hasard dans le pool, sans doublon pour
// ce joueur. Si nbCoopParJoueur > 0, ce nombre de slots (les memes coordonnees pour
// tous les joueurs) recevront un objectif de type 'cooperatif'.

function piocherUnObjectif(db, exclus) {
  const exclusion = exclus.size ? [...exclus] : [0];
  const placeholders = exclusion.map(() => '?').join(',');
  const trouve = db
    .prepare(`SELECT * FROM objectifs WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`)
    .get(...exclusion);
  return trouve || db.prepare('SELECT * FROM objectifs ORDER BY RANDOM() LIMIT 1').get();
}

function piocherObjectifCoop(db, exclus) {
  const exclusion = exclus.size ? [...exclus] : [0];
  const placeholders = exclusion.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM objectifs WHERE type = 'cooperatif' AND id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`)
    .get(...exclusion) || null;
}

function distribuer(db, { partieId, joueurIds, nbCoopParJoueur = 0 }) {
  // Determine les coordonnees cooperatives (identiques pour tous les joueurs)
  const tousSlots = [];
  for (const rang of [1, 2, 3]) {
    for (const position of [1, 2, 3]) {
      tousSlots.push({ rang, position });
    }
  }

  // Fisher-Yates pour choisir aleatoirement les slots cooperatifs
  for (let i = tousSlots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tousSlots[i], tousSlots[j]] = [tousSlots[j], tousSlots[i]];
  }
  const nb = Math.min(nbCoopParJoueur, 9);
  const slotsCoopSet = new Set(tousSlots.slice(0, nb).map((s) => `${s.rang},${s.position}`));

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
          const estCoop = nb > 0 && slotsCoopSet.has(`${rang},${position}`);
          const objectif = estCoop
            ? (piocherObjectifCoop(db, dejaUtilises) || piocherUnObjectif(db, dejaUtilises))
            : piocherUnObjectif(db, dejaUtilises);
          insererCase.run(joueurId, partieId, rang, position, objectif.id, statutInitial);
          dejaUtilises.add(objectif.id);
        }
      }
    }
  });

  transaction();
}

module.exports = { distribuer };
