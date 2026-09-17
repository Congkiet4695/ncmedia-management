import type { PaginationParams } from '@/types/api';
import type { PodListingJob, PodListingMarket } from '@/features/pod-listing/types';

/**
 * **Listing Session** — một lượt đăng hàng: Market + Shops + 5 Template + Draft Product.
 *
 * 🔴 Draft Product KHÔNG phải module riêng: nó chỉ tồn tại bên trong một session, và mọi
 * đường dẫn tới nó đều đi qua `/pod/listing-sessions/:id/products`.
 */
export const POD_SESSION_STATUSES = [
  'DRAFT',
  'READY',
  'LISTING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
] as const;
export type PodSessionStatus = (typeof POD_SESSION_STATUSES)[number];

export const POD_SESSION_PRODUCT_STATUSES = [
  'DRAFT',
  'READY',
  'QUEUED',
  'UPLOADED',
  'PUBLISHED',
  'FAILED',
  'SKIPPED',
] as const;
export type PodSessionProductStatus = (typeof POD_SESSION_PRODUCT_STATUSES)[number];

export const POD_SESSION_TEMPLATE_TYPES = [
  'CATEGORY',
  'SKU',
  'DESCRIPTION',
  'IMAGE',
  'PRICING',
] as const;
export type PodSessionTemplateType = (typeof POD_SESSION_TEMPLATE_TYPES)[number];

export const POD_SESSION_IMAGE_TYPES = ['MAIN', 'VARIANT', 'DESCRIPTION', 'SIZE_CHART'] as const;
export type PodSessionImageType = (typeof POD_SESSION_IMAGE_TYPES)[number];

export interface PodSessionIssue {
  level: 'ERROR' | 'WARNING';
  code: string;
  field: string;
  message: string;
}

/** Một dòng template của session — đúng một cột khoá ngoại có giá trị. */
export interface PodSessionTemplateRow {
  id: string;
  templateType: PodSessionTemplateType;
  templateName: string | null;
  categoryTemplateId: string | null;
  skuTemplateId: string | null;
  descriptionTemplateId: string | null;
  imageTemplateId: string | null;
  pricingStrategyId: string | null;
}

/** Số Draft Product theo trạng thái — nguồn của mọi con số trên màn hình. */
export type PodSessionCounts = Record<PodSessionProductStatus | 'TOTAL', number>;

export interface PodListingSession {
  id: string;
  name: string;
  market: PodListingMarket;
  status: PodSessionStatus;
  note: string | null;
  sourceFile: string | null;
  importedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  platform: { id: string; code: string; name: string };
  shops: Array<{ shopId: string; shop: { id: string; name: string; region: string } }>;
  templates: PodSessionTemplateRow[];
  counts: PodSessionCounts;
}

export interface PodListingSessionDetail extends PodListingSession {
  /** Lượt chạy gần nhất của session (nếu đã bấm Start Listing). */
  lastJob: {
    id: string;
    name: string;
    status: PodListingJob['status'];
    totalItems: number;
    successItems: number;
    failedItems: number;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    lastError: string | null;
  } | null;
}

export interface PodSessionImage {
  id: string;
  imageUrl: string;
  imageType: PodSessionImageType;
  sortOrder: number;
  fileId: string | null;
  remoteUri: string | null;
}

/** Kết quả đăng của MỘT sản phẩm lên MỘT shop (đọc từ Listing Job Item). */
export interface PodSessionProductResult {
  shopId: string;
  status: string;
  remoteProductId: string | null;
  error: string | null;
  shop: { id: string; name: string } | null;
}

/**
 * Draft Product — **chỉ có tiêu đề và danh sách ảnh gốc**.
 *
 * Mô tả, biến thể, giá, tồn, danh mục, thuộc tính đều được dựng từ bộ template của lượt đăng
 * lúc Start Listing, nên file import chỉ cần 11 cột (`title` + `URL1..URL10`).
 */
