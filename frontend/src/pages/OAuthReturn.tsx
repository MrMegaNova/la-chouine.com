import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { oauthApi, type OAuthProvider } from '@/api/client';
import { useAuthStore } from '@/store/authStore';

// Retour de Google, Facebook ou Apple (/connexion/retour) :
// - ?code=…        compte trouvé : ouverture de la session ;
// - ?inscription=… nouveau joueur : choix du pseudo ;
// - ?erreur=…      échec expliqué.

const LABEL: Record<OAuthProvider, string> = { google: 'Google', facebook: 'Facebook', apple: 'Apple' };

const ERRORS: Record<string, string> = {
  annule: 'Connexion annulée.',
  etat: 'La connexion a expiré ou a été ouverte dans un autre navigateur. Recommencez depuis cet appareil.',
  fournisseur: 'La connexion n’a pas abouti. Réessayez dans un instant.',
  email: 'Votre compte n’a pas transmis d’adresse email : elle est nécessaire pour créer un compte. Autorisez-la, ou inscrivez-vous avec un pseudo.',
  compte: 'Un compte existe déjà avec cette adresse email. Connectez-vous avec votre pseudo et votre mot de passe (ou « Mot de passe oublié »).',
};

export default function OAuthReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const startSession = useAuthStore(s => s.startSession);
  const code = params.get('code');
  const signup = params.get('inscription');
  const errorCode = params.get('erreur');

  const [error, setError] = useState(errorCode ? (ERRORS[errorCode] ?? ERRORS.fournisseur) : '');
  const [provider, setProvider] = useState<OAuthProvider | null>(null);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Le code ne sert qu'une fois : l'effet ne doit pas l'envoyer deux fois.
    if (started.current) return;
    started.current = true;
    if (code) {
      oauthApi.exchange(code).then(async ({ ok, data }) => {
        if (!ok) { setError(data.error ?? ERRORS.fournisseur); return; }
        await startSession(data);
        navigate('/profil', { replace: true });
      });
    } else if (signup) {
      oauthApi.signup(signup).then(({ ok, data }) => {
        if (!ok) { setError(data.error ?? ERRORS.fournisseur); return; }
        setProvider(data.provider);
        setUsername(data.suggestion);
      });
    } else if (!errorCode) {
      setError(ERRORS.fournisseur);
    }
  }, [code, signup, errorCode, navigate, startSession]);

  const complete = async () => {
    if (!signup || loading) return;
    setError('');
    setLoading(true);
    const { ok, data } = await oauthApi.complete(signup, username.trim());
    setLoading(false);
    if (!ok) { setError(data.error ?? 'Erreur.'); return; }
    await startSession(data);
    navigate('/profil', { replace: true });
  };

  return (
    <div className="page" style={{ maxWidth: 460, margin: '0 auto', padding: '40px 18px' }}>
      <div className="panel">
        {provider ? (
          <>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 900, marginBottom: 4 }}>Choisissez votre pseudo</h2>
            <p className="note" style={{ marginBottom: 20 }}>
              Dernière étape de votre inscription avec {LABEL[provider]}. Votre pseudo est visible des autres joueurs.
            </p>
            <form onSubmit={e => { e.preventDefault(); complete(); }}>
              <div className="field">
                <label htmlFor="oauth-username">Pseudo</label>
                <input id="oauth-username" value={username} maxLength={30} autoFocus autoComplete="username"
                  onChange={e => setUsername(e.target.value)} placeholder="Votre pseudo" />
                <p style={{ fontSize: 14, opacity: 0.75, marginTop: 4 }}>2 à 30 caractères : lettres, chiffres, _ ou -.</p>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button type="submit" className="btn btn--gold btn--full" disabled={loading || username.trim().length < 2}>
                {loading ? '…' : 'Créer mon compte'}
              </button>
            </form>
          </>
        ) : error ? (
          <>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 900, marginBottom: 12 }}>Connexion</h2>
            <p className="form-error" role="alert" style={{ marginBottom: 16 }}>{error}</p>
            <Link to="/connexion" className="btn btn--gold btn--full">Retour à la connexion</Link>
          </>
        ) : (
          <p role="status" style={{ textAlign: 'center' }}>Connexion en cours…</p>
        )}
      </div>
    </div>
  );
}
