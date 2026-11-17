import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import { FulfillmentProvider } from '@prisma/client';
import type { CronJob } from 'cron';
import type { FulfillmentCatalogSyncService } from '../services/fulfillment-catalog-sync.service';
import type { ProductMappingAutoService } from '../services/product-mapping-auto.service';
import { FulfillmentCatalogSyncJob } from './fulfillment-catalog-sync.job';

/**
 * **Lịch đồng bộ danh mục** — Sellerwix 1 lần/ngày lúc 00:00 UTC (lịch riêng), Mango / Pressify giữ mỗi 6 giờ.
 * Kiểm bằng CronJob THẬT (thời điểm bắn kế tiếp), không chỉ so chuỗi cron.
 */

function build(config: Record<string, unknown> = {}) {
  const jobs = new Map<string, CronJob>();
  const registry = {
    addCronJob: jest.fn((name: string, job: CronJob) => jobs.set(name, job)),
  } as unknown as SchedulerRegistry;
  const catalogSync = {
    syncAllAccounts: jest.fn().mockResolvedValue({ accounts: 7, succeeded: 7, failed: 0 }),
    syncSellerwixAccounts: jest.fn().mockResolvedValue({ accounts: 5, succeeded: 4, failed: 1, fetches: 1 }),
  };
  const autoMap = { resolveAll: jest.fn().mockResolvedValue({ autoMapped: 0 }) };
  const values: Record<string, unknown> = { 'fulfillment.catalogSync.enabled': true, ...config };
  const job = new FulfillmentCatalogSyncJob(
    { get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback) } as unknown as ConfigService,
    registry,
    catalogSync as unknown as FulfillmentCatalogSyncService,
    autoMap as unknown as ProductMappingAutoService,
  );
  return { job, jobs, catalogSync, autoMap };
}

const nextUtc = (job: CronJob, count: number) =>
  job.nextDates(count).map((date) => date.toUTC().toFormat("yyyy-MM-dd'T'HH:mm"));

describe('FulfillmentCatalogSyncJob — lịch', () => {
  let started: CronJob[] = [];
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.useFakeTimers({ now: new Date('2026-11-17T09:15:00Z') });
  });
  afterEach(() => {
    for (const cron of started) void cron.stop();
    started = [];
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('🔴 Sellerwix: 1 lần/ngày lúc 00:00 UTC — không còn 06/12/18 UTC', () => {
    const { job, jobs } = build();
    job.onModuleInit();
    started = [...jobs.values()];
    const sellerwix = jobs.get(FulfillmentCatalogSyncJob.SELLERWIX_JOB_NAME)!;

    expect(nextUtc(sellerwix, 3)).toEqual(['2026-11-18T00:00', '2026-11-19T00:00', '2026-11-20T00:00']);
  });

  it('Mango / Pressify: giữ mỗi 6 giờ (00/06/12/18 UTC)', () => {
    const { job, jobs } = build();
    job.onModuleInit();
    started = [...jobs.values()];
    expect(nextUtc(jobs.get(FulfillmentCatalogSyncJob.JOB_NAME)!, 4)).toEqual([
      '2026-11-17T12:00',
      '2026-11-17T18:00',
      '2026-11-18T00:00',
      '2026-11-18T06:00',
    ]);
  });

  it('🔴 múi giờ TƯỜNG MINH là UTC — máy chủ đặt TZ khác (vd Asia/Ho_Chi_Minh) vẫn bắn 00:00 UTC', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Asia/Ho_Chi_Minh';
    try {
      const { job, jobs } = build();
      job.onModuleInit();
      started = [...jobs.values()];
      expect(nextUtc(jobs.get(FulfillmentCatalogSyncJob.SELLERWIX_JOB_NAME)!, 1)).toEqual(['2026-11-18T00:00']);
    } finally {
      process.env.TZ = previous;
    }
  });

  it('cron Sellerwix ghi đè được qua cấu hình (FULFILLMENT_CATALOG_SYNC_SELLERWIX_CRON)', () => {
    const { job, jobs } = build({ 'fulfillment.catalogSync.sellerwixCron': '30 2 * * *' });
    job.onModuleInit();
    started = [...jobs.values()];
    expect(nextUtc(jobs.get(FulfillmentCatalogSyncJob.SELLERWIX_JOB_NAME)!, 1)).toEqual(['2026-11-18T02:30']);
  });

  it('tắt bằng FULFILLMENT_CATALOG_SYNC_ENABLED=false ⇒ không đăng ký lịch nào (đồng bộ thủ công không phụ thuộc lịch)', () => {
    const { job, jobs } = build({ 'fulfillment.catalogSync.enabled': false });
    job.onModuleInit();
    expect(jobs.size).toBe(0);
  });
});

describe('FulfillmentCatalogSyncJob — nhịp', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const tick = (job: FulfillmentCatalogSyncJob, name: 'handleTick' | 'handleSellerwixTick') =>
    (job as unknown as Record<string, () => Promise<void>>)[name]();

  it('nhịp 6 giờ chạy MỌI nhà cung cấp TRỪ Sellerwix; nhịp ngày chạy Sellerwix; cả hai rà ánh xạ tự động sau đó', async () => {
    const { job, catalogSync, autoMap } = build();
    await tick(job, 'handleTick');
    expect(catalogSync.syncAllAccounts).toHaveBeenCalledWith({ excludeProviders: [FulfillmentProvider.SELLERWIX] });
    expect(catalogSync.syncSellerwixAccounts).not.toHaveBeenCalled();

    await tick(job, 'handleSellerwixTick');
    expect(catalogSync.syncSellerwixAccounts).toHaveBeenCalledTimes(1);
    expect(autoMap.resolveAll).toHaveBeenCalledTimes(2);
  });

  it('🔴 nhịp Sellerwix đang chạy mà lịch bắn lại ⇒ bỏ qua (không chạy chồng); không chặn nhịp Mango / Pressify', async () => {
    const { job, catalogSync } = build();
    let release: () => void = () => undefined;
    catalogSync.syncSellerwixAccounts.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ accounts: 0, succeeded: 0, failed: 0, fetches: 0 }))),
    );

    const first = tick(job, 'handleSellerwixTick');
    await tick(job, 'handleSellerwixTick');
    await tick(job, 'handleTick');
    release();
    await first;

    expect(catalogSync.syncSellerwixAccounts).toHaveBeenCalledTimes(1);
    expect(catalogSync.syncAllAccounts).toHaveBeenCalledTimes(1);
  });

  it('lượt Sellerwix lỗi ⇒ chỉ ghi log, lịch không chết, lần sau chạy lại được', async () => {
    const { job, catalogSync } = build();
    catalogSync.syncSellerwixAccounts.mockRejectedValueOnce(new Error('db down'));
    await expect(tick(job, 'handleSellerwixTick')).resolves.toBeUndefined();
    await tick(job, 'handleSellerwixTick');
    expect(catalogSync.syncSellerwixAccounts).toHaveBeenCalledTimes(2);
  });
});
