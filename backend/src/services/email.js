'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

let _transport = null;

function getTransport() {
  if (!_transport) {
    const opts = {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
    };
    if (config.smtp.user && config.smtp.pass) {
      opts.auth = { user: config.smtp.user, pass: config.smtp.pass };
    }
    _transport = nodemailer.createTransport(opts);
  }
  return _transport;
}

/**
 * Envoie un email de vérification de compte.
 * @param {string} to      Adresse du destinataire
 * @param {string} token   Token de vérification (64 caractères hex)
 * @param {string} username Pseudo de l'utilisateur
 */
async function sendVerificationEmail(to, token, username) {
  const link = `${config.frontend.url}/verify-email?token=${token}`;
  await getTransport().sendMail({
    from: config.smtp.from,
    to,
    subject: 'Confirmez votre compte La Chouine',
    text: [
      `Bonjour ${username},`,
      '',
      'Merci de vous être inscrit sur la-chouine.com.',
      'Cliquez sur le lien suivant pour activer votre compte (valable 24 h) :',
      '',
      link,
      '',
      'Si vous n\'avez pas créé de compte, ignorez cet email.',
      '',
      '— L\'équipe La Chouine',
    ].join('\n'),
    html: `
      <p>Bonjour <strong>${escHtml(username)}</strong>,</p>
      <p>Merci de vous être inscrit sur <strong>la-chouine.com</strong>.<br>
      Cliquez sur le bouton ci-dessous pour activer votre compte (lien valable <strong>24&nbsp;h</strong>)&nbsp;:</p>
      <p style="margin:24px 0">
        <a href="${escHtml(link)}"
           style="background:#c9a14a;color:#16261d;padding:12px 24px;border-radius:8px;
                  text-decoration:none;font-weight:700">
          Confirmer mon compte
        </a>
      </p>
      <p style="font-size:13px;color:#666">
        Si vous n'avez pas créé de compte, ignorez cet email.
      </p>`,
  });
}

/**
 * Envoie un email de réinitialisation de mot de passe.
 */
async function sendPasswordResetEmail(to, token, username) {
  const link = `${config.frontend.url}/reset-password?token=${token}`;
  await getTransport().sendMail({
    from: config.smtp.from,
    to,
    subject: 'Réinitialisation de votre mot de passe La Chouine',
    text: [
      `Bonjour ${username},`,
      '',
      'Une demande de réinitialisation de mot de passe a été effectuée.',
      'Cliquez sur le lien suivant (valable 1 h) :',
      '',
      link,
      '',
      'Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet email.',
      '',
      '— L\'équipe La Chouine',
    ].join('\n'),
    html: `
      <p>Bonjour <strong>${escHtml(username)}</strong>,</p>
      <p>Cliquez sur le bouton ci-dessous pour réinitialiser votre mot de passe
         (lien valable <strong>1&nbsp;h</strong>)&nbsp;:</p>
      <p style="margin:24px 0">
        <a href="${escHtml(link)}"
           style="background:#c9a14a;color:#16261d;padding:12px 24px;border-radius:8px;
                  text-decoration:none;font-weight:700">
          Réinitialiser mon mot de passe
        </a>
      </p>
      <p style="font-size:13px;color:#666">
        Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.
      </p>`,
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
