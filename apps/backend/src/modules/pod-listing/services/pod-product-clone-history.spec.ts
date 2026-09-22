import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PodListingJobItemStatus, PodListingJobStatus } from '@prisma/client';
import { PodShopForbiddenException } from '../../pod-tiktok/services/pod-access-scope.service';
import { PodProductCloneHistoryService } from './pod-product-clone-history.service';

/**
 * **Clone Products / Clone History** — ba luật cần khoá:
 *  1. Seller chỉ thấy lượt do CHÍNH MÌNH tạo; Admin (`pod.shop.all`) thấy cả tổ chức.
 *  2. Trạng thái tổng suy từ job (SUCCESS / PARTIAL / FAILED / PROCESSING / PENDING), tiến độ
 *     đếm từ item — không suy ngược trạng thái từng shop từ trạng thái tổng.
 *  3. Retry CHỈ chạm shop FAILED; SUCCESS / SKIPPED không bao giờ bị chạy lại.
 */

const ORG = 'org-1';
const SELLER = { allShops: false, accountIds: [], shopIds: ['shop-a', 'shop-b'] };
const ADMIN = { allShops: true, accountIds: [], shopIds: [] };
const NOW = new Date('2026-09-22T10:00:00Z');

const shop = (id: string) => ({ id, name: id.toUpperCase(), region: 'US', account: { accountName: `conn-${id}` } });
const item = (id: string, shopId: string, status: PodListingJobItemStatus, over: Record<string, unknown> = {}) => ({
  id,
  shopId,
  status,
  shop: shop(shopId),
  product: {
    id: 'prod-1',
    title: 'Poster',
    tiktokProductId: 'TT-SRC',
    shop: shop('shop-src'),
    images: [{ url: 'https://cdn/p.jpg', thumbUrl: 'https://cdn/p-thumb.jpg' }],
  },
  payload: status === PodListingJobItemStatus.SUCCESS ? { id: `pl-${id}`, status: 'PUBLISHED', tiktokProductId: `TT-${id}`, tiktokDraftId: `TT-${id}`, reviewStatus: 'UNDER_REVIEW', publishedAt: NOW } : null,
  remoteProductId: status === PodListingJobItemStatus.SUCCESS ? `TT-${id}` : null,
  error: status === PodListingJobItemStatus.FAILED ? 'TikTok API error 36009004: Currency of Price is a required field' : null,
  errorCode: status === PodListingJobItemStatus.FAILED ? '36009004' : null,
  retryCount: 0,
  nextAttemptAt: null,
  startedAt: NOW,
  finishedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const job = (status: PodListingJobStatus, items: unknown[], createdBy = 'seller-1') => ({
  id: 'job-1',
  name: 'Nhân bản · Poster → 3 shop',
  status,
  market: 'US',
  createdBy,
  createdAt: NOW,
  updatedAt: NOW,
  startedAt: NOW,
  finishedAt: null,
  lastError: null,
  items,
});

function buildService(rows: unknown[]) {
  const prisma = {
    podListingJob: {
      findMany: jest.fn<Promise<unknown[]>, [{ where: Record<string, unknown> }]>().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
      findFirst: jest.fn((args: { where: { createdBy?: string } }) =>
        Promise.resolve(
          (rows as Array<{ createdBy: string }>).find((row) => !args.where.createdBy || row.createdBy === args.where.createdBy) ?? null,
        ),
      ),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'seller-1', fullName: 'Seller One', email: 's1@x' }]) },
    podListingLog: {
      findMany: jest.fn().mockResolvedValue([
        { listingItemId: 'i-b', message: 'Thất bại: …', payload: { tiktokCode: 36009004, tiktokRequestId: 'req-9' }, createdAt: NOW },
      ]),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const jobs = { retry: jest.fn().mockResolvedValue({}) };
  const service = new PodProductCloneHistoryService(prisma as never, jobs as never);
  return { service, prisma, jobs };
}

describe('PodProductCloneHistoryService.list', () => {
  const partial = job(PodListingJobStatus.COMPLETED_WITH_ERRORS, [
    item('i-a', 'shop-a', PodListingJobItemStatus.SUCCESS),
    item('i-b', 'shop-b', PodListingJobItemStatus.FAILED),
    item('i-c', 'shop-c', PodListingJobItemStatus.PROCESSING),
  ]);

  it('Seller ⇒ lọc createdBy = chính mình; Admin ⇒ không lọc và lọc được theo người tạo', async () => {
    const { service, prisma } = buildService([partial]);
    await service.list(ORG, 'seller-1', {}, SELLER);
    expect(prisma.podListingJob.findMany.mock.calls[0][0].where).toMatchObject({ type: 'CLONE', createdBy: 'seller-1' });

    await service.list(ORG, 'admin-1', { createdBy: 'seller-2' }, ADMIN);
    expect(prisma.podListingJob.findMany.mock.calls[1][0].where).toMatchObject({ createdBy: 'seller-2' });

    // Seller cố lọc theo người khác ⇒ vẫn là chính mình.
    await service.list(ORG, 'seller-1', { createdBy: 'seller-2' }, SELLER);
    // Lời gọi Admin ở trên còn đọc thêm danh sách người tạo (findMany distinct) ⇒ lấy lời gọi CUỐI.
    expect(prisma.podListingJob.findMany.mock.calls.at(-1)?.[0].where).toMatchObject({ createdBy: 'seller-1' });
  });

  it('trạng thái tổng PARTIAL + tiến độ 2/3 + đếm từng loại; sản phẩm/shop nguồn từ item; Product Mapping từ payload', async () => {
    const { service } = buildService([partial]);
    const { items } = await service.list(ORG, 'seller-1', {}, SELLER);

    expect(items[0]).toMatchObject({
      status: 'PARTIAL',
      counts: { total: 3, success: 1, failed: 1, processing: 1, pending: 0, skipped: 0 },
      progress: { completed: 2, total: 3 },
      running: true,
      product: { id: 'prod-1', title: 'Poster', tiktokProductId: 'TT-SRC', thumbnailUrl: 'https://cdn/p-thumb.jpg' },
      sourceShop: { id: 'shop-src', connectionName: 'conn-shop-src' },
      createdBy: { id: 'seller-1', name: 'Seller One' },
    });
    expect(items[0].targets.map((target) => [target.shop.id, target.status, target.tiktokProductId, target.error])).toEqual([
      ['shop-a', 'SUCCESS', 'TT-i-a', null],
      ['shop-b', 'FAILED', null, 'TikTok API error 36009004: Currency of Price is a required field'],
      ['shop-c', 'PROCESSING', null, null],
    ]);
  });

  it('bộ lọc trạng thái tổng ⇒ trạng thái job tương ứng; các bộ lọc item gộp bằng AND (không đè nhau)', async () => {
    const { service, prisma } = buildService([]);
    await service.list(ORG, 'admin-1', { status: 'FAILED', search: 'Poster', sourceShopId: 'shop-src', targetShopId: 'shop-b' }, ADMIN);
    const where = prisma.podListingJob.findMany.mock.calls[0][0].where as unknown as { status: { in: string[] }; AND: unknown[] };
    expect(where.status.in).toEqual(['FAILED', 'CANCELLED']);
    expect(where.AND).toHaveLength(3);
  });

  it('SUCCESS / FAILED / PROCESSING / PENDING ánh xạ đúng', async () => {
    const statuses = [
      [PodListingJobStatus.COMPLETED, 'SUCCESS'],
      [PodListingJobStatus.FAILED, 'FAILED'],
      [PodListingJobStatus.CANCELLED, 'FAILED'],
      [PodListingJobStatus.PROCESSING, 'PROCESSING'],
      [PodListingJobStatus.PENDING, 'PENDING'],
    ] as const;
    for (const [jobStatus, expected] of statuses) {
      const { service } = buildService([job(jobStatus, [item('i-a', 'shop-a', PodListingJobItemStatus.SUCCESS)])]);
      const { items } = await service.list(ORG, 'seller-1', {}, SELLER);
      expect(items[0].status).toBe(expected);
    }
  });
});

describe('PodProductCloneHistoryService.get / retryFailed', () => {
  const partial = () =>
    job(PodListingJobStatus.COMPLETED_WITH_ERRORS, [
      item('i-a', 'shop-a', PodListingJobItemStatus.SUCCESS),
      item('i-b', 'shop-b', PodListingJobItemStatus.FAILED),
      item('i-s', 'shop-a', PodListingJobItemStatus.SKIPPED, { error: 'Đã có sản phẩm' }),
    ]);

  it('CASE 9: Seller khác không xem được lượt của người khác ⇒ 404', async () => {
    const { service } = buildService([partial()]);
    await expect(service.get(ORG, 'seller-2', 'job-1', SELLER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('CASE 10: Admin xem được, kèm chi tiết lỗi từ log ERROR gần nhất của shop FAILED', async () => {
    const { service } = buildService([partial()]);
    const batch = await service.get(ORG, 'admin-1', 'job-1', ADMIN);
    expect(batch.targets.find((target) => target.id === 'i-b')?.errorDetail).toMatchObject({ tiktokCode: 36009004, tiktokRequestId: 'req-9' });
  });

  it('CASE 6: retry lượt ⇒ CHỈ item FAILED được đưa vào retry (SUCCESS, SKIPPED không đụng)', async () => {
    const { service, jobs } = buildService([partial()]);
    await service.retryFailed(ORG, 'seller-1', 'job-1', SELLER);
    expect(jobs.retry).toHaveBeenCalledWith(ORG, 'seller-1', 'job-1', { itemIds: ['i-b'] }, SELLER);
  });

  it('retry một item không FAILED ⇒ 400, không gọi hàng đợi', async () => {
    const { service, jobs } = buildService([partial()]);
    await expect(service.retryFailed(ORG, 'seller-1', 'job-1', SELLER, 'i-a')).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.retry).not.toHaveBeenCalled();
  });

  it('Seller không còn được gán shop đích ⇒ 403 (không bypass phạm vi shop)', async () => {
    const { service } = buildService([partial()]);
    await expect(
      service.retryFailed(ORG, 'seller-1', 'job-1', { allShops: false, accountIds: [], shopIds: ['shop-a'] }),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);
  });
});
