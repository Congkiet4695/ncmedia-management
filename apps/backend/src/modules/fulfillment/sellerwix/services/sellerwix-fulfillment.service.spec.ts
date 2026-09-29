import { ConfigService } from '@nestjs/config';
import {
  FulfillmentCatalogItemStatus,
  FulfillmentProvider,
  FulfillmentStatus,
  FulfillmentTrigger,
  Prisma,
} from '@prisma/client';
import { DistributedLockService } from '../../../pod-tiktok/infra/distributed-lock.service';
import { PodOrderRepository } from '../../../pod-tiktok/repositories/pod-order.repository';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import type { PodOrderWithRelations } from '../../../pod-tiktok/types/pod-order-with-relations.type';
import {
  FulfillmentAlreadySubmittedException,
  FulfillmentClientError,
  FulfillmentErrorClass,
  FulfillmentNotReadyException,
  FulfillmentProviderTimeoutException,
  FulfillmentSubmittedToOtherProviderException,
  FulfillmentValidationException,
} from '../../exceptions/fulfillment.exceptions';
import { MangoOrderMapper } from '../../mango/mappers/mango-order.mapper';
import { FulfillmentCatalogRepository } from '../../repositories/fulfillment-catalog.repository';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { FulfillmentReadinessService } from '../../services/fulfillment-readiness.service';
import { SellerwixApiClient } from '../clients/sellerwix-api.client';
import { SellerwixOrderMapper } from '../mappers/sellerwix-order.mapper';
import type {
  SellerwixCreateOrderRequest,
  SellerwixOrder,
  SellerwixShippingMethod,
} from '../types/sellerwix-api.types';
import { SellerwixCredentialService } from './sellerwix-credential.service';
import { SellerwixFulfillmentService } from './sellerwix-fulfillment.service';

/**
 * **Gửi đơn POD sang Sellerwix — end-to-end qua readiness THẬT tới request THẬT.**
 *
 * Chỉ HTTP là giả; readiness, mapper, credential là code thật. Nhờ vậy các bài kiểm dưới đây
 * chứng minh request đi ra mang ĐÚNG SKU biến thể / vị trí in / địa chỉ / vận chuyển.
 *
 * SKU lấy từ bảng "Sellerwix Variant SKU": Gildan 5000 DTG — Most Popular Tee-Black-XL ⇒
 * `SW-MD-MPTG-BL-XL`; Most Popular Tee-White-S ⇒ `SW-MD-MPTG-WH-S`.
 */

const ORG = 'org-1';
const USER = 'user-1';
const POD_ORDER = 'pod-order-1';
const TIKTOK_ORDER = '576000000000000001';
const SKU_BLACK_XL = 'SW-MD-MPTG-BL-XL';
const SKU_WHITE_S = 'SW-MD-MPTG-WH-S';

const encryption = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

