import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentStatus, PodDesignPlacement } from '@prisma/client';
import {
  MANGO_ORDER_ID_MAX_LENGTH,
  MANGO_PRINT_POSITIONS,
  type MangoFacility,
  type MangoPreferredCarrier,
  type MangoPrintPosition,
  type MangoShippingMethod,
  type MangoSpeedType,
} from '../constants/mango.constants';
import {
  MangoCreateOrderRequest,
  MangoOrderItemRequest,
  MangoOrderResponse,
  MangoPrintFile,
  MangoUpdateOrderRequest,
} from '../types/mango-api.types';
import type { TiktokRecipientAddress } from '../../../pod-tiktok/types/tiktok-order.types';

/** Địa chỉ giao hàng đã chuẩn hoá sang đúng field Mango yêu cầu. */
export interface NormalizedAddress {
  first_name: string;
  last_name: string | null;
  email?: string;
  phone: string | null;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  state: string;
  country: string;
  zip: string;
}

/** Một dòng sản phẩm đã ghép đủ SKU + design, sẵn sàng đưa vào request. */
export interface ResolvedItem {
  podOrderItemId: string;
  providerSku: string;
  quantity: number;
  productionConfig: string | null;
  /**
   * Giá vốn khai ở Product Mapping tại thời điểm gửi.
   *
   * KHÔNG gửi sang nhà cung cấp (họ tự tính giá) — chỉ để chép vào
   * `fulfillment_order_items.base_cost` làm ảnh chụp bất biến. Sửa giá vốn của ánh xạ về sau
   * KHÔNG được làm đổi lợi nhuận của đơn đã gửi.
   */
  baseCost: number | null;
  /**
   * Line sản xuất khai ở Product Mapping cho sản phẩm này (id của nhà cung cấp).
   *
   * 🔴 KHÔNG gửi trong `items[]`: OrderCreateSchema không có trường production line — Mango suy
   * ra xưởng từ chính sản phẩm. Giá trị này dùng để (1) phát hiện một đơn trộn nhiều xưởng
   * TRƯỚC khi gửi, và (2) ghi lên bản ghi fulfillment để đối soát.
   */
  productionLine: string | null;
  printFiles: MangoPrintFile[];
  /**
   * `items[].item_id` gửi kèm — chính là id dòng `fulfillment_order_items` của NCMedia.
   *
   * 🔴 Tài liệu cho phép tự đặt (`item_id`: "auto-generated if not provided"), và đây là thứ
   * DUY NHẤT ghép được giá vốn Mango trả về đúng dòng hàng nội bộ: một đơn có thể có hai dòng
   * cùng SKU (hai line item TikTok của cùng biến thể), ghép theo SKU sẽ gán nhầm.
   */
  itemId?: string | null;
}

/** Tuỳ chọn gửi đơn do người vận hành chọn trên màn hình Fulfill (không phải mặc định tài khoản). */
export interface MangoFulfillOptions {
  shippingMethod: MangoShippingMethod;
  facility?: string | null;
  speedType?: MangoSpeedType | null;
  preferredCarrier?: MangoPreferredCarrier | null;
  isScanLabel?: boolean;
  labelUrl?: string | null;
  note?: string | null;
}

/** Giá vốn + thuộc tính biến thể Mango báo về cho MỘT dòng hàng. */
export interface ProviderItemCost {
  /** `item_id` — id dòng `fulfillment_order_items` nếu đơn được gửi kèm item_id. */
  itemId: string | null;
  sku: string | null;
  quantity: number | null;
  baseCost: number | null;
  color: string | null;
  size: string | null;
}

/**
 * Ánh xạ MẶC ĐỊNH vị trí in NCMedia → `print_files[].key` của Mango.
 *
 * Chỉ áp dụng khi bản ghi ánh xạ sản phẩm không khai `placementMap` riêng.
 * 🔴 Không phải vị trí nào của NCMedia cũng có tương ứng ở mọi production line
 * (vd `*_chest` chỉ VNEMB) — nên bản ghi ánh xạ luôn được ưu tiên hơn bảng này.
 */
