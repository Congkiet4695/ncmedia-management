import type { Prisma } from '@prisma/client';
import { DataRetentionService, type DataRetentionOptions } from './data-retention.service';

/**
 * Vòng lặp retention (lô, trần, khoá, lỗi độc lập từng tác vụ, dry-run, chạy lại) — kiểm bằng mock.
 * Điều kiện SQL: data-retention.tasks.spec.ts · hành vi thật trên Postgres: test/manual/e2e-hard-delete-retention.
 */

const NOW = new Date('2026-10-29T15:00:00.000Z');

type Answer = number | Error;

/**
 * `counts`/`deletes` theo TÊN BẢNG (khớp trong câu SQL) — mỗi lần gọi lấy phần tử kế tiếp, hết thì 0.
 */
function build(
  opts: {
    counts?: Record<string, Answer[]>;
    deletes?: Record<string, Answer[]>;
    locked?: string[];
  } = {},
) {
  const counts = Object.fromEntries(Object.entries(opts.counts ?? {}).map(([k, v]) => [k, [...v]]));
  const deletes = Object.fromEntries(
    Object.entries(opts.deletes ?? {}).map(([k, v]) => [k, [...v]]),
  );
  const executed: Prisma.Sql[] = [];
  const next = (bucket: Record<string, Answer[]>, sql: Prisma.Sql): Promise<number> => {
    // Bảng cụ thể nhất khớp trước (pod_listing_job_items ⊃ pod_listing_jobs không nhầm nhau).
    const key = Object.keys(bucket)
      .sort((a, b) => b.length - a.length)
      .find(
        (table) =>
          sql.sql.includes(`FROM ${table} x`) || sql.sql.startsWith(`DELETE FROM ${table} `),
      );
    const value = key ? bucket[key].shift() : undefined;
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value ?? 0);
  };
  const prisma = {
    $executeRaw: jest.fn((sql: Prisma.Sql) => {
      executed.push(sql);
      return next(deletes, sql);
    }),
    $queryRaw: jest.fn(async (sql: Prisma.Sql) => [{ n: BigInt(await next(counts, sql)) }]),
  };
  const locks = {
    acquire: jest.fn((key: string) =>
      Promise.resolve(
        (opts.locked ?? []).some((task) => key.endsWith(task)) ? null : { key, fenceToken: 'f' },
      ),
    ),
    release: jest.fn().mockResolvedValue(undefined),
    renew: jest.fn().mockResolvedValue(true),
  };
  const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) };
  const service = new DataRetentionService(prisma as never, locks as never, config as never);
  jest.spyOn(service as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue();
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(service['logger'], level).mockImplementation(() => undefined);
  }
  return { service, prisma, locks, executed };
}

function options(extra: Partial<DataRetentionOptions> = {}): DataRetentionOptions {
  return {
    tasks: ['RECENT_NOTIFICATIONS', 'PUBLISH_HISTORY', 'DRAFT_LISTINGS'],
    dryRun: false,
    publishHistoryDays: 7,
    draftListingDays: 7,
    batchSize: 1000,
    maxBatchesPerStage: 10,
    pauseMs: 0,
    timeZone: 'America/Los_Angeles',
    now: NOW,
    ...extra,
  };
}

