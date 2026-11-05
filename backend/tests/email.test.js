'use strict';

// Contenu des emails transactionnels : nom annoncé au serveur SMTP et document
// HTML complet. Un faux transport capture les messages à la place de l'envoi réel.

const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

let transportOptions;
let sentMessage;
let createTransportMock;
let sendVerificationEmail;
let sendPasswordResetEmail;

before(() => {
  createTransportMock = mock.method(nodemailer, 'createTransport', (options) => {
    transportOptions = options;
    return { sendMail: async (message) => { sentMessage = message; } };
  });
  ({ sendVerificationEmail, sendPasswordResetEmail } = require('../src/services/email'));
});

after(() => createTransportMock.mock.restore());

function assertCompleteHtml(html, subject) {
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.ok(html.includes(`<title>${subject}</title>`), 'le titre reprend le sujet');
  assert.match(html, /<body>[\s\S]*<\/body>\s*<\/html>$/);
}

test('email de vérification : nom SMTP, HTML complet et pseudo échappé', async () => {
  await sendVerificationEmail('a@email.invalid', 'jeton', '<b>alice</b>');

  assert.equal(transportOptions.name, 'la-chouine.com');
  assertCompleteHtml(sentMessage.html, 'Confirmez votre compte La Chouine');
  assert.ok(sentMessage.html.includes('&lt;b&gt;alice&lt;/b&gt;'));
  assert.ok(!sentMessage.html.includes('<b>alice</b>'));
});

test('email de réinitialisation : HTML complet', async () => {
  await sendPasswordResetEmail('a@email.invalid', 'jeton', 'alice');

  assertCompleteHtml(sentMessage.html, 'Réinitialisation de votre mot de passe La Chouine');
});
