import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useAuthStore } from '@/store/authStore';
import { getLegalMoves, getAvailableCombos, sortHand, isBrisque, comboCards } from '@/game/engine';
import { SUIT_SYMBOL } from '@/game/constants';
import { PlayingCard } from './PlayingCard';
import { HandResult } from './HandResult';
import type { Card, Combo, GameState, HandResult as HandResultType } from '@/game/types';
import styles from './GameTable.module.scss';

// Pilote la table : le store local (jeu IA/local) ou un contrôleur « online »
// (jeu PvP via WebSocket). GameTable n'a pas à savoir lequel.
export interface GameController {
  game: GameState | null;
  pendingResult: HandResultType | null;
  toast: string | null;
  playCard: (seat: number, card: Card) => void;
  declareCombo: (seat: number, sig: string, card?: Card) => void;
  exchangeSeven: (seat: number) => void;
  revealForPlayer: (seat: number) => void;
  quitGame: () => void;
  clearPendingResult: () => void;
  // Callbacks de fin de coup/match en mode online (sinon comportement local).
  online?: {
    nextHand: () => void;
    rematch: () => void;
    home: () => void;
  };
}

function initials(name: string): string {
  return name.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase();
}

export function GameTable({ controller }: { controller?: GameController } = {}) {
  const localStore = useGameStore();
  const ctrl: GameController = controller ?? localStore;
  const { game, pendingResult, toast, playCard, declareCombo, exchangeSeven,
    revealForPlayer, quitGame, clearPendingResult } = ctrl;
  const { user, token } = useAuthStore();
  const toastRef = useRef<HTMLDivElement>(null);
  // Consultation des plis (#74) : 'mine' = ses propres plis, 'last' = le
  // dernier pli ramassé (seul pli adverse que la règle autorise à revoir).
  const [tricksView, setTricksView] = useState<'mine' | 'last' | null>(null);
  // Annonce en attente (#77) : sélectionnée, elle se valide en jouant une
  // carte qui la compose (la règle : annoncer = jouer en même temps).
  const [pendingAnnounce, setPendingAnnounce] = useState<Combo | null>(null);
  // Étalage de la dernière annonce (les cartes montrées à l'adversaire).
  const [reveal, setReveal] = useState<GameState['lastAnnounce']>(null);
  const revealKey = useRef<string | null>(null);

  useEffect(() => {
    if (!toast || !toastRef.current) return;
    toastRef.current.classList.add(styles.toastVisible);
    const t = setTimeout(() => toastRef.current?.classList.remove(styles.toastVisible), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // Étalage de l'annonce (#77) : à chaque nouvelle annonce (la sienne comme
  // celle de l'adversaire), montre ses cartes quelques secondes. Dédupliqué
  // par main+siège+annonce (l'état online est repoussé à chaque action).
  const announce = game?.lastAnnounce ?? null;
  const announceKey = announce && game ? `${game.handNo}|${announce.seat}|${announce.sig}` : null;
  useEffect(() => {
    if (!announce || !announceKey || revealKey.current === announceKey) return;
    revealKey.current = announceKey;
    setReveal(announce);
    const t = setTimeout(() => setReveal(null), 4500);
    return () => clearTimeout(t);
  }, [announceKey]);

  // L'annonce en attente tombe si ce n'est plus notre entame.
  const turnNow = game?.turn;
  const trickLen = game?.trick.length;
  useEffect(() => { setPendingAnnounce(null); }, [turnNow, trickLen]);

  if (!game) return null;

  const me = game.viewPlayer;
  const n = game.playerCount;
  // `trick.length < playerCount` : tant qu'un pli complet n'est pas résolu (le
  // tour reste sur le dernier joueur le temps de l'animation), on ne considère
  // pas que c'est « à nous » de jouer — sinon les cartes restantes restent
  // cliquables et s'empilent dans le pli.
  const trickPending = game.trick.length >= n;
  const myTurn = game.turn === me && !((game.mode === 'ai' || game.mode === 'friend') && me > 0) && !game.handOver && !game.gatePending && !trickPending;
  const legalMoves = myTurn ? getLegalMoves(game, me) : [];
  // Annonces (#90) : possibles à l'entame comme en réponse (« lorsque son
  // adversaire a abattu sa carte, il doit montrer son annonce »). En réponse
  // de phase finale, une annonce n'est proposée que si l'une de ses cartes
  // est un coup légal (annoncer = jouer une carte de l'annonce, #77). La
  // chouine, qui gagne le coup sans jouer, reste réservée à l'entame.
  const combos = myTurn
    ? getAvailableCombos(game, me).filter(c => c.type === 'chouine'
        ? game.trick.length === 0
        : comboCards(game.players[me].hand, c).some(cc => legalMoves.includes(cc)))
    : [];

  // Cartes jouables : pendant une annonce en attente, seules les cartes qui
  // composent l'annonce ET restent légales sont jouables (#77/#90) ; sinon,
  // les coups légaux.
  const announceCards = pendingAnnounce
    ? comboCards(game.players[me].hand, pendingAnnounce).filter(c => legalMoves.includes(c))
    : null;
  const playableCards = announceCards ?? legalMoves;

  const onPlay = (card: Card) => {
    if (!myTurn || !playableCards.includes(card)) return;
    if (pendingAnnounce) {
      declareCombo(me, pendingAnnounce.sig, card); // annonce + carte, d'un même geste
      setPendingAnnounce(null);
      return;
    }
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
                    <PlayingCard key={i} back />
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
              // Glisse directionnelle (#97) : ma carte monte depuis ma main,
              // celle d'un adversaire descend depuis son côté de la table.
              <div key={i} className={`${styles.trickSlot} ${t.p === me ? styles.fromMe : styles.fromOpp}`}>
                <span className={styles.trickLabel}>{game.names[t.p]}</span>
                <PlayingCard card={t.card} trump={game.trump !== null && t.card.s === game.trump} />
              </div>
            ))}
          </div>

          {/* Capture info — les brisques adverses ne sont pas affichées : la
              règle ne donne droit qu'au dernier pli adverse (#74), à chacun
              de retenir les cartes tombées. */}
          <div className={styles.captureInfo}>
            {game.names.map((name, p) => {
              const pl = game.players[p];
              const plis = Math.floor(pl.won.length / n);
              const briq = pl.won.filter(isBrisque).length;
              return (
                <span key={p} className={`${styles.captLine} ${p === me ? styles.captMe : ''}`}>
                  {name} — plis {plis}{p === me ? ` · brisque${briq > 1 ? 's' : ''} ${briq}` : ''}{pl.annonce ? ` · ann ${pl.annonce}` : ''}
                </span>
              );
            })}
            <span>
              <button className="btn btn--ghost btn--sm" disabled={game.players[me].won.length === 0}
                onClick={() => setTricksView('mine')}>Mes plis</button>
              {' '}
              <button className="btn btn--ghost btn--sm" disabled={!game.lastTrick}
                onClick={() => setTricksView('last')}>Dernier pli</button>
            </span>
          </div>
        </div>

        {/* Action bar */}
        <div className={styles.actBar}>
          {game.handOver ? (
            <span className="note">Coup terminé.</span>
          ) : game.gatePending ? null : myTurn ? (
            pendingAnnounce ? (
              <>
                <span className="note" style={{ alignSelf: 'center' }}>
                  {pendingAnnounce.label} — jouez maintenant une des cartes surlignées pour valider l'annonce.
                </span>
                <button className="btn btn--ghost btn--sm" onClick={() => setPendingAnnounce(null)}>
                  Annuler l'annonce
                </button>
              </>
            ) : (
            <>
              {combos.map(c => (
                <button
                  key={c.sig}
                  className={`btn ${c.type === 'chouine' ? 'btn--wine' : 'btn--gold'} btn--sm`}
                  onClick={() => c.type === 'chouine' ? declareCombo(me, c.sig) : setPendingAnnounce(c)}
                >
                  {c.type === 'chouine' ? '⚑ ' : c.setsTrump ? '♦ ' : `+${c.value} `}
                  {c.label}
                  {c.setsTrump ? ' (fixe atout)' : ''}
                </button>
              ))}
              {game.trick.length === 0 && game.turnUp && game.phase === 'draw' && game.trump &&
                game.players[me].hand.some(c => c.s === game.trump && c.r === '7') && (
                  <button className="btn btn--ghost btn--sm" onClick={() => exchangeSeven(me)}>
                    Échanger le 7 d'atout
                  </button>
                )}
              <span className="note" style={{ alignSelf: 'center' }}>
                {game.trick.length === 0
                  ? (combos.length > 0
                      ? 'Pour annoncer : cliquez sur l\'annonce, puis jouez une de ses cartes — ou entamez directement.'
                      : 'À vous d\'entamer.')
                  : combos.length > 0
                    ? 'Pour annoncer : cliquez sur l\'annonce, puis jouez une de ses cartes — ou répondez directement.'
                    : `À vous de répondre${game.phase === 'final' ? ' (fournir / monter / couper)' : ''}.`}
              </span>
            </>
            )
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
              const playable = myTurn && playableCards.includes(card);
              return (
                <PlayingCard
                  key={i}
                  card={card}
                  trump={game.trump !== null && card.s === game.trump}
                  playable={playable}
                  dim={myTurn && !playable}
                  onClick={() => onPlay(card)}
                  style={{ ['--deal-delay' as string]: `${i * 50}ms` }}
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

      {/* Étalage de la dernière annonce (#77) : les cartes sont montrées,
          comme la règle l'exige (« étalées sur le tapis »). */}
      {reveal && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 55,
          padding: '12px 18px', borderRadius: 14, border: '1px solid var(--gold)',
          background: '#102a20', textAlign: 'center', maxWidth: '92vw',
        }}>
          <div className="note" style={{ marginBottom: 8 }}>
            {game.names[reveal.seat]} annonce <b>{reveal.label}</b>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            {reveal.cards.map((c, i) => (
              <PlayingCard key={i} card={c} size={52} trump={game.trump !== null && c.s === game.trump} />
            ))}
          </div>
        </div>
      )}

      {/* Consultation des plis (#74) */}
      {tricksView && (
        <TricksPanel game={game} me={me} view={tricksView} onClose={() => setTricksView(null)} />
      )}

      {/* End of hand result */}
      {pendingResult && (
        <HandResult
          result={pendingResult}
          game={game}
          onNext={clearPendingResult}
          token={token}
          userId={user?.id ?? null}
          online={ctrl.online}
        />
      )}
    </div>
  );
}

