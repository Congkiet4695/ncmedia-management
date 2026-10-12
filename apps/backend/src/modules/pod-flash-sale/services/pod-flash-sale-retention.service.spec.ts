import type { Prisma } from '@prisma/client';
import {
  type FlashSaleRetentionOptions,
  type FlashSaleRetentionPolicy,
  PodFlashSaleRetentionService,
} from './pod-flash-sale-retention.service';

/**
 * Retention Flash Sale (docs/pod-flash-sale/retention.md).
 *
 * Kiểm trên đúng thứ gửi xuống Postgres (SQL + tham số): điều kiện "đợt đã đóng", tuổi theo hạng mục, xoá
 * theo lô có LIMIT, không đụng bảng cha. Hành vi vòng lặp (lô, trần, dừng khi lỗi, khoá) kiểm bằng mock.
 */

const NOW = new Date('2026-10-13T00:00:00.000Z');
const OFF: FlashSaleRetentionPolicy = {
  SYNC_STATUS_LOGS: null,
  OTHER_LOGS: null,
  DELETED_FS_ITEMS: null,
  CLOSED_FS_ITEMS: null,
};

function build(opts: { deletes?: Array<number | Error>; counts?: number[]; lock?: boolean } = {}) {
  const deletes = [...(opts.deletes ?? [])];
  const counts = [...(opts.counts ?? [])];
  const executed: Prisma.Sql[] = [];
  const queried: Prisma.Sql[] = [];
  const prisma = {
    $executeRaw: jest.fn((sql: Prisma.Sql) => {
      executed.push(sql);
      const next = deletes.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next ?? 0);
    }),
    $queryRaw: jest.fn((sql: Prisma.Sql) => {
      queried.push(sql);
      return Promise.resolve([{ n: BigInt(counts.shift() ?? 0) }]);
    }),
  };
  const lock = { key: 'k', fenceToken: 'f' };
  const locks = {
    acquire: jest.fn().mockResolvedValue(opts.lock === false ? null : lock),
    release: jest.fn().mockResolvedValue(undefined),
    renew: jest.fn().mockResolvedValue(true),
  };
  const service = new PodFlashSaleRetentionService(prisma as never, locks as never);
  jest.spyOn(service as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue();
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  return { service, prisma, locks, executed, queried };
}

function options(
  policy: Partial<FlashSaleRetentionPolicy>,
  extra: Partial<FlashSaleRetentionOptions> = {},
) {
  return {
    policy: { ...OFF, ...policy },
    dryRun: false,
    batchSize: 1000,
    maxBatches: 100,
    pauseMs: 0,
    now: NOW,
    ...extra,
  } satisfies FlashSaleRetentionOptions;
}

