import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { authApi } from '@/api/client';
import { EyeToggle, PasswordChecklist, passwordValid } from '@/components/auth/password';

// Page de réinitialisation (#107) — ouverte depuis le lien reçu par email
// (/reset-password?token=…). Sans cette page la route tombait sur le
// catch-all et renvoyait à l'accueil, rendant le lien inutilisable.
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const tokenValid = token.length === 64;

  const handleSubmit = async () => {
    setError('');
    if (!passwordValid(password)) {
      setError('Le mot de passe ne respecte pas toutes les règles.');
      return;
    }
    setLoading(true);
    const { ok, data } = await authApi.resetPassword(token, password);
    setLoading(false);
    if (!ok) {
      setError((data as { error?: string }).error ?? 'Lien invalide ou expiré.');
      return;
    }
    navigate('/connexion', { replace: true, state: { resetDone: true } });
  };

  return (
    <div className="wrap" style={{ maxWidth: 440, padding: '60px 18px' }}>
      <div className="panel">
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 900, marginBottom: 4 }}>
          Nouveau mot de passe
        </h2>
        <p className="note" style={{ marginBottom: 20 }}>
          Choisissez un nouveau mot de passe pour votre compte.
        </p>

        {!tokenValid ? (
          <>
            <p className="form-error">Lien invalide ou incomplet. Demandez-en un nouveau.</p>
            <Link to="/connexion" className="btn btn--ghost btn--full" style={{ marginTop: 12 }}>
              Retour à la connexion
            </Link>
          </>
        ) : (
          <>
            <div className="field">
              <label>Mot de passe</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ paddingRight: 38, width: '100%' }}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
                <EyeToggle shown={showPassword} onToggle={() => setShowPassword(s => !s)} />
              </div>
              <PasswordChecklist password={password} />
            </div>

            {error && <p className="form-error">{error}</p>}

            <button className="btn btn--gold btn--full" disabled={loading} onClick={handleSubmit} style={{ marginTop: 6 }}>
              {loading ? '…' : 'Changer mon mot de passe'}
            </button>
            <p className="note" style={{ marginTop: 12, textAlign: 'center' }}>
              <Link to="/connexion" style={{ color: 'var(--gold-soft)' }}>← Retour à la connexion</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
