import { Injectable } from '@nestjs/common';
import { FulfillmentStatus, PodDesignPlacement } from '@prisma/client';
import type { NormalizedAddress, ResolvedPrintFile } from '../../mango/mappers/mango-order.mapper';
import { attemptExternalId } from '../../shared/fulfillment-lifecycle';
import type { PressifyCreateOrderBody } from '../clients/pressify-api.client';
import {
  PRESSIFY_CANCEL_WINDOW_MS,
  PRESSIFY_CANCELLABLE_PROVIDER_STATUS,
  PRESSIFY_DEFAULT_PLACEMENT_MAP,
  PRESSIFY_PRINT_KEYS,
  PRESSIFY_REF_ID_MAX_LENGTH,
  PRESSIFY_STATUS_MAP,
  PRESSIFY_STATUS_MESSAGES,
  type PressifyPrintKey,
} from '../constants/pressify.constants';
import type {
  PressifyAddress,
  PressifyLineItem,
  PressifyOrder,
  PressifyWebhookPayload,
} from '../types/pressify-api.types';

/** Một dòng hàng đã ghép đủ dữ liệu, sẵn sàng đưa vào `line_items[]`. */
export interface PressifyResolvedLine {
  /** Id dòng `fulfillment_order_items` (để ghép chi phí). */
  itemId: string;
  /** `variant_id` Pressify (chuỗi số đã kiểm). */
  variantId: string;
  quantity: number;
  /** Tên sản phẩm bên NCMedia — Pressify hiện lại trên đơn. */
  productName: string | null;
  /** Ảnh mockup mặt trước — bắt buộc ít nhất một mockup (tài liệu). */
  mockup: string;
  printFiles: ResolvedPrintFile[];
}

/** Trạng thái chuẩn hoá của một đơn Pressify. */
export interface PressifyStatusSummary {
  status: FulfillmentStatus;
  providerStatus: string | null;
  message: string | null;
}

/** Chi phí cấp đơn (USD). NULL = Pressify chưa báo. */
export interface PressifyOrderCosts {
  subtotal: number | null;
  shippingFee: number | null;
  total: number | null;
}

/** Chi phí MỘT dòng Pressify (GET /order/{id} → `items[]`). */
export interface PressifyLineCost {
  providerItemId: string | null;
  variantId: string | null;
  quantity: number | null;
  /** Giá in của dòng (USD). */
  itemCost: number | null;
}

/**
 * PressifyOrderMapper — chuyển đổi THUẦN giữa dữ liệu NCMedia và Pressify Seller API (không I/O).
 *
 * 🔴 Request KHÔNG chứa `api_key` — client gắn key ngay trước khi gửi. Nhờ vậy object request lưu vào
 * `raw_request` không bao giờ mang key.
 */
@Injectable()
export class PressifyOrderMapper {
  /** `ref_id` — mã đơn TikTok (+ hậu tố lần thử). Tài liệu: phải duy nhất trên toàn Pressify. */
  buildRefId(tiktokOrderId: string, attempt: number): string {
    return attemptExternalId(tiktokOrderId, attempt, PRESSIFY_REF_ID_MAX_LENGTH);
  }

  /** Body POST /order. Mọi dữ liệu đã được validate TRƯỚC khi vào đây. */
  buildCreateOrderRequest(params: {
    refId: string;
    handlingType: string;
    shippingMethod: string;
    /** Có nhãn ⇒ gửi `shipping_label`, KHÔNG gửi `address` (tài liệu: đúng một trong hai). */
    labelUrl: string | null;
    address: NormalizedAddress | null;
    note: string | null;
    /** `null` ⇒ không gửi `production` (Pressify mặc định DTF). */
    printMethod: string | null;
    lines: PressifyResolvedLine[];
  }): PressifyCreateOrderBody {
    const base: PressifyCreateOrderBody = {
      ref_id: params.refId,
      order_status: params.handlingType,
      shipping_method: params.shippingMethod,
      line_items: params.lines.map((line) => this.toLineItem(line)),
    };
    if (params.labelUrl) base.shipping_label = params.labelUrl;
    else if (params.address) base.address = this.toAddress(params.address);
    if (params.note?.trim()) base.note = params.note.trim();
    if (params.printMethod) base.production = params.printMethod;
    return base;
  }

