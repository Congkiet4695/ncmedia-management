import { PodReturnStatusGroup, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type {
  TiktokReturnOrder,
  TiktokReturnRecord,
} from '../../tiktok-sdk/types/tiktok-return-refund.types';
import { RETURN_REFUNDED_STATUSES, RETURN_STATUS_GROUP } from '../constants/pod-return.constants';

/** Một dòng hàng đã chuẩn hoá (chưa có `paidAmount` — cần đối chiếu `pod_order_items`). */
export interface MappedReturnItem {
  returnLineItemId: string;
  orderLineItemId: string | null;
  productName: string | null;
  skuId: string | null;
  skuName: string | null;
  sellerSku: string | null;
  productImageUrl: string | null;
  currency: string | null;
  refundTotal: Prisma.Decimal | null;
  refundSubtotal: Prisma.Decimal | null;
}

/** Một yêu cầu đã chuẩn hoá — dữ liệu ghi vào `pod_return_requests` (trừ khoá tenant / shop / đơn). */
export interface MappedReturn {
  tiktokReturnId: string;
  tiktokOrderId: string;
  returnType: string;
  returnStatus: string;
  statusGroup: PodReturnStatusGroup;
  refundCompleted: boolean;
  returnReason: string | null;
  returnReasonText: string | null;
  role: string | null;
  arbitrationStatus: string | null;
  sellerProposedReturnType: string | null;
  partialRefundAmount: Prisma.Decimal | null;
  buyerRejectedPartialRefund: boolean | null;
  currency: string | null;
  refundTotal: Prisma.Decimal | null;
  refundSubtotal: Prisma.Decimal | null;
  refundShippingFee: Prisma.Decimal | null;
  refundTax: Prisma.Decimal | null;
  itemQuantity: number;
  returnTrackingNumber: string | null;
  returnProviderName: string | null;
  tiktokCreateTime: bigint;
  tiktokUpdateTime: bigint;
  requestedAt: Date;
  tiktokUpdatedAt: Date;
  items: MappedReturnItem[];
  rawPayload: Prisma.InputJsonValue;
  payloadHash: string;
}

/** Một mục lịch sử đã rút gọn (lưu ở `pod_return_requests.history`). */
export interface ReturnHistoryEntry {
  time: string | null;
  event: string | null;
  role: string | null;
  description: string | null;
  note: string | null;
  reason: string | null;
  attachments: number;
}

/** Trường bị loại khỏi bản lưu đối chiếu: địa chỉ kho trả hàng (dữ liệu liên hệ, không cần cho đối chiếu). */
const RAW_EXCLUDED_KEYS = new Set(['returnWarehouseAddress']);

/** Chuỗi tiền TikTok ⇒ Decimal. Rỗng / không phải số ⇒ `null` (không ép về 0). */
export function toMoney(value: string | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '' || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  return new Prisma.Decimal(text);
}

function text(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function statusGroupOf(returnStatus: string): PodReturnStatusGroup {
  return RETURN_STATUS_GROUP[returnStatus] ?? PodReturnStatusGroup.OTHER;
}

/**
 * Bản ghi Search Returns ⇒ dữ liệu lưu. Trả `null` khi thiếu định danh bắt buộc (`return_id`,
 * `order_id`, `update_time`) — bản ghi đó không thể upsert an toàn nên bị bỏ qua và đếm là lỗi.
 */
export function mapReturnOrder(source: TiktokReturnOrder): MappedReturn | null {
  const tiktokReturnId = source.returnId?.trim();
  const tiktokOrderId = source.orderId?.trim();
  if (!tiktokReturnId || !tiktokOrderId || !source.updateTime) return null;

  const createTime = source.createTime ?? source.updateTime;
  const returnStatus = source.returnStatus?.trim() || 'UNKNOWN';
  const amount = source.refundAmount ?? {};
  const items: MappedReturnItem[] = (source.returnLineItems ?? [])
    .filter((line) => line.returnLineItemId)
    .map((line) => ({
      returnLineItemId: String(line.returnLineItemId),
      orderLineItemId: text(line.orderLineItemId, 64),
      productName: text(line.productName, 500),
      skuId: text(line.skuId, 64),
      skuName: text(line.skuName, 255),
      sellerSku: text(line.sellerSku, 255),
      productImageUrl: text(line.productImage?.url, 1000),
      currency: text(line.refundAmount?.currency, 10) ?? text(amount.currency, 10),
      refundTotal: toMoney(line.refundAmount?.refundTotal),
      refundSubtotal: toMoney(line.refundAmount?.refundSubtotal),
    }));

  const raw = Object.fromEntries(
    Object.entries(source).filter(([key, value]) => !RAW_EXCLUDED_KEYS.has(key) && value !== undefined),
  );

  return {
    tiktokReturnId,
    tiktokOrderId,
    returnType: source.returnType?.trim() || 'UNKNOWN',
    returnStatus,
    statusGroup: statusGroupOf(returnStatus),
    refundCompleted: RETURN_REFUNDED_STATUSES.has(returnStatus),
    returnReason: text(source.returnReason, 255),
    returnReasonText: text(source.returnReasonText, 500),
    role: text(source.role, 20),
    arbitrationStatus: text(source.arbitrationStatus, 40),
    sellerProposedReturnType: text(source.sellerProposedReturnType, 40),
    partialRefundAmount: toMoney(source.partialRefund?.amount),
    buyerRejectedPartialRefund: source.buyerRejectedPartialRefund ?? null,
    currency: text(amount.currency, 10) ?? items.find((item) => item.currency)?.currency ?? null,
    refundTotal: toMoney(amount.refundTotal),
    refundSubtotal: toMoney(amount.refundSubtotal),
    refundShippingFee: toMoney(amount.refundShippingFee),
    refundTax: toMoney(amount.refundTax),
    // TikTok tách mỗi đơn vị hàng thành một line item ⇒ số dòng = số lượng.
    itemQuantity: items.length,
    returnTrackingNumber: text(source.returnTrackingNumber, 100),
    returnProviderName: text(source.returnProviderName, 100),
    tiktokCreateTime: BigInt(createTime),
    tiktokUpdateTime: BigInt(source.updateTime),
    requestedAt: new Date(createTime * 1000),
    tiktokUpdatedAt: new Date(source.updateTime * 1000),
    items,
    rawPayload: raw as Prisma.InputJsonValue,
    payloadHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
  };
}

/**
 * Paid Amount của yêu cầu = Σ `sale_price` của ĐÚNG các order line item được yêu cầu.
 * Thiếu giá của bất kỳ dòng nào ⇒ `null`: không bù bằng tổng đơn, không tính thiếu một phần.
 */
export function sumPaidAmount(items: Array<{ paidAmount: Prisma.Decimal | null }>): Prisma.Decimal | null {
  if (items.length === 0) return null;
  let total = new Prisma.Decimal(0);
  for (const item of items) {
    if (item.paidAmount === null) return null;
    total = total.plus(item.paidAmount);
  }
  return total;
}

/** Lịch sử TikTok ⇒ dạng lưu, sắp theo thời gian TĂNG dần (mục không có thời gian xếp cuối). */
export function mapReturnRecords(records: TiktokReturnRecord[]): ReturnHistoryEntry[] {
  return records
    .map((record) => ({
      time: record.createTime ? new Date(record.createTime * 1000).toISOString() : null,
      event: text(record.event, 100),
      role: text(record.role, 20),
      description: text(record.description, 2000),
      note: text(record.note, 2000),
      reason: text(record.reasonText, 500),
      attachments: (record.images?.length ?? 0) + (record.videos?.length ?? 0),
    }))
    .sort((a, b) => {
      if (a.time === b.time) return 0;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time < b.time ? -1 : 1;
    });
}
