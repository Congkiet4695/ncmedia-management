'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { superAdminService } from './service';
import type { OrganizationQuery } from './types';

const KEY = 'super-admin';

export function useSuperAdminDashboard(enabled = true) {
  return useQuery({
    queryKey: [KEY, 'dashboard'],
    queryFn: () => superAdminService.dashboard(),
    enabled,
  });
}

export function useOrganizations(query: OrganizationQuery = {}) {
  return useQuery({
    queryKey: [KEY, 'organizations', query],
    queryFn: () => superAdminService.organizations(query),
    placeholderData: keepPreviousData,
  });
}

export function useOrganization(id?: string) {
  return useQuery({
    queryKey: [KEY, 'organization', id],
    queryFn: () => superAdminService.organization(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Approve / Reject.
 *
 * 🔴 Làm mới TOÀN BỘ cache của module sau mỗi quyết định: một lần duyệt đổi cùng lúc danh
 * sách, chi tiết và cả bốn con số Dashboard. Chỉ invalidate danh sách là Dashboard hiển thị
 * số cũ cho tới lần tải trang sau — và Dashboard chính là nơi Super Admin nhìn để biết còn
 * bao nhiêu hồ sơ phải xử lý.
 */
export function useApproveOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => superAdminService.approve(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRejectOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      superAdminService.reject(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}
