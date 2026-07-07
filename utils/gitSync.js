'use strict';

const { execFile } = require('child_process');
const path = require('path');
const { regenererExportContenu } = require('./exportContenu');

const DEPOT = path.join(__dirname, '..');

function executer(commande, args) {
  return new Promise((resolve, reject) => {
    execFile(commande, args, { cwd: DEPOT }, (erreur, stdout, stderr) => {
      if (erreur) return reject(new Error(stderr || erreur.message));
      resolve(stdout);
    });
  });
}

async function brancheCourante() {
  try {
    const nom = (await executer('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    // En detached HEAD, git retourne "HEAD" — on tombe sur le fallback
    if (nom && nom !== 'HEAD') return nom;
  } catch {
    // ignore
  }
  // Fallback configurable via variable d'env, puis "main"
  return process.env.GIT_BRANCH || 'main';
}

async function cibleDePush() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('[GIT BACKUP] cibleDePush: GITHUB_TOKEN absent → fallback origin (pas d\'auth)');
    return 'origin';
  }

  // GITHUB_REPO_URL prioritaire : contourne l'absence de remote git sur Render
  let urlDistante = process.env.GITHUB_REPO_URL || null;
  if (urlDistante) {
    console.log('[GIT BACKUP] cibleDePush: GITHUB_REPO_URL =', urlDistante);
  } else {
    // Fallback : lire la config git locale
    try {
      urlDistante = (await executer('git', ['config', '--get', 'remote.origin.url'])).trim();
      console.log('[GIT BACKUP] cibleDePush: remote.origin.url (git config) =', urlDistante);
    } catch (err) {
      console.log('[GIT BACKUP] cibleDePush: git config echoue →', err.message, '→ fallback origin sans auth');
      return 'origin';
    }
  }

  if (!urlDistante.startsWith('https://')) {
    console.log('[GIT BACKUP] cibleDePush: URL non-HTTPS → fallback origin (token inutilisable sur SSH)');
    return 'origin';
  }

  const sansProtocole = urlDistante.replace('https://', '');
  console.log('[GIT BACKUP] cibleDePush: URL authentifiee → https://x-access-token:***@' + sansProtocole);
  return `https://x-access-token:${token}@${sansProtocole}`;
}

// db est passe en parametre pour supporter les deux backends (local et Turso).
async function commiterEtPousser(db, message) {
  console.log('[GIT BACKUP] START :', message);

  // Regenere le fichier d'export JSON (toujours, meme si le push est desactive).
  await regenererExportContenu(db);

  const autoPushEnv = process.env.AUTO_GIT_PUSH;
  console.log('[GIT BACKUP] AUTO_GIT_PUSH =', autoPushEnv !== undefined ? autoPushEnv : '(non defini — push active)');

  if (autoPushEnv === 'false') {
    console.log('[GIT BACKUP] Push desactive par AUTO_GIT_PUSH=false. Images non sauvegardees sur GitHub.');
    return { pushed: false, raison: 'synchronisation desactivee (AUTO_GIT_PUSH=false)' };
  }

  console.log('[GIT BACKUP] GITHUB_TOKEN present :', !!process.env.GITHUB_TOKEN);

  try {
    await executer('git', ['add', '-A']);
    console.log('[GIT BACKUP] git add -A OK');

    const nomAuteur = process.env.GIT_AUTHOR_NAME || 'Jeu Plateau Narratif (admin)';
    const emailAuteur = process.env.GIT_AUTHOR_EMAIL || 'admin@jeu-plateau-narratif.local';

    try {
      await executer('git', [
        '-c', `user.name=${nomAuteur}`,
        '-c', `user.email=${emailAuteur}`,
        'commit', '-m', message,
      ]);
      console.log('[GIT BACKUP] git commit OK');
    } catch (erreurCommit) {
      if (/nothing to commit/i.test(erreurCommit.message)) {
        console.log('[GIT BACKUP] Rien a commiter — aucun fichier modifie detecte par git.');
        return { pushed: false, raison: 'aucun fichier a synchroniser' };
      }
      throw erreurCommit;
    }

    const branche = await brancheCourante();
    console.log('[GIT BACKUP] Branche cible du push :', branche);

    let cible;
    try {
      cible = await cibleDePush();
    } catch {
      cible = 'origin';
    }
    // Ne jamais afficher le token : on indique seulement si l'URL est authentifiee
    console.log('[GIT BACKUP] Remote authentifie :', cible !== 'origin');

    console.log('[GIT BACKUP] GIT PUSH START → HEAD:', branche);
    await executer('git', ['push', cible, `HEAD:${branche}`]);
    console.log('[GIT BACKUP] GIT PUSH SUCCESS');
    return { pushed: true };
  } catch (erreur) {
    const msg = erreur.message || '';
    // Log brut en premier — c'est le message exact de git/GitHub, avant tout remapping
    console.error('[GIT BACKUP] ERREUR BRUTE GIT :', msg);
    const estErreurAcces =
      msg.includes('Could not read from remote') ||
      msg.includes('not appear to be a git repository') ||
      msg.includes('Authentication failed') ||
      msg.includes('could not read Username');
    const raison = estErreurAcces
      ? "Push GitHub echoue : configurez GITHUB_TOKEN dans les variables d'environnement du serveur"
      : msg;
    console.error('[GIT BACKUP] FAILED (raison affichee admin) :', raison);
    return { pushed: false, raison };
  }
}

module.exports = { commiterEtPousser };
