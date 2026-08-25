import { apiClient } from '@/services/api-client';
import type { ApiResponse, Paginated } from '@/types/api';
import type {
  PodBrandQuery,
  PodStorageFileRef,
  CreateListingJobPayload,
  GenerateDraftPayload,
  GenerateDraftResult,
  PodCategoryAttributeDef,
  PodCategoryTemplate,
  PodDescriptionPreview,
  PodDescriptionTemplate,
  PodDraftListing,
  PodDryRunResult,
  PodScopedProduct,
  PodDraftListingDetail,
  PodDraftListingQuery,
  PodImageTemplate,
  PodListingJob,
  PodListingJobItem,
  PodListingJobItemQuery,
  PodListingJobQuery,
  PodListingLog,
  PodListingTemplate,
  PodPricingStrategy,
  PodSkuImportResult,
  PodSkuTemplate,
  PodSyncedBrand,
  PodSyncedCategory,
  PodTemplateBundle,
  PodTemplateBundleKind,
  PodTemplateImportResult,
  PodTemplateListResult,
  PodTemplateQuery,
  PodTokenDefinition,
  PodWarehouse,
  PreviewResult,
  PublishDraftsPayload,
  PublishJobResult,
  PodReviewStatus,
  ReviewSyncResult,
} from '../types';

const TEMPLATES = '/pod/templates';
const POD = '/pod';
const JOBS = '/pod/listing-jobs';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}

/** Tải một Blob về máy người dùng. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * API module Template Engine.
 *
 * ⏸️ Auto Listing / Draft / Publish đang TẠM DỪNG phát triển — các hàm bên dưới giữ
 * nguyên để màn hình cũ vẫn chạy, sprint này không thêm gì cho chúng.
 *
 * 🔴 Không có endpoint publish/tạo sản phẩm trên TikTok. Thứ duy nhất chạm TikTok ở đây
 * là **đồng bộ kho** (chỉ đọc).
 */
