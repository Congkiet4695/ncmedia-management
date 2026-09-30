import type { NotificationEntityType, NotificationEventType } from '@prisma/client';

/**
 * Hợp đồng dữ liệu giữa module phát sự kiện (POD / Fulfillment) và module Notification.
 *
 * 🔴 Payload là ẢNH CHỤP lúc sự kiện xảy ra — worker KHÔNG đọc lại bảng nghiệp vụ. Nhờ vậy module
 * Notification không phụ thuộc module nào (chiều phụ thuộc: POD → Notification, Fulfillment →
 * Notification), và tin nhắn nói đúng điều đã xảy ra chứ không phải trạng thái lúc gửi.
 *
 * KHÔNG đưa vào payload: địa chỉ / email / SĐT người mua, token, API key.
 */

/** Một dòng sản phẩm đã gộp theo SKU (TikTok trả mỗi đơn vị hàng là một line item). */
export interface NotificationOrderItem {
  productName: string | null;
  sku: string | null;
  /** Tên biến thể (vd "M / Dark Heather"). */
  variant: string | null;
  quantity: number;
}

/** NEW ORDER — đơn vừa được INSERT lần đầu. */
export interface OrderCreatedPayload {
  tiktokOrderId: string;
  accountName: string | null;
  shopName: string | null;
  items: NotificationOrderItem[];
  /** Số tiền dạng chuỗi (giữ nguyên độ chính xác của Decimal). */
  totalAmount: string | null;
  currency: string | null;
  /** `create_time` của TikTok (ISO) — CHỈ để hiển thị, không dùng để xác định đơn mới. */
  orderCreatedAt: string | null;
  /** Nhà cung cấp fulfillment gán cho kết nối TikTok (nếu có). */
  fulfillmentProvider: string | null;
  /** Nguồn đồng bộ: CRON | MANUAL. */
  syncSource: string;
}

/** Thông tin chung của một đơn fulfillment trong tin nhắn. */
interface FulfillmentPayloadBase {
  tiktokOrderId: string;
  accountName: string | null;
  items: NotificationOrderItem[];
  /** Nhãn nhà cung cấp (MangoTeePrints, Sellerwix…). */
  provider: string;
  /** Tài khoản nhà cung cấp thực sự nhận đơn. */
  fulfilledBy: string | null;
  providerOrderId: string | null;
  /** Mã đơn NCMedia gửi sang nhà cung cấp. */
  externalOrderId: string;
}

/** FULFILLMENT SUBMITTED — nhà cung cấp đã tiếp nhận đơn. */
export interface FulfillmentSubmittedPayload extends FulfillmentPayloadBase {
  /** Σ giá vốn sản phẩm; `null` khi nhà cung cấp chưa xác nhận giá. */
  baseCost: string | null;
  baseCostConfirmed: boolean;
  currency: string | null;
  trackingNumber: string | null;
  productionLine: string | null;
  shippingMethod: string | null;
  fulfilledAt: string | null;
}

/** FULFILLMENT CANCELLED — nhà cung cấp đã XÁC NHẬN huỷ. */
export interface FulfillmentCancelledPayload extends FulfillmentPayloadBase {
  cancelledAt: string | null;
  reason: string | null;
}

/** Payload theo từng loại sự kiện — formatter dựa vào đây để dựng tin nhắn. */
export interface NotificationPayloadMap {
  ORDER_CREATED: OrderCreatedPayload;
  FULFILLMENT_SUBMITTED: FulfillmentSubmittedPayload;
  FULFILLMENT_CANCELLED: FulfillmentCancelledPayload;
}

/** Một sự kiện cần phát — đầu vào của `NotificationOutboxService`. */
export type NotificationEventInput = {
  [K in NotificationEventType]: {
    organizationId: string;
    eventType: K;
    entityType: NotificationEntityType;
    /** Id của thực thể (khoá idempotency cùng `eventType` + `entityType`). */
    entityId: string;
    payload: NotificationPayloadMap[K];
    /** Người dùng gây ra sự kiện; bỏ trống = hệ thống. */
    actorUserId?: string | null;
  };
}[NotificationEventType];
