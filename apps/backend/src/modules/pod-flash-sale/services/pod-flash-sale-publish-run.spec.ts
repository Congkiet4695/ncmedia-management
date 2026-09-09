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

  const service = new PodFlashSalePublisherService(
    prisma as never,
    flashSales as never,
    promotionApi as never,
    shopContext as never,
    locks as never,
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

  /** Id các dòng đã được đánh dấu PUBLISHED. */
  const publishedItemIds = (): string[] =>
    (tx.podFlashSaleItem.updateMany.mock.calls as unknown as Array<[{ where: { id: { in: string[] } } }]>)
      .flatMap((c) => c[0].where.id.in);

  return { service, prisma, tx, promotionApi, flashSales, locks, publishAndSettle, calls, writes, publishedItemIds };
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
  it('🔴 lô 2 hỏng ⇒ KHÔNG gửi lô 3, đợt sale KHÔNG phải RUNNING, và biết hỏng ở lô nào', async () => {
    const { publishAndSettle, promotionApi, writes } = buildService(
      buildFlashSale({ items: buildItems(900), itemCount: 900 }),
    );
    promotionApi.updateActivityProducts
      .mockResolvedValueOnce({ data: { products: [] }, requestId: 'r-1' })
      .mockRejectedValueOnce(
        new TiktokClientError(TiktokErrorClass.BUSINESS, 12345, 'SKU không hợp lệ', 400, 'req-x'),
      );

    await publishAndSettle();

    // Lô 3 KHÔNG được gửi: gửi tiếp sau khi một lô hỏng là để đợt sale rơi vào trạng thái
    // không ai mô tả được.
    expect(promotionApi.updateActivityProducts).toHaveBeenCalledTimes(2);

    const data = writes();
    expect(data.some((row) => row.status === PodFlashSaleStatus.FAILED)).toBe(true);
    expect(data.some((row) => row.status === PodFlashSaleStatus.RUNNING)).toBe(false);
    expect(data.some((row) => row.publishFailedBatch === 2)).toBe(true);
    expect(data.some((row) => row.lastErrorCode === '12345')).toBe(true);
    expect(data.some((row) => row.lastErrorRequestId === 'req-x')).toBe(true);
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
