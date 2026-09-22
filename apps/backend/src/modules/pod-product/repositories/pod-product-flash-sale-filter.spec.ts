import { PodFlashSaleStatus } from '@prisma/client';
import { flashSaleOverlapWhere } from './pod-product.repository';

/**
 * Bộ lọc "sản phẩm đang chạy Flash Sale trong khoảng đã chọn" — điều kiện Prisma phải là luật
 * giao nửa mở `sale.startAt < to AND sale.endAt > from`, chỉ tính đợt đang lên sàn, và loại
 * đợt đang mở. Các trường hợp giao/không giao thật (CASE 1–7) được kiểm bằng cách áp cùng luật
 * lên dữ liệu mẫu ở `overlaps()` — đúng công thức mà điều kiện Prisma sinh ra.
 */

const FROM = new Date('2026-09-22T15:00:00Z');
const TO = new Date('2026-09-23T15:00:00Z');

/** Áp đúng luật của `flashSaleOverlapWhere` lên một đợt sale mẫu. */
function overlaps(sale: { startAt: string; endAt: string; status?: PodFlashSaleStatus }): boolean {
  const where = flashSaleOverlapWhere({ mode: 'RUNNING', from: FROM, to: TO });
  if (!where?.flashSale || Array.isArray(where.flashSale)) throw new Error('where rỗng');
  const cond = where.flashSale as {
    status: { in: PodFlashSaleStatus[] };
    startAt: { lt: Date };
    endAt: { gt: Date };
  };
  const start = new Date(sale.startAt);
  const end = new Date(sale.endAt);
  return cond.status.in.includes(sale.status ?? PodFlashSaleStatus.RUNNING) && start < cond.startAt.lt && end > cond.endAt.gt;
}

describe('flashSaleOverlapWhere', () => {
  it('ALL / không có bộ lọc ⇒ null (không thêm điều kiện)', () => {
    expect(flashSaleOverlapWhere(undefined)).toBeNull();
    expect(flashSaleOverlapWhere({ mode: 'ALL', from: FROM, to: TO })).toBeNull();
  });

  it('điều kiện: đợt ĐANG LÊN SÀN, startAt < to, endAt > from, loại đợt đang mở', () => {
    expect(flashSaleOverlapWhere({ mode: 'RUNNING', from: FROM, to: TO, excludeFlashSaleId: 'fs-self' })).toEqual({
      flashSale: {
        deletedAt: null,
        status: { in: [PodFlashSaleStatus.PUBLISHING, PodFlashSaleStatus.RUNNING] },
        startAt: { lt: TO },
        endAt: { gt: FROM },
        id: { not: 'fs-self' },
      },
    });
  });

  it('CASE 2: đợt nằm trọn trong khoảng chọn ⇒ đang chạy', () => {
    expect(overlaps({ startAt: '2026-09-22T18:00:00Z', endAt: '2026-09-23T10:00:00Z' })).toBe(true);
  });

  it('CASE 3: bắt đầu trước, kết thúc trong khoảng ⇒ đang chạy (ví dụ 20/09 10:00 → 22/09 20:00)', () => {
    expect(overlaps({ startAt: '2026-09-20T10:00:00Z', endAt: '2026-09-22T20:00:00Z' })).toBe(true);
  });

  it('CASE 4: bắt đầu trong khoảng, kết thúc sau ⇒ đang chạy', () => {
    expect(overlaps({ startAt: '2026-09-23T10:00:00Z', endAt: '2026-09-25T00:00:00Z' })).toBe(true);
  });

  it('CASE 5: bao phủ toàn bộ khoảng ⇒ đang chạy', () => {
    expect(overlaps({ startAt: '2026-09-20T00:00:00Z', endAt: '2026-09-30T00:00:00Z' })).toBe(true);
  });

  it('CASE 6: kết thúc trước khi khoảng bắt đầu ⇒ chưa chạy (kể cả kết thúc ĐÚNG mốc bắt đầu)', () => {
    expect(overlaps({ startAt: '2026-09-20T10:00:00Z', endAt: '2026-09-22T14:00:00Z' })).toBe(false);
    expect(overlaps({ startAt: '2026-09-20T10:00:00Z', endAt: '2026-09-22T15:00:00Z' })).toBe(false);
  });

  it('CASE 7: bắt đầu sau khi khoảng kết thúc ⇒ chưa chạy (kể cả bắt đầu ĐÚNG mốc kết thúc)', () => {
    expect(overlaps({ startAt: '2026-09-24T00:00:00Z', endAt: '2026-09-25T00:00:00Z' })).toBe(false);
    expect(overlaps({ startAt: '2026-09-23T15:00:00Z', endAt: '2026-09-25T00:00:00Z' })).toBe(false);
  });

  it('đợt DRAFT / ENDED / CANCELLED giao thời gian vẫn KHÔNG tính (chưa/không còn lên sàn)', () => {
    for (const status of [PodFlashSaleStatus.DRAFT, PodFlashSaleStatus.READY, PodFlashSaleStatus.ENDED, PodFlashSaleStatus.CANCELLED]) {
      expect(overlaps({ startAt: '2026-09-22T18:00:00Z', endAt: '2026-09-23T10:00:00Z', status })).toBe(false);
    }
  });
});
