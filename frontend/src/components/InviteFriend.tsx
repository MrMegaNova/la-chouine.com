import { useEffect, useRef, useState } from 'react';
import { usersApi } from '@/api/client';
import { useAuthStore } from '@/store/authStore';

// Lien d'invitation personnel (#295) : à copier, ou à partager si l'appareil le permet.
export function InviteFriend() {
  const token = useAuthStore(s => s.token);
  const [invitation, setInvitation] = useState<{ url: string; invitedCount: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [feedback, setFeedback] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCanShare(typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    usersApi.invitation(token).then(({ ok, data }) => {
      if (!active) return;
      if (ok) setInvitation(data);
      else setFailed(true);
    });
    return () => { active = false; };
  }, [token]);

  const copy = async () => {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.url);
      setFeedback('Lien copié.');
    } catch {
      input.current?.select();
      setFeedback('Copie impossible : copiez le lien sélectionné.');
    }
  };

  const share = async () => {
    if (!invitation) return;
    try {
      await navigator.share({
        title: 'La Chouine',
        text: 'Viens jouer à la Chouine avec moi !',
        url: invitation.url,
      });
    } catch (err) {
      // Partage annulé par la personne : rien à signaler.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setFeedback('Partage impossible : copiez le lien.');
      }
    }
  };

  const count = invitation?.invitedCount ?? 0;

  return (
    <section className="panel" style={{ marginBottom: 16 }} aria-labelledby="invite-friend-title">
      <h3 id="invite-friend-title" style={{ fontFamily: 'var(--serif)', fontSize: 24, marginBottom: 4 }}>
        Inviter un ami
      </h3>
      <p style={{ fontSize: 16, marginBottom: 12 }}>
        Envoyez ce lien à une personne sans compte. Une fois son email vérifié, vous deviendrez
        amis et vous recevrez le badge Ambassadeur.
      </p>

      {failed && <p className="form-error" role="alert" style={{ fontSize: 16 }}>Impossible d'obtenir votre lien pour le moment.</p>}

      {invitation && (
        <>
          <div className="field">
            <label htmlFor="invite-link">Votre lien</label>
            <input
              id="invite-link"
              ref={input}
              readOnly
              value={invitation.url}
              onFocus={e => e.target.select()}
              style={{ fontSize: 16, minHeight: 44 }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn--gold btn--tap" onClick={copy}>Copier le lien</button>
            {canShare && <button className="btn btn--ghost btn--tap" onClick={share}>Partager</button>}
          </div>
        </>
      )}

      <div role="status">
        {feedback && <p className="form-ok" style={{ fontSize: 14, marginTop: 8 }}>{feedback}</p>}
      </div>

      {count > 0 && (
        <p style={{ fontSize: 14, marginTop: 8, opacity: 0.8 }}>
          {count === 1 ? '1 ami invité inscrit' : `${count} amis invités inscrits`}
        </p>
      )}
    </section>
  );
}
