import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type { ChangePasswordInput, Profile, UpdateProfileInput } from '../types';

/**
 * profile.service — self-service API (chính người dùng đăng nhập).
 */
export const profileService = {
  async getMe(): Promise<Profile> {
    const res = await apiClient.get<ApiResponse<Profile>>('/users/me');
    return res.data.data;
  },

  async updateMe(payload: UpdateProfileInput): Promise<Profile> {
    const res = await apiClient.patch<ApiResponse<Profile>>('/users/me', payload);
    return res.data.data;
  },

  async changePassword(payload: ChangePasswordInput): Promise<void> {
    await apiClient.post<ApiResponse<null>>('/users/me/change-password', payload);
  },
};
