import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { friendsApi, invitationsApi } from '@/api/client';
import { useAuthStore } from '@/store/authStore';

// Page d'un lien d'invitation (#295) : publique, hors de l'index, sans pré-rendu.
type Resolution =
  | { status: 'loading' }
  | { status: 'valid'; username: string }
  | { status: 'invalid' }
  | { status: 'unavailable' };

const TEXT = { fontSize: 16 };

export default function Invitation() {
  const { code = '' } = useParams();
  const token = useAuthStore(s => s.token);
  const user = useAuthStore(s => s.user);

  const [resolution, setResolution] = useState<Resolution>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setResolution({ status: 'loading' });
    invitationsApi.resolve(code).then(({ ok, status, data }) => {
      if (!active) return;
      if (ok) setResolution({ status: 'valid', username: data.username });
      // 404 = lien inconnu ; le reste (réseau, 429, 5xx) ne dit rien du lien.
      else setResolution({ status: status === 404 ? 'invalid' : 'unavailable' });
    });
    return () => { active = false; };
  }, [code, attempt]);

  const inviter = resolution.status === 'valid' ? resolution.username : null;
  // Le token est relu avant le profil : on attend le pseudo pour reconnaître son propre lien.
  const waiting = resolution.status === 'loading' || (!!token && !user);
  const register = (invitation: string | null) =>
    `/connexion?onglet=inscription${invitation ? `&invitation=${invitation}` : ''}`;

  return (
    <div className="wrap" style={{ maxWidth: 480, padding: '60px 18px' }}>
      <div className="panel">
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 900, marginBottom: 12 }}>
          {!waiting && inviter ? `${inviter} vous invite à jouer à la Chouine` : 'Invitation à la Chouine'}
        </h1>

        <div role="status">
          {waiting && (
            <p style={{ ...TEXT, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="spinner" aria-hidden="true" />
              Chargement de l'invitation…
            </p>
          )}
        </div>

        {!waiting && resolution.status === 'invalid' && (
          <div role="alert">
            <p className="form-error" style={TEXT}>Ce lien d'invitation n'est pas valide.</p>
            <p style={{ ...TEXT, marginBottom: 16 }}>Vous pouvez tout de même rejoindre la table.</p>
          </div>
        )}

        {!waiting && resolution.status === 'unavailable' && (
          <>
            <div role="alert">
              <p className="form-error" style={TEXT}>Impossible de lire cette invitation pour le moment.</p>
            </div>
            <button className="btn btn--ghost btn--full btn--tap" onClick={() => setAttempt(a => a + 1)} style={{ marginBottom: 12 }}>
              Réessayer
            </button>
          </>
        )}

        {!waiting && (
          token && user
            ? <SignedIn code={code} inviter={inviter} isOwnLink={inviter === user.username} />
            : (
              <>
                {inviter && (
                  <p style={{ ...TEXT, marginBottom: 16 }}>
                    Créez un compte gratuit : une fois votre email vérifié, {inviter} et vous deviendrez amis.
                  </p>
                )}
                <Link
                  to={register(resolution.status === 'invalid' ? null : code)}
                  className="btn btn--gold btn--full btn--tap"
                >
                  Créer mon compte
                </Link>
                {inviter && (
                  <Link
                    to={`/connexion?invitation=${code}`}
                    className="btn btn--ghost btn--full btn--tap"
                    style={{ marginTop: 12 }}
                  >
                    J'ai déjà un compte
                  </Link>
                )}
              </>
            )
        )}
      </div>
    </div>
  );
}

function SignedIn({ code, inviter, isOwnLink }: { code: string; inviter: string | null; isOwnLink: boolean }) {
  const token = useAuthStore(s => s.token);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  const send = async () => {
    if (!token) return;
    setError('');
    setSending(true);
    const { ok, status, data } = await friendsApi.sendInvitationRequest(code, token);
    setSending(false);
    const reply = data as { message?: string; error?: string };
    // 409 : déjà amis ou demande déjà envoyée, il n'y a plus rien à faire.
    if (ok || status === 409) setDone(reply.message ?? reply.error ?? 'Demande envoyée.');
    else setError(reply.error ?? 'Erreur.');
  };

  if (isOwnLink) {
    return (
      <>
        <p style={{ ...TEXT, marginBottom: 16 }}>
          C'est votre propre lien : partagez-le avec les personnes que vous souhaitez inviter.
        </p>
        <Link to="/amis" className="btn btn--gold btn--full btn--tap">Voir mes amis</Link>
      </>
    );
  }

  if (!inviter) {
    return <Link to="/amis" className="btn btn--gold btn--full btn--tap">Voir mes amis</Link>;
  }

  return (
    <>
      <div role="status">
        {done && <p className="form-ok" style={{ ...TEXT, marginBottom: 12 }}>{done}</p>}
      </div>
      {error && <p className="form-error" role="alert" style={TEXT}>{error}</p>}
      {done
        ? <Link to="/amis" className="btn btn--gold btn--full btn--tap">Voir mes amis</Link>
        : (
          <button className="btn btn--gold btn--full btn--tap" disabled={sending} onClick={send}>
            {sending ? '…' : `Demander ${inviter} en ami`}
          </button>
        )}
    </>
  );
}
