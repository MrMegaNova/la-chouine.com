import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import indexHtml from '../../index.html?raw';
import notFoundHtml from '../../public/404.html?raw';
import nginxConf from '../../nginx.conf?raw';
import securityHeaders from '../../security-headers.conf?raw';

// Polices servies par le site (#284) : aucun appel à Google, mêmes graisses.
describe('polices hébergées par le site', () => {
  // Vitest vide les imports de styles, même en ?raw : on compile les sources.
  const css = (file: string) => compile(decodeURIComponent(new URL(file, import.meta.url).pathname)).css;
  const faces = css('./_fonts.scss').match(/@font-face \{[^}]*\}/g) ?? [];
  const prop = (face: string, name: string) => face.match(new RegExp(`${name}: ([^;]+);`))?.[1];

  it('ne référence plus Google Fonts', () => {
    for (const source of [indexHtml, notFoundHtml, securityHeaders]) {
      expect(source).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });

  it('conserve les graisses et les italiques de Fraunces et Manrope', () => {
    const declared = faces.map(f => [prop(f, 'font-family'), prop(f, 'font-style'), prop(f, 'font-weight')].join(' '));
    expect(declared).toEqual([
      '"Fraunces" normal 400',
      '"Fraunces" normal 600',
      '"Fraunces" normal 900',
      '"Fraunces" italic 500',
      '"Manrope" normal 400 800',
    ]);
  });

  it('sert uniquement du woff2 latin, en font-display: swap', () => {
    expect(faces).toHaveLength(5);
    for (const face of faces) {
      expect(prop(face, 'font-display')).toBe('swap');
      expect(prop(face, 'src')).toMatch(/-latin-(opsz|wght)-(normal|italic)\.woff2"\) format\("woff2"\)$/);
    }
  });

  it('déclare les familles attendues par --serif et --sans', () => {
    const variables = css('./_variables.scss');
    expect(variables).toMatch(/--serif:\s+"Fraunces",/);
    expect(variables).toMatch(/--sans:\s+"Manrope",/);
  });

  it('autorise les polices dans la CSP et les met en cache long', () => {
    expect(securityHeaders).toContain("font-src 'self'");
    expect(nginxConf).toMatch(/location ~\* \\\.\(\?:[^)]*woff2\?[^)]*\)\$ \{\s+expires 1y;/);
  });
});
