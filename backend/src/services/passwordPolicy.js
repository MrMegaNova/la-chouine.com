'use strict';

// Politique de mot de passe — source unique, partagée par l'inscription/reset
// (routes/auth.js) et le changement de mot de passe connecté (routes/users.js,
// #108). Renvoie un message d'erreur, ou null si le mot de passe est conforme.
function validatePassword(password) {
  if (!password || password.length < 8)
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  if (password.length > 128)
    return 'Mot de passe trop long (128 caractères max).';
  if (!/[a-z]/.test(password))
    return 'Le mot de passe doit contenir au moins une lettre minuscule.';
  if (!/[A-Z]/.test(password))
    return 'Le mot de passe doit contenir au moins une lettre majuscule.';
  if (!/[0-9]/.test(password))
    return 'Le mot de passe doit contenir au moins un chiffre.';
  if (!/[^A-Za-z0-9]/.test(password))
    return 'Le mot de passe doit contenir au moins un caractère spécial.';
  return null;
}

module.exports = { validatePassword };
