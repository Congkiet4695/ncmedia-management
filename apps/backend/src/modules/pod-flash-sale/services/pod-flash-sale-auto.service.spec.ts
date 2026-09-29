import {
  PodFlashSaleItemStatus,
  PodFlashSaleProductLevel,
  PodFlashSaleStatus,
  Prisma,
} from '@prisma/client';
import { PodFlashSaleAutoService } from './pod-flash-sale-auto.service';
import { toZonedParts } from './pod-flash-sale-auto-schedule';

/**
 * PodFlashSaleAutoService — từng nhánh quyết định của MỘT nút Auto, với database/TikTok giả.
 * Đường đi thật (PostgreSQL, partial unique index, FOR UPDATE) được kiểm ở
 * `test/manual/e2e-flash-sale-auto.manual.ts`.
 */

const D = (v: string | number) => new Prisma.Decimal(v);
const H = 3_600_000;
const NOW = new Date('2026-01-15T13:00:00.000Z'); // 05:00 America/Los_Angeles
const LA = 'America/Los_Angeles';

function node(over: Record<string, unknown> = {}) {
  return {
    id: 'fs-A',
    organizationId: 'org-1',
    accountId: 'acc-1',
    shopId: 'shop-1',
    name: 'Halloween',
    status: PodFlashSaleStatus.RUNNING,
    endAt: new Date('2026-01-16T07:59:00.000Z'), // 15/01 23:59 LA — còn 18h59
    timezone: LA,
    autoMode: true,
    autoChainId: 'fs-A',
    autoSequence: 1,
    deletedAt: null,
    ...over,
  } as never;
}

/** Đợt A với `count` dòng — mỗi dòng một biến thể riêng, % giảm khác nhau theo từng SKU. */
function source(count: number, level: PodFlashSaleProductLevel = PodFlashSaleProductLevel.VARIATION) {
  return {
    id: 'fs-A',
    organizationId: 'org-1',
    accountId: 'acc-1',
    shopId: 'shop-1',
    name: 'Halloween',
    description: null,
    productLevel: level,
    timezone: LA,
    items: Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      productId: `p-${i % 10}`,
      variantId: level === PodFlashSaleProductLevel.PRODUCT ? null : `v-${i}`,
      skuId: `SKU-${i}`,
      originalPrice: D('20'),
      flashSalePrice: D('16'),
      discountPercent: D(20 + (i % 3) * 5),
      currency: 'USD',
      totalPurchaseLimit: -1,
      customerPurchaseLimit: 2,
      providerProductId: `TT-P-${i % 10}`,
      providerVariantId: level === PodFlashSaleProductLevel.PRODUCT ? null : `TT-S-${i}`,
      providerSkuId: `TT-S-${i}`,
      // Kết quả chạy của A: có dòng PUBLISHED, có dòng FAILED — không được chép sang B.
      status: i % 7 === 0 ? PodFlashSaleItemStatus.FAILED : PodFlashSaleItemStatus.PUBLISHED,
      errorCode: i % 7 === 0 ? 'NOT_ACCEPTED_BY_TIKTOK' : null,
      sortOrder: i,
    })),
  };
}

function products(count: number) {
  return Array.from({ length: 10 }, (_, p) => ({
    id: `p-${p}`,
    minPrice: D('30'),
    currency: 'USD',
    tiktokProductId: `TT-P-${p}`,
    variants: Array.from({ length: count }, (_, i) => i)
      .filter((i) => i % 10 === p)
      .map((i) => ({ id: `v-${i}`, salePrice: D('30'), listPrice: null, currency: 'USD', tiktokSkuId: `TT-S-${i}`, sellerSku: `SKU-${i}` })),
  }));
}

