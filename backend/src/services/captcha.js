'use strict';

// ─── Captcha Cloudflare Turnstile (#104) ──────────────────────────────────────
// OPTIONNEL : si aucune clé secrète n'est configurée (`TURNSTILE_SECRET_KEY`),
// la vérification est un no-op qui réussit → comportement inchangé. Avec une
// clé, on valide le token (`cf-turnstile-response`) auprès de l'API Cloudflare ;
// en cas d'échec ou d'indisponibilité, on REFUSE (fail-closed) puisque la
// protection a été explicitement activée.

const config = require('../config');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Le captcha est-il activé (clé configurée) ? */
function captchaEnabled() {
  return Boolean(config.turnstile.secretKey);
}

/**
 * Vérifie un token Turnstile.
 * @param {string} [token] valeur de `cf-turnstile-response`
 * @param {string} [ip]    IP client (remoteip)
 * @returns {Promise<boolean>} true si désactivé, ou si Cloudflare valide le token
 */
async function verifyCaptcha(token, ip) {
  if (!captchaEnabled()) return true; // non configuré : passthrough
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: config.turnstile.secretKey, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    return data && data.success === true;
  } catch {
    return false; // captcha activé mais Cloudflare injoignable → fail-closed
  }
}

module.exports = { captchaEnabled, verifyCaptcha };
