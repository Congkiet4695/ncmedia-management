import type { Paginated, PaginationParams } from '@/types/api';

/** Trạng thái đơn của TikTok (Order API overview). */
export const POD_ORDER_STATUSES = [
  'UNPAID',
  'ON_HOLD',
  'AWAITING_SHIPMENT',
  'PARTIALLY_SHIPPING',
  'AWAITING_COLLECTION',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type PodOrderStatus = (typeof POD_ORDER_STATUSES)[number];

export const POD_SYNC_STATUSES = ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED'] as const;
export type PodSyncStatus = (typeof POD_SYNC_STATUSES)[number];

export const POD_SYNC_TRIGGERS = ['CRON', 'MANUAL', 'BACKFILL'] as const;
export type PodSyncTrigger = (typeof POD_SYNC_TRIGGERS)[number];

/** Pha đồng bộ: kéo lịch sử (create_time) hay đồng bộ định kỳ (update_time). */
export const POD_SYNC_PHASES = ['BACKFILL', 'INCREMENTAL'] as const;
export type PodSyncPhase = (typeof POD_SYNC_PHASES)[number];


/** Vị trí in design. Backend hỗ trợ sẵn 5 vị trí; UI hiện dùng FRONT/BACK. */
export const POD_DESIGN_PLACEMENTS = ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'SLEEVE'] as const;
export type PodDesignPlacement = (typeof POD_DESIGN_PLACEMENTS)[number];

/** Vị trí in đang bật ở giai đoạn này (khớp POD_ACTIVE_PLACEMENTS của backend). */
export const POD_ACTIVE_PLACEMENTS: PodDesignPlacement[] = ['FRONT', 'BACK'];

/** Một file design đã upload cho sản phẩm. */
export interface PodDesign {
  id: string;
  placement: PodDesignPlacement;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  version: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

/** Preset lọc theo Ngày đặt đơn — backend quy đổi theo múi giờ vận hành. */
export const POD_DATE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'ALL',
  'CUSTOM',
] as const;
export type PodDatePreset = (typeof POD_DATE_PRESETS)[number];

/** Nhãn hiển thị nằm ở `i18n/locales/<lang>/common.json` (khoá `date.preset.*`). */

export interface PodOrderItem {
  id: string;
  tiktokLineItemId: string;
  productId: string | null;
  productName: string | null;
  skuId: string | null;
  skuName: string | null;
  sellerSku: string | null;
  skuImage: string | null;
  salePrice: number | null;
  originalPrice: number | null;
  currency: string | null;
  displayStatus: string | null;
  packageStatus: string | null;
  packageId: string | null;
  trackingNumber: string | null;
  shippingProviderName: string | null;
  cancelReason: string | null;
  isPodCustomized: boolean;
  podInfoId: string | null;
  isGift: boolean;
  /** TikTok trả 1 line item = 1 đơn vị sản phẩm nên luôn bằng 1. */
  quantity: number;
  productCategory: string | null;
  designs: PodDesign[];
}

export interface PodOrderPackage {
  id: string;
  tiktokPackageId: string;
}

export interface PodOrderShop {
  id: string;
  name: string;
  tiktokShopId: string;
  region: string;
}

/** Chi tiết đơn. Thông tin người nhận KHÔNG được trả về (PII đã mã hoá phía backend). */
export interface PodOrder {
  id: string;
  tiktokOrderId: string;
  status: PodOrderStatus;
  shop: PodOrderShop;
  accountName: string;
  /** Seller phụ trách — suy ra từ Account sở hữu đơn. */
  sellerId: string | null;
  sellerFullName: string | null;
  sellerEmail: string | null;
  buyerEmail: string | null;
  buyerNickname: string | null;
  buyerMessage: string | null;
  sellerNote: string | null;
  currency: string | null;
  totalAmount: number | null;
  subTotal: number | null;
  shippingFee: number | null;
  tax: number | null;
  sellerDiscount: number | null;
  platformDiscount: number | null;
  fulfillmentType: string | null;
  shippingType: string | null;
  trackingNumber: string | null;
  shippingProvider: string | null;
  cancelReason: string | null;
  cancellationInitiator: string | null;
  isBuyerRequestCancel: boolean;
  orderType: string | null;
  isOnHoldOrder: boolean;
  hasPodItem: boolean;
  recipientMasked: boolean;
  recipientRegionCode: string | null;
  recipientPostalCode: string | null;
  orderedAt: string;
  tiktokUpdatedAt: string;
  paidTime: string | null;
  rtsSlaTime: string | null;
  lastSyncedAt: string;
  syncVersion: number;
  items: PodOrderItem[];
  packages: PodOrderPackage[];
  createdAt: string;
  updatedAt: string;
}

export interface PodOrderListItem {
  id: string;
  tiktokOrderId: string;
  shopName: string | null;
  /** Seller phụ trách — suy ra từ Account sở hữu đơn, KHÔNG lưu trên đơn. */
  sellerId: string | null;
  sellerFullName: string | null;
  sellerEmail: string | null;
  buyer: string | null;
  status: PodOrderStatus;
  totalAmount: number | null;
  currency: string | null;
  orderType: string | null;
  hasPodItem: boolean;
  itemCount: number;
  trackingNumber: string | null;
  createdTime: string;
  updatedTime: string;
  lastSync: string;
  /** Sản phẩm của đơn (kèm design) — hiển thị trực tiếp ở danh sách. */
  items: PodOrderItem[];
}

export type PodOrderListResult = Paginated<PodOrderListItem>;

export interface PodOrderQuery extends PaginationParams {
  search?: string;
  datePreset?: PodDatePreset;
  status?: PodOrderStatus;
  shopId?: string;
  accountId?: string;
  orderType?: string;
  hasPodItem?: boolean;
  orderedFrom?: string;
  orderedTo?: string;
  sortBy?: 'orderedAt' | 'tiktokUpdatedAt' | 'totalAmount' | 'status' | 'lastSyncedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface PodOrderStats {
  total: number;
  byStatus: Record<string, number>;
}

export interface PodSyncLog {
  id: string;
  shopId: string | null;
  shopName: string | null;
  accountName: string | null;
  trigger: PodSyncTrigger;
  status: PodSyncStatus;
  /** BACKFILL = kéo lịch sử theo create_time; INCREMENTAL = đồng bộ định kỳ theo update_time. */
  phase: PodSyncPhase;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  totalOrders: number;
  /** Số đơn TikTok báo có trong cửa sổ — lệch với totalOrders là dấu hiệu thiếu đơn. */
  tiktokTotalCount: number | null;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  pagesFetched: number;
  apiCalls: number;
  errorCode: string | null;
  errorMessage: string | null;
  tiktokRequestId: string | null;
}

export type PodSyncLogListResult = Paginated<PodSyncLog>;

export interface PodSyncLogQuery extends PaginationParams {
  shopId?: string;
  accountId?: string;
  status?: PodSyncStatus;
  trigger?: PodSyncTrigger;
}

/** Payload kích hoạt đồng bộ thủ công. */
export interface TriggerSyncPayload {
  shopId?: string;
  lookbackMinutes?: number;
  force?: boolean;
  /** Kéo lại TOÀN BỘ lịch sử đơn theo create_time. An toàn để chạy lại (không tạo đơn trùng). */
  backfill?: boolean;
}

export interface SyncTriggerResult {
  shopsTotal: number;
  shopsSucceeded: number;
  shopsFailed: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  ordersFailed: number;
  durationMs: number;
  skippedByLock: boolean;
}
