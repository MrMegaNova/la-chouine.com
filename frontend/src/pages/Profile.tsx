import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { usersApi, type HistoryEntry } from '@/api/client';

export default function Profile() {
  const { user, token, logout, refreshUser } = useAuthStore();
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (!token) { navigate('/connexion'); return; }
    refreshUser();
    if (token) usersApi.history(token).then(({ ok, data }) => { if (ok) setHistory(data); });
  }, [token]);

  const handleLogout = () => { logout(); navigate('/'); };

  if (!user) return null;

  const joined = new Date(user.joined).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const wr = user.stats.plays ? Math.round(user.stats.wins / user.stats.plays * 100) : 0;

  return (
    <div className="wrap" style={{ padding: '36px 0 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 26 }}>
        <div className="list-row__avatar" style={{ width: 64, height: 64, fontSize: 26, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>
          {user.username.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>{user.username}</h2>
          <p className="section-sub" style={{ margin: 0 }}>Membre depuis {joined}</p>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn--ghost btn--sm" onClick={handleLogout}>Se déconnecter</button>
      </div>

      <div style={{ display: 'flex', gap: 26, marginBottom: 26, flexWrap: 'wrap' }}>
        {[
          [user.stats.plays, 'Parties'],
          [user.stats.wins, 'Victoires'],
          [user.stats.losses, 'Défaites'],
          [`${wr}%`, 'Réussite'],
        ].map(([v, l]) => (
          <div key={String(l)}>
            <b style={{ fontFamily: 'var(--serif)', fontSize: 30, color: 'var(--gold-soft)', fontWeight: 900, display: 'block', lineHeight: 1 }}>{v}</b>
            <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, opacity: .7 }}>{l}</span>
          </div>
        ))}
      </div>

      <h3 style={{ fontFamily: 'var(--serif)', fontSize: 24, marginBottom: 14 }}>Historique des parties</h3>
      {history.length === 0 ? (
        <div className="list-empty">Aucune partie jouée. <a href="/jouer" style={{ color: 'var(--gold-soft)' }}>Lancez-en une !</a></div>
      ) : (
        <div className="list">
          {history.map(g => {
            const dt = new Date(g.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const mode = { ai: 'Ordinateur', local: 'Local', friend: 'Ami', online: 'En ligne' }[g.mode] || g.mode;
            const vLabel = g.variant === 'mondoubleau' ? ' · Mondoubleau' : '';
            return (
              <div key={g.id} className="list-row">
                <div className="list-row__avatar">{g.won ? '🏆' : '·'}</div>
                <div className="list-row__meta">
                  <b className="list-row__name">vs {g.opponents ?? '?'}</b>
                  <span className="list-row__sub">{mode} · {g.player_count}J{vLabel} · {dt}</span>
                </div>
                <div className="list-row__actions">
                  <span className={`badge ${g.won ? 'badge--win' : 'badge--loss'}`}>
                    {g.my_score ?? ''} pts
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
