// Configuration d'une partie par le maitre du jeu : 9 emplacements (rang 1-3 x position
// 1-3). Le MJ choisit seulement le nombre de joueurs (N) et le nombre d'objectifs
// cooperatifs par joueur (K) ; le niveau (facile/moyen/difficile) suit la position et les
// emplacements cooperatifs sont repartis selon K. Au lancement, chaque case pioche
// simplement un objectif au hasard dans tout le pool CSV du niveau demande (voir
// distribuer ci-dessous) : pas de verification de stock, pas de blocage possible.

function melanger(tableau) {
  const copie = [...tableau];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

// --- Validation mathematique du nombre de cooperatifs par joueur ---
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

// --- Les 9 emplacements (apercu, sans acces a la base) ---
//
// Position determine toujours le niveau. K determine combien d'emplacements (parmi les 9)
// sont cooperatifs, en remplissant en priorite les 3 emplacements "position 2", puis
// "position 1", puis "position 3".
const NIVEAU_CIBLE_PAR_POSITION = { 1: 'facile', 2: 'moyen', 3: 'difficile' };
const ORDRE_PRIORITE_COOP = [
  { rang: 1, position: 2 }, { rang: 2, position: 2 }, { rang: 3, position: 2 },
  { rang: 1, position: 1 }, { rang: 2, position: 1 }, { rang: 3, position: 1 },
  { rang: 1, position: 3 }, { rang: 2, position: 3 }, { rang: 3, position: 3 }
];

function genererEmplacements(nombreCoopParJoueur) {
  const coopChoisis = new Set(
    ORDRE_PRIORITE_COOP.slice(0, nombreCoopParJoueur).map((e) => `${e.rang}-${e.position}`)
  );

  const emplacements = [];
  for (const rang of [1, 2, 3]) {
    for (const position of [1, 2, 3]) {
      const estCoop = coopChoisis.has(`${rang}-${position}`);
      emplacements.push({
        rang,
        position,
        niveau: NIVEAU_CIBLE_PAR_POSITION[position],
        type: estCoop ? 'cooperatif' : 'standard'
      });
    }
  }
  return emplacements;
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

// Pioche un objectif au hasard dans le pool. Essaie d'abord le niveau et le type
// demandes ; si le pool n'a rien pour cette combinaison precise (ex: un niveau qui
// n'existe qu'en un seul type), se rabat progressivement plutot que d'echouer : le but
// est qu'une configuration ne bloque jamais, quelle que soit la taille du pool CSV.
function piocherUnObjectif(db, niveau, typeVoulu) {
  if (typeVoulu) {
    const exact = db
      .prepare('SELECT * FROM objectifs WHERE niveau IS ? AND type IS ? ORDER BY RANDOM() LIMIT 1')
      .get(niveau, typeVoulu);
    if (exact) return exact;

    const memeType = db
      .prepare('SELECT * FROM objectifs WHERE type IS ? ORDER BY RANDOM() LIMIT 1')
      .get(typeVoulu);
    if (memeType) return memeType;
  }

  const memeNiveau = db
    .prepare('SELECT * FROM objectifs WHERE niveau IS ? ORDER BY RANDOM() LIMIT 1')
    .get(niveau);
  if (memeNiveau) return memeNiveau;

  return db.prepare('SELECT * FROM objectifs ORDER BY RANDOM() LIMIT 1').get() || null;
}

// --- Distribution complete ---
//
// Pour chaque emplacement (rang, position), pioche un objectif au hasard dans le pool du
// bon niveau. Les emplacements cooperatifs partagent le meme objectif entre 2 joueurs
// (jamais le meme partenaire deux fois) ; les autres emplacements sont tires
// independamment pour chaque joueur (repetitions autorisees, le pool CSV etant souvent
// trop restreint pour garantir des objectifs tous distincts).
function distribuer(db, { partieId, joueurIds, nombreCoopParJoueur }) {
  const emplacements = genererEmplacements(nombreCoopParJoueur);
  const pairesCoopUtilisees = new Set();

  const insererCase = db.prepare(
    `INSERT INTO grille_objectifs (joueur_id, partie_id, rang, position, objectif_id, statut)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    for (const emp of emplacements) {
      const statutInitial = emp.rang === 1 && emp.position !== 3 ? 'ferme' : 'masque';

      if (emp.type === 'cooperatif') {
        const { paires, solo } = genererPairage(joueurIds, pairesCoopUtilisees);

        for (const [a, b] of paires) {
          const objectif = piocherUnObjectif(db, emp.niveau, 'cooperatif');
          insererCase.run(a, partieId, emp.rang, emp.position, objectif.id, statutInitial);
          insererCase.run(b, partieId, emp.rang, emp.position, objectif.id, statutInitial);
        }
        for (const solitaire of solo) {
          const objectif = piocherUnObjectif(db, emp.niveau, 'cooperatif');
          insererCase.run(solitaire, partieId, emp.rang, emp.position, objectif.id, statutInitial);
        }
      } else {
        for (const joueurId of joueurIds) {
          const objectif = piocherUnObjectif(db, emp.niveau, null);
          insererCase.run(joueurId, partieId, emp.rang, emp.position, objectif.id, statutInitial);
        }
      }
    }
  });

  transaction();
  return emplacements;
}

module.exports = {
  validerNombreCooperatifs,
  genererEmplacements,
  genererPairage,
  distribuer
};
