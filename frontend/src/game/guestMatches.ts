import { gamesApi, type SaveGamePayload } from '@/api/client';

// Parties jouées sans compte (#290) : gardées dans le navigateur, puis ajoutées
// à l'historique du joueur dès qu'il se connecte (après inscription ou non).
// Le siège 0 est le joueur ; son `userId` est renseigné à l'envoi.

const KEY = 'chouine-guest-matches';
export const GUEST_MATCH_MAX = 10;
export const GUEST_MATCH_TTL_MS = 7 * 24 * 3600 * 1000;

export interface GuestMatch {
  endedAt: number;
  payload: SaveGamePayload;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // stockage bloqué (navigation privée stricte)
  }
}

/** Parties en attente, sans celles trop anciennes ou illisibles. */
export function pendingGuestMatches(now = Date.now(), store = storage()): GuestMatch[] {
  if (!store) return [];
  try {
    const list = JSON.parse(store.getItem(KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((m): m is GuestMatch =>
      typeof m?.endedAt === 'number' && now - m.endedAt < GUEST_MATCH_TTL_MS
      && Array.isArray(m?.payload?.players));
  } catch {
    return [];
  }
}

function write(list: GuestMatch[], store: Store) {
  if (list.length === 0) store.removeItem(KEY);
  else store.setItem(KEY, JSON.stringify(list));
}

/** Garde une partie terminée sans compte (les plus récentes d'abord retenues). */
export function keepGuestMatch(payload: SaveGamePayload, now = Date.now(), store = storage()) {
  if (!store) return;
  try {
    write([...pendingGuestMatches(now, store), { endedAt: now, payload }].slice(-GUEST_MATCH_MAX), store);
  } catch {
    // stockage plein ou refusé : la partie n'est simplement pas gardée
  }
}

/**
 * Envoie les parties en attente sur le compte qui vient de se connecter.
 * Une partie refusée par le serveur (422…) est abandonnée ; une erreur réseau,
 * serveur ou de session la laisse en attente pour la prochaine connexion.
 * Renvoie le nombre de parties ajoutées.
 */
export function flushGuestMatches(
  token: string, userId: string, save = gamesApi.save, store = storage(), now = Date.now(),
): Promise<number> {
  // Un seul envoi à la fois : deux appels rapprochés (effet rejoué, session
  // restaurée puis rafraîchie) ne doivent pas enregistrer deux fois la partie.
  flushing ??= send(token, userId, save, store, now).finally(() => { flushing = null; });
  return flushing;
}

let flushing: Promise<number> | null = null;

async function send(
  token: string, userId: string, save: typeof gamesApi.save, store: Store | null, now: number,
): Promise<number> {
  if (!store) return 0;
  const pending = pendingGuestMatches(now, store);
  const kept: GuestMatch[] = [];
  let saved = 0;
  for (const match of pending) {
    const players = match.payload.players.map((p, seat) => (seat === 0 ? { ...p, userId, guestName: null } : p));
    const { ok, status } = await save({ ...match.payload, players }, token);
    if (ok) saved++;
    else if (status === 0 || status === 401 || status >= 500) kept.push(match);
  }
  write(kept, store);
  return saved;
}
