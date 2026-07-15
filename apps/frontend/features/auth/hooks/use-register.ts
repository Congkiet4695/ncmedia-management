'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth.store';
import { authService } from '../services/auth.service';
import type { RegisterInput } from '../schemas/auth.schema';

/**
 * useRegister — đăng ký Organization + Admin đầu tiên.
 * Thành công: lưu Access/Refresh Token + thông tin phiên, toast, redirect /dashboard.
 * Lỗi field/nghiệp vụ do form xử lý (inline) — xem RegisterForm.
 */
export function useRegister() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: (input: RegisterInput) => authService.register(input),
    onSuccess: (data) => {
      setSession({ user: data.user, organization: data.organization, tokens: data.tokens });
      toast.success('Đăng ký thành công', {
        description: `Chào mừng ${data.user.fullName}`,
      });
      router.replace('/dashboard');
    },
  });
}
