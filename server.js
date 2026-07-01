const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db = require('./database/db');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const suffix = crypto.randomBytes(8).toString('hex');
      cb(null, `${Date.now()}-${suffix}${path.extname(file.originalname)}`);
    }
  })
});

function genererCodePartie() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// --- API : races ---

app.get('/api/races', (req, res) => {
  const races = db.prepare('SELECT * FROM races ORDER BY nom').all();
  res.json(races);
});

app.get('/api/races/:id/representants', (req, res) => {
  const representants = db
    .prepare('SELECT * FROM representants WHERE race_id = ? ORDER BY nom')
    .all(req.params.id);
  res.json(representants);
});

app.post('/api/races', upload.single('image'), (req, res) => {
  const { nom, description } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom est requis' });
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  const result = db
    .prepare('INSERT INTO races (nom, description, image) VALUES (?, ?, ?)')
    .run(nom, description || null, image);
  res.status(201).json({ id: result.lastInsertRowid });
});

// --- API : objectifs ---

app.get('/api/objectifs', (req, res) => {
  res.json(db.prepare('SELECT * FROM objectifs ORDER BY id').all());
});

app.post('/api/objectifs', (req, res) => {
  const { titre, description, points } = req.body;
  if (!titre) return res.status(400).json({ error: 'Le titre est requis' });
  const result = db
    .prepare('INSERT INTO objectifs (titre, description, points) VALUES (?, ?, ?)')
    .run(titre, description || null, points || 0);
  res.status(201).json({ id: result.lastInsertRowid });
});

// --- API : parties ---

app.post('/api/parties', (req, res) => {
  const { nom, pseudo, password } = req.body;
  if (!pseudo) return res.status(400).json({ error: 'Le pseudo est requis' });

  let code;
  do {
    code = genererCodePartie();
  } while (db.prepare('SELECT id FROM parties WHERE code = ?').get(code));

  const partie = db
    .prepare('INSERT INTO parties (code, nom) VALUES (?, ?)')
    .run(code, nom || `Partie ${code}`);

  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;
  const joueur = db
    .prepare(
      'INSERT INTO joueurs (partie_id, pseudo, password_hash, est_hote) VALUES (?, ?, ?, 1)'
    )
    .run(partie.lastInsertRowid, pseudo, passwordHash);

  res.status(201).json({
    partieId: partie.lastInsertRowid,
    code,
    joueurId: joueur.lastInsertRowid
  });
});

app.post('/api/parties/:code/join', (req, res) => {
  const { pseudo, password } = req.body;
  if (!pseudo) return res.status(400).json({ error: 'Le pseudo est requis' });

  const partie = db
    .prepare('SELECT * FROM parties WHERE code = ?')
    .get(req.params.code.toUpperCase());
  if (!partie) return res.status(404).json({ error: 'Partie introuvable' });

  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;
  const joueur = db
    .prepare('INSERT INTO joueurs (partie_id, pseudo, password_hash) VALUES (?, ?, ?)')
    .run(partie.id, pseudo, passwordHash);

  res.status(201).json({ partieId: partie.id, joueurId: joueur.lastInsertRowid });
});

app.get('/api/parties/:code', (req, res) => {
  const partie = db
    .prepare('SELECT * FROM parties WHERE code = ?')
    .get(req.params.code.toUpperCase());
  if (!partie) return res.status(404).json({ error: 'Partie introuvable' });

  const joueurs = db
    .prepare('SELECT id, pseudo, race_id, representant_id, position, score, connecte FROM joueurs WHERE partie_id = ?')
    .all(partie.id);

  res.json({ ...partie, joueurs });
});

// --- Socket.IO : temps reel ---

io.on('connection', (socket) => {
  socket.on('rejoindre_partie', ({ code, joueurId }) => {
    const partie = db.prepare('SELECT * FROM parties WHERE code = ?').get(code.toUpperCase());
    if (!partie) return socket.emit('erreur', { message: 'Partie introuvable' });

    db.prepare('UPDATE joueurs SET socket_id = ?, connecte = 1 WHERE id = ?').run(
      socket.id,
      joueurId
    );

    socket.join(code.toUpperCase());
    socket.data.code = code.toUpperCase();
    socket.data.joueurId = joueurId;

    const joueurs = db
      .prepare(
        'SELECT id, pseudo, race_id, representant_id, position, score, connecte FROM joueurs WHERE partie_id = ?'
      )
      .all(partie.id);

    io.to(code.toUpperCase()).emit('etat_partie', { partie, joueurs });
  });

  socket.on('choix_personnage', ({ joueurId, raceId, representantId }) => {
    db.prepare('UPDATE joueurs SET race_id = ?, representant_id = ? WHERE id = ?').run(
      raceId,
      representantId,
      joueurId
    );
    if (socket.data.code) {
      io.to(socket.data.code).emit('joueur_maj', { joueurId, raceId, representantId });
    }
  });

  socket.on('deplacement', ({ joueurId, position }) => {
    db.prepare('UPDATE joueurs SET position = ? WHERE id = ?').run(position, joueurId);
    if (socket.data.code) {
      io.to(socket.data.code).emit('joueur_deplace', { joueurId, position });
    }
  });

  socket.on('objectif_complete', ({ joueurId, objectifId }) => {
    const objectif = db.prepare('SELECT * FROM objectifs WHERE id = ?').get(objectifId);
    if (!objectif) return;

    db.prepare(
      `INSERT INTO joueurs_objectifs (joueur_id, objectif_id, statut, completed_at)
       VALUES (?, ?, 'termine', datetime('now'))
       ON CONFLICT(joueur_id, objectif_id) DO UPDATE SET statut = 'termine', completed_at = datetime('now')`
    ).run(joueurId, objectifId);

    db.prepare('UPDATE joueurs SET score = score + ? WHERE id = ?').run(
      objectif.points,
      joueurId
    );

    if (socket.data.code) {
      io.to(socket.data.code).emit('objectif_maj', { joueurId, objectifId, points: objectif.points });
    }
  });

  socket.on('message_chat', ({ pseudo, texte }) => {
    if (socket.data.code) {
      io.to(socket.data.code).emit('message_chat', { pseudo, texte, date: Date.now() });
    }
  });

  socket.on('disconnect', () => {
    if (socket.data.joueurId) {
      db.prepare('UPDATE joueurs SET connecte = 0 WHERE id = ?').run(socket.data.joueurId);
      if (socket.data.code) {
        io.to(socket.data.code).emit('joueur_deconnecte', { joueurId: socket.data.joueurId });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Serveur demarre sur le port ${PORT}`);
});
