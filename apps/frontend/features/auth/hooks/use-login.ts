'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth.store';
import { authService } from '../services/auth.service';
import type { LoginInput } from '../schemas/auth.schema';

/**
 * useLogin — đăng nhập bằng email + password.
 * Thành công: lưu token + phiên, toast, redirect /dashboard.
 * Lỗi (401 trung tính / validate) do form xử lý.
 */
export function useLogin() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: (input: LoginInput) => authService.login(input),
    onSuccess: (data) => {
      setSession({ user: data.user, organization: data.organization, tokens: data.tokens });
      toast.success('Đăng nhập thành công', {
        description: `Xin chào ${data.user.fullName}`,
      });
      router.replace('/dashboard');
    },
  });
}
