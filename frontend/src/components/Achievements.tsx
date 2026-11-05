import { ACHIEVEMENTS } from '@/game/achievements';
import type { Achievement } from '@/api/client';

// Affiche le parcours de badges (#217) : ceux débloqués sont mis en avant, les
// autres grisés avec leur condition. Réutilisable sur le profil propre et le
// profil public (#85). L'attribution reste 100 % serveur — ici on n'affiche que.
export function Achievements({ unlocked }: { unlocked: Achievement[] }) {
  const got = new Set(unlocked.map(a => a.code));
  const count = ACHIEVEMENTS.filter(a => got.has(a.code)).length;

  return (
    <section style={{ marginBottom: 30 }}>
      <h3 style={{ fontFamily: 'var(--serif)', fontSize: 24, marginBottom: 4 }}>
        Badges <span style={{ fontSize: 'var(--fs-body)', opacity: 0.85 }}>({count}/{ACHIEVEMENTS.length})</span>
      </h3>
      <p className="section-sub" style={{ marginTop: 0, marginBottom: 14 }}>
        Débloquez des récompenses en jouant et en gagnant.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {ACHIEVEMENTS.map(a => {
          const earned = got.has(a.code);
          return (
            <div
              key={a.code}
              title={a.description}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 12,
                border: `1px solid ${earned ? 'var(--gold)' : 'rgba(255,255,255,.12)'}`,
                background: earned ? 'rgba(201,161,74,.10)' : 'transparent',
                opacity: earned ? 1 : 0.7,
              }}
            >
              <span style={{ fontSize: 26, filter: earned ? 'none' : 'grayscale(1)' }} aria-hidden="true">{a.icon}</span>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block', lineHeight: 1.2 }}>{a.label}</b>
                <span style={{ fontSize: 'var(--fs-small)', opacity: 0.85 }}>{a.description}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
