import { BadRequestException } from '@nestjs/common';
import {
  PodListingJobItemStatus,
  PodListingJobType,
  PodListingPayloadStatus,
  PodListingSessionProductStatus,
  PodListingSessionStatus,
} from '@prisma/client';
import { POD_SCOPE_SYSTEM } from '../../pod-tiktok/services/pod-access-scope.service';
import { PodListingSessionService } from '../../pod-listing-session/services/pod-listing-session.service';
import { PodListingJobService } from './pod-listing-job.service';
import { PodCategoryRuleException, PodImageUploadException } from './pod-listing-publisher.service';

/**
 * **Publish Live TikTok** (Add Custom Listing → đăng thẳng, `save_mode = LISTING`) — bốn luật:
 *  1. Cùng pipeline với Start Listing tới bước Upload ảnh; chỉ lời gọi cuối khác:
 *     `publishListing` (Create LISTING), KHÔNG `publishDraft` — payload đi thẳng PUBLISHED, Draft
 *     Product của session ⇒ PUBLISHED, hẹn đồng bộ shop.
 *  2. Chống trùng: (Draft Product, shop) đã PUBLISHED ⇒ SUCCESS không gọi TikTok; đã có Draft trên
 *     sàn ⇒ Edit LISTING đúng draft đó (không Create lần hai).
 *  3. Validate hỏng ⇒ không gửi; TikTok / ảnh / luật danh mục hỏng ⇒ `handleItemFailure` với
 *     jobType LIVE_LISTING (luật danh mục = lỗi vĩnh viễn, không thử lại).
 *  4. Endpoint publish-live tạo job type LIVE_LISTING; hai cú bấm gần nhau ⇒ khoá session ⇒ 400.
 */

const ORG = 'org-1';
const USER = 'user-1';
const SHOP = 'shop-1';
const ITEM = { id: 'item-1', productId: null, sessionProductId: 'sp-1', shopId: SHOP, payloadId: null, retryCount: 0 };

function buildJobService(options: {
  prior?: { status: PodListingPayloadStatus; tiktokProductId: string | null; tiktokDraftId: string | null } | null;
  validationOk?: boolean;
  publishError?: Error;
} = {}) {
  const tx = {
    podListingPayload: { update: jest.fn().mockResolvedValue({}) },
    podListingPayloadItem: { updateMany: jest.fn().mockResolvedValue({}) },
    podListingSessionProduct: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    podTiktokShop: { findFirst: jest.fn().mockResolvedValue({ id: SHOP, accountId: 'acc-1', name: 'Shop A' }) },
    podListingPayload: { findFirst: jest.fn().mockResolvedValue(options.prior ?? null) },
    podListingJobItem: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((fn: unknown) =>
      typeof fn === 'function' ? (fn as (client: unknown) => unknown)(tx) : Promise.resolve([]),
    ),
  };
  const payloads = {
    generateOne: jest.fn().mockResolvedValue({
      id: 'payload-1',
      created: true,
      errorCount: 0,
      status: PodListingPayloadStatus.READY,
      resolved: { payload: { title: 'Tee', variants: [{ sellerSku: 'TEE-S' }] }, issues: [], payloadHash: 'h' },
    }),
  };
  const validator = {
    validate: jest.fn().mockReturnValue(
      options.validationOk === false
        ? { ok: false, warnings: [], blockers: [{ code: 'LISTING_MISSING_IMAGE', field: 'images', message: 'Thiếu ảnh' }] }
        : { ok: true, warnings: [], blockers: [] },
    ),
  };
  const publisher = {
    shopContext: jest.fn().mockResolvedValue({ accessToken: 't', shopCipher: 'c', shopId: SHOP }),
    publishDraft: jest.fn().mockResolvedValue({ remoteProductId: 'TT-DRAFT', skuIds: [] }),
    publishListing: options.publishError
      ? jest.fn().mockRejectedValue(options.publishError)
      : jest.fn().mockResolvedValue({
          remoteProductId: 'TT-LIVE-1',
          skuIds: [{ sellerSku: 'TEE-S', tiktokSkuId: 'TT-SKU-1' }],
          auditStatus: 'AUDITING',
          mode: 'CREATE',
          request: {},
          response: {},
          tiktokRequestId: 'req-1',
        }),
  };
  const productSync = { scheduleShopSync: jest.fn().mockResolvedValue(new Date()) };
  const settleItem = jest.fn().mockResolvedValue(undefined);
  const handleItemFailure = jest.fn().mockResolvedValue(undefined);
  const service = Object.create(PodListingJobService.prototype) as PodListingJobService;
  Object.assign(service, {
    prisma,
    payloads,
    validator,
    publisher,
    productSync,
    settleItem,
    handleItemFailure,
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    itemLogger: () => jest.fn().mockResolvedValue(undefined),
  });
  const run = (live = true) =>
    (service as unknown as { processCreateDraftItem(params: unknown): Promise<void> }).processCreateDraftItem({
      organizationId: ORG,
      jobId: 'job-1',
      userId: USER,
      item: ITEM,
      template: { id: 'lt-1' },
      imageTemplateId: null,
      maxRetries: 3,
      shopContexts: new Map(),
      imageUriCache: new Map(),
      live,
    });
  return { service, run, prisma, tx, payloads, publisher, productSync, settleItem, handleItemFailure };
}

