// Setup global Vitest (#129) : enregistre les matchers @testing-library/jest-dom
// (toBeInTheDocument, toBeDisabled, etc.) et nettoie le DOM rendu entre chaque
// test. Sans incidence sur les suites en environnement node (moteur, stores).
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