export const DEFAULT_PLACEMENT_MAP: Readonly<Record<PodDesignPlacement, MangoPrintPosition>> = {
  FRONT: 'front',
  BACK: 'back',
  LEFT: 'left_sleeve',
  RIGHT: 'right_sleeve',
  SLEEVE: 'left_sleeve',
  LABEL: 'neck_label',
};

/**
 * Ánh xạ trạng thái Mango → trạng thái chuẩn hoá của NCMedia.
 *
 * 🔴 Giá trị KHÔNG có trong bảng này sẽ về `UNKNOWN` chứ không đoán bừa —
 * trạng thái gốc vẫn được lưu nguyên văn ở `providerStatus` nên không mất thông tin.
 */
export const MANGO_STATUS_MAP: Readonly<Record<string, FulfillmentStatus>> = {
  new_order: FulfillmentStatus.SUBMITTED,
  in_production: FulfillmentStatus.IN_PRODUCTION,
  on_hold: FulfillmentStatus.ON_HOLD,
  shipped: FulfillmentStatus.SHIPPED,
  rejected: FulfillmentStatus.REJECTED,
  cancelled: FulfillmentStatus.CANCELLED,
  in_production_cancelled: FulfillmentStatus.CANCELLED,
  full_refunded: FulfillmentStatus.REFUNDED,
  partial_refunded: FulfillmentStatus.REFUNDED,
};

/**
 * `tracking_status` của Mango → trạng thái chuẩn hoá.
 * Chỉ `delivered` mới nâng lên DELIVERED; các giá trị khác giữ nguyên SHIPPED.
 */
const DELIVERED_TRACKING_STATUS = 'delivered';

/**
 * MangoOrderMapper — Anti-Corruption Layer chiều ĐI (NCMedia → Mango).
 *
 * Nguyên tắc:
 *  - Chỉ dùng field/enum có trong tài liệu chính thức.
 *  - Không tự chế giá trị: thiếu dữ liệu thì báo lỗi rõ ràng ở tầng validate,
 *    tuyệt đối không điền giá trị giả để "cho qua".
 *  - PII người nhận được che trước khi lưu `rawRequest` (đối soát được mà không lộ dữ liệu).
 */
@Injectable()
export class MangoOrderMapper {
  private readonly logger = new Logger(MangoOrderMapper.name);

  /**
   * Sinh `order_id` gửi sang Mango.
   *
   * Mango yêu cầu DUY NHẤT (tối đa 40 ký tự) và báo lỗi nếu trùng ⇒ đây chính là khoá
   * idempotency: gọi lại với cùng mã sẽ bị từ chối thay vì tạo hai đơn ở xưởng in.
   * Dùng chính `tiktokOrderId` để người vận hành tra cứu hai chiều dễ dàng.
   */
  buildExternalOrderId(tiktokOrderId: string, prefix = 'NC'): string {
    const raw = `${prefix}-${tiktokOrderId}`;
    return raw.length <= MANGO_ORDER_ID_MAX_LENGTH ? raw : raw.slice(0, MANGO_ORDER_ID_MAX_LENGTH);
  }

  /**
   * Chuẩn hoá địa chỉ TikTok → các field Mango.
   *
   * TikTok trả `district_info[]` theo cấp (`address_level` L0=quốc gia … L3=phường/xã).
   * Mango cần `city` và `state` riêng biệt nên phải bóc từ mảng này.
   * Trả `null` khi thiếu field bắt buộc — tầng validate sẽ báo lỗi cụ thể.
   */
  normalizeAddress(recipient: TiktokRecipientAddress): NormalizedAddress | null {
    const { firstName, lastName } = this.splitName(recipient);
    const addressLine1 =
      recipient.address_line1?.trim() || recipient.address_detail?.trim() || null;
    const country = recipient.region_code?.trim() || this.districtByLevel(recipient, 'L0');
    const state = this.districtByLevel(recipient, 'L1');
    const city =
      this.districtByLevel(recipient, 'L2') ||
      recipient.post_town?.trim() ||
      this.districtByLevel(recipient, 'L3');
    const zip = recipient.postal_code?.trim() || null;

    if (!firstName || !addressLine1 || !city || !state || !country || !zip) return null;

    return {
      first_name: firstName,
      last_name: lastName,
      phone: recipient.phone_number?.trim() || null,
      address_line_1: addressLine1,
      address_line_2: recipient.address_line2?.trim() || null,
      city,
      state,
      country,
      zip,
    };
  }

