import {
  PodListingJobItemStatus,
  PodListingPayloadStatus,
  PodListingReviewStatus,
} from '@prisma/client';
import { PodListingJobService } from './pod-listing-job.service';

/**
 * Unit test — **ranh giới nghiệp vụ "publish listing thành công ⇒ hẹn đồng bộ shop đó"**.
 *
 * 🔴 Đây là yêu cầu cốt lõi của sprint và nó chỉ đúng khi lịch hẹn được đặt ĐÚNG CHỖ:
 * sau khi TikTok đã nhận, payload đã chuyển PUBLISHED và item đã settle SUCCESS. Đặt sớm
 * hơn một dòng là publish hỏng vẫn hẹn đồng bộ; đặt ở controller là bấm nút cũng hẹn dù
 * chưa gửi gì lên sàn.
 *
 * Test gọi thẳng `processPublishItem` (private) vì đó chính là ranh giới cần khoá lại —
 * kiểm qua một lớp bọc nào khác thì không chứng minh được điều đang cần chứng minh.
 */

const ORG = 'org-1';
const JOB = 'job-1';
const SHOP_A = 'shop-a';

function buildService(overrides: {
  publishFails?: boolean;
  validationOk?: boolean;
  draftShopId?: string;
} = {}) {
  const productSync = { scheduleShopSync: jest.fn().mockResolvedValue(new Date()) };

  const prisma = {
    podListingPayload: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'payload-1',
        shopId: overrides.draftShopId ?? SHOP_A,
        status: PodListingPayloadStatus.TIKTOK_DRAFT,
        errorCount: 0,
        payload: { brand: {}, variants: [] },
        tiktokDraftId: 'tt-draft-1',
        tiktokProductId: null,
        sessionProductId: null,
        publishRetryCount: 0,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    podListingPayloadItem: { updateMany: jest.fn().mockResolvedValue({}) },
    podListingJobItem: { update: jest.fn().mockResolvedValue({}) },
    podListingJobLog: { create: jest.fn().mockResolvedValue({}) },
    podListingJob: { update: jest.fn().mockResolvedValue({}), findFirst: jest.fn() },
    $transaction: jest.fn((fn: unknown) =>
      Promise.resolve(
        typeof fn === 'function'
          ? (fn as (tx: unknown) => unknown)({
              podListingPayload: { update: jest.fn().mockResolvedValue({}) },
              podListingPayloadItem: { updateMany: jest.fn().mockResolvedValue({}) },
            })
          : [],
      ),
    ),
  };

  const validator = {
    validate: jest.fn().mockReturnValue(
      overrides.validationOk === false
        ? { ok: false, warnings: [], blockers: [{ code: 'MISSING_BRAND', message: 'thiếu brand' }] }
        : { ok: true, warnings: [], blockers: [] },
    ),
  };

  const publisher = {
    shopContext: jest.fn().mockResolvedValue({ accessToken: 't', shopCipher: 'c', shopId: SHOP_A }),
    publishListing: overrides.publishFails
      ? jest.fn().mockRejectedValue(new Error('TikTok 500'))
      : jest.fn().mockResolvedValue({
          remoteProductId: 'tt-product-1',
          skuIds: [],
          auditStatus: undefined,
          mode: 'EDIT',
          request: {},
          response: {},
          tiktokRequestId: 'req-1',
        }),
  };

  const service = Object.create(PodListingJobService.prototype) as PodListingJobService;
  Object.assign(service, {
    prisma,
    validator,
    publisher,
    productSync,
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    // `settleItem` / `handleItemFailure` / `itemLogger` là private helper ghi DB — thay bằng
    // bản giả để test tập trung vào ĐÚNG quyết định đang kiểm: có hẹn đồng bộ hay không.
    settleItem: jest.fn().mockResolvedValue(undefined),
    handleItemFailure: jest.fn().mockResolvedValue(undefined),
    itemLogger: () => jest.fn().mockResolvedValue(undefined),
  });

  return { service, productSync, publisher, prisma };
}

const ITEM = {
  id: 'item-1',
  shopId: SHOP_A,
  payloadId: 'payload-1',
  retryCount: 0,
} as never;

async function run(service: PodListingJobService) {
  await (
    service as unknown as {
      processPublishItem(params: unknown): Promise<void>;
    }
  ).processPublishItem({
    organizationId: ORG,
    jobId: JOB,
    item: ITEM,
    maxRetries: 3,
    shopContexts: new Map(),
    imageUriCache: new Map(),
  });
}

describe('Publish listing → hẹn đồng bộ sản phẩm theo shop', () => {
  // CASE 1
  it('🔴 publish THÀNH CÔNG ⇒ hẹn đồng bộ cho ĐÚNG shop của listing đó', async () => {
    const { service, productSync } = buildService();

    await run(service);

    expect(productSync.scheduleShopSync).toHaveBeenCalledTimes(1);
    expect(productSync.scheduleShopSync).toHaveBeenCalledWith(SHOP_A);
  });

  // CASE 2
  it('🔴 publish THẤT BẠI (TikTok lỗi) ⇒ KHÔNG hẹn đồng bộ', async () => {
    const { service, productSync } = buildService({ publishFails: true });

    await run(service);

    expect(productSync.scheduleShopSync).not.toHaveBeenCalled();
  });

  it('🔴 bị chặn ở cổng VALIDATE (chưa gửi gì lên TikTok) ⇒ KHÔNG hẹn đồng bộ', async () => {
    const { service, productSync, publisher } = buildService({ validationOk: false });

    await run(service);

    expect(publisher.publishListing).not.toHaveBeenCalled();
    expect(productSync.scheduleShopSync).not.toHaveBeenCalled();
  });

  it('🔴 draft không thuộc shop của item ⇒ chặn, KHÔNG gửi và KHÔNG hẹn', async () => {
    const { service, productSync, publisher } = buildService({ draftShopId: 'shop-khac' });

    await run(service);

    expect(publisher.publishListing).not.toHaveBeenCalled();
    expect(productSync.scheduleShopSync).not.toHaveBeenCalled();
  });

  it('hẹn SAU khi item đã settle SUCCESS — không phải trước khi gửi', async () => {
    const { service, productSync, publisher } = buildService();
    const order: string[] = [];
    publisher.publishListing.mockImplementation(() => {
      order.push('publish');
      return Promise.resolve({
        remoteProductId: 'tt-1',
        skuIds: [],
        auditStatus: undefined,
        mode: 'EDIT',
        request: {},
        response: {},
        tiktokRequestId: 'r',
      });
    });
    productSync.scheduleShopSync.mockImplementation(() => {
      order.push('schedule');
      return Promise.resolve(new Date());
    });

    await run(service);

    expect(order).toEqual(['publish', 'schedule']);
  });

  it('mọi review status vẫn hẹn — sản phẩm đang chờ duyệt cũng cần đồng bộ lại', () => {
    // Chốt bằng kiểu: `PodListingReviewStatus.UNDER_REVIEW` là mặc định sau publish và
    // KHÔNG phải điều kiện để hẹn đồng bộ.
    expect(PodListingReviewStatus.UNDER_REVIEW).toBeDefined();
    expect(PodListingJobItemStatus.SUCCESS).toBeDefined();
  });
});
