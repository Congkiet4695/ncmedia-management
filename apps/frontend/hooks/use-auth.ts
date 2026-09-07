'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { revokeSession } from '@/services/token-refresh';
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

  /**
   * Đăng xuất — thu hồi phiên ở SERVER trước, rồi mới dọn phía client.
   *
   * 🔴 Chỉ xoá cookie là chưa đăng xuất: refresh token vẫn còn hiệu lực trong
   * `refresh_tokens` thêm 7 ngày và ai cầm được nó vẫn phát ra access token mới. `/auth/logout`
   * là nơi duy nhất thu hồi thật.
   */
  const logout = useCallback(async () => {
    await revokeSession();
    clearSession();
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    router.replace('/login');
  }, [clearSession, queryClient, router]);

  return { user, organization, role, permissions, loading, isAuthenticated, hasPermission, logout };
}
