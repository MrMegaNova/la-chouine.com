// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/api/client', () => ({
  authApi: {},
  onlineApi: { wsTicket: vi.fn() },
  usersApi: {
    me: vi.fn(),
    history: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

import Profile from './Profile';
import { usersApi, type MeResponse } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { useOnlineStore } from '@/store/onlineStore';

const mocked = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const ME: MeResponse = {
  id: 'u1', username: 'alice', email: 'alice@example.com', joined: '2026-01-01T00:00:00Z', avatar: null,
  stats: { wins: 0, losses: 0, plays: 0, local: { wins: 0, losses: 0, plays: 0 } }, ratings: { classic: 1500, mondoubleau: 1500 }, achievements: [],
};

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/profil']}>
      <Routes>
        <Route path="/" element={<div>Page accueil</div>} />
        <Route path="/profil" element={<Profile />} />
        <Route path="/connexion" element={<div>Page connexion</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openAndFill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Supprimer mon compte' }));
  await user.type(screen.getByLabelText('Mot de passe actuel'), 'Motdepasse123!');
  await user.click(screen.getByRole('checkbox'));
}
const submitButton = () => screen.getByRole('button', { name: 'Supprimer définitivement mon compte' });

beforeEach(() => {
  vi.clearAllMocks();
  mocked(usersApi.me).mockResolvedValue({ ok: true, status: 200, data: ME });
  mocked(usersApi.history).mockResolvedValue({ ok: true, status: 200, data: [] });
  useAuthStore.setState({ token: 'tok', user: ME });
  useOnlineStore.setState({ status: 'idle' });
});

describe('<Profile> : suppression de compte (#238)', () => {
  it('le formulaire est replié et annoncé : forfait et anonymisation', async () => {
    const user = userEvent.setup();
    renderProfile();
    expect(screen.getByRole('heading', { name: 'Zone de danger' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Mot de passe actuel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Supprimer mon compte' }));
    expect(screen.getByText(/vous la perdez par forfait/)).toBeInTheDocument();
    expect(screen.getByText(/sous le nom « Ancien joueur »/)).toBeInTheDocument();
  });

  it('exige le mot de passe ET la case de confirmation', async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole('button', { name: 'Supprimer mon compte' }));

    expect(submitButton()).toBeDisabled();
    await user.type(screen.getByLabelText('Mot de passe actuel'), 'Motdepasse123!');
    expect(submitButton()).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(submitButton()).toBeEnabled();

    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByLabelText('Mot de passe actuel'), '{Enter}');
    expect(usersApi.deleteAccount).not.toHaveBeenCalled();
  });

  it('mauvais mot de passe : erreur affichée, session conservée', async () => {
    const user = userEvent.setup();
    mocked(usersApi.deleteAccount).mockResolvedValue({ ok: false, status: 403, data: { error: 'Mot de passe actuel incorrect.' } });
    renderProfile();
    await openAndFill(user);
    await user.click(submitButton());

    expect(await screen.findByText('Mot de passe actuel incorrect.')).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBe('tok');
    expect(screen.queryByText('Page accueil')).not.toBeInTheDocument();
  });

  it('succès : déconnexion, retour à l’accueil et socket oublié', async () => {
    const user = userEvent.setup();
    useOnlineStore.setState({ status: 'over' });
    mocked(usersApi.deleteAccount).mockResolvedValue({ ok: true, status: 200, data: { message: 'Compte supprimé.' } });
    renderProfile();
    await openAndFill(user);
    await user.click(submitButton());

    expect(await screen.findByText('Page accueil')).toBeInTheDocument();
    expect(usersApi.deleteAccount).toHaveBeenCalledWith({ currentPassword: 'Motdepasse123!' }, 'tok');
    expect(useAuthStore.getState().token).toBeNull();
    expect(useOnlineStore.getState().status).toBe('idle');
    expect(screen.queryByText('Page connexion')).not.toBeInTheDocument();
  });

  it('session fermée par le serveur avant la réponse : termine sur l’accueil', async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mocked(usersApi.deleteAccount).mockReturnValue(new Promise(r => { resolve = r; }));
    renderProfile();
    await openAndFill(user);
    await user.click(submitButton());

    act(() => useAuthStore.getState().logout()); // fermeture 4003 reçue d'abord
    await act(async () => resolve({ ok: true, status: 200, data: {} }));

    await waitFor(() => expect(screen.getByText('Page accueil')).toBeInTheDocument());
    expect(screen.queryByText('Page connexion')).not.toBeInTheDocument();
  });

  it('une déconnexion ordinaire mène toujours à la page de connexion', async () => {
    renderProfile();
    act(() => useAuthStore.getState().logout());
    expect(await screen.findByText('Page connexion')).toBeInTheDocument();
  });
});

describe('<Profile> : résultats déclarés (#279)', () => {
  const game = (mode: string, id: string) => ({
    id, mode, variant: 'classic', player_count: 2, target_score: 3,
    date: '2026-01-01T12:00:00Z', my_score: 3, won: true, opponents: id,
  });

  it('l’historique signale les parties locales, pas les parties en ligne', async () => {
    mocked(usersApi.history).mockResolvedValue({
      ok: true, status: 200, data: [game('ai', 'Ordinateur'), game('online', 'Bob')],
    });
    renderProfile();

    const local = (await screen.findByText('vs Ordinateur')).parentElement;
    const online = screen.getByText('vs Bob').parentElement;
    expect(local).toHaveTextContent('Résultat déclaré');
    expect(online).not.toHaveTextContent('Résultat déclaré');
  });
});

describe('<Profile> : compte créé avec Google, Facebook ou Apple', () => {
  const OAUTH_ME: MeResponse = { ...ME, hasPassword: false, providers: ['google'] };

  beforeEach(() => {
    mocked(usersApi.me).mockResolvedValue({ ok: true, status: 200, data: OAUTH_ME });
    useAuthStore.setState({ token: 'tok', user: OAUTH_ME });
  });

  it('pas de changement de mot de passe, fournisseur indiqué', () => {
    renderProfile();
    expect(screen.queryByRole('button', { name: 'Changer mon mot de passe' })).not.toBeInTheDocument();
    expect(screen.getByText('Connexion avec Google.')).toBeInTheDocument();
    expect(screen.getByText(/Pas encore de mot de passe/)).toBeInTheDocument();
  });

  it('suppression : on recopie son pseudo au lieu du mot de passe', async () => {
    const user = userEvent.setup();
    mocked(usersApi.deleteAccount).mockResolvedValue({ ok: true, status: 200, data: { message: 'Compte supprimé.' } });
    renderProfile();
    await user.click(screen.getByRole('button', { name: 'Supprimer mon compte' }));
    expect(screen.queryByLabelText('Mot de passe actuel')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Recopiez votre pseudo/), 'alice');
    await user.click(screen.getByRole('checkbox'));
    await user.click(submitButton());

    expect(await screen.findByText('Page accueil')).toBeInTheDocument();
    expect(usersApi.deleteAccount).toHaveBeenCalledWith({ confirmUsername: 'alice' }, 'tok');
  });
});
