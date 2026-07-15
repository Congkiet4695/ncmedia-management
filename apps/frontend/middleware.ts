import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js Middleware — Route Guard dựa trên sự hiện diện Access Token (cookie).
 *
 * - Route bảo vệ (/dashboard/*) mà KHÔNG có token → redirect /login (kèm ?redirect=).
 * - Đang có token mà vào /login|/register → redirect /dashboard.
 *
 * Chỉ kiểm tra sự tồn tại cookie (không verify chữ ký ở edge). Tính hợp lệ thực sự do
 * GET /auth/me phía client xác nhận (AuthProvider). Access token hết hạn thì cookie cũng
 * đã hết hạn (TTL = expiresIn), nên coi như không có token.
 */

// Tên cookie khớp lib/auth-cookies.ts — khai báo lại để tránh bundle js-cookie vào edge runtime.
const ACCESS_TOKEN_COOKIE = 'ncmedia_access_token';
const PROTECTED_PREFIXES = ['/dashboard'];
const AUTH_ROUTES = ['/login', '/register'];

export function middleware(request: NextRequest) {
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !token) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  if (AUTH_ROUTES.includes(pathname) && token) {
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
