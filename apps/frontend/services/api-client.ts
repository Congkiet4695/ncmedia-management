import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { env } from '@/lib/env';
import { getAccessToken, getRefreshToken } from '@/lib/auth-cookies';
import { useAuthStore } from '@/stores/auth.store';
import { refreshAccessToken } from './token-refresh';

/**
 * HTTP client dùng chung (Axios).
 *
 * - Request interceptor: đính Access Token (cookie) vào mọi request.
 * - Response interceptor: 401 → **thử gia hạn phiên trước**, chỉ đăng xuất khi refresh hỏng.
 *
 * 🔴 Hành vi cũ — 401 là `clearSession()` + `location.assign('/login')` ngay lập tức — chính
 * là nửa còn lại của lỗi "tự nhiên bị đăng xuất". Access token sống 15 phút, nên cứ 15 phút
 * làm việc là một lần bị đá ra, dù refresh token trong tay còn hạn 7 ngày. Access token hết
 * hạn là chuyện BÌNH THƯỜNG, không phải sự cố phiên.
 */

/** Cờ đánh dấu request đã thử lại sau refresh — chặn vòng lặp 401 → refresh → 401 vô hạn. */
type RetriableConfig = InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean };

/**
 * Endpoint auth công khai: 401 ở đây là "sai thông tin đăng nhập" hoặc "phiên đã kết thúc",
 * do form / `token-refresh` xử lý — KHÔNG refresh, KHÔNG redirect.
 */
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

function attachAuthToken(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(attachAuthToken);

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const config = error.config as RetriableConfig | undefined;
    const url = config?.url ?? '';

    const shouldTryRefresh =
      status === 401 &&
      typeof window !== 'undefined' &&
      config != null &&
      !config._retriedAfterRefresh &&
      !PUBLIC_AUTH_PATHS.some((path) => url.includes(path));

    if (!shouldTryRefresh) return Promise.reject(error);

    // Không có refresh token ⇒ không có gì để gia hạn; đây mới là phiên đã kết thúc thật.
    if (!getRefreshToken()) {
      endSession();
      return Promise.reject(error);
    }

    // Mọi request 401 song song cùng chờ MỘT lần refresh (xem `token-refresh.ts`).
    const accessToken = await refreshAccessToken();
    if (!accessToken) {
      endSession();
      return Promise.reject(error);
    }

    // Phát lại đúng request ban đầu với token mới — người dùng không thấy gì bất thường.
    config._retriedAfterRefresh = true;
    config.headers.set('Authorization', `Bearer ${accessToken}`);
    return apiClient(config);
  },
);

/**
 * Kết thúc phiên: xoá state + cookie rồi đưa về `/login`.
 *
 * Chỉ được gọi khi refresh đã thất bại — tức refresh token hết hạn / bị thu hồi, tài khoản
 * bị vô hiệu hoá, hoặc Organization không còn hoạt động.
 */
function endSession(): void {
  useAuthStore.getState().clearSession();
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

export default apiClient;
