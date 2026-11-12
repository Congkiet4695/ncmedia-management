/**
 * Kiểu dữ liệu Pressify Seller API — theo tài liệu https://pressify.us/docs/api/index.html và response
 * THẬT (lượt gọi chỉ-đọc 2026-11-11). Field ngoài tài liệu được khai là tuỳ chọn và CHỈ dùng khi API thật
 * có trả; mọi chỗ khác tài liệu được ghi chú ngay tại field.
 */

/** Phong bì lỗi chung (tài liệu "Errors"): `{ data, msg, status: "error" }`. */
export interface PressifyEnvelope<T> {
  data?: T;
  msg?: string;
  message?: string;
  status?: string;
  /** 422 (Laravel): lỗi theo từng field. */
  errors?: Record<string, string[]>;
  /** Một số lỗi (404/500 của GET /order/{id}) chỉ có `error`. */
  error?: string;
}

/** Giá của một biến thể theo bậc (`product_prices[]`). API thật trả HAI dòng/bậc (`shipping_type` 0 và 1). */
export interface PressifyProductPrice {
  id?: number;
  product_variant_id?: number;
  tier_id: number | string;
  price: string | number | null;
  type?: number;
  shipping_type?: number;
}

/**
 * Biến thể trong GET /all-product · GET /product/{id}.
 *
 * 🔴 Định danh = `variant_id` (số nguyên, duy nhất trên toàn danh mục — đã kiểm 807/807). Tài liệu: "Use
 * variant_id, not id"; API thật trả `id = null`. `sku` có thể RỖNG / NULL (294/807 biến thể) ⇒ không
 * dùng SKU làm định danh.
 *
 * Các field giá `price`, `basecost`, `landed_cost*` là field NỘI BỘ (tài liệu: "not what you pay").
 */
export interface PressifyVariant {
  variant_id: number;
  id?: number | null;
  product_id?: number;
  sku?: string | null;
  style?: string | null;
  color?: string | null;
  hex?: string | null;
  size?: string | null;
  weight?: string | null;
  active?: number | boolean | null;
  stock?: number | null;
  price?: string | number | null;
  basecost?: string | number | null;
  landed_cost?: string | number | null;
  landed_cost_twoside?: string | number | null;
  landed_cost_sleeve?: string | number | null;
  mockup_src?: string | null;
  product_prices?: PressifyProductPrice[];
  [key: string]: unknown;
}

export interface PressifyAccessoryItem {
  tier_id?: string | number;
  code?: string;
  style?: string;
  fee?: string;
  method?: string;
  [key: string]: unknown;
}

export interface PressifyProductAccessory {
  name?: string;
  accessory_items?: PressifyAccessoryItem[];
  [key: string]: unknown;
}

export interface PressifyTemplate {
  id: number;
  side: string;
  type: string;
  size: string | null;
  width: number;
  height: number;
  dpi: number;
  [key: string]: unknown;
}

/** Sản phẩm trong GET /all-product (cùng dạng GET /product/{id}, không có `templates`). */
export interface PressifyProduct {
  id: number;
  name?: string | null;
  brand?: string | null;
  material?: string | null;
  technology?: string | null;
  style?: string | null;
  mockup_src?: string | null;
  /** API thật: 1 = đang bán. Tài liệu: GET /all-product chỉ trả sản phẩm đang bán. */
  status?: number | null;
  content?: string | null;
  templates?: PressifyTemplate[];
  variants?: PressifyVariant[];
  accessories?: PressifyProductAccessory[];
  [key: string]: unknown;
}

/** GET /all-product — `{ data: Product[], tiers: { "11": "Silver", ... } }`. Không phân trang. */
export interface PressifyAllProductsResponse {
  data?: PressifyProduct[];
  tiers?: Record<string, string>;
}

/** Một dòng của GET /product/accessory (theo bậc của store). */
export interface PressifyAccessory {
  product?: string;
  accessory?: string;
  code?: string;
  style?: string;
  price?: string;
}

// ---------------------------------------------------------------------------
// Đơn hàng
// ---------------------------------------------------------------------------

