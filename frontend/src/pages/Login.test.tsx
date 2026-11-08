// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Le store d'auth parle au backend via @/api/client : on stub le module pour
// piloter les réponses sans réseau. Tests de flux critiques (#129).
vi.mock('@/api/client', () => ({
  authApi: { login: vi.fn(), register: vi.fn(), forgotPassword: vi.fn() },
  usersApi: { me: vi.fn() },
  oauthApi: { providers: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { providers: [] } }) },
  oauthStartUrl: vi.fn(),
}));

import Login from './Login';
import { authApi, usersApi } from '@/api/client';
import { useAuthStore } from '@/store/authStore';

const mocked = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/connexion']}>
      <Routes>
        <Route path="/connexion" element={<Login />} />
        <Route path="/profil" element={<div>Page profil</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: null, user: null });
});

describe('<Login>', () => {
  it('le champ-piège anti-bot (#86) est hors de l’arbre d’accessibilité', async () => {
    const user = userEvent.setup();
    const { container } = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Inscription' }));

    // Nom neutre (pas `website`) pour ne pas être ciblé par l'autofill (#203).
    const honeypot = container.querySelector('input[name="contact_extra"]');
    expect(honeypot).not.toBeNull();
    expect(honeypot).toHaveAttribute('aria-hidden', 'true');
    expect(honeypot).toHaveAttribute('tabindex', '-1');
    // Hints explicites aux gestionnaires de mots de passe (#203).
    expect(honeypot).toHaveAttribute('data-lpignore', 'true');
    expect(honeypot).toHaveAttribute('data-1p-ignore', 'true');
    // Aucun champ texte accessible ne porte le nom du piège (il est masqué aux
    // lecteurs d'écran) : un humain ne peut pas le remplir par erreur.
    const accessibleTextboxes = screen.queryAllByRole('textbox');
    expect(accessibleTextboxes).not.toContain(honeypot);
  });

  it('affiche le message d’erreur renvoyé par le serveur à la connexion', async () => {
    const user = userEvent.setup();
    mocked(authApi.login).mockResolvedValue({ ok: false, status: 401, data: { error: 'Identifiants invalides.' } });
    renderLogin();

    await user.type(screen.getByPlaceholderText('Votre pseudo'), 'alice');
    await user.type(screen.getByPlaceholderText('••••••••'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText('Identifiants invalides.')).toBeInTheDocument();
    expect(screen.queryByText('Page profil')).not.toBeInTheDocument();
  });

  it('propose le renvoi d’un lien quand le compte n’est pas activé (#105)', async () => {
    const user = userEvent.setup();
    mocked(authApi.login).mockResolvedValue({ ok: false, status: 403, data: { error: 'EMAIL_NOT_VERIFIED' } });
    renderLogin();

    await user.type(screen.getByPlaceholderText('Votre pseudo'), 'alice');
    await user.type(screen.getByPlaceholderText('••••••••'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText('Compte non activé — vérifiez vos emails, y compris vos spams.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recevez-en un nouveau/ })).toBeInTheDocument();
  });

  it('inscription réussie : rappelle de vérifier les spams', async () => {
    const user = userEvent.setup();
    mocked(authApi.register).mockResolvedValue({ ok: true, status: 201, data: { message: 'Compte créé.' } });
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Inscription' }));
    await user.type(screen.getByPlaceholderText('Votre pseudo'), 'alice');
    await user.type(screen.getByPlaceholderText('votre@email.com'), 'alice@example.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'Motdepasse123!');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    expect(await screen.findByText('Compte créé ! Vérifiez vos emails, y compris vos spams, pour activer votre compte.')).toBeInTheDocument();
  });

  describe('parcours d’invitation (#295)', () => {
    const CODE = 'k7m3qx';

    function renderAt(url: string) {
      return render(
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/connexion" element={<Login />} />
            <Route path="/profil" element={<div>Page profil</div>} />
            <Route path="/i/:code" element={<div>Page invitation</div>} />
          </Routes>
        </MemoryRouter>,
      );
    }

    async function fillAndRegister(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByPlaceholderText('Votre pseudo'), 'alice');
      await user.type(screen.getByPlaceholderText('votre@email.com'), 'alice@example.com');
      await user.type(screen.getByPlaceholderText('••••••••'), 'Motdepasse123!');
      await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    }

    it('transmet le code à l’inscription, même après un changement d’onglet', async () => {
      const user = userEvent.setup();
      mocked(authApi.register).mockResolvedValue({ ok: true, status: 201, data: { message: 'Compte créé.' } });
      renderAt(`/connexion?onglet=inscription&invitation=${CODE}`);

      expect(screen.getByText(/vous deviendrez amis avec la personne qui vous invite/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Connexion' }));
      await user.click(screen.getByRole('button', { name: 'Inscription' }));
      await fillAndRegister(user);

      expect(mocked(authApi.register).mock.calls[0][0]).toMatchObject({ username: 'alice', invitationCode: CODE });
      expect(await screen.findByText(/Compte créé !/)).toBeInTheDocument();
    });

    it('sans code, n’envoie rien et n’annonce aucune amitié', async () => {
      const user = userEvent.setup();
      mocked(authApi.register).mockResolvedValue({ ok: true, status: 201, data: { message: 'Compte créé.' } });
      renderAt('/connexion?onglet=inscription');

      expect(screen.queryByText(/vous deviendrez amis/)).not.toBeInTheDocument();
      await fillAndRegister(user);

      expect(mocked(authApi.register).mock.calls[0][0].invitationCode).toBeUndefined();
    });

    it('ignore un code mal formé dans l’URL', async () => {
      const user = userEvent.setup();
      mocked(authApi.register).mockResolvedValue({ ok: true, status: 201, data: { message: 'Compte créé.' } });
      renderAt('/connexion?onglet=inscription&invitation=pas-un-code');

      expect(screen.queryByText(/vous deviendrez amis/)).not.toBeInTheDocument();
      await fillAndRegister(user);

      expect(mocked(authApi.register).mock.calls[0][0].invitationCode).toBeUndefined();
    });

    it('la connexion d’un compte existant revient à l’invitation', async () => {
      const user = userEvent.setup();
      mocked(authApi.login).mockResolvedValue({ ok: true, status: 200, data: { token: 'tok', id: 'u1', username: 'alice' } });
      mocked(usersApi.me).mockResolvedValue({ ok: false, status: 0, data: {} });
      renderAt(`/connexion?invitation=${CODE}`);

      await user.type(screen.getByPlaceholderText('Votre pseudo'), 'alice');
      await user.type(screen.getByPlaceholderText('••••••••'), 'whatever');
      await user.click(screen.getByRole('button', { name: 'Se connecter' }));

      expect(await screen.findByText('Page invitation')).toBeInTheDocument();
    });

    it('après l’inscription, la connexion ne revient plus à l’invitation', async () => {
      const user = userEvent.setup();
      mocked(authApi.register).mockResolvedValue({ ok: true, status: 201, data: { message: 'Compte créé.' } });
      mocked(authApi.login).mockResolvedValue({ ok: true, status: 200, data: { token: 'tok', id: 'u1', username: 'alice' } });
      mocked(usersApi.me).mockResolvedValue({ ok: false, status: 0, data: {} });
      renderAt(`/connexion?onglet=inscription&invitation=${CODE}`);

      await fillAndRegister(user);
      await screen.findByText(/Compte créé !/);
      await user.click(screen.getByRole('button', { name: 'Se connecter' }));

      expect(await screen.findByText('Page profil')).toBeInTheDocument();
    });
  });

  it('connexion réussie : redirige vers le profil', async () => {
    const user = userEvent.setup();
    mocked(authApi.login).mockResolvedValue({ ok: true, status: 200, data: { token: 'tok', id: 'u1', username: 'alice' } });
    mocked(usersApi.me).mockResolvedValue({ ok: false, status: 0, data: {} });
    renderLogin();

    await user.type(screen.getByPlaceholderText('Votre pseudo'), 'alice');
    await user.type(screen.getByPlaceholderText('••••••••'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText('Page profil')).toBeInTheDocument();
  });

  it('mot de passe oublié : affiche le message de confirmation', async () => {
    const user = userEvent.setup();
    mocked(authApi.forgotPassword).mockResolvedValue({ ok: true, status: 200, data: { message: 'Email envoyé si le compte existe.' } });
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Mot de passe oublié ?' }));
    await user.type(screen.getByPlaceholderText('votre@email.com'), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'Envoyer le lien' }));

    await waitFor(() =>
      expect(screen.getByText('Email envoyé si le compte existe. Pensez à vérifier vos spams.')).toBeInTheDocument());
    expect(authApi.forgotPassword).toHaveBeenCalledWith('alice@example.com');
  });
});