describe('PodFlashSaleRetentionService', () => {
  it('🔴 TC5 DRY-RUN ⇒ chỉ ĐẾM, không một lệnh DELETE nào', async () => {
    const { service, prisma } = build({ counts: [296_000] });

    const result = await service.run(options({ SYNC_STATUS_LOGS: 14 }, { dryRun: true }));

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'COMPLETED', dryRun: true });
    expect(result.categories[0]).toMatchObject({
      category: 'SYNC_STATUS_LOGS',
      retentionDays: 14,
      cutoff: '2026-09-29T00:00:00.000Z',
      eligible: 296_000,
      deleted: 0,
      remaining: 296_000,
    });
  });

  it('🔴 TC4 hạng mục KHÔNG có số ngày giữ ⇒ không đếm, không xoá (không tự chọn thời hạn)', async () => {
    const { service, prisma } = build();

    const result = await service.run(options({}));

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(result.categories.every((c) => c.retentionDays === null && c.cutoff === null)).toBe(
      true,
    );
  });

  it('🔴 TC7 xoá theo LÔ: lô đầy thì làm tiếp, lô thiếu thì dừng; đếm lại phần còn lại', async () => {
    const { service, executed } = build({ deletes: [1000, 1000, 300], counts: [2300, 0] });

    const result = await service.run(options({ SYNC_STATUS_LOGS: 14 }));

    expect(executed).toHaveLength(3);
    expect(result.categories[0]).toMatchObject({
      eligible: 2300,
      deleted: 2300,
      batches: 3,
      remaining: 0,
    });
    expect(result.status).toBe('COMPLETED');
  });

  it('🔴 TC10 chạm trần số lô ⇒ PARTIAL, phần còn lại để lượt sau (tự tiếp tục theo điều kiện, không con trỏ)', async () => {
    const { service, executed } = build({ deletes: [1000, 1000], counts: [5000, 3000] });

    const result = await service.run(options({ SYNC_STATUS_LOGS: 14 }, { maxBatches: 2 }));

    expect(executed).toHaveLength(2);
    expect(result).toMatchObject({ status: 'PARTIAL' });
    expect(result.categories[0]).toMatchObject({ deleted: 2000, remaining: 3000 });
  });

  it('🔴 TC8 chạy lại khi không còn gì đủ điều kiện ⇒ 0 dòng, không lỗi (idempotent)', async () => {
    const { service } = build({ deletes: [0], counts: [0, 0] });

    const result = await service.run(options({ SYNC_STATUS_LOGS: 14 }));

    expect(result).toMatchObject({ status: 'COMPLETED' });
    expect(result.categories[0]).toMatchObject({ deleted: 0, batches: 0 });
  });

  it('lỗi ở một lô ⇒ DỪNG cả lượt (không chạy các hạng mục sau), FAILED, vẫn nhả khoá', async () => {
    const { service, locks, executed } = build({
      deletes: [1000, new Error('canceling statement due to lock timeout')],
      counts: [5000, 4000],
    });

    const result = await service.run(options({ SYNC_STATUS_LOGS: 14, OTHER_LOGS: 90 }));

    expect(result.status).toBe('FAILED');
    expect(result.categories[0].error).toContain('lock timeout');
    expect(result.categories[1]).toMatchObject({ category: 'OTHER_LOGS', eligible: 0, deleted: 0 });
    expect(executed).toHaveLength(2);
    expect(locks.release).toHaveBeenCalledTimes(1);
  });

  it('🔴 TC11 đang có lượt khác giữ khoá ⇒ LOCKED, không truy vấn gì', async () => {
    const { service, prisma } = build({ lock: false });

    const result = await service.run(options({ SYNC_STATUS_LOGS: 14 }));

    expect(result.status).toBe('LOCKED');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  describe('SQL', () => {
    const cutoff = new Date('2026-09-29T00:00:00.000Z');

    it('🔴 TC6/TC9 mọi hạng mục: chỉ đợt sale ĐÃ ĐÓNG, loại PUBLISHING/RUNNING kể cả đã xoá mềm; chỉ DELETE bảng con, có LIMIT', () => {
      const { service } = build();
      for (const category of [
        'SYNC_STATUS_LOGS',
        'OTHER_LOGS',
        'DELETED_FS_ITEMS',
        'CLOSED_FS_ITEMS',
      ] as const) {
        const sql = service.deleteBatchQuery(category, cutoff, 500);
        expect(sql.sql).toMatch(/f\.status IN \('ENDED', 'CANCELLED', 'FAILED'\)/);
        expect(sql.sql).toMatch(/f\.status NOT IN \('PUBLISHING', 'RUNNING'\)/);
        expect(sql.sql).toMatch(/LIMIT \?\)$/);
        expect(sql.sql).not.toMatch(/DELETE FROM pod_flash_sales\b/);
        expect(sql.values).toContain(500);
        expect(sql.values).toContainEqual(cutoff);
      }
    });

    it('log: SYNC_STATUS/INFO và "mọi log còn lại" là hai tập RỜI nhau, tuổi theo created_at', () => {
      const { service } = build();
      const sync = service.deleteBatchQuery('SYNC_STATUS_LOGS', cutoff, 1).sql;
      const other = service.deleteBatchQuery('OTHER_LOGS', cutoff, 1).sql;
      expect(sync).toContain('DELETE FROM pod_flash_sale_logs');
      expect(sync).toMatch(/x\.action = 'SYNC_STATUS' AND x\.level = 'INFO' AND x\.created_at </);
      expect(other).toMatch(
        /NOT \(x\.action = 'SYNC_STATUS' AND x\.level = 'INFO'\) AND x\.created_at </,
      );
    });

    it('item: đợt xoá mềm theo deleted_at; đợt đã kết thúc (chưa xoá) theo mốc muộn nhất end_at/updated_at', () => {
      const { service } = build();
      const deleted = service.deleteBatchQuery('DELETED_FS_ITEMS', cutoff, 1).sql;
      const closed = service.deleteBatchQuery('CLOSED_FS_ITEMS', cutoff, 1).sql;
      expect(deleted).toContain('DELETE FROM pod_flash_sale_items');
      expect(deleted).toMatch(/f\.deleted_at IS NOT NULL AND f\.deleted_at </);
      expect(closed).toMatch(
        /f\.deleted_at IS NULL AND f\.status IN \('ENDED', 'CANCELLED', 'FAILED'\)/,
      );
      expect(closed).toMatch(/GREATEST\(f\.end_at, f\.updated_at\) </);
    });
  });
});
