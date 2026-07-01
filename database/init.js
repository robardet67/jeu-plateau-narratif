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

    CREATE TABLE IF NOT EXISTS joueurs_objectifs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      joueur_id INTEGER NOT NULL,
      objectif_id INTEGER NOT NULL,
      statut TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'termine', 'echoue')),
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (joueur_id) REFERENCES joueurs(id) ON DELETE CASCADE,
      FOREIGN KEY (objectif_id) REFERENCES objectifs(id) ON DELETE CASCADE,
      UNIQUE (joueur_id, objectif_id)
    );

    CREATE INDEX IF NOT EXISTS idx_representants_race ON representants(race_id);
    CREATE INDEX IF NOT EXISTS idx_dialogues_representant ON dialogues(representant_id);
    CREATE INDEX IF NOT EXISTS idx_joueurs_partie ON joueurs(partie_id);
    CREATE INDEX IF NOT EXISTS idx_joueurs_objectifs_joueur ON joueurs_objectifs(joueur_id);
    CREATE INDEX IF NOT EXISTS idx_joueurs_objectifs_objectif ON joueurs_objectifs(objectif_id);
    CREATE INDEX IF NOT EXISTS idx_parties_code ON parties(code);
  `);

  // Migrations pour les bases deja existantes (schema races/objectifs modifie, colonnes ajoutees)
  retirerColonne(db, 'races', 'description');
  retirerColonne(db, 'races', 'image');
  assurerColonne(db, 'races', 'image_fond', 'TEXT');

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
