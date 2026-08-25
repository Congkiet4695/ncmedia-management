import type { Paginated, PaginationParams } from '@/types/api';

/** Sales Market — khớp enum `PodListingMarket` của backend. */
export const POD_LISTING_MARKETS = [
  'US',
  'UK',
  'EU',
  'AU',
  'DE',
  'FR',
  'IT',
  'ES',
  'IE',
  'JP',
  'SG',
  'MY',
  'TH',
  'VN',
  'PH',
  'ID',
  'BR',
  'MX',
] as const;
export type PodListingMarket = (typeof POD_LISTING_MARKETS)[number];

/**
 * Tiền tệ theo thị trường — nguồn cho ô chọn Currency của SKU Template.
 *
 * 🔴 Chỉ là bảng tra để **gợi ý** đúng mã tiền tệ; ký hiệu ($, £, ₫) do `Intl` dựng từ mã
 * chứ không viết cứng ở đâu cả. Mở thị trường mới ⇒ thêm một dòng ở đây là xong.
 */
export const POD_MARKET_CURRENCIES: ReadonlyArray<{
  currency: string;
  markets: PodListingMarket[];
}> = [
  { currency: 'USD', markets: ['US'] },
  { currency: 'GBP', markets: ['UK', 'IE'] },
  { currency: 'EUR', markets: ['EU', 'DE', 'FR', 'IT', 'ES'] },
  { currency: 'AUD', markets: ['AU'] },
  { currency: 'JPY', markets: ['JP'] },
  { currency: 'SGD', markets: ['SG'] },
  { currency: 'MYR', markets: ['MY'] },
  { currency: 'THB', markets: ['TH'] },
  { currency: 'VND', markets: ['VN'] },
  { currency: 'PHP', markets: ['PH'] },
  { currency: 'IDR', markets: ['ID'] },
  { currency: 'BRL', markets: ['BR'] },
  { currency: 'MXN', markets: ['MX'] },
];

/** Loại tài sản trong Image Template. */
/** Vai trò của một tấm ảnh trong bộ ảnh mẫu (mockup) của phôi. */
export const POD_IMAGE_ASSET_TYPES = [
  'MAIN_FRONT',
  'MAIN_BACK',
  'LIFESTYLE',
  'DETAIL',
  'SIZE_CHART',
  'PACKAGING',
  'CUSTOM',
] as const;
export type PodImageAssetType = (typeof POD_IMAGE_ASSET_TYPES)[number];

export const POD_PRICING_MARKUP_TYPES = ['PERCENT', 'FIXED', 'FORMULA'] as const;
export type PodPricingMarkupType = (typeof POD_PRICING_MARKUP_TYPES)[number];

export const POD_PRICE_ADJUSTMENT_TYPES = ['NONE', 'AMOUNT', 'PERCENT'] as const;
export type PodPriceAdjustmentType = (typeof POD_PRICE_ADJUSTMENT_TYPES)[number];

/** Cách một Listing Template chọn tập sản phẩm mà nó áp dụng. */
export const POD_LISTING_SCOPE_MATCHES = [
  'ALL',
  'CATEGORY',
  'BRAND',
  'SHOP',
  'TITLE_KEYWORD',
  'SELLER_SKU_PREFIX',
  'PRODUCT_STATUS',
] as const;
export type PodListingScopeMatch = (typeof POD_LISTING_SCOPE_MATCHES)[number];

/** Biến dùng được trong công thức giá — khớp `POD_PRICING_FORMULA_VARIABLES` của backend. */
export const POD_PRICING_FORMULA_VARIABLES = ['cost', 'shipping', 'base', 'markup'] as const;

/** Cột sắp xếp — khớp whitelist `POD_TEMPLATE_SORT_FIELDS` của backend. */
export const POD_TEMPLATE_SORT_FIELDS = [
  'displayOrder',
  'name',
  'createdAt',
  'updatedAt',
] as const;
export type PodTemplateSortField = (typeof POD_TEMPLATE_SORT_FIELDS)[number];

