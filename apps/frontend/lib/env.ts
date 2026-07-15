/**
 * Truy cập biến môi trường tập trung (typed).
 * Chỉ dùng biến NEXT_PUBLIC_* ở client. Có fallback để build/dev không cần .env.
 */
export const env = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1',
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'NCMedia Management Platform',
} as const;

export type Env = typeof env;
