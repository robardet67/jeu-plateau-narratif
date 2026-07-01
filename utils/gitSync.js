const { execFile } = require('child_process');
const path = require('path');

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

  const urlDistante = (await executer('git', ['config', '--get', 'remote.origin.url'])).trim();
  if (!urlDistante.startsWith('https://')) return 'origin';

  const sansProtocole = urlDistante.replace('https://', '');
  return `https://x-access-token:${token}@${sansProtocole}`;
}

// Ajoute, commit et pousse les changements du depot (ex. images uploadees par l'admin).
// N'echoue jamais bruyamment : renvoie { pushed, raison } pour affichage cote client.
async function commiterEtPousser(message) {
  if (process.env.AUTO_GIT_PUSH === 'false') {
    return { pushed: false, raison: 'synchronisation desactivee (AUTO_GIT_PUSH=false)' };
  }

  try {
    await executer('git', ['add', '-A']);

    try {
      await executer('git', ['commit', '-m', message]);
    } catch (erreurCommit) {
      if (/nothing to commit/i.test(erreurCommit.message)) {
        return { pushed: false, raison: 'aucun fichier a synchroniser' };
      }
      throw erreurCommit;
    }

    const cible = await cibleDePush();
    await executer('git', ['push', cible, 'HEAD:main']);
    return { pushed: true };
  } catch (erreur) {
    console.error('Erreur de synchronisation GitHub :', erreur.message);
    return { pushed: false, raison: erreur.message };
  }
}

module.exports = { commiterEtPousser };
