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
  // Code du lien d'invitation (#295), ignoré par le serveur s'il est invalide.
  invitationCode?: string;
}
export interface LoginResponse {
  token: string;
  id: string;
  username: string;
}
export interface Achievement {
  code: string;
  unlockedAt: string;
  verified: boolean; // false : repose sur des parties locales déclarées (#279)
}
interface GameTally {
  wins: number;
  losses: number;
  plays: number;
}
// Résultats établis par le serveur (parties en ligne) ; `local` regroupe les
// résultats déclarés par le navigateur, jamais additionnés aux premiers (#279).
export interface PlayerStats extends GameTally {
  local: GameTally;
}
export interface MeResponse {
  id: string;
  username: string;
  email: string;
  joined: string;
  avatar: string | null;
  stats: PlayerStats;
  ratings: { classic: number; mondoubleau: number };
  achievements: Achievement[]; // badges débloqués (#217)
  isAdmin?: boolean;           // accès au tableau de bord (#311)
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

// Profil public d'un autre joueur (#85) : pas d'email ni de donnée privée.
export interface PublicProfile {
  id: string;
  username: string;
  avatar: string | null;
  stats: PlayerStats;
  ratings: { classic: number; mondoubleau: number };
  achievements: Achievement[]; // badges débloqués (#217)
}

export const invitationsApi = {
  resolve: (code: string) =>
    apiCall<{ username: string }>('GET', `/invitations/${encodeURIComponent(code)}`),
};

export const usersApi = {
  invitation: (token: string) =>
    apiCall<{ url: string; invitedCount: number }>('GET', '/users/me/invitation', undefined, token),

  me: (token: string) => apiCall<MeResponse>('GET', '/users/me', undefined, token),

  publicProfile: (id: string, token: string) =>
    apiCall<PublicProfile & { error?: string }>(
      'GET', `/users/${encodeURIComponent(id)}`, undefined, token),

  search: (q: string, token: string) =>
    apiCall<SearchUser[]>('GET', `/users/search?q=${encodeURIComponent(q)}`, undefined, token),

  history: (token: string) =>
    apiCall<HistoryEntry[]>('GET', '/users/history', undefined, token),

  // Le serveur réémet un token frais : le changement révoque tous les JWT
  // antérieurs (#117), y compris celui de la session courante.
  changePassword: (currentPassword: string, newPassword: string, token: string) =>
    apiCall<{ message: string; token?: string; error?: string }>(
      'POST', '/users/me/password', { currentPassword, newPassword }, token),

  // Suppression définitive du compte (#238).
  deleteAccount: (currentPassword: string, token: string) =>
    apiCall<{ message?: string; error?: string }>('DELETE', '/users/me', { currentPassword }, token),

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

  sendInvitationRequest: (inviteCode: string, token: string) =>
    apiCall<{ message: string }>('POST', '/friends/request', { inviteCode }, token),

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
  durationSec?: number; // temps de jeu, pour les statistiques (#311)
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

// ─── Mesure d'audience et tableau de bord (#311) ─────────────────────────────

export const visitsApi = {
  track: (payload: { path: string; referrer?: string; source?: string }, token?: string | null) =>
    apiCall<Record<string, never>>('POST', '/visits', payload, token),
};

export interface Ranked { label: string; visits: number; visitors: number }

export interface DashboardDay {
  day: string;
  signups: number;
  totalUsers: number;
  activePlayers: number;
  games: { online: number; ai: number; other: number };
  playMinutes: number;
}

export interface RecentVisit {
  at: string;
  path: string;
  device: 'mobile' | 'tablet' | 'desktop';
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  referrer: string | null;
  source: string | null;
  username: string | null;
}

export interface Dashboard {
  days: number;
  generatedAt: string;
  ipRetentionDays: number;
  geoSource: string | null;
  server: { version: string; commit: string | null; startedAt: string };
  live: { online: number; inQueue: number; inGame: number } | null;
  players: { total: number; verified: number; active1d: number; active7d: number; active30d: number };
  daily: DashboardDay[];
  playTime: { timedGames: number; totalMinutes: number; averageMinutes: number | null };
  visits: {
    totals: { visits: number; visitor_days: number };
    byDay: Array<{ day: string; visits: number; visitors: number }>;
    countries: Ranked[];
    cities: Ranked[];
    pages: Ranked[];
    referrers: Ranked[];
    devices: Ranked[];
    campaigns: Array<Ranked & { signups: number }>;
    recent: RecentVisit[];
  };
}

export const adminApi = {
  dashboard: (days: number, token: string) =>
    apiCall<Dashboard & { error?: string }>('GET', `/admin/dashboard?days=${days}`, undefined, token),
};
