import { Link } from 'react-router-dom';
import { GITHUB_URL, CONTACT_EMAIL } from '@/components/layout/Footer';

// Page « À propos » (#88) — présentation du projet, statut, et comment
// signaler un bug (issue GitHub ou email).
export default function About() {
  return (
    <div className="wrap" style={{ maxWidth: 760, paddingTop: 40, paddingBottom: 60 }}>
      <h2 className="section-title">À propos de La Chouine</h2>
      <p className="section-sub">
        Une adaptation en ligne du jeu de cartes traditionnel de la Vallée du Loir.
      </p>

      <div className="panel">
        <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, marginTop: 0, marginBottom: 8 }}>Le projet</h3>
        <p style={{ lineHeight: 1.65, color: 'var(--cream-2)' }}>
          La Chouine est un jeu de cartes du Centre-Ouest de la France, et plus
          particulièrement de la Vallée du Loir, dont les origines remontent au
          XVIᵉ siècle. Ce site en propose une version jouable contre l'ordinateur,
          en local, ou en ligne contre d'autres joueurs.
        </p>
        <p style={{ lineHeight: 1.65, color: 'var(--cream-2)', marginTop: 10 }}>
          ⚠️ <b>Le projet est en cours de développement</b> : de nouvelles
          fonctionnalités arrivent régulièrement et des bugs peuvent subsister.
          Merci de votre indulgence — et de vos retours&nbsp;!
        </p>

        <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, marginBottom: 8, marginTop: 26 }}>Signaler un bug</h3>
        <p style={{ lineHeight: 1.65, color: 'var(--cream-2)' }}>
          Si vous rencontrez un problème ou avez une suggestion, deux moyens&nbsp;:
        </p>
        <ul style={{ lineHeight: 1.7, color: 'var(--cream-2)', paddingLeft: 18 }}>
          <li>
            ouvrir une <b>issue</b> sur le dépôt{' '}
            <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--gold-soft)' }}>GitHub</a>{' '}
            (le plus utile : on peut en discuter et suivre la correction)&nbsp;;
          </li>
          <li>
            ou écrire à{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--gold-soft)' }}>{CONTACT_EMAIL}</a>.
          </li>
        </ul>

        <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, marginBottom: 8, marginTop: 26 }}>Code source &amp; crédits</h3>
        <p style={{ lineHeight: 1.65, color: 'var(--cream-2)' }}>
          Le code est ouvert sur{' '}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--gold-soft)' }}>GitHub</a>.
          Les règles s'appuient sur la « Règle du jeu de la Chouine » de Jacques
          Proust, éditée par l'association de sauvegarde du château de Lavardin —
          détaillées sur la page <Link to="/regles" style={{ color: 'var(--gold-soft)' }}>Règles</Link>.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 22 }}>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="btn btn--gold">Voir sur GitHub</a>
          <Link to="/regles" className="btn btn--ghost">Apprendre les règles</Link>
        </div>
      </div>
    </div>
  );
}
