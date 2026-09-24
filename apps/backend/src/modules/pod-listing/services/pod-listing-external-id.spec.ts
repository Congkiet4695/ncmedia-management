import { PodListingLogLevel } from '@prisma/client';
import {
  buildExternalProductId,
  buildExternalSkuId,
  buildTiktokIdempotencyKey,
  PodListingPublisherService,
} from './pod-listing-publisher.service';
import type { ResolvedListing } from './pod-listing-resolver.service';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import {
  TIKTOK_ERROR_CODES,
  TiktokErrorClass,
} from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { POD_LISTING_CREATE_MAX_ATTEMPTS } from '../constants/pod-listing.constants';

/**
 * **Vòng đời `external_id`** — bộ test của lỗi `12052996 Precondition Required. This operation
 * requires a unique external_id`.
 *
 * Luật phải giữ:
 *
 * ```
 *   idempotency_key      mới ở MỖI LẦN GỬI        (không bao giờ gửi lại một key đã dùng)
 *   external_product_id  ổn định theo LƯỢT ĐĂNG   (gửi ở cả Create lẫn Edit)
 *   gửi lại              chỉ sau khi ĐỐI SOÁT     (thấy sản phẩm ⇒ nhận, không tạo lần hai)
 * ```
 */

const CTX: TiktokShopContext = {
  accessToken: 'token-bí-mật',
  shopCipher: 'cipher-bí-mật',
  shopId: 'shop-1',
  organizationId: 'org-1',
};

const PAYLOAD_ID = '11111111-2222-3333-4444-555555555555';

function buildPayload(overrides: Partial<ResolvedListing> = {}): ResolvedListing {
  return {
    market: 'US',
    title: 'Halloween Tee',
    description: '<p>hi</p>',
    category: { tiktokCategoryId: '600001', name: 'Tees', path: null },
    brand: { tiktokBrandId: 'B1', name: 'NoBrand' },
    attributes: [],
    images: [{ title: 'front', fileId: 'file-1', url: '', tiktokImageUri: 'uri-1', sortOrder: 0 }],
    package: { weight: '0.3', weightUnit: 'KILOGRAM' },
    warehouse: { id: 'wh-1', tiktokWarehouseId: 'TT-WH-1', name: 'Kho A' },
    shipping: { shippingTemplateId: null, handlingDays: null },
    pricing: null,
    variants: [
      {
        variantName: 'Black / M',
        sellerSku: 'SKU-1',
        salePrice: '19.99',
        retailPrice: null,
        currency: 'USD',
        quantity: 10,
        optionValues: [{ name: 'Color', value: 'Black' }],
        imageFileId: null,
      },
      {
        variantName: 'Black / L',
        sellerSku: 'SKU-2',
        salePrice: '19.99',
        retailPrice: null,
        currency: 'USD',
        quantity: 10,
        optionValues: [{ name: 'Color', value: 'Black' }],
        imageFileId: null,
      },
    ],
    source: {
      productId: 'product-1',
      sessionProductId: null,
      tiktokProductId: null,
      shopId: 'shop-1',
      listingTemplateId: 'template-1',
      imageTemplateId: null,
    },
    ...overrides,
  } as unknown as ResolvedListing;
}

/** Lỗi TikTok dựng sẵn — dùng đúng bảng phân lớp của hệ thống, không tự bịa `errorClass`. */
const transientError = (): TiktokClientError =>
  new TiktokClientError(TiktokErrorClass.NETWORK, 0, 'socket hang up', 0, 'req-net', 'PRODUCT_CREATE');

const duplicateExternalIdError = (): TiktokClientError =>
  new TiktokClientError(
    TiktokErrorClass.BUSINESS,
    TIKTOK_ERROR_CODES.DUPLICATE_EXTERNAL_ID,
    'Precondition Required. This operation requires a unique `external_id`.',
    200,
    'req-dup',
    'PRODUCT_CREATE',
  );

const quotaError = (): TiktokClientError =>
  new TiktokClientError(
    TiktokErrorClass.BUSINESS,
    12052093,
    'Operation Not Allowed. Cannot list more products',
    200,
    'req-quota',
    'PRODUCT_CREATE',
  );