const ACCOUNT = {
  id: 'acc-swx',
  organizationId: ORG,
  provider: FulfillmentProvider.SELLERWIX,
  name: 'Sellerwix US',
  isActive: true,
  apiKeyEnc: 'enc:api-key-123',
  secretEnc: 'enc:-----BEGIN PRIVATE KEY-----x-----END PRIVATE KEY-----',
  providerConfig: { storeId: 'store-1', publicKeyId: 'kid-1' },
  baseUrlOverride: null,
  defaultShippingMethod: '',
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

const RECIPIENT = {
  first_name: 'John',
  last_name: 'Doe',
  phone_number: '5551234567',
  address_line1: '123 Main St',
  postal_code: '33602',
  region_code: 'US',
  district_info: [
    { address_level: 'L1', address_name: 'Florida' },
    { address_level: 'L2', address_name: 'Tampa' },
  ],
};

/** `print_areas` như Get product variants trả (ví dụ trong tài liệu). */
const PRINT_AREAS_FRONT_BACK = [
  { key: 'CF', display_name: 'Front', width: 1083, height: 1564, dpi: 300, required: false },
  { key: 'FB', display_name: 'Back', width: 1083, height: 1564, dpi: 300, required: false },
];

/** Phương thức vận chuyển như Get available shipping methods of variant trả. */
const SHIPPING_METHODS: SellerwixShippingMethod[] = [
  {
    name: 'UPS Mail Innovations Expedited',
    code: 'UPS Mail Innovations Expedited',
    carrier: 'MI',
    type: 'domestic',
    active: true,
    shipping_rates: [{ country_code: 'US', deliverable: true, first_product: 10.5 }],
  },
  {
    name: 'Asendia ePAQ Select PMI',
    code: 'Asendia ePAQ Select PMI',
    carrier: 'Asendia',
    type: 'international',
    active: true,
    shipping_rates: [{ country_code: 'CA', deliverable: true }],
  },
];

interface Harness {
  /** Design đã upload của sản phẩm — mặc định FRONT. */
  placements?: Array<'FRONT' | 'BACK' | 'LEFT' | 'RIGHT'>;
  placementMap?: Record<string, string> | null;
  printAreas?: Array<{ key: string; display_name: string }>;
  existingStatus?: FulfillmentStatus | null;
  blockingOther?: { provider: FulfillmentProvider; status: FulfillmentStatus } | null;
  /** Lần lượt kết quả `GET /v1/order/{reference}?store_id` (404 = chưa có). */
  lookups?: Array<SellerwixOrder | 'NOT_FOUND' | Error>;
  create?: { id: string } | Error;
  lockBusy?: boolean;
  variantActive?: boolean;
  rushVariant?: boolean;
  twoItems?: boolean;
}

function notFound(): FulfillmentClientError {
  return new FulfillmentClientError(FulfillmentErrorClass.NOT_FOUND, 'order not found', 404, '404');
}

function detail(over: Partial<SellerwixOrder> = {}): SellerwixOrder {
  return {
    id: 'swx-order-1',
    reference_id: TIKTOK_ORDER,
    store_id: 'store-1',
    total_cost: 23.05,
    line_items: [{ id: '10676', reference_id: 'li-1', sku: SKU_BLACK_XL, item_cost: 10.45 }],
    fulfillments: [{ status: 'waiting for processing', shipping_cost: 6.5, trackings: [] }],
    ...over,
  };
}

function build(options: Harness = {}) {
  const placements = options.placements ?? ['FRONT'];
  const items = [
    {
      id: 'poi-1',
      tiktokLineItemId: 'li-1',
      productId: 'TT-P1',
      sellerSku: 'SELLER-1',
      productName: 'Tee',
    },
    ...(options.twoItems
      ? [
          {
            id: 'poi-2',
            tiktokLineItemId: 'li-2',
            productId: 'TT-P2',
            sellerSku: 'SELLER-2',
            productName: 'Tee 2',
          },
        ]
      : []),
  ];
  const order = {
    id: POD_ORDER,
    tiktokOrderId: TIKTOK_ORDER,
    status: 'AWAITING_SHIPMENT',
    recipientEnc: `enc:${JSON.stringify(RECIPIENT)}`,
    recipientMasked: false,
    recipientRegionCode: 'US',
    recipientPostalCode: '33602',
    shippingLabelUrl: null,
    shippingLabelSource: null,
    shippingLabelPackageId: null,
    shippingLabelTrackingNumber: null,
    shippingLabelAt: null,
    packages: [],
    sellerNote: null,
    items,
    account: { id: 'tt-1', accountName: 'Shop', fulfillmentAccountId: null },
  } as unknown as PodOrderWithRelations;

  const mappings = items.map((item, index) => ({
    id: `map-${index + 1}`,
    isActive: true,
    accountId: ACCOUNT.id,
    provider: FulfillmentProvider.SELLERWIX,
    tiktokProductId: item.productId,
    sellerSku: item.sellerSku,
    providerSku: index === 0 ? SKU_BLACK_XL : SKU_WHITE_S,
    baseCost: null,
    productionConfig: null,
    productionLine: null,
    placementMap: options.placementMap ?? null,
  }));
  const designs = items.flatMap((item) =>
    placements.map((placement) => ({
      tiktokProductId: item.productId,
      sellerSku: item.sellerSku,
      placement,
      storageFile: { publicUrl: `https://cdn.ncmedia/${item.productId}-${placement}.png` },
    })),
  );

  const record = {
    id: 'ful-1',
    organizationId: ORG,
    accountId: ACCOUNT.id,
    provider: FulfillmentProvider.SELLERWIX,
    podOrderId: POD_ORDER,
    externalOrderId: TIKTOK_ORDER,
    providerOrderId: null as string | null,
    status: options.existingStatus ?? FulfillmentStatus.DRAFT,
    providerStatus: null as string | null,
    trackingNumber: null as string | null,
    trackingStatus: null,
    trackingUrl: null,
    carrier: null,
    labelUrl: null,
    subtotal: null,
    shippingFee: null,
    total: null,
    lastErrorCode: null as string | null,
    submittedAt: null,
    cancelledAt: null,
    items: [] as unknown[],
  };
  let rows: Array<Record<string, unknown>> = [];
  const histories: Array<Record<string, unknown>> = [];
  const errorLogs: Array<Record<string, unknown>> = [];
  const updateOrder = jest.fn((_id: string, data: Record<string, unknown>) => {
    Object.assign(record, data);
    return Promise.resolve(record);
  });

  const repo = {
    findByPodOrder: jest.fn(() => Promise.resolve(options.existingStatus ? record : null)),
    findBlockingRecordOfOtherProvider: jest.fn().mockResolvedValue(options.blockingOther ?? null),
    findAccountById: jest.fn().mockResolvedValue(ACCOUNT),
    listMappingsForOrganization: jest.fn().mockResolvedValue(mappings),
    listProductDesigns: jest.fn().mockResolvedValue(designs),
    createDraft: jest.fn(() => Promise.resolve(record)),
    replaceItems: jest.fn((_id: string, _org: string, input: Array<Record<string, unknown>>) => {
      rows = input.map((row, index) => ({ ...row, id: `fi-${index + 1}` }));
      return Promise.resolve(rows);
    }),
    updateOrder,
    addHistory: jest.fn((entry: Record<string, unknown>) => {
      histories.push(entry);
      return Promise.resolve();
    }),
    addErrorLog: jest.fn((entry: Record<string, unknown>) => {
      errorLogs.push(entry);
      return Promise.resolve();
    }),
    touchAccountUsed: jest.fn().mockResolvedValue(undefined),
    updateAccount: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(() => Promise.resolve({ ...record, items: rows })),
    listItemsWithLineRef: jest.fn(() =>
      Promise.resolve(
        rows.map((row) => ({
          ...row,
          podOrderItem: {
            tiktokLineItemId: items.find((item) => item.id === row.podOrderItemId)
              ?.tiktokLineItemId,
          },
        })),
      ),
    ),
    applyProviderItemCosts: jest.fn(
      (_id: string, costs: Array<{ id: string; baseCost: number | null }>) => {
        rows = rows.map((row) => {
          const cost = costs.find((entry) => entry.id === row.id);
          return cost && cost.baseCost !== null
            ? { ...row, baseCost: new Prisma.Decimal(cost.baseCost) }
            : row;
        });
        return Promise.resolve(costs.length);
      },
    ),
  } as unknown as FulfillmentRepository;

  const catalogRepo = {
    findVariantsForAccount: jest.fn((_account: string, skus: string[]) =>
      Promise.resolve(
        skus.map((sku) => ({
          sku,
          status:
            options.variantActive === false
              ? FulfillmentCatalogItemStatus.INACTIVE
              : FulfillmentCatalogItemStatus.ACTIVE,
          rawData: {
            sku,
            is_rush_service: options.rushVariant ?? false,
            print_areas: options.printAreas ?? PRINT_AREAS_FRONT_BACK,
          },
        })),
      ),
    ),
  } as unknown as FulfillmentCatalogRepository;

  const lookups = [...(options.lookups ?? ['NOT_FOUND'])];
  const getOrderByReference = jest.fn(() => {
    const next = lookups.length > 1 ? lookups.shift() : lookups[0];
    if (next === 'NOT_FOUND') return Promise.reject(notFound());
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({ data: next, requestId: 'req-lookup', durationMs: 5, httpStatus: 200 });
  });
  const createOrder = jest.fn<Promise<unknown>, [unknown, SellerwixCreateOrderRequest]>(() =>
    options.create instanceof Error
      ? Promise.reject(options.create)
      : Promise.resolve({
          data: { id: options.create?.id ?? 'swx-order-1', reference_id: TIKTOK_ORDER },
          requestId: 'req-create',
          durationMs: 30,
          httpStatus: 200,
        }),
  );
  const getOrder = jest.fn().mockResolvedValue({
    data: detail(),
    requestId: 'req-detail',
    durationMs: 8,
    httpStatus: 200,
  });
  const listShippingMethods = jest.fn().mockResolvedValue({
    data: SHIPPING_METHODS,
    requestId: 'req-ship',
    durationMs: 4,
    httpStatus: 200,
  });
  const client = {
    getOrderByReference,
    createOrder,
    getOrder,
    listShippingMethods,
  } as unknown as SellerwixApiClient;

  const lock = {
    withLock: <T>(_key: string, _ttl: number, task: () => Promise<T>) =>
      options.lockBusy ? Promise.resolve(null) : task(),
  } as unknown as DistributedLockService;

  const service = new SellerwixFulfillmentService(
    { get: () => undefined } as unknown as ConfigService,
    repo,
    catalogRepo,
    { findById: jest.fn().mockResolvedValue(order) } as unknown as PodOrderRepository,
    new FulfillmentReadinessService(encryption, new MangoOrderMapper()),
    client,
    new SellerwixOrderMapper(),
    new SellerwixCredentialService(encryption),
    lock,
  );

  return {
    service,
    repo,
    order,
    record,
    histories,
    errorLogs,
    rows: () => rows,
    updateOrder,
    createOrder,
    getOrderByReference,
    getOrder,
    listShippingMethods,
  };
}

const SEND = { fulfillmentAccountId: ACCOUNT.id, shippingMethod: 'UPS Mail Innovations Expedited' };

describe('SellerwixFulfillmentService.fulfill — request thật gửi Sellerwix', () => {
  it('CASE 3/4/6 — tạo đơn: đúng SKU biến thể, vị trí in theo print_areas, địa chỉ, vận chuyển; lưu sellerwixOrderId', async () => {
    const h = build();

    const result = await h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND);

    expect(h.createOrder).toHaveBeenCalledTimes(1);
    const request = h.createOrder.mock.calls[0][1];
    expect(request).toEqual({
      reference_id: TIKTOK_ORDER,
      store_id: 'store-1',
      address: {
        name: 'John Doe',
        address1: '123 Main St',
        city: 'Tampa',
        zip: '33602',
        country: 'US',
        state: 'Florida',
        phone: '5551234567',
      },
      line_items: [
        {
          sku: SKU_BLACK_XL,
          quantity: 1,
          shipping_method: 'UPS Mail Innovations Expedited',
          reference_id: 'li-1',
          print_areas: [{ key: 'CF', url: 'https://cdn.ncmedia/TT-P1-FRONT.png' }],
        },
      ],
    });
    expect(result.providerOrderId).toBe('swx-order-1');
    expect(result.status).toBe(FulfillmentStatus.SUBMITTED);
    // Đã tra reference_id TRƯỚC khi tạo (idempotency).
    expect(h.getOrderByReference.mock.invocationCallOrder[0]).toBeLessThan(
      h.createOrder.mock.invocationCallOrder[0],
    );
  });

  it('CASE 5 — nhiều vị trí in: FRONT→CF, BACK→FB, LEFT theo placementMap khai sẵn', async () => {
    const h = build({
      placements: ['FRONT', 'BACK', 'LEFT'],
      placementMap: { LEFT: 'LS' },
      printAreas: [...PRINT_AREAS_FRONT_BACK, { key: 'LS', display_name: 'Left Sleeve' }],
    });

    await h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND);

    const areas = h.createOrder.mock.calls[0][1].line_items[0].print_areas ?? [];
    expect(areas.map((area) => area.key).sort()).toEqual(['CF', 'FB', 'LS']);
    expect(areas.find((area) => area.key === 'LS')?.url).toBe('https://cdn.ncmedia/TT-P1-LEFT.png');
  });

  it('vị trí in KHÔNG có trong print_areas của biến thể ⇒ PLACEMENT_UNSUPPORTED, không gọi Sellerwix', async () => {
    const h = build({ placements: ['FRONT', 'RIGHT'] });

    await expect(
      h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND),
    ).rejects.toBeInstanceOf(FulfillmentNotReadyException);
    expect(h.createOrder).not.toHaveBeenCalled();
  });

  it('nhiều dòng hàng ⇒ mỗi dòng đúng SKU + reference_id line item TikTok; chi phí ghép theo reference_id', async () => {
    const h = build({ twoItems: true });
    h.getOrder.mockResolvedValueOnce({
      data: detail({
        line_items: [
          { id: '1', reference_id: 'li-2', sku: SKU_WHITE_S, item_cost: 7.1 },
          { id: '2', reference_id: 'li-1', sku: SKU_BLACK_XL, item_cost: 10.45 },
        ],
      }),
      requestId: 'req-detail',
      durationMs: 8,
      httpStatus: 200,
    });

    await h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND);

    const lines = h.createOrder.mock.calls[0][1].line_items;
    expect(lines.map((line) => [line.sku, line.reference_id])).toEqual([
      [SKU_BLACK_XL, 'li-1'],
      [SKU_WHITE_S, 'li-2'],
    ]);
    const costs = h.rows().map((row) => Number(row.baseCost));
    expect(costs).toEqual([10.45, 7.1]);
  });

  it('không chọn phương thức vận chuyển ⇒ chặn TRƯỚC khi gọi, nêu đúng field', async () => {
    const h = build();

    const error = await h.service
      .fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, {
        fulfillmentAccountId: ACCOUNT.id,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FulfillmentValidationException);
    expect(JSON.stringify((error as FulfillmentValidationException).getResponse())).toContain(
      'shipping_method',
    );
    expect(h.createOrder).not.toHaveBeenCalled();
  });

  it('phương thức không giao được tới quốc gia người nhận ⇒ chặn, liệt kê phương thức hợp lệ', async () => {
    const h = build();

    await expect(
      h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, {
        fulfillmentAccountId: ACCOUNT.id,
        shippingMethod: 'Asendia ePAQ Select PMI',
      }),
    ).rejects.toThrow(/UPS Mail Innovations Expedited/);
    expect(h.createOrder).not.toHaveBeenCalled();
  });

  it('CASE 12 (backend) — tuỳ chọn chỉ của Mango (facility/speed type/scan label) bị TỪ CHỐI, không lặng lẽ bỏ qua', async () => {
    const h = build();

    await expect(
      h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, {
        ...SEND,
        facility: 'TX',
        isScanLabel: true,
      }),
    ).rejects.toThrow(/facility, isScanLabel/);
    expect(h.createOrder).not.toHaveBeenCalled();
  });

  it('rush service chỉ khi MỌI biến thể is_rush_service=true', async () => {
    const off = build({ rushVariant: false });
    await expect(
      off.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, {
        ...SEND,
        rushService: true,
      }),
    ).rejects.toThrow(/rush service/);

    const on = build({ rushVariant: true });
    await on.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, {
      ...SEND,
      rushService: true,
    });
    expect(on.createOrder.mock.calls[0][1].rush_service).toBe(true);
  });

  it('biến thể đã ngừng bán trong danh mục ⇒ chặn trước khi gọi', async () => {
    const h = build({ variantActive: false });
    await expect(
      h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND),
    ).rejects.toThrow(/INACTIVE/);
    expect(h.createOrder).not.toHaveBeenCalled();
  });

  it('🔴 raw_request lưu DB đã che PII người nhận', async () => {
    const h = build();
    await h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND);

    const calls = h.updateOrder.mock.calls as Array<
      [string, { rawRequest?: { address: Record<string, string> } }]
    >;
    const update = calls.find(([, data]) => data.rawRequest)?.[1];
    expect(update?.rawRequest).toBeDefined();
    expect(update?.rawRequest?.address).toMatchObject({
      name: 'J***',
      address1: '1***',
      phone: '5***',
      city: 'Tampa',
      zip: '33602',
    });
  });
});

