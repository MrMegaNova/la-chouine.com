// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameTable, type GameController } from './GameTable';
import { useAuthStore } from '@/store/authStore';
import type { Card, GameState } from '@/game/types';

// Tests de composant (#129) sur la table de jeu : annonces à l'entame ET en
// réponse, et consultation des plis (« Mes plis » / « Pli adverse »). La table
// accepte un `controller` injecté → on pilote l'état et on espionne les actions.

const c = (s: Card['s'], r: Card['r']): Card => ({ s, r });

function makeGame(over: Partial<GameState> = {}): GameState {
  const opts = { mode: 'ai' as const, variant: 'classic' as const, playerCount: 2 as const, target: 3 as const, names: ['Moi', 'Bot'] };
  return {
    mode: 'ai', variant: 'classic', playerCount: 2, diff: 'normal', target: 3,
    names: ['Moi', 'Bot'], oppId: null, opts,
    scores: [0, 0], dealer: 1, handNo: 1, lastHandDrawn: false, recorded: false,
    viewPlayer: 0, gatePending: false,
    players: [
      // Main du joueur 0 : un mariage ♥ (R + D) + remplissage neutre.
      { hand: [c('coeur', 'R'), c('coeur', 'D'), c('pique', '8'), c('carreau', '8'), c('trefle', '9')], won: [], declared: new Set(), annonce: 0 },
      { hand: [c('pique', '7'), c('pique', '9'), c('carreau', '7'), c('trefle', '7'), c('trefle', '8')], won: [], declared: new Set(), annonce: 0 },
    ],
    trump: 'pique', turnUp: c('pique', 'R'), talon: [c('trefle', 'V'), c('carreau', '9')],
    trick: [], leader: 0, turn: 0, phase: 'draw', handOver: false,
    lastTrickWinner: null, lastTrick: null, lastTrickBySeat: [null, null],
    lastAnnounce: null, sevenAnnounced: false,
    cut: { deck: [], picks: [null, null] },
    ...over,
  };
}

function makeController(game: GameState): GameController {
  return {
    game, pendingResult: null, toast: null,
    playCard: vi.fn(), declareCombo: vi.fn(), exchangeSeven: vi.fn(),
    drawCutCard: vi.fn(), revealForPlayer: vi.fn(), quitGame: vi.fn(), clearPendingResult: vi.fn(),
  };
}

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null });
});

