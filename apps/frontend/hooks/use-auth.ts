'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { ME_QUERY_KEY } from '@/features/auth/hooks/use-me';

/**
 * useAuth — truy cập phiên đăng nhập + hành động logout (client-side).
 *
 * Expose: user, organization, role, loading, isAuthenticated, logout().
 * `logout()` chỉ xóa phiên phía client + redirect /login (CHƯA có Logout API — ngoài phạm vi).
 */
export function useAuth() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const user = useAuthStore((s) => s.user);
  const organization = useAuthStore((s) => s.organization);
  const role = useAuthStore((s) => s.role);
  const loading = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const clearSession = useAuthStore((s) => s.clearSession);

  const logout = useCallback(() => {
    clearSession();
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    router.replace('/login');
  }, [clearSession, queryClient, router]);

  return { user, organization, role, loading, isAuthenticated, logout };
}
