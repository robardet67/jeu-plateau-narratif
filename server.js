const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const session = require('express-session');

const db = require('./database/db');
const { commiterEtPousser } = require('./utils/gitSync');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }
  })
);
// Route explicite avant express.static pour eviter la redirection /admin -> /admin/
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function nommerFichier(req, file, cb) {
  const suffixe = crypto.randomBytes(8).toString('hex');
  cb(null, `${Date.now()}-${suffixe}${path.extname(file.originalname)}`);
}

const stockage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: nommerFichier
});

const uploadImageRace = multer({
  storage: stockage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Le fichier doit etre une image'));
  }
});

const uploadImagesRepresentant = multer({
  storage: stockage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') return cb(null, true);
    cb(new Error('Seuls les fichiers PNG sont acceptes pour les representants'));
  }
});

function supprimerFichierUpload(urlRelative) {
  if (!urlRelative) return;
  const chemin = path.join(__dirname, 'public', urlRelative);
  fs.unlink(chemin, () => {});
}

function genererCodePartie() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function exigerAdmin(req, res, next) {
  if (req.session && req.session.estAdmin) return next();
  res.status(401).json({ error: 'Authentification administrateur requise' });
}

// Les routes admin sont async (elles attendent commiterEtPousser). Sans ce wrapper,
// une erreur levee dans un handler async devient une promesse rejetee non geree,
// ce qui termine le processus Node entier (comportement par defaut depuis Node 15).
function gerer(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// --- API : administration ---

app.post('/api/admin/connexion', (req, res) => {
  const { motDePasse } = req.body;
  const admin = db.prepare('SELECT * FROM admin WHERE id = 1').get();
  if (!admin || !motDePasse || !bcrypt.compareSync(motDePasse, admin.password_hash)) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  req.session.estAdmin = true;
  res.json({ ok: true });
});

app.post('/api/admin/deconnexion', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ connecte: !!(req.session && req.session.estAdmin) });
});

app.post('/api/admin/mot-de-passe', exigerAdmin, (req, res) => {
  const { ancien, nouveau } = req.body;
  const admin = db.prepare('SELECT * FROM admin WHERE id = 1').get();
  if (!ancien || !bcrypt.compareSync(ancien, admin.password_hash)) {
    return res.status(401).json({ error: 'Ancien mot de passe incorrect' });
  }
  if (!nouveau || nouveau.length < 4) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 4 caracteres' });
  }
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = 1').run(bcrypt.hashSync(nouveau, 10));
  res.json({ ok: true });
});

// --- API : races ---

app.get('/api/races', (req, res) => {
  res.json(db.prepare('SELECT * FROM races ORDER BY nom').all());
});

