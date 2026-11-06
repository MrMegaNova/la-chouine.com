// Échelles et couleurs des graphiques du tableau de bord (#311).

// Couleurs validées sur le fond vert du site : contraste ≥ 3:1, séparation
// suffisante pour les daltonismes courants. Ordre fixe, jamais recyclé.
export const SERIES = ['#3987e5', '#d95926', '#199e70'] as const;

/** « 2026-11-06 » → « 06/11 ». */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

/** Haut d'axe arrondi (1, 2, 2,5 ou 5 × 10ⁿ), au moins 4. */
export function niceMax(max: number): number {
  if (max <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * step >= max) return k * step;
  return 10 * step;
}
