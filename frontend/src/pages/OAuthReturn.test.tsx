// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/api/client', () => ({
  authApi: {},
  usersApi: { me: vi.fn().mockResolvedValue({ ok: false, status: 500, data: {} }) },
  oauthApi: { exchange: vi.fn(), signup: vi.fn(), complete: vi.fn() },
}));

import OAuthReturn from './OAuthReturn';
import { oauthApi } from '@/api/client';
import { useAuthStore } from '@/store/authStore';

// Retour de Google, Facebook ou Apple.

const mocked = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const SESSION = { token: 'jwt', id: 'u1', username: 'helene' };

function show(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/connexion/retour${search}`]}>
      <Routes>
        <Route path="/connexion/retour" element={<OAuthReturn />} />
        <Route path="/profil" element={<div>Page profil</div>} />
        <Route path="/connexion" element={<div>Page connexion</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: null, user: null });
});

describe('<OAuthReturn>', () => {
  it('compte trouvé : échange le code une seule fois, ouvre la session', async () => {
    mocked(oauthApi.exchange).mockResolvedValue({ ok: true, status: 200, data: SESSION });
    show('?code=abc');
    expect(await screen.findByText('Page profil')).toBeInTheDocument();
    expect(oauthApi.exchange).toHaveBeenCalledTimes(1);
    expect(oauthApi.exchange).toHaveBeenCalledWith('abc');
    expect(useAuthStore.getState().token).toBe('jwt');
  });

  it('nouveau joueur : pseudo proposé, modifiable, puis compte créé', async () => {
    const user = userEvent.setup();
    mocked(oauthApi.signup).mockResolvedValue({ ok: true, status: 200, data: { provider: 'google', suggestion: 'Helene' } });
    mocked(oauthApi.complete)
      .mockResolvedValueOnce({ ok: false, status: 409, data: { error: 'Ce pseudo est déjà pris.' } })
      .mockResolvedValueOnce({ ok: true, status: 201, data: SESSION });
    show('?inscription=xyz');

    const input = await screen.findByLabelText('Pseudo');
    expect(input).toHaveValue('Helene');
    expect(screen.getByText(/inscription avec Google/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByText('Ce pseudo est déjà pris.')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'helene');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByText('Page profil')).toBeInTheDocument();
    expect(oauthApi.complete).toHaveBeenLastCalledWith('xyz', 'helene');
    expect(useAuthStore.getState().token).toBe('jwt');
  });

  it('erreur : message expliqué et retour à la connexion', async () => {
    show('?erreur=compte');
    expect(screen.getByRole('alert')).toHaveTextContent('Un compte existe déjà avec cette adresse email');
    expect(screen.getByRole('link', { name: 'Retour à la connexion' })).toHaveAttribute('href', '/connexion');
  });

  it('code expiré : erreur du serveur affichée', async () => {
    mocked(oauthApi.exchange).mockResolvedValue({ ok: false, status: 400, data: { error: 'Lien de connexion invalide ou expiré. Recommencez.' } });
    show('?code=vieux');
    expect(await screen.findByRole('alert')).toHaveTextContent('Lien de connexion invalide ou expiré');
  });
});
