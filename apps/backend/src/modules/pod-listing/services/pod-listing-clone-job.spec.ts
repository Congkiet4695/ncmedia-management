import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  PodListingJobItemStatus,
  PodListingJobType,
  PodListingPayloadStatus,
} from '@prisma/client';
import { PodShopForbiddenException } from '../../pod-tiktok/services/pod-access-scope.service';
import { PodListingJobService } from './pod-listing-job.service';

/**
 * **Nhân bản sản phẩm → nhiều shop** — hai ranh giới cần khoá lại bằng test:
 *
 *  1. `createCloneJob`: shop đích ngoài phạm vi ⇒ 403 cả request (KHÔNG tạo gì); shop đã có
 *     sản phẩm ⇒ item SKIPPED ngay lúc tạo; bấm đúp ⇒ 409; nguồn không tồn tại ⇒ 404.
 *  2. `processCloneItem`: đi đúng đường `publishListing` (Create ở chế độ LISTING, không có
 *     draft id), yêu cầu bảng size khi nguồn có; validate hỏng ⇒ FAILED không gọi TikTok;
 *     TikTok hỏng ⇒ `handleItemFailure`, KHÔNG hẹn đồng bộ.
 */

const ORG = 'org-1';
const USER = 'user-1';
const PRODUCT = 'prod-1';
const SHOP_SRC = 'shop-src';
const SHOP_A = 'shop-a';
const SHOP_B = 'shop-b';

const SOURCE = {
  id: PRODUCT,
  shopId: SHOP_SRC,
  tiktokProductId: 'TT-SRC',
  title: 'Halloween Tee',
  tiktokCategoryId: '600001',
  shop: { id: SHOP_SRC, name: 'Source', region: 'US' },
  variants: [{ sellerSku: 'HAL-S' }],
};

