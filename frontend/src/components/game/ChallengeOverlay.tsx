import { useEffect, useState } from 'react';
import { useOnlineStore } from '@/store/onlineStore';

// Overlays des défis entre amis (#45/#47), rendus au niveau App :
//   - défi REÇU : modale Accepter / Refuser avec compte à rebours ;
//   - défi ENVOYÉ : attente de la réponse, annulable.
// La bascule vers la partie passe par matchFound/state (OnlinePvP prend le relais).

function useCountdown(expiresAt: number | null): number | null {
  const [left, setLeft] = useState<number | null>(() =>
    expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : null);
  useEffect(() => {
    if (!expiresAt) { setLeft(null); return; }
    const id = setInterval(
      () => setLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))), 500);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

function typeLabel(rated: boolean, variant: string): string {
  return `${rated ? 'partie classée ⚔' : 'partie amicale 🤝'} · ${variant === 'mondoubleau' ? 'Mondoubleau' : 'Classique'}`;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 85,
  background: 'rgba(8, 23, 16, .7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
};
const boxStyle: React.CSSProperties = {
  textAlign: 'center', maxWidth: 380, padding: 28,
  border: '1px solid var(--gold)', borderRadius: 20, background: '#102a20',
};

export function ChallengeOverlay() {
  const o = useOnlineStore();
  const incoming = o.incomingChallenge;
  const outgoing = o.outgoingChallenge;
  const leftIn = useCountdown(incoming?.expiresAt ?? null);
  const leftOut = useCountdown(outgoing?.expiresAt ?? null);

  // Une partie affichée prime sur tout ; rien à montrer sinon.
  if (o.status !== 'idle' || (!incoming && !outgoing)) return null;

  if (incoming) {
    return (
      <div style={overlayStyle}>
        <div style={boxStyle}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>{incoming.rated ? '⚔️' : '🤝'}</div>
          <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26, margin: '0 0 8px' }}>
            {incoming.from} vous défie&nbsp;!
          </h2>
          <p className="note" style={{ marginBottom: 6 }}>{typeLabel(incoming.rated, incoming.variant)}</p>
          {leftIn !== null && <p className="note" style={{ marginBottom: 18 }}>Expire dans {leftIn}s</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn btn--gold btn--full" onClick={() => o.acceptChallenge()}>Accepter</button>
            <button className="btn btn--ghost btn--full" onClick={() => o.declineChallenge()}>Refuser</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={boxStyle}>
        <style>{'@keyframes lc-spin{to{transform:rotate(360deg)}}'}</style>
        <div aria-hidden="true" style={{
          width: 38, height: 38, margin: '0 auto 16px', borderRadius: '50%',
          border: '3px solid rgba(201,161,74,.25)', borderTopColor: 'var(--gold)',
          animation: 'lc-spin 0.8s linear infinite',
        }} />
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: 24, margin: '0 0 8px' }}>
          Défi envoyé à {outgoing!.to}
        </h2>
        <p className="note" style={{ marginBottom: 6 }}>{typeLabel(outgoing!.rated, outgoing!.variant)}</p>
        <p className="note" style={{ marginBottom: 18 }}>
          En attente de sa réponse{leftOut !== null ? ` — ${leftOut}s` : '…'}
        </p>
        <button className="btn btn--ghost btn--full" onClick={() => o.cancelChallenge()}>Annuler</button>
      </div>
    </div>
  );
}
