'use client';

import { useMutation } from '@tanstack/react-query';
import { authService } from '../services/auth.service';
import type { RegisterInput } from '../schemas/auth.schema';
import type { RegisterResponse } from '../types';

/**
 * useRegister — POST /auth/register, **dừng lại ở đó**.
 *
 * 🔴 Không còn lưu token, không gọi `/me`, không chuyển vào Dashboard. Organization mới tạo ở
 * trạng thái PENDING nên `/me` sẽ trả 403 và người dùng nhận một lỗi khó hiểu ngay sau khi
 * đăng ký thành công. Màn hình đăng ký tự chuyển sang trạng thái "đã gửi, chờ duyệt".
 *
 * Lỗi field/nghiệp vụ (AUTH_EMAIL_EXISTS…) do `RegisterForm` xử lý.
 */
export function useRegister() {
  return useMutation<RegisterResponse, unknown, RegisterInput>({
    mutationFn: (input) => authService.register(input),
  });
}
