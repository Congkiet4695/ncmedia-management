/** Nhà cung cấp fulfillment. Hiện chỉ MANGOTEE được implement. */
export const FULFILLMENT_PROVIDERS = ['MANGOTEE', 'PRINTIFY', 'PRINTFUL'] as const;
export type FulfillmentProvider = (typeof FULFILLMENT_PROVIDERS)[number];

/**
 * Trạng thái fulfillment CHUẨN HOÁ của NCMedia (dùng chung mọi nhà cung cấp).
 * Trạng thái gốc của nhà cung cấp nằm ở `providerStatus`, luôn hiển thị kèm.
 */
export const FULFILLMENT_STATUSES = [
  'DRAFT',
  'SUBMITTING',
  'SUBMITTED',
  'IN_PRODUCTION',
  'ON_HOLD',
  'SHIPPED',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
  'UNKNOWN',
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/**
 * Nhãn hiển thị của trạng thái nằm ở `i18n/locales/<lang>/fulfillment.json` (khoá `status.*`),
 * không đặt trong file type — nhãn phụ thuộc ngôn ngữ, type thì không.
 */

export interface FulfillmentItem {
  id: string;
  podOrderItemId: string | null;
  providerSku: string;
  quantity: number;
  printFiles: unknown;
  color: string | null;
  size: string | null;
}

export interface FulfillmentOrder {
  id: string;
  podOrderId: string;
  provider: FulfillmentProvider;
  status: FulfillmentStatus;
  /** Trạng thái NGUYÊN VĂN của nhà cung cấp — hiển thị kèm để đối soát. */
  providerStatus: string | null;
  externalOrderId: string;
  providerOrderId: string | null;
  providerFulfillId: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  labelUrl: string | null;
  shippingMethod: string | null;
  productionLine: string | null;
  total: number | null;
  currency: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  submittedAt: string | null;
  lastSyncedAt: string | null;
  cancelledAt: string | null;
  items: FulfillmentItem[];
  createdAt: string;
  updatedAt: string;
}

/** Một lý do khiến đơn chưa gửi được. */
export interface FulfillmentIssue {
  code: string;
  message: string;
  podOrderItemId: string | null;
}

export interface FulfillmentState {
  fulfillment: FulfillmentOrder | null;
  ready: boolean;
  issues: FulfillmentIssue[];
  canFulfill: boolean;
  canCancel: boolean;
}

export interface FulfillmentHistoryEntry {
  id: string;
  eventType: string;
  trigger: string;
  fromStatus: string | null;
  toStatus: string | null;
  providerStatus: string | null;
  success: boolean;
  message: string | null;
  payload: unknown;
  durationMs: number | null;
  requestId: string | null;
  createdAt: string;
}

export interface FulfillmentError {
  id: string;
  operation: string;
  errorClass: string;
  httpStatus: number | null;
  providerCode: string | null;
  message: string;
  validationErrors: unknown;
  retryable: boolean;
  requestId: string | null;
  createdAt: string;
}

export interface FulfillmentAccount {
  id: string;
  provider: FulfillmentProvider;
  name: string;
  apiKeyHint: string | null;
  isActive: boolean;
  isDefault: boolean;
  defaultProductionLine: string | null;
  defaultShippingMethod: string;
  defaultFacility: string | null;
  /** Chỉ có giá trị NGAY SAU khi tạo — chứa secret, hiện một lần rồi thôi. */
  webhookUrl: string | null;
  providerWebhookId: string | null;
  lastUsedAt: string | null;
  lastErrorMsg: string | null;
  createdAt: string;
}

export interface ProductMapping {
  id: string;
  tiktokProductId: string | null;
  tiktokSkuId: string | null;
  sellerSku: string | null;
  providerSku: string;
  providerProductName: string | null;
  providerColor: string | null;
  providerSize: string | null;
  productionConfig: string | null;
  placementMap: unknown;
  isActive: boolean;
  note: string | null;
  createdAt: string;
}
