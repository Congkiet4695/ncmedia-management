'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podOrderService } from '../services/pod-order.service';
import type {
  PodDesignPlacement,
  PodOrderQuery,
  PodSyncLogQuery,
  TriggerSyncPayload,
} from '../order-types';

const POD_ORDERS_KEY = 'pod-tiktok-orders';
const POD_SYNC_LOGS_KEY = 'pod-tiktok-sync-logs';

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

export function usePodOrderStats() {
  return useQuery({
    queryKey: [POD_ORDERS_KEY, 'stats'],
    queryFn: () => podOrderService.stats(),
  });
}

export function usePodSyncLogs(query: PodSyncLogQuery, enabled = true) {
  return useQuery({
    queryKey: [POD_SYNC_LOGS_KEY, 'list', query],
    queryFn: () => podOrderService.syncLogs(query),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Upload/thay thế design của một sản phẩm.
 * Làm mới danh sách đơn để thumbnail design cập nhật ngay tại chỗ.
 */
export function useUploadDesign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderItemId,
      placement,
      file,
      onProgress,
    }: {
      orderItemId: string;
      placement: PodDesignPlacement;
      file: File;
      onProgress?: (percent: number) => void;
    }) => podOrderService.uploadDesign(orderItemId, placement, file, onProgress),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POD_ORDERS_KEY] }),
  });
}

export function useDeleteDesign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderItemId,
      placement,
    }: {
      orderItemId: string;
      placement: PodDesignPlacement;
    }) => podOrderService.deleteDesign(orderItemId, placement),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POD_ORDERS_KEY] }),
  });
}

/** Sau khi đồng bộ xong phải làm mới cả danh sách đơn lẫn nhật ký. */
export function useTriggerPodSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TriggerSyncPayload) => podOrderService.triggerSync(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [POD_ORDERS_KEY] });
      void queryClient.invalidateQueries({ queryKey: [POD_SYNC_LOGS_KEY] });
    },
  });
}