  /**
   * Địa chỉ gửi kèm khi đơn đi theo **NHÃN VẬN CHUYỂN** (TikTok không cho đọc địa chỉ nữa).
   *
   * ```
   *   Địa chỉ thật nằm TRÊN NHÃN. Xưởng in dán nhãn đó lên hộp và đưa cho hãng vận chuyển;
   *   các trường địa chỉ trong đơn của nhà cung cấp chỉ còn là dữ liệu hồ sơ.
   * ```
   *
   * 🔴 **Không bịa thông tin người nhận.** Hàm này chỉ chuyển tiếp thứ TikTok còn cung cấp
   * (mã quốc gia, mã bưu chính, bang/thành phố nếu còn); trường nào TikTok đã che thì gửi đi
   * đúng dấu hiệu đã che `***` — nhà cung cấp nhìn vào biết ngay đây là đơn đi theo nhãn, chứ
   * không nhận một cái tên/địa chỉ giả trông như thật.
   *
   * ⚠️ Nhà cung cấp có quyền từ chối đơn thiếu địa chỉ đọc được. Đó là giới hạn của HỌ, và
   * thông điệp từ chối được trả nguyên văn về giao diện thay vì bị che bằng một lỗi tự chế.
   */
  buildLabelShippingAddress(params: {
    recipient: TiktokRecipientAddress | null;
    regionCode: string | null;
    postalCode: string | null;
  }): NormalizedAddress {
    const REDACTED = '***';
    const recipient = params.recipient;
    const value = (input: string | null | undefined): string | null => {
      const text = input?.trim();
      return text && text.length > 0 ? text : null;
    };

    const { firstName, lastName } = recipient
      ? this.splitName(recipient)
      : { firstName: null, lastName: null };

    return {
      first_name: value(firstName) ?? REDACTED,
      last_name: value(lastName),
      phone: recipient ? value(recipient.phone_number) : null,
      address_line_1:
        (recipient ? value(recipient.address_line1) ?? value(recipient.address_detail) : null) ??
        REDACTED,
      address_line_2: recipient ? value(recipient.address_line2) : null,
      city:
        (recipient
          ? this.districtByLevel(recipient, 'L2') ||
            value(recipient.post_town) ||
            this.districtByLevel(recipient, 'L3')
          : null) ?? REDACTED,
      state: (recipient ? this.districtByLevel(recipient, 'L1') : null) ?? REDACTED,
      country:
        (recipient ? value(recipient.region_code) || this.districtByLevel(recipient, 'L0') : null) ??
        value(params.regionCode) ??
        REDACTED,
      zip: (recipient ? value(recipient.postal_code) : null) ?? value(params.postalCode) ?? REDACTED,
    };
  }

