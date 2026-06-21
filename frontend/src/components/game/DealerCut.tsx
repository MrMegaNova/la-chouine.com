import { useEffect, useState } from 'react';
import { PlayingCard } from './PlayingCard';
import { SUIT_SYMBOL } from '@/game/constants';
import { smallestDrawSeat } from '@/game/engine';
import type { Card, GameState } from '@/game/types';
import styles from './DealerCut.module.scss';

// Phase de la coupe (#201) : tirage interactif du donneur au tout premier coup
// du match. Chaque siège pioche une carte face cachée (le moteur la détermine,
// jamais le client) ; la plus petite désigne le donneur, qui distribuera la 1ʳᵉ
// main. Le slot du joueur est cliquable tant qu'il n'a pas pioché.
//
// En PvP en ligne, `deadline` (ms epoch) déclenche un compte à rebours : qui ne
// pioche pas à temps perd par forfait (#201). En local/IA, `deadline` est null.
export function DealerCut({
  game, me, onDraw, deadline,
}: {
  game: GameState;
  me: number;
  onDraw: (seat: number, index: number) => void;
  deadline?: number | null;
}) {
  const n = game.playerCount;
  const picks = game.cut.picks;
  const myPick = picks[me];
  const allPicked = picks.every(p => p !== null);
  // Phase de révélation (#201) : toutes les cartes sont tirées, on annonce qui
  // commence (plus petite carte → donneur, le joueur à sa gauche ouvre).
  const isReveal = game.phase === 'cutReveal';
  const starter = isReveal
    ? game.names[(smallestDrawSeat(picks as Card[]) + 1) % n]
    : null;
  // Cartes restant à choisir (#216) : `deck.length` en local/IA, `deckCount` en
  // online (le paquet n'est jamais transmis, seul le compte l'est).
  const poolSize = game.cut.deck.length || game.cut.deckCount || 0;
  // On ne peut piocher que si on n'a pas encore choisi et qu'il reste des cartes.
  const canPick = !isReveal && myPick === null && poolSize > 0;

  return (
    <div className={styles.cut} role="dialog" aria-label="Tirage du donneur">
      <div className={styles.panel}>
        <h2 className={styles.title}>Piocher une carte</h2>
        <p className={`note ${styles.sub}`}>
          {isReveal
            ? `${starter} commence`
            : myPick === null
              ? 'Choisissez une carte : la plus petite désigne le donneur.'
              : allPicked
                ? 'Toutes les cartes sont tirées…'
                : 'En attente des autres joueurs…'}
        </p>

        {/* Pas de compte à rebours de forfait pendant la révélation. */}
        {!isReveal && deadline != null && myPick === null && <Countdown deadline={deadline} />}

        {/* Étalage des cartes face cachée à choisir (#216). */}
        {!isReveal && poolSize > 0 && (
          <div className={styles.pool} role="group" aria-label="Cartes à piocher">
            {Array.from({ length: poolSize }, (_, idx) =>
              canPick ? (
                <button
                  key={idx}
                  type="button"
                  className={styles.poolCard}
                  onClick={() => onDraw(me, idx)}
                  aria-label={`Choisir la carte ${idx + 1}`}
                >
                  <PlayingCard back size={44} />
                </button>
              ) : (
                <div key={idx} className={styles.poolCard}>
                  <PlayingCard back size={44} />
                </div>
              ),
            )}
          </div>
        )}

        {/* Cartes tirées par siège. */}
        <div className={styles.seats}>
          {Array.from({ length: n }, (_, j) => {
            // Ordre d'affichage : soi d'abord, puis les autres dans l'ordre des sièges.
            const seat = (me + j) % n;
            const pick = picks[seat];
            const isMe = seat === me;
            return (
              <div key={seat} className={styles.seat}>
                <span className={`${styles.seatName} ${isMe ? styles.seatMe : ''}`}>
                  {game.names[seat]}{isMe ? ' (vous)' : ''}
                </span>
                <div className={styles.slot}>
                  {pick
                    ? <PlayingCard card={pick} trump={false} />
                    : <PlayingCard back />}
                </div>
                {pick && (
                  <span className={styles.pickLabel}>{pick.r}{SUIT_SYMBOL[pick.s]}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Compte à rebours avant forfait (#201) — PvP en ligne uniquement.
function Countdown({ deadline }: { deadline: number }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const id = setInterval(
      () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearInterval(id);
  }, [deadline]);
  return (
    <p className={styles.timer}>
      {left > 0 ? `Tirez avant ${left}s, sinon vous perdez par forfait.` : 'Temps écoulé…'}
    </p>
  );
}
