import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { authApi } from '@/api/client';

// Page de vérification d'email (#239) — ouverte depuis le lien reçu par email
// (/verify-email?token=…). Affiche le résultat sur place au lieu d'un alert()
// suivi d'une redirection immédiate.
type Outcome = 'success' | 'invalid' | 'unavailable';

// Le token est à usage unique : un second appel répondrait « lien invalide ».
// Sous StrictMode l'effet s'exécute deux fois, on partage donc la même requête
// par token. Seul un échec temporaire est oublié, pour autoriser un nouvel essai.
const requests = new Map<string, Promise<Outcome>>();

function verifyOnce(token: string): Promise<Outcome> {
  const known = requests.get(token);
  if (known) return known;

  const request = authApi.verifyEmail(token).then(({ ok, status }): Outcome => {
    if (ok) return 'success';
    // 400 = refus définitif du serveur ; le reste (réseau, délai, 429, 5xx)
    // ne dit rien du lien, qui peut encore être valide.
    if (status === 400) return 'invalid';
    requests.delete(token);
    return 'unavailable';
  });
  requests.set(token, request);
  return request;
}

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const tokenValid = token.length === 64;

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!tokenValid) return;
    let active = true;
    setOutcome(null);
    verifyOnce(token).then(result => {
      if (active) setOutcome(result);
    });
    return () => { active = false; };
  }, [token, tokenValid, attempt]);

  const status = tokenValid ? outcome : 'invalid';

  return (
    <div className="wrap" style={{ maxWidth: 440, padding: '60px 18px' }}>
      <div className="panel">
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 900, marginBottom: 16 }}>
          Vérification de l'adresse email
        </h2>

        {/* Région présente dès le départ : un lecteur d'écran n'annonce le
            changement de contenu que si la région existait déjà. */}
        <div role="status">
          {status === null && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="spinner" aria-hidden="true" />
              Vérification en cours…
            </p>
          )}
          {status === 'success' && <p className="form-ok">Adresse confirmée, connectez-vous.</p>}
        </div>

        {status === 'invalid' && (
          <div role="alert">
            <p className="form-error">Lien invalide ou expiré.</p>
            <p className="note">
              Si ce lien a déjà servi, votre compte est peut-être déjà activé : essayez de vous
              connecter. Sinon, demandez un nouveau lien d'activation via « Mot de passe oublié »
              sur la page de connexion.
            </p>
          </div>
        )}
        {status === 'unavailable' && (
          <>
            <div role="alert">
              <p className="form-error">Impossible de vérifier votre adresse pour le moment.</p>
              <p className="note">Votre compte n'est pas encore activé. Réessayez dans quelques instants.</p>
            </div>
            <button className="btn btn--gold btn--full" onClick={() => setAttempt(a => a + 1)} style={{ marginTop: 12 }}>
              Réessayer
            </button>
          </>
        )}

        {status !== null && (
          <Link
            to="/connexion"
            className={`btn btn--full ${status === 'success' ? 'btn--gold' : 'btn--ghost'}`}
            style={{ marginTop: 12 }}
          >
            Aller à la connexion
          </Link>
        )}
      </div>
    </div>
  );
}
