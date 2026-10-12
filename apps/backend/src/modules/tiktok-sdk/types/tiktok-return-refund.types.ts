/**
 * Kiểu dữ liệu của nhóm API **Return & Refund** mà tầng nghiệp vụ được thấy.
 *
 * Khai báo lại (thay vì để lộ model SDK) theo cùng luật với `tiktok-promotion.types.ts`: module
 * nghiệp vụ không import gì từ `vendor/`. Mọi trường là TUỲ CHỌN — đúng như model SDK: TikTok
 * không bảo đảm trả đủ mọi trường cho mọi yêu cầu.
 *
 * Nguồn: `model/returnRefund/V202602/SearchReturnsResponseDataReturnOrders*.ts` và
 * `model/returnRefund/V202309/GetReturnRecordsResponseDataRecords.ts` (SDK sinh từ tài liệu Partner Center).
 */

/** `refund_amount` — tiền dạng CHUỖI thập phân (giữ nguyên độ chính xác, không ép số thực). */
export interface TiktokReturnRefundAmount {
  currency?: string;
  refundTotal?: string;
  refundSubtotal?: string;
  refundShippingFee?: string;
  refundTax?: string;
  buyerServiceFee?: string;
  retailDeliveryFee?: string;
}

export interface TiktokReturnLineItem {
  returnLineItemId?: string;
  orderLineItemId?: string;
  productName?: string;
  skuId?: string;
  skuName?: string;
  sellerSku?: string;
  productImage?: { url?: string; width?: number; height?: number };
  refundAmount?: TiktokReturnRefundAmount;
}

/** Một phần tử `return_orders[]` của Search Returns. */
export interface TiktokReturnOrder {
  returnId?: string;
  orderId?: string;
  returnType?: string;
  returnStatus?: string;
  returnReason?: string;
  returnReasonText?: string;
  role?: string;
  arbitrationStatus?: string;
  sellerProposedReturnType?: string;
  buyerRejectedPartialRefund?: boolean;
  partialRefund?: { amount?: string; currency?: string };
  refundAmount?: TiktokReturnRefundAmount;
  returnLineItems?: TiktokReturnLineItem[];
  returnTrackingNumber?: string;
  returnProviderName?: string;
  returnMethod?: string;
  isCombinedReturn?: boolean;
  combinedReturnId?: string;
  preReturnId?: string;
  nextReturnId?: string;
  createTime?: number;
  updateTime?: number;
}

/** Bộ lọc Search Returns (body). Thời gian là Unix seconds. */
export interface TiktokReturnSearchFilter {
  updateTimeGe?: number;
  updateTimeLt?: number;
  createTimeGe?: number;
  createTimeLt?: number;
  returnIds?: string[];
  orderIds?: string[];
  locale?: string;
}

/** Một bản ghi lịch sử (`records[]` của Get Return Records). */
export interface TiktokReturnRecord {
  createTime?: number;
  event?: string;
  role?: string;
  description?: string;
  note?: string;
  reasonText?: string;
  images?: unknown[];
  videos?: unknown[];
}
