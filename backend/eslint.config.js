'use strict';

// Lint backend (#127) : Node + CommonJS. `n` (eslint-plugin-n) couvre les
// pièges Node (imports manquants, API dépréciées). Le périmètre est le code
// source ; les tests gardent leurs propres conventions (globals node:test).

const js = require('@eslint/js');
const n = require('eslint-plugin-n').default ?? require('eslint-plugin-n');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  n.configs['flat/recommended-script'],
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Node 24 : ces API existent, mais le plugin se cale sur `engines`.
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-process-exit': 'off',
    },
  },
  {
    // Tests et fichier de config requièrent des devDependencies (node:test,
    // supertest, ioredis-mock, plugins ESLint) : légitime, on lève la règle.
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'n/no-unpublished-require': 'off' },
  },
];
