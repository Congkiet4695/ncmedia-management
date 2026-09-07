import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js Middleware — Route Guard dựa trên sự hiện diện **Refresh Token** (cookie).
 *
 * - Route bảo vệ (/dashboard/*) mà KHÔNG có phiên → redirect /login (kèm ?redirect=).
 * - Đang có phiên mà vào /login|/register → redirect /dashboard.
 *
 * 🔴 Cổng này soi REFRESH token chứ không phải access token, và đó là điểm sửa: access
 * token chỉ sống 15 phút, nên lấy nó làm bằng chứng "còn đăng nhập" nghĩa là mỗi lần điều
 * hướng sau 15 phút đều bị đá về `/login` — kể cả khi phiên còn hạn tới 7 ngày và chỉ cần
 * một lần gọi `/auth/refresh`. Refresh token mới là thứ đại diện cho PHIÊN.
 *
 * Chỉ kiểm tra sự tồn tại cookie (không verify chữ ký ở edge). Tính hợp lệ thực sự do
 * GET /auth/me + POST /auth/refresh phía client xác nhận (AuthProvider / apiClient).
 */

// Tên cookie khớp lib/auth-cookies.ts — khai báo lại để tránh bundle js-cookie vào edge runtime.
const REFRESH_TOKEN_COOKIE = 'ncmedia_refresh_token';
const PROTECTED_PREFIXES = ['/dashboard'];
const AUTH_ROUTES = ['/login', '/register'];

export function middleware(request: NextRequest) {
  const session = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !session) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  if (AUTH_ROUTES.includes(pathname) && session) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/register'],
};
