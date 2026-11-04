// @vitest-environment jsdom
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import App from '@/App';
import nginxConf from '../../nginx.conf?raw';
import { buildPageHtml, buildShellHtml, buildSitemap } from './html';
import { metaForPath, PUBLIC_PAGES, SITE_URL } from './pages';
import { applyPageMeta } from './usePageMeta';

const TEMPLATE = `<html><head><title>Défaut</title><meta name="description" content="Défaut" /></head><body><div id="root"></div></body></html>`;

describe('metaForPath', () => {
  it('donne à chaque page publique un titre et une description uniques', () => {
    expect(new Set(PUBLIC_PAGES.map(p => p.title)).size).toBe(PUBLIC_PAGES.length);
    expect(new Set(PUBLIC_PAGES.map(p => p.description)).size).toBe(PUBLIC_PAGES.length);
  });

  it('ignore la barre oblique finale pour la page et son URL canonique', () => {
    expect(metaForPath('/regles/').canonical).toBe(`${SITE_URL}/regles`);
    expect(metaForPath('/').canonical).toBe(`${SITE_URL}/`);
  });

  it('exclut de l\'index les pages privées', () => {
    for (const path of ['/profil', '/amis', '/connexion', '/joueur/abc', '/reset-password']) {
      const meta = metaForPath(path);
      expect(meta.noindex).toBe(true);
      expect(meta.canonical).toBeNull();
    }
  });
});

describe('génération du HTML', () => {
  it('insère les balises et le contenu de la page', () => {
    const html = buildPageHtml(TEMPLATE, '/regles', '<h1>Règles</h1>');
    const meta = metaForPath('/regles');
    expect(html).toContain(`<title>${meta.title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/regles" />`);
    expect(html).toContain('property="og:image"');
    expect(html).toContain('<div id="root"><h1>Règles</h1></div>');
    expect(html).not.toContain('noindex');
    expect(html).not.toContain('application/ld+json');
  });

  it('réserve les données structurées à l\'accueil, en JSON valide', () => {
    const html = buildPageHtml(TEMPLATE, '/', '<h1>Accueil</h1>');
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
    expect(JSON.parse(json ?? '').name).toBe('La Chouine');
  });

  it('n\'interprète pas les motifs $ du contenu rendu', () => {
    const html = buildPageHtml(TEMPLATE, '/regles', '<p>$& $1</p>');
    expect(html).toContain('<p>$& $1</p>');
  });

  it('laisse la coquille vide et hors index', () => {
    const html = buildShellHtml(TEMPLATE);
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain('rel="canonical"');
  });

  it('liste uniquement les pages publiques dans le sitemap', () => {
    const sitemap = buildSitemap();
    for (const { path } of PUBLIC_PAGES) expect(sitemap).toContain(`<loc>${SITE_URL}${path}</loc>`);
    expect(sitemap.match(/<url>/g)).toHaveLength(PUBLIC_PAGES.length);
    expect(sitemap).not.toContain('/profil');
  });
});

describe('pré-rendu des pages publiques', () => {
  it.each(PUBLIC_PAGES.map(p => p.path))('%s contient un seul <h1>', path => {
    const body = renderToString(
      <StaticRouter location={path}>
        <App />
      </StaticRouter>
    );
    expect(body.match(/<h1[\s>]/g)).toHaveLength(1);
  });
});

describe('nginx.conf', () => {
  it('sert toutes les pages publiques', () => {
    const match = nginxConf.match(/location ~ \^\/\(([^)]+)\)\/\?\$ \{\s+include[^\n]+\n\s+add_header Cache-Control[^\n]+\n\s+try_files \/\$1\/index\.html/);
    const served = match?.[1].split('|').sort();
    const expected = PUBLIC_PAGES.filter(p => p.path !== '/').map(p => p.path.slice(1)).sort();
    expect(served).toEqual(expected);
  });
});

describe('applyPageMeta', () => {
  it('passe d\'une page privée à une page publique sans laisser de noindex', () => {
    applyPageMeta(metaForPath('/profil'));
    expect(document.title).toBe('Mon profil — La Chouine');
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();

    applyPageMeta(metaForPath('/regles'));
    expect(document.title).toBe(metaForPath('/regles').title);
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE_URL}/regles`);
  });
});
