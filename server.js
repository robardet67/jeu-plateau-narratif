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

const db = require('./database/db');
const { commiterEtPousser } = require('./utils/gitSync');
const { restaurerSiVide } = require('./utils/restaurerContenu');
const {
  obtenirParametre,
  deverrouillerRang,
  verifierDeverrouillages,
  verifierDevoilementPosition3,
  validerObjectif,
  obtenirEtatJoueur
} = require('./utils/grille');
const { validerNombreCooperatifs, verifierPool, genererEmplacements, distribuer } = require('./utils/distribution');

// Sur un serveur fraichement deploye (base SQLite vide, non versionnee), recharge le
// contenu admin depuis la sauvegarde JSON versionnee sur GitHub (voir utils/exportContenu.js).
const resultatRestauration = restaurerSiVide(db);
if (resultatRestauration.restaure) {
  console.log('Contenu restaure depuis la sauvegarde JSON :', resultatRestauration.compteurs);
}

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

// Utilisee pour les fonds de race et les images de scenario (n'importe quel format image)
const uploadImageGenerique = multer({
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

app.post('/api/races', exigerAdmin, gerer(async (req, res) => {
  const { nom } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

  const result = db.prepare('INSERT INTO races (nom) VALUES (?)').run(nom);

  const synchronisation = await commiterEtPousser(`Admin : ajout de la race "${nom}"`);
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.put('/api/races/:id', exigerAdmin, gerer(async (req, res) => {
  const race = db.prepare('SELECT * FROM races WHERE id = ?').get(req.params.id);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  const { nom } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

  db.prepare('UPDATE races SET nom = ? WHERE id = ?').run(nom, race.id);

  const synchronisation = await commiterEtPousser(`Admin : modification de la race "${nom}"`);
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/races/:id', exigerAdmin, gerer(async (req, res) => {
  const race = db.prepare('SELECT * FROM races WHERE id = ?').get(req.params.id);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  const representants = db.prepare('SELECT * FROM representants WHERE race_id = ?').all(race.id);
  db.prepare('DELETE FROM races WHERE id = ?').run(race.id);

  supprimerFichierUpload(race.image_fond);
  representants.forEach((r) => {
    supprimerFichierUpload(r.image_depart);
    supprimerFichierUpload(r.image_sourire);
  });

  const synchronisation = await commiterEtPousser(`Admin : suppression de la race "${race.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : fonds (image de village par race) ---

app.put('/api/races/:id/fond', exigerAdmin, uploadImageGenerique.single('image'), gerer(async (req, res) => {
  const race = db.prepare('SELECT * FROM races WHERE id = ?').get(req.params.id);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Une image est requise' });

  supprimerFichierUpload(race.image_fond);
  const imageFond = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE races SET image_fond = ? WHERE id = ?').run(imageFond, race.id);

  const synchronisation = await commiterEtPousser(`Admin : mise a jour du fond de "${race.nom}"`);
  res.json({ ok: true, image_fond: imageFond, synchronisation });
}));

app.delete('/api/races/:id/fond', exigerAdmin, gerer(async (req, res) => {
  const race = db.prepare('SELECT * FROM races WHERE id = ?').get(req.params.id);
  if (!race) return res.status(404).json({ error: 'Race introuvable' });

  supprimerFichierUpload(race.image_fond);
  db.prepare('UPDATE races SET image_fond = NULL WHERE id = ?').run(race.id);

  const synchronisation = await commiterEtPousser(`Admin : suppression du fond de "${race.nom}"`);
  res.json({ ok: true, synchronisation });
}));

// --- API : representants (3 par race, images depart/sourire) ---

app.get('/api/races/:raceId/representants', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM representants WHERE race_id = ? ORDER BY rang').all(req.params.raceId)
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

    const rangsExistants = db
      .prepare('SELECT rang FROM representants WHERE race_id = ?')
      .all(race.id)
      .map((r) => r.rang);
    const rang = [1, 2, 3].find((r) => !rangsExistants.includes(r));
    if (!rang) {
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
        'INSERT INTO representants (race_id, rang, nom, description, image_depart, image_sourire) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(race.id, rang, nom, description || null, imageDepart, imageSourire);

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

// --- API : objectifs (description, niveau, type, categorie) ---

app.get('/api/objectifs', (req, res) => {
  const { niveau, type, categorie } = req.query;
  let sql = 'SELECT * FROM objectifs WHERE 1 = 1';
  const params = [];
  if (niveau) {
    sql += ' AND niveau = ?';
    params.push(niveau);
  }
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (categorie) {
    sql += ' AND categorie = ?';
    params.push(categorie);
  }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/objectifs', exigerAdmin, gerer(async (req, res) => {
  const { description, niveau, type, categorie } = req.body;
  if (!description) return res.status(400).json({ error: 'La description est requise' });

  const result = db
    .prepare('INSERT INTO objectifs (description, niveau, type, categorie) VALUES (?, ?, ?, ?)')
    .run(description, niveau || null, type || null, categorie || null);

  const synchronisation = await commiterEtPousser("Admin : ajout d'un objectif");
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.put('/api/objectifs/:id', exigerAdmin, gerer(async (req, res) => {
  const objectif = db.prepare('SELECT * FROM objectifs WHERE id = ?').get(req.params.id);
  if (!objectif) return res.status(404).json({ error: 'Objectif introuvable' });

  const { description, niveau, type, categorie } = req.body;
  db.prepare('UPDATE objectifs SET description = ?, niveau = ?, type = ?, categorie = ? WHERE id = ?').run(
    description || objectif.description,
    niveau ?? objectif.niveau,
    type ?? objectif.type,
    categorie ?? objectif.categorie,
    objectif.id
  );

  const synchronisation = await commiterEtPousser(`Admin : modification d'un objectif (id ${objectif.id})`);
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/objectifs/:id', exigerAdmin, gerer(async (req, res) => {
  const objectif = db.prepare('SELECT * FROM objectifs WHERE id = ?').get(req.params.id);
  if (!objectif) return res.status(404).json({ error: 'Objectif introuvable' });

  db.prepare('DELETE FROM objectifs WHERE id = ?').run(objectif.id);

  const synchronisation = await commiterEtPousser(`Admin : suppression d'un objectif (id ${objectif.id})`);
  res.json({ ok: true, synchronisation });
}));

app.post('/api/objectifs/import', exigerAdmin, uploadCsv.single('fichier'), gerer(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Un fichier CSV est requis' });

  let lignes;
  try {
    lignes = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
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

  const insertion = db.prepare(
    'INSERT INTO objectifs (description, niveau, type, categorie) VALUES (?, ?, ?, ?)'
  );
  const importerTout = db.transaction((rows) => {
    let compteur = 0;
    for (const ligne of rows) {
      if (!ligne.description) continue;
      insertion.run(ligne.description, ligne.niveau || null, ligne.type || null, ligne.categorie || null);
      compteur++;
    }
    return compteur;
  });

  const importes = importerTout(lignesNormalisees);

  const synchronisation = await commiterEtPousser(`Admin : import CSV de ${importes} objectifs`);
  res.json({ ok: true, importes, synchronisation });
}));

// --- API : scenario (images ordonnees, defilees par le maitre du jeu) ---

app.get('/api/scenario', (req, res) => {
  res.json(db.prepare('SELECT * FROM scenario_images ORDER BY ordre ASC').all());
});

app.post('/api/scenario', exigerAdmin, uploadImageGenerique.single('image'), gerer(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Une image est requise' });

  const { max } = db.prepare('SELECT COALESCE(MAX(ordre), 0) AS max FROM scenario_images').get();
  const image = `/uploads/${req.file.filename}`;
  const result = db.prepare('INSERT INTO scenario_images (ordre, image) VALUES (?, ?)').run(max + 1, image);

  const synchronisation = await commiterEtPousser("Admin : ajout d'une image de scenario");
  res.status(201).json({ id: result.lastInsertRowid, synchronisation });
}));

app.post('/api/scenario/:id/deplacer', exigerAdmin, gerer(async (req, res) => {
  const image = db.prepare('SELECT * FROM scenario_images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image introuvable' });

  const { direction } = req.body;
  const voisin =
    direction === 'haut'
      ? db.prepare('SELECT * FROM scenario_images WHERE ordre < ? ORDER BY ordre DESC LIMIT 1').get(image.ordre)
      : db.prepare('SELECT * FROM scenario_images WHERE ordre > ? ORDER BY ordre ASC LIMIT 1').get(image.ordre);

  if (!voisin) return res.json({ ok: true });

  // Passe par une valeur temporaire negative : un echange direct viole momentanement
  // la contrainte UNIQUE(ordre) puisque les deux lignes existent encore simultanement.
  const echanger = db.transaction(() => {
    db.prepare('UPDATE scenario_images SET ordre = -1 WHERE id = ?').run(image.id);
    db.prepare('UPDATE scenario_images SET ordre = ? WHERE id = ?').run(image.ordre, voisin.id);
    db.prepare('UPDATE scenario_images SET ordre = ? WHERE id = ?').run(voisin.ordre, image.id);
  });
  echanger();

  const synchronisation = await commiterEtPousser('Admin : reordonnancement du scenario');
  res.json({ ok: true, synchronisation });
}));

app.delete('/api/scenario/:id', exigerAdmin, gerer(async (req, res) => {
  const image = db.prepare('SELECT * FROM scenario_images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image introuvable' });

  db.prepare('DELETE FROM scenario_images WHERE id = ?').run(image.id);
  supprimerFichierUpload(image.image);

  const restantes = db.prepare('SELECT * FROM scenario_images ORDER BY ordre ASC').all();
  const renumeroter = db.transaction((images) => {
    images.forEach((img, index) => {
      db.prepare('UPDATE scenario_images SET ordre = ? WHERE id = ?').run(index + 1, img.id);
    });
  });
  renumeroter(restantes);

  const synchronisation = await commiterEtPousser("Admin : suppression d'une image de scenario");
  res.json({ ok: true, synchronisation });
}));

// --- API : parametres globaux ---

app.get('/api/parametres', (req, res) => {
  res.json({ tableau_de_bord_actif: obtenirParametre(db, 'tableau_de_bord_actif') === 'true' });
});

app.post('/api/admin/parametres', exigerAdmin, gerer(async (req, res) => {
  const { tableau_de_bord_actif: actif } = req.body;
  db.prepare('INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = ?').run(
    'tableau_de_bord_actif',
    actif ? 'true' : 'false',
    actif ? 'true' : 'false'
  );

  const synchronisation = await commiterEtPousser('Admin : mise a jour des parametres');
  res.json({ ok: true, synchronisation });
}));

// --- API : grille de progression / tableau de bord ---

app.get('/api/joueurs/:id/etat', (req, res) => {
  const etat = obtenirEtatJoueur(db, Number(req.params.id));
  if (!etat) return res.status(404).json({ error: 'Joueur introuvable' });
  res.json(etat);
});

app.get('/api/parties/:code/tableau-de-bord', (req, res) => {
  if (obtenirParametre(db, 'tableau_de_bord_actif') !== 'true') {
    return res.status(403).json({ error: 'Tableau de bord desactive' });
  }

  const partie = db.prepare('SELECT * FROM parties WHERE code = ?').get(req.params.code.toUpperCase());
  if (!partie) return res.status(404).json({ error: 'Partie introuvable' });

  const joueurs = db.prepare('SELECT id, pseudo FROM joueurs WHERE partie_id = ?').all(partie.id);
  const resultat = joueurs.map((j) => ({
    joueurId: j.id,
    pseudo: j.pseudo,
    objectifsValides: db
      .prepare(
        `SELECT g.rang, g.position, g.completed_at, o.description, o.niveau, o.type, o.categorie
         FROM grille_objectifs g JOIN objectifs o ON o.id = g.objectif_id
         WHERE g.joueur_id = ? AND g.statut = 'valide'
         ORDER BY g.completed_at`
      )
      .all(j.id)
  }));

  res.json(resultat);
});

// --- API : partie active (une seule partie a la fois, creee/configuree/lancee par le MJ) ---

function obtenirPartieActive(db) {
  return db
    .prepare("SELECT * FROM parties WHERE statut IN ('en_attente', 'en_cours') ORDER BY id DESC LIMIT 1")
    .get();
}

function joueursDeLaPartie(partieId) {
  return db
    .prepare(
      'SELECT id, pseudo, race_id, representant_id, position, score, connecte, est_hote FROM joueurs WHERE partie_id = ?'
    )
    .all(partieId);
}

// Le MJ configure la partie en amont (nombre de joueurs, emplacements). Le jour J, il
// rejoint comme un joueur normal : la partie se lance donc automatiquement des que
// l'effectif attendu est complet et que chacun a choisi une race distincte, sans bouton
// a cliquer. Reutilise pour le bouton manuel "Lancer la partie" (filet de securite/reprise
// apres reconfiguration, ex. un joueur absent le jour J).
function tenterLancementPartie(partieId) {
  const partie = db.prepare('SELECT * FROM parties WHERE id = ?').get(partieId);
  if (!partie || partie.statut !== 'en_attente') {
    return { lance: false, raison: 'La partie est deja lancee ou terminee' };
  }
  if (!partie.nombre_joueurs_prevu) {
    return { lance: false, raison: "Le nombre de joueurs n'est pas encore configure" };
  }

  const joueurs = joueursDeLaPartie(partieId);
  if (joueurs.length !== partie.nombre_joueurs_prevu) {
    return {
      lance: false,
      raison: `${joueurs.length} joueur(s) present(s), ${partie.nombre_joueurs_prevu} attendu(s) selon la configuration`
    };
  }
  if (joueurs.some((j) => !j.race_id)) {
    return { lance: false, raison: "Tous les joueurs n'ont pas encore choisi leur race" };
  }
  const racesDistinctes = new Set(joueurs.map((j) => j.race_id));
  if (racesDistinctes.size !== joueurs.length) {
    return { lance: false, raison: 'Deux joueurs ont choisi la meme race' };
  }

  const emplacements = db
    .prepare('SELECT * FROM configuration_emplacements WHERE partie_id = ?')
    .all(partieId);
  if (emplacements.length < 9) {
    return { lance: false, raison: 'Les 9 emplacements ne sont pas encore tous configures' };
  }

  const verification = verifierPool(db, partie.nombre_joueurs_prevu, emplacements);
  if (!verification.suffisant) {
    return { lance: false, raison: verification.message };
  }

  try {
    distribuer(db, { partieId, joueurIds: joueurs.map((j) => j.id), emplacements });
  } catch (erreur) {
    return { lance: false, raison: erreur.message };
  }

  db.prepare("UPDATE parties SET statut = 'en_cours' WHERE id = ?").run(partieId);
  joueurs.forEach((j) => deverrouillerRang(db, j.id, partieId, 1));
  io.to(partie.code).emit('partie_lancee');

  return { lance: true };
}

// --- Cote joueur ---

app.get('/api/partie-active', (req, res) => {
  const partie = obtenirPartieActive(db);
  if (!partie) return res.json({ active: false });
  res.json({ active: true, ...partie, joueurs: joueursDeLaPartie(partie.id) });
});

app.post('/api/partie-active/rejoindre', (req, res) => {
  const { pseudo, password } = req.body;
  if (!pseudo) return res.status(400).json({ error: 'Le pseudo est requis' });

  const partie = obtenirPartieActive(db);
  if (!partie) return res.status(404).json({ error: 'Aucune partie configuree par le maitre du jeu pour le moment' });
  if (partie.statut !== 'en_attente') {
    return res.status(400).json({ error: 'La partie a deja demarre, impossible de la rejoindre' });
  }

  const premierJoueur = !db.prepare('SELECT id FROM joueurs WHERE partie_id = ? LIMIT 1').get(partie.id);
  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;
  const joueur = db
    .prepare('INSERT INTO joueurs (partie_id, pseudo, password_hash, est_hote) VALUES (?, ?, ?, ?)')
    .run(partie.id, pseudo, passwordHash, premierJoueur ? 1 : 0);

  res.status(201).json({ partieId: partie.id, code: partie.code, joueurId: joueur.lastInsertRowid });
});

// --- Cote MJ (admin) ---

app.get('/api/admin/partie-active', exigerAdmin, (req, res) => {
  const partie = obtenirPartieActive(db);
  if (!partie) return res.json({ active: false });

  const emplacements = db
    .prepare('SELECT * FROM configuration_emplacements WHERE partie_id = ? ORDER BY rang, position')
    .all(partie.id);

  res.json({ active: true, ...partie, joueurs: joueursDeLaPartie(partie.id), emplacements });
});

app.post('/api/admin/partie-active/creer', exigerAdmin, (req, res) => {
  const existante = obtenirPartieActive(db);
  if (existante) {
    return res.json({ active: true, ...existante, joueurs: joueursDeLaPartie(existante.id) });
  }

  let code;
  do {
    code = genererCodePartie();
  } while (db.prepare('SELECT id FROM parties WHERE code = ?').get(code));

  const partie = db.prepare('INSERT INTO parties (code, nom) VALUES (?, ?)').run(code, `Partie ${code}`);
  const nouvelle = db.prepare('SELECT * FROM parties WHERE id = ?').get(partie.lastInsertRowid);
  res.status(201).json({ active: true, ...nouvelle, joueurs: [] });
});

// Minimum d'intervention du MJ : il saisit juste N et K, tout le reste (les 9
// emplacements) est genere et sauvegarde automatiquement, pret a lancer sans autre
// action. Le MJ peut ensuite modifier des cases si besoin (formulaire /config), mais ce
// n'est pas obligatoire.
app.post('/api/admin/partie-active/generer', exigerAdmin, gerer(async (req, res) => {
  const partie = obtenirPartieActive(db);
  if (!partie) return res.status(404).json({ error: 'Aucune partie active. Creez-en une dabord.' });
  if (partie.statut !== 'en_attente') {
    return res.status(400).json({ error: 'La partie a deja demarre, configuration verrouillee' });
  }

  const { nombreJoueursPrevu, nombreCoopParJoueur } = req.body;
  const validation = validerNombreCooperatifs(nombreJoueursPrevu, nombreCoopParJoueur);
  if (!validation.valide) {
    return res.status(400).json({ error: validation.message });
  }

  const { emplacements, manques } = genererEmplacements(db, nombreJoueursPrevu, nombreCoopParJoueur);
  if (manques.length) {
    // Renvoie aussi les emplacements partiels (les cases en echec ont categorie=null) :
    // le MJ voit ce qui a fonctionne et peut completer manuellement le reste plutot que
    // de se retrouver face a un tableau entierement vide.
    return res.status(400).json({
      error: `Pool CSV insuffisant : ${manques.join(' | ')}`,
      emplacements
    });
  }

  db.prepare(
    'UPDATE parties SET nombre_joueurs_prevu = ?, nombre_coop_par_joueur = ? WHERE id = ?'
  ).run(nombreJoueursPrevu, nombreCoopParJoueur, partie.id);

  const upsert = db.prepare(
    `INSERT INTO configuration_emplacements (partie_id, rang, position, niveau, type, categorie)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(partie_id, rang, position) DO UPDATE SET niveau = ?, type = ?, categorie = ?`
  );
  emplacements.forEach((e) => {
    upsert.run(partie.id, e.rang, e.position, e.niveau, e.type, e.categorie, e.niveau, e.type, e.categorie);
  });

  const synchronisation = await commiterEtPousser('Admin : generation automatique de la configuration');
  res.json({ ok: true, emplacements, synchronisation });
}));

app.post('/api/admin/partie-active/config', exigerAdmin, gerer(async (req, res) => {
  const partie = obtenirPartieActive(db);
  if (!partie) return res.status(404).json({ error: 'Aucune partie active. Creez-en une dabord.' });
  if (partie.statut !== 'en_attente') {
    return res.status(400).json({ error: 'La partie a deja demarre, configuration verrouillee' });
  }

  const { nombreJoueursPrevu, nombreCoopParJoueur, emplacements } = req.body;
  const validation = validerNombreCooperatifs(nombreJoueursPrevu, nombreCoopParJoueur);
  if (!validation.valide) {
    return res.status(400).json({ error: validation.message });
  }

  db.prepare(
    'UPDATE parties SET nombre_joueurs_prevu = ?, nombre_coop_par_joueur = ? WHERE id = ?'
  ).run(nombreJoueursPrevu, nombreCoopParJoueur, partie.id);

  const upsert = db.prepare(
    `INSERT INTO configuration_emplacements (partie_id, rang, position, niveau, type, categorie)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(partie_id, rang, position) DO UPDATE SET niveau = ?, type = ?, categorie = ?`
  );
  (emplacements || []).forEach((e) => {
    upsert.run(
      partie.id,
      e.rang,
      e.position,
      e.niveau || null,
      e.type || null,
      e.categorie || null,
      e.niveau || null,
      e.type || null,
      e.categorie || null
    );
  });

  // Si l'effectif (re)configure correspond deja aux joueurs presents (ex: le MJ reduit
  // le nombre de joueurs suite a une absence), la partie peut se lancer immediatement.
  const lancement = tenterLancementPartie(partie.id);

  const synchronisation = await commiterEtPousser('Admin : configuration de la partie');
  res.json({ ok: true, synchronisation, lancement });
}));

// Verifie les valeurs actuellement affichees a l'ecran (envoyees dans le corps), pas la
// derniere configuration enregistree en base : sinon "Verifier" avant tout
// "Enregistrer" controlerait une configuration vide/perimee.
app.post('/api/admin/partie-active/verifier-pool', exigerAdmin, (req, res) => {
  const partie = obtenirPartieActive(db);
  if (!partie) return res.status(404).json({ error: 'Aucune partie active' });

  const nombreJoueursPrevu = req.body?.nombreJoueursPrevu ?? partie.nombre_joueurs_prevu;
  const emplacements =
    req.body?.emplacements ||
    db.prepare('SELECT * FROM configuration_emplacements WHERE partie_id = ?').all(partie.id);

  if (!emplacements || emplacements.length < 9) {
    return res.status(400).json({ error: 'Les 9 emplacements ne sont pas encore tous configures' });
  }

  const resultat = verifierPool(db, nombreJoueursPrevu, emplacements);
  res.json(resultat);
});

// Bouton manuel de secours (l'admin peut forcer une tentative de lancement, ex. apres
// avoir reconfigure). En temps normal la partie se lance toute seule (voir
// tenterLancementPartie, appelee automatiquement des qu'un joueur choisit sa race).
app.post('/api/admin/partie-active/lancer', exigerAdmin, gerer(async (req, res) => {
  const partie = obtenirPartieActive(db);
  if (!partie) return res.status(404).json({ error: 'Aucune partie active' });

  const resultat = tenterLancementPartie(partie.id);
  if (!resultat.lance) {
    return res.status(400).json({ error: resultat.raison });
  }

  const synchronisation = await commiterEtPousser('Admin : lancement de la partie');
  res.json({ ok: true, synchronisation });
}));

app.post('/api/admin/partie-active/terminer', exigerAdmin, (req, res) => {
  const partie = obtenirPartieActive(db);
  if (!partie) return res.status(404).json({ error: 'Aucune partie active' });

  db.prepare("UPDATE parties SET statut = 'terminee' WHERE id = ?").run(partie.id);

  const classement = db
    .prepare(
      `SELECT j.id, j.pseudo, COUNT(g.id) AS valides
       FROM joueurs j LEFT JOIN grille_objectifs g ON g.joueur_id = j.id AND g.statut = 'valide'
       WHERE j.partie_id = ?
       GROUP BY j.id
       ORDER BY valides DESC`
    )
    .all(partie.id);

  io.to(partie.code).emit('partie_terminee', { classement });
  res.json({ ok: true, classement });
});

app.get('/api/admin/partie-active/suivi', exigerAdmin, (req, res) => {
  const partie = obtenirPartieActive(db);
  if (!partie) return res.status(404).json({ error: 'Aucune partie active' });

  const joueurs = db
    .prepare(
      `SELECT j.id, j.pseudo, j.connecte, j.race_id, r.nom AS race_nom,
              (SELECT COUNT(*) FROM grille_objectifs g WHERE g.joueur_id = j.id AND g.statut = 'valide') AS valides
       FROM joueurs j LEFT JOIN races r ON r.id = j.race_id
       WHERE j.partie_id = ?`
    )
    .all(partie.id);

  res.json({ partie, joueurs });
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
        'SELECT id, pseudo, race_id, representant_id, position, score, connecte, est_hote FROM joueurs WHERE partie_id = ?'
      )
      .all(partie.id);

    io.to(code.toUpperCase()).emit('etat_partie', { partie, joueurs });
  });

  // Le joueur ne choisit que sa race : ses 3 representants (rangs 1-3) se debloquent
  // progressivement avec ses objectifs valides (voir utils/grille.js).
  socket.on('choix_race', ({ joueurId, raceId }) => {
    const race = db.prepare('SELECT * FROM races WHERE id = ?').get(raceId);
    if (!race) return socket.emit('erreur', { message: 'Race introuvable' });

    const joueurActuel = db.prepare('SELECT * FROM joueurs WHERE id = ?').get(joueurId);
    if (!joueurActuel) return socket.emit('erreur', { message: 'Joueur introuvable' });

    const dejaPrise = db
      .prepare('SELECT id FROM joueurs WHERE partie_id = ? AND race_id = ? AND id != ?')
      .get(joueurActuel.partie_id, raceId, joueurId);
    if (dejaPrise) {
      return socket.emit('erreur', { message: 'Cette race est deja jouee par un autre joueur de la partie' });
    }

    const rangUn = db.prepare('SELECT id FROM representants WHERE race_id = ? AND rang = 1').get(raceId);
    db.prepare('UPDATE joueurs SET race_id = ?, representant_id = ? WHERE id = ?').run(
      raceId,
      rangUn ? rangUn.id : null,
      joueurId
    );

    // Tente un lancement automatique : des que tous les joueurs attendus ont choisi une
    // race distincte, la partie demarre toute seule (le MJ configure en amont, il n'a
    // rien a cliquer le jour J). Diffuse 'partie_lancee' a la partie si ca demarre.
    tenterLancementPartie(joueurActuel.partie_id);

    // Les cases de grille (les 9 emplacements) sont creees au lancement de la partie
    // (voir utils/distribution.js), pas ici : tant que la partie est 'en_attente', il
    // n'y a rien a deverrouiller.
    const partieDuJoueur = db.prepare('SELECT * FROM parties WHERE id = ?').get(joueurActuel.partie_id);
    if (partieDuJoueur && partieDuJoueur.statut === 'en_cours') {
      deverrouillerRang(db, joueurId, joueurActuel.partie_id, 1);
    }

    socket.emit('etat_joueur', obtenirEtatJoueur(db, joueurId));
    if (socket.data.code) {
      io.to(socket.data.code).emit('joueur_maj', { joueurId, raceId });
    }
  });

  socket.on('deplacement', ({ joueurId, position }) => {
    db.prepare('UPDATE joueurs SET position = ? WHERE id = ?').run(position, joueurId);
    if (socket.data.code) {
      io.to(socket.data.code).emit('joueur_deplace', { joueurId, position });
    }
  });

  // Ouvre l'enveloppe d'un objectif (affiche sa description sans le valider).
  socket.on('grille_ouvrir', ({ joueurId, ligneId }) => {
    const ligne = db
      .prepare('SELECT * FROM grille_objectifs WHERE id = ? AND joueur_id = ?')
      .get(ligneId, joueurId);
    if (!ligne || ligne.statut !== 'ferme') return;

    db.prepare("UPDATE grille_objectifs SET statut = 'ouvert' WHERE id = ?").run(ligne.id);
    socket.emit('etat_joueur', obtenirEtatJoueur(db, joueurId));
  });

  // Valide un objectif : propage aux autres joueurs (cooperatif = valide aussi,
  // belliqueux = remplace leur objectif + notification), verifie la fin de partie.
  socket.on('grille_valider', ({ joueurId, ligneId }) => {
    let resultat;
    try {
      resultat = validerObjectif(db, { joueurId, ligneId });
    } catch (erreur) {
      return socket.emit('erreur', { message: erreur.message });
    }

    verifierDevoilementPosition3(db, joueurId, resultat.ligne.rang);
    verifierDeverrouillages(db, joueurId, resultat.partieId);
    socket.emit('etat_joueur', obtenirEtatJoueur(db, joueurId));

    resultat.affectes.forEach((affecte) => {
      if (affecte.action === 'valide') {
        verifierDevoilementPosition3(db, affecte.joueurId, resultat.ligne.rang);
        verifierDeverrouillages(db, affecte.joueurId, resultat.partieId);
      }
      const autreJoueur = db.prepare('SELECT * FROM joueurs WHERE id = ?').get(affecte.joueurId);
      if (autreJoueur && autreJoueur.socket_id) {
        io.to(autreJoueur.socket_id).emit('etat_joueur', obtenirEtatJoueur(db, affecte.joueurId));
        if (affecte.action === 'remplace') {
          io.to(autreJoueur.socket_id).emit('notification', {
            message: "Un objectif a ete remplace suite a l'action d'un autre joueur !"
          });
        }
      }
    });

    if (socket.data.code && obtenirParametre(db, 'tableau_de_bord_actif') === 'true') {
      io.to(socket.data.code).emit('tableau_de_bord_maj');
    }

    if (resultat.partieTerminee && socket.data.code) {
      db.prepare("UPDATE parties SET statut = 'terminee' WHERE id = ?").run(resultat.partieId);
      const classement = db
        .prepare(
          `SELECT j.id, j.pseudo, COUNT(g.id) AS valides
           FROM joueurs j LEFT JOIN grille_objectifs g ON g.joueur_id = j.id AND g.statut = 'valide'
           WHERE j.partie_id = ?
           GROUP BY j.id
           ORDER BY valides DESC`
        )
        .all(resultat.partieId);
      io.to(socket.data.code).emit('partie_terminee', { classement });
    }
  });

  // Seul le maitre du jeu (est_hote) peut faire defiler les images du scenario ;
  // tous les joueurs de la partie voient la meme image en temps reel.
  socket.on('scenario_naviguer', ({ index }) => {
    if (!socket.data.code || !socket.data.joueurId) return;

    const joueur = db.prepare('SELECT * FROM joueurs WHERE id = ?').get(socket.data.joueurId);
    if (!joueur || !joueur.est_hote) return;

    const partie = db.prepare('SELECT * FROM parties WHERE code = ?').get(socket.data.code);
    if (!partie) return;

    db.prepare('UPDATE parties SET scenario_index = ? WHERE id = ?').run(index, partie.id);
    io.to(socket.data.code).emit('scenario_maj', { index });
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