  /** Dựng payload tạo đơn. Mọi dữ liệu đã được validate TRƯỚC khi vào đây. */
  buildCreateOrderRequest(params: {
    externalOrderId: string;
    address: NormalizedAddress;
    items: ResolvedItem[];
    shippingMethod: MangoShippingMethod;
    facility?: string | null;
    speedType?: string | null;
    /** Nhãn vận chuyển do TikTok cấp (đơn 4PL) — Mango dùng thay vì tự mua nhãn. */
    labelUrl?: string | null;
    note?: string | null;
    /** Tên shop/seller để xưởng in đối chiếu. */
    seller?: string | null;
    buyerEmail?: string | null;
    /** `is_scan_label` — chỉ có tác dụng với production line TIKTOK (tài liệu). */
    isScanLabel?: boolean;
    /** `preferred_carrier` — chỉ dùng khi đơn tự mua nhãn (auto | usps). */
    preferredCarrier?: MangoPreferredCarrier | null;
  }): MangoCreateOrderRequest {
    const request: MangoCreateOrderRequest = {
      order_id: params.externalOrderId,
      items: params.items.map((item) => this.toItemRequest(item)),
      first_name: params.address.first_name,
      last_name: params.address.last_name,
      phone: params.address.phone,
      address_line_1: params.address.address_line_1,
      address_line_2: params.address.address_line_2,
      city: params.address.city,
      state: params.address.state,
      country: params.address.country,
      zip: params.address.zip,
      shipping_method: params.shippingMethod,
    };

    // Chỉ gửi field khi thực sự có giá trị — gửi null thừa dễ bị VALIDATION_ERROR.
    if (params.buyerEmail) request.email = params.buyerEmail;
    if (params.facility) request.facility = params.facility;
    if (params.speedType) request.speed_type = params.speedType as never;
    if (params.labelUrl) request.label_url = params.labelUrl;
    if (params.note) request.note = params.note;
    if (params.seller) request.seller = params.seller;
    if (params.isScanLabel) request.is_scan_label = true;
    if (params.preferredCarrier) request.preferred_carrier = params.preferredCarrier;

    return request;
  }

  /**
   * Dựng payload SỬA đơn (PUT /orders/{order_id}) — chỉ những field người dùng thực sự đổi.
   *
   * 🔴 KHÔNG bao giờ gửi kèm `items`: dòng hàng đã ra xưởng in, gửi lại là kích hoạt chuyển đổi
   * file in lần nữa và mở đường cho sai lệch giữa cái đã sản xuất và cái đang lưu. Chỉ `label_url`
   * / `shipping_method` / `note` — đúng ba thứ đổi được sau khi đơn đã nhận mà chưa vào sản xuất.
   */
  buildUpdateOrderRequest(params: {
    labelUrl?: string | null;
    note?: string | null;
    shippingMethod?: MangoShippingMethod | null;
  }): MangoUpdateOrderRequest {
    const request: MangoUpdateOrderRequest = {};
    if (params.labelUrl !== undefined) request.label_url = params.labelUrl;
    if (params.note !== undefined) request.note = params.note;
    if (params.shippingMethod) request.shipping_method = params.shippingMethod;
    return request;
  }

  /**
   * Bóc giá vốn + màu/size từ `items[]` của Mango (Create Order, Get Order Detail, Update Order
   * dùng chung `OrderResponseSchema`).
   *
   * Giá trị không đọc được ⇒ `null`, KHÔNG quy về 0: "chưa có giá" và "giá bằng 0" là hai
   * chuyện khác nhau, và ghi 0 lên một đơn chưa được báo giá là làm hỏng số liệu lợi nhuận.
   */
  readProviderItems(detail: MangoOrderResponse | null | undefined): ProviderItemCost[] {
    return (detail?.items ?? []).map((item) => ({
      itemId: item.item_id?.trim() || null,
      sku: item.sku?.trim() || null,
      quantity: typeof item.quantity === 'number' ? item.quantity : null,
      baseCost: this.toNumber(item.base_cost),
      color: item.color?.trim() || null,
      size: item.size?.trim() || null,
    }));
  }

  /** Số hợp lệ hoặc `null` — Mango có thể trả chuỗi, `null`, hoặc bỏ hẳn field. */
  toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Che PII trước khi lưu `rawRequest` vào DB (vẫn đủ để đối soát kỹ thuật). */
  maskRequestForStorage(request: MangoCreateOrderRequest): Record<string, unknown> {
    return {
      ...request,
      first_name: this.mask(request.first_name),
      last_name: request.last_name ? this.mask(request.last_name) : null,
      email: request.email ? this.mask(request.email) : undefined,
      phone: request.phone ? this.mask(request.phone) : null,
      address_line_1: this.mask(request.address_line_1),
      address_line_2: request.address_line_2 ? this.mask(request.address_line_2) : null,
      // city/state/country/zip giữ nguyên: cần cho đối soát vùng giao hàng và không định danh cá nhân.
    };
  }

