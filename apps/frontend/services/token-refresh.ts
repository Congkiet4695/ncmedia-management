import axios from 'axios';
import { env } from '@/lib/env';
import {
  clearAuthCookies,
  getRefreshToken,
  setAuthCookies,
} from '@/lib/auth-cookies';
import type { AuthTokens } from '@/features/auth/types';
import type { ApiResponse } from '@/types/api';

/**
 * Gia hạn Access Token — **single-flight**.
 *
 * 🔴 Bài toán: một màn hình dashboard bắn 5–10 request song song. Khi access token hết hạn,
 * TẤT CẢ cùng nhận 401 trong cùng một khoảnh khắc. Nếu mỗi request tự gọi `/auth/refresh`
 * thì có 5–10 lần refresh chạy đua nhau, mỗi lần xoay vòng lại vô hiệu hoá refresh token
 * mà lần kia vừa dùng — kết quả là đăng xuất, đúng thứ mà refresh sinh ra để tránh.
 *
 * Giải pháp ở đây là một biến `inFlight` cấp module: request đầu tiên tạo promise refresh,
 * mọi request sau **chờ chính promise đó**. Một lần gọi mạng, một lần xoay vòng, mọi
 * request cùng nhận một access token mới.
 *
 *   A → 401 → gọi /auth/refresh ┐
 *   B → 401 → chờ              │
 *   C → 401 → chờ              ├─ cùng một promise
 *   D → 401 → chờ              │
 *   E → 401 → chờ              ┘
 *
 * Backend còn một hàng rào thứ hai (xoay vòng atomic + cửa sổ ân hạn — `RefreshService`)
 * cho các race mà client không thể chặn: nhiều tab, nhiều thiết bị.
 */

/**
 * Client RIÊNG, KHÔNG interceptor.
 *
 * 🔴 Bắt buộc phải tách khỏi `apiClient`: nếu `/auth/refresh` đi qua interceptor 401 của
 * `apiClient` thì một lần refresh hỏng sẽ kích hoạt… thêm một lần refresh, đệ quy vô hạn.
 */
const refreshClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

let inFlight: Promise<string | null> | null = null;

/**
 * Trả về Access Token mới, hoặc `null` khi phiên thực sự đã kết thúc.
 *
 * `null` là tín hiệu DUY NHẤT hợp lệ để đăng xuất người dùng.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!inFlight) {
    inFlight = runRefresh().finally(() => {
      // Nhả chốt để lần hết hạn SAU (15 phút nữa) lại refresh được.
      inFlight = null;
    });
  }
  return inFlight;
}

async function runRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  // Không có refresh token ⇒ không có phiên nào để gia hạn. Không gọi mạng vô ích.
  if (!refreshToken) return null;

  try {
    const res = await refreshClient.post<ApiResponse<AuthTokens>>('/auth/refresh', {
      refreshToken,
    });
    const tokens = res.data.data;
    if (!tokens?.accessToken) return null;

    // Ghi cả CẶP token: backend xoay vòng nên refresh token cũ vừa bị thu hồi.
    setAuthCookies(tokens);
    return tokens.accessToken;
  } catch {
    // 401 ở đây = refresh token hỏng/hết hạn/bị thu hồi ⇒ phiên kết thúc thật.
    // Lỗi mạng cũng rơi vào đây; giữ nguyên hành vi thận trọng là đăng xuất, vì để
    // người dùng ở lại với token chết chỉ tạo ra một màn hình lỗi không lối thoát.
    clearAuthCookies();
    return null;
  }
}

/** Thu hồi phiên phía server. Best-effort — cookie phía client bị xoá dù kết quả thế nào. */
export async function revokeSession(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return;
  try {
    await refreshClient.post('/auth/logout', { refreshToken });
  } catch {
    // Đăng xuất không được phép thất bại vì lý do mạng.
  }
}
