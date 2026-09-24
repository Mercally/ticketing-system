import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MeResponse } from '../types/api';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export type AuthUser = MeResponse;

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  /** Sets tokens and the authenticated user together (end of the login flow). */
  login: (tokens: TokenPair, user: AuthUser) => void;
  /** Updates only the tokens (used after a silent refresh, or mid-login before /me resolves). */
  setTokens: (tokens: TokenPair) => void;
  setUser: (user: AuthUser) => void;
  logout: () => void;
}

// Client session state — a legitimate Zustand use per the project's own guidance
// (auth session state is explicitly called out as an appropriate global-state case).
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      login: (tokens, user) =>
        set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user }),
      setTokens: (tokens) =>
        set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
      setUser: (user) => set({ user }),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'auth-storage' },
  ),
);
