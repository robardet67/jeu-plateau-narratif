// Normalise un texte pour comparaison insensible aux accents/casse (ex: "Coopératif"
// et "cooperatif" doivent etre reconnus comme identiques).
const REGEX_DIACRITIQUES = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

function normaliser(texte) {
  return (texte || '')
    .normalize('NFD')
    .replace(REGEX_DIACRITIQUES, '')
    .trim()
    .toLowerCase();
}

module.exports = { normaliser };