describe('SellerwixFulfillmentService — idempotency & retry', () => {
  it('CASE 7 — đơn đã SUBMITTED ⇒ bấm lần hai bị chặn, KHÔNG gọi Sellerwix', async () => {
    const h = build({ existingStatus: FulfillmentStatus.SUBMITTED });
    await expect(
      h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND),
    ).rejects.toBeInstanceOf(FulfillmentAlreadySubmittedException);
    expect(h.getOrderByReference).not.toHaveBeenCalled();
    expect(h.createOrder).not.toHaveBeenCalled();
  });

  it('CASE 7 — hai cú bấm đồng thời: cú thứ hai không lấy được khoá ⇒ 409, không gọi API', async () => {
    const h = build({ lockBusy: true });
    await expect(
      h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND),
    ).rejects.toBeInstanceOf(FulfillmentAlreadySubmittedException);
    expect(h.createOrder).not.toHaveBeenCalled();
  });

  it('🔴 đơn đã tồn tại ở Sellerwix (reference_id) ⇒ LIÊN KẾT, không tạo đơn thứ hai', async () => {
    const h = build({ lookups: [detail({ id: 'swx-existing' })] });

    const result = await h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND);

    expect(h.createOrder).not.toHaveBeenCalled();
    expect(result.providerOrderId).toBe('swx-existing');
    expect(h.histories.some((entry) => String(entry.message).includes('KHÔNG tạo lại'))).toBe(true);
  });

  it('CASE 8 — timeout sau khi gửi, Sellerwix THỰC RA đã tạo ⇒ tra lại và liên kết, không FAILED', async () => {
    const timeout = new FulfillmentClientError(
      FulfillmentErrorClass.NETWORK,
      'Sellerwix không phản hồi sau 30000ms',
    );
    const h = build({ lookups: ['NOT_FOUND', detail({ id: 'swx-late' })], create: timeout });

    const result = await h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND);

    expect(h.createOrder).toHaveBeenCalledTimes(1);
    expect(result.providerOrderId).toBe('swx-late');
    expect(result.status).not.toBe(FulfillmentStatus.FAILED);
  });

  it('CASE 8/11 — timeout và CHƯA có đơn ⇒ FAILED (thử lại được); Retry tra trước rồi mới tạo — đúng MỘT đơn', async () => {
    const timeout = new FulfillmentClientError(
      FulfillmentErrorClass.NETWORK,
      'Sellerwix không phản hồi sau 30000ms',
    );
    const first = build({ lookups: ['NOT_FOUND'], create: timeout });

    await expect(
      first.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND),
    ).rejects.toBeInstanceOf(FulfillmentProviderTimeoutException);
    expect(first.record.status).toBe(FulfillmentStatus.FAILED);
    expect(first.errorLogs[0]).toMatchObject({
      provider: FulfillmentProvider.SELLERWIX,
      retryable: true,
    });

    // Lần Retry: đơn ĐÃ tới Sellerwix trễ ⇒ tra thấy ⇒ liên kết, KHÔNG tạo lần hai.
    const retry = build({
      existingStatus: FulfillmentStatus.FAILED,
      lookups: [detail({ id: 'swx-late' })],
    });
    const result = await retry.service.fulfill(
      ORG,
      USER,
      POD_ORDER,
      FulfillmentTrigger.RETRY,
      SEND,
    );
    expect(retry.createOrder).not.toHaveBeenCalled();
    expect(result.providerOrderId).toBe('swx-late');
  });

  it('tra reference_id lỗi (không phải 404) ⇒ KHÔNG tạo đơn (không chắc chưa có)', async () => {
    const h = build({
      lookups: [
        new FulfillmentClientError(
          FulfillmentErrorClass.SERVER,
          'Internal Server Error',
          500,
          '500',
        ),
      ],
    });

    await expect(
      h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND),
    ).rejects.toThrow(/Sellerwix fulfillment failed/);
    expect(h.createOrder).not.toHaveBeenCalled();
    expect(h.record.status).toBe(FulfillmentStatus.FAILED);
  });

  it('CASE 9 — Sellerwix từ chối (400) ⇒ lỗi hiển thị NGUYÊN VĂN lý do kèm tên nhà cung cấp, đơn FAILED', async () => {
    const rejected = new FulfillmentClientError(
      FulfillmentErrorClass.VALIDATION,
      'shipping method is not available for sku',
      400,
      '400',
    );
    const h = build({ create: rejected });

    const error = await h.service
      .fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FulfillmentValidationException);
    expect((error as Error).message).toBe(
      'Sellerwix fulfillment failed — Reason: shipping method is not available for sku',
    );
    expect(h.record.status).toBe(FulfillmentStatus.FAILED);
    expect(h.record.lastErrorCode).toBe('400');
    // VALIDATION không tự tra lại (không mơ hồ) và không được đánh dấu thử lại được.
    expect(h.getOrderByReference).toHaveBeenCalledTimes(1);
    expect(h.errorLogs[0]).toMatchObject({
      errorClass: 'VALIDATION',
      retryable: false,
      httpStatus: 400,
    });
  });

  it('đơn đang được nhà cung cấp KHÁC sản xuất ⇒ chặn (không sản xuất hai lần)', async () => {
    const h = build({
      blockingOther: {
        provider: FulfillmentProvider.MANGO,
        status: FulfillmentStatus.IN_PRODUCTION,
      },
    });
    await expect(
      h.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, SEND),
    ).rejects.toBeInstanceOf(FulfillmentSubmittedToOtherProviderException);
    expect(h.createOrder).not.toHaveBeenCalled();
  });
});

