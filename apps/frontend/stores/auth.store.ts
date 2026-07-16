import { create } from 'zustand';
import { clearAuthCookies } from '@/lib/auth-cookies';
import type { MeOrganization, MeProfile, MeRole, MeUser } from '@/features/auth/types';

/**
 * auth.store — trạng thái phiên đăng nhập (nguồn: GET /auth/me).
 *
 * - Không persist: phiên được thiết lập lại mỗi lần khởi động app qua AuthProvider (gọi /me).
 * - Token lưu ở cookie (lib/auth-cookies), KHÔNG nằm trong store.
 * - `isLoading` bắt đầu `true` cho tới khi AuthProvider hoàn tất /me.
 */
interface AuthState {
  user: MeUser | null;
  organization: MeOrganization | null;
  role: MeRole | null;
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;

  setSession: (profile: MeProfile) => void;
  clearSession: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  organization: null,
  role: null,
  permissions: [],
  isAuthenticated: false,
  isLoading: true,

  setSession: (profile) =>
    set({
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        avatar: profile.avatar,
        dateOfBirth: profile.dateOfBirth,
      },
      organization: profile.organization,
      role: profile.role,
      permissions: profile.permissions ?? [],
      isAuthenticated: true,
      isLoading: false,
    }),

  clearSession: () => {
    clearAuthCookies();
    set({
      user: null,
      organization: null,
      role: null,
      permissions: [],
      isAuthenticated: false,
      isLoading: false,
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),
}));
