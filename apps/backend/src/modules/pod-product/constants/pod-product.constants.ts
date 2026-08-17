/**
 * Hằng số của module POD — Product Synchronization.
 *
 * ⚠️ KHÔNG có endpoint TikTok nào ở đây: mọi lời gọi đi qua `TiktokProductApiService`
 * (module `tiktok-sdk`), version API khai báo tập trung ở `tiktok-sdk.constants.ts`.
 */

/** Trường được phép sắp xếp ở danh sách sản phẩm (whitelist — chống injection qua orderBy). */
export const POD_PRODUCT_SORT_FIELDS = [
  'createdAt',
  'title',
  'status',
  'skuCount',
  'minPrice',
  'totalInventory',
  'tiktokUpdatedAt',
  'lastSyncedAt',
] as const;
export type PodProductSortField = (typeof POD_PRODUCT_SORT_FIELDS)[number];

/**
 * Cửa sổ quét lùi thêm (giây) cho lượt INCREMENTAL.
 *
 * 🔴 Cùng lý do với sync đơn hàng: TikTok cảnh báo `update_time` có thể vượt khoảng tìm
 * kiếm khi dữ liệu đang được làm mới. Quét lùi thêm để không bỏ sót sản phẩm sửa ngay
 * sát mốc watermark — trùng lặp thì `payload_hash` chặn ghi thừa, còn bỏ sót thì mất hẳn.
 */
export const POD_PRODUCT_SYNC_OVERLAP_SECONDS = 300;

/**
 * Số sản phẩm lấy chi tiết ĐỒNG THỜI.
 *
 * Get Product là một call/sản phẩm — chạy tuần tự thì shop 1.000 sản phẩm mất rất lâu,
 * còn bung hết một lúc thì chạm rate limit (TikTok cấp QPS động theo App × Shop).
 * Giữ mức thấp và có thể chỉnh qua ENV.
 */
export const POD_PRODUCT_DETAIL_CONCURRENCY = 3;

/** Khoá phân tán theo shop — chặn hai lượt đồng bộ sản phẩm chạy chồng lên nhau. */
export const POD_PRODUCT_SYNC_LOCK_PREFIX = 'pod:product:sync:lock:';
export const POD_PRODUCT_SYNC_LOCK_TTL_MS = 10 * 60 * 1000;

/** Số lượt lỗi liên tiếp thì tạm ngưng đồng bộ shop (circuit breaker). */
export const POD_PRODUCT_SYNC_FAILURE_THRESHOLD = 5;
