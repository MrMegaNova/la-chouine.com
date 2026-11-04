// @vitest-environment jsdom
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/api/client', () => ({
  authApi: { verifyEmail: vi.fn() },
}));

import VerifyEmail from './VerifyEmail';
import { authApi } from '@/api/client';

const verifyEmail = authApi.verifyEmail as unknown as ReturnType<typeof vi.fn>;

// La page mémorise les requêtes par token : un token neuf par test les isole.
let seq = 0;
const newToken = () => String(++seq).padStart(64, 'a');

const SUCCESS = { ok: true, status: 200, data: { message: 'ok' } };
const INVALID = { ok: false, status: 400, data: { error: 'Lien invalide ou expiré.' } };
const NETWORK_DOWN = { ok: false, status: 0, data: { error: 'Serveur indisponible.' } };

function renderPage(token?: string, { strict = false } = {}) {
  const entry = token === undefined ? '/verify-email' : `/verify-email?token=${token}`;
  const tree = (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/connexion" element={<div>Page connexion</div>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('alert', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('<VerifyEmail>', () => {
  it('chargement : indicateur annoncé, sans redirection ni lien', () => {
    verifyEmail.mockReturnValue(new Promise(() => {}));
    renderPage(newToken());

    expect(within(screen.getByRole('status')).getByText(/Vérification en cours/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Aller à la connexion' })).not.toBeInTheDocument();
    expect(screen.queryByText('Page connexion')).not.toBeInTheDocument();
  });

  it('succès : message de statut et lien vers la connexion, sans alert()', async () => {
    const user = userEvent.setup();
    const token = newToken();
    verifyEmail.mockResolvedValue(SUCCESS);
    renderPage(token);

    expect(await screen.findByText('Adresse confirmée, connectez-vous.')).toBeInTheDocument();
    expect(within(screen.getByRole('status')).getByText(/Adresse confirmée/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(verifyEmail).toHaveBeenCalledWith(token);
    expect(window.alert).not.toHaveBeenCalled();

    await user.click(screen.getByRole('link', { name: 'Aller à la connexion' }));
    expect(screen.getByText('Page connexion')).toBeInTheDocument();
  });

  it('lien refusé par le serveur : alerte avec rappel du renvoi, sans réessai', async () => {
    verifyEmail.mockResolvedValue(INVALID);
    renderPage(newToken());

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Lien invalide ou expiré.')).toBeInTheDocument();
    expect(within(alert).getByText(/« Mot de passe oublié »/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Aller à la connexion' })).toHaveAttribute('href', '/connexion');
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('serveur injoignable : compte non activé annoncé, puis réessai possible', async () => {
    const user = userEvent.setup();
    const token = newToken();
    verifyEmail.mockResolvedValueOnce(NETWORK_DOWN).mockResolvedValueOnce(SUCCESS);
    renderPage(token);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/pas encore activé/)).toBeInTheDocument();
    expect(within(alert).queryByText(/Lien invalide/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Adresse confirmée, connectez-vous.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(verifyEmail).toHaveBeenCalledTimes(2);
  });

  it('StrictMode : un seul appel, le token à usage unique reste valide', async () => {
    // Un second appel recevrait « invalide », comme en production avec un token déjà consommé.
    verifyEmail.mockResolvedValueOnce(SUCCESS).mockResolvedValue(INVALID);
    renderPage(newToken(), { strict: true });

    expect(await screen.findByText('Adresse confirmée, connectez-vous.')).toBeInTheDocument();
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['manquant', undefined],
    ['de longueur incorrecte', 'tropcourt'],
  ])('token %s : échec immédiat, sans appel réseau', (_label, token) => {
    renderPage(token);

    expect(within(screen.getByRole('alert')).getByText('Lien invalide ou expiré.')).toBeInTheDocument();
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});
