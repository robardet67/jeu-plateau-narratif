const Database = require('better-sqlite3');
const { initDatabase, DB_PATH } = require('./init');

// Idempotent : cree les tables manquantes et seme le mot de passe admin par defaut si besoin.
initDatabase();

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
