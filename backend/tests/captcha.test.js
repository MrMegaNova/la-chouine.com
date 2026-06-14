'use strict';

// Captcha Cloudflare Turnstile (#104) : OPTIONNEL. Sans clé → passthrough
// (comportement inchangé). Avec clé → token vérifié auprès de Cloudflare,
// fail-closed en cas d'échec/indisponibilité.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'x';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'x';
process.env.PGDATABASE = process.env.PGDATABASE || 'x';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { verifyCaptcha, captchaEnabled } = require('../src/services/captcha');

const realFetch = global.fetch;
afterEach(() => { config.turnstile.secretKey = ''; global.fetch = realFetch; });

test('désactivé (aucune clé) : passthrough, aucun appel réseau', async () => {
  config.turnstile.secretKey = '';
  let called = false;
  global.fetch = async () => { called = true; return { json: async () => ({}) }; };
  assert.equal(captchaEnabled(), false);
  assert.equal(await verifyCaptcha(undefined, '1.2.3.4'), true);
  assert.equal(called, false, 'pas d’appel à Cloudflare quand désactivé');
});

test('activé mais token absent → refus', async () => {
  config.turnstile.secretKey = 'secret';
  assert.equal(captchaEnabled(), true);
  assert.equal(await verifyCaptcha('', '1.2.3.4'), false);
  assert.equal(await verifyCaptcha(undefined), false);
});

test('activé + Cloudflare valide → succès', async () => {
  config.turnstile.secretKey = 'secret';
  let sent = null;
  global.fetch = async (_url, opts) => { sent = opts; return { json: async () => ({ success: true }) }; };
  assert.equal(await verifyCaptcha('tok', '9.9.9.9'), true);
  assert.match(sent.body.toString(), /secret=secret/);
  assert.match(sent.body.toString(), /response=tok/);
  assert.match(sent.body.toString(), /remoteip=9.9.9.9/);
});

test('activé + Cloudflare refuse → échec', async () => {
  config.turnstile.secretKey = 'secret';
  global.fetch = async () => ({ json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) });
  assert.equal(await verifyCaptcha('tok'), false);
});

test('activé + Cloudflare injoignable → fail-closed', async () => {
  config.turnstile.secretKey = 'secret';
  global.fetch = async () => { throw new Error('network'); };
  assert.equal(await verifyCaptcha('tok'), false);
});
