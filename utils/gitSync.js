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

async function cibleDePush() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return 'origin';

  let urlDistante;
  try {
    urlDistante = (await executer('git', ['config', '--get', 'remote.origin.url'])).trim();
  } catch {
    return 'origin';
  }
  if (!urlDistante.startsWith('https://')) return 'origin';

  const sansProtocole = urlDistante.replace('https://', '');
  return `https://x-access-token:${token}@${sansProtocole}`;
}

// db est passe en parametre pour supporter les deux backends (local et Turso).
async function commiterEtPousser(db, message) {
  // Regenere le fichier d'export JSON (toujours, meme si le push est desactive).
  await regenererExportContenu(db);

  if (process.env.AUTO_GIT_PUSH === 'false') {
    return { pushed: false, raison: 'synchronisation desactivee (AUTO_GIT_PUSH=false)' };
  }

  try {
    await executer('git', ['add', '-A']);

    const nomAuteur = process.env.GIT_AUTHOR_NAME || 'Jeu Plateau Narratif (admin)';
    const emailAuteur = process.env.GIT_AUTHOR_EMAIL || 'admin@jeu-plateau-narratif.local';

    try {
      await executer('git', [
        '-c', `user.name=${nomAuteur}`,
        '-c', `user.email=${emailAuteur}`,
        'commit', '-m', message,
      ]);
    } catch (erreurCommit) {
      if (/nothing to commit/i.test(erreurCommit.message)) {
        return { pushed: false, raison: 'aucun fichier a synchroniser' };
      }
      throw erreurCommit;
    }

    let cible;
    try {
      cible = await cibleDePush();
    } catch {
      cible = 'origin';
    }

    await executer('git', ['push', cible, 'HEAD:main']);
    return { pushed: true };
  } catch (erreur) {
    const msg = erreur.message || '';
    const estErreurAcces =
      msg.includes('Could not read from remote') ||
      msg.includes('not appear to be a git repository') ||
      msg.includes('Authentication failed') ||
      msg.includes('could not read Username');
    const raison = estErreurAcces
      ? "Push GitHub echoue : configurez GITHUB_TOKEN dans les variables d'environnement du serveur"
      : msg;
    console.error('Erreur de synchronisation GitHub :', msg);
    return { pushed: false, raison };
  }
}

module.exports = { commiterEtPousser };
