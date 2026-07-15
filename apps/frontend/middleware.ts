import { NextResponse } from 'next/server';

/**
 * Next.js Middleware — khung sẵn sàng (passthrough).
 *
 * Ở giai đoạn bootstrap, middleware KHÔNG chứa logic auth/route-guard
 * (thuộc feature Authentication — chưa implement). Khi tích hợp Auth sau này,
 * đây là nơi kiểm tra Access Token (cookie) và redirect route được bảo vệ.
 */
export function middleware() {
  return NextResponse.next();
}

/**
 * Matcher: chạy trên mọi route trừ static asset & file hệ thống của Next.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