function buildService() {
  const productApi = {
    createProduct: jest.fn().mockResolvedValue({
      data: { productId: 'TT-NEW', skus: [{ id: 'TT-SKU-1', sellerSku: 'SKU-1' }] },
      requestId: 'req-create',
    }),
    publishProduct: jest.fn().mockResolvedValue({
      data: { productId: 'TT-DRAFT-1', skus: [{ id: 'TT-SKU-1', sellerSku: 'SKU-1' }] },
      requestId: 'req-edit',
    }),
    // Mặc định: shop KHÔNG có sản phẩm nào khớp — đối soát trả rỗng.
    searchProducts: jest.fn().mockResolvedValue({ data: { items: [] }, requestId: 'req-search' }),
    uploadImage: jest.fn(),
  };

  const prisma = {
    podTiktokShop: {
      findFirst: jest.fn().mockResolvedValue({
        name: 'Playmaker',
        defaultWarehouse: { id: 'wh-1', tiktokWarehouseId: 'TT-WH-1', name: 'Kho A' },
        warehouses: [{ id: 'wh-1', tiktokWarehouseId: 'TT-WH-1', name: 'Kho A', isDefault: true }],
      }),
    },
    podImageTemplateItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    podSkuTemplateItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    podListingSessionProductImage: { updateMany: jest.fn() },
  };

  const service = new PodListingPublisherService(
    prisma as never,
    productApi as never,
    {} as never,
    {} as never,
    {} as never,
    {
      normalize: jest.fn((_o: string, _c: unknown, html: string) =>
        Promise.resolve({
          html,
          stats: { total: 0, uploaded: 0, reused: 0, failed: 0, finalCount: 0 },
        }),
      ),
    } as never,
  );

  // Không ai muốn chờ thật vài giây trong unit test — chỉ bỏ phần CHỜ, giữ nguyên luồng.
  jest
    .spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, 'delay')
    .mockResolvedValue(undefined);

  const log = jest.fn().mockResolvedValue(undefined);

  const publish = (tiktokDraftId: string | null, payloadId = PAYLOAD_ID, payload = buildPayload()) =>
    service.publishListing({
      organizationId: 'org-1',
      ctx: CTX,
      payload,
      payloadId,
      tiktokDraftId,
      imageUriCache: new Map([['MAIN_IMAGE:file-1', Promise.resolve('uri-1')]]),
      log,
    });

  const createBody = (index = 0) =>
    (productApi.createProduct.mock.calls as unknown[][])[index]?.[1] as Record<string, unknown>;
  const editBody = (index = 0) =>
    (productApi.publishProduct.mock.calls as unknown[][])[index]?.[2] as Record<string, unknown>;
  const logCalls = () => log.mock.calls as unknown[][];

  return { service, productApi, publish, createBody, editBody, log, logCalls };
}

