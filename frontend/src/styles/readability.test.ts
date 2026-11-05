import { describe, expect, it } from 'vitest';
import { compile } from 'sass';

// Lisibilité (#252) : aucune taille de texte écrite en dur sous 14 px. La vérification
// des tailles calculées demande un navigateur ; ce garde-fou repère les retours en arrière.
const MIN_PX = 14;

const tsx = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });
// Vitest vide les imports de styles, même en ?raw : on compile les sources.
const scssFiles = Object.keys(import.meta.glob('../**/*.scss'));
const resolveAlias = {
  findFileUrl: (url: string) => (url.startsWith('@/') ? new URL(`../${url.slice(2)}`, import.meta.url) : null),
};
const compileScss = (file: string) => compile(
  decodeURIComponent(new URL(file, import.meta.url).pathname),
  { importers: [resolveAlias] },
).css;

function tooSmall(code: string): string[] {
  const found: string[] = [];
  for (const [text, value, unit] of code.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
    if (parseFloat(value) * (unit === 'rem' ? 16 : 1) < MIN_PX) found.push(text);
  }
  for (const [text, value] of code.matchAll(/fontSize:\s*([\d.]+)/g)) {
    if (parseFloat(value) < MIN_PX) found.push(text);
  }
  return found;
}

describe('tailles de texte', () => {
  it('reconnaît les tailles trop petites, en SCSS comme en style React', () => {
    expect(tooSmall('.a { font-size: 12.5px; } .b { font-size: 0.75rem; } .c { font-size: 14px; }'))
      .toEqual(['font-size: 12.5px', 'font-size: 0.75rem']);
    expect(tooSmall("<b style={{ fontSize: 11 }} /> <b style={{ fontSize: 'var(--fs-small)' }} />"))
      .toEqual(['fontSize: 11']);
  });

  it('ne laisse aucune taille écrite en dur sous 14 px dans les composants', () => {
    expect(Object.keys(tsx).length).toBeGreaterThan(10);
    const offenders = Object.entries(tsx).flatMap(([file, code]) =>
      tooSmall(code).map(text => `${file} : ${text}`));
    expect(offenders).toEqual([]);
  });

  it('ne laisse aucune taille écrite en dur sous 14 px dans les styles', () => {
    expect(scssFiles.length).toBeGreaterThan(5);
    const offenders = scssFiles.flatMap(file =>
      tooSmall(compileScss(file)).map(text => `${file} : ${text}`));
    expect(offenders).toEqual([]);
  });
});
