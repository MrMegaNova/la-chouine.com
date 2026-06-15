const BASE = '/api';

// Délai max d'une requête (#131) : sans borne, un backend qui ne répond pas
// laisse l'UI en chargement infini (le `catch` ne couvre que l'échec réseau
// immédiat). `AbortSignal.timeout` annule la requête au-delà de ce délai.
const TIMEOUT_MS = 10_000;

interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T;
}

async function apiCall<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null
): Promise<ApiResponse<T>> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}) as T);
    return { ok: res.ok, status: res.status, data: data as T };
  } catch (err) {
    // `AbortSignal.timeout` rejette avec une DOMException `TimeoutError` :
    // message dédié pour distinguer un serveur lent d'un serveur injoignable.
    const error = err instanceof DOMException && err.name === 'TimeoutError'
      ? 'Délai dépassé.'
      : 'Serveur indisponible.';
    return { ok: false, status: 0, data: { error } as T };
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  // Champ-piège anti-bot (#86) : caché aux humains, vide en usage normal.
  website?: string;
}
export interface LoginResponse {
  token: string;
  id: string;
  username: string;
}
export interface MeResponse {
  id: string;
  username: string;
  email: string;
  joined: string;
  avatar: string | null;
  stats: { wins: number; losses: number; plays: number };
  ratings: { classic: number; mondoubleau: number };
}

export const authApi = {
  register: (p: RegisterPayload) =>
    apiCall<{ message: string; errors?: string[] }>('POST', '/auth/register', p),

  login: (username: string, password: string) =>
    apiCall<LoginResponse>('POST', '/auth/login', { username, password }),

  verifyEmail: (token: string) =>
    apiCall<{ message: string }>('GET', `/auth/verify-email?token=${encodeURIComponent(token)}`),

  forgotPassword: (email: string) =>
    apiCall<{ message: string }>('POST', '/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    apiCall<{ message: string }>('POST', '/auth/reset-password', { token, password }),
};

// ─── Users ────────────────────────────────────────────────────────────────────

export interface SearchUser {
  id: string;
  username: string;
  avatar: string | null;
  wins: number;
  plays: number;
  friendshipStatus: string | null;
  friendshipRequester: string | null;
}
export interface HistoryEntry {
  id: string;
  mode: string;
  variant: string;
  player_count: number;
  target_score: number;
  date: string;
  my_score: number | null;
  won: boolean | null;
  opponents: string | null;
}

export const usersApi = {
  me: (token: string) => apiCall<MeResponse>('GET', '/users/me', undefined, token),

  search: (q: string, token: string) =>
    apiCall<SearchUser[]>('GET', `/users/search?q=${encodeURIComponent(q)}`, undefined, token),

  history: (token: string) =>
    apiCall<HistoryEntry[]>('GET', '/users/history', undefined, token),

  // Le serveur réémet un token frais : le changement révoque tous les JWT
  // antérieurs (#117), y compris celui de la session courante.
  changePassword: (currentPassword: string, newPassword: string, token: string) =>
    apiCall<{ message: string; token?: string; error?: string }>(
      'POST', '/users/me/password', { currentPassword, newPassword }, token),

  // Avatar (#87) : data URL (base64) d'une image redimensionnée côté client.
  setAvatar: (avatar: string, token: string) =>
    apiCall<{ avatar: string; error?: string }>('POST', '/users/me/avatar', { avatar }, token),
  removeAvatar: (token: string) =>
    apiCall<{ avatar: null }>('DELETE', '/users/me/avatar', undefined, token),
};

// ─── Friends ──────────────────────────────────────────────────────────────────

export interface Friend {
  id: string;
  username: string;
  avatar: string | null;
  wins: number;
  plays: number;
  online: boolean;
  inGame: boolean;
}
export interface FriendRequest {
  id: string;
  username: string;
  friendship_id: string;
}

export const friendsApi = {
  list: (token: string) => apiCall<Friend[]>('GET', '/friends', undefined, token),

  requests: (token: string) =>
    apiCall<FriendRequest[]>('GET', '/friends/requests', undefined, token),

  sendRequest: (targetId: string, token: string) =>
    apiCall<{ message: string }>('POST', '/friends/request', { targetId }, token),

  accept: (requesterId: string, token: string) =>
    apiCall<{ message: string }>('POST', '/friends/accept', { requesterId }, token),

  decline: (requesterId: string, token: string) =>
    apiCall<{ message: string }>('POST', '/friends/decline', { requesterId }, token),

  remove: (friendId: string, token: string) =>
    apiCall<{ message: string }>('DELETE', `/friends/${friendId}`, undefined, token),
};

// ─── Games ────────────────────────────────────────────────────────────────────

export interface SaveGamePayload {
  mode: string;
  variant: string;
  playerCount: number;
  targetScore: number;
  difficulty?: string;
  players: Array<{
    userId: string | null;
    guestName: string | null;
    score: number | null;
    won: boolean | null;
  }>;
}

export const gamesApi = {
  save: (payload: SaveGamePayload, token: string) =>
    apiCall<{ id: string }>('POST', '/games', payload, token),
};

// ─── Présence ─────────────────────────────────────────────────────────────────

export const onlineApi = {
  // Compteurs publics de joueurs en ligne (#43) — pour les visiteurs sans
  // connexion WebSocket ; les connectés reçoivent les mêmes chiffres en push.
  get: () =>
    apiCall<{ online: number; inQueue: number; inGame: number }>('GET', '/online'),

  // Ticket éphémère pour ouvrir le WebSocket sans mettre le JWT dans l'URL
  // (#120). À redemander à chaque (re)connexion.
  wsTicket: (token: string) =>
    apiCall<{ ticket: string }>('POST', '/online/ws-ticket', undefined, token),
};
