// Pré-rendu des pages publiques (#271), lancé après `vite build`.
// Écrit le HTML de chaque page publique, la coquille des pages privées
// (spa.html) et le sitemap. Échoue si une page sort sans contenu : mieux vaut un
// build rouge qu'un site redevenu invisible pour les moteurs de recherche.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const ssrDir = join(root, 'dist-ssr');

const { renderPage, buildPageHtml, buildShellHtml, buildSitemap, PUBLIC_PAGES } =
  await import(pathToFileURL(join(ssrDir, 'entry-server.js')).href);

const template = readFileSync(join(dist, 'index.html'), 'utf8');
writeFileSync(join(dist, 'spa.html'), buildShellHtml(template));

for (const { path } of PUBLIC_PAGES) {
  const body = renderPage(path);
  const h1Count = (body.match(/<h1[\s>]/g) ?? []).length;
  if (h1Count !== 1) {
    throw new Error(`Pré-rendu de ${path} : ${h1Count} <h1> au lieu d'un seul.`);
  }
  const outDir = path === '/' ? dist : join(dist, path);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), buildPageHtml(template, path, body));
  console.log(`pré-rendu : ${path}`);
}

writeFileSync(join(dist, 'sitemap.xml'), buildSitemap());

// Identifiant de build du service worker (#212). Le gabarit référence les assets
// par leur hash : l'identifiant change dès que le code, les styles ou la page
// d'erreur changent, et reste stable si le build est identique.
const swPath = join(dist, 'sw.js');
const buildId = createHash('sha256')
  .update(template)
  .update(readFileSync(join(dist, 'offline.html')))
  .digest('hex')
  .slice(0, 12);
const sw = readFileSync(swPath, 'utf8');
if (!sw.includes('__BUILD_ID__')) throw new Error('sw.js : identifiant de build introuvable.');
writeFileSync(swPath, sw.replace('__BUILD_ID__', buildId));

rmSync(ssrDir, { recursive: true, force: true });
