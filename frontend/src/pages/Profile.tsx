import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { usersApi, type HistoryEntry } from '@/api/client';
import { EyeToggle, PasswordChecklist, passwordValid } from '@/components/auth/password';
import { AvatarContent } from '@/components/Avatar';

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
    <div className="wrap" style={{ paddingTop: 36, paddingBottom: 60 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 26 }}>
        <AvatarEditor />
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

// Redimensionne une image en carré 128×128 (recadrage centré) et l'encode en
// data URL JPEG — petit, sans EXIF (ré-encodage canvas), prêt à stocker (#87).
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const SIZE = 128;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas indisponible.')); return; }
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('Image illisible.')); };
    img.src = URL.createObjectURL(file);
  });
}

// Avatar de l'utilisateur (#87) : aperçu + upload (redimensionné côté client)
// + retrait. La mise à jour du store propage l'avatar au header instantanément.
function AvatarEditor() {
  const { user, token } = useAuthStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) return null;

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de reprendre le même fichier après un retrait
    if (!file || !token) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { setError('Format non supporté (png, jpg, webp).'); return; }
    setError(''); setBusy(true);
    try {
      const avatar = await fileToAvatar(file);
      const { ok, data } = await usersApi.setAvatar(avatar, token);
      if (!ok) { setError(data.error ?? 'Échec de l’envoi.'); return; }
      useAuthStore.setState(s => ({ user: s.user ? { ...s.user, avatar: data.avatar } : s.user }));
    } catch {
      setError('Image illisible.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (!token) return;
    setBusy(true); setError('');
    const { ok } = await usersApi.removeAvatar(token);
    if (ok) useAuthStore.setState(s => ({ user: s.user ? { ...s.user, avatar: null } : s.user }));
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div className="list-row__avatar" style={{ width: 64, height: 64, fontSize: 26, borderRadius: '50%' }}>
        <AvatarContent src={user.avatar} name={user.username} />
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onPick} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? '…' : user.avatar ? 'Changer' : 'Ajouter une photo'}
        </button>
        {user.avatar && (
          <button className="btn btn--ghost btn--sm" disabled={busy} onClick={onRemove} aria-label="Retirer la photo de profil">✕</button>
        )}
      </div>
      {error && <span className="form-error" style={{ fontSize: 11.5, margin: 0 }}>{error}</span>}
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