describe('Vòng đời external_id — Create Product', () => {
  afterEach(() => jest.restoreAllMocks());

  it('1. Mỗi LẦN GỬI một `idempotency_key` mới — publish lại cùng listing không dùng lại key cũ', async () => {
    const { publish, createBody } = buildService();

    await publish(null);
    await publish(null);

    const first = createBody(0).idempotencyKey as string;
    const second = createBody(1).idempotencyKey as string;
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(second.length).toBeLessThanOrEqual(128);
  });

  it('2. `external_product_id` ỔN ĐỊNH theo lượt đăng — hai lần gửi cùng một payload cho cùng giá trị', async () => {
    const { publish, createBody } = buildService();

    await publish(null);
    await publish(null);

    expect(createBody(0).externalProductId).toBe(buildExternalProductId(PAYLOAD_ID));
    expect(createBody(1).externalProductId).toBe(createBody(0).externalProductId);
    // Ổn định nhưng KHÔNG phải `idempotency_key` — hai trường tách rời.
    expect(createBody(0).externalProductId).not.toBe(createBody(0).idempotencyKey);
  });

  it('3. Mỗi biến thể mang `external_sku_id` riêng, ổn định theo (lượt đăng, seller_sku)', async () => {
    const { publish, createBody } = buildService();

    await publish(null);

    const skus = createBody(0).skus as Array<Record<string, unknown>>;
    expect(skus.map((sku) => sku.externalSkuId)).toEqual([
      buildExternalSkuId(PAYLOAD_ID, 'SKU-1'),
      buildExternalSkuId(PAYLOAD_ID, 'SKU-2'),
    ]);
    // `seller_sku` vẫn nguyên — `external_sku_id` là định danh THÊM, không thay thế nó.
    expect(skus.map((sku) => sku.sellerSku)).toEqual(['SKU-1', 'SKU-2']);
  });

  it('4. Hai lượt đăng khác nhau (Clone sang nhiều shop) ⇒ `external_product_id` khác nhau', async () => {
    const { publish, createBody } = buildService();

    await publish(null, 'payload-shop-A');
    await publish(null, 'payload-shop-B');

    expect(createBody(0).externalProductId).not.toBe(createBody(1).externalProductId);
  });

  it('5. Edit Product KHÔNG gửi `idempotency_key` nhưng VẪN gửi `external_product_id`', async () => {
    const { publish, editBody, productApi } = buildService();

    await publish('TT-DRAFT-1');

    expect(productApi.createProduct).not.toHaveBeenCalled();
    expect('idempotencyKey' in editBody()).toBe(false);
    expect(editBody().externalProductId).toBe(buildExternalProductId(PAYLOAD_ID));
  });
});

