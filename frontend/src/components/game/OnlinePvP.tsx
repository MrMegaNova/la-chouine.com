import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useOnlineStore } from '@/store/onlineStore';
import { GameTable, type GameController } from './GameTable';

// Pilote l'expérience PvP en ligne, rendue en overlay plein écran :
//   - recherche d'adversaire (file d'attente) → écran d'attente,
//   - match trouvé → bref écran de transition,
//   - partie en cours → GameTable alimentée par le serveur (via contrôleur),
//     avec bannières de déconnexion (la nôtre ou celle de l'adversaire) et
//     écran de fin si le match se conclut par forfait (#30).
export function OnlinePvP() {
  const navigate = useNavigate();
  const { token } = useAuthStore();
  const o = useOnlineStore();

  if (o.status === 'idle') return null;

  if (o.status === 'searching' || o.status === 'found' || o.status === 'error') {
    return (
      <Waiting
        status={o.status}
        opponent={o.opponent}
        error={o.error}
        startedAt={o.searchStartedAt}
        onCancel={() => o.cancelSearch()}
        onHome={() => { o.leave(); navigate('/'); }}
      />
    );
  }

  // status 'playing' | 'over' : la partie (ou son résultat) est affichée par GameTable.
  if (!o.game) return null;

  const goHome = () => { o.leave(); navigate('/'); };

  const controller: GameController = {
    game: o.game,
    pendingResult: o.pendingResult,
    toast: o.toast,
    playCard: o.playCard,
    declareCombo: o.declareCombo,
    exchangeSeven: o.exchangeSeven,
    revealForPlayer: () => {},
    quitGame: () => {
      // Quitter en pleine partie = abandon : l'adversaire gagne par forfait.
      if (o.status === 'playing') {
        if (!window.confirm('Abandonner la partie ? Votre adversaire gagnera par forfait.')) return;
        o.forfeitGame();
      }
      goHome();
    },
    clearPendingResult: () => {},
    online: {
      nextHand: o.nextHand,
      rematch: () => { if (token) o.rematch(token); },
      home: goHome,
    },
  };

  return (
    <>
      <GameTable controller={controller} />
      {o.status === 'playing' && o.reconnecting && (
        <Banner text="Connexion perdue — tentative de reconnexion…" />
      )}
      {o.status === 'playing' && !o.reconnecting && o.opponentDisconnected && (
        <OpponentGoneBanner opponent={o.opponent} deadline={o.opponentDeadline} />
      )}
      {o.status === 'over' && o.forfeit && (
        <ForfeitEnd
          youWin={o.forfeit.youWin}
          reason={o.forfeit.reason}
          opponent={o.opponent}
          onRematch={token ? () => o.rematch(token) : null}
          onHome={goHome}
        />
      )}
    </>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <div style={{
      position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 80,
      padding: '10px 18px', borderRadius: 12, border: '1px solid var(--gold)',
      background: '#102a20', color: 'var(--cream)', fontSize: 14, maxWidth: '92vw',
    }}>
      {text}
    </div>
  );
}

// L'adversaire a perdu la connexion : compte à rebours avant sa défaite par
// forfait (il peut revenir à temps, le serveur nous le signalera).
function OpponentGoneBanner({ opponent, deadline }: { opponent: string | null; deadline: number | null }) {
  const [left, setLeft] = useState(() =>
    deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null);
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(
      () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 500);
    return () => clearInterval(id);
  }, [deadline]);

  const who = opponent ?? 'Votre adversaire';
  return (
    <Banner text={left !== null
      ? `⚠️ ${who} est déconnecté — victoire par forfait dans ${left}s s'il ne revient pas.`
      : `⚠️ ${who} est déconnecté — en attente de son retour…`}
    />
  );
}

// Fin de match par forfait (abandon volontaire ou déconnexion prolongée).
function ForfeitEnd({
  youWin, reason, opponent, onRematch, onHome,
}: {
  youWin: boolean;
  reason: 'abandon' | 'timeout';
  opponent: string | null;
  onRematch: (() => void) | null;
  onHome: () => void;
}) {
  const who = opponent ?? 'Votre adversaire';
  const detail = youWin
    ? (reason === 'timeout'
        ? `${who} ne s'est pas reconnecté à temps.`
        : `${who} a abandonné la partie.`)
    : 'Vous avez abandonné la partie.';
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80,
      background: 'rgba(8, 23, 16, .82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 380, padding: 32, border: '1px solid var(--gold)', borderRadius: 20, background: '#102a20' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>{youWin ? '🏆' : '🏳️'}</div>
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26, margin: '0 0 8px' }}>
          {youWin ? 'Victoire par forfait !' : 'Défaite par forfait'}
        </h2>
        <p className="note" style={{ marginBottom: 20 }}>{detail} Votre classement Elo a été mis à jour.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {onRematch && <button className="btn btn--gold btn--full" onClick={onRematch}>⚔ Rejouer</button>}
          <button className="btn btn--ghost btn--full" onClick={onHome}>Retour à l'accueil</button>
        </div>
      </div>
    </div>
  );
}

function Waiting({
  status, opponent, error, startedAt, onCancel, onHome,
}: {
  status: 'searching' | 'found' | 'error';
  opponent: string | null;
  error: string | null;
  startedAt: number | null;
  onCancel: () => void;
  onHome: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status !== 'searching' || !startedAt) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [status, startedAt]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      background: 'radial-gradient(120% 80% at 50% 22%, #1a4233 0%, #0c2018 60%, #081710 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 380, padding: 32, border: '1px solid var(--gold)', borderRadius: 20, background: '#102a20' }}>
        {status === 'searching' && (
          <>
            <style>{'@keyframes lc-spin{to{transform:rotate(360deg)}}'}</style>
            <div aria-hidden="true" style={{
              width: 44, height: 44, margin: '0 auto 18px', borderRadius: '50%',
              border: '3px solid rgba(201,161,74,.25)', borderTopColor: 'var(--gold)',
              animation: 'lc-spin 0.8s linear infinite',
            }} />
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26, margin: '0 0 8px' }}>Recherche d'un adversaire…</h2>
            <p className="note" style={{ marginBottom: 20 }}>
              On vous met en relation avec un joueur de niveau proche. {elapsed}s
            </p>
            <button className="btn btn--ghost btn--full" onClick={onCancel}>Annuler</button>
          </>
        )}
        {status === 'found' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 10 }}>⚔️</div>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26, margin: '0 0 8px' }}>Adversaire trouvé&nbsp;!</h2>
            <p className="note">{opponent ? `Face à ${opponent}` : 'Préparation de la partie…'}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 24, margin: '0 0 8px' }}>Connexion interrompue</h2>
            <p className="note" style={{ marginBottom: 20 }}>{error ?? 'Une erreur est survenue.'}</p>
            <button className="btn btn--gold btn--full" onClick={onHome}>Retour à l'accueil</button>
          </>
        )}
      </div>
    </div>
  );
}
