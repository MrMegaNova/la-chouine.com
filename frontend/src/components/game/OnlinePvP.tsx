import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useOnlineStore } from '@/store/onlineStore';
import { GameTable, type GameController } from './GameTable';

// Pilote l'expérience PvP en ligne, rendue en overlay plein écran :
//   - recherche d'adversaire (file d'attente) → écran d'attente,
//   - match trouvé → bref écran de transition,
//   - partie en cours → GameTable alimentée par le serveur (via contrôleur).
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

  const controller: GameController = {
    game: o.game,
    pendingResult: o.pendingResult,
    toast: o.toast,
    playCard: o.playCard,
    declareCombo: o.declareCombo,
    exchangeSeven: o.exchangeSeven,
    revealForPlayer: () => {},
    quitGame: () => { o.leave(); navigate('/'); },
    clearPendingResult: () => {},
    online: {
      nextHand: o.nextHand,
      rematch: () => { if (token) o.rematch(token); },
      home: () => { o.leave(); navigate('/'); },
    },
  };

  return <GameTable controller={controller} />;
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
