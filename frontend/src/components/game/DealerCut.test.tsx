// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DealerCut } from './DealerCut';
import type { Card, GameState } from '@/game/types';

// Tests de composant (#129/#201) sur la phase de la coupe : le slot du joueur
// est cliquable tant qu'il n'a pas pioché, déclenche `onDraw`, et la carte
// révélée s'affiche une fois tirée.

const c = (s: Card['s'], r: Card['r']): Card => ({ s, r });

function makeGame(picks: (Card | null)[]): GameState {
  const opts = { mode: 'ai' as const, variant: 'classic' as const, playerCount: 2 as const, target: 3 as const, names: ['Moi', 'Bot'] };
  return {
    mode: 'ai', variant: 'classic', playerCount: 2, diff: 'normal', target: 3,
    names: ['Moi', 'Bot'], oppId: null, opts,
    scores: [0, 0], dealer: -1, handNo: 0, lastHandDrawn: false, recorded: false,
    viewPlayer: 0, gatePending: false,
    players: [
      { hand: [], won: [], declared: new Set(), annonce: 0 },
      { hand: [], won: [], declared: new Set(), annonce: 0 },
    ],
    trump: null, turnUp: null, talon: [],
    trick: [], leader: 0, turn: 0, phase: 'cut', handOver: false,
    lastTrickWinner: null, lastTrick: null, lastTrickBySeat: [null, null],
    lastAnnounce: null, sevenAnnounced: false,
    cut: { deck: [], picks },
  };
}

describe('<DealerCut> — tirage du donneur (#201)', () => {
  it('le slot du joueur est cliquable et déclenche onDraw', async () => {
    const user = userEvent.setup();
    const onDraw = vi.fn();
    render(<DealerCut game={makeGame([null, null])} me={0} onDraw={onDraw} />);

    expect(screen.getByText(/la plus petite désigne le donneur/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Tirer ma carte/ });
    await user.click(btn);
    expect(onDraw).toHaveBeenCalledWith(0);
  });

  it('affiche la carte une fois piochée et n’est plus cliquable', () => {
    render(<DealerCut game={makeGame([c('pique', '7'), null])} me={0} onDraw={vi.fn()} />);

    // Plus de bouton de tirage pour soi : la carte est révélée (étiquette 7♠).
    expect(screen.queryByRole('button', { name: /Tirer ma carte/ })).not.toBeInTheDocument();
    expect(screen.getByText('7♠')).toBeInTheDocument();
    expect(screen.getByText(/En attente des autres joueurs/)).toBeInTheDocument();
  });
});
