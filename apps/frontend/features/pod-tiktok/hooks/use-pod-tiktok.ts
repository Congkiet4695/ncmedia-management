'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podTiktokService } from '../services/pod-tiktok.service';
import type { PodTiktokAccountQuery, StartTiktokAuthorizationPayload } from '../types';

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
 * Tạo Authorization URL cho một phiên uỷ quyền.
 *
 * Là MUTATION chứ không phải query: mỗi lần tạo phải sinh một `state` mới dùng một lần —
 * cache lại link cũ đồng nghĩa đưa người dùng đi với `state` đã tiêu thụ hoặc hết hạn.
 */
export function useStartTiktokAuthorization() {
  return useMutation({
    mutationFn: (payload: StartTiktokAuthorizationPayload) =>
      podTiktokService.startAuthorization(payload),
  });
}

/**
 * Kết quả uỷ quyền cho trang công khai. KHÔNG retry: vé chỉ tra được đúng một phiên,
 * hỏng thì thử lại cũng vậy — hiện thông báo ngay cho người dùng.
 */
export function usePodTiktokLinkResult(ref?: string) {
  return useQuery({
    queryKey: [POD_TIKTOK_KEY, 'link-result', ref],
    queryFn: () => podTiktokService.linkResult(ref as string),
    enabled: Boolean(ref),
    retry: false,
    staleTime: Infinity,
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
