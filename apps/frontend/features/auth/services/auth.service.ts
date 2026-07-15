import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema';
import type { LoginResponse, MeProfile, RegisterResponse } from '../types';

/**
 * auth.service — gọi API Authentication, trả về `data` đã bóc khỏi envelope chuẩn.
 */
export const authService = {
  async register(input: RegisterInput): Promise<RegisterResponse> {
    const res = await apiClient.post<ApiResponse<RegisterResponse>>('/auth/register', input);
    return res.data.data;
  },

  async login(input: LoginInput): Promise<LoginResponse> {
    const res = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', input);
    return res.data.data;
  },

  /** GET /auth/me — hồ sơ người dùng hiện tại (kèm organization + role). */
  async getMe(): Promise<MeProfile> {
    const res = await apiClient.get<ApiResponse<MeProfile>>('/auth/me');
    return res.data.data;
  },
};
