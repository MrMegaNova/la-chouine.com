import { describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import manifestSource from '../../public/manifest.webmanifest?raw';
import swSource from '../../public/sw.js?raw';
import nginxConf from '../../nginx.conf?raw';
import securityHeaders from '../../security-headers.conf?raw';

// PNG du dépôt, en data URL (`?inline`), indexés par nom de fichier.
const icons = import.meta.glob<string>('../../public/icons/*.png', { query: '?inline', import: 'default', eager: true });

const ORIGIN = 'https://www.la-chouine.com';

type Handler = (event: Record<string, unknown>) => void;

// Exécute sw.js avec un environnement minimal et renvoie ses gestionnaires.
function loadServiceWorker(network: typeof fetch, cached: Response | undefined) {
  const handlers: Record<string, Handler> = {};
  const self = { addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; } };
  const caches = { match: vi.fn(async () => cached) };
  new Function('self', 'caches', 'fetch', swSource)(self, caches, network);
  return handlers;
}

// Envoie une requête au gestionnaire fetch ; `undefined` : il ne l'a pas prise.
function dispatch(handlers: Record<string, Handler>, url: string, mode: string, method = 'GET') {
  let response: Promise<Response> | undefined;
  handlers.fetch({
    request: { url: ORIGIN + url, mode, method },
    respondWith: (r: Promise<Response>) => { response = r; },
  });
  return response;
}

describe('service worker', () => {
  it('laisse passer ce qui n\'est pas une navigation : API, assets, formulaires', () => {
    const network = vi.fn<typeof fetch>();
    const handlers = loadServiceWorker(network, undefined);
    expect(dispatch(handlers, '/api/users/me', 'cors')).toBeUndefined();
    expect(dispatch(handlers, '/assets/index-abc.js', 'cors')).toBeUndefined();
    expect(dispatch(handlers, '/', 'navigate', 'POST')).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  });

  it('ne prend pas en charge une navigation vers /api ou /ws', () => {
    const handlers = loadServiceWorker(vi.fn<typeof fetch>(), undefined);
    expect(dispatch(handlers, '/api/auth/verify-email', 'navigate')).toBeUndefined();
    expect(dispatch(handlers, '/ws', 'navigate')).toBeUndefined();
  });

  it('rend la réponse du serveur telle quelle, y compris un 404', async () => {
    const notFound = new Response('introuvable', { status: 404 });
    const handlers = loadServiceWorker(vi.fn<typeof fetch>(async () => notFound), new Response('hors ligne'));
    expect(await dispatch(handlers, '/inconnue', 'navigate')).toBe(notFound);
  });

  it('affiche la page d\'erreur si le réseau échoue', async () => {
    const offline = new Response('hors ligne');
    const failing = vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); });
    expect(await dispatch(loadServiceWorker(failing, offline), '/jouer', 'navigate')).toBe(offline);
  });

  it('ne met en cache que la page d\'erreur', () => {
    expect(swSource.match(/cache\.(add|addAll|put)\(/g)).toEqual(['cache.add(']);
    expect(swSource).toContain("OFFLINE_URL = '/offline.html'");
  });
});

describe('manifeste', () => {
  const manifest = JSON.parse(manifestSource);

  // Largeur et hauteur lues dans l'en-tête IHDR du PNG.
  function pngSize(src: string): string {
    const png = atob(icons[`../../public${src}`].split(',')[1]);
    const uint32 = (offset: number) =>
      [0, 1, 2, 3].reduce((value, i) => value * 256 + png.charCodeAt(offset + i), 0);
    return `${uint32(16)}x${uint32(20)}`;
  }

  it('déclare les couleurs et la page de départ', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).toBe('#123026');
    expect(manifest.background_color).toBe('#123026');
    expect(indexHtml).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`);
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });

  it.each(['any', 'maskable'])('fournit les icônes %s en 192 et 512', purpose => {
    const sizes = manifest.icons
      .filter((icon: { purpose: string }) => icon.purpose === purpose)
      .map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toEqual(['192x192', '512x512']);
  });

  it('référence des PNG aux dimensions annoncées', () => {
    for (const icon of manifest.icons) expect(pngSize(icon.src)).toBe(icon.sizes);
    expect(pngSize('/icons/apple-touch-icon.png')).toBe('180x180');
  });
});

describe('nginx et CSP', () => {
  const location = (path: string) =>
    nginxConf.match(new RegExp(`location = ${path} \\{(?:[^{}]|\\{ \\})*\\}`))?.[0] ?? '';

  it.each(['/sw.js', '/manifest.webmanifest', '/offline.html'])('sert %s sans cache long et avec la CSP', path => {
    const block = location(path);
    expect(block).toContain('add_header Cache-Control "no-cache"');
    expect(block).toContain('include /etc/nginx/security-headers.conf');
    expect(block).not.toMatch(/immutable|expires/);
  });

  it('autorise le service worker et le manifeste dans la CSP', () => {
    expect(securityHeaders).toContain("worker-src 'self'");
    expect(securityHeaders).toContain("manifest-src 'self'");
  });
});