  /** Ánh xạ trạng thái Mango → trạng thái chuẩn hoá; giá trị lạ ⇒ UNKNOWN + log. */
  toFulfillmentStatus(
    providerStatus: string | null | undefined,
    trackingStatus?: string | null,
  ): FulfillmentStatus {
    if (!providerStatus) return FulfillmentStatus.UNKNOWN;
    const mapped = MANGO_STATUS_MAP[providerStatus.toLowerCase()];
    if (!mapped) {
      this.logger.warn({
        module: 'fulfillment',
        provider: 'MANGO',
        providerStatus,
        msg: 'Trạng thái Mango chưa được ánh xạ — giữ nguyên ở providerStatus, đánh dấu UNKNOWN',
      });
      return FulfillmentStatus.UNKNOWN;
    }
    // Đã ship và tracking báo đã giao ⇒ nâng lên DELIVERED (Mango không có status riêng).
    if (
      mapped === FulfillmentStatus.SHIPPED &&
      trackingStatus?.toLowerCase() === DELIVERED_TRACKING_STATUS
    ) {
      return FulfillmentStatus.DELIVERED;
    }
    return mapped;
  }

  /** Đọc ánh xạ vị trí in từ bản ghi mapping (JSON) — giá trị lạ bị loại bỏ. */
  resolvePlacement(
    placement: PodDesignPlacement,
    placementMap: unknown,
  ): MangoPrintPosition | null {
    if (placementMap && typeof placementMap === 'object') {
      const custom = (placementMap as Record<string, unknown>)[placement];
      if (typeof custom === 'string' && this.isPrintPosition(custom)) return custom;
    }
    return DEFAULT_PLACEMENT_MAP[placement] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private toItemRequest(item: ResolvedItem): MangoOrderItemRequest {
    const request: MangoOrderItemRequest = {
      sku: item.providerSku,
      quantity: item.quantity,
      print_files: item.printFiles,
    };
    if (item.productionConfig) request.production_config = item.productionConfig;
    // Ghép giá vốn trả về đúng dòng hàng nội bộ — xem `ResolvedItem.itemId`.
    if (item.itemId) request.item_id = item.itemId;
    return request;
  }

  private isPrintPosition(value: string): value is MangoPrintPosition {
    return (MANGO_PRINT_POSITIONS as readonly string[]).includes(value);
  }

  /** Ép kiểu facility đã được DTO kiểm — giữ ở ACL để service không phải biết enum của Mango. */
  asFacility(value: string | null | undefined): MangoFacility | null {
    return (value as MangoFacility | null | undefined) ?? null;
  }

  /**
   * Tách họ và tên. TikTok có thể trả `first_name`/`last_name` riêng, hoặc chỉ `name`.
   * Với `name`, quy ước lấy từ CUỐI làm họ (đúng với định dạng tên phương Tây của thị trường US).
   */
  private splitName(recipient: TiktokRecipientAddress): {
    firstName: string | null;
    lastName: string | null;
  } {
    const first = recipient.first_name?.trim();
    const last = recipient.last_name?.trim();
    if (first) return { firstName: first, lastName: last || null };

    const full = recipient.name?.trim();
    if (!full) return { firstName: null, lastName: null };

    const parts = full.split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: null };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
  }

  /** Lấy tên đơn vị hành chính theo cấp (`address_level` dạng "L0".."L3"). */
  private districtByLevel(recipient: TiktokRecipientAddress, level: string): string | null {
    const found = recipient.district_info?.find(
      (district) => district.address_level?.toUpperCase() === level,
    );
    return found?.address_name?.trim() || null;
  }

  /** Che chuỗi PII: giữ 1 ký tự đầu để vẫn nhận diện được khi đối soát. */
  private mask(value: string): string {
    if (value.length <= 2) return '***';
    return `${value.slice(0, 1)}***`;
  }
}
