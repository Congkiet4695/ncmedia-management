import {
  TIKTOK_ACTIVITY_MAX_PRODUCTS_PER_CALL,
  TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type { TiktokActivityProductInput } from '../../tiktok-sdk/types/tiktok-promotion.types';
import { FLASH_SALE_MAX_ITEMS } from '../constants/pod-flash-sale.constants';
import {
  chunkActivityProducts,
  chunkBySkuLimit,
  computeBatchRetryDelayMs,
  countActivitySkus,
} from './pod-flash-sale-batching';

/**
 * **Chia lô** — ranh giới giữa hai con số từng bị nhập làm một:
 *
 * ```
 *   trần LỰA CHỌN của hệ thống   = 10.000 SKU trong MỘT đợt sale
 *   trần MỘT LƯỢT GỌI của TikTok =    300 mục cho mỗi request
 * ```
 *
 * Toàn bộ bài kiểm ở đây chốt đúng hai điều: **không request nào vượt 300**, và
 * **10.000 SKU vẫn chỉ là MỘT đợt sale** — chỉ khác là 34 lượt gọi.
 */

/** Một sản phẩm mang đúng `skuCount` SKU. */
function product(id: string, skuCount: number): TiktokActivityProductInput {
  return {
    id,
    quantityLimit: -1,
    quantityPerUser: -1,
    skus: Array.from({ length: skuCount }, (_, index) => ({
      id: `${id}-sku-${index}`,
      activityPriceAmount: '9.99',
      quantityLimit: -1,
      quantityPerUser: -1,
    })),
  };
}

/** `n` SKU trải trên `n` sản phẩm một-SKU — hình dạng phổ biến nhất của POD. */
function singleSkuProducts(count: number): TiktokActivityProductInput[] {
  return Array.from({ length: count }, (_, index) => product(`p-${index}`, 1));
}

const totalSkus = (batch: TiktokActivityProductInput[]): number =>
  batch.reduce((sum, item) => sum + countActivitySkus(item), 0);

describe('chunkActivityProducts — số lô theo số SKU', () => {
  // 🔴 Bảng này là yêu cầu nghiệp vụ viết thành số. `300 SKU ⇒ 1 request` và
  // `301 SKU ⇒ 2 request` là hai dòng quan trọng nhất: đó chính là chỗ hệ thống cũ dừng lại.
  it.each([
    [1, 1],
    [299, 1],
    [300, 1],
    [301, 2],
    [600, 2],
    [601, 3],
    [999, 4],
    [1_000, 4],
    [10_000, 34],
  ])('%i SKU ⇒ %i lượt gọi TikTok', (skuCount, expectedBatches) => {
    const batches = chunkActivityProducts(singleSkuProducts(skuCount));
    expect(batches).toHaveLength(expectedBatches);
  });

  it('🔴 KHÔNG lô nào vượt 300 SKU, dù ở kích cỡ nào', () => {
    for (const size of [1, 299, 300, 301, 600, 601, 999, 1_000, 4_321, 10_000]) {
      for (const batch of chunkActivityProducts(singleSkuProducts(size))) {
        expect(totalSkus(batch)).toBeLessThanOrEqual(TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL);
        expect(batch.length).toBeLessThanOrEqual(TIKTOK_ACTIVITY_MAX_PRODUCTS_PER_CALL);
      }
    }
  });

  it('🔴 không mất và không nhân bản dòng nào khi chia', () => {
    const products = singleSkuProducts(10_000);
    const flat = chunkActivityProducts(products).flat();

    expect(flat).toHaveLength(10_000);
    expect(new Set(flat.map((item) => item.id)).size).toBe(10_000);
    // Đúng thứ tự ban đầu — người vận hành thấy sản phẩm lên sàn theo thứ tự đã thêm.
    expect(flat.map((item) => item.id)).toEqual(products.map((item) => item.id));
  });

  it('trần LỰA CHỌN của hệ thống (10.000) chia hết thành 34 lượt gọi', () => {
    // Chốt bằng chính hằng số, không phải bằng số viết tay: đổi trần thì test này phải
    // thay đổi cùng, chứ không im lặng đúng nhờ trùng hợp.
    const batches = chunkActivityProducts(singleSkuProducts(FLASH_SALE_MAX_ITEMS));
    expect(batches).toHaveLength(Math.ceil(FLASH_SALE_MAX_ITEMS / TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL));
    expect(batches).toHaveLength(34);
  });
});

describe('chunkActivityProducts — chia theo CẢ hai trần', () => {
  it('🔴 50 sản phẩm × 10 SKU = 500 SKU ⇒ phải chia, dù mới có 50 mục', () => {
    // Chỉ đếm sản phẩm thì đây là "50 mục, còn xa trần 300" — và cả request bị TikTok từ chối.
    const batches = chunkActivityProducts(
      Array.from({ length: 50 }, (_, index) => product(`p-${index}`, 10)),
    );

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(totalSkus(batch)).toBeLessThanOrEqual(TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL);
    }
  });

  it('mức PRODUCT (`skus: []`) vẫn tính là MỘT mục ⇒ 301 sản phẩm chia thành 2 lô', () => {
    // `skus.length = 0` mà đếm là 0 thì một lô sẽ ôm vô hạn sản phẩm.
    const batches = chunkActivityProducts(
      Array.from({ length: 301 }, (_, index) => product(`p-${index}`, 0)),
    );

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(300);
    expect(batches[1]).toHaveLength(1);
  });

  it('một sản phẩm vượt trần của chính TikTok được để nguyên thành một lô', () => {
    // Cắt đôi danh sách SKU của MỘT sản phẩm sẽ thành hai request mà TikTok hiểu là hai lần
    // ghi đè. Để nguyên thì sàn trả về một mã lỗi rõ ràng.
    const batches = chunkActivityProducts([product('huge', 500)]);

    expect(batches).toHaveLength(1);
    expect(batches[0][0].skus).toHaveLength(500);
  });

  it('danh sách rỗng ⇒ không lô nào, không request nào', () => {
    expect(chunkActivityProducts([])).toEqual([]);
  });
});

