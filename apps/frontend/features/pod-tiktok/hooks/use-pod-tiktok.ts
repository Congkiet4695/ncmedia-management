'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podTiktokService } from '../services/pod-tiktok.service';
import type { LinkTiktokAccountPayload, PodTiktokAccountQuery, TiktokRegion } from '../types';

const POD_TIKTOK_KEY = 'pod-tiktok-accounts';

export function usePodTiktokAccounts(query: PodTiktokAccountQuery) {
  return useQuery({
    queryKey: [POD_TIKTOK_KEY, 'list', query],
    queryFn: () => podTiktokService.list(query),
    placeholderData: keepPreviousData,
  });
}

export function usePodTiktokAccount(id?: string) {
  return useQuery({
    queryKey: [POD_TIKTOK_KEY, 'detail', id],
    queryFn: () => podTiktokService.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Link uỷ quyền — chỉ fetch khi dialog mở (`enabled`) để không gọi thừa.
 * URL này ít thay đổi nên cache dài.
 */
export function usePodTiktokAuthorizeUrl(enabled: boolean, region?: TiktokRegion) {
  return useQuery({
    queryKey: [POD_TIKTOK_KEY, 'authorize-url', region ?? 'default'],
    queryFn: () => podTiktokService.authorizeUrl(region),
    enabled,
    staleTime: 30 * 60 * 1000,
  });
}

export function useLinkPodTiktokAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LinkTiktokAccountPayload) => podTiktokService.link(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POD_TIKTOK_KEY] }),
  });
}

/** Danh sách Seller cho dropdown — dùng chung mọi dòng nên chỉ tải MỘT lần. */
export function usePodSellerOptions(enabled = true) {
  return useQuery({
    queryKey: [POD_TIKTOK_KEY, 'seller-options'],
    queryFn: () => podTiktokService.sellerOptions(),
    enabled,
    // Danh sách nhân sự thay đổi chậm — giữ cache 5 phút để không gọi lại mỗi lần mở dropdown.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Phân công Seller. Làm mới cả danh sách account LẪN báo cáo Payout vì số liệu
 * payout gom nhóm theo seller — đổi người phụ trách là báo cáo phải đổi theo ngay.
 */
/**
 * Gán nhà cung cấp fulfillment cho kết nối TikTok.
 *
 * Làm mới cả danh sách kết nối lẫn trạng thái fulfillment của đơn: một đơn đang báo
 * "chưa cấu hình" phải chuyển sang "sẵn sàng" ngay sau khi gán, không cần tải lại trang.
 */
export function useAssignFulfillmentProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      fulfillmentAccountId,
    }: {
      id: string;
      fulfillmentAccountId: string | null;
    }) => podTiktokService.assignFulfillmentProvider(id, fulfillmentAccountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [POD_TIKTOK_KEY] });
      void queryClient.invalidateQueries({ queryKey: ['fulfillment'] });
      void queryClient.invalidateQueries({ queryKey: ['fulfillment-providers'] });
      void queryClient.invalidateQueries({ queryKey: ['pod-tiktok-orders'] });
    },
  });
}

export function useAssignPodSeller() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sellerId }: { id: string; sellerId: string | null }) =>
      podTiktokService.assignSeller(id, sellerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [POD_TIKTOK_KEY] });
      void queryClient.invalidateQueries({ queryKey: ['pod-tiktok-payout'] });
      void queryClient.invalidateQueries({ queryKey: ['pod-tiktok-orders'] });
    },
  });
}

export function useUnlinkPodTiktokAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podTiktokService.unlink(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POD_TIKTOK_KEY] }),
  });
}
