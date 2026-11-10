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

/** Kích hoạt / vô hiệu hoá — làm mới toàn bộ cache module (danh sách, chi tiết, dashboard). */
export function useSetOrganizationActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active ? superAdminService.activate(id) : superAdminService.deactivate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

/**
 * Đổi gói: chỉ gửi phần ĐÃ đổi (giới hạn Shop và/hoặc ngày hết hạn) — mỗi phần một API riêng ở backend để nhật ký
 * ghi đúng từng thay đổi.
 */
export function useUpdateOrganizationPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, shopLimit, expiresAt }: { id: string; shopLimit?: number; expiresAt?: string }) => {
      if (shopLimit !== undefined) await superAdminService.updateShopLimit(id, shopLimit);
      if (expiresAt !== undefined) await superAdminService.updateExpiration(id, expiresAt);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** XOÁ CỨNG Organization — xoá xong thì bỏ cache chi tiết và làm mới danh sách / dashboard. */
export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmSlug }: { id: string; confirmSlug: string }) =>
      superAdminService.remove(id, confirmSlug),
    onSuccess: (_result, { id }) => {
      queryClient.removeQueries({ queryKey: [KEY, 'organization', id] });
      void queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
}
