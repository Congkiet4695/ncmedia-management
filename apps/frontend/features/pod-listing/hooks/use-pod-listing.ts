'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podListingService } from '../services/pod-listing.service';
import type {
  PodBrandQuery,
  CreateListingJobPayload,
  GenerateDraftPayload,
  PodDraftListingQuery,
  PodListingJobItemQuery,
  PodListingJobQuery,
  PodListingJobStatus,
  PodTemplateBundle,
  PodTemplateQuery,
  PublishDraftsPayload,
} from '../types';

const KEY = 'pod-listing';

/** Loại template → service tương ứng. Thêm loại mới chỉ cần thêm một dòng ở đây. */
const TEMPLATE_SERVICES = {
  categories: podListingService.categoryTemplates,
  skus: podListingService.skuTemplates,
  descriptions: podListingService.descriptionTemplates,
  images: podListingService.imageTemplates,
  pricing: podListingService.pricingStrategies,
  listings: podListingService.listingTemplates,
} as const;

export type PodTemplateKind = keyof typeof TEMPLATE_SERVICES;

/** Tên file khi tải gói Export. */
const BUNDLE_FILENAME: Record<PodTemplateKind, string> = {
  categories: 'category-templates.json',
  skus: 'sku-templates.json',
  descriptions: 'description-templates.json',
  images: 'image-templates.json',
  pricing: 'pricing-strategies.json',
  listings: 'listing-templates.json',
};

// ---------------------------------------------------------------------------
// Template CRUD (dùng chung cho 6 loại)
// ---------------------------------------------------------------------------

export function usePodTemplates<T>(kind: PodTemplateKind, query: PodTemplateQuery = {}) {
  return useQuery({
    queryKey: [KEY, kind, 'list', query],
    queryFn: () =>
      TEMPLATE_SERVICES[kind].list(query) as Promise<{
        items: T[];
        meta: { page: number; limit: number; total: number; totalPages: number };
      }>,
    placeholderData: keepPreviousData,
  });
}

export function usePodTemplate<T>(kind: PodTemplateKind, id?: string) {
  return useQuery({
    queryKey: [KEY, kind, 'detail', id],
    queryFn: () => TEMPLATE_SERVICES[kind].get(id as string) as Promise<T>,
    enabled: Boolean(id),
  });
}

/**
 * Tạo/sửa template.
 *
 * Sau mỗi thao tác làm mới TOÀN BỘ khoá `pod-listing`: các loại template tham chiếu lẫn
 * nhau (Listing Template hiển thị tên template con), nên chỉ làm mới một loại sẽ để lại
 * dữ liệu cũ trên màn hình khác.
 */
