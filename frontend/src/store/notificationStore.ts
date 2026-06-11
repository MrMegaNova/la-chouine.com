import { create } from 'zustand';
import { friendsApi } from '@/api/client';

// ─── Notifications (#44) ──────────────────────────────────────────────────────
// Badge persistant (nombre d'invitations ami en attente, source REST) + toast
// éphémère alimenté par les notifications temps réel du socket de présence.
// Premier `kind` : friendRequest — format extensible (défis entre amis #45…).

interface NotificationState {
  pendingRequests: number;
  toast: string | null;

  /** Recharge le compteur d'invitations depuis l'API (filet hors-ligne). */
  refresh: (token: string | null) => Promise<void>;
  /** Notification temps réel : invitation ami reçue. */
  onFriendRequest: (from: string) => void;
  showToast: (msg: string) => void;
  clearToast: () => void;
  reset: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  pendingRequests: 0,
  toast: null,

  refresh: async (token) => {
    if (!token) return;
    const { ok, data } = await friendsApi.requests(token);
    if (ok) set({ pendingRequests: data.length });
  },

  onFriendRequest: (from) => {
    set(s => ({
      pendingRequests: s.pendingRequests + 1,
      toast: `🤝 ${from} vous a envoyé une invitation ami.`,
    }));
  },

  showToast: (msg) => set({ toast: msg }),
  clearToast: () => set({ toast: null }),
  reset: () => set({ pendingRequests: 0, toast: null }),
}));
