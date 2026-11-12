import { FulfillmentStatus, PodDesignPlacement } from '@prisma/client';

/**
 * Hằng số Pressify Seller API.
 *
 * Nguồn (ghi rõ cho từng nhóm): tài liệu chính thức https://pressify.us/docs/api/index.html (phiên bản
 * 2026-09-14) và lượt gọi THỬ chỉ-đọc ngày 2026-11-11 (docs/fulfillment/pressify.md §Nghiên cứu API).
 */

/** Tài liệu: "Base URL https://pressify.us/api". */
export const PRESSIFY_DEFAULT_BASE_URL = 'https://pressify.us/api';

/** Endpoint dùng tới (tài liệu). Không dùng: /store (cần User API key), /order/create-ticket. */
export const PRESSIFY_ENDPOINTS = {
  /** Mọi sản phẩm đang bán + biến thể + giá theo bậc công khai. Không cần key, không phân trang. */
  allProducts: '/all-product',
  /** Phụ kiện theo bậc của store — endpoint chỉ-đọc NHẸ NHẤT có kiểm Store API key ⇒ Test connection. */
  accessories: '/product/accessory',
  createOrder: '/order',
  orderDetail: (id: string | number) => `/order/${encodeURIComponent(String(id))}`,
  listOrders: '/orders',
  /** 🔴 Là GET nhưng THAY ĐỔI dữ liệu (huỷ đơn) — chỉ gọi từ luồng Huỷ có người bấm. */
  cancelOrder: (id: string | number) => `/order/cancel/${encodeURIComponent(String(id))}`,
} as const;

/**
 * Giãn cách tối thiểu giữa hai lời gọi cùng nhóm (ms) — tài liệu "Errors and rate limits", tính theo IP:
 *   POST /order 500/10s · GET /order/{id} 10/s · GET /orders 30/60s · cancel 50/10s ·
 *   /products, /product/{id}, /all-product 50/3s · /product/accessory 200/10s.
 * Lấy dư một chút so với trần để không chạm ngưỡng chặn (5–60 giây).
 */
export const PRESSIFY_MIN_INTERVAL_MS = {
  createOrder: 25,
  orderDetail: 120,
  listOrders: 2_100,
  cancelOrder: 220,
  catalog: 70,
  accessories: 60,
} as const;

/** Thử lại CHỈ với GET chỉ-đọc, CHỈ lỗi tạm thời. POST tạo đơn & GET huỷ đơn KHÔNG bao giờ tự thử lại. */
export const PRESSIFY_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 65_000,
  jitterMs: 400,
} as const;

/** Tài liệu: "Money is USD." — mọi giá / phí / chi phí đơn của Pressify. */
export const PRESSIFY_CURRENCY = 'USD';

/**
 * `order_status` khi tạo đơn mà hệ thống CHO CHỌN (tài liệu "Order statuses").
 *
 * Không đưa ra: `oversize` / `overprio` (cần file in `oversize: true` — hệ thống chưa có khái niệm in
 * oversize), `test_order` (đơn thử của Pressify — không dùng trên luồng sản xuất thật).
 */
export const PRESSIFY_HANDLING_TYPES = ['new_order', 'priority', 'express'] as const;
export type PressifyHandlingType = (typeof PRESSIFY_HANDLING_TYPES)[number];
export const PRESSIFY_DEFAULT_HANDLING_TYPE: PressifyHandlingType = 'new_order';

/** Nhãn hiển thị (tài liệu: priority/express cộng phí, có trần đơn mở trên toàn Pressify). */
export const PRESSIFY_HANDLING_TYPE_LABELS: Readonly<Record<PressifyHandlingType, string>> = {
  new_order: 'Normal (new_order)',
  priority: 'Priority — produced first, priority fee (priority)',
  express: 'Express — express fee (express)',
};

/** `production` (tài liệu): bỏ trống ⇒ DTF. DTG chỉ hợp lệ khi đủ điều kiện — xem `PRESSIFY_DTG_STYLES`. */
export const PRESSIFY_PRINT_METHODS = ['DTF', 'DTG'] as const;
export type PressifyPrintMethod = (typeof PRESSIFY_PRINT_METHODS)[number];

