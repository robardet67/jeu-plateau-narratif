const path = require('path');
const { creerDb, DB_PATH } = require('./db');

// --- Helpers de migration (async) ---

async function colonneExiste(db, table, colonne) {
  // pragma_table_info() en syntaxe table-valued function est mieux supportee
  // par Turso HTTP que l'instruction PRAGMA classique (qui renvoie parfois
  // un resultat vide dans ce mode et fausse le test d'existence).
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = ?`,
    [colonne]
  );
  return row ? Number(row.n) > 0 : false;
}

async function tableExiste(db, table) {
  const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
  return !!row;
}

async function assurerColonne(db, table, colonne, definitionSql) {
  if (!(await colonneExiste(db, table, colonne))) {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definitionSql}`);
    } catch (err) {
      // Ignore si la colonne existe deja : protege contre les rares cas ou
      // pragma_table_info ne refleterait pas encore l'etat reel (base Turso fraiche).
      if (!err.message || !err.message.includes('duplicate column name')) throw err;
    }
  }
}

async function retirerColonne(db, table, colonne) {
  if (await colonneExiste(db, table, colonne)) {
    try {
      await db.exec(`ALTER TABLE ${table} DROP COLUMN ${colonne}`);
    } catch (err) {
      if (!err.message || !err.message.includes('no such column')) throw err;
    }
  }
}