describe('PodListingJobService.processCreateDraftItem — Publish Live', () => {
  it('success: Create Product LISTING (không draft id) ⇒ payload PUBLISHED + Draft Product PUBLISHED + item SUCCESS + hẹn sync', async () => {
    const { run, publisher, tx, settleItem, productSync } = buildJobService();

    await run();

    expect(publisher.publishDraft).not.toHaveBeenCalled();
    expect(publisher.publishListing).toHaveBeenCalledWith(expect.objectContaining({ tiktokDraftId: null }));
    expect(tx.podListingPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payload-1' },
        data: expect.objectContaining({
          status: PodListingPayloadStatus.PUBLISHED,
          tiktokProductId: 'TT-LIVE-1',
          tiktokDraftId: 'TT-LIVE-1',
        }) as unknown,
      }),
    );
    expect(tx.podListingPayloadItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { payloadId: 'payload-1', sellerSku: 'TEE-S' }, data: { tiktokSkuId: 'TT-SKU-1' } }),
    );
    expect(tx.podListingSessionProduct.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sp-1' }, data: expect.objectContaining({ status: PodListingSessionProductStatus.PUBLISHED }) as unknown }),
    );
    expect(settleItem).toHaveBeenCalledWith(expect.objectContaining({ status: PodListingJobItemStatus.SUCCESS, remoteProductId: 'TT-LIVE-1' }));
    expect(productSync.scheduleShopSync).toHaveBeenCalledWith(SHOP);
  });

  it('live = false (Start Listing) ⇒ vẫn đi publishDraft như trước, không hẹn sync', async () => {
    const { run, publisher, productSync } = buildJobService();
    await run(false);
    expect(publisher.publishDraft).toHaveBeenCalled();
    expect(publisher.publishListing).not.toHaveBeenCalled();
    expect(productSync.scheduleShopSync).not.toHaveBeenCalled();
  });

  it('duplicate click / chạy lại: (Draft Product, shop) đã PUBLISHED ⇒ SUCCESS ngay, không sinh payload, không gọi TikTok', async () => {
    const { run, payloads, publisher, settleItem } = buildJobService({
      prior: { status: PodListingPayloadStatus.PUBLISHED, tiktokProductId: 'TT-OLD', tiktokDraftId: 'TT-OLD' },
    });

    await run();

    expect(payloads.generateOne).not.toHaveBeenCalled();
    expect(publisher.publishListing).not.toHaveBeenCalled();
    expect(settleItem).toHaveBeenCalledWith(expect.objectContaining({ status: PodListingJobItemStatus.SUCCESS, remoteProductId: 'TT-OLD' }));
  });

  it('đã có Draft trên sàn (Start Listing trước đó) ⇒ Edit Product LISTING đúng draft đó, KHÔNG Create sản phẩm thứ hai', async () => {
    const { run, publisher } = buildJobService({
      prior: { status: PodListingPayloadStatus.TIKTOK_DRAFT, tiktokProductId: 'TT-DRAFT-9', tiktokDraftId: null },
    });

    await run();

    expect(publisher.publishListing).toHaveBeenCalledWith(expect.objectContaining({ tiktokDraftId: 'TT-DRAFT-9' }));
  });

  it('validation failed ⇒ SKIPPED với mã blocker, không gọi TikTok', async () => {
    const { run, publisher, settleItem } = buildJobService({ validationOk: false });
    await run();
    expect(publisher.publishListing).not.toHaveBeenCalled();
    expect(settleItem).toHaveBeenCalledWith(expect.objectContaining({ status: PodListingJobItemStatus.SKIPPED, errorCode: 'LISTING_MISSING_IMAGE' }));
  });

  it.each([
    ['TikTok API failed', new Error('TikTok 500')],
    ['image upload failed', new PodImageUploadException('ảnh sản phẩm "Tee" (#1)', 'MAIN_IMAGE', new Error('bad image'))],
    ['size chart / luật danh mục', new PodCategoryRuleException('Danh mục Tee bắt buộc có bảng size')],
  ])('%s ⇒ handleItemFailure với jobType LIVE_LISTING, không settle SUCCESS, không hẹn sync', async (_name, error) => {
    const { run, handleItemFailure, settleItem, productSync } = buildJobService({ publishError: error });
    await run();
    expect(handleItemFailure).toHaveBeenCalledWith(expect.objectContaining({ jobType: PodListingJobType.LIVE_LISTING, error }));
    expect(settleItem).not.toHaveBeenCalled();
    expect(productSync.scheduleShopSync).not.toHaveBeenCalled();
  });
});

