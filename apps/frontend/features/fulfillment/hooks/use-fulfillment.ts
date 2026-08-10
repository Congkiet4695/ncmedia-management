'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fulfillmentService } from '../services/fulfillment.service';

const KEY = 'fulfillment';

/** Trạng thái fulfillment của một đơn POD (chỉ tải khi panel được mở). */
export function useFulfillmentState(podOrderId?: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'state', podOrderId],
    queryFn: () => fulfillmentService.getState(podOrderId as string),
    enabled: Boolean(podOrderId) && enabled,
  });
}

export function useFulfillmentHistory(podOrderId?: string, enabled = false) {
  return useQuery({
    queryKey: [KEY, 'history', podOrderId],
    queryFn: () => fulfillmentService.history(podOrderId as string),
    enabled: Boolean(podOrderId) && enabled,
  });
}

export function useFulfillmentErrors(podOrderId?: string, enabled = false) {
  return useQuery({
    queryKey: [KEY, 'errors', podOrderId],
    queryFn: () => fulfillmentService.errors(podOrderId as string),
    enabled: Boolean(podOrderId) && enabled,
  });
}

/**
 * Các thao tác thay đổi trạng thái fulfillment.
 * Gom vào MỘT hook để mọi thao tác đều làm mới cùng bộ query — không nơi nào quên
 * invalidate rồi hiển thị trạng thái cũ.
 */
export function useFulfillmentActions(podOrderId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [KEY] });
    // Danh sách đơn POD cũng hiển thị trạng thái fulfillment.
    void queryClient.invalidateQueries({ queryKey: ['pod-tiktok-orders'] });
  };

  return {
    fulfill: useMutation({
      mutationFn: () => fulfillmentService.fulfill(podOrderId),
      onSuccess: refresh,
    }),
    retry: useMutation({
      mutationFn: () => fulfillmentService.retry(podOrderId),
      onSuccess: refresh,
    }),
    sync: useMutation({
      mutationFn: () => fulfillmentService.sync(podOrderId),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: (reason?: string) => fulfillmentService.cancel(podOrderId, reason),
      onSuccess: refresh,
    }),
  };
}