/** Tài liệu: DTG chỉ nhận style T-shirt, Sweatshirt, Wash tee, Comfort Colors, Youth T-Shirt, Bella Canvas. */
export const PRESSIFY_DTG_STYLES = [
  't-shirt',
  'sweatshirt',
  'wash tee',
  'comfort colors',
  'youth t-shirt',
  'bella canvas',
] as const;
/** Tài liệu: DTG chỉ in Front/Back. */
export const PRESSIFY_DTG_KEYS = ['front', 'back'] as const;

/** `shipping_method` (tài liệu): standard = USPS Ground Advantage, priority = Priority Mail. */
export const PRESSIFY_SHIPPING_METHODS = ['standard', 'priority'] as const;
export type PressifyShippingMethod = (typeof PRESSIFY_SHIPPING_METHODS)[number];
export const PRESSIFY_SHIPPING_METHOD_LABELS: Readonly<Record<PressifyShippingMethod, string>> = {
  standard: 'Standard (USPS Ground Advantage)',
  priority: 'Priority (USPS Priority Mail)',
};

/** `line_items[].print_files[].key` (tài liệu "Print files and mockups"). */
export const PRESSIFY_PRINT_KEYS = [
  'front',
  'back',
  'sleeve_left',
  'sleeve_right',
  'special',
  'hood',
  'cross_shoulder_front',
  'cross_shoulder_back',
  'collar',
] as const;
export type PressifyPrintKey = (typeof PRESSIFY_PRINT_KEYS)[number];

/**
 * Vị trí in NCMedia → `print_files[].key` MẶC ĐỊNH. Bản ghi ánh xạ có `placementMap` ghi đè được (chỉ
 * nhận khoá trong `PRESSIFY_PRINT_KEYS`).
 *
 * `LABEL` (nhãn cổ) KHÔNG có tương ứng: tài liệu không có vị trí "neck label" (collar là in lên cổ áo,
 * không phải nhãn) ⇒ `null`, readiness báo không in được thay vì gửi sai chỗ.
 */
export const PRESSIFY_DEFAULT_PLACEMENT_MAP: Readonly<
  Record<PodDesignPlacement, PressifyPrintKey | null>
> = {
  FRONT: 'front',
  BACK: 'back',
  LEFT: 'sleeve_left',
  RIGHT: 'sleeve_right',
  SLEEVE: 'sleeve_left',
  LABEL: null,
};

/** Khoá chỉ được có TỐI ĐA MỘT file mỗi dòng hàng (tài liệu: hood, cross shoulder mỗi mặt, collar). */
export const PRESSIFY_SINGLE_FILE_KEYS: readonly PressifyPrintKey[] = [
  'front',
  'back',
  'sleeve_left',
  'sleeve_right',
  'hood',
  'cross_shoulder_front',
  'cross_shoulder_back',
  'collar',
];

/**
 * Bậc giá công khai — tài liệu (ví dụ `tiers` của GET /product/{id}) và API thật (2026-11-11):
 * `{"11":"Silver","12":"Gold","13":"Platinum","14":"Diamond"}`.
 *
 * 🔴 API KHÔNG cho biết store đang ở bậc nào. Bậc là cấu hình TUỲ CHỌN của tài khoản (người dùng xem ở
 * Dashboard Pressify): có bậc ⇒ giá biến thể theo tài khoản = giá của bậc đó; không có ⇒ để trống và giá
 * vốn của đơn lấy từ số Pressify thực trừ (GET /order/{id}).
 */
export const PRESSIFY_PUBLIC_TIERS: Readonly<Record<string, string>> = {
  '11': 'Silver',
  '12': 'Gold',
  '13': 'Platinum',
  '14': 'Diamond',
};

/**
 * `fulfill_status` (đọc đơn) + `status` của webhook (thêm `onhold`) → trạng thái chuẩn hoá NCMedia.
 * Tài liệu "Order statuses" / "Webhooks". Giá trị lạ ⇒ UNKNOWN (không đoán).
 */
