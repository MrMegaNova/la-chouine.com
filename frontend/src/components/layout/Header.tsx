import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import styles from './Header.module.scss';

function initials(name: string): string {
  return name.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase();
}

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
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

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

          <div className={styles.nav}>
            <Link to="/" className={`${styles.navLink} ${isActive('/') ? styles.active : ''}`}>Accueil</Link>
            <Link to="/jouer" className={`${styles.navLink} ${isActive('/jouer') ? styles.active : ''}`}>Jouer</Link>
            {user && <Link to="/amis" className={`${styles.navLink} ${isActive('/amis') ? styles.active : ''}`}>Amis</Link>}
            {user && <Link to="/profil" className={`${styles.navLink} ${isActive('/profil') ? styles.active : ''}`}>Profil</Link>}
            <Link to="/regles" className={`${styles.navLink} ${isActive('/regles') ? styles.active : ''}`}>Règles</Link>
          </div>

          <div className={styles.authArea}>
            {user ? (
              <Link to="/profil" className={styles.userChip} style={{ textDecoration: 'none' }}>
                <div className={styles.avatar}>{initials(user.username)}</div>
                <span className={styles.userName}>{user.username}</span>
              </Link>
            ) : (
              <Link to="/connexion" className="btn btn--ghost btn--sm">Se connecter</Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
