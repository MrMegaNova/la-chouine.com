import { Link } from 'react-router-dom';
import { PlayingCard } from '@/components/game/PlayingCard';
import { OnlineCta } from '@/components/online/OnlineCta';
import type { Card } from '@/game/types';

const FAN_CARDS: Card[] = [
  { s: 'pique', r: 'A' },
  { s: 'coeur', r: '10' },
  { s: 'trefle', r: 'R' },
  { s: 'carreau', r: 'D' },
  { s: 'coeur', r: 'V' },
];

function HeroFan() {
  return (
    <div className="hero-card-stack hide-mobile" aria-hidden="true">
      {FAN_CARDS.map((card, i) => {
        const ang = (i - (FAN_CARDS.length - 1) / 2) * 15;
        return (
          <PlayingCard
            key={i}
            card={card}
            size={118}
            className="animate-fade"
            style={{
              transform: `translate(-50%, -58%) rotate(${ang}deg)`,
              zIndex: i,
              animationDelay: `${i * 0.08}s`,
              boxShadow: '0 20px 40px -16px rgba(0,0,0,.7)',
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

export default function Home() {
  return (
    <>
      <section>
        <div className="wrap hero" style={{ paddingTop: 46, paddingBottom: 30 }}>
          <div className="hero-grid">
            <div>
              <span className="kicker">◑ Jeu du Val de Loir · depuis le XVIIIᵉ siècle</span>
              <h1 style={{ fontFamily: 'var(--serif)', fontWeight: 900, fontSize: 'clamp(40px,7vw,76px)', lineHeight: .96, margin: '18px 0 14px', letterSpacing: -1 }}>
                Le jeu de cartes de la <em style={{ fontStyle: 'italic', color: 'var(--gold-soft)', fontWeight: 500 }}>Vallée du Loir</em>.
              </h1>
              <p style={{ fontSize: 18, lineHeight: 1.6, maxWidth: 520, color: 'var(--cream-2)' }}>
                La Chouine se joue à deux, avec 32 cartes, des brisques à capturer et des annonces à dénicher. Affrontez l'ordinateur en quelques secondes ou créez un compte pour jouer en ligne et défier vos amis.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 26 }}>
                <Link to="/jouer" className="btn btn--gold">Jouer maintenant</Link>
                <Link to="/regles" className="btn btn--ghost">Apprendre les règles</Link>
              </div>
              <OnlineCta />
            </div>
            <HeroFan />
          </div>
        </div>
      </section>

      <section>
        <div className="wrap" style={{ paddingBottom: 50 }}>
          <h2 className="section-title">Trois façons de jouer</h2>
          <p className="section-sub">Aucune inscription n'est nécessaire pour jouer contre l'ordinateur.</p>
          <div className="cards-3">
            {[
              { icon: '🤖', tag: 'Sans inscription', title: 'Contre l\'ordinateur', desc: 'Trois niveaux de difficulté. Idéal pour apprendre les règles ou s\'entraîner.', link: '/jouer', cta: 'Affronter l\'ordinateur', primary: true },
              { icon: '👥', tag: 'Sur un même écran', title: 'À deux, en local', desc: 'Passez l\'appareil de main en main. Parfait pour une partie en famille.', link: '/jouer', cta: 'Partie locale', primary: false },
              { icon: '🌐', tag: 'Compte requis', title: 'En ligne ou entre amis', desc: 'Lancez une partie classée en ligne ou une partie amicale.', link: '/amis', cta: 'Trouver des amis', primary: false },
            ].map(m => (
              <Link key={m.title} to={m.link} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ position: 'relative', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '26px 22px', background: 'linear-gradient(180deg,rgba(247,240,223,.04),rgba(247,240,223,.015))', cursor: 'pointer', transition: '.22s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'; }}>
                  <span style={{ position: 'absolute', top: 16, right: 16, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--gold)', opacity: .7 }}>{m.tag}</span>
                  <div style={{ width: 50, height: 50, borderRadius: 13, display: 'grid', placeItems: 'center', fontSize: 24, background: 'rgba(201,161,74,.14)', border: '1px solid var(--line)', marginBottom: 16 }}>{m.icon}</div>
                  <h3 style={{ fontFamily: 'var(--serif)', fontSize: 23, fontWeight: 600, marginBottom: 6 }}>{m.title}</h3>
                  <p style={{ color: 'var(--cream-2)', fontSize: 14.5, lineHeight: 1.5, opacity: .85, minHeight: 62 }}>{m.desc}</p>
                  <span className={`btn ${m.primary ? 'btn--gold' : 'btn--ghost'} btn--sm`} style={{ marginTop: 8 }}>{m.cta}</span>
                </div>
              </Link>
            ))}
          </div>

          <h2 className="section-title" style={{ marginTop: 10 }}>Comment ça marche</h2>
          <div className="steps-4" style={{ paddingBottom: 54 }}>
            {[
              ['1','La donne','5 cartes chacun. La retourne fixe l\'atout. Le reste forme le talon.'],
              ['2','Les annonces','Mariage, tierce, quarteron, quinte… rapportent des points bonus.'],
              ['3','Les plis','Talon présent : jeu libre.\nTalon vide : fournir, couper.'],
              ['4','Le décompte','Brisques + annonces + dix de der. Le plus haut total rafle le point.'],
            ].map(([n, h, p]) => (
              <div key={n} style={{ borderTop: '2px solid var(--line)', paddingTop: 16 }}>
                <b style={{ fontFamily: 'var(--serif)', fontSize: 40, color: 'var(--gold-soft)', fontWeight: 900, display: 'block', lineHeight: 1 }}>{n}</b>
                <h4 style={{ margin: '8px 0 6px', fontSize: 16 }}>{h}</h4>
                <p style={{ fontSize: 13.5, color: 'var(--cream-2)', opacity: .8, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
