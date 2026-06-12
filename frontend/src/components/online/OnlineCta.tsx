import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useOnlineStore, type Presence } from '@/store/onlineStore';
import { onlineApi } from '@/api/client';
import type { Variant } from '@/game/types';

// Recherche d'adversaire en ligne (matchmaking) — partagée entre l'accueil
// (#43) et la page Jouer (#91). Bouton « Trouver un adversaire » + choix de
// variante + badge de présence. Non connecté : invitation à se connecter.

// Compteur de joueurs en ligne (#43). Connecté : chiffres poussés par le
// serveur via le socket de présence. Anonyme : repli sur GET /api/online.
export function OnlineBadge() {
  const { token } = useAuthStore();
  const live = useOnlineStore(s => s.presence);
  const [fetched, setFetched] = useState<Presence | null>(null);

  useEffect(() => {
    if (token) return; // les connectés reçoivent la présence en push
    let cancelled = false;
    onlineApi.get().then(({ ok, data }) => {
      if (ok && !cancelled) setFetched(data);
    });
    return () => { cancelled = true; };
  }, [token]);

  const p = token ? live : fetched;
  if (!p || p.online === 0) return null;

  return (
    <span className="note" style={{ fontSize: 12.5 }}>
      🟢 {p.online} joueur{p.online > 1 ? 's' : ''} en ligne
      {p.inGame > 0 && ` · ${p.inGame} en partie`}
    </span>
  );
}

export function OnlineCta({ style }: { style?: React.CSSProperties }) {
  const { user, token } = useAuthStore();
  const findOpponent = useOnlineStore(s => s.findOpponent);
  const [variant, setVariant] = useState<Variant>('classic');

  if (!user || !token) {
    return (
      <p className="note" style={{ marginTop: 14, ...style }}>
        🌐 <Link to="/connexion" style={{ color: 'var(--gold-soft)' }}>Connectez-vous</Link> pour jouer en ligne et grimper au classement Elo. <OnlineBadge />
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 16, ...style }}>
      <button className="btn btn--wine" onClick={() => findOpponent(variant, token)}>
        ⚔ Trouver un adversaire
      </button>
      <select
        value={variant}
        onChange={e => setVariant(e.target.value as Variant)}
        aria-label="Variante"
        style={{ padding: '9px 12px', borderRadius: 10, background: 'rgba(247,240,223,.06)', color: 'var(--cream)', border: '1px solid var(--line)' }}
      >
        <option value="classic">Classique</option>
        <option value="mondoubleau">Mondoubleau</option>
      </select>
      <span className="note" style={{ fontSize: 12.5 }}>partie classée en ligne</span>
      <OnlineBadge />
    </div>
  );
}