export interface PodSessionProduct {
  id: string;
  sessionId: string;
  title: string;
  sourceRow: number | null;
  status: PodSessionProductStatus;
  issues: PodSessionIssue[] | null;
  errorCount: number;
  uploadError: string | null;
  uploadedAt: string | null;
  /** Thứ tự dòng trong file import, cộng dồn qua các lần import bổ sung. */
  importOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Ảnh gốc theo đúng thứ tự URL1 → URL10; phần tử đầu là thumbnail. */
  images: PodSessionImage[];
  /** Chỉ có ở danh sách — kết quả trên từng shop. */
  results?: PodSessionProductResult[];
  /** Dữ liệu nhập tay đã lưu. NULL = sản phẩm này lấy toàn bộ nội dung từ template. */
  manualData: ManualListingData | null;
}

export interface PodSessionQuery extends PaginationParams {
  search?: string;
  status?: PodSessionStatus;
  market?: PodListingMarket;
  shopId?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface PodSessionProductQuery extends PaginationParams {
  search?: string;
  status?: PodSessionProductStatus;
  sortBy?: 'importOrder' | 'createdAt' | 'title' | 'status';
  sortOrder?: 'asc' | 'desc';
}

/** Bộ 5 template của một lượt đăng. Ô để trống = không dùng template loại đó. */
export interface PodSessionTemplateSelection {
  categoryTemplateId?: string | null;
  skuTemplateId?: string | null;
  descriptionTemplateId?: string | null;
  imageTemplateId?: string | null;
  pricingStrategyId?: string | null;
}

export interface CreateSessionPayload {
  name: string;
  market: PodListingMarket;
  shopIds?: string[];
  templates?: PodSessionTemplateSelection;
  note?: string;
}

export interface UpdateSessionPayload {
  name?: string;
  market?: PodListingMarket;
  shopIds?: string[];
  templates?: PodSessionTemplateSelection;
  note?: string;
}

/** Sửa một Draft Product — `images` gửi lên là THAY TOÀN BỘ. */
/** Một giá trị trục đã chọn cho một SKU (`Color: Black`). */
export interface ManualSkuOption {
  name: string;
  value: string;
}

/** Một trục biến thể (`Color: Black, White, Navy`). */
export interface ManualVariation {
  name: string;
  values: string[];
}

/**
 * Một dòng bảng SKU nhập tay.
 *
 * 🔴 Giá là CHUỖI, không phải `number`: đây là số tiền, và phép cộng dấu phẩy động của
 * JavaScript không có chỗ ở đây. Cả hệ thống đã dùng chuỗi cho tiền.
 */
export interface ManualSku {
  sellerSku: string;
  optionValues: ManualSkuOption[];
  /** Giá bán thực tế — TikTok `sale_price`. Cột "Retail price" trên lưới. */
  salePrice?: string;
  /** Giá gạch ngang — TikTok `original_price`. Cột "List price". */
  retailPrice?: string;
  quantity?: number;
  imageFileId?: string;
  barcode?: string;
}

/**
 * Dữ liệu NHẬP TAY của một Draft Product — ghi đè template của lượt đăng, **theo từng trường**.
 *
 * 🔴 Trường vắng mặt = "dùng mẫu có sẵn", KHÔNG phải "xoá". Đây là hợp đồng của màn hình:
 * mỗi khu vực có công tắc riêng "Dùng mẫu / Nhập tay", và chỉ khu vực đang ở chế độ Nhập tay
 * mới gửi trường của nó lên.
 */
export interface ManualListingData {
  /** HTML từ rich text editor. Chuỗi rỗng = cố ý xoá mô tả (Validate sẽ chặn). */
  description?: string;
  category?: ManualCategory;
  brand?: ManualBrand;
  /** Gửi mảng là THAY TOÀN BỘ bộ thuộc tính của Category Template. */
  attributes?: ManualAttribute[];
  /** Ghi đè TỪNG trường lên template. */
  package?: ManualPackage;
  /** Video sản phẩm. Publisher upload lên TikTok rồi gửi `video.id` — form chỉ giữ `fileId`. */
  video?: ManualVideo;
  /** Trục biến thể — lưu để mở lại nháp dựng đúng lưới đã sinh. */
  variations?: ManualVariation[];
  /** Bảng SKU — gửi mảng là THAY TOÀN BỘ biến thể của SKU Template. */
  skus?: ManualSku[];
}

export interface ManualCategory {
  tiktokCategoryId: string;
  name?: string | null;
  path?: string | null;
}

export interface ManualBrand {
  /** Bỏ trống = No brand (mặc định của hàng POD). */
  tiktokBrandId?: string | null;
  name?: string | null;
}

export interface ManualAttribute {
  tiktokAttributeId: string;
  name?: string;
  type?: string;
  isRequired?: boolean;
  values?: Array<{ id?: string; name?: string }>;
  customValues?: string[];
}

export interface ManualPackage {
  weight?: string;
  weightUnit?: string;
  length?: string;
  width?: string;
  height?: string;
  dimensionUnit?: string;
}

/** Payload của **Add Custom Listing** — lượt đăng một sản phẩm nhập tay. */
export interface CreateCustomListingPayload {
  name?: string;
  market: PodListingMarket;
  shopIds: string[];
  templates?: CreateSessionPayload['templates'];
  product: CreateSessionProductPayload;
}

/**
 * Một ảnh trong form trước khi gửi lên.
 *
 * `fileName` chỉ để hiển thị — backend không nhận trường này, `buildImagesPayload` gỡ ra.
 */
export interface SessionImageInput {
  imageUrl: string;
  fileId?: string;
  imageType: PodSessionImageType;
  fileName?: string;
  /**
   * `uri` phía TikTok — CHỈ có với ảnh đang nằm trên một sản phẩm đã đăng (màn hình Sửa sản
   * phẩm). Ảnh nào có sẵn `uri` thì không phải upload lại; luồng Custom Listing không dùng
   * trường này vì sản phẩm chưa tồn tại trên sàn.
   */
  uri?: string;
}

/** Video sản phẩm — file trong Storage Module. TikTok nhận `video.id` sau khi publisher upload. */
export interface ManualVideo {
  /**
   * File trong Storage Module.
   *
   * 🔴 Rỗng khi đây là video ĐANG nằm trên sản phẩm TikTok (màn hình Sửa sản phẩm): nó chưa
   * bao giờ đi qua Storage của ta. Nơi gọi chỉ được gửi video lên sàn khi trường này có giá
   * trị — bằng không là gửi một file không tồn tại.
   */
  fileId?: string;
  fileName?: string | null;
  /** Link xem video hiện tại (nếu TikTok có trả về). */
  url?: string | null;
}

export interface CreateSessionProductPayload {
  title: string;
  images?: Array<{ imageUrl: string; imageType?: PodSessionImageType; sortOrder?: number }>;
  manualData?: ManualListingData;
}

export interface UpdateSessionProductPayload {
  title?: string;
  images?: Array<{ imageUrl: string; imageType?: PodSessionImageType; sortOrder?: number }>;
  /** Gửi object là THAY TOÀN BỘ phần nhập tay; bỏ trống là giữ nguyên. */
  manualData?: ManualListingData;
}

export type PodSessionImportMode = 'APPEND' | 'REPLACE';

export interface PodSessionImportResult {
  sessionId: string;
  fileName: string;
  mode: PodSessionImportMode;
  totalRows: number;
  createdProducts: number;
  createdImages: number;
  replacedProducts: number;
  skippedRows: number;
  errors: Array<{ row: number; message: string }>;
  productIds: string[];
}

export interface PodSessionValidation {
  sessionId: string;
  ok: boolean;
  issues: PodSessionIssue[];
  products: Array<{ id: string; title: string; ok: boolean; issues: PodSessionIssue[] }>;
  readyProducts: number;
}

export interface StartSessionListingResult {
  job: PodListingJob;
  started: number;
  targets: number;
  validation: PodSessionValidation;
}