describe('<GameTable> — annonces', () => {
  it('à l’entame : propose le mariage, et le valide en jouant une de ses cartes (#77)', async () => {
    const user = userEvent.setup();
    const ctrl = makeController(makeGame({ trick: [] }));
    render(<GameTable controller={ctrl} />);

    // Message d'entame + bouton d'annonce disponibles.
    expect(screen.getByText(/entamez directement/)).toBeInTheDocument();
    const announceBtn = screen.getByRole('button', { name: /Mariage ♥/ });
    await user.click(announceBtn);

    // L'annonce est en attente : il faut jouer une carte qui la compose.
    expect(screen.getByText(/jouez maintenant une des cartes surlignées/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jouer R♥' }));

    expect(ctrl.declareCombo).toHaveBeenCalledWith(0, 'mariage|coeur', c('coeur', 'R'));
  });

  it('en réponse : l’annonce reste proposée après l’abattage adverse (#90)', () => {
    const ctrl = makeController(makeGame({ trick: [{ p: 1, card: c('carreau', '7') }] }));
    render(<GameTable controller={ctrl} />);

    expect(screen.getByText(/répondez directement/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mariage ♥/ })).toBeInTheDocument();
  });
});

describe('<GameTable> — profil adverse (#85)', () => {
  it('en PvP, le nom de l’adversaire ouvre son profil dans un nouvel onglet', () => {
    const ctrl = makeController(makeGame({
      mode: 'online', oppId: 'opp-uuid-123', names: ['Moi', 'Bob'],
    }));
    render(<GameTable controller={ctrl} />);

    const link = screen.getByRole('link', { name: 'Bob' });
    expect(link).toHaveAttribute('href', '/joueur/opp-uuid-123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('en IA (pas d’oppId), le nom de l’adversaire n’est pas un lien', () => {
    const ctrl = makeController(makeGame({ mode: 'ai', oppId: null, names: ['Moi', 'Bot'] }));
    render(<GameTable controller={ctrl} />);
    expect(screen.queryByRole('link', { name: 'Bot' })).toBeNull();
  });

  it('en PvP, l’encart (nom + score) de l’adversaire ouvre son profil dans un nouvel onglet', () => {
    const ctrl = makeController(makeGame({ mode: 'online', oppId: 'opp-uuid-123', names: ['Moi', 'Bob'] }));
    render(<GameTable controller={ctrl} />);
    // Encart = nom + score → nom accessible « Bob0 » (distinct du lien de nom seul).
    const pill = screen.getByRole('link', { name: 'Bob0' });
    expect(pill).toHaveAttribute('href', '/joueur/opp-uuid-123');
    expect(pill).toHaveAttribute('target', '_blank');
    expect(pill).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('<GameTable> — la coupe en PvP (#205)', () => {
  it('le joueur local pioche pour son propre siège, même quand ce n’est pas le siège 0', async () => {
    const user = userEvent.setup();
    // Client du 2ᵉ joueur : il occupe le siège 1 (viewPlayer = 1). En online le
    // paquet n'est pas transmis : seul `deckCount` indique combien de cartes
    // étaler (#216).
    const ctrl = makeController(makeGame({
      mode: 'online', viewPlayer: 1, phase: 'cut',
      names: ['Adversaire', 'Moi'],
      cut: { deck: [], picks: [null, null], deckCount: 3 },
    }));
    render(<GameTable controller={ctrl} />);

    // « (vous) » est sur SON siège, pas sur l'adversaire.
    expect(screen.getByText('Moi (vous)')).toBeInTheDocument();

    // Les 3 cartes (deckCount) sont étalées ; le clic pioche pour SON siège (1).
    const cards = screen.getAllByRole('button', { name: /Choisir la carte/ });
    expect(cards).toHaveLength(3);
    await user.click(cards[0]);
    expect(ctrl.drawCutCard).toHaveBeenCalledWith(1, 0);
  });
});

describe('<GameTable> — consultation des plis (#74/#95)', () => {
  it('« Mes plis » est désactivé sans pli, actif sinon et ouvre le panneau', async () => {
    const user = userEvent.setup();
    // Sans pli ramassé.
    const empty = makeController(makeGame({ turn: 1 }));
    const { unmount } = render(<GameTable controller={empty} />);
    expect(screen.getByRole('button', { name: 'Mes plis' })).toBeDisabled();
    unmount();

    // Un pli ramassé (2 cartes pour 2 joueurs).
    const ctrl = makeController(makeGame({
      turn: 1,
      players: [
        { hand: [c('pique', '8')], won: [c('coeur', 'A'), c('coeur', '7')], declared: new Set(), annonce: 0 },
        { hand: [c('trefle', '7')], won: [], declared: new Set(), annonce: 0 },
      ],
    }));
    render(<GameTable controller={ctrl} />);
    const btn = screen.getByRole('button', { name: 'Mes plis' });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(screen.getByRole('heading', { name: 'Mes plis' })).toBeInTheDocument();
  });

  it('« Pli adverse » s’active avec le dernier pli adverse et ouvre le panneau', async () => {
    const user = userEvent.setup();
    const empty = makeController(makeGame({ turn: 1, lastTrickBySeat: [null, null] }));
    const { unmount } = render(<GameTable controller={empty} />);
    expect(screen.getByRole('button', { name: 'Pli adverse' })).toBeDisabled();
    unmount();

    const ctrl = makeController(makeGame({
      turn: 1,
      lastTrickBySeat: [null, { cards: [{ p: 0, card: c('coeur', 'R') }, { p: 1, card: c('pique', 'A') }], seq: 1 }],
    }));
    render(<GameTable controller={ctrl} />);
    const btn = screen.getByRole('button', { name: 'Pli adverse' });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(screen.getByRole('heading', { name: 'Pli adverse' })).toBeInTheDocument();
  });
});
