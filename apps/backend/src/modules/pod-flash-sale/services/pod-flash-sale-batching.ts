import {
  TIKTOK_ACTIVITY_MAX_PRODUCTS_PER_CALL,
  TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type { TiktokActivityProductInput } from '../../tiktok-sdk/types/tiktok-promotion.types';

/**
 * Chia lô cho Update Activity Products — **hàm thuần, không Nest, không Prisma**.
 *
 * 🔴 Đây là nơi DUY NHẤT trong hệ thống biết cách chia lô cho TikTok. Tách khỏi service vì
 * đúng hai lý do:
 *
 *  1. Nó là ranh giới giữa **trần lựa chọn của hệ thống** (10.000 SKU trong MỘT đợt sale) và
 *     **trần một lượt gọi của TikTok** (300 mục). Hai con số này từng bị nhập làm một —
 *     đó chính là lý do hệ thống dừng ở 300. Giữ phép chia ở một hàm có tên riêng, có test
 *     riêng, là cách để chúng không dính lại lần nữa.
 *  2. Kiểm được toàn bộ ranh giới (1 / 299 / 300 / 301 / 10.000) bằng hàm thuần, không cần
 *     dựng database lẫn mock HTTP.
 *
 * ```
 *   10.000 SKU  ──▶  chunk  ──▶  34 lô  ──▶  34 request
 *                                             TẤT CẢ vào CÙNG MỘT activity_id
 * ```
 */

/**
 * Số SKU mà một mục sản phẩm chiếm trong hạn ngạch của một request.
 *
 * 🔴 Mức PRODUCT gửi `skus: []` nhưng vẫn là MỘT mục TikTok phải xử lý — đếm là 0 thì một
 * request có thể ôm 300 sản phẩm mà hàm tưởng vẫn còn trống chỗ. Tối thiểu 1.
 */
export function countActivitySkus(product: TiktokActivityProductInput): number {
  return Math.max(product.skus.length, 1);
}

/**
 * Chia `entries` thành các lô thoả **ĐỒNG THỜI hai trần** của TikTok:
 * ≤ `maxPerCall` mục **và** ≤ `maxSkusPerCall` SKU cho mỗi lượt gọi.
 *
 * 🔴 Chỉ đếm mục là chưa đủ: 50 sản phẩm × 10 SKU đã là 500 SKU và bị TikTok từ chối dù mới
 * có 50 mục. Đó là lý do hàm nhận `skuCountOf` thay vì tự đếm phần tử.
 *
 * Generic vì nơi gọi cần chia **kế hoạch gửi** (payload + danh sách id dòng sinh ra nó), chứ
 * không chỉ chia payload: sau mỗi lô thành công, đúng những dòng của lô đó được đánh dấu đã
 * lên sàn. Không có phần mang theo id, tiến trình chết giữa chừng sẽ không biết dòng nào đã
 * gửi được và lần chạy lại phải gửi lại từ đầu.
 *
 * Một mục có nhiều SKU hơn `maxSkusPerCall` thì **không lô nào chứa nổi** — trường hợp đó
 * vượt giới hạn của chính TikTok. Hàm để nguyên nó thành một lô riêng thay vì cắt đôi danh
 * sách SKU của một sản phẩm: cắt đôi sẽ thành hai request mà TikTok hiểu là hai lần ghi đè,
 * và nhận một mã lỗi rõ ràng của sàn vẫn tốt hơn là dữ liệu sai âm thầm.
 */
export function chunkBySkuLimit<T>(
  entries: readonly T[],
  skuCountOf: (entry: T) => number,
  maxPerCall: number = TIKTOK_ACTIVITY_MAX_PRODUCTS_PER_CALL,
  maxSkusPerCall: number = TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let skuCount = 0;

  for (const entry of entries) {
    const skus = Math.max(skuCountOf(entry), 1);
    const wouldExceed = current.length + 1 > maxPerCall || skuCount + skus > maxSkusPerCall;

    if (wouldExceed && current.length > 0) {
      batches.push(current);
      current = [];
      skuCount = 0;
    }

    current.push(entry);
    skuCount += skus;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/** Chia lô cho payload thuần — lớp bọc mỏng của `chunkBySkuLimit`. */
export function chunkActivityProducts(
  products: readonly TiktokActivityProductInput[],
  maxProductsPerCall: number = TIKTOK_ACTIVITY_MAX_PRODUCTS_PER_CALL,
  maxSkusPerCall: number = TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL,
): TiktokActivityProductInput[][] {
  return chunkBySkuLimit(products, countActivitySkus, maxProductsPerCall, maxSkusPerCall);
}

/**
 * Độ trễ trước lần thử lại thứ `attempt` — exponential backoff có chặn trên.
 *
 * Cùng công thức với `computeRetryDelayMs` của Bulk Listing (`pod-listing.queue`). Không
 * import chéo module chỉ để lấy một phép nhân: hai module không có quan hệ phụ thuộc nào
 * khác, và tạo ra một quan hệ như thế để tiết kiệm ba dòng là cái giá sai.
 */
export function computeBatchRetryDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  if (attempt <= 0) return 0;
  return Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
}
