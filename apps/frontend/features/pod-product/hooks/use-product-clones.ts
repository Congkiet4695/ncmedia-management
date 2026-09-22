'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podProductCloneService } from '../services/pod-product-clone.service';
import type { PodProductCloneQuery } from '../types';

const KEY = 'pod-product-clones';

/**
 * Nhịp hỏi lại khi còn lượt đang chạy — cùng con số với màn hình Listing Job (2s). Không còn
 * lượt PENDING/PROCESSING nào ⇒ dừng polling: không đốt request cho một bảng đứng yên.
 */
const PROGRESS_POLL_MS = 2_000;

export function useProductClones(query: PodProductCloneQuery) {
  return useQuery({
    queryKey: [KEY, 'list', query],
    queryFn: () => podProductCloneService.list(query),
    placeholderData: keepPreviousData,
    refetchInterval: (result) =>
      result.state.data?.items.some((batch) => batch.running) ? PROGRESS_POLL_MS : false,
  });
}

export function useProductClone(id?: string) {
  return useQuery({
    queryKey: [KEY, 'detail', id],
    queryFn: () => podProductCloneService.get(id as string),
    enabled: Boolean(id),
    refetchInterval: (result) => (result.state.data?.running ? PROGRESS_POLL_MS : false),
  });
}

/** Retry cả lượt (`itemId` bỏ trống) hoặc một shop — thành công thì làm mới danh sách + chi tiết. */
export function useRetryProductClone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId?: string }) =>
      itemId ? podProductCloneService.retryItem(id, itemId) : podProductCloneService.retryFailed(id),
    onSuccess: (batch) => {
      queryClient.setQueryData([KEY, 'detail', batch.id], batch);
      void queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
}