export const PRESSIFY_STATUS_MAP: Readonly<Record<string, FulfillmentStatus>> = {
  /** Đã nhận, chờ trừ tiền ví — trạng thái DUY NHẤT huỷ được. */
  pending: FulfillmentStatus.SUBMITTED,
  /** Đã trừ tiền, chờ sản xuất. */
  new_order: FulfillmentStatus.SUBMITTED,
  priority: FulfillmentStatus.SUBMITTED,
  express: FulfillmentStatus.SUBMITTED,
  oversize: FulfillmentStatus.SUBMITTED,
  overprio: FulfillmentStatus.SUBMITTED,
  /** Đang in / ép / đóng gói / đã in nhãn, hoặc tạm dừng để kiểm tra. */
  processing: FulfillmentStatus.IN_PRODUCTION,
  /** Lỗi đã báo được sửa, đơn quay lại sản xuất. */
  fixed: FulfillmentStatus.IN_PRODUCTION,
  /** Trễ hạn sản xuất — vẫn đang sản xuất. */
  overdue: FulfillmentStatus.IN_PRODUCTION,
  /** File in không khớp template, chờ hỗ trợ liên hệ — cần người xử lý. */
  wrongsize: FulfillmentStatus.ON_HOLD,
  /** Chỉ có ở webhook (đọc đơn hiện thành processing). */
  onhold: FulfillmentStatus.ON_HOLD,
  /** Đã giao hãng vận chuyển, có tracking_id. */
  shipped: FulfillmentStatus.SHIPPED,
  cancelled: FulfillmentStatus.CANCELLED,
  /** Đơn thử — hệ thống không gửi đơn thử, nhưng nếu gặp thì giữ ở SUBMITTED (không sản xuất). */
  test_order: FulfillmentStatus.SUBMITTED,
};

/** Thông điệp người vận hành cần biết theo trạng thái (lưu `last_error_message`). */
export const PRESSIFY_STATUS_MESSAGES: Readonly<Record<string, string>> = {
  wrongsize:
    'Pressify: file in không khớp template (wrongsize) — bộ phận hỗ trợ Pressify sẽ liên hệ.',
  onhold: 'Pressify đang tạm giữ đơn (onhold).',
  overdue: 'Pressify báo đơn trễ hạn sản xuất (overdue).',
};

/** Mã `last_error_code` cho thông điệp trạng thái — phân biệt với lỗi gọi API. */
export const PRESSIFY_STATUS_MESSAGE_CODE = 'PRESSIFY_STATUS';

/** Tài liệu: huỷ được khi `pending`, chưa thanh toán và tạo chưa quá 60 phút. */
export const PRESSIFY_CANCELLABLE_PROVIDER_STATUS = 'pending';
export const PRESSIFY_CANCEL_WINDOW_MS = 60 * 60_000;

/** `ref_id` — tài liệu không nêu độ dài tối đa; giữ trong cột `external_order_id` (64). */
export const PRESSIFY_REF_ID_MAX_LENGTH = 64;

/**
 * Tra đơn theo `ref_id` (GET /orders KHÔNG có bộ lọc ref_id): quét theo khoảng ngày tạo quanh lần gửi.
 * Tài liệu: khoảng ngày tối đa 31 ngày; giới hạn 30 req/60s ⇒ trần số trang để không chạm ngưỡng.
 */
export const PRESSIFY_REF_LOOKUP = {
  perPage: 100,
  maxPages: 5,
  /** Lùi / tiến quanh mốc gửi (ngày) — bù lệch múi giờ phía Pressify. */
  daysBefore: 1,
  daysAfter: 1,
} as const;

/** Lưu ý hiển thị ở đầu khối cấu hình sản phẩm khi chọn Pressify. */
export const PRESSIFY_PROVIDER_NOTICE =
  'Pressify: biến thể gửi đi bằng variant_id (không dùng SKU — nhiều biến thể Pressify không có SKU). ' +
  'File in phải là PNG công khai, đúng kích thước template của sản phẩm. Đơn có nhãn vận chuyển (TikTok) ' +
  'được gửi kèm nhãn; không có nhãn thì Pressify tự mua nhãn USPS theo địa chỉ.';
