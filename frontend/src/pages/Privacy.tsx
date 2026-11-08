import { Link } from 'react-router-dom';
import { CONTACT_EMAIL } from '@/components/layout/Footer';

// Page « Confidentialité » (#311) : données collectées, finalités, durées de
// conservation et droits. Toute nouvelle collecte doit y être ajoutée.
const P = { lineHeight: 1.65, color: 'var(--cream-2)' } as const;
const H = { fontFamily: 'var(--serif)', fontSize: 22, marginBottom: 8, marginTop: 26 } as const;
const LINK = { color: 'var(--gold-soft)' } as const;

export default function Privacy() {
  return (
    <div className="wrap" style={{ maxWidth: 760, paddingTop: 40, paddingBottom: 60 }}>
      <h1 className="section-title">Confidentialité</h1>
      <p className="section-sub">Ce que la-chouine.com enregistre, pourquoi, et pour combien de temps.</p>

      <div className="panel">
        <h2 style={{ ...H, marginTop: 0 }}>Responsable</h2>
        <p style={P}>
          Le site est édité par un particulier, à titre non commercial. Pour toute question
          ou demande : <a href={`mailto:${CONTACT_EMAIL}`} style={LINK}>{CONTACT_EMAIL}</a>.
        </p>

        <h2 style={H}>Votre compte</h2>
        <p style={P}>
          Si vous créez un compte : pseudo, adresse email, mot de passe (enregistré sous une
          forme chiffrée, illisible même pour nous), parties jouées, classement, badges et
          amis. Ces données servent uniquement au jeu. Elles sont conservées tant que le
          compte existe et sont effacées quand vous le supprimez depuis votre{' '}
          <Link to="/profil" style={LINK}>profil</Link>. Vos parties restent alors dans
          l'historique de vos adversaires sous le nom « Ancien joueur ».
        </p>

        <h2 style={H}>Connexion avec Google, Facebook ou Apple</h2>
        <p style={P}>
          Si vous choisissez ce mode de connexion, le service choisi nous transmet votre
          identifiant chez lui, votre adresse email et votre prénom (proposé comme pseudo). Nous
          ne recevons ni votre mot de passe, ni vos contacts, ni vos publications, et nous ne
          publions rien en votre nom. Ces données suivent les règles de votre compte ci-dessus.
          Le service choisi sait, de son côté, que vous vous êtes connecté à la-chouine.com.
        </p>

        <h2 style={H}>Mesure d'audience</h2>
        <p style={P}>
          Pour savoir combien de personnes visitent le site et d'où elles viennent, chaque
          page vue est enregistrée sur notre serveur, sans outil tiers ni cookie :
        </p>
        <ul style={{ ...P, paddingLeft: 18 }}>
          <li>
            la page visitée, la date, le site d'où vous arrivez et, si vous avez suivi un lien
            d'une de nos campagnes (affiche, publication), le nom de cette campagne ;
          </li>
          <li>le type d'appareil (ordinateur, tablette ou téléphone) ;</li>
          <li>
            votre adresse IP, <b>conservée 30 jours</b> puis effacée automatiquement, et la
            localisation approximative qu'on en déduit (pays, région, ville), conservée
            ensuite sans l'adresse IP ;
          </li>
          <li>votre pseudo, si vous êtes connecté.</li>
        </ul>
        <p style={P}>
          Ces informations ne sont ni vendues ni partagées. Pour ne pas être mesuré, activez
          dans votre navigateur l'option « Ne pas me suivre » (Do Not Track) ou le Global
          Privacy Control : le site n'enregistre alors plus vos visites.
        </p>

        <h2 style={H}>Vos droits</h2>
        <p style={P}>
          Vous pouvez demander à consulter, corriger ou effacer vos données, ou vous opposer
          à la mesure d'audience, en écrivant à{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={LINK}>{CONTACT_EMAIL}</a>. Vous pouvez
          aussi saisir la CNIL (cnil.fr).
        </p>

        <h2 style={H}>Crédits</h2>
        <p style={P}>
          La localisation est calculée sur notre serveur, sans envoyer votre adresse à
          personne. Ce site utilise les données GeoLite2 créées par MaxMind, disponibles
          sur <a href="https://www.maxmind.com" target="_blank" rel="noreferrer noopener" style={LINK}>maxmind.com</a>,
          et, en secours, la base{' '}
          <a href="https://db-ip.com" target="_blank" rel="noreferrer noopener" style={LINK}>IP Geolocation by DB-IP</a>{' '}
          (licence CC BY 4.0).
        </p>
      </div>
    </div>
  );
}
