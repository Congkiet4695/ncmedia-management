import {
  PodFlashSaleItemStatus,
  PodFlashSaleProductLevel,
  PodFlashSaleStatus,
  Prisma,
} from '@prisma/client';
import { TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL } from '../../tiktok-sdk/tiktok-sdk.constants';
import type { FlashSaleDetailRow } from '../mappers/pod-flash-sale.mapper';
import { PodFlashSalePublisherService } from './pod-flash-sale-publisher.service';

/**
 * **Lượt publish chạy nền** — bốn điều sai một cái là hỏng cả nghiệp vụ:
 *
 * 1. 10.000 SKU ⇒ 34 request, và **TẤT CẢ vào CÙNG MỘT `activity_id`**. Tạo hoạt động thứ
 *    hai nghĩa là shop có hai khuyến mãi rời rạc cho một chiến dịch.
 * 2. Không request nào mang quá 300 SKU.
 * 3. Lô hỏng ⇒ đợt sale **KHÔNG** được `RUNNING`, và phải biết hỏng ở lô nào.
 * 4. Bấm Publish hai lần ⇒ **KHÔNG** có hoạt động thứ hai.
 *
 * Mức `VARIATION` còn phải tính giá deal ĐỘC LẬP cho từng SKU — đó là lý do nó là mặc định.
 */

const D = (value: string | number) => new Prisma.Decimal(value);
const SCOPE = { allShops: true, accountIds: [], shopIds: [] };

function buildItem(over: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    productId: 'p-1',
    variantId: 'v-1',
    skuId: 'SELLER-SKU-1',
    originalPrice: D('10.00'),
    flashSalePrice: D('7.00'),
    discountPercent: D('30'),
    currency: 'USD',
    totalPurchaseLimit: -1,
    customerPurchaseLimit: -1,
    providerProductId: 'TT-P-1',
    providerVariantId: 'TT-SKU-1',
    providerSkuId: null,
    status: PodFlashSaleItemStatus.READY,
    sortOrder: 0,
    product: { id: 'p-1', title: 'Tee', tiktokProductId: 'TT-P-1', images: [] },
    variant: {
      id: 'v-1',
      variantName: 'Black / M',
      sellerSku: 'SELLER-SKU-1',
      tiktokSkuId: 'TT-SKU-1',
      imageUrl: null,
    },
    ...over,
  };
}

/** `count` dòng, mỗi dòng một SKU riêng của một sản phẩm riêng. */
function buildItems(count: number, over: (index: number) => Record<string, unknown> = () => ({})) {
  return Array.from({ length: count }, (_, index) =>
    buildItem({
      id: `item-${index}`,
      productId: `p-${index}`,
      variantId: `v-${index}`,
      providerProductId: `TT-P-${index}`,
      providerVariantId: `TT-SKU-${index}`,
      sortOrder: index,
      ...over(index),
    }),
  );
}

function buildFlashSale(over: Record<string, unknown> = {}): FlashSaleDetailRow {
  return {
    id: 'fs-1',
    organizationId: 'org-1',
    accountId: 'acc-1',
    shopId: 'shop-1',
    provider: 'TIKTOK',
    providerFlashSaleId: null,
    name: 'Flash Sale 12.12',
    description: null,
    status: PodFlashSaleStatus.READY,
    productLevel: PodFlashSaleProductLevel.VARIATION,
    startAt: new Date('2026-09-01T01:00:00.000Z'),
    endAt: new Date('2026-09-01T07:00:00.000Z'),
    timezone: 'UTC',
    itemCount: 1,
    retryCount: 0,
    items: [buildItem()],
    ...over,
  } as unknown as FlashSaleDetailRow;
}

interface SkuPayload {
  id: string;
  activityPriceAmount?: string;
  quantityLimit?: number;
  quantityPerUser?: number;
}
interface ProductPayload {
  id: string;
  activityPriceAmount?: string;
  quantityLimit?: number;
  quantityPerUser?: number;
  skus: SkuPayload[];
}

function buildService(flashSale: FlashSaleDetailRow = buildFlashSale()) {
  const promotionApi = {
    createActivity: jest
      .fn()
      .mockResolvedValue({ data: { activityId: 'TT-ACT-1', status: 'DRAFT' }, requestId: 'r1' }),
    updateActivity: jest.fn().mockResolvedValue({ data: {}, requestId: 'r2' }),
    updateActivityProducts: jest.fn().mockResolvedValue({ data: { products: [] }, requestId: 'r3' }),
    deactivateActivity: jest.fn(),
    getActivity: jest.fn(),
  };

  const tx = {
    podFlashSale: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    podFlashSaleItem: { updateMany: jest.fn(), update: jest.fn() },
  };

  const prisma = {
    podFlashSale: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    podFlashSaleItem: { updateMany: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  };

  const flashSales = {
    get: jest.fn().mockResolvedValue(flashSale),
    validateRow: jest.fn().mockReturnValue({ flashSaleId: 'fs-1', ok: true, issues: [], readyItems: 1 }),
    writeLog: jest.fn().mockResolvedValue(undefined),
    refreshItemCount: jest.fn().mockResolvedValue(0),
  };

  const shopContext = {
    resolve: jest.fn().mockResolvedValue({
      accessToken: 'token',
      shopCipher: 'cipher',
      shopId: 'shop-1',
      organizationId: 'org-1',
    }),
  };

  const locks = {
    acquire: jest.fn().mockResolvedValue({ key: 'lock', fenceToken: 'tk' }),
    release: jest.fn().mockResolvedValue(undefined),
    renew: jest.fn().mockResolvedValue(true),
  };

  // Get Product — chỉ được gọi khi một lô bị TikTok từ chối (kiểm chứng sản phẩm/SKU của lô đó).
  const productApi = { getProduct: jest.fn() };

  const service = new PodFlashSalePublisherService(
    prisma as never,
    flashSales as never,
    promotionApi as never,
    shopContext as never,
    locks as never,
    productApi as never,
  );

  const publishAndSettle = async () => {
    const result = await service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE);
    await service.whenPublishIdle();
    return result;
  };

  /** Mọi lời gọi Update Activity Products: `[activityId, products]`. */
  const calls = (): Array<{ activityId: string; products: ProductPayload[] }> =>
    (promotionApi.updateActivityProducts.mock.calls as unknown as Array<[unknown, string, ProductPayload[]]>).map(
      ([, activityId, products]) => ({ activityId, products }),
    );

  /** Mọi `data` đã ghi vào đợt sale — qua `update`, `updateMany` và trong transaction. */
  const writes = (): Array<Record<string, unknown>> => [
    ...(prisma.podFlashSale.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>).map((c) => c[0].data),
    ...(prisma.podFlashSale.updateMany.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>).map((c) => c[0].data),
    ...(tx.podFlashSale.updateMany.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>).map((c) => c[0].data),
  ];

  type ItemWrite = [{ where: { id: { in: string[] } }; data: { status: string; errorCode?: string; error?: string; publishBatch?: number } }];
  const itemWrites = () => tx.podFlashSaleItem.updateMany.mock.calls as unknown as ItemWrite[];

  /** Id các dòng đã được đánh dấu PUBLISHED. */
  const publishedItemIds = (): string[] =>
    itemWrites()
      .filter((c) => c[0].data.status === PodFlashSaleItemStatus.PUBLISHED)
      .flatMap((c) => c[0].where.id.in);

  /** Dòng đã bị đánh FAILED: id ⇒ { errorCode, error, publishBatch }. */
  const failedItems = (): Map<string, { errorCode?: string; error?: string; publishBatch?: number }> =>
    new Map(
      itemWrites()
        .filter((c) => c[0].data.status === PodFlashSaleItemStatus.FAILED)
        .flatMap((c) => c[0].where.id.in.map((id) => [id, c[0].data] as const)),
    );

  /** Kết quả lô ghi lần CUỐI (`publishBatchResults`). */
  const batchResults = (): Array<{ batch: number; status: string; succeeded: number; failed: number; errorCode: string | null }> =>
    (writes().filter((row) => Array.isArray(row.publishBatchResults)).at(-1)?.publishBatchResults ?? []) as never;

  return {
    service,
    prisma,
    tx,
    promotionApi,
    productApi,
    flashSales,
    locks,
    publishAndSettle,
    calls,
    writes,
    publishedItemIds,
    failedItems,
    batchResults,
  };
}

