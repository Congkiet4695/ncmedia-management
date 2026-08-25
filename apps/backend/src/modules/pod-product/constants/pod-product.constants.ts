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

// ---------------------------------------------------------------------------
// "No brand"
// ---------------------------------------------------------------------------

/**
 * `brand_id` của **No brand** trên TikTok Shop.
 *
 * 🔴 Đây là brand toàn cầu, dùng chung cho mọi seller và mọi vùng — không phải dữ liệu riêng
 * của shop nào. Nó nằm ở đây (một hằng số duy nhất, có chú thích) vì lúc `Get Brands` không
 * liệt kê "No brand" thì hệ thống vẫn phải gửi được một `brand_id` HỢP LỆ khi tạo sản phẩm.
 *
 * Không convert thành `null`, không bỏ field: TikTok từ chối sản phẩm thiếu brand ở phần lớn
 * danh mục, và "để trống" không đồng nghĩa với "No brand".
 */
export const POD_TIKTOK_NO_BRAND_ID = '7082427311584347905';

/** Tên hiển thị của bản ghi No brand do hệ thống tạo. */
export const POD_TIKTOK_NO_BRAND_NAME = 'No brand';

/**
 * Nhận diện "No brand" từ tên TikTok trả về.
 *
 * TikTok viết hoa/thường không nhất quán giữa các vùng ("No Brand", "no brand", "NoBrand"),
 * nên so khớp sau khi bỏ khoảng trắng và hạ chữ thường.
 */
export function isNoBrandName(name: string | null | undefined): boolean {
  return (name ?? '').replace(/\s+/g, '').toLowerCase() === 'nobrand';
}
