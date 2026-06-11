'use strict';

// ─── Filtre de pseudos (#72) ──────────────────────────────────────────────────
// Refuse les pseudos insultants/obscènes et les termes d'usurpation (admin…).
// Module pur, sans dépendance. Le pseudo passe d'abord USERNAME_RE
// (^[A-Za-z0-9_-]{2,30}$) : pas d'accents ni d'homoglyphes Unicode à gérer.
//
// Normalisation : minuscules, leetspeak replié, séparateurs (_ -) supprimés —
// « M3rd-euh » → « merdeuh ».
//
// Deux modes de correspondance, pour limiter les faux positifs (problème de
// Scunthorpe) :
//   - SOUS-CHAÎNE : termes longs/sans collision connue (« encule » ⊄ mots usuels) ;
//   - EXACT : termes courts qui apparaissent dans des mots légitimes
//     (« conne » ⊂ « Niconne », « nique » ⊂ « Technique », « pute » ⊂ « Compute »,
//      « bite » ⊂ « Orbite », « negro » ⊂ « Montenegro », « viol » ⊂ « Violette »).
// La liste vit ici : amendable par PR, message d'erreur volontairement neutre.

const LEET = {
  '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a',
  '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a',
};

function normalize(username, oneAs = 'i') {
  let s = String(username).toLowerCase();
  s = s.replace(/[01345789!$@]/g, (ch) => (ch === '1' || ch === '!') ? oneAs : (LEET[ch] ?? ch));
  s = s.replace(/[_-]/g, '');
  return s;
}

// « 1 » (et « ! ») se lit i OU l en leetspeak (« encu1e ») : on teste les deux.
function variants(username) {
  const a = normalize(username, 'i');
  const b = normalize(username, 'l');
  return a === b ? [a] : [a, b];
}

// Refusés où qu'ils apparaissent dans le pseudo normalisé.
const BANNED_SUBSTRING = [
  // FR
  'encule', 'enkule', 'connard', 'connasse', 'salope', 'salaud', 'pouffiasse',
  'poufiasse', 'batard', 'putain', 'pedale', 'tapette', 'niquetamere', 'tamere',
  'fdp', 'ntm', 'suceur', 'suceuse', 'branleur', 'branlette', 'couille',
  'enfoire', 'pourriture', 'merdeux', 'petasse', 'chiasse', 'gouine',
  // EN
  'fuck', 'motherfucker', 'asshole', 'bitch', 'faggot', 'nigger', 'nigga',
  'cunt', 'whore', 'slut', 'retard', 'wanker', 'dickhead',
  // Haine / dangereux
  'hitler', 'nazi', 'jihad', 'djihad', 'isis', 'daesh', 'pedo', 'viagra',
];

// Refusés seulement si le pseudo normalisé y correspond EXACTEMENT
// (sous-chaîne trop risquée : collisions avec des mots légitimes).
const BANNED_EXACT = [
  'merde', 'pute', 'putes', 'conne', 'con', 'cul', 'bite', 'zob', 'nique',
  'chienne', 'pd', 'tg', 'negro', 'negre', 'viol', 'violeur', 'suce',
  'shit', 'dick', 'cock', 'pussy', 'anal', 'sex', 'porn', 'rape', 'kill',
];

// Usurpation de rôle officiel — en sous-chaîne pour les termes sans ambiguïté…
const RESERVED_SUBSTRING = ['admin', 'moderateur', 'moderator', 'lachouine', 'support'];
// …et en exact pour les courts (« modo » ⊂ « Komodo », « staff », « root » ⊂ « Groot »).
const RESERVED_EXACT = ['modo', 'staff', 'root', 'system', 'sys', 'bot', 'mod'];

/**
 * @param {string} username  Pseudo déjà validé par USERNAME_RE.
 * @returns {boolean} true si le pseudo est acceptable.
 */
function isUsernameAllowed(username) {
  for (const n of variants(username)) {
    if (BANNED_EXACT.includes(n) || RESERVED_EXACT.includes(n)) return false;
    for (const w of BANNED_SUBSTRING) if (n.includes(w)) return false;
    for (const w of RESERVED_SUBSTRING) if (n.includes(w)) return false;
  }
  return true;
}

module.exports = { isUsernameAllowed, normalize };
