// Source unique du référencement (#271) : alimente le pré-rendu, le sitemap et
// les balises mises à jour en navigation côté client (usePageMeta).
// Toute page ajoutée à PUBLIC_PAGES doit aussi figurer dans frontend/nginx.conf
// (un test vérifie la synchronisation).

export const SITE_URL = 'https://www.la-chouine.com';
export const SITE_NAME = 'La Chouine';
export const OG_IMAGE_URL = `${SITE_URL}/og-image.png`;

export interface PublicPage {
  path: string;
  title: string;
  description: string;
}

export interface PageMeta {
  title: string;
  description: string;
  /** URL canonique ; null pour une page exclue de l'index. */
  canonical: string | null;
  noindex: boolean;
}

export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: '/',
    title: 'Jouer à la Chouine en ligne — le jeu de cartes de la Vallée du Loir',
    description: "Jouez à la Chouine en ligne, contre l'ordinateur ou entre amis. Le jeu de cartes historique de la Vallée du Loir, avec ses brisques et ses annonces.",
  },
  {
    path: '/jouer',
    title: "Lancer une partie de Chouine — contre l'ordinateur ou en ligne",
    description: "Lancez une partie de Chouine contre l'ordinateur, en local ou en ligne contre d'autres joueurs, en variante classique ou de Mondoubleau.",
  },
  {
    path: '/regles',
    title: 'Règles de la Chouine — comment jouer, annonces et variantes',
    description: 'Les règles de la Chouine expliquées : déroulement des coups, annonces, parties à 3 ou 4 joueurs et variante de Mondoubleau.',
  },
  {
    path: '/a-propos',
    title: 'À propos — La Chouine, un jeu traditionnel de la Vallée du Loir',
    description: 'Le projet la-chouine.com : une adaptation en ligne du jeu de cartes traditionnel de la Vallée du Loir.',
  },
];

// Titres d'onglet des pages exclues de l'index.
const PRIVATE_TITLES: Array<[prefix: string, title: string]> = [
  ['/connexion', 'Connexion'],
  ['/amis', 'Mes amis'],
  ['/profil', 'Mon profil'],
  ['/joueur/', 'Profil de joueur'],
  ['/reset-password', 'Nouveau mot de passe'],
  ['/jeu', 'Partie en cours'],
  ['/invitation/', 'Invitation'],
];

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function metaForPath(pathname: string): PageMeta {
  const path = normalize(pathname);
  const page = PUBLIC_PAGES.find(p => p.path === path);
  if (page) {
    return {
      title: page.title,
      description: page.description,
      canonical: `${SITE_URL}${page.path}`,
      noindex: false,
    };
  }
  const label = PRIVATE_TITLES.find(([prefix]) => path.startsWith(prefix))?.[1];
  return {
    title: label ? `${label} — ${SITE_NAME}` : SITE_NAME,
    description: PUBLIC_PAGES[0].description,
    canonical: null,
    noindex: true,
  };
}