describe('PodListingJobService.handleItemFailure — luật danh mục là lỗi vĩnh viễn', () => {
  it('PodCategoryRuleException ⇒ FAILED ngay với thông điệp rõ (không RETRYING)', async () => {
    const prisma = {
      podListingJobItem: { update: jest.fn().mockResolvedValue({}) },
      podListingPayload: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      podListingSessionProduct: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const settleItem = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(PodListingJobService.prototype) as PodListingJobService;
    Object.assign(service, { prisma, settleItem, logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } });

    await (service as unknown as { handleItemFailure(params: unknown): Promise<void> }).handleItemFailure({
      organizationId: ORG,
      jobId: 'job-1',
      jobType: PodListingJobType.LIVE_LISTING,
      item: ITEM,
      error: new PodCategoryRuleException('Danh mục Tee bắt buộc có bảng size (size chart)'),
      maxRetries: 3,
      durationMs: 5,
      log: jest.fn().mockResolvedValue(undefined),
    });

    expect(prisma.podListingJobItem.update).not.toHaveBeenCalled();
    expect(settleItem).toHaveBeenCalledWith(
      expect.objectContaining({ status: PodListingJobItemStatus.FAILED, error: expect.stringContaining('bảng size') as unknown }),
    );
  });
});

describe('PodListingJobService.createFromSession — type', () => {
  function build() {
    const created: Array<Record<string, unknown>> = [];
    const logs: Array<Record<string, unknown>> = [];
    const tx = {
      podListingJob: { create: jest.fn((args: { data: Record<string, unknown> }) => { created.push(args.data); return Promise.resolve({ id: 'job-1' }); }) },
      podListingJobItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      podListingLog: { create: jest.fn((args: { data: Record<string, unknown> }) => { logs.push(args.data); return Promise.resolve({}); }) },
    };
    const service = Object.create(PodListingJobService.prototype) as PodListingJobService;
    Object.assign(service, {
      prisma: { $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)) },
      runInBackground: jest.fn(),
      get: jest.fn().mockResolvedValue({ id: 'job-1' }),
    });
    return { service, created, logs };
  }

  it('không truyền type ⇒ CREATE_DRAFT (Start Listing như cũ)', async () => {
    const { service, created, logs } = build();
    await service.createFromSession(ORG, USER, { sessionId: 's-1', name: 'Lô', market: 'US', targets: [{ sessionProductId: 'sp-1', shopId: SHOP }], products: 1 });
    expect(created[0].type).toBe(PodListingJobType.CREATE_DRAFT);
    expect(String(logs[0].message)).toContain('Start Listing');
  });

  it('type LIVE_LISTING ⇒ job LIVE_LISTING, log ghi saveMode LISTING', async () => {
    const { service, created, logs } = build();
    await service.createFromSession(ORG, USER, { sessionId: 's-1', name: 'Lô', market: 'US', targets: [{ sessionProductId: 'sp-1', shopId: SHOP }], products: 1, type: PodListingJobType.LIVE_LISTING });
    expect(created[0].type).toBe(PodListingJobType.LIVE_LISTING);
    expect(String(logs[0].message)).toContain('Publish Live');
    expect(logs[0].payload).toMatchObject({ saveMode: 'LISTING' });
  });
});

