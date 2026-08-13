'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fulfillmentProviderService,
  fulfillmentService,
  productMappingService,
} from '../services/fulfillment.service';
import type {
  CreateFulfillmentProviderInput,
  ProductMappingQuery,
  UpdateFulfillmentProviderInput,
  UpsertProductMappingInput,
} from '../types';

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

// ---------------------------------------------------------------------------
// Quản trị nhà cung cấp fulfillment
// ---------------------------------------------------------------------------

const PROVIDER_KEY = 'fulfillment-providers';

export function useFulfillmentProviders() {
  return useQuery({
    queryKey: [PROVIDER_KEY, 'list'],
    queryFn: () => fulfillmentProviderService.list(),
  });
}

/** Dropdown ở màn hình TikTok Account — dùng CHUNG một query cho cả bảng nên không N+1. */
export function useFulfillmentProviderOptions(enabled = true) {
  return useQuery({
    queryKey: [PROVIDER_KEY, 'options'],
    queryFn: () => fulfillmentProviderService.options(),
    enabled,
  });
}

/**
 * Gom các thao tác ghi vào một hook.
 * Mọi mutation đều làm mới CẢ danh sách lẫn options — đổi trạng thái một nhà cung cấp
 * là dropdown ở màn hình khác phải phản ánh ngay.
 */
export function useFulfillmentProviderActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [PROVIDER_KEY] });
  };

  return {
    create: useMutation({
      mutationFn: (input: CreateFulfillmentProviderInput) =>
        fulfillmentProviderService.create(input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateFulfillmentProviderInput }) =>
        fulfillmentProviderService.update(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => fulfillmentProviderService.remove(id),
      onSuccess: invalidate,
    }),
    // Test Connection KHÔNG làm mới danh sách: đây là thao tác chẩn đoán, không đổi dữ liệu.
    testConnection: useMutation({
      mutationFn: (id: string) => fulfillmentProviderService.testConnection(id),
    }),
  };
}

// ---------------------------------------------------------------------------
// Ánh xạ sản phẩm
// ---------------------------------------------------------------------------

const MAPPING_KEY = 'product-mappings';

export function useProductMappings(query: ProductMappingQuery) {
  return useQuery({
    queryKey: [MAPPING_KEY, 'list', query],
    queryFn: () => productMappingService.list(query),
    placeholderData: (previous) => previous,
  });
}

/** SKU TikTok có thể ánh xạ. Chỉ tải khi đã chọn nhà cung cấp (bước 1 của luồng). */
export function useTiktokProductOptions(accountId?: string, search?: string) {
  return useQuery({
    queryKey: [MAPPING_KEY, 'tiktok-products', accountId, search],
    queryFn: () => productMappingService.tiktokProducts(accountId as string, search),
    enabled: Boolean(accountId),
  });
}

/**
 * Danh mục sản phẩm của nhà cung cấp.
 * `staleTime` 5 phút khớp với TTL cache phía backend — mở lại dialog trong khoảng đó
 * không tạo thêm request nào.
 */
export function useProviderCatalogProducts(accountId?: string, search?: string) {
  return useQuery({
    queryKey: [MAPPING_KEY, 'catalog-products', accountId, search],
    queryFn: () => productMappingService.catalogProducts(accountId as string, search),
    enabled: Boolean(accountId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useProviderCatalogVariations(accountId?: string, productId?: string) {
  return useQuery({
    queryKey: [MAPPING_KEY, 'catalog-variations', accountId, productId],
    queryFn: () =>
      productMappingService.catalogVariations(accountId as string, productId as string),
    enabled: Boolean(accountId) && Boolean(productId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useProductMappingActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [MAPPING_KEY] });
    // Ánh xạ đổi ⇒ đơn có thể chuyển từ "chưa sẵn sàng" sang "gửi được" ngay.
    void queryClient.invalidateQueries({ queryKey: ['fulfillment'] });
  };

  return {
    create: useMutation({
      mutationFn: (input: UpsertProductMappingInput) => productMappingService.create(input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpsertProductMappingInput }) =>
        productMappingService.update(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => productMappingService.remove(id),
      onSuccess: invalidate,
    }),
    refreshCatalog: useMutation({
      mutationFn: (accountId: string) => productMappingService.refreshCatalog(accountId),
      onSuccess: invalidate,
    }),
  };
}
