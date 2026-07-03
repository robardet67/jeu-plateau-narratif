// Distribution des objectifs au lancement. Chaque joueur recoit N objectifs
// (somme des positions de chaque rang actif). Les objectifs sont uniques par partie.
// Si un niveau est specifie dans config_niveaux_race, pioche uniquement dans ce niveau
// avec repli sur l'ensemble du pool si le niveau est epuise.

function piocherObjectifNiveau(db, niveau, exclus) {
  const exclusion = exclus.size ? [...exclus] : [0];
  const placeholders = exclusion.map(() => '?').join(',');

  if (niveau != null) {
    const trouve = db
      .prepare(
        `SELECT * FROM objectifs WHERE niveau = ? AND id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`
      )
      .get(niveau, ...exclusion);
    if (trouve) return trouve;
  }

  // Repli : n'importe quel niveau
  const repli = db
    .prepare(`SELECT * FROM objectifs WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`)
    .get(...exclusion);
  return repli || db.prepare('SELECT * FROM objectifs ORDER BY RANDOM() LIMIT 1').get();
}

function distribuer(db, { partieId, joueurIds }) {
  const partie = db.prepare('SELECT * FROM parties WHERE id = ?').get(partieId);

  let configObj, configNiveaux, nbRepRace;
  try { configObj = JSON.parse(partie?.config_objectifs_race || '[2,2,2]'); } catch { configObj = [2, 2, 2]; }
  try { configNiveaux = JSON.parse(partie?.config_niveaux_race || '[[null,null],[null,null],[null,null]]'); } catch { configNiveaux = [[null, null], [null, null], [null, null]]; }
  nbRepRace = partie?.nb_representants_race ?? 3;

  const insererCase = db.prepare(
    'INSERT INTO grille_objectifs (joueur_id, partie_id, rang, position, objectif_id, statut) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    const utilisesDansLaPartie = new Set();

    for (const joueurId of joueurIds) {
      for (let rangIdx = 0; rangIdx < nbRepRace; rangIdx++) {
        const rang = rangIdx + 1;
        const nbPositions = configObj[rangIdx] ?? 2;
        const niveauxRang = configNiveaux[rangIdx] || [];
        // Rang 1 demarre 'ouvert' ; les suivants 'masque' (deverrouillage progressif).
        const statutInitial = rang === 1 ? 'ouvert' : 'masque';

        for (let posIdx = 0; posIdx < nbPositions; posIdx++) {
          const position = posIdx + 1;
          const niveau = niveauxRang[posIdx] ?? null;
          const objectif = piocherObjectifNiveau(db, niveau, utilisesDansLaPartie);
          if (!objectif) throw new Error('Plus assez d\'objectifs dans le pool pour distribuer');
          insererCase.run(joueurId, partieId, rang, position, objectif.id, statutInitial);
          utilisesDansLaPartie.add(objectif.id);
        }
      }
    }
  });

  transaction();
}

module.exports = { distribuer };
