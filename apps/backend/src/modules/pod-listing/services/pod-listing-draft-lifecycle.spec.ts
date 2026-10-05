import { PodListingPayloadStatus, PodListingReviewStatus } from '@prisma/client';
import { PodAccessScopeService, type PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import { PodListingPayloadService } from './pod-listing-payload.service';
import { PodListingReviewService } from './pod-listing-review.service';

/**
 * Draft Listings — chọn nhiều + xoá, và "đã lên sàn thật thì rời Draft Listings".
 * Phân quyền theo shop dùng `PodAccessScopeService` THẬT.
 */
const ORG = 'org-1';
const ADMIN: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const SELLER_A: PodAccessScope = { allShops: false, accountIds: ['acc-a'], shopIds: ['shop-a'] };

type Draft = { id: string; shopId: string; status: PodListingPayloadStatus; tiktokDraftId: string | null };

function buildPayloads(drafts: Draft[]) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    podListingPayload: {
      findFirst: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(drafts.find((draft) => draft.id === where.id) ?? null),
      ),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return Promise.resolve({});
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const publisher = {
    shopContext: jest.fn().mockResolvedValue({ shopId: 'ctx' }),
    deleteRemoteProducts: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PodListingPayloadService(
    prisma as never,
    {} as never,
    {} as never,
    publisher as never,
    new PodAccessScopeService({} as never),
  );
  return { service, prisma, publisher, updates };
}

describe('PodListingPayloadService.removeMany — xoá nhiều Draft đã chọn', () => {
  const drafts: Draft[] = [
    { id: 'd-1', shopId: 'shop-a', status: PodListingPayloadStatus.READY, tiktokDraftId: null },
    { id: 'd-2', shopId: 'shop-a', status: PodListingPayloadStatus.TIKTOK_DRAFT, tiktokDraftId: 'tt-draft-2' },
    { id: 'd-b', shopId: 'shop-b', status: PodListingPayloadStatus.READY, tiktokDraftId: null },
    { id: 'd-pub', shopId: 'shop-a', status: PodListingPayloadStatus.PUBLISHED, tiktokDraftId: 'tt-pub' },
  ];

  it('xoá đúng các draft đã chọn; draft có trên TikTok ⇒ xoá luôn bên TikTok khi remote = true', async () => {
    const h = buildPayloads(drafts);

    const result = await h.service.removeMany(ORG, 'user-1', ['d-1', 'd-2'], ADMIN, { remote: true });

    expect(result).toEqual({ requested: 2, deleted: ['d-1', 'd-2'], removedRemote: ['d-2'], failed: [] });
    expect(h.publisher.deleteRemoteProducts).toHaveBeenCalledWith({ shopId: 'ctx' }, ['tt-draft-2']);
    expect(h.updates.map((update) => update.id)).toEqual(['d-1', 'd-2']);
    expect(h.updates[0].data).toMatchObject({ status: PodListingPayloadStatus.ARCHIVED, updatedBy: 'user-1' });
  });

  it('🔴 Seller A chọn cả draft của shop B ⇒ draft B KHÔNG bị xoá (403 theo từng dòng), draft của A vẫn xoá', async () => {
    const h = buildPayloads(drafts);

    const result = await h.service.removeMany(ORG, 'seller-a', ['d-1', 'd-b'], SELLER_A);

    expect(result.deleted).toEqual(['d-1']);
    expect(result.failed).toEqual([
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- asymmetric matcher của jest
      { id: 'd-b', code: 'POD_SHOP_FORBIDDEN', message: expect.any(String) },
    ]);
    expect(h.updates.map((update) => update.id)).toEqual(['d-1']);
  });

  it('🔴 xoá một phần ⇒ trả rõ dòng nào hỏng và vì sao (không báo thành công chung)', async () => {
    const h = buildPayloads(drafts);

    const result = await h.service.removeMany(ORG, 'user-1', ['d-1', 'd-pub', 'missing'], ADMIN);

    expect(result.requested).toBe(3);
    expect(result.deleted).toEqual(['d-1']);
    expect(result.failed.map((failure) => [failure.id, failure.code])).toEqual([
      ['d-pub', 'POD_PAYLOAD_ALREADY_PUBLISHED'],
      ['missing', 'POD_LISTING_PAYLOAD_NOT_FOUND'],
    ]);
  });

  it('🔴 xoá bên TikTok hỏng ⇒ KHÔNG xoá mềm ở hệ thống (không để mất dấu draft mồ côi)', async () => {
    const h = buildPayloads(drafts);
    h.publisher.deleteRemoteProducts.mockRejectedValueOnce(new Error('TikTok 500'));

    const result = await h.service.removeMany(ORG, 'user-1', ['d-2'], ADMIN, { remote: true });

    expect(result.deleted).toEqual([]);
    expect(result.failed[0]).toMatchObject({ id: 'd-2', message: 'TikTok 500' });
    expect(h.updates).toEqual([]);
  });

  it('🔴 danh sách Draft Listings loại sản phẩm ĐÃ LÊN SÀN (went_live_at), vẫn trong phạm vi shop', async () => {
    const h = buildPayloads([]);

    await h.service.list(ORG, {}, SELLER_A);

    const where = (h.prisma.podListingPayload.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ organizationId: ORG, deletedAt: null, wentLiveAt: null, shopId: { in: ['shop-a'] } });
  });
});

describe('PodListingReviewService — chỉ "đang bán" (ACTIVE) mới rời Draft Listings', () => {
  function buildReview(product: Record<string, unknown>, wentLiveAt: Date | null = null) {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      podListingPayload: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'd-1',
            organizationId: ORG,
            shopId: 'shop-a',
            tiktokProductId: 'tt-p-1',
            reviewStatus: PodListingReviewStatus.UNDER_REVIEW,
            wentLiveAt,
          },
        ]),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({});
        }),
      },
    };
    const publisher = { shopContext: jest.fn().mockResolvedValue({ shopId: 'ctx' }) };
    const productApi = { getProduct: jest.fn().mockResolvedValue({ data: product }) };
    const service = new PodListingReviewService(prisma as never, publisher as never, productApi as never);
    return { service, updates };
  }

  it('TikTok báo ACTIVATE (đang bán) ⇒ ghi went_live_at ⇒ draft rời Draft Listings', async () => {
    const h = buildReview({ status: 'ACTIVATE' });
    await h.service.sync();
    expect(h.updates[0]).toMatchObject({
      reviewStatus: PodListingReviewStatus.ACTIVE,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- asymmetric matcher của jest
      wentLiveAt: expect.any(Date),
    });
  });

  it.each([
    ['đang duyệt (PENDING)', { status: 'PENDING' }],
    ['bị từ chối (FAILED)', { status: 'FAILED', audit: { status: 'FAILED' } }],
  ])('🔴 %s ⇒ KHÔNG ghi went_live_at — draft vẫn ở Draft Listings', async (_label, product) => {
    const h = buildReview(product);
    await h.service.sync();
    expect(h.updates[0]).not.toHaveProperty('wentLiveAt');
  });

  it('đã có mốc lên sàn ⇒ không ghi đè (mốc là lần ĐẦU)', async () => {
    const h = buildReview({ status: 'ACTIVATE' }, new Date('2026-10-01T00:00:00Z'));
    await h.service.sync();
    expect(h.updates[0]).not.toHaveProperty('wentLiveAt');
  });
});
