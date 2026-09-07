import Cookies from 'js-cookie';
import type { AuthTokens } from '@/features/auth/types';

/**
 * Lưu/đọc/xoá token qua cookie (js-cookie).
 *
 * 🔴 **Access token cookie KHÔNG hết hạn cùng lúc với access token.**
 *
 * Trước đây cookie được đặt `expires = expiresIn` (15 phút). Hệ quả: đúng 15 phút sau khi
 * đăng nhập, trình duyệt tự xoá cookie ⇒ `middleware.ts` không thấy token ⇒ đá thẳng về
 * `/login` ngay giữa lúc người dùng đang làm việc, và frontend không còn gì trong tay để
 * thử refresh. Cookie tự huỷ chính là cơ chế đăng xuất — không phải một biện pháp bảo mật:
 * hạn dùng thật của access token nằm trong `exp` của JWT và do backend kiểm tra.
 *
 * Vì vậy cả hai cookie đều sống theo **vòng đời của phiên** (= hạn refresh token). Access
 * token hết hạn thì `apiClient` gọi `/auth/refresh` và ghi đè cookie bằng token mới.
 */
export const ACCESS_TOKEN_COOKIE = 'ncmedia_access_token';
export const REFRESH_TOKEN_COOKIE = 'ncmedia_refresh_token';

/** Vòng đời phiên (ngày) — phải KHỚP `JWT_REFRESH_TTL` của backend (mặc định 7d). */
const SESSION_DAYS = 7;

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

/** Có phiên hay không = có refresh token hay không. Access token chỉ là vé vào từng request. */
export function hasSession(): boolean {
  return Boolean(getRefreshToken());
}

export function setAuthCookies(tokens: AuthTokens): void {
  Cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...baseOptions,
    expires: SESSION_DAYS,
  });
  Cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseOptions,
    expires: SESSION_DAYS,
  });
}

export function clearAuthCookies(): void {
  Cookies.remove(ACCESS_TOKEN_COOKIE, { path: '/' });
  Cookies.remove(REFRESH_TOKEN_COOKIE, { path: '/' });
}
