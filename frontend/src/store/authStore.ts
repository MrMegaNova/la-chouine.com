import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi, usersApi, type MeResponse } from '@/api/client';

interface AuthState {
  token: string | null;
  user: MeResponse | null;
  loading: boolean;

  login: (username: string, password: string) => Promise<string | null>;
  register: (username: string, email: string, password: string, website?: string) => Promise<string | null>;
  logout: () => void;
  restoreSession: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      loading: false,

      login: async (username, password) => {
        const { ok, data } = await authApi.login(username, password);
        if (!ok) return (data as { error?: string }).error ?? 'Erreur.';
        set({ token: data.token, user: { id: data.id, username: data.username, email: '', joined: '', stats: { wins: 0, losses: 0, plays: 0 }, ratings: { classic: 1500, mondoubleau: 1500 } } });
        await get().refreshUser();
        return null;
      },

      register: async (username, email, password, website) => {
        const { ok, data } = await authApi.register({ username, email, password, website });
        if (!ok) {
          const errs = (data as { errors?: string[]; error?: string });
          return (errs.errors ?? [errs.error ?? 'Erreur.']).join(' ');
        }
        return null;
      },

      logout: () => set({ token: null, user: null }),

      restoreSession: async () => {
        const { token } = get();
        if (!token) return;
        set({ loading: true });
        const { ok, data } = await usersApi.me(token);
        if (ok) {
          set({ user: data, loading: false });
        } else {
          set({ token: null, user: null, loading: false });
        }
      },

      refreshUser: async () => {
        const { token } = get();
        if (!token) return;
        const { ok, data } = await usersApi.me(token);
        if (ok) set({ user: data });
      },
    }),
    {
      name: 'chouine-auth',
      partialize: state => ({ token: state.token }),
    }
  )
);
