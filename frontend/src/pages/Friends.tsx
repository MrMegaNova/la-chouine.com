import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { friendsApi, usersApi, type Friend, type FriendRequest, type SearchUser } from '@/api/client';
import { useNotificationStore } from '@/store/notificationStore';
import { PresenceDot } from '@/components/PresenceDot';
import { ChallengeButtons } from '@/components/game/ChallengeButtons';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AvatarContent } from '@/components/Avatar';

export default function Friends() {
  const { user, token } = useAuthStore();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'friends' | 'requests'>('friends');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [toastMsg, setToastMsg] = useState('');
  // Ami en attente de confirmation de retrait (#68).
  const [toRemove, setToRemove] = useState<Friend | null>(null);

  useEffect(() => { if (!user) { navigate('/connexion'); return; } load(); }, [user]);

  // La présence (#46) évolue sans nous : recharge au retour sur l'onglet.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [token]);

  const load = async () => {
    if (!token) return;
    const [fr, rq] = await Promise.all([friendsApi.list(token), friendsApi.requests(token)]);
    if (fr.ok) setFriends(fr.data);
    if (rq.ok) setRequests(rq.data);
    // Garde le badge du header (#44) aligné sur ce que la page vient de lire.
    useNotificationStore.getState().refresh(token);
  };

  const toast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 2500); };

  const search = async (q: string) => {
    setQuery(q);
    if (q.length < 2 || !token) { setResults([]); return; }
    const { ok, data } = await usersApi.search(q, token);
    if (ok) setResults(data);
  };

  const sendRequest = async (id: string) => {
    if (!token) return;
    const { ok, data } = await friendsApi.sendRequest(id, token);
    toast(ok ? 'Invitation envoyée !' : (data as any).error ?? 'Erreur.');
    search(query);
  };

  const accept = async (id: string) => {
    if (!token) return;
    await friendsApi.accept(id, token);
    toast('Ami ajouté !');
    load();
  };

  const decline = async (id: string) => {
    if (!token) return;
    await friendsApi.decline(id, token);
    load();
  };

  // Retrait d'un ami (#68) — confirmé via la modale. Silencieux pour l'autre.
  const confirmRemove = async () => {
    if (!token || !toRemove) return;
    const friend = toRemove;
    setToRemove(null);
    const { ok } = await friendsApi.remove(friend.id, token);
    toast(ok ? `${friend.username} retiré de vos amis.` : 'Erreur lors du retrait.');
    if (ok) load();
  };

  const initials = (n: string) => n.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase();

  return (
    <div className="wrap" style={{ padding: '36px 0 60px' }}>
      {toastMsg && (
        <div style={{ position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', background: 'rgba(8,18,13,.9)', border: '1px solid var(--gold)', color: 'var(--cream)', padding: '9px 16px', borderRadius: 30, fontWeight: 700, fontSize: 14, zIndex: 100 }}>
          {toastMsg}
        </div>
      )}

      <h2 className="section-title">Amis &amp; joueurs</h2>
      <p className="section-sub">Recherchez des joueurs par pseudo, envoyez des invitations.</p>

      <div className="grid2">
        <div className="panel">
          <div className="field">
            <label>Rechercher un joueur</label>
            <input placeholder="Tapez un pseudo…" value={query} onChange={e => search(e.target.value)} />
          </div>
          {query.length >= 2 && (
            <div className="list">
              {results.length === 0
                ? <div className="list-empty">Aucun joueur trouvé.</div>
                : results.map(u => (
                  <div key={u.id} className="list-row">
                    <div className="list-row__avatar"><AvatarContent src={u.avatar} name={u.username} /></div>
                    <div className="list-row__meta">
                      <b className="list-row__name">{u.username}</b>
                      <span className="list-row__sub">{u.wins} victoires · {u.plays} parties</span>
                    </div>
                    <div className="list-row__actions">
                      {u.friendshipStatus === 'accepted'
                        ? <span className="badge badge--win">Ami</span>
                        : u.friendshipStatus === 'pending'
                        ? <span className="badge">Envoyée</span>
                        : <button className="btn btn--gold btn--sm" onClick={() => sendRequest(u.id)}>+ Ajouter</button>}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="tabs">
            <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>Mes amis</button>
            <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
              Invitations {requests.length > 0 && `(${requests.length})`}
            </button>
          </div>
          <div className="list">
            {tab === 'friends' ? (
              friends.length === 0
                ? <div className="list-empty">Pas encore d'amis.</div>
                : friends.map(f => (
                  <div key={f.id} className="list-row">
                    <div className="list-row__avatar"><AvatarContent src={f.avatar} name={f.username} /></div>
                    <div className="list-row__meta">
                      <b className="list-row__name"><PresenceDot online={f.online} inGame={f.inGame} />{f.username}</b>
                      <span className="list-row__sub">
                        {f.inGame ? 'en partie · ' : f.online ? 'en ligne · ' : ''}{f.wins} victoires
                      </span>
                    </div>
                    <div className="list-row__actions">
                      {/* Défi en ligne réel (#45) — amicale ou classée (#47) */}
                      <ChallengeButtons friend={f} variant="classic" />
                      <button
                        className="btn btn--ghost btn--sm"
                        aria-label={`Retirer ${f.username} de vos amis`}
                        title="Retirer cet ami"
                        onClick={() => setToRemove(f)}
                      >
                        Retirer
                      </button>
                    </div>
                  </div>
                ))
            ) : (
              requests.length === 0
                ? <div className="list-empty">Aucune invitation.</div>
                : requests.map(r => (
                  <div key={r.id} className="list-row">
                    <div className="list-row__avatar">{initials(r.username)}</div>
                    <div className="list-row__meta">
                      <b className="list-row__name">{r.username}</b>
                      <span className="list-row__sub">souhaite vous ajouter</span>
                    </div>
                    <div className="list-row__actions">
                      <button className="btn btn--gold btn--sm" onClick={() => accept(r.id)}>Accepter</button>
                      <button className="btn btn--ghost btn--sm" onClick={() => decline(r.id)}>Refuser</button>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {toRemove && (
        <ConfirmDialog
          title="Retirer cet ami ?"
          message={<>Retirer <b>{toRemove.username}</b> de vos amis ? Vous ne pourrez plus le défier directement.</>}
          confirmLabel="Retirer"
          cancelLabel="Annuler"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setToRemove(null)}
        />
      )}
    </div>
  );
}
