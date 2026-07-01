const fs = require('fs');
const Database = require('better-sqlite3');
const { initDatabase, DB_PATH } = require('./init');

if (!fs.existsSync(DB_PATH)) {
  initDatabase();
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