async function initDatabase(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS races (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL UNIQUE,
      image_fond TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS representants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL,
      rang INTEGER NOT NULL DEFAULT 1 CHECK (rang IN (1, 2, 3)),
      nom TEXT NOT NULL,
      description TEXT,
      image_depart TEXT,
      image_sourire TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dialogues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      representant_id INTEGER NOT NULL,
      contexte TEXT NOT NULL,
      texte TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (representant_id) REFERENCES representants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS objectifs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      niveau TEXT,
      type TEXT,
      categorie TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scenario_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ordre INTEGER NOT NULL UNIQUE,
      image TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      nom TEXT,
      statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'en_cours', 'terminee')),
      tour_actuel INTEGER NOT NULL DEFAULT 0,
      scenario_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS joueurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partie_id INTEGER NOT NULL,
      pseudo TEXT NOT NULL,
      password_hash TEXT,
      race_id INTEGER,
      representant_id INTEGER,
      est_hote INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      socket_id TEXT,
      connecte INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (partie_id) REFERENCES parties(id) ON DELETE CASCADE,
      FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE SET NULL,
      FOREIGN KEY (representant_id) REFERENCES representants(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS parametres (
      cle TEXT PRIMARY KEY,
      valeur TEXT
    );

    CREATE TABLE IF NOT EXISTS grille_objectifs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      joueur_id INTEGER NOT NULL,
      partie_id INTEGER NOT NULL,
      rang INTEGER NOT NULL CHECK (rang IN (1, 2, 3)),
      position INTEGER NOT NULL CHECK (position IN (1, 2, 3)),
      objectif_id INTEGER NOT NULL,
      statut TEXT NOT NULL DEFAULT 'masque' CHECK (statut IN ('masque', 'ferme', 'ouvert', 'valide')),
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (joueur_id) REFERENCES joueurs(id) ON DELETE CASCADE,
      FOREIGN KEY (partie_id) REFERENCES parties(id) ON DELETE CASCADE,
      FOREIGN KEY (objectif_id) REFERENCES objectifs(id) ON DELETE CASCADE,
      UNIQUE (joueur_id, rang, position)
    );

    CREATE INDEX IF NOT EXISTS idx_representants_race ON representants(race_id);
    CREATE INDEX IF NOT EXISTS idx_dialogues_representant ON dialogues(representant_id);
    CREATE INDEX IF NOT EXISTS idx_joueurs_partie ON joueurs(partie_id);
    CREATE INDEX IF NOT EXISTS idx_grille_joueur ON grille_objectifs(joueur_id);
    CREATE INDEX IF NOT EXISTS idx_grille_partie_coord ON grille_objectifs(partie_id, rang, position);
    CREATE INDEX IF NOT EXISTS idx_parties_code ON parties(code)
  `);

  await db.exec('DROP TABLE IF EXISTS joueurs_objectifs');

  // Migrations pour les bases deja existantes
  await retirerColonne(db, 'races', 'description');
  await retirerColonne(db, 'races', 'image');
  await assurerColonne(db, 'races', 'image_fond', 'TEXT');
  await assurerColonne(db, 'races', 'image_portrait', 'TEXT');
  await assurerColonne(db, 'races', 'texte_hub', 'TEXT');
  await assurerColonne(db, 'scenario_images', 'texte', 'TEXT');

  if ((await colonneExiste(db, 'objectifs', 'titre')) || (await colonneExiste(db, 'objectifs', 'points'))) {
    await assurerColonne(db, 'objectifs', 'niveau', 'TEXT');
    await assurerColonne(db, 'objectifs', 'type', 'TEXT');
    await assurerColonne(db, 'objectifs', 'categorie', 'TEXT');
    if (await colonneExiste(db, 'objectifs', 'titre')) {
      await db.exec("UPDATE objectifs SET description = COALESCE(NULLIF(description, ''), titre) WHERE description IS NULL OR description = ''");
      await retirerColonne(db, 'objectifs', 'titre');
    }
    await retirerColonne(db, 'objectifs', 'points');
  }

  await assurerColonne(db, 'parties', 'scenario_index', 'INTEGER NOT NULL DEFAULT 0');
  await assurerColonne(db, 'parties', 'nb_joueurs_attendus', 'INTEGER NOT NULL DEFAULT 0');

  await retirerColonne(db, 'parties', 'nombre_joueurs_prevu');
  await retirerColonne(db, 'parties', 'nombre_coop_par_joueur');
  await retirerColonne(db, 'parties', 'nb_objectifs_cooperatifs');
  await db.exec('DROP TABLE IF EXISTS configuration_emplacements');

  await retirerColonne(db, 'objectifs', 'niveau');
  await retirerColonne(db, 'objectifs', 'type');
  await retirerColonne(db, 'objectifs', 'categorie');

  await db.exec('DELETE FROM grille_objectifs WHERE position = 3');

  const rangExistaitDeja = await colonneExiste(db, 'representants', 'rang');
  await assurerColonne(db, 'representants', 'rang', 'INTEGER NOT NULL DEFAULT 1');
  if (!rangExistaitDeja) {
    const representantsParRace = await db.all('SELECT id, race_id FROM representants ORDER BY race_id, id');
    const compteurs = {};
    for (const r of representantsParRace) {
      compteurs[r.race_id] = (compteurs[r.race_id] || 0) + 1;
      await db.run('UPDATE representants SET rang = ? WHERE id = ?', [compteurs[r.race_id], r.id]);
    }
  }
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_representants_race_rang ON representants(race_id, rang)');

  // Migration depuis "runes" (ancienne version)
  if ((await tableExiste(db, 'runes')) && !(await tableExiste(db, 'allegiances')) && !(await tableExiste(db, 'allegeances'))) {
    await db.exec('ALTER TABLE runes RENAME TO allegiances');
  }
  if ((await tableExiste(db, 'representants_rune')) && !(await tableExiste(db, 'representants_allegiance')) && !(await tableExiste(db, 'representants_allegeance'))) {
    await db.exec('ALTER TABLE representants_rune RENAME TO representants_allegiance');
  }
  if ((await tableExiste(db, 'representants_allegiance')) && (await colonneExiste(db, 'representants_allegiance', 'rune_id'))) {
    await db.exec('ALTER TABLE representants_allegiance RENAME COLUMN rune_id TO allegiance_id');
  }
  if ((await tableExiste(db, 'joueur_runes')) && !(await tableExiste(db, 'joueur_allegiances')) && !(await tableExiste(db, 'joueur_allegeances'))) {
    await db.exec('ALTER TABLE joueur_runes RENAME TO joueur_allegiances');
  }
  if ((await tableExiste(db, 'joueur_allegiances')) && (await colonneExiste(db, 'joueur_allegiances', 'rune_id'))) {
    await db.exec('ALTER TABLE joueur_allegiances RENAME COLUMN rune_id TO allegiance_id');
  }
  await db.exec('DROP INDEX IF EXISTS idx_repr_rune');
  await db.exec('DROP INDEX IF EXISTS idx_joueur_runes');

  // Correction orthographe : allegiances → allegeances
  if ((await tableExiste(db, 'allegiances')) && !(await tableExiste(db, 'allegeances'))) {
    await db.exec('ALTER TABLE allegiances RENAME TO allegeances');
  }
  if ((await tableExiste(db, 'representants_allegiance')) && !(await tableExiste(db, 'representants_allegeance'))) {
    await db.exec('ALTER TABLE representants_allegiance RENAME TO representants_allegeance');
  }
  if ((await tableExiste(db, 'representants_allegeance')) && (await colonneExiste(db, 'representants_allegeance', 'allegiance_id'))) {
    await db.exec('ALTER TABLE representants_allegeance RENAME COLUMN allegiance_id TO allegeance_id');
  }
  if ((await tableExiste(db, 'joueur_allegiances')) && !(await tableExiste(db, 'joueur_allegeances'))) {
    await db.exec('ALTER TABLE joueur_allegiances RENAME TO joueur_allegeances');
  }
  if ((await tableExiste(db, 'joueur_allegeances')) && (await colonneExiste(db, 'joueur_allegeances', 'allegiance_id'))) {
    await db.exec('ALTER TABLE joueur_allegeances RENAME COLUMN allegiance_id TO allegeance_id');
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS allegeances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL UNIQUE,
      portrait TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS representants_allegeance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      allegeance_id INTEGER NOT NULL,
      rang INTEGER NOT NULL CHECK (rang IN (1, 2, 3)),
      nom TEXT NOT NULL,
      image_depart TEXT,
      image_sourire TEXT,
      dialogue TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (allegeance_id) REFERENCES allegeances(id) ON DELETE CASCADE,
      UNIQUE (allegeance_id, rang)
    );

    CREATE TABLE IF NOT EXISTS joueur_allegeances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      joueur_id INTEGER NOT NULL,
      allegeance_id INTEGER NOT NULL,
      progression INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (joueur_id) REFERENCES joueurs(id) ON DELETE CASCADE,
      FOREIGN KEY (allegeance_id) REFERENCES allegeances(id) ON DELETE CASCADE,
      UNIQUE (joueur_id, allegeance_id)
    );

    CREATE INDEX IF NOT EXISTS idx_repr_allegeance ON representants_allegeance(allegeance_id);
    CREATE INDEX IF NOT EXISTS idx_joueur_allegeances ON joueur_allegeances(joueur_id);

    CREATE TABLE IF NOT EXISTS grille_allegeance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      allegeance_id INTEGER NOT NULL,
      partie_id INTEGER NOT NULL,
      rang INTEGER NOT NULL CHECK (rang IN (1, 2, 3)),
      position INTEGER NOT NULL CHECK (position IN (1, 2, 3)),
      objectif_id INTEGER NOT NULL,
      statut TEXT NOT NULL DEFAULT 'masque' CHECK (statut IN ('masque', 'ouvert', 'valide')),
      completed_at TEXT,
      completed_by_joueur_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (allegeance_id) REFERENCES allegeances(id) ON DELETE CASCADE,
      FOREIGN KEY (partie_id) REFERENCES parties(id) ON DELETE CASCADE,
      FOREIGN KEY (objectif_id) REFERENCES objectifs(id) ON DELETE CASCADE,
      UNIQUE (allegeance_id, partie_id, rang, position)
    );

    CREATE INDEX IF NOT EXISTS idx_grille_allegeance ON grille_allegeance(allegeance_id, partie_id)
  `);

  await assurerColonne(db, 'objectifs', 'niveau', 'INTEGER');
  await assurerColonne(db, 'parties', 'nb_representants_race', 'INTEGER NOT NULL DEFAULT 2');
  await assurerColonne(db, 'parties', 'config_objectifs_race', "TEXT NOT NULL DEFAULT '[2,2,2]'");

  if ((await colonneExiste(db, 'parties', 'nb_representants_rune')) && !(await colonneExiste(db, 'parties', 'nb_representants_allegeance'))) {
    await db.exec('ALTER TABLE parties RENAME COLUMN nb_representants_rune TO nb_representants_allegeance');
  }
  if ((await colonneExiste(db, 'parties', 'config_objectifs_rune')) && !(await colonneExiste(db, 'parties', 'config_objectifs_allegeance'))) {
    await db.exec('ALTER TABLE parties RENAME COLUMN config_objectifs_rune TO config_objectifs_allegeance');
  }
  await retirerColonne(db, 'parties', 'nb_representants_rune');
  await retirerColonne(db, 'parties', 'config_objectifs_rune');

  if ((await colonneExiste(db, 'parties', 'nb_representants_allegiance')) && !(await colonneExiste(db, 'parties', 'nb_representants_allegeance'))) {
    await db.exec('ALTER TABLE parties RENAME COLUMN nb_representants_allegiance TO nb_representants_allegeance');
  }
  if ((await colonneExiste(db, 'parties', 'config_objectifs_allegiance')) && !(await colonneExiste(db, 'parties', 'config_objectifs_allegeance'))) {
    await db.exec('ALTER TABLE parties RENAME COLUMN config_objectifs_allegiance TO config_objectifs_allegeance');
  }
  await retirerColonne(db, 'parties', 'nb_representants_allegiance');
  await retirerColonne(db, 'parties', 'config_objectifs_allegiance');

  await assurerColonne(db, 'parties', 'nb_representants_allegeance', 'INTEGER NOT NULL DEFAULT 2');
  await assurerColonne(db, 'parties', 'config_objectifs_allegeance', "TEXT NOT NULL DEFAULT '[2,2,2]'");
  await assurerColonne(db, 'parties', 'config_niveaux_race', "TEXT NOT NULL DEFAULT '[[null,null],[null,null],[null,null]]'");
  await assurerColonne(db, 'parties', 'config_niveaux_allegeance', "TEXT NOT NULL DEFAULT '[[null,null],[null,null],[null,null]]'");
  await assurerColonne(db, 'allegeances', 'texte_hub', 'TEXT');
  await assurerColonne(db, 'allegeances', 'image_fond', 'TEXT');

  const parametresParDefaut = {
    tableau_de_bord_actif: 'false',
    condition_dernier_rep_allegeance: 'false',
    message_condition_allegeance: ''
  };
  for (const [cle, valeur] of Object.entries(parametresParDefaut)) {
    await db.run('INSERT OR IGNORE INTO parametres (cle, valeur) VALUES (?, ?)', [cle, valeur]);
  }

  const bcrypt = require('bcrypt');
  const adminExiste = await db.get('SELECT id FROM admin WHERE id = 1');
  if (!adminExiste) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.run('INSERT INTO admin (id, password_hash) VALUES (1, ?)', [hash]);
    console.log('Mot de passe admin par defaut initialise (admin123)');
  }

  console.log('Base de donnees initialisee');
}

// Permet d'appeler directement : node database/init.js
if (require.main === module) {
  (async () => {
    const db = await creerDb();
    await initDatabase(db);
    process.exit(0);
  })().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { initDatabase, DB_PATH };
