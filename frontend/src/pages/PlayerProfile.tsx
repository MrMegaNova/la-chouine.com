import { useEffect, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { usersApi, type PublicProfile } from '@/api/client';
import { AvatarContent } from '@/components/Avatar';
import { Achievements } from '@/components/Achievements';

// Page profil PUBLIQUE d'un joueur (#85) : Elo, parties, ratio V/D. Réutilise la
// mise en page de Profile.tsx, sans les éléments privés (historique détaillé,
// sécurité, déconnexion). Son propre profil → redirige vers /profil (vue
// complète et éditable).
export default function PlayerProfile() {
  const { id = '' } = useParams();
  const { user, token } = useAuthStore();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');

  useEffect(() => {
    if (!token || !id) return;
    setState('loading');
    usersApi.publicProfile(id, token).then(({ ok, data }) => {
      if (ok) { setProfile(data); setState('ok'); }
      else setState('notfound');
    });
  }, [id, token]);

  // Garde sur `token` (rehydraté de façon synchrone) : on ne redirige que si
  // l'on est vraiment déconnecté (cf. Friends.tsx / Profile.tsx).
  if (!token) return <Navigate to="/connexion" replace />;
  // Son propre profil → la vue complète et éditable.
  if (user && user.id === id) return <Navigate to="/profil" replace />;

  if (state === 'loading') {
    return <div className="wrap" style={{ paddingTop: 36 }}><p className="section-sub">Chargement…</p></div>;
  }

  if (state === 'notfound' || !profile) {
    return (
      <div className="wrap" style={{ paddingTop: 36, paddingBottom: 60 }}>
        <h2 className="section-title">Joueur introuvable</h2>
        <p className="section-sub">Ce profil n'existe pas ou n'est plus disponible.</p>
        <Link to="/amis" className="btn btn--ghost btn--sm">← Retour aux joueurs</Link>
      </div>
    );
  }

  const wr = profile.stats.plays ? Math.round(profile.stats.wins / profile.stats.plays * 100) : 0;
  const statBlock = (v: string | number, l: string) => (
    <div key={l}>
      <b style={{ fontFamily: 'var(--serif)', fontSize: 30, color: 'var(--gold-soft)', fontWeight: 900, display: 'block', lineHeight: 1 }}>{v}</b>
      <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, opacity: .7 }}>{l}</span>
    </div>
  );

  return (
    <div className="wrap" style={{ paddingTop: 36, paddingBottom: 60 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 26, flexWrap: 'wrap' }}>
        <div className="list-row__avatar" style={{ width: 64, height: 64, fontSize: 26, borderRadius: '50%' }}>
          <AvatarContent src={profile.avatar} name={profile.username} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 className="section-title" style={{ margin: 0 }}>{profile.username}</h2>
          <p className="section-sub" style={{ margin: 0 }}>Profil public</p>
        </div>
        <Link to="/amis" className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }}>← Joueurs</Link>
      </div>

      <div style={{ display: 'flex', gap: 26, marginBottom: 26, flexWrap: 'wrap' }}>
        {statBlock(profile.stats.plays, 'Parties')}
        {statBlock(profile.stats.wins, 'Victoires')}
        {statBlock(profile.stats.losses, 'Défaites')}
        {statBlock(`${wr}%`, 'Réussite')}
      </div>

      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 30 }}>
        {statBlock(profile.ratings.classic, 'Elo Classique')}
        {statBlock(profile.ratings.mondoubleau, 'Elo Mondoubleau')}
      </div>

      <Achievements unlocked={profile.achievements ?? []} />
    </div>
  );
}
