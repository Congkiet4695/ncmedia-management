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
  secure: process.env.NODE_ENV === 'production',
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
