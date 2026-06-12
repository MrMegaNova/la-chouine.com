import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';
import { AvatarContent } from '@/components/Avatar';
import styles from './Header.module.scss';

const OWL = (
  <svg className={styles.owl} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M32 6c-9 0-15 5-16 13-4 2-6 6-6 11 0 12 9 22 22 22s22-10 22-22c0-5-2-9-6-11C47 11 41 6 32 6Z"
      fill="#123026" stroke="#c9a14a" strokeWidth="2" />
    <circle cx="23" cy="28" r="8" fill="#f4ebd6" stroke="#c9a14a" strokeWidth="2" />
    <circle cx="41" cy="28" r="8" fill="#f4ebd6" stroke="#c9a14a" strokeWidth="2" />
    <circle cx="23" cy="28" r="3.4" fill="#16261d" />
    <circle cx="41" cy="28" r="3.4" fill="#16261d" />
    <path d="M32 33l-4 6h8l-4-6Z" fill="#c9a14a" />
    <path d="M20 44c4 4 8 4 12 4s8 0 12-4" stroke="#c9a14a" strokeWidth="2" fill="none" strokeLinecap="round" />
  </svg>
);

export function Header() {
  const { user } = useAuthStore();
  const pendingRequests = useNotificationStore(s => s.pendingRequests);
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  // Le menu mobile se referme à chaque changement de page.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const reqBadge = pendingRequests > 0 && (
    <span aria-label={`${pendingRequests} invitation${pendingRequests > 1 ? 's' : ''} en attente`} className={styles.badge}>
      {pendingRequests}
    </span>
  );

  // Liens partagés entre la barre (desktop) et le menu déroulant (mobile).
  const links = (
    <>
      <Link to="/" className={`${styles.navLink} ${isActive('/') ? styles.active : ''}`}>Accueil</Link>
      <Link to="/jouer" className={`${styles.navLink} ${isActive('/jouer') ? styles.active : ''}`}>Jouer</Link>
      {user && (
        <Link to="/amis" className={`${styles.navLink} ${isActive('/amis') ? styles.active : ''}`}>
          Amis{reqBadge}
        </Link>
      )}
      {user && <Link to="/profil" className={`${styles.navLink} ${isActive('/profil') ? styles.active : ''}`}>Profil</Link>}
      <Link to="/regles" className={`${styles.navLink} ${isActive('/regles') ? styles.active : ''}`}>Règles</Link>
      <Link to="/a-propos" className={`${styles.navLink} ${isActive('/a-propos') ? styles.active : ''}`}>À propos</Link>
      {/* « Se connecter » vit dans authArea (visible desktop ET mobile) — pas
          de doublon dans les liens de navigation. */}
    </>
  );

  return (
    <header className={styles.bar}>
      <div className="wrap">
        <nav className={styles.inner}>
          <Link to="/" className={styles.brand}>
            {OWL}
            <div>
              <b className={styles.brandName}>La&nbsp;<i>Chouine</i></b>
              <small className={styles.brandSub}>la-chouine.com</small>
            </div>
          </Link>

          {/* Liens en barre — desktop */}
          <div className={styles.nav}>{links}</div>

          <div className={styles.authArea}>
            {user ? (
              <Link to="/profil" className={styles.userChip} style={{ textDecoration: 'none' }}>
                <div className={styles.avatar}><AvatarContent src={user.avatar} name={user.username} /></div>
                <span className={styles.userName}>{user.username}</span>
              </Link>
            ) : (
              <Link to="/connexion" className="btn btn--ghost btn--sm">Se connecter</Link>
            )}
          </div>

          {/* Bouton menu — mobile */}
          <button
            type="button"
            className={styles.menuBtn}
            aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
          >
            {menuOpen ? '✕' : '☰'}
            {!menuOpen && pendingRequests > 0 && <span className={styles.menuDot} aria-hidden="true" />}
          </button>
        </nav>
      </div>

      {/* Menu déroulant — mobile */}
      {menuOpen && (
        <div className={styles.mobileMenu}>
          <div className="wrap">{links}</div>
        </div>
      )}
    </header>
  );
}
