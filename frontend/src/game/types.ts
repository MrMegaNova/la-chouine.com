export type Suit = 'pique' | 'coeur' | 'carreau' | 'trefle';
export type Rank = '7' | '8' | '9' | '10' | 'V' | 'D' | 'R' | 'A';
export type Variant = 'classic' | 'mondoubleau';
export type Mode = 'ai' | 'local' | 'friend' | 'online';
export type Phase = 'draw' | 'final';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Card {
  readonly s: Suit;
  readonly r: Rank;
}

export interface TrickEntry {
  readonly p: number;
  readonly card: Card;
}

export interface PlayerState {
  hand: Card[];
  won: Card[];
  declared: Set<string>;
  annonce: number;
}

export interface GameState {
  // Match config
  mode: Mode;
  variant: Variant;
  playerCount: 2 | 3 | 4;
  diff: Difficulty;
  target: 3 | 5;
  names: string[];
  oppId: string | null;
  opts: GameOpts;

  // Match progress
  scores: number[];
  dealer: number;
  handNo: number;
  lastHandDrawn: boolean;
  recorded: boolean;

  // View
  viewPlayer: number;
  gatePending: boolean;

  // Current hand
  players: PlayerState[];
  trump: Suit | null;
  turnUp: Card | null;
  talon: Card[];
  trick: TrickEntry[];
  leader: number;
  turn: number;
  phase: Phase;
  handOver: boolean;
  lastTrickWinner: number | null;
  // Dernier pli ramassé (cartes + vainqueur) : seul pli adverse consultable (#74).
  lastTrick: { cards: TrickEntry[]; winner: number } | null;
  // Dernière annonce déclarée : ses cartes sont étalées sur le tapis (#77).
  lastAnnounce: { seat: number; sig: string; label: string; cards: Card[] } | null;
  sevenAnnounced: boolean;
}

export interface GameOpts {
  mode: Mode;
  variant: Variant;
  playerCount: 2 | 3 | 4;
  diff?: Difficulty;
  target: 3 | 5;
  names: string[];
  oppId?: string | null;
}

export interface Combo {
  type: 'mariage' | 'tierce' | 'quarteron' | 'quinte' | 'trente' | 'chouine';
  suit: Suit | null;
  sig: string;
  label: string;
  value: number;
  setsTrump: boolean;
}

export interface HandResult {
  cp: number[];
  ann: number[];
  der: number | null;
  tot: number[];
  winner: number;
  forced: boolean;
  matchWinner: number | null;
}
