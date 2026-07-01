const fs = require('fs');
const path = require('path');
const db = require('../database/db');

const CHEMIN_EXPORT = path.join(__dirname, '..', 'database', 'contenu-export.json');

// Regenere un instantane JSON (versionne sur GitHub) du contenu edite dans l'admin :
// races, representants, dialogues, objectifs et images de scenario. La base SQLite
// elle-meme reste hors de git (elle contient aussi les parties/joueurs en cours,
// qui changeraient a chaque coup de jeu) ; ce fichier est la seule trace du texte
// saisi qui soit reellement sauvegardee sur GitHub.
function regenererExportContenu() {
  const contenu = {
    genere_le: new Date().toISOString(),
    races: db.prepare('SELECT id, nom, image_fond, created_at FROM races ORDER BY id').all(),
    representants: db
      .prepare(
        'SELECT id, race_id, rang, nom, description, image_depart, image_sourire, created_at FROM representants ORDER BY race_id, rang'
      )
      .all(),
    dialogues: db
      .prepare('SELECT id, representant_id, contexte, texte, created_at FROM dialogues ORDER BY id')
      .all(),
    objectifs: db
      .prepare('SELECT id, description, niveau, type, categorie, created_at FROM objectifs ORDER BY id')
      .all(),
    scenario_images: db.prepare('SELECT id, ordre, image, created_at FROM scenario_images ORDER BY ordre').all()
  };

  fs.writeFileSync(CHEMIN_EXPORT, JSON.stringify(contenu, null, 2), 'utf-8');
}

module.exports = { regenererExportContenu, CHEMIN_EXPORT };
