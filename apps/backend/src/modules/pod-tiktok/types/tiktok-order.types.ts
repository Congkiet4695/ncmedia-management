/**
 * Kiểu RAW của `POST /order/202309/orders/search` (Get Order List).
 * Nguồn: partner.tiktokshop.com/docv2/page/650aa8094a0bb702c06df242
 *
 * Tên field giữ NGUYÊN snake_case của TikTok — đây là ranh giới Anti-Corruption Layer.
 * Mọi field khai báo optional: TikTok bổ sung/bỏ field theo thị trường và theo version,
 * parser phải khoan dung (tài liệu khuyến cáo "make response deserialization tolerant").
 */

/** Tham số body của Get Order List. */
export interface TiktokSearchOrdersBody {
  order_status?: string;
  create_time_ge?: number;
  create_time_lt?: number;
  update_time_ge?: number;
  update_time_lt?: number;
  shipping_type?: string;
  buyer_user_id?: string;
  is_buyer_request_cancel?: boolean;
  warehouse_ids?: string[];
}

/** Tham số query của Get Order List (ngoài app_key/sign/timestamp/shop_cipher). */
export interface TiktokSearchOrdersQuery {
  /** Bắt buộc. Hợp lệ [1..100], mặc định 20. */
  page_size: number;
  /** Opaque cursor lấy từ `next_page_token` của response trước. Không cần cho trang đầu. */
  page_token?: string;
  /** `create_time` | `update_time`. Mặc định `create_time`. */
  sort_field?: 'create_time' | 'update_time';
  /** `ASC` | `DESC`. Mặc định `DESC`. */
  sort_order?: 'ASC' | 'DESC';
}

export interface TiktokOrderPayment {
  currency?: string;
  total_amount?: string;
  sub_total?: string;
  shipping_fee?: string;
  original_total_product_price?: string;
  original_shipping_fee?: string;
  seller_discount?: string;
  platform_discount?: string;
  payment_platform_discount?: string;
  payment_discount_service_fee?: string;
  shipping_fee_seller_discount?: string;
  shipping_fee_platform_discount?: string;
  shipping_fee_cofunded_discount?: string;
  tax?: string;
  product_tax?: string;
  shipping_fee_tax?: string;
  retail_delivery_fee?: string;
  buyer_service_fee?: string;
  handling_fee?: string;
  shipping_insurance_fee?: string;
  item_insurance_fee?: string;
  item_insurance_tax?: string;
  small_order_fee?: string;
  distance_shipping_fee?: string;
  distance_fee?: string;
}

export interface TiktokDistrictInfo {
  address_level_name?: string;
  address_name?: string;
  address_level?: string;
  iso_code?: string;
}

/**
 * `recipient_address` — PII.
 * ⚠️ Thị trường US che các field định danh khi đơn ở `UNPAID`/`ON_HOLD`/`CANCELLED`,
 * quá 30 ngày sau `COMPLETED`, và (từ ~08/2026) với mọi trạng thái của đơn 4PL.
 */
export interface TiktokRecipientAddress {
  full_address?: string;
  phone_number?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  first_name_local_script?: string;
  last_name_local_script?: string;
  address_detail?: string;
  address_line1?: string;
  address_line2?: string;
  address_line3?: string;
  address_line4?: string;
  district_info?: TiktokDistrictInfo[];
  delivery_preferences?: { drop_off_location?: string };
  postal_code?: string;
  region_code?: string;
  post_town?: string;
}

export interface TiktokItemTax {
  tax_type?: string;
  tax_amount?: string;
  tax_rate?: string;
}

