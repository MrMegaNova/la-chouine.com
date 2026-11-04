// Génération du HTML pré-rendu (#271), appelée à la compilation par
// scripts/prerender.mjs. Fonctions pures, testées dans seo.test.tsx.
import { metaForPath, OG_IMAGE_URL, PUBLIC_PAGES, SITE_NAME, SITE_URL } from './pages';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Données structurées de l'accueil. Volontairement factuelles : ni note ni avis.
function structuredData(): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: PUBLIC_PAGES[0].description,
    inLanguage: 'fr',
    genre: 'Jeu de cartes',
    gamePlatform: 'Navigateur web',
    playMode: ['SinglePlayer', 'MultiPlayer'],
  };
  // `<` échappé : le contenu ne peut pas refermer la balise <script>.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function setHead(template: string, path: string): string {
  const meta = metaForPath(path);
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const tags: string[] = [];

  if (meta.noindex) {
    tags.push('<meta name="robots" content="noindex" />');
  } else {
    const canonical = escapeHtml(meta.canonical ?? '');
    tags.push(
      `<link rel="canonical" href="${canonical}" />`,
      '<meta property="og:type" content="website" />',
      '<meta property="og:locale" content="fr_FR" />',
      `<meta property="og:site_name" content="${SITE_NAME}" />`,
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${description}" />`,
      `<meta property="og:url" content="${canonical}" />`,
      `<meta property="og:image" content="${OG_IMAGE_URL}" />`,
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
      '<meta name="twitter:card" content="summary_large_image" />',
    );
    if (path === '/') tags.push(structuredData());
  }

  return template
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, (_, start, end) => `${start}${description}${end}`)
    .replace('</head>', () => `  ${tags.join('\n  ')}\n</head>`);
}

/** Page publique complète : balises propres à la page et contenu déjà rendu. */
export function buildPageHtml(template: string, path: string, body: string): string {
  return setHead(template, path).replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}

/** Coquille vide des pages privées (profil, amis...), exclue de l'index. */
export function buildShellHtml(template: string): string {
  return setHead(template, '/profil').replace(/<title>[^<]*<\/title>/, () => `<title>${SITE_NAME}</title>`);
}

export function buildSitemap(): string {
  const urls = PUBLIC_PAGES
    .map(p => `  <url><loc>${SITE_URL}${p.path}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