describe('Đối soát sau khi Create Product hỏng', () => {
  afterEach(() => jest.restoreAllMocks());

  it('6. Lỗi mạng nhưng sản phẩm ĐÃ vào shop ⇒ nhận sản phẩm đó, KHÔNG gửi Create lần hai', async () => {
    const { publish, productApi } = buildService();
    productApi.createProduct.mockRejectedValueOnce(transientError());
    productApi.searchProducts.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'TT-ĐÃ-TẠO',
            createTime: Math.floor(Date.now() / 1000),
            skus: [{ id: 'TT-SKU-1', sellerSku: 'SKU-1' }],
          },
        ],
      },
    });

    const outcome = await publish(null);

    expect(productApi.createProduct).toHaveBeenCalledTimes(1);
    expect(outcome.remoteProductId).toBe('TT-ĐÃ-TẠO');
    expect(outcome.skuIds).toEqual([{ sellerSku: 'SKU-1', tiktokSkuId: 'TT-SKU-1' }]);
  });

  it('7. Lỗi 12052996 + đối soát thấy sản phẩm ⇒ nhận, tuyệt đối không tạo bản trùng', async () => {
    const { publish, productApi } = buildService();
    productApi.createProduct.mockRejectedValueOnce(duplicateExternalIdError());
    productApi.searchProducts.mockResolvedValueOnce({
      data: { items: [{ id: 'TT-TỪ-LẦN-TRƯỚC', createTime: Math.floor(Date.now() / 1000), skus: [] }] },
    });

    const outcome = await publish(null);

    expect(productApi.createProduct).toHaveBeenCalledTimes(1);
    expect(outcome.remoteProductId).toBe('TT-TỪ-LẦN-TRƯỚC');
  });

  it('8. Lỗi 12052996 nhưng shop CHƯA có sản phẩm ⇒ gửi lại với `external_id` MỚI', async () => {
    const { publish, productApi, createBody } = buildService();
    productApi.createProduct.mockRejectedValueOnce(duplicateExternalIdError());

    const outcome = await publish(null);

    expect(productApi.createProduct).toHaveBeenCalledTimes(2);
    expect(createBody(1).idempotencyKey).not.toBe(createBody(0).idempotencyKey);
    // Định danh ổn định thì KHÔNG đổi giữa hai lần thử của cùng một lượt đăng.
    expect(createBody(1).externalProductId).toBe(createBody(0).externalProductId);
    expect(outcome.remoteProductId).toBe('TT-NEW');
  });

  it('9. Lỗi nghiệp vụ khác (hạn mức shop) ⇒ ném ngay, không đối soát, không gửi lại', async () => {
    const { publish, productApi } = buildService();
    productApi.createProduct.mockRejectedValueOnce(quotaError());

    await expect(publish(null)).rejects.toThrow('12052093');
    expect(productApi.createProduct).toHaveBeenCalledTimes(1);
    expect(productApi.searchProducts).not.toHaveBeenCalled();
  });

  it('10. KHÔNG đối soát được (Search lỗi) ⇒ ném lỗi GỐC, không gửi lại để khỏi tạo bản trùng', async () => {
    const { publish, productApi } = buildService();
    productApi.createProduct.mockRejectedValueOnce(transientError());
    productApi.searchProducts.mockRejectedValueOnce(new Error('search sập'));

    await expect(publish(null)).rejects.toThrow('socket hang up');
    expect(productApi.createProduct).toHaveBeenCalledTimes(1);
  });

  it('11. Đối soát BỎ QUA sản phẩm cũ trùng seller_sku (tạo từ trước cửa sổ)', async () => {
    const { publish, productApi } = buildService();
    productApi.createProduct.mockRejectedValueOnce(transientError());
    productApi.searchProducts.mockResolvedValueOnce({
      data: {
        items: [
          // Đăng từ tháng trước, trùng seller_sku — nhận nhầm là báo thành công khống.
          { id: 'TT-CŨ', createTime: Math.floor(Date.now() / 1000) - 30 * 86_400, skus: [] },
        ],
      },
    });

    const outcome = await publish(null);

    expect(outcome.remoteProductId).toBe('TT-NEW');
    expect(productApi.createProduct).toHaveBeenCalledTimes(2);
  });

  it('12. Hỏng liên tiếp ⇒ dừng đúng số lần cho phép rồi ném lỗi', async () => {
    const { publish, productApi } = buildService();
    productApi.createProduct.mockRejectedValue(transientError());

    await expect(publish(null)).rejects.toThrow('socket hang up');
    expect(productApi.createProduct).toHaveBeenCalledTimes(POD_LISTING_CREATE_MAX_ATTEMPTS);
  });

  it('13. Log TRƯỚC mỗi lần gửi có đủ định danh và KHÔNG có token/cipher', async () => {
    const { publish, logCalls } = buildService();

    await publish(null);

    const sent = logCalls().find(
      (call) => call[0] === PodListingLogLevel.INFO && typeof call[3] === 'object' && call[3] !== null
        ? (call[3] as Record<string, unknown>).endpoint === 'PRODUCT_CREATE'
        : false,
    );
    const context = sent?.[3] as Record<string, unknown>;

    expect(context).toMatchObject({
      endpoint: 'PRODUCT_CREATE',
      method: 'POST',
      attempt: 1,
      shopId: 'shop-1',
      payloadId: PAYLOAD_ID,
      productId: 'product-1',
      listingTemplateId: 'template-1',
      externalProductId: buildExternalProductId(PAYLOAD_ID),
      sellerSkus: ['SKU-1', 'SKU-2'],
    });
    expect(context.externalId).toBe(context.idempotencyKey);
    expect(context.externalSkuIds).toEqual([
      buildExternalSkuId(PAYLOAD_ID, 'SKU-1'),
      buildExternalSkuId(PAYLOAD_ID, 'SKU-2'),
    ]);

    const dump = JSON.stringify(logCalls());
    expect(dump).not.toContain('token-bí-mật');
    expect(dump).not.toContain('cipher-bí-mật');
  });
});

describe('buildTiktokIdempotencyKey', () => {
  it('Không bao giờ dẫn xuất từ nội dung payload — cùng payload vẫn cho hai key khác nhau', () => {
    const payload = buildPayload();
    const keys = new Set([buildTiktokIdempotencyKey(payload), buildTiktokIdempotencyKey(payload)]);
    expect(keys.size).toBe(2);
    for (const key of keys) expect(key.length).toBeLessThanOrEqual(128);
  });
});
