'use strict';

// Interface async unifiee pour better-sqlite3 (local) et @libsql/client (Turso).
// Toutes les methodes retournent des Promises, ce qui permet d'ecrire le meme code
// qu'on soit en dev local ou en production sur Turso.

// --- Utilitaires communs ---

function filtrerStmts(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      const lignes = s.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      return lignes.some((l) => !l.startsWith('--'));
    });
}

// Convertit une Row libsql en objet JS ordinaire en utilisant rs.columns comme cle.
function rowVersObjet(row, columns) {
  const obj = {};
  for (const col of columns) {
    const v = row[col.name];
    // libsql renvoie des BigInt pour INTEGER ; on normalise en Number.
    obj[col.name] = typeof v === 'bigint' ? Number(v) : v;
  }
  return obj;
}

// --- Adaptateur local (better-sqlite3) ---

function creerAdapteurLocal(rawDb) {
  return {
    async get(sql, args = []) {
      const row = rawDb.prepare(sql).get(...args);
      return row ?? null;
    },
    async all(sql, args = []) {
      return rawDb.prepare(sql).all(...args);
    },
    async run(sql, args = []) {
      const r = rawDb.prepare(sql).run(...args);
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes };
    },
    async exec(sql) {
      rawDb.exec(sql);
    },
    // transact(fn) : fn recoit un objet tx avec les memes methodes.
    // En local, on ne cree pas de vraie transaction SQLite car fn est async —
    // la base etant utilisee en dev uniquement, la perte d'atomicite est acceptable.
    async transact(fn) {
      const self = this;
      return fn({
        get: self.get.bind(self),
        all: self.all.bind(self),
        run: self.run.bind(self),
        exec: self.exec.bind(self),
      });
    },
    // batch(statements) : tableau de { sql, args } ou de chaines, executes atomiquement.
    async batch(statements) {
      const tx = rawDb.transaction(() => {
        for (const s of statements) {
          if (typeof s === 'string') rawDb.exec(s);
          else rawDb.prepare(s.sql).run(...(s.args || []));
        }
      });
      tx();
    },
  };
}

// --- Adaptateur Turso (@libsql/client) ---

function creerAdapteurTurso(url, token) {
  const { createClient } = require('@libsql/client');
  const client = createClient({ url, authToken: token });

  async function execStmt(executor, sql, args) {
    const rs = await executor.execute({ sql, args: args || [] });
    return rs;
  }

  function adapterSurExecutor(executor) {
    return {
      async get(sql, args = []) {
        const rs = await execStmt(executor, sql, args);
        return rs.rows.length > 0 ? rowVersObjet(rs.rows[0], rs.columns) : null;
      },
      async all(sql, args = []) {
        const rs = await execStmt(executor, sql, args);
        return rs.rows.map((row) => rowVersObjet(row, rs.columns));
      },
      async run(sql, args = []) {
        const rs = await execStmt(executor, sql, args);
        return {
          lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null,
          changes: rs.rowsAffected,
        };
      },
      async exec(sql) {
        const stmts = filtrerStmts(sql);
        for (const stmt of stmts) {
          await executor.execute(stmt);
        }
      },
    };
  }

  const base = adapterSurExecutor(client);

  return {
    ...base,
    async transact(fn) {
      const tx = await client.transaction('write');
      try {
        const result = await fn(adapterSurExecutor(tx));
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    },
    async batch(statements) {
      const prepared = statements.map((s) => {
        if (typeof s === 'string') return { sql: s, args: [] };
        return { sql: s.sql, args: s.args || [] };
      });
      await client.batch(prepared, 'write');
    },
  };
}

module.exports = { creerAdapteurLocal, creerAdapteurTurso };
