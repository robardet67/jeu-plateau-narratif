const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = __dirname;
const DB_PATH = path.join(DB_DIR, 'jeu.sqlite');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function colonneExiste(db, table, colonne) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === colonne);
}

function tableExiste(db, table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function assurerColonne(db, table, colonne, definitionSql) {
  if (!colonneExiste(db, table, colonne)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definitionSql}`);
  }
}

function retirerColonne(db, table, colonne) {
  if (colonneExiste(db, table, colonne)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${colonne}`);
  }
}

function initDatabase() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
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

    -- Grille de progression : pour chaque joueur, 3 rangs de representant (celui de sa
    -- race) x 3 positions d'objectif = 9 cases. Le rang+position (pas le representant,
    -- puisque deux joueurs n'ont jamais la meme race) est la cle de partage entre joueurs
    -- pour les objectifs cooperatifs/belliqueux.
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
    CREATE INDEX IF NOT EXISTS idx_parties_code ON parties(code);
  `);

  db.exec('DROP TABLE IF EXISTS joueurs_objectifs');

  // Migrations pour les bases deja existantes (schema races/objectifs modifie, colonnes ajoutees)
  retirerColonne(db, 'races', 'description');
  retirerColonne(db, 'races', 'image');
  assurerColonne(db, 'races', 'image_fond', 'TEXT');
  assurerColonne(db, 'races', 'image_portrait', 'TEXT');
  assurerColonne(db, 'races', 'texte_hub', 'TEXT');
  assurerColonne(db, 'scenario_images', 'texte', 'TEXT');

  if (colonneExiste(db, 'objectifs', 'titre') || colonneExiste(db, 'objectifs', 'points')) {
    assurerColonne(db, 'objectifs', 'niveau', 'TEXT');
    assurerColonne(db, 'objectifs', 'type', 'TEXT');
    assurerColonne(db, 'objectifs', 'categorie', 'TEXT');
    if (colonneExiste(db, 'objectifs', 'titre')) {
      db.exec("UPDATE objectifs SET description = COALESCE(NULLIF(description, ''), titre) WHERE description IS NULL OR description = ''");
      retirerColonne(db, 'objectifs', 'titre');
    }
    retirerColonne(db, 'objectifs', 'points');
  }

  assurerColonne(db, 'parties', 'scenario_index', "INTEGER NOT NULL DEFAULT 0");
  assurerColonne(db, 'parties', 'nb_joueurs_attendus', 'INTEGER NOT NULL DEFAULT 0');

  retirerColonne(db, 'parties', 'nombre_joueurs_prevu');
  retirerColonne(db, 'parties', 'nombre_coop_par_joueur');
  retirerColonne(db, 'parties', 'nb_objectifs_cooperatifs');
  db.exec('DROP TABLE IF EXISTS configuration_emplacements');

  // Les objectifs sont desormais tous identiques (plus de type/niveau/categorie)
  retirerColonne(db, 'objectifs', 'niveau');
  retirerColonne(db, 'objectifs', 'type');
  retirerColonne(db, 'objectifs', 'categorie');

  // La grille passe de 3x3 a 3x2 : supprime les cases de position 3 existantes
  db.exec("DELETE FROM grille_objectifs WHERE position = 3");

  const rangExistaitDeja = colonneExiste(db, 'representants', 'rang');
  assurerColonne(db, 'representants', 'rang', 'INTEGER NOT NULL DEFAULT 1');
  if (!rangExistaitDeja) {
    const representantsParRace = db
      .prepare('SELECT id, race_id FROM representants ORDER BY race_id, id')
      .all();
    const compteurs = {};
    const majRang = db.prepare('UPDATE representants SET rang = ? WHERE id = ?');
    for (const r of representantsParRace) {
      compteurs[r.race_id] = (compteurs[r.race_id] || 0) + 1;
      majRang.run(compteurs[r.race_id], r.id);
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_representants_race_rang ON representants(race_id, rang)');

  // --- v2 : migration depuis "runes" (ancienne version) ---
  if (tableExiste(db, 'runes') && !tableExiste(db, 'allegiances') && !tableExiste(db, 'allegeances')) {
    db.exec('ALTER TABLE runes RENAME TO allegiances');
  }
  if (tableExiste(db, 'representants_rune') && !tableExiste(db, 'representants_allegiance') && !tableExiste(db, 'representants_allegeance')) {
    db.exec('ALTER TABLE representants_rune RENAME TO representants_allegiance');
  }
  if (tableExiste(db, 'representants_allegiance') && colonneExiste(db, 'representants_allegiance', 'rune_id')) {
    db.exec('ALTER TABLE representants_allegiance RENAME COLUMN rune_id TO allegiance_id');
  }
  if (tableExiste(db, 'joueur_runes') && !tableExiste(db, 'joueur_allegiances') && !tableExiste(db, 'joueur_allegeances')) {
    db.exec('ALTER TABLE joueur_runes RENAME TO joueur_allegiances');
  }
  if (tableExiste(db, 'joueur_allegiances') && colonneExiste(db, 'joueur_allegiances', 'rune_id')) {
    db.exec('ALTER TABLE joueur_allegiances RENAME COLUMN rune_id TO allegiance_id');
  }
  db.exec('DROP INDEX IF EXISTS idx_repr_rune');
  db.exec('DROP INDEX IF EXISTS idx_joueur_runes');

  // --- Correction orthographe : allegiances → allegeances ---
  if (tableExiste(db, 'allegiances') && !tableExiste(db, 'allegeances')) {
    db.exec('ALTER TABLE allegiances RENAME TO allegeances');
  }
  if (tableExiste(db, 'representants_allegiance') && !tableExiste(db, 'representants_allegeance')) {
    db.exec('ALTER TABLE representants_allegiance RENAME TO representants_allegeance');
  }
  if (tableExiste(db, 'representants_allegeance') && colonneExiste(db, 'representants_allegeance', 'allegiance_id')) {
    db.exec('ALTER TABLE representants_allegeance RENAME COLUMN allegiance_id TO allegeance_id');
  }
  if (tableExiste(db, 'joueur_allegiances') && !tableExiste(db, 'joueur_allegeances')) {
    db.exec('ALTER TABLE joueur_allegiances RENAME TO joueur_allegeances');
  }
  if (tableExiste(db, 'joueur_allegeances') && colonneExiste(db, 'joueur_allegeances', 'allegiance_id')) {
    db.exec('ALTER TABLE joueur_allegeances RENAME COLUMN allegiance_id TO allegeance_id');
  }

  db.exec(`
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

    -- Grille d'allegeance : une seule grille par allegeance × partie, partagee entre tous
    -- les porteurs de cette allegeance (preparation a la synchronisation cooperative).
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

    CREATE INDEX IF NOT EXISTS idx_grille_allegeance ON grille_allegeance(allegeance_id, partie_id);
  `);

  // v2 : niveau (entier) revient dans les objectifs — pool unique race+allegeance
  assurerColonne(db, 'objectifs', 'niveau', 'INTEGER');

  // v2 : configuration de partie (representants actifs et nb d'objectifs par rang)
  assurerColonne(db, 'parties', 'nb_representants_race', 'INTEGER NOT NULL DEFAULT 2');
  assurerColonne(db, 'parties', 'config_objectifs_race', "TEXT NOT NULL DEFAULT '[2,2,2]'");

  // Migration colonnes _rune → _allegeance (saute l'intermediaire _allegiance)
  if (colonneExiste(db, 'parties', 'nb_representants_rune') && !colonneExiste(db, 'parties', 'nb_representants_allegeance')) {
    db.exec('ALTER TABLE parties RENAME COLUMN nb_representants_rune TO nb_representants_allegeance');
  }
  if (colonneExiste(db, 'parties', 'config_objectifs_rune') && !colonneExiste(db, 'parties', 'config_objectifs_allegeance')) {
    db.exec('ALTER TABLE parties RENAME COLUMN config_objectifs_rune TO config_objectifs_allegeance');
  }
  retirerColonne(db, 'parties', 'nb_representants_rune');
  retirerColonne(db, 'parties', 'config_objectifs_rune');

  // Migration colonnes _allegiance → _allegeance (correction orthographe)
  if (colonneExiste(db, 'parties', 'nb_representants_allegiance') && !colonneExiste(db, 'parties', 'nb_representants_allegeance')) {
    db.exec('ALTER TABLE parties RENAME COLUMN nb_representants_allegiance TO nb_representants_allegeance');
  }
  if (colonneExiste(db, 'parties', 'config_objectifs_allegiance') && !colonneExiste(db, 'parties', 'config_objectifs_allegeance')) {
    db.exec('ALTER TABLE parties RENAME COLUMN config_objectifs_allegiance TO config_objectifs_allegeance');
  }
  retirerColonne(db, 'parties', 'nb_representants_allegiance');
  retirerColonne(db, 'parties', 'config_objectifs_allegiance');

  assurerColonne(db, 'parties', 'nb_representants_allegeance', 'INTEGER NOT NULL DEFAULT 2');
  assurerColonne(db, 'parties', 'config_objectifs_allegeance', "TEXT NOT NULL DEFAULT '[2,2,2]'");
  assurerColonne(db, 'parties', 'config_niveaux_race', "TEXT NOT NULL DEFAULT '[[null,null],[null,null],[null,null]]'");
  assurerColonne(db, 'parties', 'config_niveaux_allegeance', "TEXT NOT NULL DEFAULT '[[null,null],[null,null],[null,null]]'");
  assurerColonne(db, 'allegeances', 'texte_hub', 'TEXT');

  const parametresParDefaut = {
    tableau_de_bord_actif: 'false',
    condition_dernier_rep_allegeance: 'false',
    message_condition_allegeance: ''
  };
  const insererParametre = db.prepare('INSERT OR IGNORE INTO parametres (cle, valeur) VALUES (?, ?)');
  for (const [cle, valeur] of Object.entries(parametresParDefaut)) {
    insererParametre.run(cle, valeur);
  }

  const bcrypt = require('bcrypt');
  const adminExiste = db.prepare('SELECT id FROM admin WHERE id = 1').get();
  if (!adminExiste) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admin (id, password_hash) VALUES (1, ?)').run(hash);
    console.log('Mot de passe admin par defaut initialise (admin123)');
  }

  console.log(`Base de donnees initialisee : ${DB_PATH}`);
  db.close();
}

if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase, DB_PATH };
