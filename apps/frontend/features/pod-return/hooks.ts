'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { POD_SYNC_STATUS_KEY } from '@/features/pod-tiktok/hooks/use-pod-orders';
import { podReturnService } from './service';
import type { PodReturnFilter, PodReturnQuery } from './types';

const KEY = 'pod-return';

export function usePodReturns(query: PodReturnQuery) {
  return useQuery({
    queryKey: [KEY, 'list', query],
    queryFn: () => podReturnService.list(query),
    placeholderData: keepPreviousData,
  });
}

/** Thẻ tổng quan nhận ĐÚNG bộ lọc của bảng — hai nơi không bao giờ mâu thuẫn. */
export function usePodReturnSummary(filter: PodReturnFilter) {
  return useQuery({
    queryKey: [KEY, 'summary', filter],
    queryFn: () => podReturnService.summary(filter),
    placeholderData: keepPreviousData,
  });
}

export function usePodReturnFilterOptions() {
  return useQuery({
    queryKey: [KEY, 'filter-options'],
    queryFn: () => podReturnService.filterOptions(),
    staleTime: 5 * 60_000,
  });
}

/** Lịch sử chỉ tải khi mở drawer (backend gọi TikTok khi bản lưu đã cũ). */
export function usePodReturnHistory(id: string | null) {
  return useQuery({
    queryKey: [KEY, 'history', id],
    queryFn: () => podReturnService.history(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useSyncPodReturns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shopId?: string) => podReturnService.sync(shopId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [KEY] });
      void queryClient.invalidateQueries({ queryKey: [POD_SYNC_STATUS_KEY] });
    },
  });
}
