/**
 * Kiểu RAW của MangoV3 Public API.
 *
 * Tên field giữ NGUYÊN snake_case của Mango — đây là ranh giới Anti-Corruption Layer.
 * Mọi field không bắt buộc đều khai báo optional: nhà cung cấp có thể bổ sung/bỏ field
 * giữa các bản, parser phải khoan dung thay vì vỡ.
 */

import type {
  MangoPrintPosition,
  MangoShippingMethod,
  MangoSpeedType,
  MangoWebhookEvent,
} from '../constants/mango.constants';

/** Envelope chuẩn — MỌI response của Mango đều theo cấu trúc này (Overview). */
export interface MangoEnvelope<T> {
  status?: boolean;
  code?: string;
  message?: string;
  data?: T | null;
  timestamp?: string;
  request_id?: string;
}

/** Một lỗi validate trong `data.errors[]` khi `code = VALIDATION_ERROR`. */
export interface MangoValidationError {
  field?: string;
  message?: string;
  type?: string;
}

export interface MangoErrorData {
  errors?: MangoValidationError[];
}

/** Phân trang dùng chung cho các endpoint danh sách. */
export interface MangoPagination {
  total?: number;
  page?: number;
  limit?: number;
  pages?: number;
}

// ---------------------------------------------------------------------------
// Create Order — POST /orders
// ---------------------------------------------------------------------------

export interface MangoPrintFile {
  /** Vị trí in. BẮT BUỘC. */
  key: MangoPrintPosition;
  /** URL file in. BẮT BUỘC — Mango tải file từ URL này nên URL phải truy cập công khai. */
  url: string;
  /** Ảnh thu nhỏ để xem trước (khuyến nghị 200x200). */
  thumbnail?: string | null;
  /** Chỉ VNEMB: normal | pattern | glitter | puff. */
  print_tech?: string | null;
  /** Chỉ FASTUS: `large` dùng vùng in lớn và tính thêm phí. */
  size?: string | null;
}

export interface MangoOrderItemRequest {
  /** SKU biến thể phía Mango. BẮT BUỘC. */
  sku: string;
  quantity: number;
  /** `default` | `large`. */
  production_config?: string | null;
  print_files: MangoPrintFile[];
  preview_files?: MangoPrintFile[] | null;
  /** Mango tự sinh nếu bỏ trống. */
  item_id?: string | null;
  vnemb_design?: string | null;
  vnemb_mockup?: string | null;
  is_trademark?: number;
  special_print?: boolean;
}

export interface MangoCreateOrderRequest {
  /** Mã do NCMedia sinh, DUY NHẤT, tối đa 40 ký tự — Mango báo lỗi nếu trùng. */
  order_id: string;
  /**
   * Xưởng sản xuất (`id` từ `GET /production-lines`).
   *
   * 🔴 Không gửi trường này thì Mango TỰ CHỌN xưởng của họ — đó là lý do đơn chọn "TIKTOK"
   * lại về "FASTUS" trong đơn phía nhà cung cấp (`production_line_id` trong response của
   * Create Order là bằng chứng: hệ thống không gửi gì, Mango vẫn điền một giá trị).
   *
   * ⚠️ Chỉ gửi khi người vận hành THỰC SỰ chọn một line (ánh xạ sản phẩm hoặc mặc định của
   * tài khoản). Không chọn ⇒ bỏ hẳn trường, giữ nguyên hành vi cũ.
   */
  production_line_id?: string;
  /** Chỉ dùng cho production line TIKTOK. Mặc định AUTO. */
  facility?: string | null;
  /** Chỉ dùng cho production line FASTUS. */
  speed_type?: MangoSpeedType | null;
  items: MangoOrderItemRequest[];
  inserts?: Array<{ name: string; url: string; size?: string }> | null;

  // --- Người nhận & địa chỉ giao hàng ---
  first_name: string;
  last_name?: string | null;
  email?: string;
  phone?: string | null;
  address_line_1: string;
  address_line_2?: string | null;
  city: string;
  state: string;
  country: string;
  zip: string;
  ioss_number?: string | null;

  shipping_method: MangoShippingMethod;
  note?: string | null;
  /** Nhãn vận chuyển do người bán cung cấp (PDF/PNG/JPG). */
  label_url?: string | null;
  seller?: string | null;
  is_scan_label?: boolean;
  preferred_carrier?: string;
}

/**
 * `data` của Create Order.
 *
 * 🔴 Theo tài liệu (CreateOrderResponse → `data: OrderResponseSchema`), response tạo đơn trả về
 * **NGUYÊN một đơn**: trạng thái, `items[]` kèm `base_cost`, và `subtotal`/`tax`/`shipping_fee`/
 * `total`. Vì thế nó là chính `MangoOrderResponse` — khai riêng một kiểu rút gọn đồng nghĩa với
 * việc vứt bỏ giá vốn ngay tại lần gọi duy nhất chắc chắn có nó.
 */
export type MangoCreateOrderData = MangoOrderResponse;

// ---------------------------------------------------------------------------
// Get Order Detail — GET /orders/{order_id}
// ---------------------------------------------------------------------------

export interface MangoOrderItemResponse {
  sku?: string;
  item_id?: string | null;
  quantity?: number;
  color?: string | null;
  size?: string | null;
  product_name?: string | null;
  base_cost?: number | null;
  print_files?: MangoPrintFile[] | null;
  preview_files?: MangoPrintFile[] | null;
}

