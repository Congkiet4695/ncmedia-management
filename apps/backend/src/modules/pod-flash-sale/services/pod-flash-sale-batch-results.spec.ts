import {
  batchStatusOf,
  initialBatchResults,
  parseBatchResults,
  skipUnfinishedBatches,
  summarizeBatchResults,
} from './pod-flash-sale-batch-results';

describe('pod-flash-sale-batch-results', () => {
  const NOW = new Date('2026-10-07T00:00:00.000Z');

  it('lô mới ⇒ PENDING, đánh số từ 1', () => {
    const results = initialBatchResults([
      { products: 10, skus: 300 },
      { products: 4, skus: 12 },
    ]);
    expect(results.map((r) => [r.batch, r.status, r.skus])).toEqual([
      [1, 'PENDING', 300],
      [2, 'PENDING', 12],
    ]);
  });

  it('trạng thái lô theo số dòng nhận / hỏng', () => {
    expect(batchStatusOf(300, 0)).toBe('SUCCEEDED');
    expect(batchStatusOf(295, 5)).toBe('PARTIAL');
    expect(batchStatusOf(0, 300)).toBe('FAILED');
  });

  it('🔴 lượt dừng ⇒ mọi lô chưa có kết quả thành SKIPPED kèm lý do; lô đã xong giữ nguyên', () => {
    const results = initialBatchResults([
      { products: 1, skus: 300 },
      { products: 1, skus: 300 },
      { products: 1, skus: 300 },
    ]);
    results[0] = { ...results[0], status: 'SUCCEEDED', succeeded: 300 };
    results[1] = { ...results[1], status: 'PROCESSING' };
    const skipped = skipUnfinishedBatches(results, { code: '105002', message: 'Hết hạn uỷ quyền' }, NOW);
    expect(skipped.map((r) => r.status)).toEqual(['SUCCEEDED', 'SKIPPED', 'SKIPPED']);
    expect(skipped[2]).toMatchObject({ errorCode: '105002', errorMessage: 'Hết hạn uỷ quyền' });
  });

  it('🔴 tổng hợp 13 lô: 10 SUCCEEDED + 2 PARTIAL + 1 FAILED ⇒ đếm đúng, FAILED không bị tính là PENDING', () => {
    const results = initialBatchResults(Array.from({ length: 13 }, () => ({ products: 50, skus: 300 }))).map(
      (result, index) =>
        index < 10
          ? { ...result, status: 'SUCCEEDED' as const, succeeded: 300 }
          : index < 12
            ? { ...result, status: 'PARTIAL' as const, succeeded: 295, failed: 5 }
            : { ...result, status: 'FAILED' as const, failed: 300 },
    );
    const summary = summarizeBatchResults(results);
    expect(summary).toMatchObject({
      totalBatches: 13,
      processedBatches: 13,
      succeededBatches: 10,
      partialBatches: 2,
      failedBatches: 1,
      succeeded: 3590,
      failed: 310,
      pending: 0,
      firstProblemBatch: 11,
    });
  });

  it('lượt đang chạy ⇒ pending = dòng của lô chưa có kết quả', () => {
    const results = initialBatchResults([
      { products: 1, skus: 300 },
      { products: 1, skus: 120 },
    ]);
    results[0] = { ...results[0], status: 'SUCCEEDED', succeeded: 300 };
    expect(summarizeBatchResults(results)).toMatchObject({ succeeded: 300, pending: 120, processedBatches: 1 });
  });

  it('cột JSON cũ (null) / hình dạng lạ ⇒ mảng rỗng, không ném lỗi', () => {
    expect(parseBatchResults(null)).toEqual([]);
    expect(parseBatchResults({ a: 1 })).toEqual([]);
    expect(parseBatchResults([{ batch: 1, status: 'SUCCEEDED' }, 'x'])).toHaveLength(1);
  });
});