function buildService(overrides: {
  source?: typeof SOURCE | null;
  skipReasons?: Record<string, { code: string; message: string } | null>;
  lockBusy?: boolean;
  validationOk?: boolean;
  resolveErrors?: boolean;
  publishFails?: boolean;
  payloadAlreadyOnTiktok?: boolean;
} = {}) {
  const createdItems: unknown[] = [];
  const createdJobs: unknown[] = [];

  const tx = {
    podListingJob: {
      create: jest.fn((args: { data: unknown }) => {
        createdJobs.push(args.data);
        return Promise.resolve({ id: 'job-1' });
      }),
    },
    podListingJobItem: {
      createMany: jest.fn((args: { data: unknown[] }) => {
        createdItems.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      }),
    },
    podListingLog: { create: jest.fn().mockResolvedValue({}) },
    podListingPayload: { update: jest.fn().mockResolvedValue({}) },
    podListingPayloadItem: { updateMany: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    podTiktokShop: {
      findMany: jest.fn().mockResolvedValue([
        { id: SHOP_A, accountId: 'acc-1', name: 'Shop A', region: 'US' },
        { id: SHOP_B, accountId: 'acc-1', name: 'Shop B', region: 'US' },
      ]),
      findFirst: jest.fn().mockResolvedValue({ id: SHOP_A, accountId: 'acc-1', name: 'Shop A', region: 'US' }),
    },
    podListingJob: {
      findUnique: jest.fn().mockResolvedValue({ market: 'US' }),
      update: jest.fn().mockResolvedValue({}),
    },
    podListingJobItem: { update: jest.fn().mockResolvedValue({}) },
    podListingPayload: {
      findUnique: jest.fn().mockResolvedValue({
        tiktokProductId: overrides.payloadAlreadyOnTiktok ? 'TT-EXISTING' : null,
        status: PodListingPayloadStatus.READY,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((fn: unknown) =>
      typeof fn === 'function' ? (fn as (client: unknown) => unknown)(tx) : Promise.resolve([]),
    ),
  };

  const cloneResolver = {
    loadSource: jest.fn().mockResolvedValue(overrides.source === undefined ? SOURCE : overrides.source),
    findSkipReason: jest.fn((_org: string, _product: unknown, shopId: string) =>
      Promise.resolve(overrides.skipReasons?.[shopId] ?? null),
    ),
    resolveCategory: jest.fn().mockResolvedValue({ tiktokCategoryId: '600001', localName: 'Tees', path: null }),
    resolve: jest.fn().mockReturnValue({
      payload: {
        market: 'US',
        title: 'Halloween Tee',
        category: { tiktokCategoryId: '600001' },
        variants: [{ sellerSku: 'HAL-S', quantity: 0 }],
        images: [{ url: 'https://x/1.jpg' }],
        sizeChart: { fileId: null, url: 'https://x/size.jpg', tiktokImageUri: null },
        video: null,
      },
      issues: overrides.resolveErrors
        ? [{ level: 'ERROR', field: 'category', code: 'DRAFT_MISSING_CATEGORY', message: 'Danh mục không hợp lệ' }]
        : [],
      payloadHash: 'hash',
    }),
  };

  const accessScope = {
    assertShopAllowed: jest.fn((scope: { allShops: boolean; shopIds: string[] }, shopId: string) => {
      if (!scope.allShops && !scope.shopIds.includes(shopId)) throw new PodShopForbiddenException();
    }),
  };

  const lock = {
    withLock: jest.fn(async (_key: string, _ttl: number, task: () => Promise<unknown>) =>
      overrides.lockBusy ? null : task(),
    ),
  };

  const validator = {
    validate: jest.fn().mockReturnValue(
      overrides.validationOk === false
        ? {
            ok: false,
            warnings: [],
            blockers: [{ code: 'LISTING_MISSING_BRAND', field: 'brand', message: 'Chưa chọn thương hiệu' }],
          }
        : {
            ok: false,
            warnings: [],
            // Tồn kho 0 chỉ là cảnh báo với lượt nhân bản — không được chặn.
            blockers: [{ code: 'LISTING_MISSING_STOCK', field: 'variant.HAL-S', message: 'Tồn 0' }],
          },
    ),
  };

  const publisher = {
    shopContext: jest.fn().mockResolvedValue({ accessToken: 't', shopCipher: 'c', shopId: SHOP_A }),
    publishListing: overrides.publishFails
      ? jest.fn().mockRejectedValue(new Error('TikTok 500'))
      : jest.fn().mockResolvedValue({
          remoteProductId: 'TT-NEW-1',
          skuIds: [{ sellerSku: 'HAL-S', tiktokSkuId: 'TT-SKU-NEW' }],
          auditStatus: 'AUDITING',
          mode: 'CREATE',
          request: {},
          response: {},
          tiktokRequestId: 'req-1',
        }),
  };

  const payloads = { saveClone: jest.fn().mockResolvedValue({ id: 'payload-1', created: true, errorCount: 0, status: 'READY' }) };
  const productSync = { scheduleShopSync: jest.fn().mockResolvedValue(new Date()) };

  const service = Object.create(PodListingJobService.prototype) as PodListingJobService;
  const settleItem = jest.fn().mockResolvedValue(undefined);
  const handleItemFailure = jest.fn().mockResolvedValue(undefined);
  Object.assign(service, {
    prisma,
    cloneResolver,
    accessScope,
    lock,
    validator,
    publisher,
    payloads,
    productSync,
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    settleItem,
    handleItemFailure,
    itemLogger: () => jest.fn().mockResolvedValue(undefined),
    runInBackground: jest.fn(),
    get: jest.fn().mockResolvedValue({ id: 'job-1', type: PodListingJobType.CLONE }),
  });

  return { service, prisma, tx, createdItems, createdJobs, cloneResolver, publisher, payloads, productSync, settleItem, handleItemFailure, lock };
}

const ADMIN = { allShops: true, accountIds: [], shopIds: [] };
const SELLER = { allShops: false, accountIds: [], shopIds: [SHOP_SRC, SHOP_A] };

describe('PodListingJobService.createCloneJob', () => {
  it('Admin: 1 sản phẩm → 2 shop ⇒ job type CLONE với 2 item PENDING, chạy nền', async () => {
    const { service, createdItems, createdJobs, lock } = buildService();

    const result = await service.createCloneJob(ORG, USER, PRODUCT, { targetShopIds: [SHOP_A, SHOP_B] }, ADMIN);

    expect(result).toEqual({ id: 'job-1', type: PodListingJobType.CLONE });
    expect(createdJobs[0]).toMatchObject({ type: PodListingJobType.CLONE, totalItems: 2, failedItems: 0, market: 'US' });
    expect(createdItems).toHaveLength(2);
    expect(createdItems.every((item) => (item as { status?: string }).status === undefined)).toBe(true);
    expect(lock.withLock).toHaveBeenCalledWith(`pod:product-clone:${PRODUCT}`, expect.any(Number), expect.any(Function));
  });

  it('Seller gửi shop ngoài phạm vi ⇒ 403 và KHÔNG tạo job/item nào', async () => {
    const { service, createdItems, createdJobs } = buildService();

    await expect(
      service.createCloneJob(ORG, USER, PRODUCT, { targetShopIds: [SHOP_A, SHOP_B] }, SELLER),
    ).rejects.toBeInstanceOf(PodShopForbiddenException);
    expect(createdJobs).toHaveLength(0);
    expect(createdItems).toHaveLength(0);
  });

  it('Seller chỉ gửi shop được gán ⇒ tạo được', async () => {
    const { service, prisma, createdItems } = buildService();
    prisma.podTiktokShop.findMany.mockResolvedValue([{ id: SHOP_A, accountId: 'acc-1', name: 'Shop A', region: 'US' }]);

    await service.createCloneJob(ORG, USER, PRODUCT, { targetShopIds: [SHOP_A] }, SELLER);

    expect(createdItems).toHaveLength(1);
  });

  it('sản phẩm nguồn không tồn tại ⇒ 404', async () => {
    const { service } = buildService({ source: null });

    await expect(
      service.createCloneJob(ORG, USER, PRODUCT, { targetShopIds: [SHOP_A] }, ADMIN),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shop đích đã có sản phẩm ⇒ item SKIPPED ngay lúc tạo, item còn lại vẫn chạy', async () => {
    const { service, createdItems, createdJobs } = buildService({
      skipReasons: { [SHOP_B]: { code: 'ALREADY_EXISTS', message: 'Shop đã có sản phẩm mang cùng Seller SKU' } },
    });

    await service.createCloneJob(ORG, USER, PRODUCT, { targetShopIds: [SHOP_A, SHOP_B] }, ADMIN);

    expect(createdJobs[0]).toMatchObject({ totalItems: 2, failedItems: 1 });
    const skipped = createdItems.find((item) => (item as { shopId: string }).shopId === SHOP_B) as {
      status?: string;
      error?: string;
      errorCode?: string;
    };
    expect(skipped.status).toBe(PodListingJobItemStatus.SKIPPED);
    expect(skipped.errorCode).toBe('CLONE_SKIPPED');
    expect(skipped.error).toContain('Seller SKU');
    const pending = createdItems.find((item) => (item as { shopId: string }).shopId === SHOP_A) as { status?: string };
    expect(pending.status).toBeUndefined();
  });

  it('bấm hai lần liên tiếp (khoá đang giữ) ⇒ 409, không tạo job thứ hai', async () => {
    const { service, createdJobs } = buildService({ lockBusy: true });

    await expect(
      service.createCloneJob(ORG, USER, PRODUCT, { targetShopIds: [SHOP_A, SHOP_B] }, ADMIN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createdJobs).toHaveLength(0);
  });
});

const ITEM = { id: 'item-1', productId: PRODUCT, sessionProductId: null, shopId: SHOP_A, payloadId: null, retryCount: 0 };

async function runItem(service: PodListingJobService) {
  await (service as unknown as { processCloneItem(params: unknown): Promise<void> }).processCloneItem({
    organizationId: ORG,
    jobId: 'job-1',
    userId: USER,
    item: ITEM,
    maxRetries: 3,
    shopContexts: new Map(),
    imageUriCache: new Map(),
  });
}

describe('PodListingJobService.processCloneItem', () => {
  it('thành công: Create ở chế độ LISTING (không draft id), ghi PUBLISHED, hẹn đồng bộ shop đích', async () => {
    const { service, publisher, payloads, tx, settleItem, productSync } = buildService();

    await runItem(service);

    expect(payloads.saveClone).toHaveBeenCalledWith(ORG, USER, expect.objectContaining({ productId: PRODUCT }));
    expect(publisher.publishListing).toHaveBeenCalledWith(
      expect.objectContaining({ tiktokDraftId: null }),
    );
    expect(tx.podListingPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PodListingPayloadStatus.PUBLISHED,
          tiktokProductId: 'TT-NEW-1',
          tiktokDraftId: 'TT-NEW-1',
        }) as unknown,
      }),
    );
    expect(tx.podListingPayloadItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { payloadId: 'payload-1', sellerSku: 'HAL-S' } }),
    );
    expect(settleItem).toHaveBeenCalledWith(
      expect.objectContaining({ status: PodListingJobItemStatus.SUCCESS, remoteProductId: 'TT-NEW-1' }),
    );
    expect(productSync.scheduleShopSync).toHaveBeenCalledWith(SHOP_A);
  });

  it('shop đích đã có sản phẩm (lượt khác vừa xong) ⇒ SKIPPED, không gọi TikTok', async () => {
    const { service, publisher, settleItem } = buildService({
      skipReasons: { [SHOP_A]: { code: 'ALREADY_CLONED', message: 'Đã nhân bản trước đó' } },
    });

    await runItem(service);

    expect(publisher.publishListing).not.toHaveBeenCalled();
    expect(settleItem).toHaveBeenCalledWith(
      expect.objectContaining({ status: PodListingJobItemStatus.SKIPPED, errorCode: 'CLONE_SKIPPED' }),
    );
  });

  it('payload của cặp (nguồn, đích) đã có sản phẩm trên sàn (item mồ côi) ⇒ SUCCESS, không Create lần hai', async () => {
    const { service, publisher, settleItem } = buildService({ payloadAlreadyOnTiktok: true });

    await runItem(service);

    expect(publisher.publishListing).not.toHaveBeenCalled();
    expect(settleItem).toHaveBeenCalledWith(
      expect.objectContaining({ status: PodListingJobItemStatus.SUCCESS, remoteProductId: 'TT-EXISTING' }),
    );
  });

  it('danh mục không hợp lệ (lỗi giải) ⇒ FAILED với lý do rõ, payload FAILED, không gọi TikTok', async () => {
    const { service, publisher, prisma, settleItem } = buildService({ resolveErrors: true });

    await runItem(service);

    expect(publisher.publishListing).not.toHaveBeenCalled();
    expect(prisma.podListingPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PodListingPayloadStatus.FAILED }) as unknown,
      }),
    );
    expect(settleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PodListingJobItemStatus.FAILED,
        errorCode: 'DRAFT_MISSING_CATEGORY',
        error: expect.stringContaining('Danh mục') as unknown,
      }),
    );
  });

  it('cổng validate chung chặn (thiếu brand) ⇒ FAILED; riêng tồn kho 0 chỉ là cảnh báo', async () => {
    const blocked = buildService({ validationOk: false });
    await runItem(blocked.service);
    expect(blocked.publisher.publishListing).not.toHaveBeenCalled();
    expect(blocked.settleItem).toHaveBeenCalledWith(
      expect.objectContaining({ status: PodListingJobItemStatus.FAILED, errorCode: 'LISTING_MISSING_BRAND' }),
    );

    const stockOnly = buildService();
    await runItem(stockOnly.service);
    expect(stockOnly.publisher.publishListing).toHaveBeenCalled();
  });

  it('TikTok hỏng ⇒ handleItemFailure với jobType CLONE, KHÔNG hẹn đồng bộ, không settle SUCCESS', async () => {
    const { service, handleItemFailure, productSync, settleItem } = buildService({ publishFails: true });

    await runItem(service);

    expect(handleItemFailure).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: PodListingJobType.CLONE, item: ITEM }),
    );
    expect(productSync.scheduleShopSync).not.toHaveBeenCalled();
    expect(settleItem).not.toHaveBeenCalled();
  });
});
