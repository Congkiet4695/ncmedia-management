/**
 * Hằng số tích hợp TikTok Shop Partner — Module POD.
 *
 * ⚠️ MỌI path/version ở đây được sao chép NGUYÊN VĂN từ tài liệu chính thức
 * TikTok Shop Partner Center (partner.tiktokshop.com/docv2). KHÔNG tự suy đoán endpoint.
 * Khi TikTok phát hành version mới → chỉ sửa TẠI ĐÂY (một nguồn duy nhất).
 *
 * Nguồn tham chiếu:
 *  - Authorization overview (doc 678e3a3292b0f40314a92d75)
 *  - Get Authorized Shops   (doc 6507ead7b99d5302be949ba9)
 *  - Common parameters      (doc 678e3a4278f4c20311b8b57e)
 *  - Sign your API request  (doc 678e3a3d4ddec3030b238faf)
 *  - API versioning         (doc 64f1991064ed2e0295f3cd32)
 */

/** Endpoint đổi authorization code lấy token (host: TIKTOK_AUTH_BASE_URL). */
export const TIKTOK_TOKEN_GET_PATH = '/api/v2/token/get';

/** Endpoint refresh access token (Sprint sau — khai báo sẵn để tái sử dụng). */
export const TIKTOK_TOKEN_REFRESH_PATH = '/api/v2/token/refresh';

/**
 * `grant_type` khi đổi authorization code.
 * ⚠️ TikTok dùng `authorized_code` — KHÔNG phải `authorization_code` chuẩn OAuth.
 * Tài liệu ghi rõ: "Do not 'fix' it to authorization_code, or the request will fail."
 */
export const TIKTOK_GRANT_TYPE_AUTHORIZED_CODE = 'authorized_code';

/** `grant_type` khi refresh token (Sprint sau). */
export const TIKTOK_GRANT_TYPE_REFRESH_TOKEN = 'refresh_token';

/** Get Authorized Shops — entity tag `Seller`, KHÔNG cần shop_cipher. */
export const TIKTOK_GET_AUTHORIZED_SHOPS_PATH = '/authorization/202309/shops';

/**
 * Get Order List — entity tag `Shop`, **BẮT BUỘC** `shop_cipher`.
 * Method POST, scope `Order Information`.
 */
export const TIKTOK_SEARCH_ORDERS_PATH = '/order/202309/orders/search';

/** Giới hạn `page_size` của Get Order List theo tài liệu. */
export const TIKTOK_ORDER_PAGE_SIZE_MIN = 1;
export const TIKTOK_ORDER_PAGE_SIZE_MAX = 100;

/**
 * Trạng thái đơn TikTok (Order API overview).
 * KHÔNG dùng làm enum DB — TikTok có bổ sung giá trị mới (vd `ON_HOLD`).
 */
export const TIKTOK_ORDER_STATUSES = [
  'UNPAID',
  'ON_HOLD',
  'AWAITING_SHIPMENT',
  'PARTIALLY_SHIPPING',
  'AWAITING_COLLECTION',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TiktokOrderStatus = (typeof TIKTOK_ORDER_STATUSES)[number];

// ---------------------------------------------------------------------------
// Finance API — báo cáo Payout (docs/pod-tiktok/10-payout-report.md)
//
// Nguồn: Finance API overview (doc 650b1f13c16ffe02b8012c2e).
// Toàn bộ entity tag `Shop` ⇒ BẮT BUỘC `shop_cipher`. Scope: `seller.finance.info`.
// ---------------------------------------------------------------------------

/**
 * Get Payments — bản ghi TikTok chi trả về tài khoản ngân hàng (doc 6a27b22ba6ff06049bbbd584).
 * ⚠️ Dùng 202605: bản 202309 nằm trong lộ trình khai tử V1 (doc 6a2f939b0a0aa9e23abe5a94).
 */
export const TIKTOK_GET_PAYMENTS_PATH = '/finance/202605/payments';

/** Get Statements — đối soát theo ngày (doc 650a676f0fcef602bf2b91f0). */
export const TIKTOK_GET_STATEMENTS_PATH = '/finance/202309/statements';

/**
 * Get Transactions by Statement — giao dịch cấp đơn trong một statement
 * (doc 6789c0c11882810314794094). Bản 202309 bị khai tử 31/12/2025 ⇒ dùng 202501.
 */
export function tiktokStatementTransactionsPath(statementId: string): string {
  return `/finance/202501/statements/${statementId}/statement_transactions`;
}

/** `page_size` hợp lệ của các Finance API theo tài liệu. */
export const TIKTOK_FINANCE_PAGE_SIZE_MAX = 100;

/**
 * Trạng thái chi trả TikTok trả về (Get Payments `status` / Get Statements `payment_status`).
 * 🔴 CHỈ có 3 giá trị — KHÔNG có `CANCELLED`. Giá trị lạ ⇒ log warn + bỏ qua bản ghi
 * thay vì đoán bừa (cùng nguyên tắc với order status — xem 07-risks R3.6).
 */
export const TIKTOK_PAYOUT_STATUSES = ['PROCESSING', 'PAID', 'FAILED'] as const;
export type TiktokPayoutStatus = (typeof TIKTOK_PAYOUT_STATUSES)[number];

/** `transactions[].type` của Get Transactions by Statement. */
export const TIKTOK_STATEMENT_TX_TYPES = ['ORDER', 'ADJUSTMENT', 'RESERVE'] as const;

/** Header mang access token cho API version 202309 trở lên. */
export const TIKTOK_ACCESS_TOKEN_HEADER = 'x-tts-access-token';

/** Tham số query bị LOẠI khi tính chữ ký (theo thuật toán chính thức). */
export const TIKTOK_SIGN_EXCLUDED_QUERY_KEYS = ['sign', 'access_token'] as const;

/**
 * `user_type` hợp lệ cho module POD (Authorization overview — user_type enumeration):
 *   0 = Seller · 4/5 = Global Selling seller.
 * (1 = Creator, 2/3 = Partner — KHÔNG dùng cho luồng Seller authorization.)
 */
export const TIKTOK_SELLER_USER_TYPES: readonly number[] = [0, 4, 5];

/** `seller_type` trả về từ Get Authorized Shops. */
export const TIKTOK_SELLER_TYPES = ['LOCAL', 'CROSS_BORDER'] as const;
export type TiktokSellerType = (typeof TIKTOK_SELLER_TYPES)[number];

/** Thị trường dùng để dựng authorization link. */
export const TIKTOK_REGIONS = ['US', 'ROW'] as const;
export type TiktokRegion = (typeof TIKTOK_REGIONS)[number];

/** Path màn hình uỷ quyền Seller (nối sau authorize base URL theo region). */
export const TIKTOK_AUTHORIZE_PATH = '/open/authorize';

/** Mã thành công của TikTok API (mọi endpoint). */
export const TIKTOK_SUCCESS_CODE = 0;

/** Trường sắp xếp cho danh sách kết nối (whitelist — chống SQL injection qua orderBy). */
export const POD_TIKTOK_SORT_FIELDS = [
  'createdAt',
  'accountName',
  'status',
  'accessTokenExpiresAt',
  'refreshTokenExpiresAt',
  'lastSyncedAt',
] as const;
export type PodTiktokSortField = (typeof POD_TIKTOK_SORT_FIELDS)[number];