export function useSavePodTemplate<T = unknown>(kind: PodTemplateKind) {
  const queryClient = useQueryClient();
  return useMutation({
    // 6 service trả về 6 kiểu khác nhau ⇒ union không gán được cho MutationFunction.
    // Ép về T (kiểu template mà màn hình đang dùng) ngay tại đây thay vì ở từng chỗ gọi.
    mutationFn: ({ id, payload }: { id?: string; payload: Record<string, unknown> }) =>
      (id
        ? TEMPLATE_SERVICES[kind].update(id, payload)
        : TEMPLATE_SERVICES[kind].create(payload)) as Promise<T>,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeletePodTemplate(kind: PodTemplateKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => TEMPLATE_SERVICES[kind].remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Nhân bản — dùng chung cho cả sáu loại template. */
export function useClonePodTemplate<T = unknown>(kind: PodTemplateKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      TEMPLATE_SERVICES[kind].clone(id, name) as Promise<T>,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Export: tải gói JSON theo đúng bộ lọc đang xem trên màn hình. */
export function useExportPodTemplates(kind: PodTemplateKind) {
  return useMutation({
    mutationFn: (query: PodTemplateQuery = {}) =>
      TEMPLATE_SERVICES[kind].download(query, BUNDLE_FILENAME[kind]),
  });
}

export function useImportPodTemplates(kind: PodTemplateKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: PodTemplateBundle) => TEMPLATE_SERVICES[kind].importBundle(bundle),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Bảng SKU
// ---------------------------------------------------------------------------

export function useBulkUpdateSkuItems(templateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      podListingService.bulkUpdateSkuItems(templateId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

/**
 * **Tạo SKU** — người dùng chủ động bấm; đây là lần DUY NHẤT bảng SKU bị ghi lại.
 */
export function useGenerateSkuItems(templateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (resetEdits?: boolean) =>
      podListingService.generateSkuItems(templateId, resetEdits ?? false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRemoveSkuItem(templateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => podListingService.removeSkuItem(templateId, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateSkuItem(templateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, payload }: { itemId: string; payload: Record<string, unknown> }) =>
      podListingService.updateSkuItem(templateId, itemId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useExportSkuItems() {
  return useMutation({
    mutationFn: ({ templateId, name }: { templateId: string; name: string }) =>
      podListingService.exportSkuItems(templateId, `sku-${slug(name)}.xlsx`),
  });
}

export function useImportSkuItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, file }: { templateId: string; file: File }) =>
      podListingService.importSkuItems(templateId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Phạm vi áp dụng — Template → nhiều Product
// ---------------------------------------------------------------------------

/**
 * Những sản phẩm mà một Listing Template đang bao phủ.
 *
 * `enabled` theo `templateId`: form tạo mới chưa có id thì chưa hỏi được, và cũng không
 * cần — chưa lưu thì chưa có phạm vi nào để đếm.
 */
export function useScopedProducts(
  templateId?: string,
  query: { page?: number; limit?: number; search?: string } = {},
) {
  return useQuery({
    queryKey: [KEY, 'scoped-products', templateId, query],
    queryFn: () => podListingService.scopedProducts(templateId as string, query),
    enabled: Boolean(templateId),
    placeholderData: keepPreviousData,
  });
}

export function useScopedProductCount(templateId?: string) {
  return useQuery({
    queryKey: [KEY, 'scoped-count', templateId],
    queryFn: () => podListingService.scopedProductCount(templateId as string),
    enabled: Boolean(templateId),
  });
}

/** Chạy thử — MUTATION vì chỉ chạy khi người dùng bấm. */
export function useTemplateDryRun() {
  return useMutation({
    mutationFn: ({
      templateId,
      limit,
      productIds,
    }: {
      templateId: string;
      limit?: number;
      productIds?: string[];
    }) => podListingService.dryRun(templateId, { limit, productIds }),
  });
}

// ---------------------------------------------------------------------------
// Bộ ảnh mẫu (gallery)
// ---------------------------------------------------------------------------

/**
 * Mọi thao tác trên ảnh đều trả về TRỌN bộ ảnh sau khi đổi.
 *
 * Nhờ vậy gallery vẽ lại từ một nguồn duy nhất (kết quả server) thay vì tự đoán trạng thái
 * mới ở client — kéo thả rồi xoá rồi thay ảnh liên tiếp mà không bị lệch thứ tự.
 */
export function useImageItemActions(templateId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [KEY] });

  const upload = useMutation({
    mutationFn: ({
      files,
      assetTypes,
      titles,
    }: {
      files: File[];
      assetTypes?: string[];
      titles?: string[];
    }) => podListingService.uploadImageItems(templateId, files, { assetTypes, titles }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: { title?: string; assetType?: string; isRequired?: boolean };
    }) => podListingService.updateImageItem(templateId, itemId, payload),
    onSuccess: invalidate,
  });

  const replace = useMutation({
    mutationFn: ({ itemId, file }: { itemId: string; file: File }) =>
      podListingService.replaceImageItem(templateId, itemId, file),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (itemId: string) => podListingService.removeImageItem(templateId, itemId),
    onSuccess: invalidate,
  });

  const sort = useMutation({
    mutationFn: (itemIds: string[]) => podListingService.sortImageItems(templateId, itemIds),
    onSuccess: invalidate,
  });

  return { upload, update, replace, remove, sort };
}

export function useSetDefaultImageTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => podListingService.setDefaultImageTemplate(templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

/** Preview là MUTATION: chỉ chạy khi người dùng bấm, không tự gọi lại khi focus lại tab. */
export function usePreviewDescription() {
  return useMutation({
    mutationFn: (payload: {
      contentHtml: string;
      tokens?: Array<{ code: string; value: string }>;
      productId?: string;
    }) => podListingService.previewDescription(payload),
  });
}

export function useSystemTokens() {
  return useQuery({
    queryKey: [KEY, 'system-tokens'],
    queryFn: () => podListingService.systemTokens(),
    staleTime: 60 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Dữ liệu TikTok đã đồng bộ
// ---------------------------------------------------------------------------

/** Danh mục đổi rất chậm (chỉ khi đồng bộ) ⇒ cache dài để form không gọi lại liên tục. */
export function useSyncedCategories(
  params: { search?: string; leafOnly?: boolean; tiktokCategoryId?: string } = {},
) {
  return useQuery({
    queryKey: [KEY, 'synced-categories', params],
    queryFn: () => podListingService.syncedCategories(params),
    // Tra chính xác một danh mục thì chỉ chạy khi đã có mã — tránh gọi rỗng lúc form mới mở.
    enabled: params.tiktokCategoryId === undefined || Boolean(params.tiktokCategoryId),
    staleTime: 5 * 60 * 1000,
  });
}

/** Thuộc tính của danh mục — nạp khi người dùng CHỌN danh mục, không nạp sẵn tất cả. */
export function useCategoryAttributes(categoryId?: string) {
  return useQuery({
    queryKey: [KEY, 'category-attributes', categoryId],
    queryFn: () => podListingService.categoryAttributes(categoryId as string),
    enabled: Boolean(categoryId),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Brand — **tìm kiếm phía server**, không tải hết về máy.
 *
 * `keepPreviousData` để danh sách không nhấp nháy trắng giữa hai lần gõ; `staleTime` ngắn
 * hơn danh mục vì brand mới được duyệt liên tục.
 */
export function useSyncedBrands(params: PodBrandQuery = {}) {
  return useQuery({
    queryKey: [KEY, 'synced-brands', params],
    queryFn: () => podListingService.syncedBrands(params),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

/**
 * File đã upload (size chart, video) — nạp theo `fileId` để form hiện đúng tên/ảnh khi mở lại.
 *
 * Lỗi không làm hỏng form: thiếu quyền `storage.read` hay file đã bị dọn thì ô vẫn hiện,
 * chỉ là không có tên đẹp.
 */
export function usePodAsset(fileId?: string | null) {
  return useQuery({
    queryKey: [KEY, 'asset', fileId],
    queryFn: () => podListingService.assetById(fileId as string),
    enabled: Boolean(fileId),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useWarehouses(params: { shopId?: string } = {}) {
  return useQuery({
    queryKey: [KEY, 'warehouses', params],
    queryFn: () => podListingService.warehouses(params),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSyncWarehouses() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shopId?: string) => podListingService.syncWarehouses(shopId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, 'warehouses'] }),
  });
}

// ---------------------------------------------------------------------------
// Preview & Draft — ⏸️ tạm dừng phát triển, giữ nguyên cho màn hình cũ
// ---------------------------------------------------------------------------

export function usePreviewListing() {
  return useMutation({
    mutationFn: (payload: {
      listingTemplateId: string;
      productId: string;
      shopId: string;
      imageTemplateId?: string;
    }) => podListingService.preview(payload),
  });
}

export function useGenerateDrafts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GenerateDraftPayload) => podListingService.generateDrafts(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, 'drafts'] }),
  });
}

/**
 * Danh sách Draft Listing.
 *
 * `live = true` (đang có lượt publish chạy) ⇒ hỏi lại theo nhịp tiến độ để trạng thái từng
 * dòng đổi ngay trước mắt người dùng. Job đứng yên thì KHÔNG hỏi nữa.
 */
export function useDraftListings(query: PodDraftListingQuery, live = false) {
  return useQuery({
    queryKey: [KEY, 'drafts', query],
    queryFn: () => podListingService.draftListings(query),
    placeholderData: keepPreviousData,
    refetchInterval: live ? PROGRESS_POLL_MS : false,
  });
}

export function useDraftListing(id?: string) {
  return useQuery({
    queryKey: [KEY, 'draft-detail', id],
    queryFn: () => podListingService.draftListing(id as string),
    enabled: Boolean(id),
  });
}

export function useDeleteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, remote }: { id: string; remote?: boolean }) =>
      podListingService.removeDraft(id, remote),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, 'drafts'] }),
  });
}

// ---------------------------------------------------------------------------
// Publish Engine — đưa Draft vào hàng chờ duyệt của TikTok
// ---------------------------------------------------------------------------

/**
 * Publish Selected / Publish All.
 *
 * 🔴 Làm mới TOÀN BỘ cache của module sau khi tạo lượt: một Draft vừa publish đổi trạng thái
 * ở ba màn hình khác nhau (Draft Listing, Publish History, Auto Listing). Chỉ invalidate
 * danh sách draft là hai màn còn lại hiển thị số cũ cho tới lần tải trang sau.
 */
export function usePublishDrafts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PublishDraftsPayload) => podListingService.publishDrafts(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Đọc lại trạng thái duyệt ngay, không đợi scheduler 5 phút. */
export function useSyncReviewStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draftIds?: string[]) => podListingService.syncReviewStatus(draftIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Đếm listing đã publish theo trạng thái duyệt. */
export function useReviewSummary(enabled = true) {
  return useQuery({
    queryKey: [KEY, 'review-summary'],
    queryFn: () => podListingService.reviewSummary(),
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Bulk Listing Engine — Listing Job
// ---------------------------------------------------------------------------

/** Job còn đang chạy ⇒ hỏi lại server; đứng yên rồi thì thôi. */
const RUNNING_STATUSES: PodListingJobStatus[] = ['PENDING', 'PROCESSING'];

/**
 * Nhịp hỏi lại tiến độ.
 *
 * 2 giây là đủ mượt để người dùng thấy "đang chạy" mà không biến màn hình thành máy bơm
 * request. Job đứng yên thì KHÔNG hỏi nữa — polling vĩnh viễn là cách âm thầm đốt tài
 * nguyên của cả trình duyệt lẫn server.
 */
const PROGRESS_POLL_MS = 2_000;

export function useListingJobs(query: PodListingJobQuery = {}) {
  return useQuery({
    queryKey: [KEY, 'jobs', query],
    queryFn: () => podListingService.jobs(query),
    placeholderData: keepPreviousData,
    refetchInterval: (result) =>
      result.state.data?.items.some((job) => RUNNING_STATUSES.includes(job.status))
        ? PROGRESS_POLL_MS
        : false,
  });
}

export function useListingJob(id?: string) {
  return useQuery({
    queryKey: [KEY, 'job', id],
    queryFn: () => podListingService.job(id as string),
    enabled: Boolean(id),
    refetchInterval: (result) =>
      result.state.data && RUNNING_STATUSES.includes(result.state.data.status)
        ? PROGRESS_POLL_MS
        : false,
  });
}

export function useListingJobItems(id?: string, query: PodListingJobItemQuery = {}, live = false) {
  return useQuery({
    queryKey: [KEY, 'job-items', id, query],
    queryFn: () => podListingService.jobItems(id as string, query),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    refetchInterval: live ? PROGRESS_POLL_MS : false,
  });
}

export function useListingJobLogs(id?: string, itemId?: string, live = false) {
  return useQuery({
    queryKey: [KEY, 'job-logs', id, itemId],
    queryFn: () => podListingService.jobLogs(id as string, { itemId, limit: 200 }),
    enabled: Boolean(id),
    refetchInterval: live ? PROGRESS_POLL_MS : false,
  });
}

export function useCreateListingJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateListingJobPayload) => podListingService.createJob(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRetryListingJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemIds }: { id: string; itemIds?: string[] }) =>
      podListingService.retryJob(id, itemIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useCancelListingJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podListingService.cancelJob(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteListingJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podListingService.removeJob(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function usePublishHistory(
  query: { page?: number; limit?: number; status?: string; type?: string } = {},
) {
  return useQuery({
    queryKey: [KEY, 'publish-history', query],
    queryFn: () => podListingService.publishHistory(query),
    placeholderData: keepPreviousData,
  });
}

function slug(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'export'
  );
}
