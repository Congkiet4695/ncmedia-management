'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { ME_QUERY_KEY } from '@/features/auth/hooks/use-me';

/**
 * useAuth — truy cập phiên đăng nhập + kiểm tra permission + logout (client-side).
 *
 * Expose: user, organization, role, permissions, loading, isAuthenticated, hasPermission(), logout().
 * `hasPermission(code)` dùng để render UI/sidebar theo quyền (KHÔNG hardcode role).
 */
export function useAuth() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const user = useAuthStore((s) => s.user);
  const organization = useAuthStore((s) => s.organization);
  const role = useAuthStore((s) => s.role);
  const permissions = useAuthStore((s) => s.permissions);
  const loading = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const clearSession = useAuthStore((s) => s.clearSession);

  const hasPermission = useCallback(
    (code: string) => permissions.includes(code),
    [permissions],
  );

  const logout = useCallback(() => {
    clearSession();
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    router.replace('/login');
  }, [clearSession, queryClient, router]);

  return { user, organization, role, permissions, loading, isAuthenticated, hasPermission, logout };
}
