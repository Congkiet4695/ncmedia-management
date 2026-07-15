'use client';

import { useQuery } from '@tanstack/react-query';
import { authService } from '../services/auth.service';
import type { MeProfile } from '../types';

/** Query key cho hồ sơ /me. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * useMe — lấy hồ sơ người dùng hiện tại qua React Query.
 * - Cache key: `auth/me`.
 * - `retry: false` (yêu cầu): 401 → không thử lại, để AuthProvider/interceptor xử lý.
 * - `enabled`: chỉ chạy khi có Access Token (AuthProvider truyền vào).
 */
export function useMe(enabled: boolean) {
  return useQuery<MeProfile>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => authService.getMe(),
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
