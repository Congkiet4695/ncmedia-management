import { NotFoundException } from '@nestjs/common';
import { PodFlashSaleItemStatus, PodFlashSaleStatus, Prisma } from '@prisma/client';
import { FLASH_SALE_BATCH_UPDATE_CHUNK } from '../constants/pod-flash-sale.constants';
import { PodFlashSaleItemService } from './pod-flash-sale-item.service';

/**
 * Batch Update — `PodFlashSaleItemService.batchUpdate`.
 *
 * 🔴 Vì sao bộ test này tồn tại: chọn 3.107 SKU rồi "giảm 30%" từng trả về
 * `INTERNAL_ERROR`. Bản cũ chạy 3.107 câu `UPDATE` tuần tự trong MỘT transaction tương tác
 * không đặt `timeout` (Prisma mặc định 5 giây) và một SKU thiếu giá gốc là cả lô bị từ chối.
 * Các khẳng định dưới đây giữ cho hai điều đó không quay lại:
 *
 *   - Dòng cùng kết quả gộp thành MỘT `updateMany`; nhóm lớn chia theo
 *     `FLASH_SALE_BATCH_UPDATE_CHUNK`. Không có "mỗi dòng một câu UPDATE".
 *   - Transaction có `timeout` / `maxWait` tường minh.
 *   - Dòng không tính được giá bị BỎ QUA kèm lý do — không kéo cả lô xuống.
 */

const SCOPE = { kind: 'ALL' } as never;

interface FakeItem {
  id: string;
  originalPrice: Prisma.Decimal | null;
  flashSalePrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  totalPurchaseLimit: number;
  customerPurchaseLimit: number;
}

function item(index: number, originalPrice: number | null): FakeItem {
  return {
    id: `item-${index}`,
    originalPrice: originalPrice === null ? null : new Prisma.Decimal(originalPrice),
    flashSalePrice: new Prisma.Decimal(originalPrice ?? 0),
    discountPercent: new Prisma.Decimal(0),
    totalPurchaseLimit: -1,
    customerPurchaseLimit: -1,
  };
}

/** N dòng với giá gốc xoay vòng qua `prices` (mô phỏng vài chục mức giá của 3.107 SKU). */
function items(count: number, prices: Array<number | null> = [10, 19.99, 25]): FakeItem[] {
  return Array.from({ length: count }, (_, index) => item(index, prices[index % prices.length]));
}

function build(rows: FakeItem[]) {
  const updateManyCalls: Array<{ ids: string[]; data: Record<string, unknown> }> = [];
  let transactionOptions: unknown = null;
  let failUpdateMany: Error | null = null;

  const tx = {
    podFlashSaleItem: {
      updateMany: jest.fn(({ where, data }: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
        if (failUpdateMany) return Promise.reject(failUpdateMany);
        updateManyCalls.push({ ids: where.id.in, data });
        return Promise.resolve({ count: where.id.in.length });
      }),
    },
    podFlashSale: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>, options: unknown) => {
      transactionOptions = options;
      return fn(tx);
    }),
  };
  const flashSale = { id: 'fs-1', shopId: 'shop-1', status: PodFlashSaleStatus.DRAFT, items: rows };
  const flashSales = {
    get: jest.fn().mockResolvedValue(flashSale),
    assertEditable: jest.fn(),
  };
  const service = new PodFlashSaleItemService(prisma as never, flashSales as never);

  return {
    service,
    updateManyCalls,
    transactionOptions: () => transactionOptions as { timeout?: number; maxWait?: number } | null,
    setFailure: (error: Error) => {
      failUpdateMany = error;
    },
    prisma,
  };
}

const run = (service: PodFlashSaleItemService, dto: Record<string, unknown>) =>
  service.batchUpdate('org-1', 'user-1', 'fs-1', dto as never, SCOPE);

