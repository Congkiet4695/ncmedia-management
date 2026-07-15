import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clearAuthCookies, setAuthCookies } from '@/lib/auth-cookies';
import type { AuthOrganization, AuthUser, SessionPayload } from '@/features/auth/types';

/**
 * auth.store — trạng thái phiên đăng nhập.
 * - user/organization/isAuthenticated: persist vào localStorage (hiển thị lại sau reload).
 * - Token: lưu ở cookie (không đưa vào state persist).
 */
interface AuthState {
  user: AuthUser | null;
  organization: AuthOrganization | null;
  isAuthenticated: boolean;
  setSession: (payload: SessionPayload) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      organization: null,
      isAuthenticated: false,

      setSession: ({ user, organization, tokens }) => {
        setAuthCookies(tokens);
        set({ user, organization: organization ?? null, isAuthenticated: true });
      },

      clearSession: () => {
        clearAuthCookies();
        set({ user: null, organization: null, isAuthenticated: false });
      },
    }),
    {
      name: 'ncmedia-auth',
      partialize: (state) => ({
        user: state.user,
        organization: state.organization,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
