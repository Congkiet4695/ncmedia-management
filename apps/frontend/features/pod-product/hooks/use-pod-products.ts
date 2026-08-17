'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podProductService } from '../services/pod-product.service';
import type { PodProductQuery, PodProductSyncPayload } from '../types';

const POD_PRODUCT_KEY = 'pod-products';

export function usePodProducts(query: PodProductQuery) {
  return useQuery({
    queryKey: [POD_PRODUCT_KEY, 'list', query],
    queryFn: () => podProductService.list(query),
    placeholderData: keepPreviousData,
  });
}

export function usePodProduct(id?: string) {
  return useQuery({
    queryKey: [POD_PRODUCT_KEY, 'detail', id],
    queryFn: () => podProductService.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Giá trị cho dropdown lọc. Đổi rất chậm (chỉ khi đồng bộ xong) nên cache dài —
 * mỗi lần gõ tìm kiếm không cần hỏi lại danh mục/thương hiệu.
 */
export function usePodProductFilters() {
  return useQuery({
    queryKey: [POD_PRODUCT_KEY, 'filters'],
    queryFn: () => podProductService.filters(),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePodProductSyncHistory(params: { page?: number; limit?: number; shopId?: string }) {
  return useQuery({
    queryKey: [POD_PRODUCT_KEY, 'sync-history', params],
    queryFn: () => podProductService.syncHistory(params),
    placeholderData: keepPreviousData,
  });
}

/**
 * Sync Now.
 *
 * Sau khi xong phải làm mới CẢ danh sách LẪN bộ lọc: lượt đồng bộ có thể mang về danh mục
 * hoặc trạng thái chưa từng xuất hiện, dropdown cũ sẽ thiếu lựa chọn.
 */
export function useSyncPodProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PodProductSyncPayload = {}) => podProductService.sync(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POD_PRODUCT_KEY] }),
  });
}

/** Đồng bộ lại một sản phẩm — chỉ cần làm mới đúng sản phẩm đó và danh sách. */
export function useResyncPodProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podProductService.resync(id),
    onSuccess: (product) => {
      queryClient.setQueryData([POD_PRODUCT_KEY, 'detail', product.id], product);
      void queryClient.invalidateQueries({ queryKey: [POD_PRODUCT_KEY, 'list'] });
    },
  });
}
