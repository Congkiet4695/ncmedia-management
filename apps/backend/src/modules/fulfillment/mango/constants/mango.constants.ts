/**
 * Hằng số tích hợp MangoTeePrints — MangoV3 Public API.
 *
 * ⚠️ MỌI path / enum / mã lỗi ở đây được sao chép NGUYÊN VĂN từ tài liệu chính thức
 * https://docs.mangoteeprints.com. KHÔNG tự suy đoán endpoint, KHÔNG tự chế giá trị enum.
 * Khi Mango phát hành version mới ⇒ chỉ sửa TẠI ĐÂY (một nguồn duy nhất).
 *
 * Nguồn tham chiếu (doc id trong URL):
 *  - Overview                 overview-1401125m0
 *  - Create Order             create-order-20519158e0
 *  - Get Order Detail         get-order-detail-20519160e0
 *  - List Orders              list-orders-20519159e0
 *  - Cancel Order             cancel-order-20519163e0
 *  - Get Products             get-products-20519155e0
 *  - Get Product Variations   get-product-variations-20519157e0
 *  - List Production Lines    list-production-lines-20519164e0
 *  - Webhooks (CRUD + events) webhooks-4669294f0, create-webhook-20519166e0
 *  - Enum OrderStatus / ShippingMethod / SpeedType / WebhookEvent
 */

/** Base URL môi trường Production (Overview). */
export const MANGO_DEFAULT_BASE_URL = 'https://v3.mangoteeprints.com/api/public/v1';

/** Header xác thực. Mango KHÔNG dùng Bearer token. */
export const MANGO_API_KEY_HEADER = 'X-API-Key';

/**
 * Giới hạn `limit` (số bản ghi mỗi trang) theo tài liệu.
 *
 * Get Products      — `limit` tối đa **100** (tài liệu ghi rõ max 100).
 * Get Product Variations — bảng THAM SỐ ghi max 200, nhưng schema của chính đối tượng
 *   `pagination` trong response lại ghi `limit: 1..100`. Tài liệu tự mâu thuẫn ⇒ dùng 100,
 *   giá trị hợp lệ theo CẢ HAI cách đọc. Vì hệ thống luôn duyệt hết mọi trang nên chọn 100
 *   chỉ tốn thêm một request cho sản phẩm có trên 100 biến thể — đổi lại không có rủi ro 422.
 *   Xác nhận được 200 là an toàn thì chỉ cần sửa đúng hằng số này.
 */
export const MANGO_MAX_PAGE_LIMIT = {
  products: 100,
  variations: 100,
} as const;

/**
 * Chặn trên số trang duyệt trong một lần lấy danh mục.
 *
 * Đây là lưới an toàn chống vòng lặp vô hạn khi nhà cung cấp trả `pages` sai, KHÔNG phải
 * giới hạn nghiệp vụ: 500 trang × 100 bản ghi = 50.000 sản phẩm, vượt xa danh mục thực tế.
 * Chạm ngưỡng này sẽ được ghi log CẢNH BÁO kèm số đã tải và tổng số nhà cung cấp báo.
 */
export const MANGO_MAX_PAGES_PER_FETCH = 500;

/** Giới hạn tần suất chính thức: 10 request/giây. */
export const MANGO_RATE_LIMIT_PER_SECOND = 10;

/** Header giới hạn tần suất Mango trả về. */
export const MANGO_RATE_LIMIT_HEADERS = {
  limit: 'x-ratelimit-limit',
  remaining: 'x-ratelimit-remaining',
  reset: 'x-ratelimit-reset',
} as const;

// ---------------------------------------------------------------------------
// Endpoint — đường dẫn TƯƠNG ĐỐI so với base URL (base đã chứa /api/public/v1)
// ---------------------------------------------------------------------------

