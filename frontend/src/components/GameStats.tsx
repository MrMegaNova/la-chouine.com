import type { PlayerStats } from '@/api/client';

const block = (v: string | number, l: string, size: number) => (
  <div key={l}>
    <b style={{ fontFamily: 'var(--serif)', fontSize: size, color: 'var(--gold-soft)', fontWeight: 900, display: 'block', lineHeight: 1 }}>{v}</b>
    <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, opacity: .7 }}>{l}</span>
  </div>
);

// Statistiques d'un joueur, sur le profil propre et le profil public (#279) : les
// résultats en ligne, établis par le serveur, et les résultats déclarés par le
// navigateur restent séparés et ne s'additionnent jamais.
export function GameStats({ stats }: { stats: PlayerStats }) {
  const wr = stats.plays ? Math.round(stats.wins / stats.plays * 100) : 0;

  return (
    <div style={{ marginBottom: 26 }}>
      <h3 style={{ fontFamily: 'var(--serif)', fontSize: 20, marginBottom: 2 }}>Parties en ligne</h3>
      <p className="section-sub" style={{ marginTop: 0, marginBottom: 12 }}>Résultats établis par le serveur.</p>
      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
        {block(stats.plays, 'Parties', 30)}
        {block(stats.wins, 'Victoires', 30)}
        {block(stats.losses, 'Défaites', 30)}
        {block(`${wr}%`, 'Réussite', 30)}
      </div>

      {stats.local.plays > 0 && (
        <>
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 20, marginTop: 22, marginBottom: 2 }}>Contre l’ordinateur et en local</h3>
          <p className="section-sub" style={{ marginTop: 0, marginBottom: 12 }}>Résultats déclarés par le navigateur, non vérifiés.</p>
          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            {block(stats.local.plays, 'Parties', 22)}
            {block(stats.local.wins, 'Victoires', 22)}
            {block(stats.local.losses, 'Défaites', 22)}
          </div>
        </>
      )}
    </div>
  );
}
