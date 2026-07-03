// Test switch de joueur — suit exactement le flux serveur :
// 1. rejoindre_partie → etat_partie (en_attente)
// 2. lancement → partie_lancee → etat_joueur direct (Phase 1)
// 3. switch Bob → rejoindre_partie → etat_partie (en_cours) → fetch REST (Phase 3)
// 4. Bob valide → grille_valider → etat_joueur (Phase 5)

const { io } = require('socket.io-client');
const Database = require('better-sqlite3');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

async function reqJSON(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

async function main() {
  const db = new Database('./database/jeu.sqlite');

  // Admin login
  const lr = await fetch('http://localhost:3000/api/admin/connexion', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motDePasse: 'admin123' })
  });
  const h = { Cookie: (lr.headers.get('set-cookie') || '').split(';')[0] };

  // Reset + créer partie (nb_joueurs_attendus = 0 → désactive l'auto-launch)
  await fetch('http://localhost:3000/api/admin/partie-active/reinitialiser', { method: 'POST', headers: h });
  const partieRes = await reqJSON('http://localhost:3000/api/admin/partie-active/creer', {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nb_joueurs_attendus: 0,   // auto-launch desactive
      nb_representants_race: 2, nb_representants_allegeance: 1,
      config_objectifs_race: '[2,2,2]', config_niveaux_race: '[[null,null],[null,null],[null,null]]',
      config_objectifs_allegeance: '[2,2,2]', config_niveaux_allegeance: '[[null,null],[null,null],[null,null]]'
    })
  });
  const code = partieRes.code;

  const alice = await reqJSON('http://localhost:3000/api/partie-active/rejoindre', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo: 'Alice', race_id: 1, allegeance_ids: [] })
  });
  const bob = await reqJSON('http://localhost:3000/api/partie-active/rejoindre', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo: 'Bob', race_id: 2, allegeance_ids: [] })
  });
  console.log('Partie:', code, '| Alice:', alice.joueurId, '| Bob:', bob.joueurId);

  let pass = 0, fail = 0;
  function assert(cond, label) {
    if (cond) { console.log('  PASS: ' + label); pass++; }
    else { console.error('  FAIL: ' + label); fail++; }
  }

  const socket = io('http://localhost:3000');
  let joueurIdCourant = alice.joueurId;
  let phase = 'init';

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout — phase: ' + phase)), 15000);

    // Phase 1 : etat_joueur direct après lancement (serveur push direct)
    // Phase 5 : etat_joueur après validation Bob
    socket.on('etat_joueur', async (etat) => {
      if (phase === 'attente_etat_alice') {
        // === Phase 1 : lancement → etat Alice reçu directement ===
        phase = 'alice_recu';
        console.log('\n--- Phase 1 : etat Alice reçu (post-lancement) ---');
        assert(etat.joueurId === alice.joueurId, 'etat de Alice');
        assert(etat.raceId === 1, 'race_id Alice = 1');
        assert(etat.partieId !== null, 'partieId present');

        const jAlice = db.prepare('SELECT socket_id, connecte FROM joueurs WHERE id = ?').get(alice.joueurId);
        assert(jAlice.connecte === 1, 'Alice connectee en DB');
        assert(jAlice.socket_id !== null, 'socket_id Alice en DB');

        // === Phase 2 : switch vers Bob sur le MÊME socket (simule rejoindreJoueurExistant) ===
        console.log('\n--- Phase 2 : switch vers Bob sur le meme socket ---');
        joueurIdCourant = bob.joueurId;
        phase = 'attente_etat_bob';
        socket.emit('rejoindre_partie', { code, joueurId: bob.joueurId });

      } else if (phase === 'attente_validation_bob') {
        // === Phase 5 : validation Bob confirmée ===
        phase = 'done';
        console.log('\n--- Phase 5 : confirmation validation Bob ---');
        const validees = etat.rangs && etat.rangs[0] && etat.rangs[0].cases &&
          etat.rangs[0].cases.filter(c => c.statut === 'valide').length;
        assert(etat.joueurId === bob.joueurId, 'etat Bob apres validation');
        assert(validees >= 1, 'Bob a ' + validees + ' objectif(s) valide(s)');

        // Isolation : Alice n'a rien validé
        const aliceValides = db.prepare(
          "SELECT COUNT(*) AS n FROM grille_objectifs WHERE joueur_id = ? AND statut = 'valide'"
        ).get(alice.joueurId).n;
        assert(aliceValides === 0, 'Alice — aucun objectif valide (isolation OK)');

        clearTimeout(timer);
        resolve();
      }
    });

    // Phase 3 : etat_partie après switch → fetch REST avec Bob's joueurId
    socket.on('etat_partie', async ({ partie }) => {
      if (phase === 'attente_etat_bob' && partie.statut === 'en_cours') {
        // Reproduit ce que fait app.js : fetch REST avec le joueurId courant
        const etat = await reqJSON('http://localhost:3000/api/joueurs/' + joueurIdCourant + '/etat');

        // === Phase 3 : etat Bob reçu via REST ===
        console.log('\n--- Phase 3 : etat Bob reçu apres switch ---');
        assert(etat.joueurId === bob.joueurId, 'etat de Bob (id=' + etat.joueurId + ')');
        assert(etat.raceId === 2, 'race_id Bob = 2');

        const jBob = db.prepare('SELECT socket_id FROM joueurs WHERE id = ?').get(bob.joueurId);
        assert(jBob.socket_id === socket.id, 'socket_id Bob = socket courant');
        assert(jBob.socket_id !== null, 'Bob a un socket_id valide en DB');

        // === Phase 4 : Bob valide un objectif ===
        console.log('\n--- Phase 4 : Bob valide un objectif ---');
        const rangBob = etat.rangs && etat.rangs.find(r => r.deverrouille && r.cases && r.cases.length);
        const caseBob = rangBob && rangBob.cases.find(c => c.statut === 'ouvert');
        if (caseBob) {
          phase = 'attente_validation_bob';
          socket.emit('grille_valider', { joueurId: bob.joueurId, ligneId: caseBob.id });
        } else {
          assert(false, 'Bob a une case ouverte disponible');
          clearTimeout(timer); resolve();
        }
      }
    });

    socket.on('erreur', ({ message }) => reject(new Error('Socket erreur: ' + message)));

    // Connexion initiale : Alice
    socket.emit('rejoindre_partie', { code, joueurId: alice.joueurId });

    // Lancer manuellement après que le socket est connecté
    setTimeout(async () => {
      phase = 'attente_etat_alice';
      await fetch('http://localhost:3000/api/admin/partie-active/lancer', { method: 'POST', headers: h });
    }, 600);
  });

  console.log('\n=== ' + pass + ' PASS, ' + fail + ' FAIL ===');
  socket.disconnect();
  db.close();
  await new Promise(r => setTimeout(r, 300));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