function build(opts: { child?: unknown; items?: number; level?: PodFlashSaleProductLevel; childStatusAfter?: PodFlashSaleStatus } = {}) {
  const count = opts.items ?? 45;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ auto_mode: true, deleted_at: null }]),
    podFlashSale: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'fs-B' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    podFlashSaleItem: { createMany: jest.fn() },
  };
  const prisma = {
    podFlashSale: {
      findFirst: jest.fn((args: { where: { autoParentId?: string; name?: string } }) =>
        Promise.resolve(args.where.autoParentId ? (opts.child ?? null) : null),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ status: opts.childStatusAfter ?? PodFlashSaleStatus.RUNNING, lastErrorMessage: null }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    podProduct: { findMany: jest.fn().mockResolvedValue(products(count)) },
    podFlashSaleAutoConfig: { updateMany: jest.fn() },
    $transaction: jest.fn(async (cb: (client: unknown) => Promise<unknown>) => cb(tx)),
  };
  const flashSales = {
    get: jest.fn().mockResolvedValue(source(count, opts.level)),
    writeLog: jest.fn().mockResolvedValue(undefined),
  };
  const publisher = {
    publish: jest.fn().mockResolvedValue({}),
    retry: jest.fn().mockResolvedValue({}),
    whenPublishIdle: jest.fn().mockResolvedValue(undefined),
    describeFailure: jest.fn((e: Error) => ({ code: null, message: e.message, requestId: null })),
  };
  const locks = {
    acquire: jest.fn().mockResolvedValue({ key: 'k', fenceToken: 't' }),
    renew: jest.fn(),
    release: jest.fn(),
  };
  const service = new PodFlashSaleAutoService(prisma as never, flashSales as never, publisher as never, locks as never);
  const createdItems = () =>
    (tx.podFlashSaleItem.createMany.mock.calls as unknown as Array<[{ data: Array<Record<string, unknown>> }]>)[0]?.[0].data ?? [];
  const createdSale = () => (tx.podFlashSale.create.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>)[0]?.[0];
  const transferred = () =>
    (tx.podFlashSale.updateMany.mock.calls as unknown as Array<[{ data: { autoMode?: boolean } }]>).some((c) => c[0].data.autoMode === false);
  return { service, prisma, tx, flashSales, publisher, locks, createdItems, createdSale, transferred };
}

