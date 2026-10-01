import { PodShopSyncType, PodSyncStatus, PodSyncTrigger, Prisma } from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import { PodShopSyncStatusRepository } from './pod-shop-sync-status.repository';

/**
 * Kiểm phần "hợp đồng" của repository bằng mock. Hành vi thật (một dòng / khoá kể cả khi chạy
 * đồng thời) được kiểm trên PostgreSQL trong `test/manual/e2e-shop-sync-status.manual.ts`.
 */
describe('PodShopSyncStatusRepository', () => {
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    podShopSyncStatus: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const repo = new PodShopSyncStatusRepository(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  const startData = {
    organizationId: 'org-a',
    accountId: 'acc-a',
    shopId: 'shop-1',
    syncType: PodShopSyncType.ORDER,
    trigger: PodSyncTrigger.CRON,
    startedAt: new Date('2026-10-02T00:00:00Z'),
  };

  it('start ⇒ MỘT câu INSERT … ON CONFLICT (khoá) DO UPDATE, trả handle có run_id mới', async () => {
    const run = await repo.start(startData);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = callArg<TemplateStringsArray>(prisma.$executeRaw, 0, 0).join('?');
    expect(sql).toContain('INSERT INTO "pod_shop_sync_statuses"');
    expect(sql).toContain('ON CONFLICT ("organization_id", "shop_id", "sync_type") DO UPDATE');
    // Lượt mới xoá kết quả + lỗi của lượt trước.
    expect(sql).toContain('"error_message" = NULL');
    expect(sql).toContain('"status"        = \'RUNNING\'');
    expect(run).toMatchObject({ organizationId: 'org-a', shopId: 'shop-1', syncType: 'ORDER' });
    expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('mỗi lượt start sinh run_id KHÁC nhau (fencing token)', async () => {
    const a = await repo.start(startData);
    const b = await repo.start(startData);
    expect(a.runId).not.toBe(b.runId);
  });

  it('finish chỉ ghi khi run_id còn là của lượt này; SUCCESS ⇒ xoá lỗi', async () => {
    const run = await repo.start(startData);
    const wrote = await repo.finish(run, {
      status: PodSyncStatus.SUCCESS,
      totalCount: 3,
      createdCount: 1,
      updatedCount: 1,
      skippedCount: 1,
      failedCount: 0,
    });

    expect(wrote).toBe(true);
    const arg = callArg<{ where: Record<string, unknown>; data: Record<string, unknown> }>(
      prisma.podShopSyncStatus.updateMany,
      0,
      0,
    );
    expect(arg.where).toEqual({
      organizationId: 'org-a',
      shopId: 'shop-1',
      syncType: 'ORDER',
      runId: run.runId,
    });
    expect(arg.data).toMatchObject({ status: 'SUCCESS', errorCode: null, errorMessage: null });
    expect(arg.data.details).toBe(Prisma.JsonNull);
    expect(typeof arg.data.durationMs).toBe('number');
  });

  it('finish của lượt đã bị lượt mới hơn giành dòng ⇒ false (không ghi đè)', async () => {
    prisma.podShopSyncStatus.updateMany.mockResolvedValueOnce({ count: 0 });
    const run = await repo.start(startData);
    await expect(
      repo.finish(run, {
        status: PodSyncStatus.FAILED,
        totalCount: 0,
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        errorMessage: 'x',
      }),
    ).resolves.toBe(false);
  });

  it('FAILED ⇒ cắt error_code/error_message theo độ dài cột', async () => {
    const run = await repo.start(startData);
    await repo.finish(run, {
      status: PodSyncStatus.FAILED,
      totalCount: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errorCode: 'C'.repeat(100),
      errorMessage: 'M'.repeat(5000),
    });
    const data = callArg<{ data: { errorCode: string; errorMessage: string } }>(
      prisma.podShopSyncStatus.updateMany,
      0,
      0,
    ).data;
    expect(data.errorCode).toHaveLength(64);
    expect(data.errorMessage).toHaveLength(2000);
  });

  it('findLatest: phạm vi Seller được GIAO với bộ lọc shop, luôn theo tổ chức + loại', async () => {
    await repo.findLatest('org-a', {
      syncType: PodShopSyncType.PRODUCT,
      shopScope: ['shop-1'],
      shopId: 'shop-2',
    });
    const where = callArg<{ where: Record<string, unknown> }>(
      prisma.podShopSyncStatus.findMany,
      0,
      0,
    ).where;
    expect(where).toEqual({ organizationId: 'org-a', syncType: 'PRODUCT', shopId: { in: [] } });
  });

  it('findLatest: Admin (không giới hạn) ⇒ không lọc shop', async () => {
    await repo.findLatest('org-a', { syncType: PodShopSyncType.ORDER });
    const where = callArg<{ where: Record<string, unknown> }>(
      prisma.podShopSyncStatus.findMany,
      0,
      0,
    ).where;
    expect(where).toEqual({ organizationId: 'org-a', syncType: 'ORDER' });
  });

  it('failStaleRuns chỉ đụng loại đồng bộ được yêu cầu', async () => {
    const before = new Date();
    await repo.failStaleRuns(PodShopSyncType.ORDER, before);
    const where = callArg<{ where: Record<string, unknown> }>(
      prisma.podShopSyncStatus.updateMany,
      0,
      0,
    ).where;
    expect(where).toEqual({ syncType: 'ORDER', status: 'RUNNING', startedAt: { lt: before } });
  });
});
