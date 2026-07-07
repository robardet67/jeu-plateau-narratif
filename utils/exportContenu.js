const fs = require('fs');
const path = require('path');

const CHEMIN_EXPORT = path.join(__dirname, '..', 'database', 'contenu-export.json');

// Regenere l'instantane JSON versionne sur GitHub (races, representants, dialogues,
// objectifs, allegeances, scenario). db est passe en parametre pour eviter l'import
// circulaire et supporter les deux backends (local et Turso).
async function regenererExportContenu(db) {
  const [races, representants, dialogues, objectifs, allegeances, representants_allegeance, scenario_images] = await Promise.all([
    db.all('SELECT id, nom, image_fond, created_at FROM races ORDER BY id'),
    db.all('SELECT id, race_id, rang, nom, description, image_depart, image_sourire, created_at FROM representants ORDER BY race_id, rang'),
    db.all('SELECT id, representant_id, contexte, texte, created_at FROM dialogues ORDER BY id'),
    db.all('SELECT id, description, niveau, created_at FROM objectifs ORDER BY id'),
    db.all('SELECT id, nom, portrait, created_at FROM allegeances ORDER BY id'),
    db.all('SELECT id, allegeance_id, rang, nom, image_depart, image_sourire, dialogue, created_at FROM representants_allegeance ORDER BY allegeance_id, rang'),
    db.all('SELECT id, ordre, image, created_at FROM scenario_images ORDER BY ordre'),
  ]);

  const contenu = {
    genere_le: new Date().toISOString(),
    races,
    representants,
    dialogues,
    objectifs,
    allegeances,
    representants_allegeance,
    scenario_images,
  };

  fs.writeFileSync(CHEMIN_EXPORT, JSON.stringify(contenu, null, 2), 'utf-8');
}

module.exports = { regenererExportContenu, CHEMIN_EXPORT };