describe('PodFlashSaleAutoService.processNode', () => {
  it('shouldCreateNextFlashSaleWhenLessThan24Hours', async () => {
    const h = build();
    const result = await h.service.processNode(node(), NOW);
    expect(result).toMatchObject({ action: 'CREATED', nextFlashSaleId: 'fs-B' });
    expect(h.createdSale()?.data).toMatchObject({ autoParentId: 'fs-A', autoChainId: 'fs-A', autoSequence: 2, autoMode: false });
  });

  it('shouldNotCreateWhenMoreThan24Hours', async () => {
    const h = build();
    const result = await h.service.processNode(node({ endAt: new Date(NOW.getTime() + 24 * H + 60_000) }), NOW);
    expect(result.action).toBe('NOT_DUE');
    expect(h.tx.podFlashSale.create).not.toHaveBeenCalled();
  });

  it('còn ĐÚNG 24 giờ ⇒ tạo', async () => {
    const h = build();
    const result = await h.service.processNode(node({ endAt: new Date(NOW.getTime() + 24 * H) }), NOW);
    expect(result.action).toBe('CREATED');
  });

  it('shouldNotCreateWhenAutoDisabled', async () => {
    const h = build();
    expect((await h.service.processNode(node({ autoMode: false }), NOW)).action).toBe('SKIPPED');
    expect(h.tx.podFlashSale.create).not.toHaveBeenCalled();
  });

  it('đợt đã huỷ ⇒ không tạo', async () => {
    const h = build();
    expect((await h.service.processNode(node({ status: PodFlashSaleStatus.CANCELLED }), NOW)).action).toBe('SKIPPED');
    expect(h.tx.podFlashSale.create).not.toHaveBeenCalled();
  });

  it('shouldNotCreateDuplicateNextFlashSale — đã có B RUNNING ⇒ chỉ chuyển Auto, không tạo', async () => {
    const h = build({ child: { id: 'fs-B', name: 'B', status: PodFlashSaleStatus.RUNNING } });
    const result = await h.service.processNode(node(), NOW);
    expect(result).toMatchObject({ action: 'TRANSFERRED', nextFlashSaleId: 'fs-B' });
    expect(h.tx.podFlashSale.create).not.toHaveBeenCalled();
    expect(h.publisher.publish).not.toHaveBeenCalled();
  });

  it('shouldNotCreateDuplicateNextFlashSale — tiến trình khác vừa tạo B (khoá hàng thấy đã có) ⇒ bỏ qua', async () => {
    const h = build();
    h.tx.podFlashSale.findFirst.mockResolvedValue({ id: 'fs-B-other' });
    expect((await h.service.processNode(node(), NOW)).action).toBe('SKIPPED');
    expect(h.tx.podFlashSale.create).not.toHaveBeenCalled();
    expect(h.publisher.publish).not.toHaveBeenCalled();
  });

  it('shouldNotCreateDuplicateNextFlashSale — vỡ partial unique auto_parent (P2002) ⇒ bỏ qua, không lỗi', async () => {
    const h = build();
    h.tx.podFlashSale.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: 'pod_flash_sales_auto_parent_live_key' },
      }),
    );
    expect((await h.service.processNode(node(), NOW)).action).toBe('SKIPPED');
    expect(h.publisher.publish).not.toHaveBeenCalled();
  });

  it('shouldCopyAllProducts + shouldCopyAllVariants — 45 dòng (> 20, > 1 trang) chép ĐỦ, kể cả dòng FAILED', async () => {
    const h = build({ items: 45 });
    await h.service.processNode(node(), NOW);
    const rows = h.createdItems();
    expect(rows).toHaveLength(45);
    expect(new Set(rows.map((r) => r.variantId)).size).toBe(45);
    expect(new Set(rows.map((r) => r.productId)).size).toBe(10);
  });

  it('KHÔNG chép kết quả chạy của A (trạng thái, provider_sku_id, lỗi)', async () => {
    const h = build({ items: 14 });
    await h.service.processNode(node(), NOW);
    const rows = h.createdItems();
    expect(rows.every((r) => r.status === PodFlashSaleItemStatus.READY)).toBe(true);
    expect(rows.every((r) => r.providerSkuId === null)).toBe(true);
    expect(rows.every((r) => !('errorCode' in r))).toBe(true);
  });

  it('shouldPreserveDiscountConfiguration — % giảm TỪNG SKU giữ nguyên, giá tính lại trên giá hiện tại', async () => {
    const h = build({ items: 6 });
    await h.service.processNode(node(), NOW);
    const rows = h.createdItems();
    expect(rows.map((r) => String(r.discountPercent))).toEqual(['20', '25', '30', '20', '25', '30']);
    // Giá bán hiện tại 30 (A chụp 20): 30 × (1 − 20%) = 24.
    expect(String(rows[0].originalPrice)).toBe('30');
    expect(String(rows[0].flashSalePrice)).toBe('24');
    expect(rows.every((r) => r.customerPurchaseLimit === 2)).toBe(true);
  });

  it('shouldPreserveProductType — PRODUCT giữ PRODUCT', async () => {
    const h = build({ items: 10, level: PodFlashSaleProductLevel.PRODUCT });
    await h.service.processNode(node(), NOW);
    expect(h.createdSale()?.data.productLevel).toBe(PodFlashSaleProductLevel.PRODUCT);
    expect(h.createdItems().every((r) => r.variantId === null)).toBe(true);
  });

  it('shouldCreateTikTokPromotion — đưa B lên TikTok qua đúng đường Publish, phạm vi hệ thống', async () => {
    const h = build();
    await h.service.processNode(node(), NOW);
    expect(h.publisher.publish).toHaveBeenCalledWith('org-1', null, 'fs-B', { skipInvalidItems: true }, expect.anything());
    expect(h.publisher.whenPublishIdle).toHaveBeenCalledWith('fs-B');
  });

  it('shouldTransferAutoToNextFlashSaleAfterSuccess — A OFF, B ON trong MỘT transaction', async () => {
    const h = build();
    await h.service.processNode(node(), NOW);
    expect(h.transferred()).toBe(true);
    expect(h.tx.podFlashSale.update).toHaveBeenCalledWith({ where: { id: 'fs-B' }, data: { autoMode: true } });
  });

  it('shouldKeepCurrentAutoOnWhenCreationFails — TikTok từ chối ⇒ FAILED, A vẫn ON', async () => {
    const h = build();
    h.publisher.publish.mockRejectedValue(new Error('TikTok từ chối'));
    const result = await h.service.processNode(node(), NOW);
    expect(result.action).toBe('FAILED');
    expect(h.transferred()).toBe(false);
  });

  it('B gửi lô hỏng (FAILED sau lượt chạy) ⇒ FAILED, A vẫn ON', async () => {
    const h = build({ childStatusAfter: PodFlashSaleStatus.FAILED });
    expect((await h.service.processNode(node(), NOW)).action).toBe('FAILED');
    expect(h.transferred()).toBe(false);
  });

  it('shouldNotDuplicateOnRetry — đã có B FAILED ⇒ retry CHÍNH B, không tạo C', async () => {
    const h = build({ child: { id: 'fs-B', name: 'B', status: PodFlashSaleStatus.FAILED } });
    const result = await h.service.processNode(node(), NOW);
    expect(h.publisher.retry).toHaveBeenCalledWith('org-1', null, 'fs-B', { skipInvalidItems: true }, expect.anything());
    expect(h.tx.podFlashSale.create).not.toHaveBeenCalled();
    expect(result.action).toBe('TRANSFERRED');
  });

  it('B đang PUBLISHING ⇒ chờ, không tạo, không chuyển', async () => {
    const h = build({ child: { id: 'fs-B', name: 'B', status: PodFlashSaleStatus.PUBLISHING } });
    expect((await h.service.processNode(node(), NOW)).action).toBe('IN_PROGRESS');
    expect(h.transferred()).toBe(false);
  });

  it('Admin tắt Auto của A trong lúc chờ ⇒ KHÔNG bật B', async () => {
    const h = build();
    h.tx.podFlashSale.updateMany.mockResolvedValue({ count: 0 });
    expect((await h.service.processNode(node(), NOW)).action).toBe('SKIPPED');
    expect(h.tx.podFlashSale.update).not.toHaveBeenCalled();
  });

  it('shouldHandleExpiredFlashSale — vừa hết hạn (B.start vẫn ở tương lai) ⇒ tạo', async () => {
    const h = build();
    const result = await h.service.processNode(node({ endAt: new Date(NOW.getTime() - 5 * 60_000) }), NOW);
    expect(result.action).toBe('CREATED');
  });

  it('shouldHandleExpiredFlashSale — hết hạn lâu (B.start đã qua) ⇒ FAILED, không tạo, A vẫn ON', async () => {
    const h = build();
    const result = await h.service.processNode(node({ endAt: new Date(NOW.getTime() - 2 * H) }), NOW);
    expect(result.action).toBe('FAILED');
    expect(h.tx.podFlashSale.create).not.toHaveBeenCalled();
    expect(h.transferred()).toBe(false);
  });

  it('shouldRespectTimezone — khung giờ B theo múi giờ của đợt sale', async () => {
    const h = build();
    await h.service.processNode(node(), NOW);
    const data = h.createdSale().data as { startAt: Date; endAt: Date };
    const s = toZonedParts(data.startAt, LA);
    const e = toZonedParts(data.endAt, LA);
    expect([s.day, s.hour, s.minute]).toEqual([16, 0, 9]);
    expect([e.day, e.hour, e.minute]).toEqual([19, 0, 8]);
  });
});

