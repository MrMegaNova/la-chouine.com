// Déclaration de type pour le runner CommonJS partagé (#128), afin que tsc
// (frontend) résolve l'import sans `allowJs`. Le moteur et la fixture sont
// volontairement typés `unknown` : le runner est agnostique du moteur (TS ou JS)
// et la forme d'une fixture dépend de sa fonction.
export function runCase(engine: unknown, fixture: unknown): unknown;