  /** Địa chỉ chuẩn hoá NCMedia → `address` Pressify (`name` = họ tên đầy đủ, từ đầu tiên là first name). */
  toAddress(address: NormalizedAddress): PressifyAddress {
    const name = [address.first_name, address.last_name]
      .filter((part) => part?.trim())
      .join(' ')
      .trim();
    return {
      name,
      ...(address.phone?.trim() ? { phone: address.phone.trim() } : {}),
      street1: address.address_line_1,
      ...(address.address_line_2?.trim() ? { street2: address.address_line_2.trim() } : {}),
      city: address.city,
      state: address.state,
      zip: address.zip,
      country: address.country,
    };
  }

  private toLineItem(line: PressifyResolvedLine): PressifyLineItem {
    return {
      variant_id: Number(line.variantId),
      quantity: line.quantity,
      ...(line.productName ? { product_name: line.productName.slice(0, 255) } : {}),
      mockup: line.mockup,
      print_files: line.printFiles.map((file) => ({ key: file.key, url: file.url })),
    };
  }

  /** Vị trí in NCMedia → khoá Pressify. `placementMap` của ánh xạ ghi đè (chỉ nhận khoá Pressify hợp lệ). */
  resolvePrintKey(placement: PodDesignPlacement, placementMap: unknown): PressifyPrintKey | null {
    if (placementMap && typeof placementMap === 'object' && !Array.isArray(placementMap)) {
      const custom = (placementMap as Record<string, unknown>)[placement];
      if (typeof custom === 'string' && isPrintKey(custom.trim()))
        return custom.trim() as PressifyPrintKey;
    }
    return PRESSIFY_DEFAULT_PLACEMENT_MAP[placement] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Đọc đơn
  // ---------------------------------------------------------------------------

  summarizeStatus(order: Pick<PressifyOrder, 'fulfill_status'>): PressifyStatusSummary {
    return this.summarizeProviderStatus(order.fulfill_status);
  }

  /** `fulfill_status` / `status` (webhook) → trạng thái chuẩn hoá. Giá trị lạ ⇒ UNKNOWN (không đoán). */
  summarizeProviderStatus(value: string | null | undefined): PressifyStatusSummary {
    const providerStatus = value?.trim().toLowerCase() || null;
    if (!providerStatus)
      return { status: FulfillmentStatus.SUBMITTED, providerStatus: null, message: null };
    return {
      status: PRESSIFY_STATUS_MAP[providerStatus] ?? FulfillmentStatus.UNKNOWN,
      providerStatus,
      message: PRESSIFY_STATUS_MESSAGES[providerStatus] ?? null,
    };
  }

  /** Chi phí cấp đơn: subtotal = print_cost, phí ship = shipping_cost, tổng = paid_cost ?? total_cost. */
  orderCosts(order: PressifyOrder): PressifyOrderCosts {
    return {
      subtotal: toNumber(order.print_cost),
      shippingFee: toNumber(order.shipping_cost),
      total: toNumber(order.paid_cost) ?? toNumber(order.total_cost),
    };
  }

  /**
   * Chi phí từng dòng — CHỈ khi đơn đã thanh toán (`payment_status = paid`). Tài liệu: "The charged amount
   * appears on GET /order/{id} once the order is paid" — trước đó chỉ là số tạm, không xác nhận giá vốn.
   */
  lineCosts(order: PressifyOrder): PressifyLineCost[] {
    if (order.payment_status?.trim().toLowerCase() !== 'paid') return [];
    return (order.items ?? []).map((item) => ({
      providerItemId: item.id !== undefined && item.id !== null ? String(item.id) : null,
      // Tài liệu ví dụ số, API thật trả chuỗi ⇒ chuẩn hoá về chuỗi để so khớp.
      variantId:
        item.variant_id !== undefined && item.variant_id !== null
          ? String(item.variant_id).trim()
          : null,
      quantity: typeof item.quantity === 'number' ? item.quantity : null,
      itemCost: toNumber(item.price),
    }));
  }

  /** Tracking từ đơn (GET) — `tracking_id` + hãng `shipping_service`. Không tự dựng URL tra cứu. */
  tracking(order: PressifyOrder): { trackingNumber: string; carrier: string | null } | null {
    const trackingNumber = order.tracking_id?.trim();
    // API thật có đơn shipped với tracking_id dài 1 ký tự (dữ liệu nhập tay phía Pressify) — vẫn ghi
    // nguyên văn, không lọc: người vận hành cần thấy đúng thứ Pressify đang có.
    if (!trackingNumber) return null;
    return { trackingNumber, carrier: order.shipping_service?.trim() || null };
  }

  /**
   * Đơn còn huỷ được qua API không — tài liệu: `pending` + chưa thanh toán + tạo chưa quá 60 phút.
   * `created_at` thiếu / lạ ⇒ không tự quyết theo thời gian (để Pressify trả lời).
   */
  cancellability(
    order: PressifyOrder,
    now = new Date(),
  ): { cancellable: boolean; reason: string | null } {
    const status = order.fulfill_status?.trim().toLowerCase() ?? '';
    if (status !== PRESSIFY_CANCELLABLE_PROVIDER_STATUS) {
      return {
        cancellable: false,
        reason:
          `Pressify chỉ cho huỷ đơn đang "pending" (đơn đang "${status || 'không rõ'}"). ` +
          'Đơn priority / express / oversize hoặc đã thanh toán phải mở ticket hỗ trợ trên Pressify.',
      };
    }
    if (order.payment_status?.trim().toLowerCase() === 'paid') {
      return {
        cancellable: false,
        reason: 'Đơn đã được Pressify trừ tiền — không huỷ qua API được nữa.',
      };
    }
    const createdAt = order.created_at ? Date.parse(order.created_at) : NaN;
    if (Number.isFinite(createdAt) && now.getTime() - createdAt > PRESSIFY_CANCEL_WINDOW_MS) {
      return {
        cancellable: false,
        reason: 'Pressify chỉ cho huỷ trong 60 phút đầu sau khi tạo đơn.',
      };
    }
    return { cancellable: true, reason: null };
  }

  // ---------------------------------------------------------------------------
  // Che dữ liệu trước khi lưu
  // ---------------------------------------------------------------------------

  /** Request đã dựng (không có key) — che PII của người nhận trước khi lưu `raw_request`. */
  maskRequestForStorage(request: PressifyCreateOrderBody): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...request };
    delete copy.api_key;
    if (request.address) {
      const address = request.address;
      copy.address = {
        ...address,
        name: mask(address.name),
        street1: mask(address.street1),
        ...(address.street2 ? { street2: mask(address.street2) } : {}),
        ...(address.phone ? { phone: mask(address.phone) } : {}),
      };
    }
    return copy;
  }

  /** Đơn Pressify (GET /order/{id}) mang họ tên / SĐT / địa chỉ người nhận ⇒ che trước khi lưu. */
  maskOrderForStorage(order: PressifyOrder): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...order };
    for (const field of ['first_name', 'last_name', 'phone', 'address_1', 'address_2'] as const) {
      const value = order[field];
      if (typeof value === 'string' && value) copy[field] = mask(value);
    }
    delete copy.api_key;
    return copy;
  }

  /** Webhook: bỏ `api_key` (định danh store) trước khi lưu — không mang PII người nhận. */
  maskWebhookForStorage(payload: PressifyWebhookPayload): Record<string, unknown> {
    if (!payload?.data) return { data: null };
    const { api_key: _key, ...data } = payload.data;
    void _key;
    return { data };
  }
}

function isPrintKey(value: string): value is PressifyPrintKey {
  return (PRESSIFY_PRINT_KEYS as readonly string[]).includes(value);
}

function mask(value: string): string {
  if (value.length <= 2) return '***';
  return `${value.slice(0, 1)}***`;
}

/** "7.98" / 7.98 ⇒ 7.98; rỗng / lạ ⇒ null ("chưa báo" khác "bằng 0"). */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
