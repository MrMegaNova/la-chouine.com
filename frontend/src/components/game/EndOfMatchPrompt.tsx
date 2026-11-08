import { useEffect, useState } from 'react';
import { usersApi } from '@/api/client';

// Fin de match contre l'ordinateur ou entre amis sur le même appareil (#290).
// Sans compte : inscription pour garder la partie. Avec un compte : inviter un ami.

const BOX: React.CSSProperties = {
  border: '1px solid var(--gold)', borderRadius: 14, padding: '14px 16px', marginBottom: 16,
  background: 'rgba(201,161,74,.08)', textAlign: 'center',
};

interface Props {
  token: string | null;
  won: boolean;
  /** Quitte la partie puis va vers l'inscription ou la connexion. */
  onAccount: (tab: 'inscription' | 'connexion') => void;
}

export function EndOfMatchPrompt({ token, won, onAccount }: Props) {
  if (!token) return <SignupPrompt won={won} onAccount={onAccount} />;
  return <InvitePrompt token={token} />;
}

function SignupPrompt({ won, onAccount }: Pick<Props, 'won' | 'onAccount'>) {
  return (
    <section style={BOX} aria-labelledby="keep-score-title">
      <h3 id="keep-score-title" style={{ fontFamily: 'var(--serif)', fontSize: 20, marginBottom: 6 }}>
        {won ? 'Gardez cette victoire !' : 'Gardez votre score !'}
      </h3>
      <p style={{ fontSize: 15, marginBottom: 12 }}>
        Créez un compte gratuit : cette partie sera ajoutée à votre historique, avec vos
        statistiques et vos badges. Vous pourrez aussi jouer en ligne avec vos amis.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button className="btn btn--gold btn--tap" onClick={() => onAccount('inscription')}>Créer mon compte</button>
        <button className="btn btn--ghost btn--tap" onClick={() => onAccount('connexion')}>J'ai déjà un compte</button>
      </div>
    </section>
  );
}

function InvitePrompt({ token }: { token: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  // Lien chargé d'avance : sur iPhone, le partage doit suivre le clic sans attente.
  useEffect(() => {
    let active = true;
    usersApi.invitation(token).then(({ ok, data }) => { if (active && ok) setUrl(data.url); });
    return () => { active = false; };
  }, [token]);

  if (!url) return null;

  const invite = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'La Chouine', text: 'Viens jouer à la Chouine avec moi !', url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setFeedback('Lien copié : envoyez-le à un ami.');
    } catch {
      setFeedback(`Votre lien : ${url}`);
    }
  };

  return (
    <section style={BOX} aria-labelledby="invite-end-title">
      <h3 id="invite-end-title" style={{ fontFamily: 'var(--serif)', fontSize: 20, marginBottom: 6 }}>
        Défiez un ami
      </h3>
      <p style={{ fontSize: 15, marginBottom: 12 }}>
        Envoyez-lui votre lien d'invitation : vous deviendrez amis dès son inscription, et
        vous pourrez jouer en ligne ensemble.
      </p>
      <button className="btn btn--gold btn--tap" onClick={invite}>Inviter un ami</button>
      <div role="status">
        {feedback && <p className="form-ok" style={{ fontSize: 14, marginTop: 8, wordBreak: 'break-all' }}>{feedback}</p>}
      </div>
    </section>
  );
}
