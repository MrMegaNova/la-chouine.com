// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@/api/client', () => ({
  onlineApi: { get: vi.fn(() => new Promise(() => {})) },
  gamesApi: {},
}));

import Home from './Home';
import App from '@/App';
import { useAuthStore } from '@/store/authStore';
import { useGameStore } from '@/store/gameStore';
import { useOnlineStore } from '@/store/onlineStore';

// Parcours « un clic » depuis l'accueil (#253), avec le vrai store de partie.

const CTA = { name: "Jouer contre l'ordinateur" };

function CurrentPath() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useGameStore.getState().quitGame();
  useAuthStore.setState({ user: null, token: null });
  useOnlineStore.setState({ status: 'idle' });
});
afterEach(() => useGameStore.getState().quitGame());

describe('<Home> : jouer en un clic', () => {
  it('lance une partie contre l\'ordinateur avec les réglages par défaut, puis va sur /jeu', async () => {
    renderHome();
    await userEvent.click(screen.getByRole('button', CTA));

    expect(useGameStore.getState().game?.opts).toEqual({
      mode: 'ai', variant: 'classic', playerCount: 2, diff: 'normal', target: 3, names: ['Vous', 'Ordinateur'],
    });
    expect(screen.getByTestId('path')).toHaveTextContent('/jeu');
  });

  it('nomme le joueur connecté', async () => {
    useAuthStore.setState({ user: { username: 'Léo' } as never });
    renderHome();
    await userEvent.click(screen.getByRole('button', CTA));

    expect(useGameStore.getState().game?.names).toEqual(['Léo', 'Ordinateur']);
  });

  it('affiche la table dès le clic, sans passer par les réglages', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', CTA));

    expect(useGameStore.getState().game?.phase).toBe('cut');
    expect(screen.getAllByRole('button', { name: /carte/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Lancer une partie' })).not.toBeInTheDocument();
  });

  it('rejoint une partie locale en cours sans l\'écraser', async () => {
    useGameStore.getState().startGame({
      mode: 'ai', variant: 'mondoubleau', playerCount: 3, diff: 'hard', target: 5,
      names: ['Vous', 'Ordinateur 1', 'Ordinateur 2'],
    });
    const before = useGameStore.getState().game;
    renderHome();
    await userEvent.click(screen.getByRole('button', CTA));

    expect(useGameStore.getState().game).toBe(before);
    expect(screen.getByTestId('path')).toHaveTextContent('/jeu');
  });

  it('ne démarre rien pendant une partie ou une recherche en ligne', async () => {
    useOnlineStore.setState({ status: 'playing' });
    renderHome();
    await userEvent.click(screen.getByRole('button', CTA));

    expect(useGameStore.getState().game).toBeNull();
    expect(screen.getByRole('button', CTA)).toBeInTheDocument();
  });

  it('garde un lien vers les réglages détaillés, qui ne lance aucune partie', async () => {
    renderHome();
    const options = screen.getByRole('link', { name: 'Choisir les options' });
    expect(options).toHaveAttribute('href', '/jouer');

    await userEvent.click(options);
    expect(useGameStore.getState().game).toBeNull();
    expect(screen.getByTestId('path')).toHaveTextContent('/jouer');
  });

  it('décrit les réglages appliqués au bouton', () => {
    renderHome();
    expect(screen.getByRole('button', CTA)).toHaveAccessibleDescription(/variante classique, niveau Confirmé/);
  });
});