// Panneau de consultation (#74) : ses propres plis à volonté, ou le dernier
// pli ramassé (cartes + vainqueur) — conformément à la règle de Lavardin.
function TricksPanel({ game, me, view, onClose }: {
  game: GameState; me: number; view: 'mine' | 'last'; onClose: () => void;
}) {
  const mine = view === 'mine';
  const myCards = mine ? sortHand(game.players[me].won) : [];
  const briq = mine ? game.players[me].won.filter(isBrisque).length : 0;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(8,23,16,.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 520, maxHeight: '80vh', overflowY: 'auto', padding: 22,
          border: '1px solid var(--gold)', borderRadius: 18, background: '#102a20', textAlign: 'center',
        }}
      >
        <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, margin: '0 0 4px' }}>
          {mine ? 'Mes plis' : 'Dernier pli'}
        </h3>
        <p className="note" style={{ marginBottom: 14 }}>
          {mine
            ? `${Math.floor(myCards.length / game.playerCount)} pli${myCards.length >= game.playerCount * 2 ? 's' : ''} · ${briq} brisque${briq > 1 ? 's' : ''}`
            : game.lastTrick ? `Ramassé par ${game.names[game.lastTrick.winner]}` : ''}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {mine
            ? myCards.map((c, i) => (
                <PlayingCard key={i} card={c} size={64} trump={game.trump !== null && c.s === game.trump} />
              ))
            : (game.lastTrick?.cards ?? []).map((t, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div className="note" style={{ fontSize: 11.5, marginBottom: 3 }}>{game.names[t.p]}</div>
                  <PlayingCard card={t.card} size={64} trump={game.trump !== null && t.card.s === game.trump} />
                </div>
              ))}
        </div>
        <button className="btn btn--ghost btn--full" style={{ marginTop: 18 }} onClick={onClose}>Fermer</button>
      </div>
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