describe('DataRetentionService', () => {
  it('cấu hình mặc định: DRY-RUN, đủ 3 tác vụ, giữ 7 ngày, múi giờ Los Angeles', () => {
    const { service } = build();
    expect(service.configuredOptions()).toMatchObject({
      dryRun: true,
      tasks: ['RECENT_NOTIFICATIONS', 'PUBLISH_HISTORY', 'DRAFT_LISTINGS'],
      publishHistoryDays: 7,
      draftListingDays: 7,
      timeZone: 'America/Los_Angeles',
    });
  });

  it('🔴 DRY-RUN ⇒ chỉ ĐẾM, không một lệnh DELETE nào', async () => {
    const { service, executed } = build({ counts: { notification_events: [42, 3] } });
    const result = await service.run(options({ dryRun: true }));
    expect(executed).toHaveLength(0);
    const task = result.tasks.find((row) => row.task === 'RECENT_NOTIFICATIONS')!;
    expect(task.status).toBe('COMPLETED');
    expect(task.stages[0]).toMatchObject({ eligible: 42, deleted: 0, remaining: 42 });
    expect(task.kept).toEqual({ UNFINISHED_DELIVERY: 3 });
  });

  it('mốc: Notifications giữ hôm nay, Publish History / Draft giữ 7 ngày (tính cả hôm nay), theo LA', async () => {
    const { service } = build();
    const result = await service.run(options({ dryRun: true }));
    const byTask = Object.fromEntries(result.tasks.map((row) => [row.task, row]));
    expect(byTask.RECENT_NOTIFICATIONS).toMatchObject({
      keepDays: 1,
      keepFromDay: '2026-10-29',
      cutoff: '2026-10-29T07:00:00.000Z',
    });
    expect(byTask.PUBLISH_HISTORY).toMatchObject({ keepDays: 7, keepFromDay: '2026-10-23' });
    expect(byTask.DRAFT_LISTINGS).toMatchObject({ keepDays: 7, keepFromDay: '2026-10-23' });
  });

  it('xoá theo LÔ tới khi lô thiếu ⇒ dừng; số đếm khớp', async () => {
    const { service, executed } = build({
      counts: { notification_events: [2500, 0, 0] },
      deletes: { notification_events: [1000, 1000, 500] },
    });
    const result = await service.run(options({ tasks: ['RECENT_NOTIFICATIONS'] }));
    expect(executed).toHaveLength(3);
    expect(result.tasks[0]).toMatchObject({ status: 'COMPLETED' });
    expect(result.tasks[0].stages[0]).toMatchObject({
      eligible: 2500,
      deleted: 2500,
      batches: 3,
      remaining: 0,
    });
  });

  it('chạm trần số lô ⇒ PARTIAL, phần còn lại để lượt sau', async () => {
    const { service, executed } = build({
      counts: { notification_events: [5000, 3000] },
      deletes: { notification_events: [1000, 1000, 1000] },
    });
    const result = await service.run(
      options({ tasks: ['RECENT_NOTIFICATIONS'], maxBatchesPerStage: 2 }),
    );
    expect(executed).toHaveLength(2);
    expect(result.tasks[0].status).toBe('PARTIAL');
    expect(result.tasks[0].stages[0]).toMatchObject({ deleted: 2000, remaining: 3000 });
  });

  it('🔴 chạy lại khi không còn gì ⇒ COMPLETED, 0 dòng, không lệnh DELETE (idempotent)', async () => {
    const { service, executed } = build();
    const result = await service.run(options());
    expect(executed).toHaveLength(0);
    expect(result.tasks.every((row) => row.status === 'COMPLETED')).toBe(true);
  });

  it('🔴 một tác vụ lỗi KHÔNG chặn tác vụ khác', async () => {
    const { service } = build({
      counts: { notification_events: [10], pod_listing_payloads: [5, 0] },
      deletes: { notification_events: [new Error('deadlock detected')], pod_listing_payloads: [5] },
    });
    const result = await service.run(
      options({ tasks: ['RECENT_NOTIFICATIONS', 'DRAFT_LISTINGS'] }),
    );
    const byTask = Object.fromEntries(result.tasks.map((row) => [row.task, row]));
    expect(byTask.RECENT_NOTIFICATIONS).toMatchObject({
      status: 'FAILED',
      error: 'deadlock detected',
    });
    expect(byTask.DRAFT_LISTINGS.status).toBe('COMPLETED');
    expect(
      byTask.DRAFT_LISTINGS.stages.find((stage) => stage.table === 'pod_listing_payloads'),
    ).toMatchObject({
      deleted: 5,
    });
    expect(byTask.PUBLISH_HISTORY.status).toBe('DISABLED');
  });

  it('🔴 tác vụ đang chạy ở replica / CLI khác (khoá Redis) ⇒ LOCKED, không đếm, không xoá', async () => {
    const { service, prisma, locks } = build({ locked: ['PUBLISH_HISTORY'] });
    const result = await service.run(options({ tasks: ['PUBLISH_HISTORY'] }));
    expect(result.tasks.find((row) => row.task === 'PUBLISH_HISTORY')!.status).toBe('LOCKED');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(locks.release).not.toHaveBeenCalled();
  });

  it('khoá luôn được giải phóng — kể cả khi tác vụ lỗi; được gia hạn trước mỗi lô', async () => {
    const { service, locks } = build({
      counts: { notification_events: [3000] },
      deletes: { notification_events: [1000, new Error('boom')] },
    });
    await service.run(options({ tasks: ['RECENT_NOTIFICATIONS'] }));
    expect(locks.renew).toHaveBeenCalledTimes(2);
    expect(locks.release).toHaveBeenCalledTimes(1);
  });

  it('Publish History xoá đúng thứ tự log → item → job', async () => {
    const { service, executed } = build({
      counts: { pod_listing_logs: [3, 0], pod_listing_job_items: [2, 0], pod_listing_jobs: [1, 0] },
      deletes: { pod_listing_logs: [3], pod_listing_job_items: [2], pod_listing_jobs: [1] },
    });
    const result = await service.run(options({ tasks: ['PUBLISH_HISTORY'] }));
    expect(executed.map((sql) => /^DELETE FROM (\w+)/.exec(sql.sql)?.[1])).toEqual([
      'pod_listing_logs',
      'pod_listing_job_items',
      'pod_listing_jobs',
    ]);
    expect(result.tasks.find((row) => row.task === 'PUBLISH_HISTORY')!.status).toBe('COMPLETED');
  });
});
