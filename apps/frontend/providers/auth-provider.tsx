'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getAccessToken } from '@/lib/auth-cookies';
import { useMounted } from '@/hooks/use-mounted';
import { useAuthStore } from '@/stores/auth.store';
import { useMe } from '@/features/auth/hooks/use-me';

const AUTH_ROUTES = ['/login', '/register'];

/**
 * AuthProvider — khởi tạo phiên khi app start.
 *
 * Flow: App Start → có Access Token? → GET /me → lưu Zustand → render App.
 *       Lỗi /me → clearSession() → redirect /login.
 *
 * Hiển thị Loading Screen cho tới khi /me hoàn tất (yêu cầu).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const router = useRouter();
  const pathname = usePathname();

  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const setLoading = useAuthStore((s) => s.setLoading);

  const token = mounted ? getAccessToken() : undefined;
  const hasToken = Boolean(token);
  const meQuery = useMe(hasToken);

  // Không có token → không có phiên (dừng loading).
  useEffect(() => {
    if (mounted && !hasToken) clearSession();
  }, [mounted, hasToken, clearSession]);

  // /me thành công → lưu phiên vào Zustand.
  useEffect(() => {
    if (meQuery.isSuccess && meQuery.data) setSession(meQuery.data);
  }, [meQuery.isSuccess, meQuery.data, setSession]);

  // /me lỗi (401/expired) → xóa phiên + về /login.
  useEffect(() => {
    if (meQuery.isError) {
      clearSession();
      if (!AUTH_ROUTES.includes(pathname)) router.replace('/login');
    }
  }, [meQuery.isError, clearSession, router, pathname]);

  // Đang giải quyết phiên: chưa mount, hoặc đang fetch /me lần đầu.
  const resolving = !mounted || (hasToken && meQuery.isLoading);

  // Đồng bộ cờ loading cho các consumer (useAuth).
  useEffect(() => {
    setLoading(resolving);
  }, [resolving, setLoading]);

  if (resolving) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Đang tải phiên đăng nhập…</span>
      </div>
    );
  }

  return <>{children}</>;
}
