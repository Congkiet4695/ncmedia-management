import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { env } from '@/lib/env';
import { getAccessToken } from '@/lib/auth-cookies';

/**
 * HTTP client dùng chung (Axios).
 * Tạo instance + interceptor đính Access Token (đọc từ cookie) vào mọi request.
 * Logic Login/Register nằm ở tầng feature `features/auth`.
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

export default apiClient;
