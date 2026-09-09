import { PodFlashSaleItemStatus, PodFlashSaleProductLevel, PodFlashSaleStatus, Prisma } from '@prisma/client';
import { PodFlashSalePublisherService } from './pod-flash-sale-publisher.service';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import {
  TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL,
  TIKTOK_ACTIVITY_PRODUCT_LEVEL,
  TIKTOK_ACTIVITY_TYPE,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type { FlashSaleDetailRow } from '../mappers/pod-flash-sale.mapper';

/**
 * **Publish Flash Sale** — hai luật không được phép sai:
 *
 * 1. Đợt sale ĐÃ có `activity_id` thì KHÔNG BAO GIỜ tạo hoạt động thứ hai. Mỗi lần Retry
 *    tạo mới là shop có thêm một khuyến mãi mồ côi không ai gỡ.
 * 2. Payload phải đúng hình dạng TikTok đòi ở từng `product_level`, và chia lô theo CẢ hai
 *    trần (300 sản phẩm và 300 SKU) — vượt trần là cả request bị từ chối.
 */

/** Hình dạng payload gửi lên TikTok — dùng để ép kiểu `mock.calls` một lần duy nhất. */
interface ProductPayload {
  id: string;
  quantityLimit?: number;
  quantityPerUser?: number;
  activityPriceAmount?: string;
  skus: Array<{ id: string; activityPriceAmount?: string; quantityLimit?: number }>;
}

interface ActivityRequest {
  title: string;
  activityType: string;
  productLevel: string;
  beginTime: number;
  endTime: number;
}

const D = (value: string | number) => new Prisma.Decimal(value);

function buildItem(over: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    productId: 'p-1',
    variantId: 'v-1',
    skuId: 'SELLER-SKU-1',
    originalPrice: D('29.99'),
    flashSalePrice: D('20.99'),
    discountPercent: D('30'),
    currency: 'USD',
    totalPurchaseLimit: 10,
    customerPurchaseLimit: 2,
    providerProductId: 'TT-P-1',
    providerVariantId: 'TT-SKU-1',
    providerSkuId: null,
    status: PodFlashSaleItemStatus.READY,
    sortOrder: 0,
    product: { id: 'p-1', title: 'Tee', tiktokProductId: 'TT-P-1', images: [] },
    variant: { id: 'v-1', variantName: 'Black / M', sellerSku: 'SELLER-SKU-1', tiktokSkuId: 'TT-SKU-1', imageUrl: null },
    ...over,
  };
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

function buildService(flashSale: FlashSaleDetailRow = buildFlashSale()) {
  const promotionApi = {
    createActivity: jest
      .fn()
      .mockResolvedValue({ data: { activityId: 'TT-ACT-1', status: 'DRAFT' }, requestId: 'req-1' }),
    updateActivity: jest.fn().mockResolvedValue({ data: {}, requestId: 'req-2' }),
    updateActivityProducts: jest.fn().mockResolvedValue({
      data: { activityId: 'TT-ACT-1', products: [{ id: 'TT-P-1', skus: [{ id: 'TT-SKU-1' }] }] },
      requestId: 'req-3',
    }),
    deactivateActivity: jest.fn().mockResolvedValue({ data: { status: 'DEACTIVATED' }, requestId: 'req-4' }),
    getActivity: jest.fn(),
  };

  const tx = {
    podFlashSale: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    podFlashSaleItem: { updateMany: jest.fn(), update: jest.fn() },
  };

  const prisma = {
    podFlashSale: {
      update: jest.fn(),
      // 🔴 `updateMany` là phép GIÀNH LƯỢT nguyên tử (so sánh trạng thái + đổi trong một
      // câu). `count: 1` = giành được. Test chống trùng đổi nó thành `0`.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    podFlashSaleItem: { updateMany: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    // `$transaction` dạng callback — chạy thẳng callback với client giả.
    $transaction: jest.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  };

  const flashSales = {
    get: jest.fn().mockResolvedValue(flashSale),
    validateRow: jest.fn().mockReturnValue({
      flashSaleId: flashSale.id,
      ok: true,
      issues: [],
      readyItems: flashSale.items.length,
    }),
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

  // Khoá phân tán: luôn giành được, gia hạn/giải phóng không làm gì. Test ở đây kiểm
  // NGHIỆP VỤ publish; hành vi của chính khoá đã có test riêng ở `pod-tiktok`.
  const locks = {
    acquire: jest.fn().mockResolvedValue({ key: 'lock', fenceToken: 'token' }),
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

  // `jest.fn()` trả `any` cho `mock.calls`. Ép kiểu MỘT chỗ ở đây thay vì rải `as` khắp
  // từng assertion — cùng cách `pod-listing-publish.spec.ts` đang làm.
  const productsArg = (index = 0): ProductPayload[] =>
    (promotionApi.updateActivityProducts.mock.calls[index] as unknown as [unknown, string, ProductPayload[]])[2];

  const createArgs = (index = 0): ActivityRequest =>
    (promotionApi.createActivity.mock.calls[index] as unknown as [unknown, ActivityRequest])[1];

  const updateActivityId = (index = 0): string =>
    (promotionApi.updateActivity.mock.calls[index] as unknown as [unknown, string, unknown])[1];

  /**
   * Mọi `data` đã ghi vào đợt sale — gồm CẢ `update` lẫn `updateMany`.
   *
   * Lượt publish ghi tiến độ bằng `updateMany` (kèm điều kiện `publishRunId`) chứ không phải
   * `update`, nên chỉ đọc `update` sẽ bỏ sót đúng những lần ghi cần kiểm.
   */
  const flashSaleWrites = (): Array<Record<string, unknown>> => [
    ...(prisma.podFlashSale.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>).map(
      (call) => call[0].data,
    ),
    ...(prisma.podFlashSale.updateMany.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>).map(
      (call) => call[0].data,
    ),
    ...(tx.podFlashSale.updateMany.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>).map(
      (call) => call[0].data,
    ),
  ];

  /**
   * Bấm Publish rồi CHỜ lượt gửi lô chạy nền kết thúc.
   *
   * 🔴 `publish()` cố ý trả về sớm — ngay sau khi hoạt động khuyến mãi được tạo — nên khẳng
   * định về các lô ngay sau lời gọi đó là kiểm một việc chưa xảy ra. `whenPublishIdle` là
   * cùng cái móc mà `onModuleDestroy` dùng để không cắt ngang lượt gửi lúc deploy.
   */
  const publishAndSettle = async (options: { skipInvalidItems?: boolean } = {}) => {
    const result = await service.publish('org-1', 'user-1', 'fs-1', options, SCOPE);
    await service.whenPublishIdle();
    return result;
  };

  return {
    service,
    prisma,
    promotionApi,
    flashSales,
    locks,
    tx,
    productsArg,
    createArgs,
    updateActivityId,
    flashSaleWrites,
    publishAndSettle,
  };
}

/** Phạm vi "toàn quyền" — phép kiểm phạm vi shop có test riêng ở `pod-flash-sale.service`. */
const SCOPE = { allShops: true, accountIds: [], shopIds: [] };

describe('PodFlashSalePublisherService.publish', () => {
  it('đợt sale chưa lên sàn ⇒ Create Activity rồi Update Activity Products', async () => {
    const { promotionApi, createArgs, flashSaleWrites, publishAndSettle } = buildService();

    const result = await publishAndSettle();

    expect(promotionApi.createActivity).toHaveBeenCalledTimes(1);
    expect(createArgs()).toMatchObject({
      title: 'Flash Sale 12.12',
      activityType: TIKTOK_ACTIVITY_TYPE.FLASHSALE,
      productLevel: TIKTOK_ACTIVITY_PRODUCT_LEVEL.VARIATION,
      beginTime: 1788224400,
      endTime: 1788246000,
    });
    expect(promotionApi.updateActivityProducts).toHaveBeenCalledTimes(1);

    // 🔴 Hợp đồng MỚI: response trả về khi các lô còn đang gửi ⇒ `PUBLISHING`, chưa phải
    // `RUNNING`. Nói `RUNNING` ở đây là báo cáo một kết quả chưa xảy ra.
    expect(result.status).toBe(PodFlashSaleStatus.PUBLISHING);
    // 🔴 …nhưng `activity_id` thì CÓ NGAY: màn hình cần id thật để theo dõi.
    expect(result.providerFlashSaleId).toBe('TT-ACT-1');
    expect(result.totalItems).toBe(1);
    expect(result.totalBatches).toBe(1);

    // Sau khi lượt nền xong, đợt sale mới thực sự là RUNNING.
    expect(flashSaleWrites().some((data) => data.status === PodFlashSaleStatus.RUNNING)).toBe(true);
  });

  it('🔴 đợt sale ĐÃ có activity_id ⇒ Update Activity, TUYỆT ĐỐI không Create lần hai', async () => {
    const { promotionApi, updateActivityId, publishAndSettle } = buildService(
      buildFlashSale({ providerFlashSaleId: 'TT-ACT-EXISTING', status: PodFlashSaleStatus.FAILED }),
    );

    await publishAndSettle();

    expect(promotionApi.createActivity).not.toHaveBeenCalled();
    expect(promotionApi.updateActivity).toHaveBeenCalledTimes(1);
    expect(updateActivityId()).toBe('TT-ACT-EXISTING');
  });

  it('activity_id được ghi NGAY sau Create, trước khi gắn sản phẩm', async () => {
    const { promotionApi, flashSaleWrites, publishAndSettle } = buildService();
    promotionApi.updateActivityProducts.mockRejectedValue(new Error('mạng chập'));

    // 🔴 Lô hỏng KHÔNG còn làm `publish` ném lỗi: request đã trả về từ lâu, lô chạy nền.
    // Thất bại được ghi vào database và giao diện đọc qua publish-status.
    const result = await publishAndSettle();
    expect(result.status).toBe(PodFlashSaleStatus.PUBLISHING);

    // Lượt Retry sau đó phải tìm lại được hoạt động đã tạo — nếu không ghi ở đây thì
    // Retry sẽ tạo hoạt động thứ hai trên shop thật.
    expect(flashSaleWrites().some((data) => data.providerFlashSaleId === 'TT-ACT-1')).toBe(true);
    // Và đợt sale phải dừng ở FAILED, tuyệt đối không phải RUNNING.
    expect(flashSaleWrites().some((data) => data.status === PodFlashSaleStatus.FAILED)).toBe(true);
    expect(flashSaleWrites().some((data) => data.status === PodFlashSaleStatus.RUNNING)).toBe(false);
  });

  describe('payload', () => {
    it('mức VARIATION: giá + giới hạn ở từng SKU, mức sản phẩm BẮT BUỘC là -1', async () => {
      const { productsArg, publishAndSettle } = buildService();

      await publishAndSettle();

      const [product] = productsArg();
      expect(product.quantityLimit).toBe(-1);
      expect(product.quantityPerUser).toBe(-1);
      expect(product.activityPriceAmount).toBeUndefined();
      expect(product.skus).toEqual([
        { id: 'TT-SKU-1', activityPriceAmount: '20.99', quantityLimit: 10, quantityPerUser: 2 },
      ]);
    });

    it('mức PRODUCT: giá + giới hạn ở SPU, `skus` bắt buộc là mảng rỗng', async () => {
      const { productsArg, publishAndSettle } = buildService(
        buildFlashSale({
          productLevel: PodFlashSaleProductLevel.PRODUCT,
          items: [buildItem({ variantId: null, providerVariantId: null })],
        }),
      );

      await publishAndSettle();

      expect(productsArg()).toEqual([
        {
          id: 'TT-P-1',
          activityPriceAmount: '20.99',
          quantityLimit: 10,
          quantityPerUser: 2,
          skus: [],
        },
      ]);
    });

    it('nhiều SKU của cùng một sản phẩm được gộp về MỘT mục `product_id`', async () => {
      const { productsArg, publishAndSettle } = buildService(
        buildFlashSale({
          items: [
            buildItem(),
            buildItem({ id: 'item-2', variantId: 'v-2', providerVariantId: 'TT-SKU-2' }),
          ],
        }),
      );

      await publishAndSettle();

      const products = productsArg();
      expect(products).toHaveLength(1);
      expect(products[0].skus.map((sku) => sku.id)).toEqual(['TT-SKU-1', 'TT-SKU-2']);
    });
  });

  describe('chia lô', () => {
    it('🔴 chia theo trần SKU, không chỉ theo trần sản phẩm', async () => {
      // 40 sản phẩm × 10 SKU = 400 SKU. Chỉ đếm sản phẩm thì gửi một lượt và bị TikTok từ
      // chối; đếm đúng cả hai trần thì phải thành hai lô.
      const items = Array.from({ length: 40 }).flatMap((_, productIndex) =>
        Array.from({ length: 10 }).map((__, skuIndex) =>
          buildItem({
            id: `item-${productIndex}-${skuIndex}`,
            productId: `p-${productIndex}`,
            variantId: `v-${productIndex}-${skuIndex}`,
            providerProductId: `TT-P-${productIndex}`,
            providerVariantId: `TT-SKU-${productIndex}-${skuIndex}`,
          }),
        ),
      );
      const { promotionApi, productsArg, publishAndSettle } = buildService(buildFlashSale({ items }));

      await publishAndSettle();

      expect(promotionApi.updateActivityProducts).toHaveBeenCalledTimes(2);
      for (let call = 0; call < 2; call++) {
        const skuTotal = productsArg(call).reduce((sum, product) => sum + product.skus.length, 0);
        expect(skuTotal).toBeLessThanOrEqual(TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL);
      }
    });
  });

  describe('thất bại', () => {
    it('TikTok từ chối ⇒ FAILED, giữ nguyên dữ liệu, mã lỗi + request_id được lưu', async () => {
      const { service, prisma, promotionApi, flashSaleWrites } = buildService();
      promotionApi.createActivity.mockRejectedValueOnce(
        new TiktokClientError(TiktokErrorClass.BUSINESS, 11002001, 'title duplicated', 400, 'req-err'),
      );

      await expect(
        service.publish('org-1', 'user-1', 'fs-1', {}, { allShops: true, accountIds: [], shopIds: [] }),
      ).rejects.toMatchObject({ response: { code: 'POD_FLASH_SALE_PROVIDER_ERROR' } });

      const failedWrite = flashSaleWrites().find((data) => data.status === PodFlashSaleStatus.FAILED);
      expect(failedWrite).toMatchObject({
        lastErrorCode: '11002001',
        lastErrorMessage: 'title duplicated',
        lastErrorRequestId: 'req-err',
      });
      // KHÔNG có lệnh xoá dòng nào — Retry phải chạy lại được trên đúng dữ liệu cũ.
      expect(prisma.podFlashSaleItem.updateMany).not.toHaveBeenCalled();
    });

    it('dữ liệu chưa đạt ⇒ chặn trước khi gọi TikTok', async () => {
      const { service, promotionApi, flashSales } = buildService();
      flashSales.validateRow.mockReturnValue({
        flashSaleId: 'fs-1',
        ok: false,
        issues: [{ level: 'ERROR', code: 'X', field: 'items', message: 'thiếu' }],
        readyItems: 0,
      });

      await expect(
        service.publish('org-1', 'user-1', 'fs-1', {}, { allShops: true, accountIds: [], shopIds: [] }),
      ).rejects.toMatchObject({ response: { code: 'POD_FLASH_SALE_NOT_PUBLISHABLE' } });

      expect(promotionApi.createActivity).not.toHaveBeenCalled();
    });

    it('lỗi ở PHẦN ĐẦU không thể bỏ qua bằng `skipInvalidItems`', async () => {
      const { service, promotionApi, flashSales } = buildService();
      flashSales.validateRow.mockReturnValue({
        flashSaleId: 'fs-1',
        ok: false,
        issues: [{ level: 'ERROR', code: 'FLASH_SALE_START_IN_PAST', field: 'startAt', message: 'quá khứ' }],
        readyItems: 1,
      });

      await expect(
        service.publish(
          'org-1',
          'user-1',
          'fs-1',
          { skipInvalidItems: true },
          { allShops: true, accountIds: [], shopIds: [] },
        ),
      ).rejects.toMatchObject({ response: { code: 'POD_FLASH_SALE_NOT_PUBLISHABLE' } });

      expect(promotionApi.createActivity).not.toHaveBeenCalled();
    });

    it('`skipInvalidItems` bỏ qua ĐÚNG dòng hỏng và vẫn gửi phần còn lại', async () => {
      const { flashSales, productsArg, publishAndSettle } = buildService(
        buildFlashSale({
          items: [
            buildItem(),
            buildItem({ id: 'item-2', variantId: 'v-2', providerVariantId: 'TT-SKU-2' }),
          ],
        }),
      );
      flashSales.validateRow.mockReturnValue({
        flashSaleId: 'fs-1',
        ok: false,
        issues: [
          { level: 'ERROR', code: 'FLASH_SALE_PRICE_ABOVE_RETAIL', field: 'flashSalePrice', message: 'sai', itemId: 'item-2' },
        ],
        readyItems: 1,
      });

      const result = await publishAndSettle({ skipInvalidItems: true });

      expect(productsArg()[0].skus.map((sku) => sku.id)).toEqual(['TT-SKU-1']);
      // `totalItems` = số dòng lượt này thực sự gửi (đã trừ dòng hỏng lẫn dòng đã lên sàn).
      expect(result.totalItems).toBe(1);
      expect(result.skippedItems).toBe(1);
    });
  });

  describe('retry', () => {
    it('chỉ chạy được khi đang FAILED', async () => {
      const { service } = buildService(buildFlashSale({ status: PodFlashSaleStatus.RUNNING }));

      await expect(
        service.retry('org-1', 'user-1', 'fs-1', {}, { allShops: true, accountIds: [], shopIds: [] }),
      ).rejects.toMatchObject({ response: { code: 'POD_FLASH_SALE_INVALID_STATE' } });
    });

    it('tăng số lần thử rồi đi lại đúng đường Publish', async () => {
      const { service, promotionApi, flashSaleWrites } = buildService(
        buildFlashSale({ status: PodFlashSaleStatus.FAILED, providerFlashSaleId: 'TT-ACT-1' }),
      );

      await service.retry('org-1', 'user-1', 'fs-1', {}, { allShops: true, accountIds: [], shopIds: [] });

      expect(flashSaleWrites().some((data) => data.retryCount !== undefined)).toBe(true);
      expect(promotionApi.updateActivity).toHaveBeenCalledTimes(1);
      expect(promotionApi.createActivity).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('đã lên sàn ⇒ gọi Deactivate TRƯỚC, rồi mới đổi trạng thái nội bộ', async () => {
      const { service, promotionApi, flashSaleWrites } = buildService(
        buildFlashSale({ status: PodFlashSaleStatus.RUNNING, providerFlashSaleId: 'TT-ACT-1' }),
      );

      const result = await service.cancel('org-1', 'user-1', 'fs-1', {
        allShops: true,
        accountIds: [],
        shopIds: [],
      });

      expect(promotionApi.deactivateActivity).toHaveBeenCalledWith(expect.anything(), 'TT-ACT-1');
      expect(flashSaleWrites().some((data) => data.status === PodFlashSaleStatus.CANCELLED)).toBe(true);
      expect(result.status).toBe(PodFlashSaleStatus.CANCELLED);
    });

    it('🔴 Deactivate thất bại ⇒ KHÔNG đánh dấu đã huỷ (khuyến mãi vẫn chạy trên sàn)', async () => {
      const { service, prisma, promotionApi } = buildService(
        buildFlashSale({ status: PodFlashSaleStatus.RUNNING, providerFlashSaleId: 'TT-ACT-1' }),
      );
      promotionApi.deactivateActivity.mockRejectedValueOnce(
        new TiktokClientError(TiktokErrorClass.SERVER, 50000, 'internal', 500, 'req-x'),
      );

      await expect(
        service.cancel('org-1', 'user-1', 'fs-1', { allShops: true, accountIds: [], shopIds: [] }),
      ).rejects.toMatchObject({ response: { code: 'POD_FLASH_SALE_PROVIDER_ERROR' } });

      expect(prisma.podFlashSale.update).not.toHaveBeenCalled();
    });

    it('chưa lên sàn ⇒ huỷ cục bộ, không gọi TikTok', async () => {
      const { service, promotionApi } = buildService(
        buildFlashSale({ status: PodFlashSaleStatus.DRAFT, providerFlashSaleId: null }),
      );

      await service.cancel('org-1', 'user-1', 'fs-1', { allShops: true, accountIds: [], shopIds: [] });

      expect(promotionApi.deactivateActivity).not.toHaveBeenCalled();
    });
  });

  describe('syncStatus', () => {
    const base = {
      id: 'fs-1',
      organizationId: 'org-1',
      shopId: 'shop-1',
      providerFlashSaleId: 'TT-ACT-1',
      status: PodFlashSaleStatus.RUNNING,
      endAt: new Date('2999-01-01T00:00:00.000Z'),
    };

    it('ONGOING ⇒ RUNNING', async () => {
      const { service, promotionApi } = buildService();
      promotionApi.getActivity.mockResolvedValue({
        data: { status: 'ONGOING', products: [{ id: 'TT-P-1', skus: [{ id: 'TT-SKU-1' }] }] },
        requestId: 'r',
      });

      await expect(service.syncStatus(base)).resolves.toBe(PodFlashSaleStatus.RUNNING);
    });

    it('DEACTIVATED ⇒ CANCELLED', async () => {
      const { service, promotionApi } = buildService();
      promotionApi.getActivity.mockResolvedValue({
        data: { status: 'DEACTIVATED', products: [{ id: 'TT-P-1' }] },
        requestId: 'r',
      });

      await expect(service.syncStatus(base)).resolves.toBe(PodFlashSaleStatus.CANCELLED);
    });

    it('sàn báo ONGOING nhưng đã quá giờ kết thúc ⇒ tin ĐỒNG HỒ, trả ENDED', async () => {
      const { service, promotionApi } = buildService();
      promotionApi.getActivity.mockResolvedValue({
        data: { status: 'ONGOING', products: [{ id: 'TT-P-1' }] },
        requestId: 'r',
      });

      await expect(
        service.syncStatus({ ...base, endAt: new Date('2020-01-01T00:00:00.000Z') }),
      ).resolves.toBe(PodFlashSaleStatus.ENDED);
    });

    it('🔴 lượt ĐỌC thất bại KHÔNG được đổi trạng thái đợt sale', async () => {
      const { service, promotionApi, flashSaleWrites } = buildService();
      promotionApi.getActivity.mockRejectedValueOnce(
        new TiktokClientError(TiktokErrorClass.SERVER, 50000, 'internal', 500, 'req-x'),
      );

      await expect(service.syncStatus(base)).resolves.toBe(PodFlashSaleStatus.RUNNING);

      expect(flashSaleWrites().some((data) => data.status !== undefined)).toBe(false);
    });

    it('chưa từng lên sàn ⇒ không hỏi TikTok', async () => {
      const { service, promotionApi } = buildService();

      await expect(
        service.syncStatus({ ...base, providerFlashSaleId: null }),
      ).resolves.toBe(PodFlashSaleStatus.RUNNING);
      expect(promotionApi.getActivity).not.toHaveBeenCalled();
    });

    it('TikTok trả `products` RỖNG ⇒ không đánh dấu mọi dòng là đã bị gỡ', async () => {
      const { service, prisma, promotionApi } = buildService();
      promotionApi.getActivity.mockResolvedValue({ data: { status: 'EXPIRED', products: [] }, requestId: 'r' });

      await service.syncStatus(base);

      // Hoạt động kết thúc quá 180 ngày bị TikTok trả về rỗng — coi đó là "mọi dòng đã bị
      // gỡ" sẽ xoá sạch lịch sử của một đợt sale đã chạy thành công.
      expect(prisma.podFlashSaleItem.updateMany).not.toHaveBeenCalled();
    });

    it('dòng không còn trong danh sách TikTok trả về ⇒ đánh dấu REMOVED', async () => {
      const { service, prisma, promotionApi } = buildService();
      promotionApi.getActivity.mockResolvedValue({
        data: { status: 'ONGOING', products: [{ id: 'TT-P-1', skus: [{ id: 'TT-SKU-1' }] }] },
        requestId: 'r',
      });
      prisma.podFlashSaleItem.findMany.mockResolvedValue([
        { id: 'item-1', providerProductId: 'TT-P-1', providerVariantId: 'TT-SKU-1' },
        { id: 'item-2', providerProductId: 'TT-P-1', providerVariantId: 'TT-SKU-GONE' },
      ]);

      await service.syncStatus(base);

      expect(prisma.podFlashSaleItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['item-2'] } },
        data: { status: PodFlashSaleItemStatus.REMOVED },
      });
    });
  });
});
