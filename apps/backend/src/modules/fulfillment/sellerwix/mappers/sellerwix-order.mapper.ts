import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentStatus, PodDesignPlacement } from '@prisma/client';
import type { NormalizedAddress } from '../../mango/mappers/mango-order.mapper';
import {
  SELLERWIX_DEFAULT_PLACEMENT_DISPLAY_NAMES,
  SELLERWIX_STATUS_MAP,
  SELLERWIX_STATUS_PROGRESS,
  type SellerwixFulfillmentStatus,
  SELLERWIX_REFERENCE_ID_MAX_LENGTH,
} from '../constants/sellerwix.constants';
import { attemptExternalId } from '../../shared/fulfillment-lifecycle';
import type {
  SellerwixAddressRequest,
  SellerwixCreateOrderRequest,
  SellerwixLineItemRequest,
  SellerwixOrder,
  SellerwixShippingMethod,
  SellerwixTracking,
  SellerwixVariantPrintArea,
} from '../types/sellerwix-api.types';

/**
 * `print_areas` của một biến thể từ `fulfillment_variants.raw_data` (payload Get product variants
 * đã lưu nguyên văn). Payload lạ ⇒ mảng rỗng, không ném lỗi.
 */
export function sellerwixPrintAreasOf(rawData: unknown): SellerwixVariantPrintArea[] {
  const areas = (rawData as { print_areas?: unknown } | null | undefined)?.print_areas;
  return Array.isArray(areas)
    ? (areas as SellerwixVariantPrintArea[]).filter(
        (area) => typeof area?.key === 'string' && area.key.trim().length > 0,
      )
    : [];
}

/** Một dòng hàng đã ghép đủ SKU biến thể + file in, sẵn sàng đưa vào `line_items[]`. */
export interface SellerwixResolvedLine {
  /** Id `fulfillment_order_items` — ghép chi phí trả về đúng dòng nội bộ. */
  itemId: string;
  /** `line_items[].reference_id` — id line item TikTok (bắt buộc với store kết nối marketplace). */
  referenceId: string;
  sku: string;
  quantity: number;
  printAreas: Array<{ key: string; url: string }>;
}

/** Trạng thái chuẩn hoá suy ra từ `fulfillments[]`. */
export interface SellerwixStatusSummary {
  status: FulfillmentStatus;
  /** Trạng thái NGUYÊN VĂN (các phần khác nhau nối bằng ` | `), tối đa 64 ký tự. */
  providerStatus: string | null;
  /** `fulfillments[].message` khác rỗng (lỗi/từ chối) — hiển thị cho người vận hành. */
  message: string | null;
}

/** Mã vận đơn gần nhất. */
export interface SellerwixTrackingSummary {
  trackingNumber: string;
  trackingUrl: string | null;
  carrier: string | null;
  listingStatus: string | null;
}

/** Chi phí một dòng hàng Sellerwix báo về. */
export interface SellerwixLineCost {
  providerItemId: string | null;
  referenceId: string | null;
  sku: string | null;
  itemCost: number | null;
}

/** Một phương thức vận chuyển đã chuẩn hoá cho ô chọn. */
export interface SellerwixShippingOption {
  code: string;
  name: string;
  carrier: string | null;
  type: string | null;
}

/**
 * SellerwixOrderMapper — Anti-Corruption Layer hai chiều NCMedia ⇄ Sellerwix.
 *
 * Nguyên tắc (giống Mango): chỉ field có trong tài liệu, thiếu dữ liệu thì báo lỗi ở tầng validate
 * chứ không điền giá trị giả, PII người nhận bị che trước khi lưu `raw_request`.
 */
@Injectable()
export class SellerwixOrderMapper {
  private readonly logger = new Logger(SellerwixOrderMapper.name);