export interface PressifyAddress {
  /** Họ tên đầy đủ — "The first word becomes the first name". */
  name: string;
  phone?: string;
  street1: string;
  street2?: string;
  city: string;
  /** Mã bang với địa chỉ Mỹ (vd TX). */
  state: string;
  zip: string;
  /** Mã quốc gia (vd US). */
  country: string;
}

export interface PressifyPrintFile {
  key: string;
  url: string;
  oversize?: boolean;
  note?: string;
}

export interface PressifyLineItem {
  variant_id: number;
  quantity: number;
  product_name?: string;
  /** Tài liệu: gửi ít nhất một trong mockup / mockup_back / mockup_sleeve_left / mockup_sleeve_right. */
  mockup?: string;
  mockup_back?: string;
  mockup_sleeve_left?: string;
  mockup_sleeve_right?: string;
  print_files: PressifyPrintFile[];
}

/** POST /order. `api_key` nằm TRONG body (tài liệu "Authentication"). Đúng MỘT trong address / shipping_label. */
export interface PressifyCreateOrderRequest {
  api_key: string;
  ref_id: string;
  order_status: string;
  shipping_method: string;
  shipping_service?: string;
  shipping_label?: string;
  address?: PressifyAddress;
  note?: string;
  production?: string;
  line_items: PressifyLineItem[];
}

export interface PressifyPricePreview {
  shipping_fee?: number;
  total_print_base_cost?: number;
  total?: number;
  data_total_print_cost?: Array<{
    variant_id: number | string;
    price?: { total_print_base_cost?: number };
  }>;
  [key: string]: unknown;
}

/** 200 của POST /order: `data` = id đơn Pressify, `price` = giá TẠM TÍNH. */
export interface PressifyCreateOrderResponse {
  data?: number | string;
  price?: PressifyPricePreview;
  msg?: string;
  status?: string;
}

export interface PressifyOrderItem {
  id?: number;
  order_id?: number;
  /** Giá in đã tính cho dòng. Chuỗi (vd "7.98"). */
  price?: string | number | null;
  sku?: string | null;
  status?: string | null;
  quantity?: number;
  product_name?: string | null;
  mockup?: string | null;
  mockup_back?: string | null;
  /** 🔴 Tài liệu ví dụ là số; API thật trả CHUỖI ("3183") ⇒ luôn so khớp sau khi chuẩn hoá về chuỗi. */
  variant_id?: number | string | null;
}

/** GET /order/{id} — KHÔNG bọc trong `data`. Có địa chỉ người nhận ⇒ phải che trước khi lưu. */
export interface PressifyOrder {
  id: number | string;
  ref_id?: string | null;
  store_id?: number;
  shipping_label?: string | null;
  shipping_service?: string | null;
  shipping_method?: string | null;
  tracking_id?: string | null;
  fulfill_status?: string | null;
  payment_status?: string | null;
  total_cost?: string | number | null;
  paid_cost?: string | number | null;
  print_cost?: string | number | null;
  shipping_cost?: string | number | null;
  vat?: string | number | null;
  surcharge?: string | number | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  items?: PressifyOrderItem[];
  [key: string]: unknown;
}

/** GET /orders — một trang đơn (`meta` kiểu Laravel). */
export interface PressifyOrderListResponse {
  data?: PressifyOrder[];
  meta?: { current_page?: number; per_page?: number; total?: number; last_page?: number };
  msg?: string;
  status?: string;
}

/** GET /order/cancel/{id} — LUÔN HTTP 200, đọc `status`. */
export interface PressifyCancelResponse {
  data?: number | string;
  msg?: string;
  status?: string;
}

/** Webhook (tài liệu "Webhooks"): POST `{ data: {...} }`. `data.api_key` = store của đơn. */
export interface PressifyWebhookPayload {
  data?: {
    id?: number | string;
    ref_id?: string;
    status?: string;
    total_price?: string;
    tracking?: string | null;
    payer_time?: string | null;
    carrier_code?: string | null;
    tracking_url?: string | null;
    label_url?: string | null;
    api_key?: string;
  };
}
