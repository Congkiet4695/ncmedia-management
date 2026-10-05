import { FulfillmentStatus } from '@prisma/client';

/**
 * Hằng số tích hợp Sellerwix — Sellerwix Public API.
 *
 * ⚠️ MỌI path / tên field / giá trị enum ở đây được chép NGUYÊN VĂN từ collection Postman chính
 * thức "Sellerwix API" (https://documenter.getpostman.com/view/1626796/2s93JxshF5) và tài liệu
 * "Public API Document" (Google Doc). KHÔNG tự suy đoán endpoint, KHÔNG tự chế giá trị enum.
 * Những hành vi tài liệu KHÔNG định nghĩa được liệt kê ở docs/fulfillment/sellerwix.md §Gaps.
 */

/** Base URL (biến `baseUrl` của collection). Các endpoint bên dưới TƯƠNG ĐỐI so với nó. */
export const SELLERWIX_DEFAULT_BASE_URL = 'https://api.sellerwix.com/public-api';

/**
 * Khoá cấu hình đơn vị tiền của giá vốn Sellerwix (`SELLERWIX_COST_CURRENCY`, mặc định USD).
 *
 * 🔴 API Sellerwix không trả đơn vị tiền ở endpoint nào ⇒ đây là nguồn DUY NHẤT của đơn vị tiền
 * giá vốn Sellerwix: danh mục đồng bộ (`fulfillment_products.currency`) và bản ghi fulfillment
 * (`fulfillment_orders.currency`) đều đọc từ đây — không có giá trị mặc định nào khác trong code.
 */
export const SELLERWIX_COST_CURRENCY_CONFIG_KEY = 'fulfillment.sellerwix.costCurrency';

export const SELLERWIX_ENDPOINTS = {
  /** GET — danh sách danh mục. */
  categories: '/v1/category',
  /** GET — sản phẩm trong một danh mục. */
  categoryProducts: (categoryId: string | number) =>
    `/v1/category/${encodeURIComponent(String(categoryId))}/product`,
  /** GET — biến thể của một sản phẩm (phân trang `limit` + `next_page`). */
  productVariants: (productSku: string) => `/v1/product/${encodeURIComponent(productSku)}`,
  /** GET — phương thức vận chuyển khả dụng của MỘT biến thể. */
  variantShippingMethods: (variantSku: string) =>
    `/v1/variant/${encodeURIComponent(variantSku)}/shipping-method`,
  /** POST — "Fulfill order" (tạo đơn). */
  createOrder: '/v1/order',
  /**
   * GET — chi tiết đơn. Changelog 2026-04-07: kèm `store_id` trên query thì `:id` được hiểu là
   * `reference_id` — đây là đường tra "đơn đã tồn tại chưa" trước khi tạo.
   */
  orderDetail: (id: string) => `/v1/order/${encodeURIComponent(id)}`,
  /** POST — huỷ đơn. */
  cancelOrder: (id: string) => `/v1/order/${encodeURIComponent(id)}/cancel`,
} as const;

/**
 * Header xác thực — khai báo `auth` cấp collection của Postman "Sellerwix API":
 * `{"type":"apikey","apikey":[{"key":"key","value":"X-Api-Key"}, …]}`, được MỌI request `/v1/*`
 * kế thừa. Giá trị = API Key (Settings → Public API → Generate API Key).
 */
export const SELLERWIX_API_KEY_HEADER = 'X-Api-Key';

/**
 * Giới hạn tần suất theo tài liệu (khoảng tối thiểu giữa hai request, ms).
 *
 * - Toàn API: 100 request / 60 giây (changelog 2025-02-27)          ⇒ 600 ms
 * - Get order details: 15 request / phút                               ⇒ 4000 ms
 * - Add tracking: 15 request / phút (không dùng trong tích hợp này)
 * - Get list orders: 5 request / phút (không dùng trong tích hợp này)
 */
export const SELLERWIX_MIN_INTERVAL_MS = {
  global: 600,
  orderDetail: 4_000,
} as const;

/** Thử lại lời gọi ĐỌC khi lỗi tạm thời — cùng chính sách với Mango (chỉ GET). */
export const SELLERWIX_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
  jitterMs: 250,
} as const;

/** `limit` tối đa của Get product variants (tài liệu: 1-100, mặc định 100). */
export const SELLERWIX_VARIANT_PAGE_LIMIT = 100;

/** Lưới an toàn chống vòng lặp vô hạn khi `next_page` không bao giờ rỗng. */
export const SELLERWIX_MAX_PAGES_PER_PRODUCT = 200;

/** Thời gian nhớ phương thức vận chuyển của một biến thể (dữ liệu gần như tĩnh). */
export const SELLERWIX_SHIPPING_METHOD_CACHE_MS = 10 * 60_000;

/**
 * `fulfillments[].status` — danh sách ĐẦY ĐỦ theo mô tả field của Get order details:
 * "in supplier, supplier delay, shipped, error, canceled, cancel processing, refund processing,
 * waiting for processing, payment pending".
 */
export const SELLERWIX_FULFILLMENT_STATUSES = [
  'waiting for processing',
  'in supplier',
  'supplier delay',
  'shipped',
  'error',
  'payment pending',
  'cancel processing',
  'refund processing',
  'canceled',
] as const;
export type SellerwixFulfillmentStatus = (typeof SELLERWIX_FULFILLMENT_STATUSES)[number];

