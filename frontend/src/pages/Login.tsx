import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/api/client';

type Tab = 'login' | 'register' | 'forgot';

const pwdRules = [
  { label: '8 caractères minimum', test: (p: string) => p.length >= 8 },
  { label: 'Une majuscule', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Une minuscule', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Un chiffre', test: (p: string) => /[0-9]/.test(p) },
  { label: 'Un caractère spécial', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

// Bouton œil (#78) : bascule l'affichage du mot de passe en clair.
function EyeToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      aria-pressed={shown}
      title={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      onClick={onToggle}
      style={{
        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
        color: 'var(--gold-soft)', fontSize: 16, lineHeight: 1,
      }}
    >
      {shown ? '🙈' : '👁'}
    </button>
  );
}

export default function Login() {
  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  // Au changement d'onglet : on remasque toujours le mot de passe (#78).
  const reset = () => { setError(''); setSuccess(''); setShowPassword(false); };

  const handleLogin = async () => {
    reset();
    setLoading(true);
    const err = await login(username.trim(), password);
    setLoading(false);
    if (err) {
      if (err.includes('EMAIL_NOT_VERIFIED') || err.includes('non activé')) {
        setError('Compte non activé — vérifiez vos emails.');
      } else {
        setError(err);
      }
    } else {
      navigate('/profil');
    }
  };

  const handleRegister = async () => {
    reset();
    setLoading(true);
    const { login: _l, ...store } = useAuthStore.getState();
    const err = await store.register(username.trim(), email.trim(), password);
    setLoading(false);
    if (err) { setError(err); return; }
    setSuccess('Compte créé ! Vérifiez vos emails pour activer votre compte.');
    setTab('login');
  };

  const handleForgot = async () => {
    reset();
    setLoading(true);
    const { data } = await authApi.forgotPassword(email.trim());
    setLoading(false);
    setSuccess(data.message ?? 'Email envoyé si le compte existe.');
  };

  return (
    <div className="wrap" style={{ maxWidth: 440, padding: '60px 18px' }}>
      <div className="panel">
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 900, marginBottom: 4 }}>
          {tab === 'login' ? 'Content de vous revoir' : tab === 'register' ? 'Rejoindre la table' : 'Mot de passe oublié'}
        </h2>
        <p className="note" style={{ marginBottom: 20 }}>
          {tab === 'login' ? 'Connectez-vous pour retrouver vos amis.' : tab === 'register' ? 'Créez un compte gratuit pour jouer en ligne.' : 'Recevez un lien par email.'}
        </p>

        {tab !== 'forgot' && (
          <div className="tabs">
            <button className={tab === 'login' ? 'active' : ''} onClick={() => { setTab('login'); reset(); }}>Connexion</button>
            <button className={tab === 'register' ? 'active' : ''} onClick={() => { setTab('register'); reset(); }}>Inscription</button>
          </div>
        )}

        {tab !== 'forgot' && (
          <div className="field">
            <label>Pseudo</label>
            <input value={username} onChange={e => setUsername(e.target.value)} maxLength={30} placeholder="Votre pseudo"
              onKeyDown={e => e.key === 'Enter' && (tab === 'login' ? handleLogin() : handleRegister())} />
          </div>
        )}

        {tab !== 'login' && (
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="votre@email.com" />
          </div>
        )}

        {tab !== 'forgot' && (
          <div className="field">
            <label>Mot de passe</label>
            <div style={{ position: 'relative' }}>
              <input type={showPassword ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                style={{ paddingRight: 38, width: '100%' }}
                onKeyDown={e => e.key === 'Enter' && (tab === 'login' ? handleLogin() : handleRegister())} />
              <EyeToggle shown={showPassword} onToggle={() => setShowPassword(s => !s)} />
            </div>
            {tab === 'register' && password.length > 0 && (
              <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                {pwdRules.map(r => (
                  <li key={r.label} style={{ fontSize: 12, color: r.test(password) ? 'var(--green, #4caf50)' : 'var(--muted, #888)' }}>
                    {r.test(password) ? '✓' : '○'} {r.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-ok" style={{ marginBottom: 8 }}>{success}</p>}

        <button
          className="btn btn--gold btn--full"
          disabled={loading}
          onClick={tab === 'login' ? handleLogin : tab === 'register' ? handleRegister : handleForgot}
          style={{ marginTop: 6 }}
        >
          {loading ? '…' : tab === 'login' ? 'Se connecter' : tab === 'register' ? 'Créer mon compte' : 'Envoyer le lien'}
        </button>

        {tab === 'login' && (
          <p className="note" style={{ marginTop: 12, textAlign: 'center' }}>
            <button style={{ background: 'none', border: 'none', color: 'var(--gold-soft)', cursor: 'pointer', textDecoration: 'underline', fontSize: 12.5 }}
              onClick={() => { setTab('forgot'); reset(); }}>
              Mot de passe oublié ?
            </button>
          </p>
        )}
        {tab === 'forgot' && (
          <p className="note" style={{ marginTop: 12, textAlign: 'center' }}>
            <button style={{ background: 'none', border: 'none', color: 'var(--gold-soft)', cursor: 'pointer', textDecoration: 'underline', fontSize: 12.5 }}
              onClick={() => { setTab('login'); reset(); }}>
              ← Retour à la connexion
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
