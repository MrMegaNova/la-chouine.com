import { Link } from 'react-router-dom';

// Footer global (#88) — présent sur toutes les pages hors table de jeu.
// Rappelle que le projet est en développement et où signaler un bug.
export const GITHUB_URL = 'https://github.com/MrMegaNova/la-chouine.com';
export const CONTACT_EMAIL = 'contact@la-chouine.com';

export function Footer() {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--line)', padding: '26px 0', marginTop: 30,
        color: 'var(--cream-2)',
      }}
    >
      <div
        className="wrap"
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 16, flexWrap: 'wrap', fontSize: 13.5, opacity: 0.85,
        }}
      >
        <span>◑ La Chouine — jeu historique de la Vallée du Loir · <b>la-chouine.com</b></span>
        <span style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link to="/a-propos" style={{ color: 'var(--gold-soft)' }}>À propos</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--gold-soft)' }}>GitHub</a>
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--gold-soft)' }}>{CONTACT_EMAIL}</a>
          <span className="note" style={{ opacity: 0.8 }}>Projet en cours de développement</span>
        </span>
      </div>
    </footer>
  );
}