export interface TiktokOrderLineItem {
  id: string;
  sku_id?: string;
  product_id?: string;
  product_name?: string;
  sku_name?: string;
  seller_sku?: string;
  sku_image?: string;
  display_status?: string;
  package_status?: string;
  package_id?: string;
  tracking_number?: string;
  shipping_provider_id?: string;
  shipping_provider_name?: string;
  warehouse_id?: string;
  sale_price?: string;
  original_price?: string;
  platform_discount?: string;
  seller_discount?: string;
  currency?: string;
  cancel_reason?: string;
  cancel_user?: string;
  rts_time?: number;
  is_gift?: boolean;
  is_dangerous_good?: boolean;
  needs_prescription?: boolean;
  /** POD — có sẵn ngay ở Get Order List. */
  is_pod_customized?: boolean;
  pod_info_id?: string;
  /** @deprecated TikTok thay bằng `order_type` ở mức Order. */
  sku_type?: string;
  product_listing_type?: string;
  room_id?: string;
  retail_delivery_fee?: string;
  buyer_service_fee?: string;
  small_order_fee?: string;
  pfand_fee?: string;
  gift_retail_price?: string;
  is_unboxing_item?: boolean;
  unboxing_sku_code?: string;
  unboxing_case_list?: unknown[];
  item_tax?: TiktokItemTax[];
  sub_item_info?: unknown[];
  combined_listing_skus?: unknown[];
}

export interface TiktokOrderPackage {
  id: string;
}

/** `handling_duration` — chỉ có với MADE_TO_ORDER / BACK_ORDER (thị trường US). */
export interface TiktokHandlingDuration {
  days?: string;
  type?: string;
}

/** Một phần tử của `data.orders[]`. */
export interface TiktokOrder {
  id: string;
  status: string;
  create_time: number;
  update_time: number;

  user_id?: string;
  buyer_email?: string;
  buyer_nickname?: string;
  /**
   * URL avatar người mua — CDN có chữ ký, **sinh lại ở mỗi lần gọi API**.
   * Không lưu vào DB và bị loại khỏi payload hash (xem `PodOrderMapper`).
   */
  buyer_avatar?: string;
  buyer_message?: string;
  seller_note?: string;

  cancellation_initiator?: string;
  cancel_reason?: string;
  is_buyer_request_cancel?: boolean;

  fulfillment_type?: string;
  delivery_type?: string;
  shipping_type?: string;
  shipping_provider?: string;
  shipping_provider_id?: string;
  tracking_number?: string;
  split_or_combine_tag?: string;
  has_updated_recipient_address?: boolean;
  warehouse_id?: string;
  delivery_option_id?: string;
  delivery_option_name?: string;
  payment_method_name?: string;
  need_upload_invoice?: string;
  is_cod?: boolean;

  order_type?: string;
  release_date?: number;
  handling_duration?: TiktokHandlingDuration;
  is_on_hold_order?: boolean;
  is_sample_order?: boolean;
  is_replacement_order?: boolean;
  replaced_order_id?: string;
  is_exchange_order?: boolean;
  exchange_source_order_id?: string;
  is_subscription_order?: boolean;
  commerce_platform?: string;
  auto_combine_group_id?: string;
  fast_delivery_program?: string;

  paid_time?: number;
  rts_time?: number;
  cancel_time?: number;
  delivery_time?: number;
  collection_time?: number;
  request_cancel_time?: number;
  rts_sla_time?: number;
  tts_sla_time?: number;
  delivery_sla_time?: number;
  cancel_order_sla_time?: number;
  shipping_due_time?: number;
  collection_due_time?: number;
  delivery_due_time?: number;

  payment?: TiktokOrderPayment;
  recipient_address?: TiktokRecipientAddress;
  line_items?: TiktokOrderLineItem[];
  packages?: TiktokOrderPackage[];
}

/** `data` của Get Order List. */
export interface TiktokSearchOrdersData {
  /** Opaque token cho trang kế tiếp. Rỗng/không có ⇒ đã hết trang. */
  next_page_token?: string;
  /** Tổng số đơn khớp điều kiện tìm kiếm (chỉ để giám sát, KHÔNG dùng tính số trang). */
  total_count?: number;
  orders?: TiktokOrder[];
}
