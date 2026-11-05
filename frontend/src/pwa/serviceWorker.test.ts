// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// État du module (mise à jour en attente) : un module neuf par test.
async function setup(controller: object | null) {
  vi.resetModules();
  const registration = { update: vi.fn(() => Promise.resolve()) };
  const fake = Object.assign(new EventTarget(), {
    controller,
    register: vi.fn(() => Promise.resolve(registration)),
  });
  vi.stubGlobal('navigator', { serviceWorker: fake });
  const module = await import('./serviceWorker');
  module.registerServiceWorker();
  return { ...module, fake, registration };
}

describe('registerServiceWorker', () => {
  beforeEach(() => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('enregistre /sw.js au chargement de la page, pas avant', async () => {
    const { fake } = await setup(null);
    expect(fake.register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    expect(fake.register).toHaveBeenCalledWith('/sw.js');
  });

  it('ne recharge pas à la première prise de contrôle', async () => {
    const { fake, applyPendingUpdate } = await setup(null);
    fake.dispatchEvent(new Event('controllerchange'));
    const reload = vi.fn();
    applyPendingUpdate(reload);
    expect(reload).not.toHaveBeenCalled();
  });

  it('recharge quand un nouveau service worker remplace le précédent', async () => {
    const { fake, applyPendingUpdate } = await setup({});
    const reload = vi.fn();
    applyPendingUpdate(reload);
    expect(reload).not.toHaveBeenCalled();
    fake.dispatchEvent(new Event('controllerchange'));
    applyPendingUpdate(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('recherche une nouvelle version au retour sur la page', async () => {
    const { fake, registration } = await setup({});
    window.dispatchEvent(new Event('load'));
    await fake.register.mock.results[0].value;
    await Promise.resolve();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalled();
  });
});
