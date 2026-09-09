'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podFlashSaleService } from './service';
import type {
  PodFlashSaleProductQuery,
  AddFlashSaleItemPayload,
  ApplyFlashSaleTemplatePayload,
  BatchUpdateFlashSaleItemsPayload,
  CreateFlashSalePayload,
  DuplicateFlashSalePayload,
  PodFlashSaleQuery,
  PodFlashSaleTemplateQuery,
  SaveFlashSaleTemplatePayload,
  UpdateFlashSaleItemPayload,
  UpdateFlashSalePayload,
} from './types';

const KEY = 'pod-flash-sale';
const TEMPLATE_KEY = 'pod-flash-sale-template';

/**
 * Nhịp tự làm mới khi có đợt sale đang PUBLISHING/RUNNING — 30 giây theo yêu cầu sprint.
 *
 * 🔴 Ba mươi giây này KHÔNG chạm tới TikTok: `list`/`get` chỉ đọc database. Trạng thái phía
 * sàn do scheduler của backend kéo về (5 phút/lần). Đó là lý do tăng nhịp ở đây an toàn,
 * còn gọi `sync` theo nhịp thì không.
 */
const LIVE_POLL_MS = 30_000;

/**
 * Nhịp hỏi tiến độ khi một lượt publish đang chạy.
 *
 * 🔴 Dày hơn `LIVE_POLL_MS` rất nhiều vì đây là con số người dùng đang NGỒI NHÌN: một đợt
 * 10.000 SKU chạy vài phút, ba mươi giây một nhịp thì thanh tiến độ đứng hình. An toàn vì
 * endpoint `publish-status` KHÔNG kèm danh sách dòng và KHÔNG chạm tới TikTok — nó đọc mấy
 * cột đếm cộng hai câu `count` có index.
 */
const PUBLISH_POLL_MS = 3_000;

export function useFlashSales(query: PodFlashSaleQuery = {}) {
  return useQuery({
    queryKey: [KEY, 'list', query],
    queryFn: () => podFlashSaleService.list(query),
    placeholderData: keepPreviousData,
    // Đứng yên thì thôi — polling vĩnh viễn là cách âm thầm đốt tài nguyên của cả trình
    // duyệt lẫn server. Cờ `live` do backend quyết định, frontend không tự đoán.
    refetchInterval: (result) =>
      result.state.data?.items.some((flashSale) => flashSale.live) ? LIVE_POLL_MS : false,
  });
}

export function useFlashSale(id?: string) {
  return useQuery({
    queryKey: [KEY, 'detail', id],
    queryFn: () => podFlashSaleService.get(id as string),
    enabled: Boolean(id),
    refetchInterval: (result) => (result.state.data?.live ? LIVE_POLL_MS : false),
  });
}

/**
 * Tiến độ lượt publish. Chỉ hỏi khi đợt sale đang chạy, tự dừng khi xong.
 *
 * 🔴 Hiển thị SỐ THẬT của backend. Không nội suy, không đếm giả cho "mượt" — một thanh tiến
 * trình tự chạy trong khi lô 12 đang kẹt là nói dối người vận hành.
 */
export function useFlashSalePublishStatus(id?: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'publish-status', id],
    queryFn: () => podFlashSaleService.publishStatus(id as string),
    enabled: Boolean(id) && enabled,
    refetchInterval: (result) => (result.state.data?.live ? PUBLISH_POLL_MS : false),
  });
}

/**
 * Sản phẩm của đợt sale, phân trang theo SẢN PHẨM.
 *
 * `keepPreviousData` để bảng không nháy trắng khi lật trang — người dùng đang sửa giá, một
 * khoảng trống giữa hai trang khiến họ tưởng mất dữ liệu.
 */
export function useFlashSaleProducts(id: string | undefined, query: PodFlashSaleProductQuery = {}) {
  return useQuery({
    queryKey: [KEY, 'products', id, query],
    queryFn: () => podFlashSaleService.products(id as string, query),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

export function useFlashSaleLogs(id?: string, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: [KEY, 'logs', id, params],
    queryFn: () => podFlashSaleService.logs(id as string, params),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

/**
 * Làm mới sau một thao tác ghi.
 *
 * Ghi đè thẳng cache chi tiết bằng response (mọi endpoint ghi đều trả về bản chi tiết đầy
 * đủ) rồi mới cho danh sách hỏi lại — bảng sản phẩm vẽ lại NGAY thay vì nhấp nháy chờ một
 * vòng request nữa.
 */
function useWriteMutation<TVars, TData extends { id: string }>(
  mutationFn: (vars: TVars) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData([KEY, 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: [KEY, 'list'] });
      // 🔴 Bảng sản phẩm nay là một truy vấn RIÊNG có phân trang — không nằm trong `detail`
      // nữa. Không làm mới nó ở đây thì thêm/xoá/sửa dòng xong màn hình vẫn hiện dữ liệu cũ.
      void queryClient.invalidateQueries({ queryKey: [KEY, 'products', data.id] });
    },
  });
}

export function useCreateFlashSale() {
  return useWriteMutation((payload: CreateFlashSalePayload) => podFlashSaleService.create(payload));
}

export function useUpdateFlashSale() {
  return useWriteMutation(({ id, payload }: { id: string; payload: UpdateFlashSalePayload }) =>
    podFlashSaleService.update(id, payload),
  );
}

export function useDuplicateFlashSale() {
  return useWriteMutation(({ id, payload }: { id: string; payload?: DuplicateFlashSalePayload }) =>
    podFlashSaleService.duplicate(id, payload ?? {}),
  );
}

export function useDeleteFlashSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podFlashSaleService.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: [KEY, 'detail', id] });
      void queryClient.invalidateQueries({ queryKey: [KEY, 'list'] });
    },
  });
}

