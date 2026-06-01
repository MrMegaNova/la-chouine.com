import { ORDER, PTS } from './constants';
import { getLegalMoves, getAvailableCombos, cardBeats, isBrisque } from './engine';
import type { GameState, Card, Combo } from './types';

export function aiChooseLead(game: GameState, seat: number): Card {
  const hand = game.players[seat].hand;
  const score = (c: Card) =>
    (game.trump && c.s === game.trump ? 100 : 0) +
    (isBrisque(c) ? 40 : 0) +
    PTS[c.r] +
    ORDER[c.r] * 0.1;

  const sorted = [...hand].sort((a, b) => score(a) - score(b));

  if (game.diff === 'easy' && Math.random() < 0.4) {
    return sorted[Math.floor(Math.random() * sorted.length)];
  }
  return sorted[0];
}

export function aiChooseResponse(game: GameState, seat: number): Card {
  const legal = getLegalMoves(game, seat);
  const led = game.trick[0].card;
  const stake = PTS[led.r];
  const score = (c: Card) =>
    (isBrisque(c) ? 40 : 0) +
    (game.trump && c.s === game.trump ? 20 : 0) +
    PTS[c.r] +
    ORDER[c.r] * 0.1;

  const winners = legal
    .filter(c => cardBeats(led, c, game.trump))
    .sort((a, b) => score(a) - score(b));

  let choice: Card;
  if (winners.length > 0) {
    const cheap = winners[0];
    const worth =
      stake >= 10 ||
      game.phase === 'final' ||
      (stake > 0 && score(cheap) <= stake + 6);
    choice = worth ? cheap : legal.sort((a, b) => score(a) - score(b))[0];
  } else {
    choice = legal.sort((a, b) => score(a) - score(b))[0];
  }

  if (game.diff === 'easy' && Math.random() < 0.5)
    return legal[Math.floor(Math.random() * legal.length)];
  if (game.diff === 'normal' && Math.random() < 0.16)
    return legal[Math.floor(Math.random() * legal.length)];

  return choice;
}

export function aiChooseCombos(game: GameState, seat: number): Combo[] {
  const combos = getAvailableCombos(game, seat);

  const chouine = combos.find(c => c.type === 'chouine');
  if (chouine) return [chouine];

  // Mondoubleau: déclare toujours le meilleur combo disponible pour fixer l'atout
  if (game.variant === 'mondoubleau' && game.trump === null) {
    const setter = combos
      .filter(c => c.setsTrump)
      .sort((a, b) => b.value - a.value)[0];
    return setter ? [setter] : [];
  }

  return combos.filter(c => c.type !== 'chouine' && !c.setsTrump);
}