describe('chunkBySkuLimit — bản generic mang theo id dòng', () => {
  it('🔴 giữ nguyên phần dữ liệu đi kèm để đánh dấu dòng sau mỗi lô', () => {
    // Đây là thứ làm cho lượt publish CHẠY LẠI ĐƯỢC: không có id dòng trong lô, tiến trình
    // chết ở lô 12 sẽ không biết 11 lô trước đã lên sàn.
    const entries = Array.from({ length: 700 }, (_, index) => ({
      input: product(`p-${index}`, 1),
      itemIds: [`item-${index}`],
    }));

    const batches = chunkBySkuLimit(entries, (entry) => countActivitySkus(entry.input));

    expect(batches).toHaveLength(3);
    expect(batches.flat().flatMap((entry) => entry.itemIds)).toHaveLength(700);
    expect(batches[0][0].itemIds).toEqual(['item-0']);
  });

  it('trần truyền vào được tôn trọng (dùng cho test và cho sàn khác sau này)', () => {
    const batches = chunkBySkuLimit(singleSkuProducts(10), countActivitySkus, 3, 3);
    expect(batches.map((batch) => batch.length)).toEqual([3, 3, 3, 1]);
  });
});

describe('computeBatchRetryDelayMs', () => {
  it('lùi theo cấp số nhân và bị chặn trên', () => {
    expect(computeBatchRetryDelayMs(0, 1_000, 15_000)).toBe(0);
    expect(computeBatchRetryDelayMs(1, 1_000, 15_000)).toBe(1_000);
    expect(computeBatchRetryDelayMs(2, 1_000, 15_000)).toBe(2_000);
    expect(computeBatchRetryDelayMs(3, 1_000, 15_000)).toBe(4_000);
    // Chặn trên: không bao giờ chờ lâu hơn trần, dù thử lại bao nhiêu lần.
    expect(computeBatchRetryDelayMs(10, 1_000, 15_000)).toBe(15_000);
  });
});
