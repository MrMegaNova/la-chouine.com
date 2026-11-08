// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

function show(props: { matchWinner: number | null; token?: string | null }) {
  return render(
    <MemoryRouter initialEntries={['/jeu']}>
      <Routes>
        <Route path="/jeu" element={(
          <HandResult result={result(props.matchWinner)} game={game} onNext={vi.fn()}
            token={props.token ?? null} userId={props.token ? 'u1' : null} />
        )} />
        <Route path="/connexion" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const recordMatchEnd = vi.fn().mockResolvedValue(undefined);
const quitGame = vi.fn();

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

    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(quitGame).toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/connexion?onglet=inscription');
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
