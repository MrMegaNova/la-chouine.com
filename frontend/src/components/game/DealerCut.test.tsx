// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DealerCut } from './DealerCut';
import type { Card, GameState } from '@/game/types';

// Tests de composant (#129/#201/#216) sur la phase de la coupe : les cartes face
// cachée sont étalées et cliquables tant que le joueur n'a pas pioché ; le clic
// déclenche `onDraw(seat, index)` ; la carte révélée s'affiche une fois tirée.

const c = (s: Card['s'], r: Card['r']): Card => ({ s, r });

// Paquet caché par défaut (3 cartes suffisent pour tester l'étalage).
const DECK: Card[] = [c('pique', '8'), c('coeur', '9'), c('trefle', 'V')];

function makeGame(picks: (Card | null)[], deck: Card[] = DECK): GameState {
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
    cut: { deck, picks },
  };
}

describe('<DealerCut> — tirage du donneur (#201/#216)', () => {
  it('les cartes étalées sont cliquables et le clic déclenche onDraw(seat, index)', async () => {
    const user = userEvent.setup();
    const onDraw = vi.fn();
    render(<DealerCut game={makeGame([null, null])} me={0} onDraw={onDraw} />);

    expect(screen.getByText(/Choisissez une carte/)).toBeInTheDocument();
    // Une carte cliquable par position du paquet (3 cartes).
    const cards = screen.getAllByRole('button', { name: /Choisir la carte/ });
    expect(cards).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Choisir la carte 2' }));
    expect(onDraw).toHaveBeenCalledWith(0, 1); // index 0-based
  });

  it('une fois la carte piochée, l’étalage n’est plus cliquable et la carte est révélée', () => {
    render(<DealerCut game={makeGame([c('pique', '7'), null])} me={0} onDraw={vi.fn()} />);

    // Plus de cartes cliquables pour soi ; la carte tirée est révélée (7♠).
    expect(screen.queryByRole('button', { name: /Choisir la carte/ })).not.toBeInTheDocument();
    expect(screen.getByText('7♠')).toBeInTheDocument();
    expect(screen.getByText(/En attente des autres joueurs/)).toBeInTheDocument();
  });

  it('en phase cutReveal : cartes révélées, « qui commence », pas d’étalage ni compte à rebours', () => {
    // Moi (siège 0) tire 7♠, Bot (siège 1) tire un Roi : la plus petite (7♠) est
    // le donneur → le joueur à sa gauche (Bot) commence.
    const game = { ...makeGame([c('pique', '7'), c('coeur', 'R')]), phase: 'cutReveal' as const };
    render(<DealerCut game={game} me={0} onDraw={vi.fn()} deadline={Date.now() + 2000} />);

    expect(screen.getByText('Bot commence')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choisir la carte/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/perdez par forfait/)).not.toBeInTheDocument();
  });
});
