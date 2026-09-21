'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podProductService } from '../services/pod-product.service';
import type {
  CloneProductPayload,
  PodProductQuery,
  PodProductSyncPayload,
  PodProductVariantQuery,
  UpdatePodProductPayload,
} from '../types';

const POD_PRODUCT_KEY = 'pod-products';
/** Khoá cache của module Listing — cùng giá trị với `KEY` trong `use-pod-listing.ts`. */
const POD_LISTING_KEY = 'pod-listing';

export function usePodProducts(query: PodProductQuery) {
  return useQuery({
    queryKey: [POD_PRODUCT_KEY, 'list', query],
    queryFn: () => podProductService.list(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Danh sách SKU có phân trang.
 *
 * `keepPreviousData` để bảng không nháy trắng khi lật trang — người dùng đang tick chọn,
 * một khoảng trống giữa hai trang khiến họ tưởng mất lựa chọn.
 *
 * `enabled` để bộ chọn ở chế độ Per Product không gọi endpoint này một cách vô ích.
 */
export function usePodProductVariants(query: PodProductVariantQuery, enabled = true) {
  return useQuery({
    queryKey: [POD_PRODUCT_KEY, 'variants', query],
    queryFn: () => podProductService.listVariants(query),
    placeholderData: keepPreviousData,
    enabled,
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

export function usePodProductSyncHistory(params: {
  page?: number;
  limit?: number;
  shopId?: string;
}) {
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

/**
 * Sửa sản phẩm trên sàn.
 *
 * Thành công ⇒ làm mới CẢ chi tiết LẪN danh sách: tiêu đề, giá, trạng thái và mốc đồng bộ
 * trên dòng danh sách đều có thể vừa đổi (§19). Ghi thẳng kết quả vào cache chi tiết để
 * modal hiện ngay dữ liệu sàn trả về, không phải chờ một vòng fetch nữa.
 */
export function useUpdatePodProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdatePodProductPayload }) =>
      podProductService.update(id, payload),
    onSuccess: (product) => {
      queryClient.setQueryData([POD_PRODUCT_KEY, 'detail', product.id], product);
      void queryClient.invalidateQueries({ queryKey: [POD_PRODUCT_KEY, 'list'] });
    },
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

/**
 * Ngừng bán một sản phẩm trên sàn.
 *
 * Thành công ⇒ ghi kết quả vào cache chi tiết và làm mới danh sách + bộ lọc: sản phẩm rời
 * khỏi danh sách đang bán (mặc định chỉ hiện ACTIVATE), dropdown trạng thái có thể đổi.
 */
export function useDeactivatePodProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podProductService.deactivate(id),
    onSuccess: (product) => {
      queryClient.setQueryData([POD_PRODUCT_KEY, 'detail', product.id], product);
      void queryClient.invalidateQueries({ queryKey: [POD_PRODUCT_KEY] });
    },
  });
}

/** Xoá sản phẩm (TikTok + xoá mềm) — gỡ khỏi cache chi tiết, làm mới danh sách. */
export function useDeletePodProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podProductService.remove(id),
    onSuccess: (result) => {
      queryClient.removeQueries({ queryKey: [POD_PRODUCT_KEY, 'detail', result.id] });
      void queryClient.invalidateQueries({ queryKey: [POD_PRODUCT_KEY] });
    },
  });
}

/**
 * Nhân bản sang nhiều shop — tạo Listing Job rồi để modal theo dõi bằng `useListingJob`.
 *
 * Làm mới cache Listing (job vừa xuất hiện ở Publish History / Draft Listing). Danh sách sản
 * phẩm CHƯA đổi ngay: sản phẩm mới chỉ về sau lượt đồng bộ được hẹn — modal kết quả nói rõ.
 */
export function useClonePodProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CloneProductPayload }) =>
      podProductService.clone(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [POD_LISTING_KEY] });
    },
  });
}