export const podListingService = {
  // --------------------- Dữ liệu TikTok đã đồng bộ ---------------------

  /** `tiktokCategoryId` tra CHÍNH XÁC một danh mục — dùng khi mở lại template đã lưu. */
  async syncedCategories(
    params: {
      shopId?: string;
      search?: string;
      leafOnly?: boolean;
      tiktokCategoryId?: string;
    } = {},
  ) {
    const res = await apiClient.get<ApiResponse<PodSyncedCategory[]>>(`${POD}/products/categories`, {
      params: clean({ ...params, leafOnly: params.leafOnly ? 'true' : undefined }),
    });
    return res.data.data;
  },

  /** Thuộc tính của một danh mục — form Category Template render động từ đây. */
  async categoryAttributes(categoryId: string) {
    const res = await apiClient.get<ApiResponse<PodCategoryAttributeDef[]>>(
      `${POD}/products/categories/${categoryId}/attributes`,
    );
    return res.data.data;
  },

  /** Brand có phân trang + tìm kiếm phía server (`?page&pageSize&keyword`). */
  async syncedBrands(params: PodBrandQuery = {}) {
    const res = await apiClient.get<ApiResponse<Paginated<PodSyncedBrand>>>(
      `${POD}/products/brands`,
      { params: clean(params as Record<string, unknown>) },
    );
    return res.data.data;
  },

  async warehouses(params: { shopId?: string } = {}) {
    const res = await apiClient.get<ApiResponse<PodWarehouse[]>>(`${POD}/warehouses`, {
      params: clean(params),
    });
    return res.data.data;
  },

  async syncWarehouses(shopId?: string) {
    const res = await apiClient.post<ApiResponse<Array<{ shopId: string; warehouses: number }>>>(
      `${POD}/warehouses/sync`,
      clean({ shopId }),
    );
    return res.data.data;
  },

  /** Token hệ thống dùng được trong Description Template. */
  async systemTokens() {
    const res = await apiClient.get<ApiResponse<{ tokens: PodTokenDefinition[] }>>(
      `${TEMPLATES}/tokens`,
    );
    return res.data.data.tokens;
  },

  // ---------------------------- Templates ------------------------------

  categoryTemplates: crud<PodCategoryTemplate>(`${TEMPLATES}/categories`, 'CATEGORY'),
  skuTemplates: crud<PodSkuTemplate>(`${TEMPLATES}/skus`, 'SKU'),
  descriptionTemplates: crud<PodDescriptionTemplate>(`${TEMPLATES}/descriptions`, 'DESCRIPTION'),
  imageTemplates: crud<PodImageTemplate>(`${TEMPLATES}/images`, 'IMAGE'),
  pricingStrategies: crud<PodPricingStrategy>(`${TEMPLATES}/pricing`, 'PRICING'),
  listingTemplates: crud<PodListingTemplate>(`${POD}/listing-templates`, 'LISTING'),

  // ------------------------- Bảng SKU (grid) ---------------------------

  /** Bulk Update các SKU của một SKU Template. */
  async bulkUpdateSkuItems(
    templateId: string,
    payload: Record<string, unknown>,
  ): Promise<PodSkuTemplate> {
    const res = await apiClient.patch<ApiResponse<PodSkuTemplate>>(
      `${TEMPLATES}/skus/${templateId}/items`,
      clean(payload),
    );
    return res.data.data;
  },

  /**
   * **Tạo SKU** — sinh toàn bộ tổ hợp từ trục biến thể đã lưu.
   *
   * 🔴 Endpoint DUY NHẤT ghi vào bảng SKU. Lưu template không còn sinh SKU nữa.
   */
  async generateSkuItems(templateId: string, resetEdits = false): Promise<PodSkuTemplate> {
    const res = await apiClient.post<ApiResponse<PodSkuTemplate>>(
      `${TEMPLATES}/skus/${templateId}/generate`,
      { resetEdits },
    );
    return res.data.data;
  },

  async removeSkuItem(templateId: string, itemId: string): Promise<PodSkuTemplate> {
    const res = await apiClient.delete<ApiResponse<PodSkuTemplate>>(
      `${TEMPLATES}/skus/${templateId}/items/${itemId}`,
    );
    return res.data.data;
  },

  async updateSkuItem(
    templateId: string,
    itemId: string,
    payload: Record<string, unknown>,
  ): Promise<PodSkuTemplate> {
    const res = await apiClient.patch<ApiResponse<PodSkuTemplate>>(
      `${TEMPLATES}/skus/${templateId}/items/${itemId}`,
      clean(payload),
    );
    return res.data.data;
  },

  /** Tải bảng SKU về dạng .xlsx để sửa hàng loạt trong Excel. */
  async exportSkuItems(templateId: string, filename: string): Promise<void> {
    const res = await apiClient.get<Blob>(`${TEMPLATES}/skus/${templateId}/items/export`, {
      responseType: 'blob',
    });
    triggerDownload(new Blob([res.data], { type: XLSX_MIME }), filename);
  },

  async importSkuItems(templateId: string, file: File): Promise<PodSkuImportResult> {
    const form = new FormData();
    form.append('file', file);
    const res = await apiClient.post<ApiResponse<PodSkuImportResult>>(
      `${TEMPLATES}/skus/${templateId}/items/import`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  // ------------- Phạm vi áp dụng (Template → nhiều Product) -------------

  /** Những sản phẩm mà một Listing Template đang bao phủ. */
  async scopedProducts(
    listingTemplateId: string,
    query: { page?: number; limit?: number; search?: string } = {},
  ): Promise<PodTemplateListResult<PodScopedProduct>> {
    const res = await apiClient.get<ApiResponse<PodTemplateListResult<PodScopedProduct>>>(
      `${POD}/listing-templates/${listingTemplateId}/products`,
      { params: clean(query as Record<string, unknown>) },
    );
    return res.data.data;
  },

  async scopedProductCount(listingTemplateId: string): Promise<number> {
    const res = await apiClient.get<ApiResponse<{ total: number }>>(
      `${POD}/listing-templates/${listingTemplateId}/products/count`,
    );
    return res.data.data.total;
  },

  /** Chạy thử template trên vài sản phẩm thật — KHÔNG ghi database. */
  async dryRun(
    listingTemplateId: string,
    payload: { limit?: number; productIds?: string[] } = {},
  ): Promise<PodDryRunResult> {
    const res = await apiClient.post<ApiResponse<PodDryRunResult>>(
      `${POD}/listing-templates/${listingTemplateId}/dry-run`,
      clean(payload as Record<string, unknown>),
    );
    return res.data.data;
  },

  // ------------------- Bộ ảnh mẫu (gallery mockup) ---------------------

  /**
   * Tải NHIỀU ảnh vào bộ cùng lúc.
   *
   * File đi thẳng lên R2 qua backend; `assetTypes` và `titles` đi **theo đúng thứ tự file**
   * để mỗi ảnh giữ được loại người dùng đã chọn cho chính nó.
   */
  async uploadImageItems(
    templateId: string,
    files: File[],
    meta: { assetTypes?: string[]; titles?: string[] } = {},
  ): Promise<PodImageTemplate> {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    for (const assetType of meta.assetTypes ?? []) form.append('assetTypes', assetType);
    for (const title of meta.titles ?? []) form.append('titles', title);

    const res = await apiClient.post<ApiResponse<PodImageTemplate>>(
      `${TEMPLATES}/images/${templateId}/items`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  async updateImageItem(
    templateId: string,
    itemId: string,
    payload: { title?: string; assetType?: string; isRequired?: boolean },
  ): Promise<PodImageTemplate> {
    const res = await apiClient.patch<ApiResponse<PodImageTemplate>>(
      `${TEMPLATES}/images/${templateId}/items/${itemId}`,
      payload,
    );
    return res.data.data;
  },

  /** Thay ảnh của một dòng — giữ nguyên tiêu đề, loại và vị trí. */
  async replaceImageItem(
    templateId: string,
    itemId: string,
    file: File,
  ): Promise<PodImageTemplate> {
    const form = new FormData();
    form.append('file', file);

    const res = await apiClient.put<ApiResponse<PodImageTemplate>>(
      `${TEMPLATES}/images/${templateId}/items/${itemId}/file`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  async removeImageItem(templateId: string, itemId: string): Promise<PodImageTemplate> {
    const res = await apiClient.delete<ApiResponse<PodImageTemplate>>(
      `${TEMPLATES}/images/${templateId}/items/${itemId}`,
    );
    return res.data.data;
  },

  /** Thứ tự mới sau khi kéo thả — gửi TRỌN danh sách id. */
  async sortImageItems(templateId: string, itemIds: string[]): Promise<PodImageTemplate> {
    const res = await apiClient.patch<ApiResponse<PodImageTemplate>>(
      `${TEMPLATES}/images/${templateId}/items/sort`,
      { itemIds },
    );
    return res.data.data;
  },

  async setDefaultImageTemplate(templateId: string): Promise<PodImageTemplate> {
    const res = await apiClient.post<ApiResponse<PodImageTemplate>>(
      `${TEMPLATES}/images/${templateId}/default`,
    );
    return res.data.data;
  },

  // ----------------------- Description preview -------------------------

  /** Xem trước mô tả đã thay token — KHÔNG ghi database. */
  async previewDescription(payload: {
    contentHtml: string;
    tokens?: Array<{ code: string; value: string }>;
    productId?: string;
  }): Promise<PodDescriptionPreview> {
    const res = await apiClient.post<ApiResponse<PodDescriptionPreview>>(
      `${TEMPLATES}/descriptions/preview`,
      clean(payload as Record<string, unknown>),
    );
    return res.data.data;
  },

  // ------------------------ Preview & Draft ----------------------------
  // ⏸️ Tạm dừng phát triển — giữ nguyên để màn hình cũ còn chạy.

  async preview(payload: {
    listingTemplateId: string;
    productId: string;
    shopId: string;
    imageTemplateId?: string;
  }): Promise<PreviewResult> {
    const res = await apiClient.post<ApiResponse<PreviewResult>>(
      `${POD}/listing-preview`,
      clean(payload),
    );
    return res.data.data;
  },

  async generateDrafts(payload: GenerateDraftPayload): Promise<GenerateDraftResult> {
    const res = await apiClient.post<ApiResponse<GenerateDraftResult>>(
      `${POD}/draft-listings/generate`,
      payload,
    );
    return res.data.data;
  },

  async draftListings(query: PodDraftListingQuery) {
    const res = await apiClient.get<ApiResponse<PodTemplateListResult<PodDraftListing>>>(
      `${POD}/draft-listings`,
      { params: clean(query as Record<string, unknown>) },
    );
    return res.data.data;
  },

  async draftListing(id: string): Promise<PodDraftListingDetail> {
    const res = await apiClient.get<ApiResponse<PodDraftListingDetail>>(
      `${POD}/draft-listings/${id}`,
    );
    return res.data.data;
  },

  /**
   * Bỏ một Draft Listing.
   *
   * `remote = true` xoá luôn Draft Product bên TikTok — nếu không thì Seller Center còn lại
   * một Draft mồ côi mà hệ thống không còn theo dõi.
   */
  async removeDraft(id: string, remote = false): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`${POD}/draft-listings/${id}`, {
      params: remote ? { remote: 'true' } : undefined,
    });
  },

  // ------------------------- Bulk Listing Engine ------------------------
  // 🔴 `createJob` là endpoint DUY NHẤT ghi dữ liệu lên TikTok — và chỉ tạo Draft Product
  // (`save_mode = AS_DRAFT`). Không có hàm publish nào ở đây, đúng phạm vi sprint.

  async createJob(payload: CreateListingJobPayload): Promise<PodListingJob> {
    const res = await apiClient.post<ApiResponse<PodListingJob>>(
      JOBS,
      clean(payload as unknown as Record<string, unknown>),
    );
    return res.data.data;
  },

  async jobs(query: PodListingJobQuery = {}) {
    const res = await apiClient.get<ApiResponse<PodTemplateListResult<PodListingJob>>>(JOBS, {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  async job(id: string): Promise<PodListingJob> {
    const res = await apiClient.get<ApiResponse<PodListingJob>>(`${JOBS}/${id}`);
    return res.data.data;
  },

  async jobItems(id: string, query: PodListingJobItemQuery = {}) {
    const res = await apiClient.get<ApiResponse<PodTemplateListResult<PodListingJobItem>>>(
      `${JOBS}/${id}/items`,
      { params: clean(query as Record<string, unknown>) },
    );
    return res.data.data;
  },

  async jobLogs(id: string, query: { itemId?: string; limit?: number } = {}) {
    const res = await apiClient.get<ApiResponse<PodTemplateListResult<PodListingLog>>>(
      `${JOBS}/${id}/logs`,
      { params: clean(query as Record<string, unknown>) },
    );
    return res.data.data;
  },

  async retryJob(id: string, itemIds?: string[]): Promise<PodListingJob> {
    const res = await apiClient.post<ApiResponse<PodListingJob>>(
      `${JOBS}/${id}/retry`,
      itemIds?.length ? { itemIds } : {},
    );
    return res.data.data;
  },

  async cancelJob(id: string): Promise<PodListingJob> {
    const res = await apiClient.post<ApiResponse<PodListingJob>>(`${JOBS}/${id}/cancel`, {});
    return res.data.data;
  },

  async removeJob(id: string): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`${JOBS}/${id}`);
  },

  /** Publish History — mỗi dòng là một lần thử thật, có thời lượng và mã lỗi. */
  async publishHistory(query: {
    page?: number;
    limit?: number;
    status?: string;
    shopId?: string;
    type?: string;
  }) {
    const res = await apiClient.get<ApiResponse<PodTemplateListResult<PodListingJobItem>>>(
      `${JOBS}/history`,
      { params: clean(query as Record<string, unknown>) },
    );
    return res.data.data;
  },

  // ---------------------------- Publish Engine --------------------------
  // 🔴 `publishDrafts` là endpoint DUY NHẤT đưa hàng lên sàn (`save_mode = LISTING`). Nó
  // KHÔNG tạo sản phẩm mới cho Draft đã có trên TikTok — server đi đường Edit Product.

  async publishDrafts(payload: PublishDraftsPayload): Promise<PublishJobResult> {
    const res = await apiClient.post<ApiResponse<PublishJobResult>>(
      `${JOBS}/publish`,
      clean(payload as unknown as Record<string, unknown>),
    );
    return res.data.data;
  },

  /** Đọc lại trạng thái duyệt ngay, không đợi scheduler 5 phút. Lời gọi CHỈ ĐỌC. */
  async syncReviewStatus(draftIds?: string[]): Promise<ReviewSyncResult> {
    const res = await apiClient.post<ApiResponse<ReviewSyncResult>>(
      `${JOBS}/review-sync`,
      draftIds?.length ? { draftIds } : {},
    );
    return res.data.data;
  },

  /** Đếm listing đã publish theo trạng thái duyệt (thẻ tổng quan). */
  async reviewSummary(): Promise<Record<PodReviewStatus, number>> {
    const res = await apiClient.get<ApiResponse<Record<PodReviewStatus, number>>>(
      `${JOBS}/review-summary`,
    );
    return res.data.data;
  },

  /** Upload ảnh/video cho template qua Storage Module (Cloudflare R2). */
  /**
   * Metadata của một file đã upload — dùng khi MỞ LẠI template: database chỉ lưu `fileId`,
   * còn tên file và link xem trước thì phải hỏi Storage Module.
   */
  async assetById(id: string): Promise<PodStorageFileRef> {
    const res = await apiClient.get<ApiResponse<PodStorageFileRef>>(`/storage/${id}`);
    return res.data.data;
  },

  async uploadAsset(file: File): Promise<{ id: string; publicUrl: string | null; originalName: string }> {
    const form = new FormData();
    form.append('files', file);
    form.append('module', 'POD_TIKTOK');
    form.append('referenceType', 'POD_LISTING_ASSET');

    const res = await apiClient.post<
      ApiResponse<{ files: Array<{ id: string; publicUrl: string | null; originalName: string }> }>
    >('/storage/upload', form, { headers: { 'Content-Type': undefined } });
    return res.data.data.files[0];
  },
};

/**
 * Bộ thao tác dùng chung cho MỌI loại template.
 *
 * Cả sáu loại có cùng hình dạng endpoint (`GET /`, `GET /:id`, `POST /`, `PATCH /:id`,
 * `DELETE /:id`, `POST /:id/clone`, `GET /export`, `POST /import`) ⇒ viết một lần, dùng
 * lại — thêm loại template mới chỉ là thêm một dòng.
 */
function crud<T>(basePath: string, kind: PodTemplateBundleKind) {
  return {
    kind,

    async list(query: PodTemplateQuery = {}): Promise<PodTemplateListResult<T>> {
      const res = await apiClient.get<ApiResponse<PodTemplateListResult<T>>>(basePath, {
        params: clean(query as Record<string, unknown>),
      });
      return res.data.data;
    },

    async get(id: string): Promise<T> {
      const res = await apiClient.get<ApiResponse<T>>(`${basePath}/${id}`);
      return res.data.data;
    },

    async create(payload: Record<string, unknown>): Promise<T> {
      const res = await apiClient.post<ApiResponse<T>>(basePath, clean(payload));
      return res.data.data;
    },

    async update(id: string, payload: Record<string, unknown>): Promise<T> {
      const res = await apiClient.patch<ApiResponse<T>>(`${basePath}/${id}`, clean(payload));
      return res.data.data;
    },

    async remove(id: string): Promise<void> {
      await apiClient.delete<ApiResponse<null>>(`${basePath}/${id}`);
    },

    async clone(id: string, name?: string): Promise<T> {
      const res = await apiClient.post<ApiResponse<T>>(
        `${basePath}/${id}/clone`,
        clean({ name } as Record<string, unknown>),
      );
      return res.data.data;
    },

    /** Tải gói JSON về máy — dùng lại được ở tổ chức khác. */
    async exportBundle(query: PodTemplateQuery = {}): Promise<PodTemplateBundle> {
      const res = await apiClient.get<ApiResponse<PodTemplateBundle>>(`${basePath}/export`, {
        params: clean(query as Record<string, unknown>),
      });
      return res.data.data;
    },

    async download(query: PodTemplateQuery = {}, filename?: string): Promise<PodTemplateBundle> {
      const bundle = await this.exportBundle(query);
      triggerDownload(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
        filename ?? `${kind.toLowerCase()}-templates.json`,
      );
      return bundle;
    },

    async importBundle(bundle: PodTemplateBundle): Promise<PodTemplateImportResult> {
      const res = await apiClient.post<ApiResponse<PodTemplateImportResult>>(`${basePath}/import`, {
        version: bundle.version,
        kind: bundle.kind,
        items: bundle.items,
      });
      return res.data.data;
    },
  };
}
