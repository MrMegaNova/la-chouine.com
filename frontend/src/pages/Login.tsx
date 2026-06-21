import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/api/client';
import { EyeToggle, PasswordChecklist } from '@/components/auth/password';

type Tab = 'login' | 'register' | 'forgot';

export default function Login() {
  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Champ-piège anti-bot (#86) : invisible pour un humain, donc vide en usage
  // normal — les bots de spam le remplissent et sont écartés côté serveur.
  const [website, setWebsite] = useState('');
  const [error, setError] = useState('');
  // Compte non activé au login (#105) : on propose le renvoi d'un lien.
  const [notActivated, setNotActivated] = useState(false);
  // Message de succès après une réinitialisation (#107).
  const location = useLocation();
  const [success, setSuccess] = useState(
    (location.state as { resetDone?: boolean } | null)?.resetDone
      ? 'Mot de passe modifié. Vous pouvez vous connecter.'
      : ''
  );
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  // Au changement d'onglet : on remasque toujours le mot de passe (#78).
  const reset = () => { setError(''); setNotActivated(false); setSuccess(''); setShowPassword(false); };

  const handleLogin = async () => {
    reset();
    setLoading(true);
    const err = await login(username.trim(), password);
    setLoading(false);
    if (err) {
      if (err.includes('EMAIL_NOT_VERIFIED') || err.includes('non activé')) {
        setError('Compte non activé — vérifiez vos emails.');
        setNotActivated(true); // lien d'activation peut-être expiré → renvoi possible
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
    const err = await store.register(username.trim(), email.trim(), password, website);
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
          {tab === 'login' ? 'Connectez-vous pour retrouver vos amis.' : tab === 'register' ? 'Créez un compte gratuit pour jouer en ligne.' : 'Recevez par email un lien pour réinitialiser votre mot de passe — ou, si votre compte n\'est pas encore activé, un nouveau lien d\'activation.'}
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

        {/* Champ-piège anti-bot (#86) — hors écran, ignoré par les lecteurs
            d'écran et le clavier ; un humain ne le remplit jamais.
            Nom volontairement neutre (`contact_extra`) plutôt que `website` :
            ce dernier est une cible classique de l'autofill navigateur et des
            gestionnaires de mots de passe, qui le remplissaient et déclenchaient
            à tort le piège (#203). `data-lpignore`/`data-1p-ignore` demandent
            explicitement à LastPass / 1Password de l'ignorer. */}
        {tab === 'register' && (
          <input
            type="text"
            name="contact_extra"
            value={website}
            onChange={e => setWebsite(e.target.value)}
            autoComplete="off"
            tabIndex={-1}
            aria-hidden="true"
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
            style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          />
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
            {tab === 'register' && <PasswordChecklist password={password} />}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        {notActivated && tab === 'login' && (
          <p className="note" style={{ marginTop: -4, marginBottom: 8 }}>
            Lien d'activation expiré ?{' '}
            <button style={{ background: 'none', border: 'none', color: 'var(--gold-soft)', cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit' }}
              onClick={() => { setEmail(''); setTab('forgot'); reset(); }}>
              Recevez-en un nouveau
            </button>.
          </p>
        )}
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