export const POD_DRAFT_STATUSES = [
  'DRAFT',
  'READY',
  'PUBLISHING',
  /** Đã tạo Draft Product trên TikTok, CHƯA đăng bán — đích của Bulk Listing Engine. */
  'TIKTOK_DRAFT',
  'PUBLISHED',
  'FAILED',
  'ARCHIVED',
] as const;
export type PodDraftStatus = (typeof POD_DRAFT_STATUSES)[number];

export interface PodTemplateQuery extends PaginationParams {
  search?: string;
  market?: PodListingMarket;
  activeOnly?: boolean;
  defaultOnly?: boolean;
  sortBy?: PodTemplateSortField;
  sortOrder?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Dữ liệu TikTok đã đồng bộ (chỉ đọc — nguồn cho các bộ chọn)
// ---------------------------------------------------------------------------

export interface PodSyncedCategory {
  id: string;
  tiktokCategoryId: string;
  localName: string | null;
  path: string | null;
  level: number;
  isLeaf: boolean;
  syncedAt: string;
  shop: { id: string; name: string } | null;
}

/**
 * Thuộc tính của một danh mục — nguồn để form Category Template render ĐỘNG.
 * 🔴 Frontend không hardcode thuộc tính nào; tất cả đến từ đây.
 */
export interface PodCategoryAttributeDef {
  id: string;
  tiktokAttributeId: string;
  name: string | null;
  /** PRODUCT_PROPERTY (Product Attributes) hoặc SALES_PROPERTY (Sale Attributes). */
  type: string | null;
  isRequired: boolean;
  isMultipleSelection: boolean;
  isCustomizable: boolean;
  valueDataFormat: string | null;
  values: Array<{ id?: string; name?: string }> | null;
}

export interface PodSyncedBrand {
  id: string;
  tiktokBrandId: string;
  name: string | null;
  authorizedStatus: string | null;
  brandStatus: string | null;
  /** 🔴 "No brand" — lựa chọn hợp lệ của TikTok, luôn đứng đầu danh sách. */
  isNoBrand: boolean;
  /** Bản ghi do hệ thống tạo vì `Get Brands` không liệt kê "No brand". */
  isSystem: boolean;
  syncedAt: string;
  shop: { id: string; name: string } | null;
}

/** Tham số tìm brand — tìm phía SERVER vì danh sách có thể hàng chục nghìn dòng. */
export interface PodBrandQuery {
  shopId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface PodWarehouse {
  id: string;
  tiktokWarehouseId: string;
  name: string | null;
  type: string | null;
  effectStatus: string | null;
  isDefault: boolean;
  regionCode: string | null;
  syncedAt: string;
  shop: { id: string; name: string; region: string } | null;
}

export interface PodStorageFileRef {
  id: string;
  publicUrl: string | null;
  originalName: string;
}

// ---------------------------------------------------------------------------
// Category Template
// ---------------------------------------------------------------------------

export interface PodCategoryTemplateAttributeValue {
  id?: string;
  tiktokValueId: string;
  valueName?: string | null;
  sortOrder?: number;
}

export interface PodCategoryTemplateAttribute {
  id?: string;
  tiktokAttributeId: string;
  attributeName?: string | null;
  attributeType?: string | null;
  isRequired?: boolean;
  isMultipleSelection?: boolean;
  isCustomizable?: boolean;
  values: PodCategoryTemplateAttributeValue[];
  /**
   * Giá trị người dùng tự nhập — bảng riêng, KHÔNG trộn với giá trị chính thức của TikTok.
   * Chỉ có với thuộc tính `isCustomizable`.
   */
  customValues: PodCategoryTemplateAttributeCustomValue[];
  sortOrder?: number;
}

export interface PodCategoryTemplateAttributeCustomValue {
  id?: string;
  value: string;
  displayOrder?: number;
}

export interface PodCategoryTemplate {
  id: string;
  name: string;
  market: PodListingMarket;
  tiktokCategoryId: string;
  categoryName: string | null;
  categoryPath: string | null;
  tiktokBrandId: string | null;
  brandName: string | null;
  warehouseId: string | null;
  packageWeight: string | null;
  weightUnit: string | null;
  packageLength: string | null;
  packageWidth: string | null;
  packageHeight: string | null;
  dimensionUnit: string | null;
  sizeChartFileId: string | null;
  videoFileId: string | null;
  isDefault: boolean;
  isActive: boolean;
  displayOrder: number;
  note: string | null;
  attributes: PodCategoryTemplateAttribute[];
  warehouse?: { id: string; name: string | null; tiktokWarehouseId: string } | null;
  createdAt: string;
  _count?: { listingTemplates: number };
}

// ---------------------------------------------------------------------------
// SKU Template
// ---------------------------------------------------------------------------

export interface PodSkuTemplateVariantValue {
  id?: string;
  value: string;
  code?: string | null;
  sortOrder?: number;
}

/** MỘT trục biến thể (Color, Size, Style…) — số trục do người dùng quyết định. */
export interface PodSkuTemplateVariant {
  id?: string;
  name: string;
  sortOrder?: number;
  values: PodSkuTemplateVariantValue[];
}

/** MỘT tổ hợp đã sinh = một SKU sẽ đăng bán. */
export interface PodSkuTemplateItem {
  id: string;
  variantName: string;
  skuCode: string | null;
  barcode: string | null;
  /** Quy tắc lệch giá so với Pricing Template — dùng chung được cho mọi sản phẩm. */
  priceAdjustmentType: PodPriceAdjustmentType;
  priceAdjustmentValue: string;
  /** Giá gốc (gạch ngang) do người dùng nhập. */
  retailPrice: string | null;
  /** Giá bán do người dùng nhập. */
  salePrice: string | null;
  quantity: number;
  /** Phần trăm giảm so với giá gốc. */
  discount: string | null;
  /**
   * 🔴 Giá bán **hiệu lực** — con số server sẽ gửi lên TikTok, tính bằng đúng hàm mà bộ giải
   * listing dùng (`resolveSkuItemPrice`). `null` = tổ hợp chưa tự khai giá, lúc dựng listing
   * sẽ lấy từ Pricing Template.
   */
  effectiveSalePrice?: string | null;
  /** Giá gạch ngang hiệu lực; `null` = không gạch ngang. */
  effectiveRetailPrice?: string | null;
  priceSource?: 'SALE_PRICE' | 'RETAIL_WITH_DISCOUNT' | 'RETAIL_PRICE' | 'NONE';
  imageFileId: string | null;
  isActive: boolean;
  sortOrder: number;
  image?: PodStorageFileRef | null;
  values?: Array<{
    variantValue: { id: string; value: string; variant: { id: string; name: string } };
  }>;
}

export interface PodSkuTemplate {
  id: string;
  name: string;
  variants: PodSkuTemplateVariant[];
  items: PodSkuTemplateItem[];
  skuPrefix: string | null;
  skuSuffix: string | null;
  defaultRetailPrice: string | null;
  defaultSalePrice: string | null;
  defaultQuantity: number;
  defaultDiscount: string | null;
  currency: string | null;
  isDefault: boolean;
  isActive: boolean;
  displayOrder: number;
  note: string | null;
  createdAt: string;
  /** Mốc sửa trục / mốc bấm "Tạo SKU" — nguồn của cảnh báo "cần tạo lại SKU". */
  axesUpdatedAt: string;
  itemsGeneratedAt: string | null;
  /** Số SKU sẽ sinh ra từ bộ trục hiện tại (Color 3 × Size 6 = 18). Server tính. */
  expectedItemCount: number;
  /** `true` = trục đã đổi sau lần Tạo SKU gần nhất ⇒ bảng SKU đang cũ. */
  isStale: boolean;
  _count?: { items: number; listingTemplates: number };
}

/** Điều kiện lọc theo trục cho Bulk Update ("chỉ sửa Color = Black"). */
export interface PodSkuItemFilter {
  variantName: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Description Template
// ---------------------------------------------------------------------------

export interface PodDescriptionTemplateToken {
  id?: string;
  code: string;
  label?: string | null;
  value: string;
  sortOrder?: number;
}

export interface PodDescriptionTemplate {
  id: string;
  name: string;
  contentHtml: string;
  tokens: PodDescriptionTemplateToken[];
  isDefault: boolean;
  isActive: boolean;
  displayOrder: number;
  note: string | null;
  createdAt: string;
  _count?: { listingTemplates: number };
}

export interface PodTokenDefinition {
  code: string;
  label: string;
  source: 'SYSTEM' | 'CUSTOM';
}

export interface PodDescriptionPreview {
  html: string;
  unknownTokens: string[];
}

// ---------------------------------------------------------------------------
// Image Template
// ---------------------------------------------------------------------------

/** MỘT TẤM ẢNH mockup đã upload lên R2. */
export interface PodImageTemplateItem {
  id: string;
  title: string;
  assetType: PodImageAssetType;
  fileId: string;
  imageUrl: string;
  imageKey: string;
  contentType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  isRequired: boolean;
  displayOrder: number;
  tiktokImageUri: string | null;
}

/** Bộ ảnh mẫu của một phôi — ảnh cố định, dùng lại cho hàng nghìn listing. */
export interface PodImageTemplate {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  displayOrder: number;
  items: PodImageTemplateItem[];
  createdAt: string;
  _count?: { listingTemplates: number };
}

// ---------------------------------------------------------------------------
// Pricing Strategy
// ---------------------------------------------------------------------------

export interface PodPricingStrategy {
  id: string;
  name: string;
  cost: string;
  shippingCost: string;
  markupType: PodPricingMarkupType;
  markupValue: string;
  formula: string | null;
  retailPriceMultiplier: string;
  discountPercent: string;
  roundingIncrement: string;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  displayOrder: number;
  note: string | null;
  createdAt: string;
  _count?: { listingTemplates: number };
}

// ---------------------------------------------------------------------------
// Listing Template
// ---------------------------------------------------------------------------

/** MỘT dòng quy tắc chọn sản phẩm — chiều Template → Product. */
export interface PodListingTemplateScope {
  id?: string;
  matchType: PodListingScopeMatch;
  value?: string | null;
  valueLabel?: string | null;
  isExclude: boolean;
}

/** Sản phẩm nằm trong phạm vi của một Listing Template. */
export interface PodScopedProduct {
  id: string;
  tiktokProductId: string;
  title: string | null;
  status: string | null;
  categoryName: string | null;
  brandName: string | null;
  skuCount: number;
  shop: { id: string; name: string; region: string } | null;
}

/** Kết quả chạy thử template trên một sản phẩm thật (không ghi database). */
export interface PodDryRunProduct {
  productId: string;
  title: string | null;
  tiktokProductId: string;
  ready: boolean;
  errorCount: number;
  warningCount: number;
  variantCount: number;
  imageCount: number;
  resolvedTitle: string;
  salePrice: string | null;
  issues: ResolveIssue[];
}

export interface PodDryRunResult {
  listingTemplateId: string;
  listingTemplateName: string;
  matchedProducts: number;
  testedProducts: number;
  readyProducts: number;
  products: PodDryRunProduct[];
}

export interface PodListingTemplate {
  id: string;
  name: string;
  market: PodListingMarket;
  categoryTemplateId: string | null;
  skuTemplateId: string | null;
  descriptionTemplateId: string | null;
  imageTemplateId: string | null;
  pricingStrategyId: string | null;
  warehouseId: string | null;
  tiktokBrandId: string | null;
  brandName: string | null;
  shippingTemplateId: string | null;
  handlingDays: number | null;
  packageWeight: string | null;
  weightUnit: string | null;
  packageLength: string | null;
  packageWidth: string | null;
  packageHeight: string | null;
  dimensionUnit: string | null;
  scopes: PodListingTemplateScope[];
  isDefault: boolean;
  isActive: boolean;
  displayOrder: number;
  note: string | null;
  createdAt: string;
  categoryTemplate?: { id: string; name: string; categoryName?: string | null } | null;
  skuTemplate?: { id: string; name: string; _count?: { items: number } } | null;
  descriptionTemplate?: { id: string; name: string } | null;
  imageTemplate?: { id: string; name: string; _count?: { slots: number } } | null;
  pricingStrategy?: { id: string; name: string; currency?: string } | null;
  warehouse?: { id: string; name: string | null } | null;
  _count?: { listingPayloads: number; scopes: number };
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

export type PodTemplateBundleKind =
  | 'CATEGORY'
  | 'SKU'
  | 'DESCRIPTION'
  | 'IMAGE'
  | 'PRICING'
  | 'LISTING';

export interface PodTemplateBundle {
  version: number;
  kind: PodTemplateBundleKind;
  exportedAt: string;
  count: number;
  items: Array<Record<string, unknown>>;
}

export interface PodTemplateImportResult {
  total: number;
  created: number;
  failed: number;
  errors: Array<{ index: number; name: string | null; message: string }>;
  warnings: string[];
}

/** Kết quả import Excel của bảng SKU — dùng chung `ImportResultDto` của backend. */
export interface PodSkuImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ sheet: string | null; row: number; field: string | null; message: string }>;
}

export type PodTemplateListResult<T> = Paginated<T>;

// ---------------------------------------------------------------------------
// Preview & Draft
//
// ⏸️ Auto Listing / Draft Listing / Publish ĐANG TẠM DỪNG phát triển (Sprint này chỉ làm
// Template Engine). Kiểu dữ liệu và màn hình vẫn giữ nguyên, chỉ ẩn khỏi menu — bật lại
// là chạy tiếp, không phải dựng lại.
// ---------------------------------------------------------------------------

export interface ResolveIssue {
  level: 'ERROR' | 'WARNING';
  field: string;
  code: string;
  message: string;
}

export interface ResolvedListing {
  market: string;
  title: string;
  description: string;
  category: { tiktokCategoryId: string | null; name: string | null; path: string | null };
  brand: { tiktokBrandId: string | null; name: string | null };
  attributes: Array<{
    tiktokAttributeId: string;
    name: string | null;
    type: string | null;
    isRequired: boolean;
    values: Array<{ id?: string; name?: string }>;
    customValue: string | null;
  }>;
  images: Array<{
    title: string;
    assetType: PodImageAssetType;
    fileId: string;
    url: string;
    imageKey: string;
    width: number | null;
    height: number | null;
    isRequired: boolean;
    tiktokImageUri: string | null;
    sortOrder: number;
  }>;
  package: {
    weight: string | null;
    weightUnit: string | null;
    length: string | null;
    width: string | null;
    height: string | null;
    dimensionUnit: string | null;
  };
  warehouse: { id: string | null; tiktokWarehouseId: string | null; name: string | null };
  shipping: { shippingTemplateId: string | null; handlingDays: number | null };
  pricing: {
    strategyName: string | null;
    currency: string | null;
    salePrice: string | null;
    retailPrice: string | null;
    finalPrice: string | null;
  } | null;
  variants: Array<{
    variantName: string;
    sellerSku: string;
    barcode: string | null;
    salePrice: string | null;
    retailPrice: string | null;
    currency: string | null;
    quantity: number;
  }>;
}

export interface PreviewResult {
  payload: ResolvedListing;
  issues: ResolveIssue[];
  payloadHash: string;
}

export interface GenerateDraftPayload {
  listingTemplateId: string;
  productIds: string[];
  shopIds: string[];
  imageTemplateId?: string;
  overrides?: Array<{ productId: string; listingTemplateId?: string; imageTemplateId?: string }>;
}

export interface GenerateDraftResult {
  created: number;
  updated: number;
  failed: number;
  withErrors: number;
  drafts: Array<{
    draftId: string | null;
    productId: string;
    shopId: string;
    status: string;
    errorCount: number;
    message?: string;
  }>;
}

/**
 * Trạng thái DUYỆT phía TikTok — trục KHÁC với `PodDraftStatus`.
 *
 * `status` nói "hệ thống đã gửi tới đâu", `reviewStatus` nói "TikTok đã xử lý tới đâu".
 * Một listing có thể `PUBLISHED` (đã gửi) mà `REJECTED` (bị từ chối) cùng lúc.
 */
export const POD_REVIEW_STATUSES = [
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'ACTIVE',
  'OFFLINE',
  'DELETED',
] as const;
export type PodReviewStatus = (typeof POD_REVIEW_STATUSES)[number];

export interface PodDraftListing {
  id: string;
  title: string | null;
  status: PodDraftStatus;
  market: PodListingMarket;
  errorCount: number;
  variantCount: number;
  /** Id nhận được khi tạo Draft trên TikTok. Có giá trị ⇒ publish đi đường Edit, không Create. */
  tiktokDraftId: string | null;
  tiktokProductId: string | null;
  publishedAt: string | null;
  publishError: string | null;
  publishRetryCount: number;
  reviewStatus: PodReviewStatus | null;
  reviewStatusRaw: string | null;
  reviewReason: string | null;
  reviewCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  shop?: { id: string; name: string; region?: string } | null;
  listingTemplate?: { id: string; name: string } | null;
  product?: { id: string; title: string | null; tiktokProductId: string } | null;
  /** Draft Product nguồn — mang thumbnail (ảnh đầu tiên của file import). */
  sessionProduct?: {
    id: string;
    title: string;
    status?: string;
    sessionId: string;
    images: Array<{ imageUrl: string }>;
  } | null;
  _count?: { items: number };
}

export interface PodDraftListingDetail extends PodDraftListing {
  payload: ResolvedListing;
  issues: ResolveIssue[];
  publishRequest: Record<string, unknown> | null;
  publishResponse: Record<string, unknown> | null;
  items: Array<{
    id: string;
    variantName: string;
    sellerSku: string;
    retailPrice: string | null;
    listPrice: string | null;
    currency: string | null;
    quantity: number;
    sortOrder: number;
  }>;
}

export interface PodDraftListingQuery extends PaginationParams {
  search?: string;
  status?: PodDraftStatus;
  shopId?: string;
  listingTemplateId?: string;
  market?: PodListingMarket;
  tiktokProductId?: string;
  reviewStatus?: PodReviewStatus;
  sessionId?: string;
  /** Chỉ những Draft ĐỦ ĐIỀU KIỆN publish — cùng bộ điều kiện mà server dùng. */
  publishable?: boolean;
}

/**
 * Tạo lượt Publish — hai nút của màn hình Draft Listing.
 *
 * `draftIds` có giá trị ⇒ **Publish Selected**. Bỏ trống ⇒ **Publish All** theo đúng bộ lọc
 * đang hiển thị; server tự chọn Draft đủ điều kiện thay vì bắt trình duyệt gửi lên 2.000 id.
 */
export interface PublishDraftsPayload {
  draftIds?: string[];
  sessionId?: string;
  shopId?: string;
  market?: PodListingMarket;
  /** Publish All — bộ lọc đang hiển thị, để server chọn đúng tập người dùng đang nhìn. */
  status?: PodDraftStatus;
  search?: string;
  name?: string;
}

/** Kết quả tạo lượt Publish: job để theo dõi + những Draft bị bỏ qua kèm LÝ DO. */
export interface PublishJobResult extends PodListingJob {
  skipped: Array<{ draftId: string; title: string | null; reason: string }>;
}

/** Kết quả một lượt đọc lại trạng thái duyệt. */
export interface ReviewSyncResult {
  checked: number;
  changed: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Bulk Listing Engine — Listing Job
// ---------------------------------------------------------------------------

export const POD_LISTING_JOB_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
] as const;
export type PodListingJobStatus = (typeof POD_LISTING_JOB_STATUSES)[number];

/** Lượt chạy làm gì với TikTok. */
export const POD_LISTING_JOB_TYPES = ['CREATE_DRAFT', 'PUBLISH'] as const;
export type PodListingJobType = (typeof POD_LISTING_JOB_TYPES)[number];

export const POD_LISTING_ITEM_STATUSES = [
  'PENDING',
  'PROCESSING',
  'RETRYING',
  'SUCCESS',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
] as const;
export type PodListingItemStatus = (typeof POD_LISTING_ITEM_STATUSES)[number];

export type PodListingLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface PodListingJob {
  id: string;
  name: string;
  market: PodListingMarket;
  /** CREATE_DRAFT (tạo Draft) hay PUBLISH (gửi duyệt). Lượt chạy cũ không có ⇒ CREATE_DRAFT. */
  type?: PodListingJobType;
  status: PodListingJobStatus;
  totalItems: number;
  successItems: number;
  failedItems: number;
  concurrency: number;
  maxRetries: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  lastError: string | null;
  createdAt: string;
  /** Listing Session đã bấm Start Listing. NULL khi lượt chạy đến từ sản phẩm đã đồng bộ. */
  sessionId?: string | null;
  session?: { id: string; name: string; status: string } | null;
  listingTemplate?: { id: string; name: string; market?: PodListingMarket } | null;
  imageTemplate?: { id: string; name: string } | null;
  /** Các shop có mặt trong lượt chạy — cột "Shop" của Publish History. */
  shops?: Array<{ id: string; name: string }>;
  /** Số item theo trạng thái — nguồn của thanh tiến độ. */
  counts?: Partial<Record<PodListingItemStatus, number>>;
}

export interface PodListingJobItem {
  id: string;
  status: PodListingItemStatus;
  remoteProductId: string | null;
  error: string | null;
  errorCode: string | null;
  retryCount: number;
  nextAttemptAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  product?: { id: string; title: string | null; tiktokProductId: string } | null;
  shop?: { id: string; name: string } | null;
  listingTemplate?: { id: string; name: string } | null;
  /** Payload đã giải (nội dung hệ thống đã gửi lên sàn). */
  payload?: {
    id: string;
    title: string | null;
    variantCount?: number;
    status: PodDraftStatus;
    tiktokDraftId?: string | null;
    tiktokProductId?: string | null;
    reviewStatus?: PodReviewStatus | null;
    reviewReason?: string | null;
    publishedAt?: string | null;
    /** Thân request Edit Product đã gửi — Publish History mở ra xem. */
    publishRequest?: Record<string, unknown> | null;
    /** Response TikTok trả về. */
    publishResponse?: Record<string, unknown> | null;
  } | null;
  /** Draft Product của Listing Session làm nguồn (khi item đến từ một lượt đăng). */
  sessionProduct?: { id: string; title: string; status?: string } | null;
  job?: {
    id: string;
    name: string;
    market: PodListingMarket;
    sessionId?: string | null;
    type?: PodListingJobType;
  } | null;
}

export interface PodListingLog {
  id: string;
  level: PodListingLogLevel;
  step: string;
  message: string;
  payload: Record<string, unknown> | null;
  listingItemId: string | null;
  createdAt: string;
}

export interface CreateListingJobPayload {
  name?: string;
  market: PodListingMarket;
  shopIds: string[];
  listingTemplateId: string;
  productIds: string[];
  imageTemplateId?: string;
}

export interface PodListingJobQuery extends PaginationParams {
  search?: string;
  status?: PodListingJobStatus;
  market?: PodListingMarket;
  type?: PodListingJobType;
}

export interface PodListingJobItemQuery extends PaginationParams {
  status?: PodListingItemStatus;
  shopId?: string;
  search?: string;
}
