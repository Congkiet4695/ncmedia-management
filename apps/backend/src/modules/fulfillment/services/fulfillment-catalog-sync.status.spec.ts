import type { PrismaService } from '../../../database/prisma.service';
import type { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import type { MangoCatalogService } from '../mango/services/mango-catalog.service';
import type { FulfillmentCatalogRepository } from '../repositories/fulfillment-catalog.repository';
import type { FulfillmentRepository } from '../repositories/fulfillment.repository';
import type { SellerwixCatalogService } from '../sellerwix/services/sellerwix-catalog.service';
import { FulfillmentCatalogSyncService } from './fulfillment-catalog-sync.service';

function build(held: boolean | Error) {
  const locks = {
    isHeld: jest.fn(() => (held instanceof Error ? Promise.reject(held) : Promise.resolve(held))),
  };
  const service = new FulfillmentCatalogSyncService(
    {} as PrismaService,
    {} as FulfillmentRepository,
    {} as FulfillmentCatalogRepository,
    {} as MangoCatalogService,
    {} as SellerwixCatalogService,
    locks as unknown as DistributedLockService,
  );
  return { service, locks };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe('FulfillmentCatalogSyncService.effectiveSyncStatus — RUNNING có còn sống không', () => {
  it('chưa từng đồng bộ ⇒ null', async () => {
    await expect(build(false).service.effectiveSyncStatus('acc', null)).resolves.toBeNull();
  });

  it('lượt đã xong ⇒ giữ nguyên trạng thái, không hỏi Redis', async () => {
    const { service, locks } = build(false);
    await expect(service.effectiveSyncStatus('acc', { status: 'SUCCESS', startedAt: minutesAgo(1) })).resolves.toBe('SUCCESS');
    expect(locks.isHeld).not.toHaveBeenCalled();
  });

  it('RUNNING + khoá còn giữ ⇒ RUNNING (đang chạy thật)', async () => {
    const { service, locks } = build(true);
    await expect(service.effectiveSyncStatus('acc-1', { status: 'RUNNING', startedAt: minutesAgo(20) })).resolves.toBe('RUNNING');
    expect(locks.isHeld).toHaveBeenCalledWith('fulfillment:catalog-sync:acc-1');
  });

  it('🔴 RUNNING nhưng khoá đã mất (server restart / deploy giữa chừng) ⇒ INTERRUPTED ngay, không chờ 3 giờ', async () => {
    const { service } = build(false);
    await expect(service.effectiveSyncStatus('acc', { status: 'RUNNING', startedAt: minutesAgo(15) })).resolves.toBe('INTERRUPTED');
  });

  it('RUNNING quá 3 giờ ⇒ INTERRUPTED (kể cả khi không hỏi được khoá)', async () => {
    const { service } = build(true);
    await expect(service.effectiveSyncStatus('acc', { status: 'RUNNING', startedAt: minutesAgo(200) })).resolves.toBe('INTERRUPTED');
  });

  it('Redis lỗi ⇒ không đoán là chết — giữ RUNNING', async () => {
    const { service } = build(new Error('redis down'));
    await expect(service.effectiveSyncStatus('acc', { status: 'RUNNING', startedAt: minutesAgo(5) })).resolves.toBe('RUNNING');
  });
});