// ---------------------------------------------------------------------------
// MỘT khuyến mãi — nhiều lô
// ---------------------------------------------------------------------------

describe('Một Flash Sale, nhiều lô, MỘT activity_id', () => {
  it('🔴 10.000 SKU ⇒ 34 request, tất cả vào CÙNG MỘT activity_id, mỗi request ≤ 300 SKU', async () => {
    const { publishAndSettle, calls, promotionApi } = buildService(
      buildFlashSale({ items: buildItems(10_000), itemCount: 10_000 }),
    );

    const result = await publishAndSettle();

    // MỘT hoạt động khuyến mãi được tạo. Không phải 34.
    expect(promotionApi.createActivity).toHaveBeenCalledTimes(1);

    const sent = calls();
    expect(sent).toHaveLength(34);
    expect(result.totalBatches).toBe(34);
    expect(result.totalItems).toBe(10_000);

    // 🔴 Điều quan trọng nhất của cả sprint: MỘT id duy nhất trên toàn bộ 34 request.
    expect(new Set(sent.map((call) => call.activityId))).toEqual(new Set(['TT-ACT-1']));

    // 🔴 Và không request nào vượt trần của TikTok.
    for (const call of sent) {
      const skus = call.products.reduce((sum, p) => sum + Math.max(p.skus.length, 1), 0);
      expect(skus).toBeLessThanOrEqual(TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL);
    }

    // Đủ 10.000 dòng, không mất không lặp.
    const allSkuIds = sent.flatMap((call) => call.products.flatMap((p) => p.skus.map((s) => s.id)));
    expect(allSkuIds).toHaveLength(10_000);
    expect(new Set(allSkuIds).size).toBe(10_000);
  });

  it('1.000 SKU ⇒ 4 request trên cùng một hoạt động', async () => {
    const { publishAndSettle, calls, promotionApi } = buildService(
      buildFlashSale({ items: buildItems(1_000), itemCount: 1_000 }),
    );

    const result = await publishAndSettle();

    expect(promotionApi.createActivity).toHaveBeenCalledTimes(1);
    expect(calls()).toHaveLength(4);
    expect(result.totalBatches).toBe(4);
    expect(new Set(calls().map((c) => c.activityId))).toEqual(new Set(['TT-ACT-1']));
  });

  it('🔴 request HTTP KHÔNG chờ hết các lô — trả về PUBLISHING kèm activity_id', async () => {
    const { service, promotionApi } = buildService(
      buildFlashSale({ items: buildItems(3_000), itemCount: 3_000 }),
    );

    const result = await service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE);

    // Đây là điểm mấu chốt của phần timeout: tại thời điểm response, mới chỉ có lượt tạo
    // hoạt động chạy xong. 10 lô còn lại chưa gửi.
    expect(result.status).toBe(PodFlashSaleStatus.PUBLISHING);
    expect(result.providerFlashSaleId).toBe('TT-ACT-1');
    expect(promotionApi.updateActivityProducts).not.toHaveBeenCalled();

    await service.whenPublishIdle();
    expect(promotionApi.updateActivityProducts).toHaveBeenCalledTimes(10);
  });

  it('tiến độ được ghi sau TỪNG lô, không phải một lần ở cuối', async () => {
    const { publishAndSettle, writes } = buildService(
      buildFlashSale({ items: buildItems(900), itemCount: 900 }),
    );

    await publishAndSettle();

    const done = writes()
      .map((data) => data.publishDoneBatches)
      .filter((value): value is number => typeof value === 'number');
    // 0 (lúc giành lượt) rồi 1, 2, 3 sau từng lô.
    expect(done).toEqual([0, 1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Giá theo từng SKU
// ---------------------------------------------------------------------------

describe('Per Variant — giá deal tính ĐỘC LẬP cho từng SKU', () => {
  it('🔴 giảm 30%: $10 → 7.00, $12 → 8.40, $15 → 10.50, $20 → 14.00 trong CÙNG một payload', async () => {
    // Ví dụ nguyên văn của yêu cầu. Đây là lý do `VARIATION` là mặc định: mức `PRODUCT` chỉ
    // có MỘT ô giá cho cả sản phẩm, nên bốn SKU khác giá không thể có bốn giá deal khác nhau.
    const prices: Array<[string, string]> = [
      ['10.00', '7.00'],
      ['12.00', '8.40'],
      ['15.00', '10.50'],
      ['20.00', '14.00'],
    ];
    const items = prices.map(([retail, deal], index) =>
      buildItem({
        id: `item-${index}`,
        productId: 'p-1',
        variantId: `v-${index}`,
        providerProductId: 'TT-P-1',
        providerVariantId: `TT-SKU-${index}`,
        originalPrice: D(retail),
        flashSalePrice: D(deal),
        discountPercent: D('30'),
        sortOrder: index,
      }),
    );

    const { publishAndSettle, calls } = buildService(buildFlashSale({ items, itemCount: 4 }));
    await publishAndSettle();

    const [product] = calls()[0].products;
    expect(product.skus.map((sku) => sku.activityPriceAmount)).toEqual([
      '7.00',
      '8.40',
      '10.50',
      '14.00',
    ]);
    // 🔴 Mức SPU bắt buộc là -1 ở chế độ VARIATION — TikTok từ chối cả request nếu khác.
    expect(product.quantityLimit).toBe(-1);
    expect(product.quantityPerUser).toBe(-1);
    expect(product.activityPriceAmount).toBeUndefined();
  });

  it('🔴 Per Product giữ nguyên nghĩa cũ: giá ở SPU, `skus` rỗng — KHÔNG bung thành giá từng SKU', async () => {
    const { publishAndSettle, calls } = buildService(
      buildFlashSale({
        productLevel: PodFlashSaleProductLevel.PRODUCT,
        items: [buildItem({ variantId: null, providerVariantId: null, flashSalePrice: D('7.00') })],
      }),
    );

    await publishAndSettle();

    expect(calls()[0].products).toEqual([
      {
        id: 'TT-P-1',
        activityPriceAmount: '7.00',
        quantityLimit: -1,
        quantityPerUser: -1,
        skus: [],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Thất bại một phần
// ---------------------------------------------------------------------------

describe('Thất bại một phần', () => {
  it('🔴 lô 2 hỏng ⇒ lô 3 VẪN được gửi; đợt RUNNING kèm PUBLISH_PARTIAL; biết lô nào hỏng, mã lỗi TikTok', async () => {
    const { publishAndSettle, promotionApi, productApi, writes, batchResults } = buildService(
      buildFlashSale({ items: buildItems(900), itemCount: 900 }),
    );
    promotionApi.updateActivityProducts
      .mockResolvedValueOnce({ data: { products: [] }, requestId: 'r-1' })
      .mockRejectedValueOnce(
        new TiktokClientError(TiktokErrorClass.BUSINESS, 12345, 'SKU không hợp lệ', 400, 'req-x'),
      )
      .mockResolvedValue({ data: { products: [] }, requestId: 'r-3' });
    // Get Product không chỉ ra mục nào sai ⇒ không tách được ⇒ cả lô 2 FAILED; hoạt động vẫn mở.
    productApi.getProduct.mockImplementation((_ctx: unknown, id: string) =>
      Promise.resolve({ data: { status: 'ACTIVATE', skus: [{ id: id.replace('TT-P-', 'TT-SKU-') }] } }),
    );
    promotionApi.getActivity.mockResolvedValue({ data: { status: 'NOT_START', products: [] }, requestId: 'g' });

    await publishAndSettle();

    // Lô 3 VẪN được gửi — một lô hỏng không chặn phần còn lại.
    expect(promotionApi.updateActivityProducts).toHaveBeenCalledTimes(3);
    expect(batchResults().map((r) => r.status)).toEqual(['SUCCEEDED', 'FAILED', 'SUCCEEDED']);

    // Lần ghi CHỐT lượt: mang trạng thái + mốc kết thúc.
    const final = writes().find((w) => w.status !== undefined && w.publishFinishedAt instanceof Date) as Record<string, unknown>;
    expect(final.status).toBe(PodFlashSaleStatus.RUNNING);
    expect(final.lastErrorCode).toBe('PUBLISH_PARTIAL');
    expect(final.publishFailedBatch).toBe(2);
    expect(final.lastErrorRequestId).toBe('req-x');
    expect(String(final.lastErrorMessage)).toContain('12345');
  });

  it('🔴 lô 1 thành công vẫn được đánh dấu PUBLISHED dù lô 2 hỏng — nền tảng của việc chạy lại', async () => {
    const { publishAndSettle, promotionApi, publishedItemIds } = buildService(
      buildFlashSale({ items: buildItems(600), itemCount: 600 }),
    );
    promotionApi.updateActivityProducts
      .mockResolvedValueOnce({ data: { products: [] }, requestId: 'r-1' })
      .mockRejectedValueOnce(
        new TiktokClientError(TiktokErrorClass.BUSINESS, 999, 'hỏng', 400, 'req-y'),
      );
    promotionApi.getActivity.mockResolvedValue({ data: { status: 'NOT_START', products: [] }, requestId: 'g' });

    await publishAndSettle();

    // Đúng 300 dòng của lô 1. Không đánh dấu ở đây thì lần chạy lại gửi lại cả 600.
    expect(publishedItemIds()).toHaveLength(300);
    expect(publishedItemIds()).toContain('item-0');
    expect(publishedItemIds()).not.toContain('item-599');
  });
});

// ---------------------------------------------------------------------------
// Chạy lại / tiếp tục
// ---------------------------------------------------------------------------

describe('Retry — tiếp tục trên CÙNG khuyến mãi', () => {
  it('🔴 chỉ gửi lại dòng CHƯA lên sàn, và KHÔNG tạo hoạt động thứ hai', async () => {
    // 600 dòng: 300 đầu đã `PUBLISHED` ở lượt trước, 300 sau còn dở.
    const items = buildItems(600, (index) =>
      index < 300 ? { status: PodFlashSaleItemStatus.PUBLISHED } : {},
    );
    const { service, promotionApi, calls } = buildService(
      buildFlashSale({
        items,
        itemCount: 600,
        status: PodFlashSaleStatus.FAILED,
        providerFlashSaleId: 'TT-ACT-EXISTING',
        retryCount: 1,
      }),
    );

    const result = await service.retry('org-1', 'user-1', 'fs-1', {}, SCOPE);
    await service.whenPublishIdle();

    // 🔴 Không Create. Dùng lại đúng hoạt động cũ.
    expect(promotionApi.createActivity).not.toHaveBeenCalled();
    expect(result.providerFlashSaleId).toBe('TT-ACT-EXISTING');

    // Đúng MỘT lô cho 300 dòng còn lại — không gửi lại 300 dòng đã xong.
    expect(calls()).toHaveLength(1);
    expect(calls()[0].activityId).toBe('TT-ACT-EXISTING');
    const skuIds = calls()[0].products.flatMap((p) => p.skus.map((s) => s.id));
    expect(skuIds).toHaveLength(300);
    expect(skuIds).toContain('TT-SKU-300');
    expect(skuIds).not.toContain('TT-SKU-0');
  });

  it('mọi dòng đã lên sàn ⇒ không request nào, chốt RUNNING ngay', async () => {
    const items = buildItems(300, () => ({ status: PodFlashSaleItemStatus.PUBLISHED }));
    const { service, promotionApi, writes } = buildService(
      buildFlashSale({
        items,
        status: PodFlashSaleStatus.FAILED,
        providerFlashSaleId: 'TT-ACT-EXISTING',
      }),
    );

    const result = await service.retry('org-1', 'user-1', 'fs-1', {}, SCOPE);
    await service.whenPublishIdle();

    expect(promotionApi.updateActivityProducts).not.toHaveBeenCalled();
    expect(result.status).toBe(PodFlashSaleStatus.RUNNING);
    expect(writes().some((row) => row.status === PodFlashSaleStatus.RUNNING)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chống trùng
// ---------------------------------------------------------------------------

describe('Chống trùng (idempotency)', () => {
  it('🔴 bấm Publish lần hai khi lượt đầu đang chạy ⇒ bị từ chối, KHÔNG có hoạt động thứ hai', async () => {
    const { service, prisma, promotionApi } = buildService();
    // Lượt đầu giành được; lượt sau thua phép so-sánh-và-đổi (`count: 0`).
    prisma.podFlashSale.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });

    await service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE);
    await expect(service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE)).rejects.toThrow();
    await service.whenPublishIdle();

    // 🔴 Đúng MỘT hoạt động khuyến mãi, dù đã bấm hai lần.
    expect(promotionApi.createActivity).toHaveBeenCalledTimes(1);
  });

  it('phép giành lượt mang ĐIỀU KIỆN trạng thái — không phải ghi đè mù', async () => {
    const { service, prisma } = buildService();

    await service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE);
    await service.whenPublishIdle();

    const claim = (prisma.podFlashSale.updateMany.mock.calls as unknown as Array<[{ where: Record<string, unknown>; data: Record<string, unknown> }]>)[0][0];
    // Không có điều kiện này thì hai request đọc cùng `READY` sẽ cùng đi tiếp.
    expect(claim.where).toMatchObject({ id: 'fs-1', deletedAt: null });
    expect(claim.where.status).toBeDefined();
    expect(claim.data.status).toBe(PodFlashSaleStatus.PUBLISHING);
  });

  it('không giành được khoá phân tán ⇒ không gửi lô nào (instance khác đang chạy)', async () => {
    const { service, locks, promotionApi } = buildService();
    locks.acquire.mockResolvedValue(null);

    await service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE);
    await service.whenPublishIdle();

    expect(promotionApi.updateActivityProducts).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Thử lại lỗi tạm thời
// ---------------------------------------------------------------------------

describe('Thử lại lô khi lỗi TẠM THỜI', () => {
  it('lỗi 5xx của TikTok ⇒ thử lại rồi đi tiếp', async () => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
    try {
      const { service, promotionApi, calls } = buildService();
      promotionApi.updateActivityProducts
        .mockRejectedValueOnce(
          new TiktokClientError(TiktokErrorClass.SERVER, 500, 'TikTok lỗi', 500, 'req-1'),
        )
        .mockResolvedValue({ data: { products: [] }, requestId: 'r-ok' });

      const publishing = service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE);
      await publishing;
      await jest.runAllTimersAsync();
      await service.whenPublishIdle();

      // Một lần hỏng + một lần thành công cho CÙNG một lô.
      expect(calls()).toHaveLength(2);
      expect(calls()[0].activityId).toBe(calls()[1].activityId);
    } finally {
      jest.useRealTimers();
    }
  });

  it('🔴 lượt gọi TREO quá hạn ⇒ coi là lỗi tạm thời, thử lại thay vì kẹt mãi', async () => {
    // SDK vendored không đặt timeout cho từng request; không có hàng rào này thì một socket
    // treo giữ khoá publish và đợt sale kẹt ở PUBLISHING cho tới khi có người để ý.
    jest.useFakeTimers({ doNotFake: ['performance'] });
    try {
      const { service, promotionApi, calls } = buildService();
      promotionApi.updateActivityProducts
        .mockImplementationOnce(() => new Promise(() => {})) // không bao giờ trả lời
        .mockResolvedValue({ data: { products: [] }, requestId: 'r-ok' });

      await service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE);
      await jest.runAllTimersAsync();
      await service.whenPublishIdle();

      // Lần treo + lần thử lại thành công, trên CÙNG một hoạt động.
      expect(calls()).toHaveLength(2);
      expect(calls()[1].activityId).toBe('TT-ACT-1');
    } finally {
      jest.useRealTimers();
    }
  });

  it('🔴 lỗi VĨNH VIỄN không thử lại — thử lại chỉ đốt quota và làm chậm việc báo lỗi', async () => {
    const { publishAndSettle, promotionApi, calls } = buildService();
    promotionApi.updateActivityProducts.mockRejectedValue(
      new TiktokClientError(TiktokErrorClass.AUTH, 105002, 'Hết hạn uỷ quyền', 401, 'req-1'),
    );

    await publishAndSettle();

    expect(calls()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Lượt publish đứt gánh
// ---------------------------------------------------------------------------

describe('Nhặt lại lượt publish đứt gánh', () => {
  it('🔴 tiến trình nền KHÔNG ghi `updatedBy` — `updated_by` là cột UUID, chuỗi rỗng là lỗi Prisma', async () => {
    const { service, prisma, promotionApi, flashSales } = buildService(
      buildFlashSale({
        status: PodFlashSaleStatus.PUBLISHING,
        providerFlashSaleId: 'TT-ACT-EXISTING',
      }),
    );
    // 🔴 `resumeStalledPublish` đưa đợt về FAILED bằng `updateMany`, rồi `publish` gọi
    // `get()` — và `get()` ĐỌC LẠI từ database. Mock phải phản ánh đúng điều đó, nếu không
    // bài test kiểm một thế giới không tồn tại. Chính phép đọc lại này là thứ khiến việc
    // nhặt lại chạy được: không có nó, `publish` sẽ thấy PUBLISHING và từ chối.
    flashSales.get.mockResolvedValue(
      buildFlashSale({
        status: PodFlashSaleStatus.FAILED,
        providerFlashSaleId: 'TT-ACT-EXISTING',
      }),
    );
    prisma.podFlashSale.updateMany.mockResolvedValue({ count: 1 });

    await service.resumeStalledPublish({
      id: 'fs-1',
      organizationId: 'org-1',
      publishRunId: 'run-cu',
      publishedAt: null,
    });
    await service.whenPublishIdle();

    const writes = (prisma.podFlashSale.updateMany.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>)
      .map((call) => call[0].data);

    // Không lời gọi nào mang `updatedBy`: không có người dùng nào đứng sau lượt này, và
    // ghi id của người bấm lần trước là nói dối về người thao tác.
    expect(writes.every((data) => !('updatedBy' in data))).toBe(true);
    // Và vẫn dùng lại đúng hoạt động cũ, không tạo hoạt động thứ hai.
    expect(promotionApi.createActivity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TikTok nhận THIẾU trong một lô thành công — không được đánh dấu cả lô PUBLISHED
// ---------------------------------------------------------------------------

describe('Lô thành công nhưng TikTok nhận thiếu (total_count < số mục gửi)', () => {
  it('🔴 25/30: đúng 5 dòng vắng trong Get Activity ⇒ FAILED (NOT_ACCEPTED_BY_TIKTOK), 25 PUBLISHED', async () => {
    const flashSale = buildFlashSale({ items: buildItems(30), itemCount: 30 });
    const { publishAndSettle, promotionApi, publishedItemIds, failedItems, batchResults } = buildService(flashSale);
    promotionApi.updateActivityProducts.mockResolvedValue({ data: { totalCount: 25 }, requestId: 'r3' });
    promotionApi.getActivity.mockResolvedValue({
      data: {
        products: Array.from({ length: 25 }, (_, index) => ({
          id: `TT-P-${index}`,
          skus: [{ id: `TT-SKU-${index}` }],
        })),
      },
      requestId: 'r4',
    });

    await publishAndSettle();

    expect(publishedItemIds()).toHaveLength(25);
    const failed = failedItems();
    expect([...failed.keys()].sort()).toEqual(['item-25', 'item-26', 'item-27', 'item-28', 'item-29']);
    expect([...failed.values()].every((d) => d.errorCode === 'NOT_ACCEPTED_BY_TIKTOK')).toBe(true);
    expect(batchResults()[0]).toMatchObject({ status: 'PARTIAL', succeeded: 25, failed: 5 });
  });

  it('total_count đủ ⇒ KHÔNG gọi Get Activity (không tốn thêm lời gọi)', async () => {
    const { publishAndSettle, promotionApi } = buildService(buildFlashSale({ items: buildItems(3) }));
    promotionApi.updateActivityProducts.mockResolvedValue({ data: { totalCount: 3 }, requestId: 'r3' });

    await publishAndSettle();

    expect(promotionApi.getActivity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Gửi THÊM sản phẩm vào đợt đang chạy
// ---------------------------------------------------------------------------

describe('pushPendingItems — thêm sản phẩm vào đợt ĐANG CHẠY', () => {
  const running = (items: ReturnType<typeof buildItems>) =>
    buildFlashSale({
      status: PodFlashSaleStatus.RUNNING,
      providerFlashSaleId: 'TT-ACT-1',
      endAt: new Date(Date.now() + 3_600_000),
      items,
    });

  function withValidation(harness: ReturnType<typeof buildService>, row: FlashSaleDetailRow) {
    Object.assign(harness.flashSales, {
      validateItemsOnly: jest.fn().mockReturnValue({ issues: [], readyItemIds: row.items.map((i) => i.id) }),
    });
    harness.promotionApi.getActivity.mockResolvedValue({ data: { status: 'ONGOING', products: [] }, requestId: 'g' });
  }

  it('🔴 chỉ gửi dòng CHƯA lên sàn; dòng PUBLISHED không bị gửi lại; đợt về RUNNING', async () => {
    const row = running(
      buildItems(4, (index) => ({
        status: index < 2 ? PodFlashSaleItemStatus.PUBLISHED : PodFlashSaleItemStatus.READY,
      })),
    );
    const harness = buildService(row);
    withValidation(harness, row);
    harness.promotionApi.updateActivityProducts.mockResolvedValue({ data: { totalCount: 2 }, requestId: 'r3' });

    const result = await harness.service.pushPendingItems('org-1', 'user-1', 'fs-1', SCOPE);
    await harness.service.whenPublishIdle();

    expect(result.status).toBe(PodFlashSaleStatus.PUBLISHING);
    expect(result.totalItems).toBe(2);
    const sent = harness.calls().flatMap((c) => c.products.flatMap((p) => p.skus.map((s) => s.id)));
    expect(sent).toEqual(['TT-SKU-2', 'TT-SKU-3']);
    expect(harness.calls().every((c) => c.activityId === 'TT-ACT-1')).toBe(true);
    expect(harness.promotionApi.createActivity).not.toHaveBeenCalled();
    expect(harness.writes().some((w) => w.status === PodFlashSaleStatus.RUNNING)).toBe(true);
    expect(harness.writes().some((w) => w.status === PodFlashSaleStatus.FAILED)).toBe(false);
  });

  it('🔴 TikTok từ chối lô khi đang chạy ⇒ đợt VẪN RUNNING (khuyến mãi cũ vẫn bán), dòng mới FAILED', async () => {
    const row = running(buildItems(2, () => ({ status: PodFlashSaleItemStatus.READY })));
    const harness = buildService(row);
    withValidation(harness, row);
    harness.promotionApi.updateActivityProducts.mockRejectedValue(
      new TiktokClientError(TiktokErrorClass.CLIENT_BUG, 17000999, 'not eligible', 200, 'rq'),
    );

    await harness.service.pushPendingItems('org-1', 'user-1', 'fs-1', SCOPE);
    await harness.service.whenPublishIdle();

    expect(harness.writes().some((w) => w.status === PodFlashSaleStatus.RUNNING)).toBe(true);
    expect(harness.writes().some((w) => w.status === PodFlashSaleStatus.FAILED)).toBe(false);
    // CLIENT_BUG là lỗi của CẢ lượt ⇒ lô này FAILED với đúng lỗi đó, không tách SKU, không gọi Get Product.
    expect([...harness.failedItems().values()].every((d) => d.errorCode === 'BATCH_REJECTED')).toBe(true);
    expect(harness.failedItems().size).toBe(2);
    expect(harness.productApi.getProduct).not.toHaveBeenCalled();
  });

  it('không còn dòng nào chưa gửi ⇒ không gọi TikTok, không giành lượt', async () => {
    const row = running(buildItems(2, () => ({ status: PodFlashSaleItemStatus.PUBLISHED })));
    const harness = buildService(row);
    withValidation(harness, row);

    const result = await harness.service.pushPendingItems('org-1', 'user-1', 'fs-1', SCOPE);

    expect(result.totalItems).toBe(0);
    expect(result.status).toBe(PodFlashSaleStatus.RUNNING);
    expect(harness.promotionApi.getActivity).not.toHaveBeenCalled();
    expect(harness.prisma.podFlashSale.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['DEACTIVATED', []],
    ['EXPIRED', []],
    ['ONGOING', ['IMMUTABLE']],
  ])('hoạt động TikTok %s %j ⇒ 409 NOT_EDITABLE_ON_PROVIDER, không gửi gì', async (status, commands) => {
    const row = running(buildItems(1, () => ({ status: PodFlashSaleItemStatus.READY })));
    const harness = buildService(row);
    withValidation(harness, row);
    harness.promotionApi.getActivity.mockResolvedValue({ data: { status, activityCommands: commands }, requestId: 'g' });

    await expect(harness.service.pushPendingItems('org-1', 'user-1', 'fs-1', SCOPE)).rejects.toMatchObject({
      response: { code: 'POD_FLASH_SALE_NOT_EDITABLE_ON_PROVIDER' },
    });
    expect(harness.promotionApi.updateActivityProducts).not.toHaveBeenCalled();
    expect(harness.prisma.podFlashSale.updateMany).not.toHaveBeenCalled();
  });

  it.each([PodFlashSaleStatus.READY, PodFlashSaleStatus.PUBLISHING, PodFlashSaleStatus.ENDED])(
    'đợt %s ⇒ từ chối (chỉ đợt RUNNING mới gửi thêm)',
    async (status) => {
      const harness = buildService(buildFlashSale({ status, providerFlashSaleId: 'TT-ACT-1' }));
      await expect(harness.service.pushPendingItems('org-1', 'user-1', 'fs-1', SCOPE)).rejects.toMatchObject({
        response: { code: 'POD_FLASH_SALE_INVALID_STATE' },
      });
    },
  );

  it('🔴 lượt khác giành mất (claim = 0) ⇒ 409, không gửi gì', async () => {
    const row = running(buildItems(1, () => ({ status: PodFlashSaleItemStatus.READY })));
    const harness = buildService(row);
    withValidation(harness, row);
    harness.prisma.podFlashSale.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(harness.service.pushPendingItems('org-1', 'user-1', 'fs-1', SCOPE)).rejects.toMatchObject({
      response: { code: 'POD_FLASH_SALE_INVALID_STATE' },
    });
    expect(harness.promotionApi.updateActivityProducts).not.toHaveBeenCalled();
  });

  it('🔴 lượt trước đã gửi xong trước khi giành lượt ⇒ tính lại, không gửi lại dòng vừa lên sàn', async () => {
    const stale = running(buildItems(2, () => ({ status: PodFlashSaleItemStatus.READY })));
    const fresh = running(buildItems(2, () => ({ status: PodFlashSaleItemStatus.PUBLISHED })));
    const harness = buildService(stale);
    withValidation(harness, stale);
    harness.flashSales.get.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);

    const result = await harness.service.pushPendingItems('org-1', 'user-1', 'fs-1', SCOPE);

    expect(result.totalItems).toBe(0);
    expect(result.status).toBe(PodFlashSaleStatus.RUNNING);
    expect(harness.promotionApi.updateActivityProducts).not.toHaveBeenCalled();
    expect(harness.writes().some((w) => w.status === PodFlashSaleStatus.RUNNING)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cô lập lỗi theo LÔ / theo SKU — một mục hỏng không được chặn phần còn lại
// ---------------------------------------------------------------------------

/** TikTok 17029016 — lỗi thật của đợt "FLASH SALE_MINA #3 CopyY". */
const skuNotMatch = () =>
  new TiktokClientError(
    TiktokErrorClass.BUSINESS,
    17029016,
    'Resource Not Found: No SKU in the product matches the sku_id',
    200,
    'req-17029016',
  );

/** Get Product giả: sản phẩm `TT-P-i` có SKU `TT-SKU-i`; `deleted` ⇒ DELETED (SKU VẪN còn trên sản phẩm). */
function tiktokCatalog(options: { deleted?: string[]; missingSkus?: string[] } = {}) {
  return (_ctx: unknown, productId: string) =>
    Promise.resolve({
      data: {
        id: productId,
        status: options.deleted?.includes(productId) ? 'DELETED' : 'ACTIVATE',
        skus: [{ id: productId.replace('TT-P-', 'TT-SKU-') }, { id: `${productId}-S1` }, { id: `${productId}-S3` }]
          .filter((sku) => !options.missingSkus?.includes(sku.id)),
      },
      requestId: 'gp',
    });
}

/** Payload nào chứa một sản phẩm "hỏng" ⇒ TikTok từ chối CẢ request (đúng hành vi đã thấy). */
function rejectWhenContains(badProductIds: string[], badSkuIds: string[] = []) {
  return (_ctx: unknown, _activityId: string, products: ProductPayload[]) => {
    const bad = products.some(
      (product) => badProductIds.includes(product.id) || product.skus.some((sku) => badSkuIds.includes(sku.id)),
    );
    if (bad) return Promise.reject(skuNotMatch());
    return Promise.resolve({
      data: { totalCount: products.reduce((sum, p) => sum + Math.max(p.skus.length, 1), 0) },
      requestId: 'ok',
    });
  };
}

describe('Cô lập lỗi: một lô / SKU hỏng KHÔNG chặn các lô còn lại', () => {
  it('CASE 1 — đợt nhân bản 3 lô, cả 3 thành công ⇒ 3/3 SUCCEEDED, RUNNING, không lỗi, một hoạt động', async () => {
    const harness = buildService(buildFlashSale({ items: buildItems(900), itemCount: 900 }));
    harness.promotionApi.updateActivityProducts.mockImplementation(rejectWhenContains([]));

    await harness.publishAndSettle();

    expect(harness.batchResults().map((r) => r.status)).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
    expect(harness.publishedItemIds()).toHaveLength(900);
    expect(harness.promotionApi.createActivity).toHaveBeenCalledTimes(1);
    const final = harness.writes().find((w) => w.status !== undefined && w.publishFinishedAt instanceof Date);
    expect(final).toMatchObject({ status: PodFlashSaleStatus.RUNNING, lastErrorCode: null });
  });

  it('CASE 2 — lô 1 FAILED vì sản phẩm đã xoá (17029016), lô 2 & 3 SUCCEEDED, không lô nào PENDING', async () => {
    const harness = buildService(buildFlashSale({ items: buildItems(900), itemCount: 900 }));
    const batch1 = Array.from({ length: 300 }, (_, index) => `TT-P-${index}`);
    harness.promotionApi.updateActivityProducts.mockImplementation(rejectWhenContains(batch1));
    harness.productApi.getProduct.mockImplementation(tiktokCatalog({ deleted: batch1 }));

    await harness.publishAndSettle();

    expect(harness.batchResults().map((r) => r.status)).toEqual(['FAILED', 'SUCCEEDED', 'SUCCEEDED']);
    expect(harness.batchResults().some((r) => r.status === 'PENDING' || r.status === 'PROCESSING')).toBe(false);
    expect(harness.publishedItemIds()).toHaveLength(600);
    const failed = harness.failedItems();
    expect(failed.size).toBe(300);
    // Lý do cụ thể trên TỪNG dòng: sản phẩm DELETED + lỗi gốc của TikTok, kèm lô.
    expect(failed.get('item-0')).toMatchObject({ errorCode: 'PRODUCT_NOT_LIVE', publishBatch: 1 });
    expect(failed.get('item-0')?.error).toContain('DELETED');
    expect(failed.get('item-0')?.error).toContain('17029016');
    // Lỗi TikTok được ghi nhật ký kèm payload đã gửi — không "nuốt" lỗi.
    const rejectedLog = (harness.flashSales.writeLog.mock.calls as Array<[Record<string, unknown>]>)
      .map((c) => c[0])
      .find((entry) => entry.errorCode === '17029016');
    expect(rejectedLog).toMatchObject({ requestId: 'req-17029016' });
    expect((rejectedLog?.request as { products: unknown[] }).products).toHaveLength(300);
  });

  it('CASE 3 — lô 1: 5 SKU hỏng, 295 lên sàn; lô 2: 300 ⇒ succeeded 595, failed 5, pending 0', async () => {
    const harness = buildService(buildFlashSale({ items: buildItems(600), itemCount: 600 }));
    const bad = ['TT-P-3', 'TT-P-50', 'TT-P-120', 'TT-P-200', 'TT-P-299'];
    harness.promotionApi.updateActivityProducts.mockImplementation(rejectWhenContains(bad));
    harness.productApi.getProduct.mockImplementation(tiktokCatalog({ deleted: bad }));

    await harness.publishAndSettle();

    const results = harness.batchResults();
    expect(results[0]).toMatchObject({ status: 'PARTIAL', succeeded: 295, failed: 5, errorCode: '17029016' });
    expect(results[1]).toMatchObject({ status: 'SUCCEEDED', succeeded: 300, failed: 0 });
    expect(harness.publishedItemIds()).toHaveLength(595);
    expect([...harness.failedItems().keys()].sort()).toEqual(
      ['item-120', 'item-200', 'item-299', 'item-3', 'item-50'],
    );
    // Lần gửi lại của lô 1 KHÔNG chứa sản phẩm hỏng.
    const resend = harness.calls()[1].products.map((p) => p.id);
    expect(resend).toHaveLength(295);
    expect(resend.some((id) => bad.includes(id))).toBe(false);
  });

  it('CASE 4 — một SKU không thuộc sản phẩm ⇒ CHỈ SKU đó FAILED, các SKU khác cùng sản phẩm vẫn lên sàn', async () => {
    const items = ['S1', 'S2', 'S3'].map((suffix, index) =>
      buildItem({
        id: `item-${suffix}`,
        variantId: `v-${suffix}`,
        providerProductId: 'TT-P-A',
        providerVariantId: `TT-P-A-${suffix}`,
        sortOrder: index,
      }),
    );
    const harness = buildService(buildFlashSale({ items, itemCount: 3 }));
    harness.promotionApi.updateActivityProducts.mockImplementation(rejectWhenContains([], ['TT-P-A-S2']));
    harness.productApi.getProduct.mockImplementation(tiktokCatalog({ missingSkus: ['TT-P-A-S2'] }));

    await harness.publishAndSettle();

    expect(harness.failedItems().get('item-S2')).toMatchObject({ errorCode: 'SKU_NOT_ON_PRODUCT' });
    expect(harness.failedItems().size).toBe(1);
    expect(harness.publishedItemIds().sort()).toEqual(['item-S1', 'item-S3']);
    expect(harness.calls()[1].products[0].skus.map((s) => s.id)).toEqual(['TT-P-A-S1', 'TT-P-A-S3']);
  });

  it.each([
    ['CASE 5 — 429', TiktokErrorClass.RATE_LIMIT, 429],
    ['CASE 6 — HTTP 500', TiktokErrorClass.SERVER, 500],
  ])('%s hết lượt thử lại ⇒ lô 1 FAILED, lô 2 VẪN chạy; không tách SKU vì lỗi tạm thời', async (_label, errorClass, http) => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
    try {
      const harness = buildService(buildFlashSale({ items: buildItems(600), itemCount: 600 }));
      const transient = new TiktokClientError(errorClass, http, 'tạm thời', http, 'req-t');
      harness.promotionApi.updateActivityProducts.mockImplementation(
        (_ctx: unknown, _id: string, products: ProductPayload[]) =>
          products.some((p) => p.id === 'TT-P-0')
            ? Promise.reject(transient)
            : Promise.resolve({ data: { totalCount: products.length }, requestId: 'ok' }),
      );

      await harness.service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE);
      await jest.runAllTimersAsync();
      await harness.service.whenPublishIdle();

      // 1 lần đầu + FLASH_SALE_BATCH_MAX_RETRIES (3) lần thử lại cho lô 1, rồi lô 2.
      expect(harness.calls()).toHaveLength(5);
      expect(harness.batchResults().map((r) => r.status)).toEqual(['FAILED', 'SUCCEEDED']);
      expect(harness.productApi.getProduct).not.toHaveBeenCalled();
      expect([...harness.failedItems().values()].every((d) => d.errorCode === 'BATCH_REJECTED')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('CASE 7 — timeout SAU KHI TikTok đã nhận ⇒ gửi lại ĐÚNG payload vào CÙNG hoạt động; không tạo hoạt động thứ hai', async () => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
    try {
      const harness = buildService(buildFlashSale({ items: buildItems(3), itemCount: 3 }));
      harness.promotionApi.updateActivityProducts
        .mockImplementationOnce(() => new Promise(() => {})) // TikTok nhận nhưng không trả lời kịp
        .mockResolvedValue({ data: { totalCount: 3 }, requestId: 'r-ok' });

      await harness.service.publish('org-1', 'user-1', 'fs-1', {}, SCOPE);
      await jest.runAllTimersAsync();
      await harness.service.whenPublishIdle();

      const [first, second] = harness.calls();
      expect(second.activityId).toBe(first.activityId);
      // Update Activity Products là "thêm hoặc sửa" theo id ⇒ gửi lại cùng payload không nhân đôi SKU.
      expect(second.products).toEqual(first.products);
      expect(harness.promotionApi.createActivity).toHaveBeenCalledTimes(1);
      expect(harness.batchResults().map((r) => r.status)).toEqual(['SUCCEEDED']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('lỗi của CẢ lượt (uỷ quyền) ở lô 2 ⇒ lô 3 SKIPPED kèm lý do, KHÔNG gửi; không còn lô PENDING', async () => {
    const harness = buildService(buildFlashSale({ items: buildItems(900), itemCount: 900 }));
    harness.promotionApi.updateActivityProducts
      .mockResolvedValueOnce({ data: { totalCount: 300 }, requestId: 'r-1' })
      .mockRejectedValueOnce(new TiktokClientError(TiktokErrorClass.AUTH, 105002, 'Hết hạn uỷ quyền', 401, 'req-a'));

    await harness.publishAndSettle();

    expect(harness.calls()).toHaveLength(2);
    expect(harness.batchResults().map((r) => r.status)).toEqual(['SUCCEEDED', 'FAILED', 'SKIPPED']);
    expect(harness.batchResults()[2].errorCode).toBe('105002');
    expect(harness.productApi.getProduct).not.toHaveBeenCalled();
    const final = harness.writes().find((w) => w.status !== undefined && w.publishFinishedAt instanceof Date);
    // Lô 1 đã lên sàn ⇒ hoạt động đang chạy ⇒ RUNNING kèm PUBLISH_PARTIAL, không phải "thành công".
    expect(final).toMatchObject({ status: PodFlashSaleStatus.RUNNING, lastErrorCode: 'PUBLISH_PARTIAL' });
  });

  it('không tách được SKU nào và hoạt động đã bị đóng ⇒ dừng lượt, các lô sau SKIPPED', async () => {
    const harness = buildService(buildFlashSale({ items: buildItems(600), itemCount: 600 }));
    harness.promotionApi.updateActivityProducts.mockRejectedValue(skuNotMatch());
    harness.productApi.getProduct.mockImplementation(tiktokCatalog());
    harness.promotionApi.getActivity.mockResolvedValue({ data: { status: 'DEACTIVATED', products: [] }, requestId: 'g' });

    await harness.publishAndSettle();

    expect(harness.calls()).toHaveLength(1);
    expect(harness.batchResults().map((r) => r.status)).toEqual(['FAILED', 'SKIPPED']);
    const final = harness.writes().find((w) => w.status !== undefined && w.publishFinishedAt instanceof Date);
    // Chưa dòng nào lên sàn ⇒ FAILED (Retry dùng lại activity_id).
    expect(final).toMatchObject({ status: PodFlashSaleStatus.FAILED });
  });

  it('CASE 9 — pre-flight: dòng của sản phẩm không còn bán bị đánh FAILED kèm lý do và KHÔNG được gửi', async () => {
    const flashSale = buildFlashSale({ items: buildItems(3), itemCount: 3 });
    const harness = buildService(flashSale);
    harness.flashSales.validateRow.mockReturnValue({
      flashSaleId: 'fs-1',
      ok: false,
      readyItems: 2,
      issues: [
        {
          level: 'ERROR',
          code: 'FLASH_SALE_PRODUCT_NOT_ACTIVE',
          field: 'productId',
          message: 'Sản phẩm TT-P-1 không còn đang bán trên TikTok',
          itemId: 'item-1',
        },
      ],
    });
    harness.promotionApi.updateActivityProducts.mockImplementation(rejectWhenContains([]));

    await harness.service.publish('org-1', 'user-1', 'fs-1', { skipInvalidItems: true }, SCOPE);
    await harness.service.whenPublishIdle();

    expect(harness.failedItems().get('item-1')).toMatchObject({ errorCode: 'FLASH_SALE_PRODUCT_NOT_ACTIVE' });
    const sent = harness.calls().flatMap((c) => c.products.map((p) => p.id));
    expect(sent.sort()).toEqual(['TT-P-0', 'TT-P-2']);
    expect(harness.publishedItemIds().sort()).toEqual(['item-0', 'item-2']);
  });

  it('CASE 10 — Retry sau khi hỏng một phần: CHỈ gửi dòng FAILED / chưa gửi, không gửi lại dòng đã lên sàn', async () => {
    const row = buildFlashSale({
      status: PodFlashSaleStatus.RUNNING,
      providerFlashSaleId: 'TT-ACT-1',
      endAt: new Date(Date.now() + 3_600_000),
      items: buildItems(4, (index) => ({
        status: [
          PodFlashSaleItemStatus.PUBLISHED,
          PodFlashSaleItemStatus.FAILED,
          PodFlashSaleItemStatus.PUBLISHED,
          PodFlashSaleItemStatus.READY,
        ][index],
      })),
    });
    const harness = buildService(row);
    Object.assign(harness.flashSales, {
      validateItemsOnly: jest.fn().mockReturnValue({ issues: [], readyItemIds: row.items.map((i) => i.id) }),
    });
    harness.promotionApi.getActivity.mockResolvedValue({ data: { status: 'ONGOING', products: [] }, requestId: 'g' });
    harness.promotionApi.updateActivityProducts.mockImplementation(rejectWhenContains([]));

    await harness.service.pushPendingItems('org-1', 'user-1', 'fs-1', SCOPE);
    await harness.service.whenPublishIdle();

    const sent = harness.calls().flatMap((c) => c.products.flatMap((p) => p.skus.map((s) => s.id)));
    expect(sent).toEqual(['TT-SKU-1', 'TT-SKU-3']);
    expect(harness.calls().every((c) => c.activityId === 'TT-ACT-1')).toBe(true);
    expect(harness.promotionApi.createActivity).not.toHaveBeenCalled();
  });
});
