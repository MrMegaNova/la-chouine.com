// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HandResult } from './HandResult';
import { useGameStore } from '@/store/gameStore';
import { usersApi } from '@/api/client';
import type { GameState, HandResult as HandResultType } from '@/game/types';

// Fin de match local (#290) : enregistrement unique, invitation à s'inscrire
// pour un joueur sans compte, invitation d'un ami pour un joueur connecté.

const game = {
  mode: 'ai', variant: 'classic', playerCount: 2, target: 3, names: ['Moi', 'Ordinateur'],
  scores: [3, 1], opts: {},
} as unknown as GameState;

const result = (matchWinner: number | null): HandResultType => ({
  cp: [80, 40], ann: [0, 0], der: 0, tot: [90, 40], winner: 0, forced: false, matchWinner,
});

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

// Comme dans App : la table (et son résultat) recouvre les routes tant qu'une
// partie existe, et /jeu sans partie renvoie vers /jouer.
function Shell(props: { matchWinner: number | null; token: string | null }) {
  const current = useGameStore(st => st.game);
  return (
    <>
      <Routes>
        <Route path="/jeu" element={current ? null : <Navigate to="/jouer" replace />} />
        <Route path="/jouer" element={<Where />} />
        <Route path="/connexion" element={<Where />} />
      </Routes>
      {current && (
        <HandResult result={result(props.matchWinner)} game={game} onNext={vi.fn()}
          token={props.token} userId={props.token ? 'u1' : null} />
      )}
    </>
  );
}

function show(props: { matchWinner: number | null; token?: string | null }) {
  useGameStore.setState({ game });
  return render(
    <MemoryRouter initialEntries={['/jeu']}>
      <Shell matchWinner={props.matchWinner} token={props.token ?? null} />
    </MemoryRouter>,
  );
}

const recordMatchEnd = vi.fn().mockResolvedValue(undefined);
const quitGame = vi.fn(() => useGameStore.setState({ game: null }));

beforeEach(() => {
  vi.restoreAllMocks();
  recordMatchEnd.mockClear();
  quitGame.mockClear();
  useGameStore.setState({ recordMatchEnd, quitGame });
});

describe('<HandResult> — fin de match (#290)', () => {
  it('sans compte : enregistre le match une fois et propose de créer un compte', async () => {
    const user = userEvent.setup();
    show({ matchWinner: 0 });
    expect(recordMatchEnd).toHaveBeenCalledTimes(1);
    expect(recordMatchEnd).toHaveBeenCalledWith(null, null);
    expect(screen.getByText('Gardez cette victoire !')).toBeInTheDocument();
    expect(screen.getByText(/Moi gagne/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    // Arrivé sur l'inscription, et pas renvoyé vers /jouer par la route /jeu.
    expect(await screen.findByTestId('where')).toHaveTextContent('/connexion?onglet=inscription');
    expect(quitGame).toHaveBeenCalledTimes(1);
  });

  it('défaite sans compte : propose quand même de garder le score', () => {
    show({ matchWinner: 1 });
    expect(screen.getByText('Gardez votre score !')).toBeInTheDocument();
  });

  it('pendant le match : rien à enregistrer ni à proposer', () => {
    show({ matchWinner: null });
    expect(recordMatchEnd).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Créer mon compte' })).not.toBeInTheDocument();
  });

  it('connecté : enregistre sur le compte et propose d’inviter un ami', async () => {
    vi.spyOn(usersApi, 'invitation').mockResolvedValue({ ok: true, status: 200, data: { url: 'https://la-chouine.com/i/abc234', invitedCount: 0 } });
    show({ matchWinner: 0, token: 'tok' });
    expect(recordMatchEnd).toHaveBeenCalledWith('tok', 'u1');
    expect(await screen.findByRole('button', { name: 'Inviter un ami' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer mon compte' })).not.toBeInTheDocument();
  });
});
