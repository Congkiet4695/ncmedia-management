import { PodFlashSaleItemStatus } from '@prisma/client';
import { computeItemStats, EMPTY_FLASH_SALE_STATS } from './pod-flash-sale.mapper';

/**
 * Thống kê kết quả chạy — cột "Thành công / Thất bại" ở danh sách Flash Sale.
 *
 * 🔴 Tính từ trạng thái HIỆN TẠI của từng dòng, không cộng dồn qua các lượt chạy ⇒ thử lại
 * một dòng hỏng chỉ chuyển nó từ "thất bại" sang "thành công", không bao giờ đếm đôi.
 */
describe('computeItemStats', () => {
  const row = (productId: string, status: PodFlashSaleItemStatus) => ({ productId, status });

  it('đợt rỗng ⇒ toàn 0', () => {
    expect(computeItemStats([])).toEqual(EMPTY_FLASH_SALE_STATS);
  });

  it('đếm theo DÒNG và theo SẢN PHẨM (sản phẩm có cả dòng thành công lẫn thất bại được tính ở cả hai)', () => {
    const stats = computeItemStats([
      row('p1', PodFlashSaleItemStatus.PUBLISHED),
      row('p1', PodFlashSaleItemStatus.FAILED),
      row('p2', PodFlashSaleItemStatus.PUBLISHED),
      row('p3', PodFlashSaleItemStatus.READY),
      row('p3', PodFlashSaleItemStatus.PENDING),
      row('p4', PodFlashSaleItemStatus.REMOVED),
    ]);
    expect(stats).toEqual({
      totalItems: 6,
      publishedItems: 2,
      failedItems: 1,
      pendingItems: 2,
      removedItems: 1,
      totalProducts: 4,
      publishedProducts: 2,
      failedProducts: 1,
    });
  });

  it('🔴 thử lại thành công 3/5 dòng hỏng ⇒ 28/2, tổng vẫn 30 (không đếm đôi)', () => {
    const before = Array.from({ length: 30 }, (_, i) =>
      row(`p${i}`, i < 25 ? PodFlashSaleItemStatus.PUBLISHED : PodFlashSaleItemStatus.FAILED),
    );
    const after = before.map((item, i) =>
      i >= 25 && i < 28 ? { ...item, status: PodFlashSaleItemStatus.PUBLISHED } : item,
    );
    expect(computeItemStats(before)).toMatchObject({ totalItems: 30, publishedItems: 25, failedItems: 5 });
    expect(computeItemStats(after)).toMatchObject({ totalItems: 30, publishedItems: 28, failedItems: 2 });
  });
});
