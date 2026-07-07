// Distribution des objectifs au lancement. Chaque joueur recoit N objectifs
// (somme des positions de chaque rang actif). Les objectifs sont uniques par partie.
// Si un niveau est specifie dans config_niveaux_race, pioche uniquement dans ce niveau
// avec repli sur l'ensemble du pool si le niveau est epuise.

async function piocherObjectifNiveau(db, niveau, exclus) {
  const exclusion = exclus.size ? [...exclus] : [0];
  const placeholders = exclusion.map(() => '?').join(',');

  if (niveau != null) {
    const trouve = await db.get(
      `SELECT * FROM objectifs WHERE niveau = ? AND id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`,
      [niveau, ...exclusion]
    );
    if (trouve) return trouve;
  }

  const repli = await db.get(
    `SELECT * FROM objectifs WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`,
    exclusion
  );
  return repli || db.get('SELECT * FROM objectifs ORDER BY RANDOM() LIMIT 1');
}

async function distribuer(db, { partieId, joueurIds }) {
  const partie = await db.get('SELECT * FROM parties WHERE id = ?', [partieId]);

  let configObj, configNiveaux, nbRepRace;
  try { configObj = JSON.parse(partie?.config_objectifs_race || '[2,2,2]'); } catch { configObj = [2, 2, 2]; }
  try { configNiveaux = JSON.parse(partie?.config_niveaux_race || '[[null,null],[null,null],[null,null]]'); } catch { configNiveaux = [[null, null], [null, null], [null, null]]; }
  nbRepRace = partie?.nb_representants_race ?? 3;

  await db.transact(async (tx) => {
    const utilisesDansLaPartie = new Set();

    for (const joueurId of joueurIds) {
      for (let rangIdx = 0; rangIdx < nbRepRace; rangIdx++) {
        const rang = rangIdx + 1;
        const nbPositions = configObj[rangIdx] ?? 2;
        const niveauxRang = configNiveaux[rangIdx] || [];
        const statutInitial = rang === 1 ? 'ouvert' : 'masque';

        for (let posIdx = 0; posIdx < nbPositions; posIdx++) {
          const position = posIdx + 1;
          const niveau = niveauxRang[posIdx] ?? null;
          const objectif = await piocherObjectifNiveau(tx, niveau, utilisesDansLaPartie);
          if (!objectif) throw new Error("Plus assez d'objectifs dans le pool pour distribuer");
          await tx.run(
            'INSERT INTO grille_objectifs (joueur_id, partie_id, rang, position, objectif_id, statut) VALUES (?, ?, ?, ?, ?, ?)',
            [joueurId, partieId, rang, position, objectif.id, statutInitial]
          );
          utilisesDansLaPartie.add(objectif.id);
        }
      }
    }
  });
}

async function distribuerAllegeances(db, { partieId, joueurIds }) {
  const partie = await db.get('SELECT * FROM parties WHERE id = ?', [partieId]);

  let configObjAlleg, configNiveauxAlleg, nbRepAlleg;
  try { configObjAlleg = JSON.parse(partie?.config_objectifs_allegeance || '[2,2,2]'); } catch { configObjAlleg = [2, 2, 2]; }
  try { configNiveauxAlleg = JSON.parse(partie?.config_niveaux_allegeance || '[[null,null],[null,null],[null,null]]'); } catch { configNiveauxAlleg = [[null, null], [null, null], [null, null]]; }
  nbRepAlleg = partie?.nb_representants_allegeance ?? 2;

  const rows = await db.all(
    'SELECT DISTINCT allegeance_id FROM joueur_allegeances WHERE joueur_id IN (' + joueurIds.map(() => '?').join(',') + ')',
    joueurIds
  );
  const allegeanceIds = rows.map((r) => r.allegeance_id);

  if (allegeanceIds.length === 0) return;

  await db.transact(async (tx) => {
    const dejaUtilises = new Set(
      (await tx.all('SELECT objectif_id FROM grille_objectifs WHERE partie_id = ?', [partieId]))
        .map((r) => r.objectif_id)
    );

    for (const allegeanceId of allegeanceIds) {
      for (let rangIdx = 0; rangIdx < nbRepAlleg; rangIdx++) {
        const rang = rangIdx + 1;
        const nbPositions = configObjAlleg[rangIdx] ?? 2;
        const niveauxRang = configNiveauxAlleg[rangIdx] || [];
        const statutInitial = rang === 1 ? 'ouvert' : 'masque';

        for (let posIdx = 0; posIdx < nbPositions; posIdx++) {
          const position = posIdx + 1;
          const niveau = niveauxRang[posIdx] ?? null;
          const objectif = await piocherObjectifNiveau(tx, niveau, dejaUtilises);
          if (!objectif) throw new Error("Plus assez d'objectifs dans le pool pour distribuer (allegeances)");
          await tx.run(
            'INSERT OR IGNORE INTO grille_allegeance (allegeance_id, partie_id, rang, position, objectif_id, statut) VALUES (?, ?, ?, ?, ?, ?)',
            [allegeanceId, partieId, rang, position, objectif.id, statutInitial]
          );
          dejaUtilises.add(objectif.id);
        }
      }
    }
  });
}

module.exports = { distribuer, distribuerAllegeances };
