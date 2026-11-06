import type { Card, Rank, Suit } from '@/game/types';

// Démonstrations pas à pas de la page Règles (#70). Léa (« vous », en bas) joue
// contre Marc (en haut, cartes cachées). Les étapes marquées `legal` sont
// vérifiées contre le moteur (demos.test.ts) : les cartes montrées comme
// jouables sont exactement celles qu'accepte le jeu.

export interface DemoStep {
  /** Texte de l'étape, lu par les lecteurs d'écran. `**gras**` est mis en valeur. */
  caption: string;
  trump: Suit;
  /** Cartes restantes au talon (0 = épuisé). */
  talon: number;
  /** Carte retournée à côté du talon, absente une fois ramassée. */
  turnUp: Card | null;
  oppCards: number;
  hand: Card[];
  /** Pli en cours, dans l'ordre de jeu. */
  trick: Array<{ by: 'opp' | 'me'; card: Card }>;
  /** Cartes que Léa a le droit de jouer (les autres sont grisées). */
  legal?: Card[];
}

export interface Demo {
  id: string;
  title: string;
  steps: DemoStep[];
}

export const c = (s: Suit, r: Rank): Card => ({ s, r });

const HAND_PIOCHE = [c('trefle', '7'), c('carreau', '10'), c('carreau', 'R'), c('pique', 'D'), c('coeur', '8')];

export const DEMO_PIOCHE: Demo = {
  id: 'pioche',
  title: 'Démonstration : un pli quand il reste des cartes au talon',
  steps: [
    {
      caption: 'Atout **cœur** (la retourne est le 9♥). Il reste 12 cartes au talon. Marc a la main : il entame.',
      trump: 'coeur', talon: 12, turnUp: c('coeur', '9'), oppCards: 5, hand: HAND_PIOCHE, trick: [],
    },
    {
      caption: 'Marc joue l’**As♦**. Le talon n’est pas vide : Léa n’a **aucune obligation**, toutes ses cartes sont jouables.',
      trump: 'coeur', talon: 12, turnUp: c('coeur', '9'), oppCards: 4, hand: HAND_PIOCHE,
      trick: [{ by: 'opp', card: c('carreau', 'A') }],
      legal: HAND_PIOCHE,
    },
    {
      caption: 'Léa se **défausse** de son 7♣, une carte sans valeur, et garde ses beaux carreaux (10♦ et R♦) pour plus tard.',
      trump: 'coeur', talon: 12, turnUp: c('coeur', '9'), oppCards: 4,
      hand: HAND_PIOCHE.slice(1),
      trick: [{ by: 'opp', card: c('carreau', 'A') }, { by: 'me', card: c('trefle', '7') }],
    },
    {
      caption: 'Marc **remporte le pli** (11 points) : il pioche **en premier**, puis Léa pioche à son tour. Chacun retrouve 5 cartes et le talon passe à 10.',
      trump: 'coeur', talon: 10, turnUp: c('coeur', '9'), oppCards: 5,
      hand: [...HAND_PIOCHE.slice(1), c('coeur', 'V')],
      trick: [],
    },
    {
      caption: 'Celui qui a gagné le pli **a la main** : c’est encore Marc qui entame le pli suivant.',
      trump: 'coeur', talon: 10, turnUp: c('coeur', '9'), oppCards: 4,
      hand: [...HAND_PIOCHE.slice(1), c('coeur', 'V')],
      trick: [{ by: 'opp', card: c('pique', '8') }],
      legal: [...HAND_PIOCHE.slice(1), c('coeur', 'V')],
    },
  ],
};

const HAND_MONTER = [c('coeur', '7'), c('coeur', 'A'), c('pique', '9'), c('carreau', '10'), c('trefle', 'D')];
const HAND_COUPER = [c('coeur', '7'), c('coeur', '8'), c('pique', '9'), c('trefle', 'D')];
const HAND_FOURNIR = [c('pique', '9'), c('pique', 'A'), c('coeur', '7'), c('trefle', 'D')];

