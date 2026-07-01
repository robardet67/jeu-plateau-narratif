// Phase 4 : validation, verification du pool et algorithme de distribution des
// objectifs pour une partie configuree par le maitre du jeu (9 emplacements :
// rang 1-3 x position 1-3, chacun avec un niveau/type/categorie a piocher dans le pool CSV).

const { normaliser } = require('./texte');

const RANGS = [1, 2, 3];
const POSITIONS = [1, 2, 3];

function melanger(tableau) {
  const copie = [...tableau];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

// Un objectif "cooperatif" est partage par une paire (ceil(N/2) objectifs distincts
// suffisent, le joueur esseule eventuel ayant sa propre case). Un objectif "belliqueux"
// oppose 2 joueurs avec des contenus differents des le depart (N distincts). Un
// objectif "standard" n'a pas de partenaire (N distincts, un par joueur).
function objectifsRequisPourEmplacement(type, nombreJoueurs) {
  if (normaliser(type) === 'cooperatif') return Math.ceil(nombreJoueurs / 2);
  return nombreJoueurs;
}

// --- Validation mathematique du nombre de cooperatifs par joueur (point 2) ---
//
// Chaque objectif cooperatif relie 2 joueurs (une arete). "Chaque joueur a exactement K
// cooperatifs, jamais le meme partenaire deux fois" revient a construire un graphe
// K-regulier simple sur N joueurs. Un tel graphe existe si et seulement si K <= N-1 et
// N*K est pair (theoreme classique des graphes reguliers).
function validerNombreCooperatifs(nombreJoueurs, nombreCoopParJoueur) {
  const n = Number(nombreJoueurs);
  const k = Number(nombreCoopParJoueur);

  if (!Number.isInteger(k) || k < 0) {
    return { valide: false, message: 'Le nombre de cooperatifs par joueur doit etre un entier positif ou nul.' };
  }

  if (k > n - 1) {
    return {
      valide: false,
      message: `Impossible avec ${n} joueurs : maximum ${n - 1} objectif(s) cooperatif(s) par joueur (un joueur ne peut pas avoir plus de partenaires que d'autres joueurs).`
    };
  }

  if ((n * k) % 2 !== 0) {
    const alternative = k + 1 <= n - 1 ? k + 1 : k - 1;
    return {
      valide: false,
      message: `Impossible avec ${n} joueurs, essayez ${alternative} objectif(s) cooperatif(s) par joueur.`
    };
  }

  return { valide: true, message: 'Configuration valide.' };
}

// --- Verification de suffisance du pool CSV (point 4) ---

function verifierPool(db, nombreJoueurs, emplacements) {
  // Les emplacements avec les memes niveau/type/categorie puisent dans le meme pool
  // (exclusion globale dans distribuer()) : leurs besoins doivent donc etre cumules,
  // pas verifies independamment.
  const besoinsParCombo = new Map();

  for (const emp of emplacements) {
    const cle = `${emp.niveau || ''}|${emp.type || ''}|${emp.categorie || ''}`;
    const requis = objectifsRequisPourEmplacement(emp.type, nombreJoueurs);
    const existant = besoinsParCombo.get(cle) || {
      niveau: emp.niveau,
      type: emp.type,
      categorie: emp.categorie,
      requis: 0,
      emplacements: []
    };
    existant.requis += requis;
    existant.emplacements.push(`Rang ${emp.rang} - position ${emp.position}`);
    besoinsParCombo.set(cle, existant);
  }

  const manques = [];
  for (const besoin of besoinsParCombo.values()) {
    const disponibles = db
      .prepare('SELECT COUNT(*) AS n FROM objectifs WHERE niveau IS ? AND type IS ? AND categorie IS ?')
      .get(besoin.niveau || null, besoin.type || null, besoin.categorie || null).n;

    if (disponibles < besoin.requis) {
      manques.push({
        emplacement: besoin.emplacements.join(', '),
        niveau: besoin.niveau,
        type: besoin.type,
        categorie: besoin.categorie,
        requis: besoin.requis,
        disponibles
      });
    }
  }

  if (!manques.length) {
    return { suffisant: true, manques: [] };
  }

  const message = manques
    .map(
      (m) =>
        `${m.emplacement} (${[m.niveau, m.type, m.categorie].filter(Boolean).join('/')}) : ${m.disponibles} disponible(s), ${m.requis} requis`
    )
    .join(' | ');

  return { suffisant: false, manques, message: `Objectifs insuffisants dans le pool : ${message}` };
}

// --- Generation automatique des 9 emplacements (minimum d'intervention du MJ) ---
//
// A partir du nombre de joueurs et du nombre de cooperatifs voulus, choisit pour chaque
// emplacement (rang, position) un niveau (croissant par position : facile/moyen/
// difficile), un type (cooperatif reparti selon K, reste en standard) et pioche au
// hasard une categorie du pool ayant assez d'objectifs disponibles (en tenant compte de
// ce que les emplacements precedents ont deja reserve dans le meme combo niveau/type/
// categorie). Ne modifie pas la base ; l'appelant est responsable de sauvegarder.
const NIVEAU_CIBLE_PAR_POSITION = { 1: 'facile', 2: 'moyen', 3: 'difficile' };
const ORDRE_PRIORITE_COOP = [
  { rang: 1, position: 2 }, { rang: 2, position: 2 }, { rang: 3, position: 2 },
  { rang: 1, position: 1 }, { rang: 2, position: 1 }, { rang: 3, position: 1 },
  { rang: 1, position: 3 }, { rang: 2, position: 3 }, { rang: 3, position: 3 }
];

function genererEmplacements(db, nombreJoueurs, nombreCoopParJoueur) {
  const coopChoisis = new Set(
    ORDRE_PRIORITE_COOP.slice(0, nombreCoopParJoueur).map((e) => `${e.rang}-${e.position}`)
  );

  const poolBrut = db
    .prepare('SELECT niveau, type, categorie, COUNT(*) AS n FROM objectifs GROUP BY niveau, type, categorie')
    .all();

  const reserve = new Map();
  const cleReserve = (niveau, type, categorie) => `${niveau}|${type}|${categorie}`;

  const emplacements = [];
  const manques = [];

  for (const rang of [1, 2, 3]) {
    for (const position of [1, 2, 3]) {
      const estCoop = coopChoisis.has(`${rang}-${position}`);
      const niveauCible = NIVEAU_CIBLE_PAR_POSITION[position];
      const typeCible = estCoop ? 'cooperatif' : 'standard';
      const requis = estCoop ? Math.ceil(nombreJoueurs / 2) : nombreJoueurs;

      const candidats = poolBrut
        .filter((c) => normaliser(c.niveau) === niveauCible && normaliser(c.type) === typeCible)
        .map((c) => ({ ...c, disponible: c.n - (reserve.get(cleReserve(c.niveau, c.type, c.categorie)) || 0) }))
        .filter((c) => c.disponible >= requis);

      if (!candidats.length) {
        manques.push(
          `Rang ${rang} - Position ${position} (${niveauCible}/${typeCible}) : aucune categorie du pool n'a ${requis} objectif(s) disponible(s)`
        );
        emplacements.push({ rang, position, niveau: niveauCible, type: typeCible, categorie: null });
        continue;
      }

      const choisi = candidats[Math.floor(Math.random() * candidats.length)];
      const cle = cleReserve(choisi.niveau, choisi.type, choisi.categorie);
      reserve.set(cle, (reserve.get(cle) || 0) + requis);

      emplacements.push({ rang, position, niveau: choisi.niveau, type: choisi.type, categorie: choisi.categorie });
    }
  }

  return { emplacements, manques };
}

// --- Pairage (partage entre 2 joueurs, jamais deux fois la meme paire) ---
//
// Essaie plusieurs tirages aleatoires et garde le meilleur (le moins de joueurs
// esseules) : un greedy simple peut echouer a apparier tout le monde selon l'ordre
// tire, alors que l'appariement existe avec un autre ordre.
function genererPairage(joueurIds, pairesDejaUtilisees) {
  const cleDePaire = (a, b) => [a, b].sort((x, y) => x - y).join('-');

  let meilleur = null;

  for (let tentative = 0; tentative < 50; tentative++) {
    const ids = melanger(joueurIds);
    const dejaUtilisees = new Set(pairesDejaUtilisees);
    const paires = [];
    const apparies = new Set();

    for (let i = 0; i < ids.length; i++) {
      const a = ids[i];
      if (apparies.has(a)) continue;

      let partenaire = null;
      for (let j = i + 1; j < ids.length; j++) {
        const b = ids[j];
        if (apparies.has(b)) continue;
        if (!dejaUtilisees.has(cleDePaire(a, b))) {
          partenaire = b;
          break;
        }
      }

      if (partenaire !== null) {
        paires.push([a, partenaire]);
        apparies.add(a);
        apparies.add(partenaire);
        dejaUtilisees.add(cleDePaire(a, partenaire));
      }
    }

    const solo = ids.filter((id) => !apparies.has(id));
    if (!meilleur || solo.length < meilleur.solo.length) {
      meilleur = { paires, solo };
      if (solo.length <= (joueurIds.length % 2)) break; // deja optimal possible
    }
  }

  meilleur.paires.forEach(([a, b]) => pairesDejaUtilisees.add(cleDePaire(a, b)));
  return meilleur;
}

// Choisit `count` objectifs distincts correspondant a niveau/type/categorie, en excluant
// ceux deja utilises dans cette distribution (pour eviter les repetitions).
function piocherObjectifs(db, emplacement, count, exclus) {
  const exclusion = exclus.size ? [...exclus] : [0];
  const placeholders = exclusion.map(() => '?').join(',');
  const lignes = db
    .prepare(
      `SELECT * FROM objectifs WHERE niveau IS ? AND type IS ? AND categorie IS ? AND id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT ?`
    )
    .all(emplacement.niveau || null, emplacement.type || null, emplacement.categorie || null, ...exclusion, count);

  if (lignes.length < count) {
    const criteres = [emplacement.niveau, emplacement.type, emplacement.categorie].filter(Boolean).join('/');
    throw new Error(
      `Pool insuffisant pour l'emplacement rang ${emplacement.rang}/position ${emplacement.position} (${criteres}) : ${lignes.length} disponible(s), ${count} necessaire(s)`
    );
  }

  lignes.forEach((l) => exclus.add(l.id));
  return lignes;
}

// --- Distribution complete (point 5) ---
//
// Pour chaque emplacement (rang, position), pioche les objectifs necessaires selon le
// type (cooperatif = partage par paire, belliqueux = paire avec contenus differents,
// standard = un par joueur) et cree les cases de grille_objectifs de chaque joueur.
function distribuer(db, { partieId, joueurIds, emplacements }) {
  const objectifsUtilisesGlobalement = new Set();
  const pairesCoopUtilisees = new Set();
  const pairesBelliqueuxUtilisees = new Set();

  const insererCase = db.prepare(
    `INSERT INTO grille_objectifs (joueur_id, partie_id, rang, position, objectif_id, statut)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    for (const emp of emplacements) {
      const statutInitial = emp.rang === 1 && emp.position !== 3 ? 'ferme' : 'masque';
      const type = normaliser(emp.type);

      if (type === 'cooperatif') {
        const { paires, solo } = genererPairage(joueurIds, pairesCoopUtilisees);
        const objectifsNecessaires = paires.length + solo.length;
        const objectifs = piocherObjectifs(db, emp, objectifsNecessaires, objectifsUtilisesGlobalement);

        let indexObjectif = 0;
        for (const [a, b] of paires) {
          const objectif = objectifs[indexObjectif++];
          insererCase.run(a, partieId, emp.rang, emp.position, objectif.id, statutInitial);
          insererCase.run(b, partieId, emp.rang, emp.position, objectif.id, statutInitial);
        }
        for (const solitaire of solo) {
          const objectif = objectifs[indexObjectif++];
          insererCase.run(solitaire, partieId, emp.rang, emp.position, objectif.id, statutInitial);
        }
      } else if (type === 'belliqueux') {
        const { paires, solo } = genererPairage(joueurIds, pairesBelliqueuxUtilisees);
        const objectifsNecessaires = paires.length * 2 + solo.length;
        const objectifs = piocherObjectifs(db, emp, objectifsNecessaires, objectifsUtilisesGlobalement);

        let indexObjectif = 0;
        for (const [a, b] of paires) {
          insererCase.run(a, partieId, emp.rang, emp.position, objectifs[indexObjectif++].id, statutInitial);
          insererCase.run(b, partieId, emp.rang, emp.position, objectifs[indexObjectif++].id, statutInitial);
        }
        for (const solitaire of solo) {
          insererCase.run(solitaire, partieId, emp.rang, emp.position, objectifs[indexObjectif++].id, statutInitial);
        }
      } else {
        const objectifs = piocherObjectifs(db, emp, joueurIds.length, objectifsUtilisesGlobalement);
        joueurIds.forEach((joueurId, index) => {
          insererCase.run(joueurId, partieId, emp.rang, emp.position, objectifs[index].id, statutInitial);
        });
      }
    }
  });

  transaction();
}

module.exports = {
  RANGS,
  POSITIONS,
  objectifsRequisPourEmplacement,
  validerNombreCooperatifs,
  verifierPool,
  genererEmplacements,
  distribuer
};
