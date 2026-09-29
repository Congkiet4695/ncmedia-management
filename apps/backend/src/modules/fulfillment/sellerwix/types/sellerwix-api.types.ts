/**
 * Kiểu dữ liệu Sellerwix Public API — chép từ bảng tham số / response của collection Postman.
 *
 * 🔴 Mọi field đều `?` / `| null` ở chiều ĐỌC: tài liệu không cam kết field nào luôn có mặt, và
 * ví dụ response nhiều chỗ lệch với bảng mô tả (vd `preview.print_area_width` vs `width`).
 * Ở chiều GHI chỉ những field được tài liệu đánh dấu Required mới bắt buộc.
 */

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface SellerwixCategory {
  id?: number | string;
  title?: string;
  supplier?: { name?: string } | null;
}

export interface SellerwixCategoryProduct {
  /** SKU sản phẩm (vd `SW-MD-MPT`) — tham số `:sku` của Get product variants. */
  sku?: string;
  title?: string;
  description?: string;
  img_src?: string;
  additional_design_price?: number;
  is_rush_service?: boolean;
  active?: boolean;
  /** Mô tả: "link to retrieve all product's variants". */
  item_variants?: string;
}

export interface SellerwixPrintAreaPreview {
  template_image?: string;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
  print_area_width?: number;
  print_area_height?: number;
}

export interface SellerwixVariantPrintArea {
  /** Khoá gửi trong `line_items[].print_areas[].key` (vd `CF`, `FB`). */
  key?: string;
  display_name?: string;
  width?: number;
  height?: number;
  dpi?: number;
  required?: boolean;
  preview?: SellerwixPrintAreaPreview | null;
  accepted_extension?: string;
  convert_fee?: number;
  additional_fee?: number;
}

export interface SellerwixVariant {
  /** SKU biến thể — giá trị gửi trong `line_items[].sku`. */
  sku?: string;
  title?: string;
  active?: boolean;
  is_rush_service?: boolean;
  label_support?: boolean;
  cost?: number;
  color?: { name?: string; code?: string } | null;
  size?: { name?: string } | null;
  print_areas?: SellerwixVariantPrintArea[];
}

export interface SellerwixVariantPage {
  paging?: { total?: number; next_page?: string | null } | null;
  data?: SellerwixVariant[];
}

export interface SellerwixShippingRate {
  country_code?: string;
  state_code?: string;
  deliverable?: boolean;
  first_product?: number;
  additional_product?: number;
  surcharge?: number;
}

export interface SellerwixShippingMethod {
  name?: string;
  /** "method shipping code" — giá trị gửi trong `line_items[].shipping_method`. */
  code?: string;
  carrier?: string;
  /** domestic | international */
  type?: string;
  active?: boolean;
  shipping_rates?: SellerwixShippingRate[];
}

// ---------------------------------------------------------------------------
// Order — chiều GHI
// ---------------------------------------------------------------------------

export interface SellerwixPrintAreaRequest {
  key: string;
  url: string;
  extra_image?: string;
  print_file?: string;
  print_area_note?: string;
}

export interface SellerwixLineItemRequest {
  sku: string;
  quantity: number;
  shipping_method: string;
  print_areas?: SellerwixPrintAreaRequest[];
  reference_id?: string;
  name?: string;
  preview_url?: string;
  label_url?: string;
  variant_note?: string;
}

export interface SellerwixAddressRequest {
  name: string;
  address1: string;
  city: string;
  zip: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  email?: string;
  phone?: string;
  address2?: string;
  state?: string;
  force_verified_delivery?: boolean;
}

export interface SellerwixCreateOrderRequest {
  store_id: string;
  line_items: SellerwixLineItemRequest[];
  address: SellerwixAddressRequest;
  reference_id?: string;
  note?: string;
  gift_message?: string;
  rush_service?: boolean;
}

export interface SellerwixCreateOrderResponse {
  id?: string;
  reference_id?: string;
}

export interface SellerwixCancelOrderRequest {
  reason?: string;
}

// ---------------------------------------------------------------------------
// Order — chiều ĐỌC (Get order details / Cancel / Webhook `data`)
// ---------------------------------------------------------------------------

export interface SellerwixTracking {
  tracking_number?: string;
  tracking_url?: string;
  tracking_date?: string;
  carrier_code?: string;
  /** Processing, In Queue, Error, Completed */
  listing_status?: string;
}

export interface SellerwixOrderLineItem {
  id?: string;
  reference_id?: string;
  sku?: string;
  quantity?: number;
  shipping_method?: string;
  item_cost?: number;
  shipping_cost?: number;
  label_url?: string;
  name?: string;
}

export interface SellerwixFulfillment {
  status?: string;
  message?: string;
  total_cost?: number;
  shipping_cost?: number;
  surcharge?: number;
  line_items?: SellerwixOrderLineItem[];
  trackings?: SellerwixTracking[];
}

export interface SellerwixOrderAddress {
  email?: string;
  name?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  zip?: string;
  country?: string;
  state?: string;
  force_verified_delivery?: boolean;
}

export interface SellerwixOrder {
  id?: string;
  reference_id?: string;
  store_id?: string;
  created_at?: string;
  total_cost?: number;
  channel_status?: string;
  channel_shipping_type?: string;
  label_url?: string;
  address?: SellerwixOrderAddress | null;
  line_items?: SellerwixOrderLineItem[];
  fulfillments?: SellerwixFulfillment[];
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export interface SellerwixWebhookPayload {
  event?: {
    id?: string;
    /** order:updated | order:shipment */
    type?: string;
    created_at?: string;
  };
  data?: SellerwixOrder;
}

// ---------------------------------------------------------------------------
// Lỗi — hai dạng body xuất hiện trong ví dụ của tài liệu
// ---------------------------------------------------------------------------

/** `{ code, message }` (order/category/product) hoặc `{ error, message }` (catalog). */
export interface SellerwixErrorBody {
  code?: number | string;
  error?: string;
  message?: string;
}