export const MANGO_ENDPOINTS = {
  /** POST — tạo đơn. */
  createOrder: '/orders',
  /** GET — danh sách đơn. */
  listOrders: '/orders',
  /** GET — chi tiết đơn theo `order_id` NCMedia đã gửi. */
  orderDetail: (orderId: string) => `/orders/${encodeURIComponent(orderId)}`,
  /** POST — huỷ đơn. Chỉ áp dụng khi trạng thái là NEW_ORDER hoặc ON_HOLD. */
  cancelOrder: (orderId: string) => `/orders/${encodeURIComponent(orderId)}/cancel`,
  /** GET — danh mục sản phẩm. */
  products: '/products',
  /** GET — biến thể của một sản phẩm (nguồn `sku` để ánh xạ). */
  productVariations: (productId: string) =>
    `/products/${encodeURIComponent(productId)}/variations`,
  /** GET — danh sách production line kèm shipping method được hỗ trợ. */
  productionLines: '/production-lines',
  /** POST / GET — đăng ký & liệt kê webhook. */
  webhooks: '/webhooks',
} as const;

// ---------------------------------------------------------------------------
// Enum — sao chép nguyên văn từ components/schemas của tài liệu
// ---------------------------------------------------------------------------

/**
 * `OrderStatus` — trạng thái đơn phía Mango.
 * 🔴 Đây là DANH SÁCH ĐẦY ĐỦ theo tài liệu; giá trị lạ sẽ map về `UNKNOWN` (xem mapper).
 */
export const MANGO_ORDER_STATUSES = [
  'new_order',
  'in_production',
  'shipped',
  'rejected',
  'on_hold',
  'cancelled',
  'in_production_cancelled',
  'full_refunded',
  'partial_refunded',
] as const;
export type MangoOrderStatus = (typeof MANGO_ORDER_STATUSES)[number];

/** `ShippingMethod` — kèm production line được hỗ trợ (theo mô tả trong tài liệu). */
export const MANGO_SHIPPING_METHODS = [
  'standard',
  'priority',
  'express',
  'global',
  'by_tiktok',
  'by_seller',
  'dhl_parcel_ground',
  'dhl_parcel_expedited',
] as const;
export type MangoShippingMethod = (typeof MANGO_SHIPPING_METHODS)[number];

/** `SpeedType` — chỉ áp dụng cho production line FASTUS. */
export const MANGO_SPEED_TYPES = ['rush', 'expedite'] as const;
export type MangoSpeedType = (typeof MANGO_SPEED_TYPES)[number];

/**
 * `print_files[].key` — vị trí in được Mango chấp nhận.
 * Một số vị trí chỉ dùng được với production line nhất định (ghi trong tài liệu):
 * `right_wrist`/`left_wrist` chỉ USEMB; nhóm `*_chest`, `*_cuff`, `collar`, `*_slit`,
 * `sock_collar`, `*_hat` chỉ VNEMB.
 */
export const MANGO_PRINT_POSITIONS = [
  'front',
  'back',
  'right_sleeve',
  'left_sleeve',
  'neck_label',
  'right_wrist',
  'left_wrist',
  'center_chest',
  'right_chest',
  'left_chest',
  'right_cuff',
  'left_cuff',
  'collar',
  'left_slit',
  'right_slit',
  'sock_collar',
  'center_hat',
  'left_hat',
  'right_hat',
  'back_hat',
] as const;
export type MangoPrintPosition = (typeof MANGO_PRINT_POSITIONS)[number];

/** `WebhookEvent` — sự kiện Mango gửi về. */
export const MANGO_WEBHOOK_EVENTS = ['order.status', 'order.shipment'] as const;
export type MangoWebhookEvent = (typeof MANGO_WEBHOOK_EVENTS)[number];

/** `preferred_carrier` — chọn hãng vận chuyển cho đơn TIKTOK/US1 đi Mỹ. */
export const MANGO_PREFERRED_CARRIERS = ['auto', 'usps'] as const;

/** Mã lỗi chuẩn trong envelope của Mango (Overview → Common Error Codes). */
export const MANGO_ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** Mã thành công trong envelope. */
export const MANGO_SUCCESS_CODE = 'SUCCESS';

/**
 * Giới hạn độ dài `order_id` do Mango quy định (maxLength: 40).
 * Vượt quá sẽ bị VALIDATION_ERROR ⇒ mã NCMedia sinh ra phải luôn ngắn hơn.
 */
export const MANGO_ORDER_ID_MAX_LENGTH = 40;
