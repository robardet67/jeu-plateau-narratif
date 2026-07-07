const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const session = require('express-session');
const { parse } = require('csv-parse/sync');

const { creerDb } = require('./database/db');
const { initDatabase } = require('./database/init');
const { commiterEtPousser } = require('./utils/gitSync');
const { restaurerSiVide } = require('./utils/restaurerContenu');
const {
  obtenirParametre,
  estJoueurTermine,
  deverrouillerRang,
  verifierDeverrouillages,
  validerObjectif,
  deverrouillerRangAllegeance,
  verifierDeverrouillagesAllegeance,
  validerObjectifAllegeance,
  obtenirEtatJoueur,
  calculerClassement,
} = require('./utils/grille');
const { distribuer, distribuerAllegeances } = require('./utils/distribution');

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
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 },
  })
);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function nommerFichier(req, file, cb) {
  const suffixe = crypto.randomBytes(8).toString('hex');
  cb(null, `${Date.now()}-${suffixe}${path.extname(file.originalname)}`);
}

const stockage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: nommerFichier,
});

const uploadImageGenerique = multer({
  storage: stockage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Le fichier doit etre une image'));
  },
});

const uploadImagesRepresentant = multer({
  storage: stockage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') return cb(null, true);
    cb(new Error('Seuls les fichiers PNG sont acceptes pour les representants'));
  },
});

const uploadCsv = multer({ storage: multer.memoryStorage() });

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

function gerer(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// db est initialise dans demarrer() ci-dessous et disponible via closure dans tous les handlers.
let db;

// --- API : administration ---

app.post('/api/admin/connexion', gerer(async (req, res) => {
  const { motDePasse } = req.body;
  const admin = await db.get('SELECT * FROM admin WHERE id = 1');
  if (!admin || !motDePasse || !bcrypt.compareSync(motDePasse, admin.password_hash)) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  req.session.estAdmin = true;
  res.json({ ok: true });
}));

app.post('/api/admin/deconnexion', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ connecte: !!(req.session && req.session.estAdmin) });
});

app.post('/api/admin/mot-de-passe', exigerAdmin, gerer(async (req, res) => {
  const { ancien, nouveau } = req.body;
  const admin = await db.get('SELECT * FROM admin WHERE id = 1');
  if (!ancien || !bcrypt.compareSync(ancien, admin.password_hash)) {
    return res.status(401).json({ error: 'Ancien mot de passe incorrect' });
  }
  if (!nouveau || nouveau.length < 4) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 4 caracteres' });
  }
  await db.run('UPDATE admin SET password_hash = ? WHERE id = 1', [bcrypt.hashSync(nouveau, 10)]);
  res.json({ ok: true });
}));

// --- API : races ---

app.get('/api/races', gerer(async (req, res) => {
  const races = await db.all('SELECT * FROM races ORDER BY nom');
  const result = [];
  for (const race of races) {
    const rep1 = await db.get(
      'SELECT id, nom, rang, image_depart, image_sourire FROM representants WHERE race_id = ? AND rang = 1',
      [race.id]
    );
    result.push({ ...race, representant1: rep1 || null });
  }
  res.json(result);
}));