app.post('/api/races', exigerAdmin, uploadImageRace.single('image'), gerer(async (req, res) => {
  const { nom, description } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

  const image = req.file ? `/uploads/${req.file.filename}` : null;
  const result = db
    .prepare('INSERT INTO races (nom, description, image) VALUES (?, ?, ?)')
    .run(nom, description || null, image);

  const synchronisation = await commiterEtPousser(`Admin : ajout de la race "${nom}"`);
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.put('/api/races/:id', exigerAdmin, uploadImageRace.single('image'), gerer(async (req, res) => {
  const race = db.prepare('SELECT * FROM races WHERE id = ?').get(req.params.id);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  const { nom, description } = req.body;
  let image = race.image;
  if (req.file) {
    supprimerFichierUpload(race.image);
    image = `/uploads/${req.file.filename}`;
  }

  db.prepare('UPDATE races SET nom = ?, description = ?, image = ? WHERE id = ?').run(
    nom || race.nom,
    description ?? race.description,
    image,
    race.id
  );

  const synchronisation = await commiterEtPousser(`Admin : modification de la race "${nom || race.nom}"`);
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/races/:id', exigerAdmin, gerer(async (req, res) => {
  const race = db.prepare('SELECT * FROM races WHERE id = ?').get(req.params.id);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  const representants = db.prepare('SELECT * FROM representants WHERE race_id = ?').all(race.id);
  db.prepare('DELETE FROM races WHERE id = ?').run(race.id);

  supprimerFichierUpload(race.image);
  representants.forEach((r) => {
    supprimerFichierUpload(r.image_depart);
    supprimerFichierUpload(r.image_sourire);
  });

  const synchronisation = await commiterEtPousser(`Admin : suppression de la race "${race.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : representants (3 par race, images depart/sourire) ---

app.get('/api/races/:raceId/representants', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM representants WHERE race_id = ? ORDER BY id').all(req.params.raceId)
  );
});

app.post(
  '/api/races/:raceId/representants',
  exigerAdmin,
  uploadImagesRepresentant.fields([
    { name: 'image_depart', maxCount: 1 },
    { name: 'image_sourire', maxCount: 1 }
  ]),
  gerer(async (req, res) => {
    const race = db.prepare('SELECT * FROM races WHERE id = ?').get(req.params.raceId);
    if (!race) return res.status(404).json({ error: 'Race introuvable' });

    const { count } = db
      .prepare('SELECT COUNT(*) AS count FROM representants WHERE race_id = ?')
      .get(race.id);
    if (count >= 3) {
      return res.status(400).json({ error: 'Cette race possede deja 3 representants (maximum)' });
    }

    const { nom, description } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

    const imageDepart = req.files?.image_depart?.[0]
      ? `/uploads/${req.files.image_depart[0].filename}`
      : null;
    const imageSourire = req.files?.image_sourire?.[0]
      ? `/uploads/${req.files.image_sourire[0].filename}`
      : null;

    const result = db
      .prepare(
        'INSERT INTO representants (race_id, nom, description, image_depart, image_sourire) VALUES (?, ?, ?, ?, ?)'
      )
      .run(race.id, nom, description || null, imageDepart, imageSourire);

    const synchronisation = await commiterEtPousser(`Admin : ajout du representant "${nom}"`);
    res.status(201).json({ id: result.lastInsertRowid, synchronisation });
  })
);

app.put(
  '/api/representants/:id',
  exigerAdmin,
  uploadImagesRepresentant.fields([
    { name: 'image_depart', maxCount: 1 },
    { name: 'image_sourire', maxCount: 1 }
  ]),
  gerer(async (req, res) => {
    const representant = db.prepare('SELECT * FROM representants WHERE id = ?').get(req.params.id);
    if (!representant) return res.status(404).json({ error: 'Representant introuvable' });

    const { nom, description } = req.body;
    let imageDepart = representant.image_depart;
    let imageSourire = representant.image_sourire;

    if (req.files?.image_depart?.[0]) {
      supprimerFichierUpload(representant.image_depart);
      imageDepart = `/uploads/${req.files.image_depart[0].filename}`;
    }
    if (req.files?.image_sourire?.[0]) {
      supprimerFichierUpload(representant.image_sourire);
      imageSourire = `/uploads/${req.files.image_sourire[0].filename}`;
    }

    db.prepare(
      'UPDATE representants SET nom = ?, description = ?, image_depart = ?, image_sourire = ? WHERE id = ?'
    ).run(nom || representant.nom, description ?? representant.description, imageDepart, imageSourire, representant.id);

    const synchronisation = await commiterEtPousser(
      `Admin : modification du representant "${nom || representant.nom}"`
    );
    res.json({ ok: true, synchronisation });
  })
);

app.delete('/api/representants/:id', exigerAdmin, gerer(async (req, res) => {
  const representant = db.prepare('SELECT * FROM representants WHERE id = ?').get(req.params.id);
  if (!representant) return res.status(404).json({ error: 'Representant introuvable' });

  db.prepare('DELETE FROM representants WHERE id = ?').run(representant.id);
  supprimerFichierUpload(representant.image_depart);
  supprimerFichierUpload(representant.image_sourire);

  const synchronisation = await commiterEtPousser(`Admin : suppression du representant "${representant.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : dialogues (variantes avec {nom}) ---

app.get('/api/representants/:id/dialogues', (req, res) => {
  res.json(
    db
      .prepare('SELECT * FROM dialogues WHERE representant_id = ? ORDER BY contexte, id')
      .all(req.params.id)
  );
});

app.post('/api/representants/:id/dialogues', exigerAdmin, gerer(async (req, res) => {
  const representant = db.prepare('SELECT * FROM representants WHERE id = ?').get(req.params.id);
  if (!representant) return res.status(404).json({ error: 'Representant introuvable' });

  const { contexte, texte } = req.body;
  if (!contexte || !texte) {
    return res.status(400).json({ error: 'Le contexte et le texte sont requis' });
  }

  const result = db
    .prepare('INSERT INTO dialogues (representant_id, contexte, texte) VALUES (?, ?, ?)')
    .run(representant.id, contexte, texte);

  const synchronisation = await commiterEtPousser(
    `Admin : ajout d'un dialogue pour "${representant.nom}"`
  );
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.put('/api/dialogues/:id', exigerAdmin, gerer(async (req, res) => {
  const dialogue = db.prepare('SELECT * FROM dialogues WHERE id = ?').get(req.params.id);
  if (!dialogue) return res.status(404).json({ error: 'Dialogue introuvable' });

  const { contexte, texte } = req.body;
  db.prepare('UPDATE dialogues SET contexte = ?, texte = ? WHERE id = ?').run(
    contexte || dialogue.contexte,
    texte || dialogue.texte,
    dialogue.id
  );

  const synchronisation = await commiterEtPousser(`Admin : modification d'un dialogue (id ${dialogue.id})`);
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/dialogues/:id', exigerAdmin, gerer(async (req, res) => {
  const dialogue = db.prepare('SELECT * FROM dialogues WHERE id = ?').get(req.params.id);
  if (!dialogue) return res.status(404).json({ error: 'Dialogue introuvable' });

  db.prepare('DELETE FROM dialogues WHERE id = ?').run(dialogue.id);
  const synchronisation = await commiterEtPousser(`Admin : suppression d'un dialogue (id ${dialogue.id})`);
  res.json({ ok: true, synchronisation });
}));

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

// Gestionnaire d'erreurs (ex. rejet multer sur un fichier non-PNG, contrainte SQLite)
app.use((err, req, res, next) => {
  if (!err) return next();
  console.error(err.message);
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'Cette valeur existe deja (nom en double)' });
  }
  res.status(400).json({ error: err.message || 'Erreur serveur' });
});

server.listen(PORT, () => {
  console.log(`Serveur demarre sur le port ${PORT}`);
});