  /**
   * `reference_id` của đơn = MÃ ĐƠN TIKTOK nguyên văn.
   *
   * Tài liệu: "A unique ID that you provide to track orders. This field is required (order name)
   * when working with connected stores (tiktok, amazon, etc.)". Dùng mã đơn TikTok thoả cả hai loại
   * store (Others lẫn store TikTok đã kết nối), và là khoá idempotency: trước khi tạo, NCMedia tra
   * `GET /v1/order/{reference_id}?store_id=` để không tạo đơn thứ hai.
   */
  /**
   * Danh sách phương thức vận chuyển từ response Get shipping methods.
   *
   * Tài liệu cho mảng trần; các endpoint danh sách khác của cùng API bọc `{ data: [...] }` (vd Get
   * product variants) ⇒ nhận CẢ HAI dạng. Dạng khác ⇒ `null` để nơi gọi báo lỗi thay vì trả rỗng.
   */
  shippingMethodsOfResponse(body: unknown): SellerwixShippingMethod[] | null {
    if (Array.isArray(body)) return body as SellerwixShippingMethod[];
    if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
      return (body as { data: SellerwixShippingMethod[] }).data;
    }
    return null;
  }

  buildReferenceId(tiktokOrderId: string, attempt = 1): string {
    // Lần 1: mã đơn TikTok NGUYÊN VĂN (hành vi cũ). Fulfill lại sau khi huỷ ⇒ `{mã}-R{n}`: mã cũ
    // vẫn trỏ tới đơn đã huỷ ở Sellerwix, dùng lại thì bước tra idempotency liên kết nhầm đơn đó.
    return attemptExternalId(tiktokOrderId.trim(), attempt, SELLERWIX_REFERENCE_ID_MAX_LENGTH);
  }

  /** Địa chỉ đã chuẩn hoá → `address` của Sellerwix (chỉ field có trong tài liệu). */
  toAddress(address: NormalizedAddress): SellerwixAddressRequest {
    const request: SellerwixAddressRequest = {
      name: [address.first_name, address.last_name].filter(Boolean).join(' ').trim(),
      address1: address.address_line_1,
      city: address.city,
      zip: address.zip,
      country: address.country,
    };
    if (address.address_line_2) request.address2 = address.address_line_2;
    if (address.state) request.state = address.state;
    if (address.phone) request.phone = address.phone;
    return request;
  }

  /** Dựng body "Fulfill order". Mọi dữ liệu đã được validate TRƯỚC khi vào đây. */
  buildCreateOrderRequest(params: {
    storeId: string;
    referenceId: string;
    address: NormalizedAddress;
    lines: SellerwixResolvedLine[];
    shippingMethod: string;
    labelUrl?: string | null;
    note?: string | null;
    rushService?: boolean;
  }): SellerwixCreateOrderRequest {
    const request: SellerwixCreateOrderRequest = {
      reference_id: params.referenceId,
      store_id: params.storeId,
      address: this.toAddress(params.address),
      line_items: params.lines.map((line) => this.toLineItem(line, params)),
    };
    if (params.note) request.note = params.note;
    // Chỉ gửi khi BẬT: mặc định của tài liệu là false.
    if (params.rushService) request.rush_service = true;
    return request;
  }

  /** Che PII người nhận trước khi lưu `raw_request` (giữ city/state/zip/country để đối soát). */
  maskRequestForStorage(request: SellerwixCreateOrderRequest): Record<string, unknown> {
    const address = request.address;
    return {
      ...request,
      address: {
        ...address,
        name: this.mask(address.name),
        address1: this.mask(address.address1),
        ...(address.address2 ? { address2: this.mask(address.address2) } : {}),
        ...(address.phone ? { phone: this.mask(address.phone) } : {}),
        ...(address.email ? { email: this.mask(address.email) } : {}),
      },
    };
  }

  /**
   * Che PII trong object đơn Sellerwix trả về (Get order details / Cancel / webhook `data` đều mang
   * `address` đầy đủ) trước khi lưu `raw_response`.
   */
  maskOrderForStorage(order: SellerwixOrder): Record<string, unknown> {
    if (!order.address) return { ...order };
    const address = order.address;
    return {
      ...order,
      address: {
        ...address,
        ...(address.name ? { name: this.mask(address.name) } : {}),
        ...(address.address1 ? { address1: this.mask(address.address1) } : {}),
        ...(address.address2 ? { address2: this.mask(address.address2) } : {}),
        ...(address.phone ? { phone: this.mask(address.phone) } : {}),
        ...(address.email ? { email: this.mask(address.email) } : {}),
      },
    };
  }

  /**
   * Trạng thái của cả đơn từ `fulfillments[]`.
   *
   * - Chưa có phần nào ⇒ Sellerwix đã nhận đơn nhưng chưa tách xử lý ⇒ `SUBMITTED`.
   * - Mọi phần đều `canceled` ⇒ `CANCELLED`.
   * - Còn lại: trạng thái KÉM tiến triển nhất trong các phần chưa huỷ (đơn chỉ "đã ship" khi mọi
   *   phần đã ship). Giá trị lạ ⇒ `UNKNOWN` + log, không đoán.
   */
  summarizeStatus(order: SellerwixOrder | null | undefined): SellerwixStatusSummary {
    const parts = (order?.fulfillments ?? []).filter((part) => typeof part?.status === 'string');
    if (parts.length === 0) {
      return { status: FulfillmentStatus.SUBMITTED, providerStatus: null, message: null };
    }

    const raw = [...new Set(parts.map((part) => (part.status as string).trim()))];
    const mapped = parts.map((part) => this.mapStatus(part.status as string));
    const live = mapped.filter((status) => status !== FulfillmentStatus.CANCELLED);

    const status =
      live.length === 0
        ? FulfillmentStatus.CANCELLED
        : live.reduce((least, current) =>
            (SELLERWIX_STATUS_PROGRESS[current] ?? 0) < (SELLERWIX_STATUS_PROGRESS[least] ?? 0)
              ? current
              : least,
          );

    const message =
      parts
        .map((part) => part.message?.trim())
        .filter((text): text is string => Boolean(text))
        .join(' | ')
        .slice(0, 2000) || null;

    return { status, providerStatus: raw.join(' | ').slice(0, 64), message };
  }

  /** Mã vận đơn MỚI NHẤT (theo `tracking_date`) trên mọi phần của đơn. */
  latestTracking(order: SellerwixOrder | null | undefined): SellerwixTrackingSummary | null {
    const trackings: SellerwixTracking[] = (order?.fulfillments ?? []).flatMap(
      (part) => part.trackings ?? [],
    );
    const withNumber = trackings.filter((tracking) => tracking.tracking_number?.trim());
    if (withNumber.length === 0) return null;

    const latest = withNumber.reduce((best, current) =>
      this.timeOf(current.tracking_date) >= this.timeOf(best.tracking_date) ? current : best,
    );
    return {
      trackingNumber: (latest.tracking_number as string).trim(),
      trackingUrl: latest.tracking_url?.trim() || null,
      carrier: latest.carrier_code?.trim() || null,
      listingStatus: latest.listing_status?.trim() || null,
    };
  }

  /**
   * Chi phí từng dòng hàng.
   *
   * Nguồn chính: `line_items[]` cấp đơn. Tài liệu (Get order details) lặp lại CÙNG dòng hàng — cùng
   * `id` — trong `fulfillments[].line_items[]`; dòng cấp đơn thiếu `item_cost` thì lấy ở đó theo `id`
   * (cùng một dòng, không phải đoán). Đơn chỉ có `fulfillments[].line_items[]` ⇒ dùng chúng.
   */
  lineCosts(order: SellerwixOrder | null | undefined): SellerwixLineCost[] {
    const idOf = (item: { id?: string | number | null }) =>
      item.id !== undefined && item.id !== null && String(item.id).trim() ? String(item.id).trim() : null;
    const nested = (order?.fulfillments ?? []).flatMap((part) => part.line_items ?? []);
    const top = order?.line_items ?? [];
    const nestedById = new Map(
      nested.flatMap((item) => {
        const id = idOf(item);
        return id ? [[id, item] as const] : [];
      }),
    );
    return (top.length > 0 ? top : nested).map((item) => {
      const providerItemId = idOf(item);
      const twin = providerItemId ? nestedById.get(providerItemId) : undefined;
      return {
        providerItemId,
        referenceId: item.reference_id?.trim() || twin?.reference_id?.trim() || null,
        sku: item.sku?.trim() || twin?.sku?.trim() || null,
        itemCost: this.toNumber(item.item_cost) ?? this.toNumber(twin?.item_cost),
      };
    });
  }

  /** Tổng chi phí cấp đơn — `null` khi Sellerwix chưa báo (KHÔNG quy về 0). */
  orderCosts(order: SellerwixOrder | null | undefined): {
    total: number | null;
    shippingFee: number | null;
    subtotal: number | null;
  } {
    const parts = order?.fulfillments ?? [];
    const shipping = parts
      .map((part) => this.toNumber(part.shipping_cost))
      .filter((value): value is number => value !== null);
    const items = (order?.line_items ?? [])
      .map((item) => this.toNumber(item.item_cost))
      .filter((value): value is number => value !== null);

    return {
      total: this.toNumber(order?.total_cost),
      shippingFee: this.sum(shipping),
      subtotal: this.sum(items),
    };
  }

  /**
   * Khoá `print_areas[].key` của MỘT biến thể cho một vị trí in NCMedia.
   *
   * Thứ tự: `placementMap` khai ở Product Mapping (phải là một `key` CÓ trong `print_areas` của
   * biến thể) → mặc định theo `display_name` đã có trong tài liệu (Front / Back). Không khớp ⇒
   * `null` ⇒ readiness báo PLACEMENT_UNSUPPORTED.
   */
  resolvePrintAreaKey(
    placement: PodDesignPlacement,
    placementMap: unknown,
    printAreas: SellerwixVariantPrintArea[],
  ): string | null {
    const keys = new Set(printAreas.map((area) => area.key).filter(Boolean) as string[]);

    if (placementMap && typeof placementMap === 'object') {
      const custom = (placementMap as Record<string, unknown>)[placement];
      if (typeof custom === 'string' && keys.has(custom)) return custom;
    }

    const displayName =
      SELLERWIX_DEFAULT_PLACEMENT_DISPLAY_NAMES[
        placement as keyof typeof SELLERWIX_DEFAULT_PLACEMENT_DISPLAY_NAMES
      ];
    if (!displayName) return null;
    const match = printAreas.find(
      (area) => area.key && area.display_name?.trim().toLowerCase() === displayName,
    );
    return match?.key ?? null;
  }

  /**
   * Phương thức vận chuyển dùng được cho CẢ đơn: có ở MỌI biến thể, đang `active`, và giao được
   * tới quốc gia người nhận (`shipping_rates[].country_code`, hoặc dòng `OTHERS` như ví dụ tài liệu).
   */
  intersectShippingMethods(
    perVariant: SellerwixShippingMethod[][],
    countryCode: string | null,
  ): SellerwixShippingOption[] {
    if (perVariant.length === 0) return [];
    const usable = perVariant.map(
      (methods) =>
        new Map(
          methods
            .filter((method) => method.code && method.active !== false)
            .filter((method) => this.deliversTo(method, countryCode))
            .map((method) => [method.code as string, method]),
        ),
    );

    const [first, ...rest] = usable;
    return [...first.values()]
      .filter((method) => rest.every((map) => map.has(method.code as string)))
      .map((method) => ({
        code: method.code as string,
        name: method.name?.trim() || (method.code as string),
        carrier: method.carrier?.trim() || null,
        type: method.type?.trim() || null,
      }));
  }

  toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private toLineItem(
    line: SellerwixResolvedLine,
    params: { shippingMethod: string; labelUrl?: string | null },
  ): SellerwixLineItemRequest {
    const item: SellerwixLineItemRequest = {
      sku: line.sku,
      quantity: line.quantity,
      shipping_method: params.shippingMethod,
      reference_id: line.referenceId,
      print_areas: line.printAreas.map((area) => ({ key: area.key, url: area.url })),
    };
    // `label_url` nằm ở cấp DÒNG HÀNG trong tài liệu; nhãn của đơn áp cho mọi dòng.
    if (params.labelUrl) item.label_url = params.labelUrl;
    return item;
  }

  private mapStatus(raw: string): FulfillmentStatus {
    const key = raw.trim().toLowerCase() as SellerwixFulfillmentStatus;
    const mapped = SELLERWIX_STATUS_MAP[key];
    if (mapped) return mapped;
    this.logger.warn({
      module: 'fulfillment',
      provider: 'SELLERWIX',
      providerStatus: raw,
      msg: 'Trạng thái Sellerwix chưa được ánh xạ — giữ nguyên ở providerStatus, đánh dấu UNKNOWN',
    });
    return FulfillmentStatus.UNKNOWN;
  }

  private deliversTo(method: SellerwixShippingMethod, countryCode: string | null): boolean {
    const rates = method.shipping_rates ?? [];
    // Không có bảng giá ⇒ tài liệu không nói phương thức giao tới đâu ⇒ KHÔNG loại (không đoán).
    if (rates.length === 0 || !countryCode) return true;
    const country = countryCode.trim().toUpperCase();
    const exact = rates.filter((rate) => rate.country_code?.trim().toUpperCase() === country);
    const fallback = rates.filter((rate) => rate.country_code?.trim().toUpperCase() === 'OTHERS');
    const candidates = exact.length > 0 ? exact : fallback;
    return candidates.some((rate) => rate.deliverable !== false);
  }

  /**
   * Tổng tiền làm tròn tới 4 chữ số — đúng độ chính xác cột `Decimal(18,4)`, để 10.45 + 12.6 là
   * 23.05 chứ không phải 23.049999999999997. Rỗng ⇒ `null` ("chưa báo giá" ≠ 0).
   */
  private sum(values: number[]): number | null {
    if (values.length === 0) return null;
    return Math.round(values.reduce((total, value) => total + value, 0) * 10_000) / 10_000;
  }

  private timeOf(value: string | undefined): number {
    const time = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(time) ? time : 0;
  }

  private mask(value: string): string {
    if (value.length <= 2) return '***';
    return `${value.slice(0, 1)}***`;
  }
}