app.post('/api/races', exigerAdmin, gerer(async (req, res) => {
  const { nom } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

  const result = await db.run('INSERT INTO races (nom) VALUES (?)', [nom]);
  const synchronisation = await commiterEtPousser(db, `Admin : ajout de la race "${nom}"`);
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.put('/api/races/:id', exigerAdmin, gerer(async (req, res) => {
  const race = await db.get('SELECT * FROM races WHERE id = ?', [req.params.id]);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  const { nom, texte_hub } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

  const texteHub = texte_hub !== undefined ? (texte_hub || null) : race.texte_hub;
  await db.run('UPDATE races SET nom = ?, texte_hub = ? WHERE id = ?', [nom, texteHub, race.id]);

  const synchronisation = await commiterEtPousser(db, `Admin : modification de la race "${nom}"`);
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/races/:id', exigerAdmin, gerer(async (req, res) => {
  const race = await db.get('SELECT * FROM races WHERE id = ?', [req.params.id]);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  const representants = await db.all('SELECT * FROM representants WHERE race_id = ?', [race.id]);
  await db.run('DELETE FROM races WHERE id = ?', [race.id]);

  supprimerFichierUpload(race.image_fond);
  supprimerFichierUpload(race.image_portrait);
  representants.forEach((r) => {
    supprimerFichierUpload(r.image_depart);
    supprimerFichierUpload(r.image_sourire);
  });

  const synchronisation = await commiterEtPousser(db, `Admin : suppression de la race "${race.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : portrait de race (image hub) ---

async function pousserEtatJoueursRace(raceId) {
  const joueurs = await db.all(
    'SELECT id, socket_id FROM joueurs WHERE race_id = ? AND socket_id IS NOT NULL AND connecte = 1',
    [raceId]
  );
  for (const j of joueurs) {
    const sock = io.sockets.sockets.get(j.socket_id);
    if (sock) sock.emit('etat_joueur', await obtenirEtatJoueur(db, j.id));
  }
}

async function pousserEtatJoueursAllegeance(allegeanceId) {
  const joueurs = await db.all(
    'SELECT j.id, j.socket_id FROM joueurs j JOIN joueur_allegeances ja ON ja.joueur_id = j.id WHERE ja.allegeance_id = ? AND j.socket_id IS NOT NULL AND j.connecte = 1',
    [allegeanceId]
  );
  for (const j of joueurs) {
    const sock = io.sockets.sockets.get(j.socket_id);
    if (sock) sock.emit('etat_joueur', await obtenirEtatJoueur(db, j.id));
  }
}

app.put('/api/races/:id/portrait', exigerAdmin, uploadImageGenerique.single('image'), gerer(async (req, res) => {
  const race = await db.get('SELECT * FROM races WHERE id = ?', [req.params.id]);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Une image est requise' });

  supprimerFichierUpload(race.image_portrait);
  const imagePortrait = `/uploads/${req.file.filename}`;
  await db.run('UPDATE races SET image_portrait = ? WHERE id = ?', [imagePortrait, race.id]);
  await pousserEtatJoueursRace(race.id);

  const synchronisation = await commiterEtPousser(db, `Admin : portrait de la race "${race.nom}"`);
  res.json({ ok: true, image_portrait: imagePortrait, synchronisation });
}));

app.delete('/api/races/:id/portrait', exigerAdmin, gerer(async (req, res) => {
  const race = await db.get('SELECT * FROM races WHERE id = ?', [req.params.id]);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  supprimerFichierUpload(race.image_portrait);
  await db.run('UPDATE races SET image_portrait = NULL WHERE id = ?', [race.id]);
  await pousserEtatJoueursRace(race.id);

  const synchronisation = await commiterEtPousser(db, `Admin : suppression du portrait de "${race.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : fonds (image de village par race) ---

app.put('/api/races/:id/fond', exigerAdmin, uploadImageGenerique.single('image'), gerer(async (req, res) => {
  const race = await db.get('SELECT * FROM races WHERE id = ?', [req.params.id]);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Une image est requise' });

  supprimerFichierUpload(race.image_fond);
  const imageFond = `/uploads/${req.file.filename}`;
  await db.run('UPDATE races SET image_fond = ? WHERE id = ?', [imageFond, race.id]);

  const synchronisation = await commiterEtPousser(db, `Admin : mise a jour du fond de "${race.nom}"`);
  res.json({ ok: true, image_fond: imageFond, synchronisation });
}));

app.delete('/api/races/:id/fond', exigerAdmin, gerer(async (req, res) => {
  const race = await db.get('SELECT * FROM races WHERE id = ?', [req.params.id]);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  supprimerFichierUpload(race.image_fond);
  await db.run('UPDATE races SET image_fond = NULL WHERE id = ?', [race.id]);

  const synchronisation = await commiterEtPousser(db, `Admin : suppression du fond de "${race.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : representants (3 par race) ---

app.get('/api/races/:raceId/representants', gerer(async (req, res) => {
  res.json(await db.all('SELECT * FROM representants WHERE race_id = ? ORDER BY rang', [req.params.raceId]));
}));

app.post(
  '/api/races/:raceId/representants',
  exigerAdmin,
  uploadImagesRepresentant.fields([
    { name: 'image_depart', maxCount: 1 },
    { name: 'image_sourire', maxCount: 1 },
  ]),
  gerer(async (req, res) => {
    const race = await db.get('SELECT * FROM races WHERE id = ?', [req.params.raceId]);
    if (!race) return res.status(404).json({ error: 'Race introuvable' });

    const rangsExistants = (await db.all('SELECT rang FROM representants WHERE race_id = ?', [race.id])).map((r) => r.rang);
    const rang = [1, 2, 3].find((r) => !rangsExistants.includes(r));
    if (!rang) return res.status(400).json({ error: 'Cette race possede deja 3 representants (maximum)' });

    const { nom, description } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

    const imageDepart = req.files?.image_depart?.[0] ? `/uploads/${req.files.image_depart[0].filename}` : null;
    const imageSourire = req.files?.image_sourire?.[0] ? `/uploads/${req.files.image_sourire[0].filename}` : null;

    const result = await db.run(
      'INSERT INTO representants (race_id, rang, nom, description, image_depart, image_sourire) VALUES (?, ?, ?, ?, ?, ?)',
      [race.id, rang, nom, description || null, imageDepart, imageSourire]
    );

    const synchronisation = await commiterEtPousser(db, `Admin : ajout du representant "${nom}"`);
    res.status(201).json({ id: result.lastInsertRowid, synchronisation });
  })
);

app.put(
  '/api/representants/:id',
  exigerAdmin,
  uploadImagesRepresentant.fields([
    { name: 'image_depart', maxCount: 1 },
    { name: 'image_sourire', maxCount: 1 },
  ]),
  gerer(async (req, res) => {
    const representant = await db.get('SELECT * FROM representants WHERE id = ?', [req.params.id]);
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

    await db.run(
      'UPDATE representants SET nom = ?, description = ?, image_depart = ?, image_sourire = ? WHERE id = ?',
      [nom || representant.nom, description ?? representant.description, imageDepart, imageSourire, representant.id]
    );

    const synchronisation = await commiterEtPousser(db, `Admin : modification du representant "${nom || representant.nom}"`);
    res.json({ ok: true, synchronisation });
  })
);

app.delete('/api/representants/:id', exigerAdmin, gerer(async (req, res) => {
  const representant = await db.get('SELECT * FROM representants WHERE id = ?', [req.params.id]);
  if (!representant) return res.status(404).json({ error: 'Representant introuvable' });

  await db.run('DELETE FROM representants WHERE id = ?', [representant.id]);
  supprimerFichierUpload(representant.image_depart);
  supprimerFichierUpload(representant.image_sourire);

  const synchronisation = await commiterEtPousser(db, `Admin : suppression du representant "${representant.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : dialogues ---

app.get('/api/representants/:id/dialogues', gerer(async (req, res) => {
  res.json(await db.all('SELECT * FROM dialogues WHERE representant_id = ? ORDER BY contexte, id', [req.params.id]));
}));

app.post('/api/representants/:id/dialogues', exigerAdmin, gerer(async (req, res) => {
  const representant = await db.get('SELECT * FROM representants WHERE id = ?', [req.params.id]);
  if (!representant) return res.status(404).json({ error: 'Representant introuvable' });

  const { contexte, texte } = req.body;
  if (!contexte || !texte) return res.status(400).json({ error: 'Le contexte et le texte sont requis' });

  const result = await db.run(
    'INSERT INTO dialogues (representant_id, contexte, texte) VALUES (?, ?, ?)',
    [representant.id, contexte, texte]
  );

  const synchronisation = await commiterEtPousser(db, `Admin : ajout d'un dialogue pour "${representant.nom}"`);
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.put('/api/dialogues/:id', exigerAdmin, gerer(async (req, res) => {
  const dialogue = await db.get('SELECT * FROM dialogues WHERE id = ?', [req.params.id]);
  if (!dialogue) return res.status(404).json({ error: 'Dialogue introuvable' });

  const { contexte, texte } = req.body;
  await db.run('UPDATE dialogues SET contexte = ?, texte = ? WHERE id = ?', [
    contexte || dialogue.contexte,
    texte || dialogue.texte,
    dialogue.id,
  ]);

  const synchronisation = await commiterEtPousser(db, `Admin : modification d'un dialogue (id ${dialogue.id})`);
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/dialogues/:id', exigerAdmin, gerer(async (req, res) => {
  const dialogue = await db.get('SELECT * FROM dialogues WHERE id = ?', [req.params.id]);
  if (!dialogue) return res.status(404).json({ error: 'Dialogue introuvable' });

  await db.run('DELETE FROM dialogues WHERE id = ?', [dialogue.id]);
  const synchronisation = await commiterEtPousser(db, `Admin : suppression d'un dialogue (id ${dialogue.id})`);
  res.json({ ok: true, synchronisation });
}));

// --- API : allegeances ---

app.get('/api/allegeances', gerer(async (req, res) => {
  res.json(await db.all('SELECT * FROM allegeances ORDER BY id'));
}));

app.post('/api/allegeances', exigerAdmin, uploadImageGenerique.single('portrait'), gerer(async (req, res) => {
  const { nom } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

  const row = await db.get('SELECT COUNT(*) AS n FROM allegeances');
  if (row.n >= 3) return res.status(400).json({ error: 'Maximum 3 allegeances autorisees' });

  const portrait = req.file ? `/uploads/${req.file.filename}` : null;
  const result = await db.run('INSERT INTO allegeances (nom, portrait) VALUES (?, ?)', [nom, portrait]);

  const synchronisation = await commiterEtPousser(db, `Admin : ajout de l'allegeance "${nom}"`);
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.put('/api/allegeances/:id', exigerAdmin, uploadImageGenerique.single('portrait'), gerer(async (req, res) => {
  const allegeance = await db.get('SELECT * FROM allegeances WHERE id = ?', [req.params.id]);
  if (!allegeance) return res.status(404).json({ error: 'Allegeance introuvable' });

  const nom = req.body.nom || allegeance.nom;
  const texteHub = req.body.texte_hub !== undefined ? (req.body.texte_hub || null) : allegeance.texte_hub;
  let portrait = allegeance.portrait;
  if (req.file) {
    supprimerFichierUpload(allegeance.portrait);
    portrait = `/uploads/${req.file.filename}`;
  }

  await db.run('UPDATE allegeances SET nom = ?, portrait = ?, texte_hub = ? WHERE id = ?', [nom, portrait, texteHub, allegeance.id]);
  await pousserEtatJoueursAllegeance(allegeance.id);

  const synchronisation = await commiterEtPousser(db, `Admin : modification de l'allegeance "${nom}"`);
  res.json({ ok: true, synchronisation });
}));

app.put('/api/allegeances/:id/fond', exigerAdmin, uploadImageGenerique.single('image'), gerer(async (req, res) => {
  const allegeance = await db.get('SELECT * FROM allegeances WHERE id = ?', [req.params.id]);
  if (!allegeance) return res.status(404).json({ error: 'Allegeance introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Une image est requise' });

  supprimerFichierUpload(allegeance.image_fond);
  const imageFond = `/uploads/${req.file.filename}`;
  await db.run('UPDATE allegeances SET image_fond = ? WHERE id = ?', [imageFond, allegeance.id]);
  await pousserEtatJoueursAllegeance(allegeance.id);

  const synchronisation = await commiterEtPousser(db, `Admin : fond de l'allegeance "${allegeance.nom}"`);
  res.json({ ok: true, image_fond: imageFond, synchronisation });
}));

app.delete('/api/allegeances/:id/fond', exigerAdmin, gerer(async (req, res) => {
  const allegeance = await db.get('SELECT * FROM allegeances WHERE id = ?', [req.params.id]);
  if (!allegeance) return res.status(404).json({ error: 'Allegeance introuvable' });

  supprimerFichierUpload(allegeance.image_fond);
  await db.run('UPDATE allegeances SET image_fond = NULL WHERE id = ?', [allegeance.id]);
  await pousserEtatJoueursAllegeance(allegeance.id);

  const synchronisation = await commiterEtPousser(db, `Admin : suppression du fond de l'allegeance "${allegeance.nom}"`);
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/allegeances/:id', exigerAdmin, gerer(async (req, res) => {
  const allegeance = await db.get('SELECT * FROM allegeances WHERE id = ?', [req.params.id]);
  if (!allegeance) return res.status(404).json({ error: 'Allegeance introuvable' });

  const reps = await db.all('SELECT * FROM representants_allegeance WHERE allegeance_id = ?', [allegeance.id]);
  await db.run('DELETE FROM allegeances WHERE id = ?', [allegeance.id]);

  supprimerFichierUpload(allegeance.portrait);
  supprimerFichierUpload(allegeance.image_fond);
  reps.forEach((r) => {
    supprimerFichierUpload(r.image_depart);
    supprimerFichierUpload(r.image_sourire);
  });

  const synchronisation = await commiterEtPousser(db, `Admin : suppression de l'allegeance "${allegeance.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : representants d'allegeance ---

app.get('/api/allegeances/:allegeanceId/representants', gerer(async (req, res) => {
  res.json(await db.all('SELECT * FROM representants_allegeance WHERE allegeance_id = ? ORDER BY rang', [req.params.allegeanceId]));
}));

app.post(
  '/api/allegeances/:allegeanceId/representants',
  exigerAdmin,
  uploadImagesRepresentant.fields([
    { name: 'image_depart', maxCount: 1 },
    { name: 'image_sourire', maxCount: 1 },
  ]),
  gerer(async (req, res) => {
    const allegeance = await db.get('SELECT * FROM allegeances WHERE id = ?', [req.params.allegeanceId]);
    if (!allegeance) return res.status(404).json({ error: 'Allegeance introuvable' });

    const rangsExistants = (await db.all('SELECT rang FROM representants_allegeance WHERE allegeance_id = ?', [allegeance.id])).map((r) => r.rang);
    const rang = [1, 2, 3].find((r) => !rangsExistants.includes(r));
    if (!rang) return res.status(400).json({ error: 'Cette allegeance possede deja 3 representants (maximum)' });

    const { nom, dialogue } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

    const imageDepart = req.files?.image_depart?.[0] ? `/uploads/${req.files.image_depart[0].filename}` : null;
    const imageSourire = req.files?.image_sourire?.[0] ? `/uploads/${req.files.image_sourire[0].filename}` : null;

    const result = await db.run(
      'INSERT INTO representants_allegeance (allegeance_id, rang, nom, image_depart, image_sourire, dialogue) VALUES (?, ?, ?, ?, ?, ?)',
      [allegeance.id, rang, nom, imageDepart, imageSourire, dialogue || null]
    );

    const synchronisation = await commiterEtPousser(db, `Admin : ajout du representant d'allegeance "${nom}"`);
    res.status(201).json({ id: result.lastInsertRowid, synchronisation });
  })
);

app.put(
  '/api/representants-allegeance/:id',
  exigerAdmin,
  uploadImagesRepresentant.fields([
    { name: 'image_depart', maxCount: 1 },
    { name: 'image_sourire', maxCount: 1 },
  ]),
  gerer(async (req, res) => {
    const rep = await db.get('SELECT * FROM representants_allegeance WHERE id = ?', [req.params.id]);
    if (!rep) return res.status(404).json({ error: "Representant d'allegeance introuvable" });

    let imageDepart = rep.image_depart;
    let imageSourire = rep.image_sourire;
    if (req.files?.image_depart?.[0]) {
      supprimerFichierUpload(rep.image_depart);
      imageDepart = `/uploads/${req.files.image_depart[0].filename}`;
    }
    if (req.files?.image_sourire?.[0]) {
      supprimerFichierUpload(rep.image_sourire);
      imageSourire = `/uploads/${req.files.image_sourire[0].filename}`;
    }

    const nom = req.body.nom || rep.nom;
    const dialogue = req.body.dialogue !== undefined ? req.body.dialogue : rep.dialogue;

    await db.run(
      'UPDATE representants_allegeance SET nom = ?, image_depart = ?, image_sourire = ?, dialogue = ? WHERE id = ?',
      [nom, imageDepart, imageSourire, dialogue, rep.id]
    );

    const synchronisation = await commiterEtPousser(db, `Admin : modification du representant d'allegeance "${nom}"`);
    res.json({ ok: true, synchronisation });
  })
);

app.delete('/api/representants-allegeance/:id', exigerAdmin, gerer(async (req, res) => {
  const rep = await db.get('SELECT * FROM representants_allegeance WHERE id = ?', [req.params.id]);
  if (!rep) return res.status(404).json({ error: "Representant d'allegeance introuvable" });

  await db.run('DELETE FROM representants_allegeance WHERE id = ?', [rep.id]);
  supprimerFichierUpload(rep.image_depart);
  supprimerFichierUpload(rep.image_sourire);

  const synchronisation = await commiterEtPousser(db, `Admin : suppression du representant d'allegeance "${rep.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : objectifs ---

app.get('/api/objectifs', gerer(async (req, res) => {
  res.json(await db.all('SELECT * FROM objectifs ORDER BY id DESC'));
}));

app.post('/api/objectifs', exigerAdmin, gerer(async (req, res) => {
  const { description, niveau } = req.body;
  if (!description) return res.status(400).json({ error: 'La description est requise' });

  const niveauVal = niveau !== undefined && niveau !== '' ? parseInt(niveau) : null;
  const result = await db.run('INSERT INTO objectifs (description, niveau) VALUES (?, ?)', [description, niveauVal]);

  const synchronisation = await commiterEtPousser(db, "Admin : ajout d'un objectif");
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.put('/api/objectifs/:id', exigerAdmin, gerer(async (req, res) => {
  const objectif = await db.get('SELECT * FROM objectifs WHERE id = ?', [req.params.id]);
  if (!objectif) return res.status(404).json({ error: 'Objectif introuvable' });

  const { description, niveau } = req.body;
  const niveauVal = niveau !== undefined && niveau !== '' ? parseInt(niveau) : objectif.niveau;
  await db.run('UPDATE objectifs SET description = ?, niveau = ? WHERE id = ?', [
    description || objectif.description,
    niveauVal,
    objectif.id,
  ]);

  const synchronisation = await commiterEtPousser(db, `Admin : modification d'un objectif (id ${objectif.id})`);
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/objectifs/:id', exigerAdmin, gerer(async (req, res) => {
  const objectif = await db.get('SELECT * FROM objectifs WHERE id = ?', [req.params.id]);
  if (!objectif) return res.status(404).json({ error: 'Objectif introuvable' });

  await db.run('DELETE FROM objectifs WHERE id = ?', [objectif.id]);

  const synchronisation = await commiterEtPousser(db, `Admin : suppression d'un objectif (id ${objectif.id})`);
  res.json({ ok: true, synchronisation });
}));

app.post('/api/objectifs/import', exigerAdmin, uploadCsv.single('fichier'), gerer(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Un fichier CSV est requis' });

  const mode = req.body.mode === 'remplacer' ? 'remplacer' : 'ajouter';

  let lignes;
  try {
    lignes = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true, delimiter: [',', ';'] });
  } catch (erreur) {
    return res.status(400).json({ error: `Fichier CSV invalide : ${erreur.message}` });
  }

  const lignesNormalisees = lignes.map((ligne) => {
    const normalisee = {};
    for (const [cle, valeur] of Object.entries(ligne)) {
      normalisee[cle.trim().toLowerCase()] = typeof valeur === 'string' ? valeur.trim() : valeur;
    }
    return normalisee;
  });

  const { importes, supprimes } = await db.transact(async (tx) => {
    let supprimes = 0;
    if (mode === 'remplacer') {
      const r = await tx.run('DELETE FROM objectifs');
      supprimes = r.changes || 0;
    }
    let compteur = 0;
    for (const ligne of lignesNormalisees) {
      if (!ligne.description) continue;
      const niveauVal = ligne.niveau !== undefined && ligne.niveau !== '' ? parseInt(ligne.niveau) : null;
      await tx.run('INSERT INTO objectifs (description, niveau) VALUES (?, ?)', [ligne.description, isNaN(niveauVal) ? null : niveauVal]);
      compteur++;
    }
    return { importes: compteur, supprimes };
  });

  const synchronisation = await commiterEtPousser(db, `Admin : import CSV de ${importes} objectifs (mode ${mode})`);
  res.json({ ok: true, importes, supprimes, mode, synchronisation });
}));

// --- API : scenario ---

app.get('/api/scenario', gerer(async (req, res) => {
  res.json(await db.all('SELECT * FROM scenario_images ORDER BY ordre ASC'));
}));

app.post('/api/scenario', exigerAdmin, uploadImageGenerique.single('image'), gerer(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Une image est requise' });

  const row = await db.get('SELECT COALESCE(MAX(ordre), 0) AS max FROM scenario_images');
  const image = `/uploads/${req.file.filename}`;
  const texte = req.body.texte || null;
  const result = await db.run('INSERT INTO scenario_images (ordre, image, texte) VALUES (?, ?, ?)', [row.max + 1, image, texte]);

  const synchronisation = await commiterEtPousser(db, "Admin : ajout d'une image de scenario");
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.put('/api/scenario/:id', exigerAdmin, gerer(async (req, res) => {
  const image = await db.get('SELECT * FROM scenario_images WHERE id = ?', [req.params.id]);
  if (!image) return res.status(404).json({ error: 'Image introuvable' });

  const texte = req.body.texte !== undefined ? (req.body.texte || null) : image.texte;
  await db.run('UPDATE scenario_images SET texte = ? WHERE id = ?', [texte, image.id]);

  const synchronisation = await commiterEtPousser(db, 'Admin : texte de la diapositive modifie');
  res.json({ ok: true, synchronisation });
}));

app.post('/api/scenario/:id/deplacer', exigerAdmin, gerer(async (req, res) => {
  const image = await db.get('SELECT * FROM scenario_images WHERE id = ?', [req.params.id]);
  if (!image) return res.status(404).json({ error: 'Image introuvable' });

  const { direction } = req.body;
  const voisin = direction === 'haut'
    ? await db.get('SELECT * FROM scenario_images WHERE ordre < ? ORDER BY ordre DESC LIMIT 1', [image.ordre])
    : await db.get('SELECT * FROM scenario_images WHERE ordre > ? ORDER BY ordre ASC LIMIT 1', [image.ordre]);

  if (!voisin) return res.json({ ok: true });

  // Passe par une valeur temporaire negative pour eviter la violation de UNIQUE(ordre)
  await db.transact(async (tx) => {
    await tx.run('UPDATE scenario_images SET ordre = -1 WHERE id = ?', [image.id]);
    await tx.run('UPDATE scenario_images SET ordre = ? WHERE id = ?', [image.ordre, voisin.id]);
    await tx.run('UPDATE scenario_images SET ordre = ? WHERE id = ?', [voisin.ordre, image.id]);
  });

  const synchronisation = await commiterEtPousser(db, 'Admin : reordonnancement du scenario');
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/scenario/:id', exigerAdmin, gerer(async (req, res) => {
  const image = await db.get('SELECT * FROM scenario_images WHERE id = ?', [req.params.id]);
  if (!image) return res.status(404).json({ error: 'Image introuvable' });

  await db.run('DELETE FROM scenario_images WHERE id = ?', [image.id]);
  supprimerFichierUpload(image.image);

  const restantes = await db.all('SELECT * FROM scenario_images ORDER BY ordre ASC');
  await db.transact(async (tx) => {
    for (let i = 0; i < restantes.length; i++) {
      await tx.run('UPDATE scenario_images SET ordre = ? WHERE id = ?', [i + 1, restantes[i].id]);
    }
  });

  const synchronisation = await commiterEtPousser(db, "Admin : suppression d'une image de scenario");
  res.json({ ok: true, synchronisation });
}));

// --- API : parametres globaux ---

app.get('/api/parametres', gerer(async (req, res) => {
  res.json({
    tableau_de_bord_actif: (await obtenirParametre(db, 'tableau_de_bord_actif')) === 'true',
    condition_dernier_rep_allegeance: (await obtenirParametre(db, 'condition_dernier_rep_allegeance')) === 'true',
    message_condition_allegeance: (await obtenirParametre(db, 'message_condition_allegeance')) || '',
  });
}));

app.post('/api/admin/parametres', exigerAdmin, gerer(async (req, res) => {
  const booleen = (v) => (v ? 'true' : 'false');
  const boolKeys = ['tableau_de_bord_actif', 'condition_dernier_rep_allegeance'];
  const texteKeys = ['message_condition_allegeance'];

  for (const cle of boolKeys) {
    if (cle in req.body) {
      const v = booleen(req.body[cle]);
      await db.run('INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = ?', [cle, v, v]);
    }
  }
  for (const cle of texteKeys) {
    if (cle in req.body) {
      const v = req.body[cle] || '';
      await db.run('INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = ?', [cle, v, v]);
    }
  }

  const synchronisation = await commiterEtPousser(db, 'Admin : mise a jour des parametres');
  res.json({ ok: true, synchronisation });
}));

// --- API : grille / tableau de bord ---

app.get('/api/joueurs/:id/etat', gerer(async (req, res) => {
  const etat = await obtenirEtatJoueur(db, Number(req.params.id));
  if (!etat) return res.status(404).json({ error: 'Joueur introuvable' });
  res.json(etat);
}));

app.get('/api/parties/:code/tableau-de-bord', gerer(async (req, res) => {
  if ((await obtenirParametre(db, 'tableau_de_bord_actif')) !== 'true') {
    return res.status(403).json({ error: 'Tableau de bord desactive' });
  }

  const partie = await db.get('SELECT * FROM parties WHERE code = ?', [req.params.code.toUpperCase()]);
  if (!partie) return res.status(404).json({ error: 'Partie introuvable' });

  const classement = await calculerClassement(db, partie.id);
  const joueurs = await db.all('SELECT id FROM joueurs WHERE partie_id = ?', [partie.id]);

  const detail = [];
  for (const j of joueurs) {
    const etat = await obtenirEtatJoueur(db, j.id);
    if (!etat) continue;

    const quetesRace = (etat.rangs || [])
      .filter((r) => r.deverrouille && r.toutesLesCasesValidees && r.representant)
      .map((r) => ({ nomRepresentant: r.representant.nom, type: 'race' }));

    const quetesAllegeance = (etat.allegeances || []).flatMap((alleg) =>
      (alleg.rangs || [])
        .filter((r) => r.deverrouille && r.toutesLesCasesValidees && r.representant)
        .map((r) => ({ nomRepresentant: r.representant.nom, nomAllegeance: alleg.nom, type: 'allegeance' }))
    );

    const objRace = (etat.rangs || []).flatMap((r) =>
      (r.cases || [])
        .filter((c) => c.statut === 'valide' && c.objectif)
        .map((c) => ({ description: c.objectif.description, nomRepresentant: r.representant ? r.representant.nom : null, type: 'race' }))
    );

    const objAllegeance = (etat.allegeances || []).flatMap((alleg) =>
      (alleg.rangs || []).flatMap((r) =>
        (r.cases || [])
          .filter((c) => c.statut === 'valide' && c.objectif)
          .map((c) => ({ description: c.objectif.description, nomRepresentant: r.representant ? r.representant.nom : null, nomAllegeance: alleg.nom, type: 'allegeance' }))
      )
    );

    detail.push({
      joueurId: etat.joueurId,
      raceNom: etat.raceNom,
      imagePortraitRace: etat.imagePortraitRace || null,
      quetes: [...quetesRace, ...quetesAllegeance],
      objectifsValides: [...objRace, ...objAllegeance],
    });
  }

  // Fusionne classement (rang + scores) avec detail (quetes/objectifs)
  const resultat = classement.map((entree) => {
    const d = detail.find((x) => x.joueurId === entree.id) || {};
    return {
      joueurId: entree.id,
      pseudo: entree.pseudo,
      rang: entree.rang,
      nbQuetes: entree.quetes,
      nbValides: entree.valides,
      imagePortraitRace: entree.imagePortrait || d.imagePortraitRace || null,
      raceNom: d.raceNom || null,
      quetes: d.quetes || [],
      objectifsValides: d.objectifsValides || [],
    };
  });

  res.json(resultat);
}));

// --- API : partie active ---

async function obtenirPartieActive() {
  return db.get("SELECT * FROM parties WHERE statut IN ('en_attente', 'en_cours') ORDER BY id DESC LIMIT 1");
}

async function joueursDeLaPartie(partieId) {
  return db.all(
    'SELECT id, pseudo, race_id, representant_id, position, score, connecte, est_hote FROM joueurs WHERE partie_id = ?',
    [partieId]
  );
}

async function tenterLancementPartie(partieId) {
  const partie = await db.get('SELECT * FROM parties WHERE id = ?', [partieId]);
  if (!partie || partie.statut !== 'en_attente') {
    return { lance: false, raison: 'La partie est deja lancee ou terminee' };
  }

  const joueurs = await joueursDeLaPartie(partieId);
  if (joueurs.some((j) => !j.race_id)) {
    return { lance: false, raison: "Tous les joueurs n'ont pas encore choisi leur race" };
  }
  const racesDistinctes = new Set(joueurs.map((j) => j.race_id));
  if (racesDistinctes.size !== joueurs.length) {
    return { lance: false, raison: 'Deux joueurs ont choisi la meme race' };
  }

  let configObj;
  try { configObj = JSON.parse(partie.config_objectifs_race || '[2,2,2]'); } catch { configObj = [2, 2, 2]; }
  const nbRepRace = partie.nb_representants_race ?? 3;
  const nbObjectifsParJoueur = configObj.slice(0, nbRepRace).reduce((s, n) => s + n, 0);

  let configObjAlleg;
  try { configObjAlleg = JSON.parse(partie.config_objectifs_allegeance || '[2,2,2]'); } catch { configObjAlleg = [2, 2, 2]; }
  const nbRepAlleg = partie.nb_representants_allegeance ?? 2;
  const nbObjectifsParAllegeance = configObjAlleg.slice(0, nbRepAlleg).reduce((s, n) => s + n, 0);

  const allegeancesUniques = await db.all(
    'SELECT DISTINCT allegeance_id FROM joueur_allegeances WHERE joueur_id IN (' + joueurs.map(() => '?').join(',') + ')',
    joueurs.map((j) => j.id)
  );
  const nbAllegeancesUniques = allegeancesUniques.length;

  const nbObjectifsNecessaires = joueurs.length * nbObjectifsParJoueur + nbAllegeancesUniques * nbObjectifsParAllegeance;
  const rowCount = await db.get('SELECT COUNT(*) AS n FROM objectifs');
  if (rowCount.n < nbObjectifsNecessaires) {
    return {
      lance: false,
      raison: `Pool insuffisant : ${rowCount.n} objectif(s) disponible(s), ${nbObjectifsNecessaires} requis`,
    };
  }

  try {
    await distribuer(db, { partieId, joueurIds: joueurs.map((j) => j.id) });
    await distribuerAllegeances(db, { partieId, joueurIds: joueurs.map((j) => j.id) });
  } catch (erreur) {
    return { lance: false, raison: erreur.message };
  }

  await db.run("UPDATE parties SET statut = 'en_cours' WHERE id = ?", [partieId]);
  for (const j of joueurs) {
    await deverrouillerRang(db, j.id, partieId, 1);
  }

  io.to(partie.code).emit('partie_lancee');

  const joueursConnectes = await db.all(
    'SELECT id, socket_id FROM joueurs WHERE partie_id = ? AND socket_id IS NOT NULL',
    [partieId]
  );
  for (const j of joueursConnectes) {
    io.to(j.socket_id).emit('etat_joueur', await obtenirEtatJoueur(db, j.id));
  }

  return { lance: true };
}

async function verifierLancementAutomatique(partieId) {
  const partie = await db.get('SELECT * FROM parties WHERE id = ?', [partieId]);
  if (!partie || partie.statut !== 'en_attente') return;

  if (!partie.nb_joueurs_attendus || partie.nb_joueurs_attendus <= 0) {
    console.log('[auto-launch] desactive (nb_joueurs_attendus = 0)');
    return;
  }

  const joueurs = await joueursDeLaPartie(partieId);
  const nbAvecRace = joueurs.filter((j) => j.race_id).length;
  console.log(`[auto-launch] joueurs=${joueurs.length}/${partie.nb_joueurs_attendus}, avec race=${nbAvecRace}/${joueurs.length}`);

  if (joueurs.length < partie.nb_joueurs_attendus) return;
  if (joueurs.some((j) => !j.race_id)) return;

  console.log('[auto-launch] conditions remplies, tentative de lancement...');
  const resultat = await tenterLancementPartie(partieId);
  console.log('[auto-launch] resultat :', resultat);
}

// --- Cote joueur ---

app.get('/api/partie-active', gerer(async (req, res) => {
  const partie = await obtenirPartieActive();
  if (!partie) return res.json({ active: false });
  res.json({ active: true, ...partie, joueurs: await joueursDeLaPartie(partie.id) });
}));

app.post('/api/partie-active/rejoindre', gerer(async (req, res) => {
  const { pseudo, password, race_id, allegeance_ids } = req.body;
  if (!pseudo) return res.status(400).json({ error: 'Le pseudo est requis' });
  if (!race_id) return res.status(400).json({ error: 'La race est requise' });

  const partie = await obtenirPartieActive();
  if (!partie) return res.status(404).json({ error: 'Aucune partie configuree par le maitre du jeu pour le moment' });
  if (partie.statut !== 'en_attente') return res.status(400).json({ error: 'La partie a deja demarre, impossible de la rejoindre' });

  const race = await db.get('SELECT * FROM races WHERE id = ?', [race_id]);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  const dejaPrise = await db.get('SELECT id FROM joueurs WHERE partie_id = ? AND race_id = ?', [partie.id, race_id]);
  if (dejaPrise) return res.status(409).json({ error: 'Cette race est deja jouee par un autre joueur' });

  const idsAllegeances = Array.isArray(allegeance_ids)
    ? [...new Set(allegeance_ids.map(Number).filter(Boolean))].slice(0, 2)
    : [];

  const premierJoueur = !(await db.get('SELECT id FROM joueurs WHERE partie_id = ? LIMIT 1', [partie.id]));
  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;

  const rangUn = await db.get('SELECT id FROM representants WHERE race_id = ? AND rang = 1', [race_id]);

  const joueur = await db.run(
    'INSERT INTO joueurs (partie_id, pseudo, password_hash, race_id, representant_id, est_hote) VALUES (?, ?, ?, ?, ?, ?)',
    [partie.id, pseudo, passwordHash, race_id, rangUn ? rangUn.id : null, premierJoueur ? 1 : 0]
  );

  const joueurId = joueur.lastInsertRowid;

  for (const aid of idsAllegeances) {
    const alleg = await db.get('SELECT id FROM allegeances WHERE id = ?', [aid]);
    if (alleg) {
      await db.run('INSERT OR IGNORE INTO joueur_allegeances (joueur_id, allegeance_id) VALUES (?, ?)', [joueurId, aid]);
    }
  }

  res.status(201).json({ partieId: partie.id, code: partie.code, joueurId });
}));

// --- Cote MJ (admin) ---

app.get('/api/admin/partie-active', exigerAdmin, gerer(async (req, res) => {
  const partie = await obtenirPartieActive();
  if (!partie) return res.json({ active: false });
  res.json({ active: true, ...partie, joueurs: await joueursDeLaPartie(partie.id) });
}));

app.post('/api/admin/partie-active/creer', exigerAdmin, gerer(async (req, res) => {
  const existante = await obtenirPartieActive();
  if (existante) {
    return res.json({ active: true, ...existante, joueurs: await joueursDeLaPartie(existante.id) });
  }

  const nbJoueursAttendu = parseInt(req.body.nb_joueurs_attendus) || 0;
  const nbRepRace = Math.min(3, Math.max(0, parseInt(req.body.nb_representants_race) ?? 2));
  const nbRepAllegeance = Math.min(3, Math.max(0, parseInt(req.body.nb_representants_allegeance) ?? 2));

  if (nbRepRace === 0 && nbRepAllegeance === 0) {
    return res.status(400).json({ error: 'Il faut au moins 1 representant actif (race ou allegeance)' });
  }

  const parseConfig = (val, defaut) => {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr) && arr.length === 3) return JSON.stringify(arr.map((v) => Math.min(3, Math.max(1, parseInt(v) || 2))));
    } catch {}
    return defaut;
  };

  const configRace = parseConfig(req.body.config_objectifs_race, '[2,2,2]');
  const configAllegeance = parseConfig(req.body.config_objectifs_allegeance, '[2,2,2]');

  let configNiveauxRace = '[[null,null],[null,null],[null,null]]';
  try { const p = JSON.parse(req.body.config_niveaux_race); if (Array.isArray(p)) configNiveauxRace = JSON.stringify(p); } catch {}

  let configNiveauxAllegeance = '[[null,null],[null,null],[null,null]]';
  try { const p = JSON.parse(req.body.config_niveaux_allegeance); if (Array.isArray(p)) configNiveauxAllegeance = JSON.stringify(p); } catch {}

  let code;
  do {
    code = genererCodePartie();
  } while (await db.get('SELECT id FROM parties WHERE code = ?', [code]));

  const partie = await db.run(
    'INSERT INTO parties (code, nom, nb_joueurs_attendus, nb_representants_race, nb_representants_allegeance, config_objectifs_race, config_objectifs_allegeance, config_niveaux_race, config_niveaux_allegeance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [code, `Partie ${code}`, nbJoueursAttendu, nbRepRace, nbRepAllegeance, configRace, configAllegeance, configNiveauxRace, configNiveauxAllegeance]
  );
  const nouvelle = await db.get('SELECT * FROM parties WHERE id = ?', [partie.lastInsertRowid]);
  res.status(201).json({ active: true, ...nouvelle, joueurs: [] });
}));

app.post('/api/admin/partie-active/lancer', exigerAdmin, gerer(async (req, res) => {
  const partie = await obtenirPartieActive();
  if (!partie) return res.status(404).json({ error: 'Aucune partie active' });

  const resultat = await tenterLancementPartie(partie.id);
  if (!resultat.lance) return res.status(400).json({ error: resultat.raison });

  const synchronisation = await commiterEtPousser(db, 'Admin : lancement de la partie');
  res.json({ ok: true, synchronisation });
}));

app.post('/api/admin/partie-active/reinitialiser', exigerAdmin, gerer(async (req, res) => {
  const partie = await obtenirPartieActive();
  if (!partie) return res.status(404).json({ error: 'Aucune partie active' });

  await db.run("UPDATE parties SET statut = 'terminee' WHERE id = ?", [partie.id]);
  io.to(partie.code).emit('partie_annulee', { message: 'La partie a ete annulee par le maitre du jeu.' });
  res.json({ ok: true });
}));

app.post('/api/admin/partie-active/terminer', exigerAdmin, gerer(async (req, res) => {
  const partie = await obtenirPartieActive();
  if (!partie) return res.status(404).json({ error: 'Aucune partie active' });

  await db.run("UPDATE parties SET statut = 'terminee' WHERE id = ?", [partie.id]);

  const classement = await calculerClassement(db, partie.id);
  io.to(partie.code).emit('partie_terminee', { classement });
  res.json({ ok: true, classement });
}));

app.post('/api/admin/partie-active/rouvrir', exigerAdmin, gerer(async (req, res) => {
  const partie = await db.get("SELECT * FROM parties WHERE statut = 'terminee' ORDER BY id DESC LIMIT 1");
  if (!partie) return res.status(404).json({ error: 'Aucune partie terminee a rouvrir' });

  await db.run("UPDATE parties SET statut = 'en_cours' WHERE id = ?", [partie.id]);
  io.to(partie.code).emit('partie_rouverte', { message: 'La partie a ete rouverte par le maitre du jeu.' });
  res.json({ ok: true });
}));

app.get('/api/admin/partie-recente', exigerAdmin, gerer(async (req, res) => {
  const partie = await db.get('SELECT * FROM parties ORDER BY id DESC LIMIT 1');
  if (!partie) return res.json({ active: false });
  res.json({ active: true, statut: partie.statut, id: partie.id, code: partie.code });
}));

app.get('/api/admin/partie-active/suivi', exigerAdmin, gerer(async (req, res) => {
  const partie = await obtenirPartieActive();
  if (!partie) return res.status(404).json({ error: 'Aucune partie active' });

  const joueurs = await db.all(
    `SELECT j.id, j.pseudo, j.connecte, j.race_id, r.nom AS race_nom,
            (SELECT COUNT(*) FROM grille_objectifs g WHERE g.joueur_id = j.id AND g.statut = 'valide') AS valides
     FROM joueurs j LEFT JOIN races r ON r.id = j.race_id
     WHERE j.partie_id = ?`,
    [partie.id]
  );

  res.json({ partie, joueurs });
}));

// --- Socket.IO ---

io.on('connection', (socket) => {
  socket.on('rejoindre_partie', async ({ code, joueurId }) => {
    try {
      const partie = await db.get('SELECT * FROM parties WHERE code = ?', [code.toUpperCase()]);
      if (!partie) return socket.emit('erreur', { message: 'Partie introuvable' });

      await db.run('UPDATE joueurs SET socket_id = ?, connecte = 1 WHERE id = ?', [socket.id, joueurId]);

      socket.join(code.toUpperCase());
      socket.data.code = code.toUpperCase();
      socket.data.joueurId = joueurId;

      const joueurs = await db.all(
        'SELECT id, pseudo, race_id, representant_id, position, score, connecte, est_hote FROM joueurs WHERE partie_id = ?',
        [partie.id]
      );

      io.to(code.toUpperCase()).emit('etat_partie', { partie, joueurs });
      await verifierLancementAutomatique(partie.id);
    } catch (err) {
      console.error('[socket] rejoindre_partie :', err.message);
    }
  });

  socket.on('choix_race', async ({ joueurId, raceId }) => {
    try {
      const race = await db.get('SELECT * FROM races WHERE id = ?', [raceId]);
      if (!race) return socket.emit('erreur', { message: 'Race introuvable' });

      const joueurActuel = await db.get('SELECT * FROM joueurs WHERE id = ?', [joueurId]);
      if (!joueurActuel) return socket.emit('erreur', { message: 'Joueur introuvable' });

      const dejaPrise = await db.get(
        'SELECT id FROM joueurs WHERE partie_id = ? AND race_id = ? AND id != ?',
        [joueurActuel.partie_id, raceId, joueurId]
      );
      if (dejaPrise) return socket.emit('erreur', { message: 'Cette race est deja jouee par un autre joueur de la partie' });

      const rangUn = await db.get('SELECT id FROM representants WHERE race_id = ? AND rang = 1', [raceId]);
      await db.run('UPDATE joueurs SET race_id = ?, representant_id = ? WHERE id = ?', [raceId, rangUn ? rangUn.id : null, joueurId]);

      const partieDuJoueur = await db.get('SELECT * FROM parties WHERE id = ?', [joueurActuel.partie_id]);
      if (partieDuJoueur && partieDuJoueur.statut === 'en_cours') {
        await deverrouillerRang(db, joueurId, joueurActuel.partie_id, 1);
      }

      socket.emit('etat_joueur', await obtenirEtatJoueur(db, joueurId));
      if (socket.data.code) io.to(socket.data.code).emit('joueur_maj', { joueurId, raceId });

      if (partieDuJoueur && partieDuJoueur.statut === 'en_attente') {
        await verifierLancementAutomatique(joueurActuel.partie_id);
      }
    } catch (err) {
      console.error('[socket] choix_race :', err.message);
    }
  });

  socket.on('deplacement', async ({ joueurId, position }) => {
    try {
      await db.run('UPDATE joueurs SET position = ? WHERE id = ?', [position, joueurId]);
      if (socket.data.code) io.to(socket.data.code).emit('joueur_deplace', { joueurId, position });
    } catch (err) {
      console.error('[socket] deplacement :', err.message);
    }
  });

  socket.on('grille_ouvrir', async ({ joueurId, ligneId }) => {
    try {
      const joueurOuvrir = await db.get('SELECT partie_id FROM joueurs WHERE id = ?', [joueurId]);
      if (joueurOuvrir) {
        const partieOuvrir = await db.get('SELECT statut FROM parties WHERE id = ?', [joueurOuvrir.partie_id]);
        if (partieOuvrir?.statut === 'terminee') {
          return socket.emit('notification', { message: 'La partie est terminee, les actions sont bloquees.' });
        }
      }

      const ligne = await db.get('SELECT * FROM grille_objectifs WHERE id = ? AND joueur_id = ?', [ligneId, joueurId]);
      if (!ligne || ligne.statut !== 'ferme') return;

      await db.run("UPDATE grille_objectifs SET statut = 'ouvert' WHERE id = ?", [ligne.id]);
      socket.emit('etat_joueur', await obtenirEtatJoueur(db, joueurId));
    } catch (err) {
      console.error('[socket] grille_ouvrir :', err.message);
    }
  });

  socket.on('grille_valider', async ({ joueurId, ligneId }) => {
    try {
      const joueurValider = await db.get('SELECT partie_id FROM joueurs WHERE id = ?', [joueurId]);
      if (joueurValider) {
        const partieValider = await db.get('SELECT statut FROM parties WHERE id = ?', [joueurValider.partie_id]);
        if (partieValider?.statut === 'terminee') {
          return socket.emit('notification', { message: 'La partie est terminee, les actions sont bloquees.' });
        }
      }

      let resultat;
      try {
        resultat = await validerObjectif(db, { joueurId, ligneId });
      } catch (erreur) {
        return socket.emit('erreur', { message: erreur.message });
      }

      await verifierDeverrouillages(db, joueurId, resultat.partieId);
      socket.emit('etat_joueur', await obtenirEtatJoueur(db, joueurId));

      if (socket.data.code && (await obtenirParametre(db, 'tableau_de_bord_actif')) === 'true') {
        io.to(socket.data.code).emit('tableau_de_bord_maj');
      }

      if (resultat.partieTerminee && socket.data.code) {
        await db.run("UPDATE parties SET statut = 'terminee' WHERE id = ?", [resultat.partieId]);
        const classement = await calculerClassement(db, resultat.partieId);
        io.to(socket.data.code).emit('partie_terminee', { classement });
      }
    } catch (err) {
      console.error('[socket] grille_valider :', err.message);
    }
  });

  socket.on('grille_valider_allegeance', async ({ joueurId, allegeanceId, partieId, ligneId }) => {
    try {
      const partieAlleg = await db.get('SELECT statut FROM parties WHERE id = ?', [partieId]);
      if (partieAlleg?.statut === 'terminee') {
        return socket.emit('notification', { message: 'La partie est terminee, les actions sont bloquees.' });
      }

      const lienJoueur = await db.get(
        'SELECT * FROM joueur_allegeances WHERE joueur_id = ? AND allegeance_id = ?',
        [joueurId, allegeanceId]
      );
      if (!lienJoueur) return socket.emit('erreur', { message: 'Vous ne portez pas cette allegeance' });

      try {
        await validerObjectifAllegeance(db, { allegeanceId, partieId, ligneId, joueurId });
      } catch (erreur) {
        return socket.emit('erreur', { message: erreur.message });
      }

      await verifierDeverrouillagesAllegeance(db, allegeanceId, partieId);

      const allegeance = await db.get('SELECT nom FROM allegeances WHERE id = ?', [allegeanceId]);
      const validateur = await db.get('SELECT pseudo FROM joueurs WHERE id = ?', [joueurId]);
      const porteurs = await db.all(
        'SELECT j.id, j.socket_id FROM joueurs j JOIN joueur_allegeances ja ON ja.joueur_id = j.id WHERE ja.allegeance_id = ? AND j.partie_id = ?',
        [allegeanceId, partieId]
      );

      for (const porteur of porteurs) {
        if (!porteur.socket_id) continue;
        io.to(porteur.socket_id).emit('etat_joueur', await obtenirEtatJoueur(db, porteur.id));
        if (porteur.id !== joueurId) {
          io.to(porteur.socket_id).emit('notification', {
            message: `${validateur.pseudo} a valide un objectif de l'allegeance ${allegeance ? allegeance.nom : ''} !`,
          });
        }
      }

      if (socket.data.code && (await obtenirParametre(db, 'tableau_de_bord_actif')) === 'true') {
        io.to(socket.data.code).emit('tableau_de_bord_maj');
      }

      if (socket.data.code) {
        for (const p of porteurs) {
          if (await estJoueurTermine(db, p.id)) {
            await db.run("UPDATE parties SET statut = 'terminee' WHERE id = ?", [partieId]);
            const classement = await calculerClassement(db, partieId);
            io.to(socket.data.code).emit('partie_terminee', { classement });
            break;
          }
        }
      }
    } catch (err) {
      console.error('[socket] grille_valider_allegeance :', err.message);
    }
  });

  socket.on('scenario_naviguer', async ({ index }) => {
    try {
      if (!socket.data.code || !socket.data.joueurId) return;

      const joueur = await db.get('SELECT * FROM joueurs WHERE id = ?', [socket.data.joueurId]);
      if (!joueur || !joueur.est_hote) return;

      const partie = await db.get('SELECT * FROM parties WHERE code = ?', [socket.data.code]);
      if (!partie) return;

      await db.run('UPDATE parties SET scenario_index = ? WHERE id = ?', [index, partie.id]);
      io.to(socket.data.code).emit('scenario_maj', { index });
    } catch (err) {
      console.error('[socket] scenario_naviguer :', err.message);
    }
  });

  socket.on('disconnect', async () => {
    try {
      if (socket.data.joueurId) {
        await db.run('UPDATE joueurs SET connecte = 0 WHERE id = ?', [socket.data.joueurId]);
        if (socket.data.code) {
          io.to(socket.data.code).emit('joueur_deconnecte', { joueurId: socket.data.joueurId });
        }
      }
    } catch (err) {
      console.error('[socket] disconnect :', err.message);
    }
  });
});

// Gestionnaire d'erreurs Express
app.use((err, req, res, next) => {
  if (!err) return next();
  console.error(err.message);
  if (
    err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (err.message && err.message.includes('UNIQUE constraint failed'))
  ) {
    return res.status(409).json({ error: 'Cette valeur existe deja (nom en double)' });
  }
  res.status(400).json({ error: err.message || 'Erreur serveur' });
});

// --- Demarrage async ---

(async () => {
  try {
    db = await creerDb();
    await initDatabase(db);

    const resultatRestauration = await restaurerSiVide(db);
    if (resultatRestauration.restaure) {
      console.log('[DB] Contenu restaure depuis la sauvegarde JSON :', resultatRestauration.compteurs);
    } else {
      console.log('[DB] Donnees existantes conservees (' + resultatRestauration.raison + ')');
    }

    server.listen(PORT, () => {
      console.log(`Serveur demarre sur le port ${PORT}`);
    });
  } catch (err) {
    console.error('Erreur fatale au demarrage :', err);
    process.exit(1);
  }
})();
