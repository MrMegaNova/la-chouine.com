// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/api/client', () => ({
  authApi: { resetPassword: vi.fn() },
}));

import ResetPassword from './ResetPassword';
import { authApi } from '@/api/client';

const mocked = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const VALID_TOKEN = 'a'.repeat(64); // longueur attendue par la page (#107)
const STRONG = 'Password1!';

function renderReset(token?: string) {
  const entry = token === undefined ? '/reset-password' : `/reset-password?token=${token}`;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/connexion" element={<div>Page connexion</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('<ResetPassword>', () => {
  it('token manquant : lien invalide, pas de formulaire', () => {
    renderReset();
    expect(screen.getByText(/Lien invalide ou incomplet/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('••••••••')).not.toBeInTheDocument();
  });

  it('token de longueur incorrecte : lien invalide', () => {
    renderReset('tropcourt');
    expect(screen.getByText(/Lien invalide ou incomplet/)).toBeInTheDocument();
  });

  it('mot de passe trop faible : refus local, sans appel réseau', async () => {
    const user = userEvent.setup();
    renderReset(VALID_TOKEN);
    await user.type(screen.getByPlaceholderText('••••••••'), 'faible');
    await user.click(screen.getByRole('button', { name: 'Changer mon mot de passe' }));

    expect(await screen.findByText(/ne respecte pas toutes les règles/)).toBeInTheDocument();
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it('token expiré côté serveur : affiche l’erreur renvoyée', async () => {
    const user = userEvent.setup();
    mocked(authApi.resetPassword).mockResolvedValue({ ok: false, status: 400, data: { error: 'Lien expiré.' } });
    renderReset(VALID_TOKEN);

    await user.type(screen.getByPlaceholderText('••••••••'), STRONG);
    await user.click(screen.getByRole('button', { name: 'Changer mon mot de passe' }));

    expect(await screen.findByText('Lien expiré.')).toBeInTheDocument();
    expect(authApi.resetPassword).toHaveBeenCalledWith(VALID_TOKEN, STRONG);
  });

  it('réinitialisation réussie : redirige vers la connexion', async () => {
    const user = userEvent.setup();
    mocked(authApi.resetPassword).mockResolvedValue({ ok: true, status: 200, data: { message: 'ok' } });
    renderReset(VALID_TOKEN);

    await user.type(screen.getByPlaceholderText('••••••••'), STRONG);
    await user.click(screen.getByRole('button', { name: 'Changer mon mot de passe' }));

    expect(await screen.findByText('Page connexion')).toBeInTheDocument();
  });
});