/**
 * Ánh xạ trạng thái Sellerwix → trạng thái chuẩn hoá của NCMedia.
 *
 * 🔴 Đây là QUYẾT ĐỊNH ÁNH XẠ của NCMedia (trạng thái phía Sellerwix chép nguyên văn); lý do từng
 * dòng ở docs/fulfillment/sellerwix.md §Status. Giá trị KHÔNG có trong bảng ⇒ `UNKNOWN`, trạng thái
 * gốc vẫn lưu nguyên văn ở `provider_status`.
 *
 * - `error` / `payment pending` / `cancel processing` / `refund processing` là trạng thái CÒN XỬ LÝ
 *   ĐƯỢC ở phía Sellerwix (sửa lỗi, nạp tiền, chờ huỷ/hoàn) ⇒ `ON_HOLD`, KHÔNG phải trạng thái kết
 *   thúc — bộ đồng bộ vẫn tiếp tục hỏi lại.
 * - Tài liệu KHÔNG có trạng thái "delivered" hay "refunded" hoàn tất ⇒ không bao giờ tự nâng lên
 *   `DELIVERED` / `REFUNDED`.
 */
export const SELLERWIX_STATUS_MAP: Readonly<Record<SellerwixFulfillmentStatus, FulfillmentStatus>> =
  {
    'waiting for processing': FulfillmentStatus.SUBMITTED,
    'in supplier': FulfillmentStatus.IN_PRODUCTION,
    'supplier delay': FulfillmentStatus.IN_PRODUCTION,
    shipped: FulfillmentStatus.SHIPPED,
    error: FulfillmentStatus.ON_HOLD,
    'payment pending': FulfillmentStatus.ON_HOLD,
    'cancel processing': FulfillmentStatus.ON_HOLD,
    'refund processing': FulfillmentStatus.ON_HOLD,
    canceled: FulfillmentStatus.CANCELLED,
  };

/**
 * Độ "tiến triển" của trạng thái chuẩn hoá — một đơn Sellerwix có thể có NHIỀU `fulfillments[]`
 * (tách theo xưởng). Trạng thái của cả đơn là trạng thái KÉM tiến triển nhất trong số các phần
 * chưa huỷ: đơn chỉ "đã ship" khi mọi phần đã ship.
 */
export const SELLERWIX_STATUS_PROGRESS: Readonly<Partial<Record<FulfillmentStatus, number>>> = {
  [FulfillmentStatus.ON_HOLD]: 0,
  [FulfillmentStatus.UNKNOWN]: 0,
  [FulfillmentStatus.SUBMITTED]: 1,
  [FulfillmentStatus.IN_PRODUCTION]: 2,
  [FulfillmentStatus.SHIPPED]: 3,
};

/**
 * `last_error_code` khi `fulfillments[].message` có nội dung (lỗi/từ chối phía Sellerwix). Được xoá
 * khi thông điệp biến mất — không để một lỗi đã được xử lý treo mãi trên màn hình.
 */
export const SELLERWIX_STATUS_MESSAGE_CODE = 'SELLERWIX_STATUS_MESSAGE';

/** Sự kiện webhook (Hook → Webhooks → "Order events"). */
export const SELLERWIX_WEBHOOK_EVENTS = ['order:updated', 'order:shipment'] as const;
export type SellerwixWebhookEvent = (typeof SELLERWIX_WEBHOOK_EVENTS)[number];

/**
 * Ánh xạ MẶC ĐỊNH vị trí in NCMedia → `print_areas[].display_name` của biến thể Sellerwix.
 *
 * 🔴 Chỉ hai giá trị này xuất hiện NGUYÊN VĂN trong tài liệu (ví dụ Get product variants:
 * `{ key: "CF", display_name: "Front" }`, `{ key: "FB", display_name: "Back" }`). `key` thật (CF/FB…)
 * luôn được tra từ `print_areas` ĐÃ ĐỒNG BỘ của chính biến thể — không viết cứng "CF"/"FB".
 * Vị trí khác (tay áo, nhãn cổ…) KHÔNG có tên hiển thị trong tài liệu ⇒ phải khai `placementMap`
 * ở Cấu hình sản phẩm; không khai thì readiness báo PLACEMENT_UNSUPPORTED thay vì đoán.
 */
export const SELLERWIX_DEFAULT_PLACEMENT_DISPLAY_NAMES = {
  FRONT: 'front',
  BACK: 'back',
} as const;

/** Lưu ý hiện ở đầu khối cấu hình sản phẩm khi nhà cung cấp là Sellerwix. */
export const SELLERWIX_PROVIDER_NOTICE =
  'Sellerwix nhận đơn theo SKU BIẾN THỂ (vd SW-MD-MPTG-BL-XL) và vị trí in theo `print_areas` của ' +
  'chính biến thể đó. Phương thức vận chuyển phụ thuộc từng biến thể — chỉ những phương thức mọi ' +
  'sản phẩm trong đơn cùng hỗ trợ mới hiện ra.';

/**
 * Độ dài tối đa của `reference_id` NCMedia sinh ra. Tài liệu Sellerwix không nêu giới hạn ⇒ dùng
 * giới hạn của cột lưu nó (`fulfillment_orders.external_order_id VARCHAR(40)`): mã đơn TikTok
 * (18–19 chữ số) + hậu tố lần thử `-R{n}` luôn nằm gọn.
 */
export const SELLERWIX_REFERENCE_ID_MAX_LENGTH = 40;
