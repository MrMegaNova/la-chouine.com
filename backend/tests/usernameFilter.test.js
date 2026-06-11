'use strict';

// Filtre de pseudos (#72) : insultes FR/EN (leetspeak replié), termes
// d'usurpation, et NON-refus des faux positifs connus (Scunthorpe).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isUsernameAllowed, normalize } = require('../src/services/usernameFilter');

test('normalize : minuscules, leetspeak, séparateurs', () => {
  assert.equal(normalize('M3rd-3uh'), 'merdeuh');
  assert.equal(normalize('3NCU1E', 'l'), 'encule'); // 1 lu comme l
  assert.equal(normalize('3NCU1E', 'i'), 'encuie'); // 1 lu comme i — d'où les deux variantes
  assert.equal(normalize('S@l0pe'), 'salope');
});

test('refuse les insultes, y compris en leetspeak ou avec séparateurs', () => {
  const refused = [
    'Connard', 'c0nnard', 'Encule92', '3ncu13', 'encu1e', 'Salope_du_72',
    'put4in', 'FDP-2024', 'Batard', 'fuck-you', 'B1tch', 'nigg3r', 'Hitler88',
    'm3rde', 'Pute', 'NIQUE', 'tg',
  ];
  for (const u of refused) {
    assert.equal(isUsernameAllowed(u), false, `« ${u} » devrait être refusé`);
  }
});

test('refuse l’usurpation de rôle officiel', () => {
  for (const u of ['Admin', 'admin-bot', 'AdminChouine', 'Moderateur', 'modo', 'Support_FR', 'LaChouine', 'root', 'system']) {
    assert.equal(isUsernameAllowed(u), false, `« ${u} » devrait être refusé`);
  }
});

test('accepte les pseudos légitimes, dont les faux positifs de Scunthorpe', () => {
  const allowed = [
    'Leo', 'SprazerJu', 'Marie-Claire', 'Joueur_72',
    // Mots contenant un terme court banni en EXACT seulement :
    'Niconne',      // ⊃ conne
    'Technique',    // ⊃ nique
    'Computer',     // ⊃ pute
    'Orbite',       // ⊃ bite
    'Montenegro',   // ⊃ negro
    'Violette',     // ⊃ viol
    'Calculatrice', // ⊃ cul
    'Groot',        // ⊃ root
    'Komodo',       // ⊃ modo
    'Modeste',      // ⊃ mod
    'Consuelo',     // ⊃ con
    'Sucette',      // ⊃ suce
    'Killian',      // ⊃ kill
  ];
  for (const u of allowed) {
    assert.equal(isUsernameAllowed(u), true, `« ${u} » devrait être accepté`);
  }
});