describe('PodListingSessionService.startListing — Publish Live', () => {
  function build(options: { lockBusy?: boolean; status?: PodListingSessionStatus } = {}) {
    const session = {
      id: 's-1',
      organizationId: ORG,
      name: 'Lô',
      market: 'US',
      status: options.status ?? PodListingSessionStatus.READY,
      shops: [{ shopId: SHOP, shop: { id: SHOP, name: 'Shop A', region: 'US' } }],
      templates: [],
    };
    const prisma = {
      podListingSession: { findFirst: jest.fn().mockResolvedValue(session), update: jest.fn().mockResolvedValue(session) },
      podListingSessionProduct: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const jobs = { createFromSession: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const lock = {
      withLock: jest.fn((_key: string, _ttl: number, task: () => Promise<unknown>) => (options.lockBusy ? Promise.resolve(null) : task())),
    };
    const service = Object.create(PodListingSessionService.prototype) as PodListingSessionService;
    Object.assign(service, {
      prisma,
      jobs,
      lock,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      accessScope: { assertShopAllowed: jest.fn() },
      get: jest.fn().mockResolvedValue(session),
      validate: jest.fn().mockResolvedValue({ ok: true, issues: [], readyProducts: 1, products: [{ id: 'sp-1', ok: true, issues: [] }] }),
    });
    return { service, jobs, lock };
  }

  it('saveMode LISTING ⇒ createFromSession với type LIVE_LISTING; mặc định ⇒ CREATE_DRAFT', async () => {
    const { service, jobs } = build();
    await service.startListing(ORG, USER, 's-1', {}, POD_SCOPE_SYSTEM, 'LISTING');
    expect(jobs.createFromSession).toHaveBeenCalledWith(ORG, USER, expect.objectContaining({ type: PodListingJobType.LIVE_LISTING }));

    await service.startListing(ORG, USER, 's-1', {}, POD_SCOPE_SYSTEM);
    expect(jobs.createFromSession).toHaveBeenLastCalledWith(ORG, USER, expect.objectContaining({ type: PodListingJobType.CREATE_DRAFT }));
  });

  it('duplicate click: khoá session đang giữ ⇒ 400, không tạo job', async () => {
    const { service, jobs, lock } = build({ lockBusy: true });
    await expect(service.startListing(ORG, USER, 's-1', {}, POD_SCOPE_SYSTEM, 'LISTING')).rejects.toBeInstanceOf(BadRequestException);
    expect(lock.withLock).toHaveBeenCalledWith('pod:session-start:s-1', expect.any(Number), expect.any(Function));
    expect(jobs.createFromSession).not.toHaveBeenCalled();
  });

  it('session đang LISTING ⇒ 400 POD_SESSION_ALREADY_LISTING', async () => {
    const { service, jobs } = build({ status: PodListingSessionStatus.LISTING });
    await expect(service.startListing(ORG, USER, 's-1', {}, POD_SCOPE_SYSTEM, 'LISTING')).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.createFromSession).not.toHaveBeenCalled();
  });
});
