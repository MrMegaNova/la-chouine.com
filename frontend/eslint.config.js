// Lint frontend (#127) : TypeScript + React. typescript-eslint pour le typage,
// react-hooks pour les règles des hooks (deps, ordre d'appel). On reste sur le
// jeu « recommended » (non typé) pour un lint rapide et sans config de projet TS.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // react-hooks v5 : règles canoniques (ordre des hooks + dépendances).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // `any` résiduels = échappatoires assumées (casts `as any` sur le composant
      // générique BtnGroup, payloads WS non encore typés). Signalés sans bloquer ;
      // leur typage propre est un chantier à part.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
