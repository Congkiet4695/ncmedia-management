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
 * ⛔ **KHÔNG dùng làm brand_id nữa.** Đây là id đã gây ra lỗi, giữ lại để CHẶN nó.
 *
 * Hằng số này từng được chú thích là "`brand_id` của No brand toàn cầu trên TikTok Shop" và
 * được `ensureNoBrand()` dùng để tự tạo một bản ghi thương hiệu tên "No brand". Điều đó SAI:
 * id này chưa bao giờ được TikTok xác nhận là "No brand".
 *
 * 🔴 Bằng chứng: sau khi đồng bộ 15.145 thương hiệu từ TikTok, bản ghi mang id này vẫn còn
 * `is_system = true` — nghĩa là `Get Brands` CHƯA BAO GIỜ trả về nó. Khi payload gửi id này
 * lên, TikTok phân giải nó thành thương hiệu THẬT sở hữu id ấy phía họ, và sản phẩm lên sàn
 * mang tên một thương hiệu người dùng không hề chọn.
 *
 * Cách biểu diễn ĐÚNG của "No brand" là `PodBrandMode.NONE` — bỏ hẳn `brand_id` khỏi payload
 * (`brandId` là optional trong Create Product API của TikTok).
 *
 * Hằng số còn tồn tại vì `PodListingPublisherService` phải nhận diện và loại bỏ id này khỏi
 * những payload đã ĐÓNG BĂNG trước khi sửa lỗi — xem `LEGACY_NO_BRAND_IDS` ở đó.
 */
export const POD_TIKTOK_LEGACY_FAKE_NO_BRAND_ID = '7082427311584347905';

/** Tên hiển thị của lựa chọn "No brand" trên giao diện và trong ảnh chụp template. */
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