/**
 * Thêm sản phẩm vào đợt sale.
 *
 * Dùng `addItemsInChunks`: danh sách dài được chia thành nhiều request thay vì bị chặn ở ô
 * chọn. Trần một request là chuyện của tầng vận chuyển, không phải giới hạn nghiệp vụ.
 */
export function useAddFlashSaleItems() {
  return useWriteMutation(({ id, items }: { id: string; items: AddFlashSaleItemPayload[] }) =>
    podFlashSaleService.addItemsInChunks(id, items),
  );
}

export function useUpdateFlashSaleItem() {
  return useWriteMutation(
    ({
      id,
      itemId,
      payload,
    }: {
      id: string;
      itemId: string;
      payload: UpdateFlashSaleItemPayload;
    }) => podFlashSaleService.updateItem(id, itemId, payload),
  );
}

export function useBatchUpdateFlashSaleItems() {
  return useWriteMutation(
    ({ id, payload }: { id: string; payload: BatchUpdateFlashSaleItemsPayload }) =>
      podFlashSaleService.batchUpdateItems(id, payload),
  );
}

export function useDeleteFlashSaleItems() {
  return useWriteMutation(({ id, itemIds }: { id: string; itemIds: string[] }) =>
    podFlashSaleService.deleteItems(id, itemIds),
  );
}

/**
 * Publish / Retry / Cancel — ba thao tác CHẠM TỚI SÀN.
 *
 * Response chỉ mang kết quả tóm tắt, không phải bản chi tiết, nên phải hỏi lại chi tiết
 * thay vì ghi đè cache.
 */
function useProviderMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  getId: (vars: TVars) => string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: (_data, _error, vars) => {
      // `onSettled` chứ không phải `onSuccess`: publish hỏng cũng đổi trạng thái đợt sale
      // sang FAILED ở server, và người dùng cần thấy điều đó ngay.
      void queryClient.invalidateQueries({ queryKey: [KEY, 'detail', getId(vars)] });
      void queryClient.invalidateQueries({ queryKey: [KEY, 'logs', getId(vars)] });
      void queryClient.invalidateQueries({ queryKey: [KEY, 'list'] });
    },
  });
}

export function usePublishFlashSale() {
  return useProviderMutation(
    ({ id, skipInvalidItems }: { id: string; skipInvalidItems?: boolean }) =>
      podFlashSaleService.publish(id, skipInvalidItems ?? false),
    (vars) => vars.id,
  );
}

export function useRetryFlashSale() {
  return useProviderMutation(
    ({ id, skipInvalidItems }: { id: string; skipInvalidItems?: boolean }) =>
      podFlashSaleService.retry(id, skipInvalidItems ?? false),
    (vars) => vars.id,
  );
}

export function useCancelFlashSale() {
  return useProviderMutation(
    (id: string) => podFlashSaleService.cancel(id),
    (id) => id,
  );
}

export function useSyncFlashSale() {
  return useWriteMutation((id: string) => podFlashSaleService.sync(id));
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export function useFlashSaleTemplates(query: PodFlashSaleTemplateQuery = {}, enabled = true) {
  return useQuery({
    queryKey: [TEMPLATE_KEY, 'list', query],
    queryFn: () => podFlashSaleService.listTemplates(query),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useFlashSaleTemplate(id?: string) {
  return useQuery({
    queryKey: [TEMPLATE_KEY, 'detail', id],
    queryFn: () => podFlashSaleService.getTemplate(id as string),
    enabled: Boolean(id),
  });
}

export function useSaveFlashSaleTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SaveFlashSaleTemplatePayload }) =>
      podFlashSaleService.saveAsTemplate(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [TEMPLATE_KEY] }),
  });
}

export function useDeleteFlashSaleTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podFlashSaleService.removeTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [TEMPLATE_KEY] }),
  });
}

export function useApplyFlashSaleTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ApplyFlashSaleTemplatePayload }) =>
      podFlashSaleService.applyTemplate(id, payload),
    onSuccess: (data) => {
      queryClient.setQueryData([KEY, 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: [KEY, 'list'] });
    },
  });
}
