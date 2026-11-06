import { useEffect, useRef } from 'react';
import type { GameState, HandResult } from '@/game/types';
import { playSound, preloadSounds } from './sounds';
import { cuesBetween, type TableSnapshot } from './transitions';

/** Sons de la table de jeu (#155), en local comme en ligne. */
export function useGameSounds(game: GameState | null, pendingResult: HandResult | null) {
  const prev = useRef<TableSnapshot | null>(null);

  useEffect(() => { preloadSounds(); }, []);

  const snapshot: TableSnapshot | null = game && {
    handNo: game.handNo,
    phase: game.phase,
    trickLength: game.trick.length,
    stock: game.talon.length + (game.turnUp ? 1 : 0),
    announceKey: game.lastAnnounce ? `${game.handNo}|${game.lastAnnounce.seat}|${game.lastAnnounce.sig}` : null,
    matchWinner: pendingResult?.matchWinner ?? null,
  };
  const key = snapshot && JSON.stringify(snapshot);

  useEffect(() => {
    if (!snapshot || !game) { prev.current = null; return; }
    const cues = cuesBetween(prev.current, snapshot, game.viewPlayer, game.mode === 'local');
    prev.current = snapshot;
    for (const { sound, delay } of cues) playSound(sound, delay);
    // `key` résume l'état : on ne réagit qu'à un vrai changement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
