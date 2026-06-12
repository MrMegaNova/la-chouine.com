import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { usersApi, type HistoryEntry } from '@/api/client';
import { EyeToggle, PasswordChecklist, passwordValid } from '@/components/auth/password';

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

      <div style={{ display: 'flex', gap: 26, marginBottom: 30, flexWrap: 'wrap' }}>
        {[
          [user.ratings.classic, 'Elo Classique'],
          [user.ratings.mondoubleau, 'Elo Mondoubleau'],
        ].map(([v, l]) => (
          <div key={String(l)}>
            <b style={{ fontFamily: 'var(--serif)', fontSize: 30, color: 'var(--gold-soft)', fontWeight: 900, display: 'block', lineHeight: 1 }}>{v}</b>
            <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, opacity: .7 }}>{l}</span>
          </div>
        ))}
      </div>

      <ChangePasswordSection />

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

// Changement de mot de passe par l'utilisateur connecté (#108).
function ChangePasswordSection() {
  const { token } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(''); setSuccess('');
    if (!current) { setError('Saisissez votre mot de passe actuel.'); return; }
    if (!passwordValid(next)) { setError('Le nouveau mot de passe ne respecte pas toutes les règles.'); return; }
    if (next === current) { setError('Le nouveau mot de passe doit être différent de l\'actuel.'); return; }
    if (!token) return;
    setLoading(true);
    const { ok, data } = await usersApi.changePassword(current, next, token);
    setLoading(false);
    if (!ok) { setError(data.error ?? 'Erreur.'); return; }
    // Le changement révoque tous les anciens tokens (#117) : adopter le token
    // frais réémis par le serveur pour rester connecté.
    if (data.token) useAuthStore.setState({ token: data.token });
    setSuccess('Mot de passe modifié.');
    setCurrent(''); setNext(''); setShowCurrent(false); setShowNext(false);
  };

  return (
    <div className="panel" style={{ marginBottom: 30, maxWidth: 460 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, margin: 0, flex: 1 }}>🔒 Sécurité</h3>
        <button className="btn btn--ghost btn--sm" onClick={() => { setOpen(o => !o); setError(''); setSuccess(''); }}>
          {open ? 'Fermer' : 'Changer mon mot de passe'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <div className="field">
            <label>Mot de passe actuel</label>
            <div style={{ position: 'relative' }}>
              <input type={showCurrent ? 'text' : 'password'} value={current}
                onChange={e => setCurrent(e.target.value)} placeholder="••••••••"
                style={{ paddingRight: 38, width: '100%' }} />
              <EyeToggle shown={showCurrent} onToggle={() => setShowCurrent(s => !s)} />
            </div>
          </div>
          <div className="field">
            <label>Nouveau mot de passe</label>
            <div style={{ position: 'relative' }}>
              <input type={showNext ? 'text' : 'password'} value={next}
                onChange={e => setNext(e.target.value)} placeholder="••••••••"
                style={{ paddingRight: 38, width: '100%' }}
                onKeyDown={e => e.key === 'Enter' && submit()} />
              <EyeToggle shown={showNext} onToggle={() => setShowNext(s => !s)} />
            </div>
            <PasswordChecklist password={next} />
          </div>

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-ok" style={{ marginBottom: 8 }}>{success}</p>}

          <button className="btn btn--gold btn--full" disabled={loading} onClick={submit}>
            {loading ? '…' : 'Valider le changement'}
          </button>
        </div>
      )}
    </div>
  );
}
