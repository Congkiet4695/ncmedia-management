'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podOrderService } from '../services/pod-order.service';
import type { PodOrderQuery, PodShopSyncType, TriggerSyncPayload } from '../order-types';

const POD_ORDERS_KEY = 'pod-tiktok-orders';
/** Cache key của Latest Sync Status — module sản phẩm cũng làm mới theo key này sau Sync Now. */
export const POD_SYNC_STATUS_KEY = 'pod-shop-sync-status';

/** Nhịp tự làm mới khi còn shop đang RUNNING (ms). */
const SYNC_STATUS_POLL_MS = 5_000;

export function usePodOrders(query: PodOrderQuery) {
  return useQuery({
    queryKey: [POD_ORDERS_KEY, 'list', query],
    queryFn: () => podOrderService.list(query),
    placeholderData: keepPreviousData,
  });
}

export function usePodOrder(id?: string) {
  return useQuery({
    queryKey: [POD_ORDERS_KEY, 'detail', id],
    queryFn: () => podOrderService.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Thống kê cho các thẻ ở đầu màn hình danh sách.
 *
 * 🔴 Nhận CÙNG `query` với `usePodOrders`. Hai hệ quả, cả hai đều cần:
 *   1. Backend đếm theo đúng bộ lọc ⇒ thẻ và bảng không còn mâu thuẫn.
 *   2. `query` nằm trong cache key ⇒ đổi filter là thẻ tự tải lại cùng lúc với danh sách,
 *      không phải F5.
 *
 * `placeholderData` giữ số cũ trong lúc tải để các thẻ không nháy về rỗng rồi hiện lại.
 */
export function usePodOrderStats(query: PodOrderQuery = {}) {
  return useQuery({
    queryKey: [POD_ORDERS_KEY, 'stats', query],
    queryFn: () => podOrderService.stats(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Latest Sync Status của một loại đồng bộ. Còn shop đang RUNNING ⇒ tự làm mới cho tới khi xong,
 * để người dùng thấy kết quả mà không phải mở lại.
 */
export function useLatestSyncStatus(syncType: PodShopSyncType, enabled = true) {
  return useQuery({
    queryKey: [POD_SYNC_STATUS_KEY, syncType],
    queryFn: () => podOrderService.syncStatus(syncType),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === 'RUNNING') ? SYNC_STATUS_POLL_MS : false,
  });
}

/** Sau khi đồng bộ xong phải làm mới cả danh sách đơn lẫn trạng thái đồng bộ. */
export function useTriggerPodSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TriggerSyncPayload) => podOrderService.triggerSync(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [POD_ORDERS_KEY] });
      void queryClient.invalidateQueries({ queryKey: [POD_SYNC_STATUS_KEY] });
    },
  });
}
