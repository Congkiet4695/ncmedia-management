'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { clearAuthCookies, setAuthCookies } from '@/lib/auth-cookies';
import { useAuthStore } from '@/stores/auth.store';
import { authService } from '../services/auth.service';
import { ME_QUERY_KEY } from './use-me';
import type { LoginInput } from '../schemas/auth.schema';
import type { MeProfile } from '../types';

/**
 * useLogin — luồng bắt buộc (login.md): POST /login → Save Token → GET /me → Save Session → Redirect.
 * KHÔNG redirect ngay sau /login; chỉ redirect sau khi /me thành công.
 * Lỗi (401 trung tính / validate) do LoginForm xử lý.
 */
export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation<MeProfile, unknown, LoginInput>({
    mutationFn: async (input) => {
      const data = await authService.login(input); // POST /login
      setAuthCookies(data.tokens); // Save Token
      try {
        return await authService.getMe(); // GET /me
      } catch (err) {
        clearAuthCookies(); // rollback token nếu /me lỗi
        throw err;
      }
    },
    onSuccess: (profile) => {
      setSession(profile); // Save Session
      queryClient.setQueryData(ME_QUERY_KEY, profile);
      toast.success(i18n.t('auth:login.success'), {
        description: i18n.t('auth:login.welcome', { name: profile.fullName }),
      });
      router.replace('/dashboard'); // Redirect Dashboard
    },
  });
}
