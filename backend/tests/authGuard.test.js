'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createAuthGuard } = require('../src/services/authGuard');

const MIN = 60_000;
const HOUR = 3_600_000;

// ─── Brute-force login ────────────────────────────────────────────────────────

test('login : bloqué après 5 échecs du même couple IP+pseudo, message différé', () => {
  const g = createAuthGuard();
  const t0 = 1_000_000;

  for (let i = 0; i < 4; i++) g.loginFailed('1.2.3.4', 'alice', t0 + i * 1000);
  assert.equal(g.loginAllowed('1.2.3.4', 'alice', t0 + 5000).allowed, true, '4 échecs : encore permis');

  g.loginFailed('1.2.3.4', 'alice', t0 + 5000); // 5e échec → blocage
  const r = g.loginAllowed('1.2.3.4', 'alice', t0 + 6000);
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 15 * MIN);
});

test('login : le blocage expire après la durée prévue', () => {
  const g = createAuthGuard();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) g.loginFailed('1.2.3.4', 'alice', t0);
  assert.equal(g.loginAllowed('1.2.3.4', 'alice', t0 + 14 * MIN).allowed, false);
  assert.equal(g.loginAllowed('1.2.3.4', 'alice', t0 + 16 * MIN).allowed, true);
});

test('login : le compteur est isolé par couple — autre pseudo ou autre IP non affectés', () => {
  const g = createAuthGuard();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) g.loginFailed('1.2.3.4', 'alice', t0);
  assert.equal(g.loginAllowed('1.2.3.4', 'alice', t0 + 1000).allowed, false);
  assert.equal(g.loginAllowed('1.2.3.4', 'bob', t0 + 1000).allowed, true, 'autre pseudo, même IP');
  assert.equal(g.loginAllowed('5.6.7.8', 'alice', t0 + 1000).allowed, true, 'même pseudo, autre IP');
});

test('login : une connexion réussie efface l’ardoise', () => {
  const g = createAuthGuard();
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) g.loginFailed('1.2.3.4', 'alice', t0);
  g.loginSucceeded('1.2.3.4', 'alice');
  for (let i = 0; i < 4; i++) g.loginFailed('1.2.3.4', 'alice', t0 + 1000);
  assert.equal(g.loginAllowed('1.2.3.4', 'alice', t0 + 2000).allowed, true, 'le compteur est reparti de zéro');
});

test('login : les échecs hors fenêtre de 15 min ne s’additionnent pas', () => {
  const g = createAuthGuard();
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) g.loginFailed('1.2.3.4', 'alice', t0);
  // 16 min plus tard : la fenêtre est expirée, le compteur repart.
  for (let i = 0; i < 4; i++) g.loginFailed('1.2.3.4', 'alice', t0 + 16 * MIN);
  assert.equal(g.loginAllowed('1.2.3.4', 'alice', t0 + 16 * MIN + 1000).allowed, true);
});

test('login : la casse du pseudo ne contourne pas le compteur', () => {
  const g = createAuthGuard();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) g.loginFailed('1.2.3.4', i % 2 ? 'Alice' : 'aLiCe', t0);
  assert.equal(g.loginAllowed('1.2.3.4', 'alice', t0 + 1000).allowed, false);
});

// ─── Plafond d'inscriptions par IP ────────────────────────────────────────────

test('register : 5 inscriptions/24 h par IP, la 6e est refusée', () => {
  const g = createAuthGuard();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(g.registerAllowed('1.2.3.4', t0 + i), true);
    g.registerRecorded('1.2.3.4', t0 + i);
  }
  assert.equal(g.registerAllowed('1.2.3.4', t0 + 10), false);
  assert.equal(g.registerAllowed('5.6.7.8', t0 + 10), true, 'autre IP non affectée');
});

test('register : le plafond se libère après 24 h', () => {
  const g = createAuthGuard();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) g.registerRecorded('1.2.3.4', t0);
  assert.equal(g.registerAllowed('1.2.3.4', t0 + 23 * HOUR), false);
  assert.equal(g.registerAllowed('1.2.3.4', t0 + 25 * HOUR), true);
});
