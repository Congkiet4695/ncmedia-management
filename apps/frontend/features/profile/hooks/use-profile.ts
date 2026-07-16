'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ME_QUERY_KEY } from '@/features/auth/hooks/use-me';
import { profileService } from '../services/profile.service';
import type { ChangePasswordInput, UpdateProfileInput } from '../types';

const PROFILE_KEY = ['profile', 'me'] as const;

export function useProfile() {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => profileService.getMe(),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateProfileInput) => profileService.updateMe(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
      // Đồng bộ header/session (fullName, avatar) — /auth/me.
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: ChangePasswordInput) => profileService.changePassword(payload),
  });
}
