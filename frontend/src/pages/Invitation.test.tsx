// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('@/api/client', () => ({
  authApi: {},
  usersApi: { me: vi.fn() },
  invitationsApi: { resolve: vi.fn() },
  friendsApi: { sendInvitationRequest: vi.fn() },
}));

import Invitation from './Invitation';
import { friendsApi, invitationsApi, type MeResponse } from '@/api/client';
import { useAuthStore } from '@/store/authStore';

const mocked = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const CODE = 'a'.repeat(32);
const signedInAs = (username: string) =>
  useAuthStore.setState({ token: 't', user: { id: 'u1', username } as MeResponse });

function CurrentUrl() {
  const { pathname, search } = useLocation();
  return <div>URL {pathname}{search}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/invitation/${CODE}`]}>
      <Routes>
        <Route path="/invitation/:code" element={<Invitation />} />
        <Route path="*" element={<CurrentUrl />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: null, user: null });
  mocked(invitationsApi.resolve).mockResolvedValue({ ok: true, status: 200, data: { username: 'alice' } });
});

describe('<Invitation>', () => {
  it('annonce qui invite et transmet le code à l’inscription', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'alice vous invite à jouer à la Chouine' })).toBeInTheDocument();
    expect(screen.getByText(/alice et vous deviendrez amis/)).toBeInTheDocument();
    expect(invitationsApi.resolve).toHaveBeenCalledWith(CODE);

    await user.click(screen.getByRole('link', { name: 'Créer mon compte' }));
    expect(screen.getByText(`URL /connexion?onglet=inscription&invitation=${CODE}`)).toBeInTheDocument();
  });

  it('garde le code pour une personne qui a déjà un compte', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('link', { name: "J'ai déjà un compte" }));
    expect(screen.getByText(`URL /connexion?invitation=${CODE}`)).toBeInTheDocument();
  });

  it('un lien invalide le signale et permet de s’inscrire sans code', async () => {
    const user = userEvent.setup();
    mocked(invitationsApi.resolve).mockResolvedValue({ ok: false, status: 404, data: { error: 'Invitation introuvable.' } });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Ce lien d\'invitation n\'est pas valide.');
    await user.click(screen.getByRole('link', { name: 'Créer mon compte' }));
    expect(screen.getByText('URL /connexion?onglet=inscription')).toBeInTheDocument();
  });

  it('une panne ne fait pas passer le lien pour invalide : on peut réessayer', async () => {
    const user = userEvent.setup();
    mocked(invitationsApi.resolve).mockResolvedValueOnce({ ok: false, status: 429, data: {} });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de lire cette invitation');
    expect(screen.getByRole('link', { name: 'Créer mon compte' }))
      .toHaveAttribute('href', `/connexion?onglet=inscription&invitation=${CODE}`);

    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('heading', { name: 'alice vous invite à jouer à la Chouine' })).toBeInTheDocument();
  });

  it('un joueur connecté envoie une demande d’ami avec le code', async () => {
    const user = userEvent.setup();
    signedInAs('bob');
    mocked(friendsApi.sendInvitationRequest).mockResolvedValue({ ok: true, status: 201, data: { message: 'Demande d\'ami envoyée.' } });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Demander alice en ami' }));

    expect(friendsApi.sendInvitationRequest).toHaveBeenCalledWith(CODE, 't');
    expect(await screen.findByText('Demande d\'ami envoyée.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Demander alice en ami' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Créer mon compte' })).not.toBeInTheDocument();
  });

  it('déjà amis : le message remplace le bouton', async () => {
    const user = userEvent.setup();
    signedInAs('bob');
    mocked(friendsApi.sendInvitationRequest).mockResolvedValue({ ok: false, status: 409, data: { error: 'Vous êtes déjà amis.' } });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Demander alice en ami' }));

    expect(await screen.findByText('Vous êtes déjà amis.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Demander alice en ami' })).not.toBeInTheDocument();
  });

  it('une erreur de demande laisse le bouton disponible', async () => {
    const user = userEvent.setup();
    signedInAs('bob');
    mocked(friendsApi.sendInvitationRequest).mockResolvedValue({ ok: false, status: 0, data: { error: 'Serveur indisponible.' } });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Demander alice en ami' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Serveur indisponible.');
    expect(screen.getByRole('button', { name: 'Demander alice en ami' })).toBeEnabled();
  });

  it('son propre lien : message adapté, sans demande possible', async () => {
    signedInAs('alice');
    renderPage();

    expect(await screen.findByText(/C'est votre propre lien/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /en ami/ })).not.toBeInTheDocument();
    await waitFor(() => expect(friendsApi.sendInvitationRequest).not.toHaveBeenCalled());
  });

  it('attend le profil avant de proposer une action à un joueur connecté', async () => {
    useAuthStore.setState({ token: 't', user: null });
    renderPage();

    await waitFor(() => expect(invitationsApi.resolve).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('Chargement');
    expect(screen.queryByRole('link', { name: 'Créer mon compte' })).not.toBeInTheDocument();
  });
});
