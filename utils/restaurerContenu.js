const fs = require('fs');
const { CHEMIN_EXPORT } = require('./exportContenu');

// Si la base est fraiche (aucune race) et qu'une sauvegarde JSON existe (versionnee sur
// GitHub via contenu-export.json), la recharge automatiquement. C'est ce qui permet au
// contenu admin de survivre a un premier deploiement sur un serveur dont la base SQLite
// est vide au demarrage (elle n'est pas versionnee, contrairement a ce fichier).
function restaurerSiVide(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM races').get();
  if (n > 0) {
    return { restaure: false, raison: 'la base contient deja des donnees' };
  }

  if (!fs.existsSync(CHEMIN_EXPORT)) {
    return { restaure: false, raison: 'aucun fichier de sauvegarde trouve' };
  }

  let contenu;
  try {
    contenu = JSON.parse(fs.readFileSync(CHEMIN_EXPORT, 'utf-8').replace(/^﻿/, ''));
  } catch (erreur) {
    console.error('Sauvegarde JSON illisible :', erreur.message);
    return { restaure: false, raison: 'fichier de sauvegarde invalide' };
  }

  const compteurs = { races: 0, representants: 0, dialogues: 0, objectifs: 0, scenario_images: 0 };

  const restaurer = db.transaction(() => {
    const insererRace = db.prepare(
      'INSERT INTO races (id, nom, image_fond, created_at) VALUES (?, ?, ?, ?)'
    );
    (contenu.races || []).forEach((r) => {
      insererRace.run(r.id, r.nom, r.image_fond, r.created_at);
      compteurs.races++;
    });

    const insererRepresentant = db.prepare(
      'INSERT INTO representants (id, race_id, rang, nom, description, image_depart, image_sourire, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    (contenu.representants || []).forEach((r) => {
      insererRepresentant.run(
        r.id,
        r.race_id,
        r.rang || 1,
        r.nom,
        r.description,
        r.image_depart,
        r.image_sourire,
        r.created_at
      );
      compteurs.representants++;
    });

    const insererDialogue = db.prepare(
      'INSERT INTO dialogues (id, representant_id, contexte, texte, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    (contenu.dialogues || []).forEach((d) => {
      insererDialogue.run(d.id, d.representant_id, d.contexte, d.texte, d.created_at);
      compteurs.dialogues++;
    });

    const insererObjectif = db.prepare(
      'INSERT INTO objectifs (id, description, niveau, created_at) VALUES (?, ?, ?, ?)'
    );
    (contenu.objectifs || []).forEach((o) => {
      insererObjectif.run(o.id, o.description, o.niveau ?? null, o.created_at);
      compteurs.objectifs++;
    });

    // Support ancien nom de cle (allegeances) et nouveau (allegeances)
    const insererAllegeance = db.prepare('INSERT INTO allegeances (id, nom, portrait, created_at) VALUES (?, ?, ?, ?)');
    const listeAllegeances = contenu.allegeances || contenu.allegiances || [];
    listeAllegeances.forEach((r) => {
      insererAllegeance.run(r.id, r.nom, r.portrait, r.created_at);
      compteurs.allegeances = (compteurs.allegeances || 0) + 1;
    });

    const insererRepAllegeance = db.prepare(
      'INSERT INTO representants_allegeance (id, allegeance_id, rang, nom, image_depart, image_sourire, dialogue, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const listeRepAllegeances = contenu.representants_allegeance || contenu.representants_allegiance || [];
    listeRepAllegeances.forEach((r) => {
      const allegeanceId = r.allegeance_id ?? r.allegiance_id;
      insererRepAllegeance.run(r.id, allegeanceId, r.rang, r.nom, r.image_depart, r.image_sourire, r.dialogue ?? null, r.created_at);
      compteurs.representants_allegeance = (compteurs.representants_allegeance || 0) + 1;
    });

    const insererScenario = db.prepare(
      'INSERT INTO scenario_images (id, ordre, image, created_at) VALUES (?, ?, ?, ?)'
    );
    (contenu.scenario_images || []).forEach((s) => {
      insererScenario.run(s.id, s.ordre, s.image, s.created_at);
      compteurs.scenario_images++;
    });
  });

  try {
    restaurer();
    return { restaure: true, compteurs };
  } catch (erreur) {
    console.error('Erreur lors de la restauration:', erreur.message);
    return { restaure: false, raison: 'erreur: ' + erreur.message };
  }
}

module.exports = { restaurerSiVide };
