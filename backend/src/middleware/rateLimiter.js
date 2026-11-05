'use strict';

const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20, // ex-`max`, renommé en express-rate-limit v7+ (#41)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Ralentissez.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Routes protégées par le mot de passe courant : seuls les échecs comptent, pour
// freiner les essais avec un JWT volé.
const passwordAttemptOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
};

// Suppression de compte (#238) : action irréversible.
const deleteAccountLimiter = rateLimit(passwordAttemptOptions);

// Changement de mot de passe (#293).
const changePasswordLimiter = rateLimit(passwordAttemptOptions);

module.exports = { authLimiter, apiLimiter, deleteAccountLimiter, changePasswordLimiter };
