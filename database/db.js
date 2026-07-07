const path = require('path');
const { creerAdapteurLocal, creerAdapteurTurso } = require('./adapter');

const DB_DIR = __dirname;
const DB_PATH = path.join(DB_DIR, 'jeu.sqlite');

// Cree et retourne l'adaptateur de base de donnees :
//   - Si TURSO_DATABASE_URL + TURSO_AUTH_TOKEN sont definis → Turso (@libsql/client)
//   - Sinon → fichier SQLite local (better-sqlite3), pour le developpement
async function creerDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (url && token) {
    console.log('[DB] Mode Turso :', url);
    return creerAdapteurTurso(url, token);
  }

  const Database = require('better-sqlite3');
  const rawDb = new Database(DB_PATH);
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('foreign_keys = ON');
  console.log('[DB] Mode local :', DB_PATH);
  return creerAdapteurLocal(rawDb);
}

module.exports = { creerDb, DB_PATH };