describe('PodFlashSaleAutoService.runOrganization', () => {
  it('shouldHandleMultipleChains / shouldHandleMultipleShops — một chuỗi lỗi không chặn chuỗi khác', async () => {
    const h = build();
    h.prisma.podFlashSale.findMany.mockResolvedValueOnce([
      node({ id: 'chain-1', autoChainId: 'chain-1', shopId: 'shop-1' }),
      node({ id: 'chain-2', autoChainId: 'chain-2', shopId: 'shop-2' }),
    ]);
    h.flashSales.get.mockRejectedValueOnce(new Error('shop-1 hỏng')).mockResolvedValue(source(5));
    const result = await h.service.runOrganization('org-1', 'CRON', NOW);
    expect(result).toMatchObject({ checked: 2, failed: 1, created: 1, status: 'PARTIAL' });
    // Mỗi chuỗi đi đúng shop của nó.
    expect(h.flashSales.get).toHaveBeenNthCalledWith(1, 'org-1', 'chain-1', expect.anything());
    expect(h.flashSales.get).toHaveBeenNthCalledWith(2, 'org-1', 'chain-2', expect.anything());
  });

  it('chỉ nạp đợt auto_mode = ON, còn ≤ 24h, của ĐÚNG tổ chức', async () => {
    const h = build();
    await h.service.runOrganization('org-1', 'CRON', NOW);
    const where = (h.prisma.podFlashSale.findMany.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>)[0][0].where;
    expect(where).toMatchObject({ organizationId: 'org-1', autoMode: true, deletedAt: null, endAt: { lte: new Date(NOW.getTime() + 24 * H) } });
  });

  it('shouldHandleConcurrentExecution — lượt khác đang giữ khoá ⇒ không làm gì', async () => {
    const h = build();
    h.locks.acquire.mockResolvedValue(null);
    expect(await h.service.runOrganization('org-1', 'CRON', NOW)).toBeNull();
    expect(h.prisma.podFlashSale.findMany).not.toHaveBeenCalled();
  });

  it('Run Now khi đang bận ⇒ 409 POD_FLASH_SALE_AUTO_BUSY', async () => {
    const h = build();
    h.locks.acquire.mockResolvedValue(null);
    await expect(h.service.runNow('org-1')).rejects.toMatchObject({ response: { code: 'POD_FLASH_SALE_AUTO_BUSY' } });
  });
});
