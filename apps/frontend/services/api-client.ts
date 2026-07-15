import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { env } from '@/lib/env';
import { getAccessToken } from '@/lib/auth-cookies';
import { useAuthStore } from '@/stores/auth.store';

/**
 * HTTP client dùng chung (Axios).
 * - Request interceptor: đính Access Token (cookie) vào mọi request.
 * - Response interceptor: 401 → clearSession() → redirect /login (trừ các endpoint auth công khai).
 */
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
  (error: AxiosError) => {
    const status = error.response?.status;
    const url = error.config?.url ?? '';
    // Bỏ qua endpoint auth công khai: 401 ở đây là "sai thông tin đăng nhập",
    // do form xử lý — KHÔNG redirect / clearSession.
    const isPublicAuth = url.includes('/auth/login') || url.includes('/auth/register');

    if (status === 401 && !isPublicAuth && typeof window !== 'undefined') {
      useAuthStore.getState().clearSession(); // xóa cookie + state
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