export interface MangoShipment {
  tracking_number?: string | null;
  tracking_status?: string | null;
  tracking_url?: string | null;
  carrier?: string | null;
  label_url?: string | null;
  primary?: boolean | null;
}

export interface MangoOrderResponse {
  id?: string;
  order_id?: string;
  /** Giữ `string` để chịu được trạng thái mới Mango bổ sung sau này. */
  status?: string;
  user_id?: string | null;
  production_line_id?: string | null;
  facility?: string | null;
  order_type?: string | null;
  speed_type?: string | null;

  subtotal?: number;
  tax?: number;
  shipping_fee?: number;
  discount?: number;
  total?: number;
  box_fee?: number | null;

  shipping_method?: string;
  tracking_number?: string | null;
  tracking_status?: string | null;
  label_url?: string | null;
  shipments?: MangoShipment[] | null;

  items?: MangoOrderItemResponse[];
  note?: string | null;
  payment_status?: string | null;
  production_status?: string | null;
  /** Mã đơn tại xưởng sản xuất. */
  order_fulfill_id?: string | null;
  rejected_status?: string | null;
  processed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Update Order — PUT /orders/{order_id}
// ---------------------------------------------------------------------------

/**
 * Thân request Update Order (OrderUpdateSchema) — MỌI field đều tuỳ chọn.
 *
 * 🔴 Tài liệu: "When updating items, label_url or shipping_method, will automatically:
 * Recalculate cost, Convert print files (if needed), Convert label (if needed)" và "Only allows
 * updating certain fields and when order is not processed yet".
 */
export interface MangoUpdateOrderRequest {
  note?: string | null;
  label_url?: string | null;
  seller?: string | null;
  shipping_method?: MangoShippingMethod | null;
  speed_type?: MangoSpeedType | null;
  facility?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zip?: string | null;
  ioss_number?: string | null;
  items?: MangoOrderItemRequest[];
}

/** `data` của Update Order — cùng `OrderResponseSchema` với Create/Get. */
export type MangoUpdateOrderData = MangoOrderResponse;

// ---------------------------------------------------------------------------
// Cancel Order — POST /orders/{order_id}/cancel
// ---------------------------------------------------------------------------

export interface MangoCancelOrderRequest {
  reason?: string | null;
}

export interface MangoCancelOrderData {
  order_id?: string;
  status?: string;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  refund_amount?: number | null;
  refund_status?: string | null;
}

// ---------------------------------------------------------------------------
// Catalog — Products / Variations / Production lines
// ---------------------------------------------------------------------------

export interface MangoProduct {
  id?: string;
  sku?: string;
  name?: string;
  description?: string | null;
  catalog_id?: string;
  catalog_name?: string;
  base_price?: string;
  currency?: string;
  images?: string[];
  is_active?: boolean;
  /** Số biến thể của sản phẩm — hiển thị để người dùng biết trước sẽ chọn trong bao nhiêu. */
  variations_count?: number;
  min_order_quantity?: number;
  max_order_quantity?: number | null;
  /**
   * Thuộc tính động do nhà cung cấp định nghĩa. Tài liệu KHÔNG có trường `brand` riêng;
   * nếu nhà cung cấp có gửi thì nó nằm ở đây. Đọc khoan dung, không giả định khoá nào tồn tại.
   */
  attributes?: Record<string, unknown>;
}

export interface MangoProductsData {
  items?: MangoProduct[];
  pagination?: MangoPagination;
}

export interface MangoVariation {
  id?: string;
  /** Giá trị dùng cho `items[].sku` khi tạo đơn. */
  sku?: string;
  product_id?: string;
  name?: string;
  color?: string | null;
  size?: string | null;
  price?: string;
  stock_quantity?: number;
  is_available?: boolean;
  attributes?: Record<string, unknown>;
}

export interface MangoVariationsData {
  product_id?: string;
  product_name?: string;
  items?: MangoVariation[];
  pagination?: MangoPagination;
}

export interface MangoProductionLine {
  id?: string;
  name?: string;
  description?: string | null;
  is_active?: boolean;
  supported_shipping_methods?: string[];
  supported_facilities?: string[];
  supports_speed_type?: boolean;
  supports_label_url?: boolean;
  requires_vnemb_fields?: boolean;
}

export interface MangoProductionLinesData {
  items?: MangoProductionLine[];
  pagination?: MangoPagination;
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/** Payload sự kiện `order.status` (tài liệu Webhooks). */
export interface MangoOrderStatusEvent {
  event: 'order.status';
  timestamp?: string;
  /** Chính là `order_id` NCMedia đã gửi khi tạo đơn. */
  order_id?: string;
  order_fulfill_id?: string;
  previous_status?: string;
  current_status?: string;
  production_line?: string;
}

/** Payload sự kiện `order.shipment`. */
export interface MangoOrderShipmentEvent {
  event: 'order.shipment';
  timestamp?: string;
  order_id?: string;
  order_fulfill_id?: string;
  tracking_number?: string;
  tracking_status?: string;
  production_line?: string;
  carrier?: string;
}

export type MangoWebhookPayload = MangoOrderStatusEvent | MangoOrderShipmentEvent;

export interface MangoWebhookCreateRequest {
  name: string;
  url: string;
  events: MangoWebhookEvent[];
}

export interface MangoWebhookData {
  id?: string;
  name?: string;
  url?: string;
  events?: string[];
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
  last_triggered_at?: string | null;
  last_status_code?: string | null;
  failure_count?: string | number;
}
