/** Import Base Cost / Tracking Number bằng Excel — giới hạn an toàn (file nhỏ, đọc trong bộ nhớ). */

/** File chỉ có 2–3 cột ⇒ 2MB đã thừa cho vài chục nghìn dòng; chặn file lạ/nặng trước khi giải nén. */
export const BASE_COST_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
/** Số dòng dữ liệu tối đa mỗi lần import. */
export const BASE_COST_IMPORT_MAX_ROWS = 2000;
/** Thời gian tối đa của transaction ghi (một câu UPDATE gộp + nhật ký). */
export const BASE_COST_IMPORT_TX_TIMEOUT_MS = 60_000;

/**
 * Tên cột nhận diện — so sau khi chuẩn hoá (bỏ hoa thường, khoảng trắng, `_`, `-`, dấu `*`).
 * `OrderID` = TikTok Order ID (cột "Order ID" trên màn hình Orders), KHÔNG phải id nội bộ.
 */
export const BASE_COST_IMPORT_HEADERS = {
  orderId: ['orderid', 'tiktokorderid'],
  baseCost: ['basecost'],
  trackingNumber: ['trackingnumber', 'tracking', 'trackingno'],
} as const;

/** Độ dài tối đa mã vận đơn — khớp `fulfillment_orders.tracking_number` VarChar(128). */
export const IMPORT_TRACKING_NUMBER_MAX = 128;

/**
 * Tiền tố mã đơn của bản ghi nhập tay (Import Excel, đơn chưa từng fulfill). Khác mọi mã gửi nhà cung cấp
 * (`NC-…` của Mango, mã đơn TikTok của Sellerwix) ⇒ webhook / đối soát của nhà cung cấp không bao giờ khớp nhầm.
 */
export const IMPORT_EXTERNAL_ORDER_PREFIX = 'IMPORT-';
/** Khớp `fulfillment_orders.external_order_id` VarChar(40). */
export const IMPORT_EXTERNAL_ORDER_MAX = 40;
