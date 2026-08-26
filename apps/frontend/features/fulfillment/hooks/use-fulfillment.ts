'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fulfillmentProviderService,
  fulfillmentService,
  productMappingService,
} from '../services/fulfillment.service';
import type { PodDesignPlacement } from '@/features/pod-tiktok/order-types';
import type {
  CatalogProductQuery,
  CreateFulfillmentProviderInput,
  ProductDesignKey,
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

/**
 * Danh mục (nhóm sản phẩm) của một nhà cung cấp — bước 2 của luồng ánh xạ.
 *
 * `staleTime` dài vì dữ liệu này do Sync Job ghi xuống theo giờ, không đổi giữa hai lần mở
 * dialog. Đóng/mở lại trong vài phút không tạo thêm request nào.
 */
export function useProviderCatalogues(accountId?: string) {
  return useQuery({
    queryKey: [MAPPING_KEY, 'catalogues', accountId],
    queryFn: () => productMappingService.catalogues(accountId as string),
    enabled: Boolean(accountId),
    staleTime: 5 * 60 * 1000,
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
 * Sản phẩm trong danh mục nhà cung cấp — đọc từ Database, PHÂN TRANG phía server.
 *
 * 🔴 Bản cũ tải toàn bộ danh mục về trình duyệt rồi lọc tại chỗ; với vài nghìn sản phẩm đó
 * là vài MB JSON mỗi lần mở dialog. Giờ mỗi lần chỉ tải đúng một trang.
 */
export function useProviderCatalogProducts(accountId?: string, query: CatalogProductQuery = {}) {
  return useQuery({
    queryKey: [MAPPING_KEY, 'catalog-products', accountId, query],
    queryFn: () => productMappingService.catalogProducts(accountId as string, query),
    enabled: Boolean(accountId),
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

/** Biến thể của một sản phẩm. `productId` là khoá NỘI BỘ (uuid), không phải id của Mango. */
export function useProviderCatalogVariations(accountId?: string, productId?: string) {
  return useQuery({
    queryKey: [MAPPING_KEY, 'catalog-variations', accountId, productId],
    queryFn: () =>
      productMappingService.catalogVariations(accountId as string, productId as string),
    enabled: Boolean(accountId) && Boolean(productId),
    staleTime: 5 * 60 * 1000,
  });
}

/** Tình trạng bản sao danh mục — số bản ghi + lần đồng bộ gần nhất. */
export function useCatalogStatus(accountId?: string) {
  return useQuery({
    queryKey: [MAPPING_KEY, 'catalog-status', accountId],
    queryFn: () => productMappingService.catalogStatus(accountId as string),
    enabled: Boolean(accountId),
  });
}

/**
 * Làm mới MỌI thứ phụ thuộc vào Product Mapping (§ "không cần Refresh").
 *
 * 🔴 Ba cache, không phải một. Design sống ở Product Mapping và được ĐỌC ở ba nơi:
 *   - `product-mappings`    — bảng ánh xạ (ảnh Front/Back, cột tình trạng)
 *   - `pod-tiktok-orders`   — danh sách đơn (thumbnail design + trạng thái ánh xạ)
 *   - `fulfillment`         — `ready`/`issues`, thứ quyết định nút Fulfill sáng hay mờ
 *
 * Bỏ sót vế thứ ba là đúng triệu chứng đã từng gặp: ảnh đổi ngay nhưng nút Fulfill vẫn mờ
 * cho tới khi người dùng F5.
 */
function useMappingRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [MAPPING_KEY] });
    void queryClient.invalidateQueries({ queryKey: ['pod-tiktok-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['fulfillment'] });
  };
}

/**
 * Upload / Replace / Delete design của MỘT SẢN PHẨM (Product ID + Seller SKU).
 *
 * 🔴 KHÔNG cần sản phẩm đã có Product Mapping — Design và Mapping là hai nghiệp vụ độc lập.
 * Không thao tác nào chạm vào đơn hàng: một lần upload phục vụ mọi đơn cùng cặp khoá, xoá là
 * mọi đơn đó quay về "Design Missing". Việc duy nhất frontend phải làm sau đó là bỏ cache cũ
 * đi — xem `useMappingRefresh`.
 */
export function useMappingDesignActions() {
  const refresh = useMappingRefresh();

  return {
    upload: useMutation({
      mutationFn: ({
        key,
        placement,
        file,
        onProgress,
      }: {
        key: ProductDesignKey;
        placement: PodDesignPlacement;
        file: File;
        onProgress?: (percent: number) => void;
      }) => productMappingService.uploadDesign(key, placement, file, onProgress),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: ({ key, placement }: { key: ProductDesignKey; placement: PodDesignPlacement }) =>
        productMappingService.deleteDesign(key, placement),
      onSuccess: refresh,
    }),
  };
}

export function useProductMappingActions() {
  const invalidate = useMappingRefresh();

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
    /**
     * Kéo danh mục từ nhà cung cấp về Database.
     *
     * ⚠️ Tác vụ DÀI với danh mục lớn (hàng nghìn lời gọi API, tự giới hạn 10 request/giây).
     * Giao diện phải hiện trạng thái đang chạy chứ không được để người dùng tưởng máy treo.
     */
    syncCatalog: useMutation({
      mutationFn: (accountId: string) => productMappingService.syncCatalog(accountId),
      onSuccess: invalidate,
    }),

    /** Rà ánh xạ tự động cho mọi sản phẩm chưa ánh xạ. */
    autoResolve: useMutation({
      mutationFn: () => productMappingService.autoResolve(),
      onSuccess: invalidate,
    }),
  };
}
