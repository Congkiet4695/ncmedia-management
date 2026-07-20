import Cookies from 'js-cookie';
import type { AuthTokens } from '@/features/auth/types';

/**
 * Lưu/đọc/xoá token qua cookie (js-cookie).
 * - Access Token: TTL theo `expiresIn` (giây) — 15' (ADR-006).
 * - Refresh Token: TTL 7 ngày (ADR-006).
 * Không dùng plaintext ngoài phạm vi cookie phía client (backend là nguồn quyết định).
 */
export const ACCESS_TOKEN_COOKIE = 'ncmedia_access_token';
export const REFRESH_TOKEN_COOKIE = 'ncmedia_refresh_token';

const REFRESH_TOKEN_DAYS = 7;

const baseOptions: Cookies.CookieAttributes = {
  sameSite: 'lax',
  // Gắn cờ `Secure` theo GIAO THỨC trang thực tế, KHÔNG theo NODE_ENV.
  // Lý do: bản build production luôn có NODE_ENV='production' → trước đây secure=true cứng;
  // khi trang production phục vụ qua HTTP thì trình duyệt ÂM THẦM loại bỏ cookie Secure
  // → token không lưu được → /auth/me thiếu Authorization → AUTH_TOKEN_INVALID.
  // Dùng protocol: HTTPS → Secure (an toàn); HTTP (local dev / prod chưa bật TLS) → cookie vẫn lưu được.
  secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
  path: '/',
};

export function getAccessToken(): string | undefined {
  return Cookies.get(ACCESS_TOKEN_COOKIE);
}

export function getRefreshToken(): string | undefined {
  return Cookies.get(REFRESH_TOKEN_COOKIE);
}

export function setAuthCookies(tokens: AuthTokens): void {
  const accessExpires = new Date(Date.now() + tokens.expiresIn * 1000);
  Cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, { ...baseOptions, expires: accessExpires });
  Cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseOptions,
    expires: REFRESH_TOKEN_DAYS,
  });
}

export function clearAuthCookies(): void {
  Cookies.remove(ACCESS_TOKEN_COOKIE, { path: '/' });
  Cookies.remove(REFRESH_TOKEN_COOKIE, { path: '/' });
}
