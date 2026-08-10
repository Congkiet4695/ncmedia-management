'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { clearAuthCookies, setAuthCookies } from '@/lib/auth-cookies';
import { useAuthStore } from '@/stores/auth.store';
import { authService } from '../services/auth.service';
import { ME_QUERY_KEY } from './use-me';
import type { RegisterInput } from '../schemas/auth.schema';
import type { MeProfile } from '../types';

/**
 * useRegister — luồng bắt buộc: POST /register → Save Token → GET /me → Save Session → Redirect.
 * Lỗi field/nghiệp vụ (AUTH_EMAIL_EXISTS...) do RegisterForm xử lý.
 */
export function useRegister() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation<MeProfile, unknown, RegisterInput>({
    mutationFn: async (input) => {
      const data = await authService.register(input); // POST /register
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
      toast.success(i18n.t('auth:register.success'), {
        description: i18n.t('auth:register.welcome', { name: profile.fullName }),
      });
      router.replace('/dashboard'); // Redirect Dashboard
    },
  });
}
