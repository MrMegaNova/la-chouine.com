import type { SoundName } from './sounds';

// Ce qu'il faut entendre entre deux états de la table (#155). Fonction pure :
// la même pour le jeu local et en ligne (en ligne, plusieurs changements
// peuvent arriver dans un seul état poussé par le serveur).

export interface TableSnapshot {
  handNo: number;
  phase: string;
  trickLength: number;
  /** Cartes restant à piocher : talon + retourne. */
  stock: number;
  /** Cartes déjà tirées pour désigner le donneur (coupe). */
  cutPicks: number;
  /** Annonce visible, identifiée (main + siège + annonce), ou null. */
  announceKey: string | null;
  /** Siège du vainqueur du match quand il est connu, sinon null. */
  matchWinner: number | null;
}

export interface Cue { sound: SoundName; delay: number }

const DEALT = (phase: string) => phase === 'draw' || phase === 'final';

export function cuesBetween(prev: TableSnapshot | null, next: TableSnapshot, me: number, everyoneHuman: boolean): Cue[] {
  // Premier affichage (table ouverte ou rechargée) : rien à rejouer.
  if (!prev) return [];
  const cues: Cue[] = [];

  // Coupe : une pioche par carte tirée pour désigner le donneur.
  if (next.handNo === prev.handNo && !DEALT(next.phase)) {
    const picked = Math.min(next.cutPicks - prev.cutPicks, 4);
    for (let i = 0; i < picked; i++) cues.push({ sound: 'draw', delay: i * 180 });
  }

  const newHand = DEALT(next.phase) && (!DEALT(prev.phase) || prev.handNo !== next.handNo);
  if (newHand) {
    cues.push({ sound: 'deal', delay: 0 });
  } else if (prev.handNo === next.handNo) {
    // Cartes posées (une par carte, légèrement décalées si plusieurs à la fois).
    const played = next.trickLength - prev.trickLength;
    for (let i = 0; i < played; i++) cues.push({ sound: 'play', delay: i * 180 });
    // Pli ramassé, puis pioche du gagnant et de l'adversaire.
    if (next.trickLength < prev.trickLength) cues.push({ sound: 'collect', delay: 0 });
    const drawn = Math.min(prev.stock - next.stock, 4);
    for (let i = 0; i < drawn; i++) cues.push({ sound: 'draw', delay: 250 + i * 180 });
  }

  if (next.announceKey && next.announceKey !== prev.announceKey) cues.push({ sound: 'announce', delay: 0 });

  if (next.matchWinner !== null && prev.matchWinner === null) {
    // Partie entre humains sur le même appareil : il y a toujours un gagnant à fêter.
    const won = everyoneHuman || next.matchWinner === me;
    cues.push({ sound: won ? 'win' : 'lose', delay: 400 });
  }
  return cues;
}
