import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useAuthStore } from '@/store/authStore';
import { getLegalMoves, getAvailableCombos } from '@/game/engine';
import { SUIT_SYMBOL } from '@/game/constants';
import { PlayingCard } from './PlayingCard';
import { HandResult } from './HandResult';
import type { Card } from '@/game/types';
import styles from './GameTable.module.scss';

function initials(name: string): string {
  return name.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase();
}

export function GameTable() {
  const { game, pendingResult, toast, playCard, declareCombo, exchangeSeven,
    revealForPlayer, quitGame, clearPendingResult } = useGameStore();
  const { user, token } = useAuthStore();
  const toastRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toast || !toastRef.current) return;
    toastRef.current.classList.add(styles.toastVisible);
    const t = setTimeout(() => toastRef.current?.classList.remove(styles.toastVisible), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  if (!game) return null;

  const me = game.viewPlayer;
  const n = game.playerCount;
  const myTurn = game.turn === me && !((game.mode === 'ai' || game.mode === 'friend') && me > 0) && !game.handOver && !game.gatePending;
  const legalMoves = myTurn ? getLegalMoves(game, me) : [];
  const combos = myTurn && game.trick.length === 0 ? getAvailableCombos(game, me) : [];

  const onPlay = (card: Card) => {
    if (!myTurn || !legalMoves.includes(card)) return;
    playCard(me, card);
  };

  return (
    <div className={styles.table}>
      {/* Header */}
      <div className={styles.topBar}>
        <button className="btn btn--ghost btn--sm" onClick={() => quitGame()}>← Quitter</button>
        <div className={styles.scoreRow}>
          {game.names.map((name, i) => (
            <div key={i} className={`score-pill ${i === me ? styles.scoreMe : ''}`}>
              <span>{name}</span>
              <b>{game.scores[i]}</b>
            </div>
          ))}
        </div>
        <TrumpBadge trump={game.trump} variant={game.variant} target={game.target} />
      </div>

      {/* Felt */}
      <div className={styles.felt}>
        <div ref={toastRef} className={styles.toast}>{toast}</div>

        {/* Opponents */}
        <div className={styles.oppArea}>
          {Array.from({ length: n - 1 }, (_, j) => {
            const opp = (me + j + 1) % n;
            const isActive = game.turn === opp;
            return (
              <div key={opp} className={`${styles.oppSlot} ${isActive ? styles.oppActive : ''}`}>
                <span className={styles.oppName}>
                  {game.names[opp]}{isActive ? ' ▶' : ''}
                </span>
                <div className={styles.oppCards}>
                  {game.players[opp].hand.map((_, i) => (
                    <PlayingCard key={i} back size={46} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mid row */}
        <div className={styles.midRow}>
          {/* Talon */}
          <div className={styles.talonBox}>
            <div className={styles.talonStack}>
              {Array.from({ length: Math.min(3, game.talon.length + (game.turnUp ? 1 : 0)) }, (_, i) => (
                <div key={i} className={styles.talonCard} style={{ top: i * 2, left: i * 1.5 }}>
                  <PlayingCard back />
                </div>
              ))}
              {game.turnUp && (
                <div className={styles.turnup}>
                  <PlayingCard card={game.turnUp} trump />
                </div>
              )}
            </div>
            <span className={styles.talonCount}>
              {game.phase === 'final' ? 'Talon épuisé' : `Talon : ${game.talon.length + (game.turnUp ? 1 : 0)}`}
            </span>
          </div>

          {/* Trick */}
          <div className={styles.trickZone}>
            {game.trick.map((t, i) => (
              <div key={i} className={styles.trickSlot}>
                <span className={styles.trickLabel}>{game.names[t.p]}</span>
                <PlayingCard card={t.card} trump={game.trump !== null && t.card.s === game.trump} />
              </div>
            ))}
          </div>

          {/* Capture info */}
          <div className={styles.captureInfo}>
            {game.names.map((name, p) => {
              const pl = game.players[p];
              const plis = Math.floor(pl.won.length / n);
              const briq = pl.won.filter(c => c.r === 'A' || c.r === '10').length;
              return (
                <span key={p} className={`${styles.captLine} ${p === me ? styles.captMe : ''}`}>
                  {name} — plis {plis} · briq {briq}{pl.annonce ? ` · ann ${pl.annonce}` : ''}
                </span>
              );
            })}
          </div>
        </div>

        {/* Action bar */}
        <div className={styles.actBar}>
          {game.handOver ? (
            <span className="note">Coup terminé.</span>
          ) : game.gatePending ? null : myTurn && game.trick.length === 0 ? (
            <>
              {combos.map(c => (
                <button
                  key={c.sig}
                  className={`btn ${c.type === 'chouine' ? 'btn--wine' : 'btn--gold'} btn--sm`}
                  onClick={() => declareCombo(me, c.sig)}
                >
                  {c.type === 'chouine' ? '⚑ ' : c.setsTrump ? '♦ ' : `+${c.value} `}
                  {c.label}
                  {c.setsTrump ? ' (fixe atout)' : ''}
                </button>
              ))}
              {game.turnUp && game.phase === 'draw' && game.trump &&
                game.players[me].hand.some(c => c.s === game.trump && c.r === '7') && (
                  <button className="btn btn--ghost btn--sm" onClick={() => exchangeSeven(me)}>
                    Échanger le 7 d'atout
                  </button>
                )}
              <span className="note" style={{ alignSelf: 'center' }}>
                {combos.length > 0 ? 'Annoncez puis entamez.' : 'À vous d\'entamer.'}
              </span>
            </>
          ) : myTurn ? (
            <span className="note" style={{ alignSelf: 'center' }}>
              À vous de répondre{game.phase === 'final' ? ' (fournir / monter / couper)' : ''}.
            </span>
          ) : (game.mode === 'ai' || game.mode === 'friend') && game.turn > 0 ? (
            <span className="note" style={{ alignSelf: 'center' }}>
              🤖 {game.names[game.turn]} réfléchit…
            </span>
          ) : (
            <span className="note" style={{ alignSelf: 'center' }}>
              En attente de {game.names[game.turn]}…
            </span>
          )}
        </div>

        {/* My hand */}
        <div className={styles.myHand}>
          {game.gatePending ? (
            game.players[me].hand.map((_, i) => <PlayingCard key={i} back />)
          ) : (
            game.players[me].hand.map((card, i) => {
              const playable = myTurn && legalMoves.includes(card);
              return (
                <PlayingCard
                  key={i}
                  card={card}
                  trump={game.trump !== null && card.s === game.trump}
                  playable={playable}
                  dim={myTurn && !playable}
                  onClick={() => onPlay(card)}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Gate screen */}
      {game.gatePending && (
        <div className={styles.gate}>
          <div className={styles.gateContent}>
            <div className="list-row__avatar" style={{ width: 64, height: 64, fontSize: 26, display: 'grid', placeItems: 'center' }}>
              {initials(game.names[game.turn])}
            </div>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 28, margin: '14px 0 8px' }}>
              Au tour de {game.names[game.turn]}
            </h2>
            <p className="note" style={{ marginBottom: 18 }}>Passez l'appareil, puis révélez le jeu.</p>
            <button className="btn btn--gold btn--full" onClick={() => revealForPlayer(game.turn)}>
              Voir mon jeu
            </button>
          </div>
        </div>
      )}

      {/* End of hand result */}
      {pendingResult && (
        <HandResult
          result={pendingResult}
          game={game}
          onNext={clearPendingResult}
          token={token}
          userId={user?.id ?? null}
        />
      )}
    </div>
  );
}

function TrumpBadge({ trump, variant, target }: { trump: string | null; variant: string; target: number }) {
  if (!trump) {
    if (variant === 'mondoubleau') {
      return <span className="score-pill" style={{ opacity: 0.6, fontSize: 12 }}>Sans atout</span>;
    }
    return null;
  }
  const sym = SUIT_SYMBOL[trump as keyof typeof SUIT_SYMBOL];
  const isRed = trump === 'coeur' || trump === 'carreau';
  return (
    <span className="score-pill">
      Atout <b style={{ color: isRed ? 'var(--wine-2)' : 'var(--cream)' }}>{sym}</b> · {target} pts
    </span>
  );
}