export const DEMO_OBLIGATIONS: Demo = {
  id: 'obligations',
  title: 'Démonstration : les obligations quand le talon est épuisé',
  steps: [
    {
      caption: 'Le talon est **épuisé** et l’atout est **cœur** : les obligations s’appliquent. Marc joue le **R♥**, un atout.',
      trump: 'coeur', talon: 0, turnUp: null, oppCards: 4, hand: HAND_MONTER,
      trick: [{ by: 'opp', card: c('coeur', 'R') }],
    },
    {
      caption: 'Atout demandé : Léa doit **monter**, c’est-à-dire jouer un atout plus fort. Seul l’**As♥** bat le Roi : c’est sa seule carte jouable.',
      trump: 'coeur', talon: 0, turnUp: null, oppCards: 4, hand: HAND_MONTER,
      trick: [{ by: 'opp', card: c('coeur', 'R') }],
      legal: [c('coeur', 'A')],
    },
    {
      caption: 'Autre situation. Marc joue le **R♦**. Léa n’a **aucun carreau** : elle doit **couper**, avec n’importe lequel de ses atouts.',
      trump: 'coeur', talon: 0, turnUp: null, oppCards: 3, hand: HAND_COUPER,
      trick: [{ by: 'opp', card: c('carreau', 'R') }],
      legal: [c('coeur', '7'), c('coeur', '8')],
    },
    {
      caption: 'Léa coupe avec son plus petit atout, le **7♥**, et remporte le pli.',
      trump: 'coeur', talon: 0, turnUp: null, oppCards: 3, hand: HAND_COUPER.slice(1),
      trick: [{ by: 'opp', card: c('carreau', 'R') }, { by: 'me', card: c('coeur', '7') }],
    },
    {
      caption: 'Dernière situation. Marc joue le **8♠**. Léa a des piques : elle doit **fournir** du pique. Hors atout, elle n’est pas obligée de monter : le 9♠ comme l’As♠ sont permis.',
      trump: 'coeur', talon: 0, turnUp: null, oppCards: 3, hand: HAND_FOURNIR,
      trick: [{ by: 'opp', card: c('pique', '8') }],
      legal: [c('pique', '9'), c('pique', 'A')],
    },
  ],
};

const HAND_SEPT = [c('pique', '7'), c('carreau', 'V'), c('trefle', '10'), c('coeur', '9'), c('coeur', 'R')];

export const DEMO_SEPT: Demo = {
  id: 'sept',
  title: 'Démonstration : l’échange du 7 d’atout',
  steps: [
    {
      caption: 'La retourne est la **D♠** : l’atout est pique. Léa vient de piocher le **7♠**, le plus petit atout.',
      trump: 'pique', talon: 8, turnUp: c('pique', 'D'), oppCards: 5, hand: HAND_SEPT, trick: [],
    },
    {
      caption: 'À son tour de jouer, Léa **échange** son 7♠ contre la retourne : le 7♠ prend la place de la Dame à côté du talon.',
      trump: 'pique', talon: 8, turnUp: c('pique', '7'), oppCards: 5,
      hand: [c('pique', 'D'), ...HAND_SEPT.slice(1)], trick: [],
    },
    {
      caption: 'Léa a gagné au change : une **Dame d’atout** (3 points) au lieu d’un 7 (0 point). Elle peut maintenant entamer le pli.',
      trump: 'pique', talon: 8, turnUp: c('pique', '7'), oppCards: 5,
      hand: [c('pique', 'D'), ...HAND_SEPT.slice(1)], trick: [],
      legal: [c('pique', 'D'), ...HAND_SEPT.slice(1)],
    },
    {
      caption: 'Si le 7 d’atout est encore en main quand il ne reste qu’**une carte au talon et la retourne**, le joueur qui entame annonce « **au sept** » : c’est le dernier moment pour faire l’échange.',
      trump: 'pique', talon: 1, turnUp: c('pique', 'D'), oppCards: 5, hand: HAND_SEPT, trick: [],
    },
  ],
};
