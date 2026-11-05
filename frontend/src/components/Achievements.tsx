import { ACHIEVEMENTS } from '@/game/achievements';
import type { Achievement } from '@/api/client';

// Affiche le parcours de badges (#217) : ceux débloqués sont mis en avant, les
// autres grisés avec leur condition. Réutilisable sur le profil propre et le
// profil public (#85). L'attribution reste 100 % serveur — ici on n'affiche que.
// Un badge non vérifié repose sur des parties locales déclarées (#279) : le serveur
// ne le renvoie qu'à son titulaire, qui le voit distingué des autres.
export function Achievements({ unlocked, publicView = false }: { unlocked: Achievement[]; publicView?: boolean }) {
  const got = new Map(unlocked.map(a => [a.code, a]));
  const count = ACHIEVEMENTS.filter(a => got.has(a.code)).length;

  return (
    <section style={{ marginBottom: 30 }}>
      <h3 style={{ fontFamily: 'var(--serif)', fontSize: 24, marginBottom: 4 }}>
        Badges <span style={{ fontSize: 'var(--fs-body)', opacity: 0.85 }}>({count}/{ACHIEVEMENTS.length})</span>
      </h3>
      <p className="section-sub" style={{ marginTop: 0, marginBottom: 14 }}>
        {publicView
          ? 'Seuls les badges établis par des parties en ligne apparaissent ici.'
          : 'Les badges de victoires se gagnent en ligne. Vos parties locales débloquent des badges d’assiduité non vérifiés, visibles seulement sur votre profil. Ils deviennent vérifiés quand vous remplissez la condition en ligne.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {ACHIEVEMENTS.map(a => {
          const unlockedBadge = got.get(a.code);
          const earned = unlockedBadge !== undefined;
          const unverified = unlockedBadge?.verified === false;
          return (
            <div
              key={a.code}
              title={a.description}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 12,
                border: `1px ${unverified ? 'dashed' : 'solid'} ${earned ? 'var(--gold)' : 'rgba(255,255,255,.12)'}`,
                background: earned && !unverified ? 'rgba(201,161,74,.10)' : 'transparent',
                opacity: earned ? 1 : 0.7,
              }}
            >
              <span style={{ fontSize: 26, filter: earned ? 'none' : 'grayscale(1)' }} aria-hidden="true">{a.icon}</span>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block', lineHeight: 1.2 }}>{a.label}</b>
                <span style={{ fontSize: 'var(--fs-small)', opacity: 0.85 }}>{a.description}</span>
                {unverified && <span style={{ display: 'block', fontSize: 'var(--fs-small)', color: 'var(--gold-soft)' }}>Non vérifié</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