describe('PodFlashSaleItemService.batchUpdate', () => {
  it.each([1, 10, 100, 500, 1000, 3000, 3107])(
    '%i SKU · giảm 30% ⇒ cập nhật đủ, gộp theo mức giá, không có câu UPDATE lẻ từng dòng',
    async (count) => {
      const rows = items(count);
      const { service, updateManyCalls, transactionOptions } = build(rows);

      const { result } = await run(service, { itemIds: rows.map((row) => row.id), discountPercent: 30 });

      expect(result).toMatchObject({ requested: count, updated: count, skipped: 0, failures: [] });
      // Mọi dòng được ghi đúng một lần.
      const written = updateManyCalls.flatMap((call) => call.ids);
      expect(written).toHaveLength(count);
      expect(new Set(written).size).toBe(count);
      // Số câu UPDATE = số nhóm giá (3) × số lô mỗi nhóm — KHÔNG phải số dòng.
      const distinctPrices = Math.min(count, 3);
      const expectedStatements = Array.from({ length: distinctPrices }, (_, index) => {
        const inGroup = Math.floor(count / 3) + (index < count % 3 ? 1 : 0);
        return Math.ceil(inGroup / FLASH_SALE_BATCH_UPDATE_CHUNK);
      }).reduce((sum, value) => sum + value, 0);
      expect(updateManyCalls).toHaveLength(expectedStatements);
      for (const call of updateManyCalls) expect(call.ids.length).toBeLessThanOrEqual(FLASH_SALE_BATCH_UPDATE_CHUNK);
      // Transaction có trần thời gian tường minh — không dựa vào 5 giây mặc định của Prisma.
      expect(transactionOptions()?.timeout).toBeGreaterThan(5_000);
      expect(transactionOptions()?.maxWait).toBeGreaterThan(0);
    },
  );

  it.each([1, 30, 99])('giảm %i%% ⇒ giá deal = giá gốc × (1 − %i/100), làm tròn 2 chữ số', async (percent) => {
    const rows = [item(0, 19.99)];
    const { service, updateManyCalls } = build(rows);

    await run(service, { itemIds: ['item-0'], discountPercent: percent });

    const expected = new Prisma.Decimal(19.99).mul(100 - percent).div(100).toDecimalPlaces(2);
    expect(String(updateManyCalls[0].data.flashSalePrice)).toBe(expected.toString());
    expect(updateManyCalls[0].data.status).toBe(PodFlashSaleItemStatus.READY);
  });

  it('đặt giá deal cố định ⇒ cùng giá cho mọi dòng, % giảm tính lại theo giá gốc RIÊNG từng dòng', async () => {
    const rows = [item(0, 20), item(1, 40)];
    const { service, updateManyCalls } = build(rows);

    await run(service, { itemIds: ['item-0', 'item-1'], flashSalePrice: 10 });

    // Hai mức giá gốc ⇒ hai % giảm khác nhau ⇒ hai nhóm.
    expect(updateManyCalls).toHaveLength(2);
    const percents = updateManyCalls.map((call) => String(call.data.discountPercent)).sort();
    expect(percents).toEqual(['50', '75']);
    for (const call of updateManyCalls) expect(String(call.data.flashSalePrice)).toBe('10');
  });

  it('chỉ đổi Total Limit / Limit per buyer ⇒ giữ nguyên giá, một nhóm duy nhất', async () => {
    const rows = items(50);
    const { service, updateManyCalls } = build(rows);

    await run(service, { itemIds: rows.map((row) => row.id), totalPurchaseLimit: 20, customerPurchaseLimit: 2 });

    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].data).toMatchObject({ totalPurchaseLimit: 20, customerPurchaseLimit: 2 });
    expect(updateManyCalls[0].ids).toHaveLength(50);
  });

  it('kết hợp nhiều trường (giảm % + giới hạn) trong một lần', async () => {
    const rows = [item(0, 100)];
    const { service, updateManyCalls } = build(rows);

    await run(service, { itemIds: ['item-0'], discountPercent: 10, totalPurchaseLimit: 5, customerPurchaseLimit: 1 });

    expect(updateManyCalls[0].data).toMatchObject({
      totalPurchaseLimit: 5,
      customerPurchaseLimit: 1,
      status: PodFlashSaleItemStatus.READY,
    });
    expect(String(updateManyCalls[0].data.flashSalePrice)).toBe('90');
  });

  it('🔴 SKU thiếu giá gốc bị BỎ QUA kèm lý do — 27 dòng hỏng không kéo 3.080 dòng còn lại xuống', async () => {
    const rows = [...items(3080, [10, 20]), ...Array.from({ length: 27 }, (_, index) => item(9000 + index, null))];
    const { service, updateManyCalls } = build(rows);

    const { result } = await run(service, { itemIds: rows.map((row) => row.id), discountPercent: 30 });

    expect(result.requested).toBe(3107);
    expect(result.updated).toBe(3080);
    expect(result.skipped).toBe(27);
    expect(result.failures).toHaveLength(27);
    expect(result.failures[0]).toMatchObject({ itemId: 'item-9000', code: 'PRICE_NOT_RESOLVABLE' });
    expect(updateManyCalls.flatMap((call) => call.ids)).toHaveLength(3080);
  });

  it('id lặp trong request ⇒ chỉ xét một lần (request bị gửi lại không nhân đôi)', async () => {
    const rows = items(3);
    const { service, updateManyCalls } = build(rows);

    const { result } = await run(service, { itemIds: ['item-0', 'item-0', 'item-1'], discountPercent: 5 });

    expect(result.requested).toBe(2);
    expect(result.updated).toBe(2);
    expect(updateManyCalls.flatMap((call) => call.ids).sort()).toEqual(['item-0', 'item-1']);
  });

  it('id không thuộc đợt sale ⇒ báo `ITEM_NOT_FOUND` cho đúng id đó, dòng khác vẫn cập nhật', async () => {
    const rows = items(2);
    const { service } = build(rows);

    const { result } = await run(service, { itemIds: ['item-0', 'ghost'], discountPercent: 5 });

    expect(result).toMatchObject({ requested: 2, updated: 1, skipped: 1 });
    expect(result.failures).toEqual([expect.objectContaining({ itemId: 'ghost', code: 'ITEM_NOT_FOUND' })]);
  });

  it('không id nào thuộc đợt sale ⇒ 404 (request sai đích, không phải "0 dòng cập nhật")', async () => {
    const { service } = build(items(2));

    await expect(run(service, { itemIds: ['ghost-1', 'ghost-2'], discountPercent: 5 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('🔴 database hỏng giữa chừng ⇒ ném lỗi (rollback cả lô), có log ngữ cảnh, không nuốt thành INTERNAL_ERROR câm', async () => {
    const rows = items(10);
    const { service, setFailure } = build(rows);
    setFailure(new Error('P2028 Transaction already closed'));
    const errorLog = jest.spyOn((service as unknown as { logger: { error: (payload: unknown) => void } }).logger, 'error');

    await expect(run(service, { itemIds: rows.map((row) => row.id), discountPercent: 30 })).rejects.toThrow('P2028');

    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'item.batchUpdate.fail',
        flashSaleId: 'fs-1',
        shopId: 'shop-1',
        selectedSkuCount: 10,
        error: 'P2028 Transaction already closed',
      }),
    );
  });

  it('không có gì để ghi (mọi dòng thiếu giá) ⇒ không mở transaction, trả kết quả 0 cập nhật', async () => {
    const rows = [item(0, null), item(1, 0)];
    const { service, prisma } = build(rows);

    const { result } = await run(service, { itemIds: ['item-0', 'item-1'], discountPercent: 30 });

    expect(result).toMatchObject({ updated: 0, skipped: 2 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