describe('SellerwixFulfillmentService.applyProviderState — trạng thái & tracking', () => {
  it('CASE 10 — shipped + tracking ⇒ SHIPPED, lưu tracking number/url/carrier, che PII trong raw_response', async () => {
    const h = build();
    Object.assign(h.record, {
      providerOrderId: 'swx-order-1',
      status: FulfillmentStatus.IN_PRODUCTION,
    });

    const changed = await h.service.applyProviderState(
      h.record as never,
      detail({
        address: { name: 'John Doe', address1: '123 Main St', city: 'Tampa' },
        fulfillments: [
          {
            status: 'shipped',
            trackings: [
              {
                tracking_number: 'OLD1',
                tracking_date: '2023-11-06T23:01:18.013Z',
                carrier_code: 'USPS',
              },
              {
                tracking_number: 'AG12345678',
                tracking_url: 'https://track.easypost.com/urlvalue',
                tracking_date: '2023-12-26T17:08:33.323Z',
                carrier_code: 'DHLGM',
                listing_status: 'In Queue',
              },
            ],
          },
        ],
      }),
      FulfillmentTrigger.CRON,
    );

    expect(changed).toBe(true);
    expect(h.record).toMatchObject({
      status: FulfillmentStatus.SHIPPED,
      providerStatus: 'shipped',
      trackingNumber: 'AG12345678',
      trackingUrl: 'https://track.easypost.com/urlvalue',
      carrier: 'DHLGM',
      trackingStatus: 'In Queue',
    });
    const raw = (h.record as unknown as { rawResponse: { address: { name: string } } }).rawResponse;
    expect(raw.address.name).toBe('J***');
    expect(h.histories.some((entry) => entry.eventType === 'SHIPMENT_UPDATED')).toBe(true);
  });

  it('`error` kèm message ⇒ ON_HOLD, lỗi nhà cung cấp hiện lên bản ghi; hết lỗi ⇒ xoá', async () => {
    const h = build();
    Object.assign(h.record, {
      providerOrderId: 'swx-order-1',
      status: FulfillmentStatus.SUBMITTED,
    });

    await h.service.applyProviderState(
      h.record as never,
      detail({ fulfillments: [{ status: 'error', message: 'Insufficient funds' }] }),
      FulfillmentTrigger.WEBHOOK,
    );
    expect(h.record).toMatchObject({
      status: FulfillmentStatus.ON_HOLD,
      lastErrorMessage: 'Insufficient funds',
    });

    await h.service.applyProviderState(
      h.record as never,
      detail({ fulfillments: [{ status: 'in supplier' }] }),
      FulfillmentTrigger.WEBHOOK,
    );
    expect(h.record).toMatchObject({
      status: FulfillmentStatus.IN_PRODUCTION,
      lastErrorMessage: null,
    });
  });

  it('id đơn trong dữ liệu KHÁC bản ghi ⇒ không áp (không bao giờ ghi dữ liệu đơn khác)', async () => {
    const h = build();
    Object.assign(h.record, { providerOrderId: 'swx-order-1' });

    const changed = await h.service.applyProviderState(
      h.record as never,
      detail({ id: 'another-order', fulfillments: [{ status: 'shipped' }] }),
      FulfillmentTrigger.WEBHOOK,
    );

    expect(changed).toBe(false);
    expect(h.updateOrder).not.toHaveBeenCalled();
  });
});

describe('SellerwixFulfillmentService.shippingMethods', () => {
  it('chỉ trả phương thức MỌI SKU của đơn cùng hỗ trợ và giao được tới quốc gia người nhận', async () => {
    const h = build({ twoItems: true });
    h.listShippingMethods
      .mockResolvedValueOnce({
        data: SHIPPING_METHODS,
        requestId: 'a',
        durationMs: 1,
        httpStatus: 200,
      })
      .mockResolvedValueOnce({
        data: [SHIPPING_METHODS[0]],
        requestId: 'b',
        durationMs: 1,
        httpStatus: 200,
      });

    const mappings = await h.repo.listMappingsForOrganization(ORG);
    const result = await h.service.shippingMethods(ACCOUNT as never, h.order, mappings);

    expect(result.options).toEqual([
      {
        value: 'UPS Mail Innovations Expedited',
        label: 'UPS Mail Innovations Expedited · MI · domestic',
      },
    ]);
    expect(result.warnings).toEqual([]);
  });
});
