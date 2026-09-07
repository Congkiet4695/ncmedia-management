'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { hasSession } from '@/lib/auth-cookies';
import { useMounted } from '@/hooks/use-mounted';
import { useAuthStore } from '@/stores/auth.store';
import { useMe } from '@/features/auth/hooks/use-me';

const AUTH_ROUTES = ['/login', '/register'];

/**
 * AuthProvider — khởi tạo phiên khi app start.
 *
 * Flow: App Start → có PHIÊN (refresh token)? → GET /me → lưu Zustand → render App.
 *       /me hỏng SAU KHI apiClient đã thử gia hạn → clearSession() → redirect /login.
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

  // 🔴 Căn cứ là REFRESH token, không phải access token: access token hết hạn sau 15 phút
  // là chuyện bình thường và `apiClient` tự gia hạn khi /me trả 401. Lấy access token làm
  // điều kiện gọi /me nghĩa là mở lại trang sau 15 phút sẽ bị coi như chưa đăng nhập.
  const sessionAlive = mounted ? hasSession() : false;
  const meQuery = useMe(sessionAlive);

  // Không có phiên → dừng loading, không gọi /me.
  useEffect(() => {
    if (mounted && !sessionAlive) clearSession();
  }, [mounted, sessionAlive, clearSession]);

  // /me thành công → lưu phiên vào Zustand.
  useEffect(() => {
    if (meQuery.isSuccess && meQuery.data) setSession(meQuery.data);
  }, [meQuery.isSuccess, meQuery.data, setSession]);

  // /me lỗi → xóa phiên + về /login.
  //
  // 🔴 Tới được đây nghĩa là `apiClient` ĐÃ thử gia hạn và thất bại: 401 do access token
  // hết hạn được interceptor nuốt và phát lại request, không bao giờ nổi lên thành
  // `meQuery.isError`. Nên lỗi ở đây là phiên hỏng thật, đăng xuất là đúng.
  useEffect(() => {
    if (meQuery.isError) {
      clearSession();
      if (!AUTH_ROUTES.includes(pathname)) router.replace('/login');
    }
  }, [meQuery.isError, clearSession, router, pathname]);

  // Đang giải quyết phiên: chưa mount, hoặc đang fetch /me lần đầu.
  const resolving = !mounted || (sessionAlive && meQuery.isLoading);

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
