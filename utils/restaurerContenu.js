const fs = require('fs');
const { CHEMIN_EXPORT } = require('./exportContenu');

// Si la base est fraiche (aucune race) et qu'une sauvegarde JSON existe (versionnee sur
// GitHub via contenu-export.json), la recharge automatiquement. Fonctionne avec les deux
// backends (local et Turso) grace a l'interface async unifiee.
async function restaurerSiVide(db) {
  const row = await db.get('SELECT COUNT(*) AS n FROM races');
  if (row.n > 0) {
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

  const compteurs = { races: 0, representants: 0, dialogues: 0, objectifs: 0, allegeances: 0, representants_allegeance: 0, scenario_images: 0 };

  try {
    await db.transact(async (tx) => {
      for (const r of contenu.races || []) {
        await tx.run('INSERT INTO races (id, nom, image_fond, created_at) VALUES (?, ?, ?, ?)', [r.id, r.nom, r.image_fond, r.created_at]);
        compteurs.races++;
      }

      for (const r of contenu.representants || []) {
        await tx.run(
          'INSERT INTO representants (id, race_id, rang, nom, description, image_depart, image_sourire, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [r.id, r.race_id, r.rang || 1, r.nom, r.description, r.image_depart, r.image_sourire, r.created_at]
        );
        compteurs.representants++;
      }

      for (const d of contenu.dialogues || []) {
        await tx.run('INSERT INTO dialogues (id, representant_id, contexte, texte, created_at) VALUES (?, ?, ?, ?, ?)', [d.id, d.representant_id, d.contexte, d.texte, d.created_at]);
        compteurs.dialogues++;
      }

      for (const o of contenu.objectifs || []) {
        await tx.run('INSERT INTO objectifs (id, description, niveau, created_at) VALUES (?, ?, ?, ?)', [o.id, o.description, o.niveau ?? null, o.created_at]);
        compteurs.objectifs++;
      }

      const listeAllegeances = contenu.allegeances || contenu.allegiances || [];
      for (const r of listeAllegeances) {
        await tx.run('INSERT INTO allegeances (id, nom, portrait, created_at) VALUES (?, ?, ?, ?)', [r.id, r.nom, r.portrait, r.created_at]);
        compteurs.allegeances++;
      }

      const listeRepAllegeances = contenu.representants_allegeance || contenu.representants_allegiance || [];
      for (const r of listeRepAllegeances) {
        const allegeanceId = r.allegeance_id ?? r.allegiance_id;
        await tx.run(
          'INSERT INTO representants_allegeance (id, allegeance_id, rang, nom, image_depart, image_sourire, dialogue, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [r.id, allegeanceId, r.rang, r.nom, r.image_depart, r.image_sourire, r.dialogue ?? null, r.created_at]
        );
        compteurs.representants_allegeance++;
      }

      for (const s of contenu.scenario_images || []) {
        await tx.run('INSERT INTO scenario_images (id, ordre, image, created_at) VALUES (?, ?, ?, ?)', [s.id, s.ordre, s.image, s.created_at]);
        compteurs.scenario_images++;
      }
    });

    return { restaure: true, compteurs };
  } catch (erreur) {
    console.error('Erreur lors de la restauration:', erreur.message);
    return { restaure: false, raison: 'erreur: ' + erreur.message };
  }
}

module.exports = { restaurerSiVide };
