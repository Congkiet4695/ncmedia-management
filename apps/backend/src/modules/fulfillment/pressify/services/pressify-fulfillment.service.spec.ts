import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentCatalogItemStatus,
  FulfillmentEventType,
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
  FulfillmentClientError,
  FulfillmentErrorClass,
  FulfillmentNotReadyException,
  FulfillmentReconciliationPendingException,
  FulfillmentValidationException,
} from '../../exceptions/fulfillment.exceptions';
import { MangoOrderMapper } from '../../mango/mappers/mango-order.mapper';
import { FulfillmentCatalogRepository } from '../../repositories/fulfillment-catalog.repository';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { FulfillmentReadinessService } from '../../services/fulfillment-readiness.service';
import {
  PRESSIFY_BUSINESS_RULE_CODE,
  PressifyApiClient,
  type PressifyCreateOrderBody,
} from '../clients/pressify-api.client';
import { PressifyOrderMapper } from '../mappers/pressify-order.mapper';
import type { PressifyOrder } from '../types/pressify-api.types';
import { PressifyCredentialService } from './pressify-credential.service';
import { PressifyFulfillmentService } from './pressify-fulfillment.service';

/**
 * **Gửi đơn POD sang Pressify — readiness / mapper / credential là code THẬT, chỉ HTTP + DB là giả.**
 * Chứng minh request đi ra mang ĐÚNG variant_id / mockup / file in / địa chỉ hoặc nhãn theo tài liệu Pressify.
 */

const ORG = 'org-1';
const USER = 'user-1';
const POD_ORDER = 'pod-order-1';
const TIKTOK_ORDER = '576000000000000001';
const KEY = 'store-key-SECRET';

const encryption = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

const ACCOUNT = {
  id: 'acc-psf',
  organizationId: ORG,
  provider: FulfillmentProvider.PRESSIFY,
  name: 'Pressify US',
  isActive: true,
  apiKeyEnc: `enc:${KEY}`,
  providerConfig: { tierId: '13' },
  baseUrlOverride: null,
  defaultShippingMethod: 'standard',
};

const RECIPIENT = {
  first_name: 'Jane',
  last_name: 'Doe',
  phone_number: '5551234567',
  address_line1: '123 Main St',
  postal_code: '78701',
  region_code: 'US',
  district_info: [
    { address_level: 'L1', address_name: 'TX' },
    { address_level: 'L2', address_name: 'Austin' },
  ],
};

interface Harness {
  /** variant_id trên ánh xạ (mặc định '188'; null = ánh xạ chưa chọn biến thể Pressify). */
  variantIds?: Array<string | null>;
  /** Style của biến thể trong danh mục đã đồng bộ. */
  style?: string;
  variantStatus?: FulfillmentCatalogItemStatus;
  /** Biến thể không có trong danh mục đã đồng bộ. */
  missingInCatalog?: boolean;
  labelUrl?: string | null;
  skuImage?: string | null;
  twoItems?: boolean;
  create?: { data: number } | Error;
  /** Phần tử của GET /orders lần lượt theo trang (tra ref_id). */
  listPages?: Array<Array<Partial<PressifyOrder>> | Error>;
  detail?: Partial<PressifyOrder>;
  existingStatus?: FulfillmentStatus;
  providerOrderId?: string | null;
  cancel?: { status: string; msg: string };
  mappingBaseCost?: number | null;
  placements?: Array<'FRONT' | 'BACK' | 'LEFT' | 'LABEL'>;
}

function detailOf(over: Partial<PressifyOrder> = {}): PressifyOrder {
  return {
    id: 2885109,
    ref_id: TIKTOK_ORDER,
    fulfill_status: 'pending',
    payment_status: 'unpaid',
    total_cost: '12.97',
    print_cost: '7.98',
    shipping_cost: '4.99',
    first_name: 'Jane',
    last_name: 'Doe',
    address_1: '123 Main St',
    created_at: new Date().toISOString(),
    items: [{ id: 3218607, price: '7.98', quantity: 1, variant_id: '188' }],
    ...over,
  };
}

function build(options: Harness = {}) {
  const variantIds = options.variantIds ?? (options.twoItems ? ['188', '188'] : ['188']);
  const placements = options.placements ?? ['FRONT'];
  const items = variantIds.map((_, index) => ({
    id: `poi-${index + 1}`,
    tiktokLineItemId: `li-${index + 1}`,
    productId: `TT-P${index + 1}`,
    skuId: `TT-V${index + 1}`,
    sellerSku: `SELLER-${index + 1}`,
    productName: `Retro Sunset Tee ${index + 1}`,
    skuImage:
      options.skuImage === undefined
        ? `https://p16.tiktokcdn/sku-${index + 1}.jpg`
        : options.skuImage,
  }));
  const order = {
    id: POD_ORDER,
    tiktokOrderId: TIKTOK_ORDER,
    status: 'AWAITING_SHIPMENT',
    recipientEnc: `enc:${JSON.stringify(RECIPIENT)}`,
    recipientMasked: false,
    recipientRegionCode: 'US',
    recipientPostalCode: '78701',
    shippingLabelUrl: options.labelUrl ?? null,
    shippingLabelSource: options.labelUrl ? 'TIKTOK' : null,
    shippingLabelPackageId: null,
    shippingLabelTrackingNumber: null,
    shippingLabelAt: options.labelUrl ? new Date() : null,
    packages: [],
    sellerNote: null,
    items,
    account: { id: 'tt-1', accountName: 'Shop', fulfillmentAccountId: null },
  } as unknown as PodOrderWithRelations;

  const mappings = items.map((item, index) => ({
    id: `map-${index + 1}`,
    isActive: true,
    accountId: ACCOUNT.id,
    provider: FulfillmentProvider.PRESSIFY,
    tiktokProductId: item.productId,
    tiktokSkuId: item.skuId,
    sellerSku: item.sellerSku,
    // SKU Pressify có thể RỖNG — định danh là providerVariantId.
    providerSku: '',
    providerVariantId: variantIds[index],
    baseCost:
      options.mappingBaseCost === undefined ? new Prisma.Decimal('5.39') : options.mappingBaseCost,
    productionConfig: null,
    productionLine: null,
    placementMap: null,
  }));
  const designs = items.flatMap((item) =>
    placements.map((placement) => ({
      tiktokProductId: item.productId,
      tiktokSkuId: item.skuId,
      sellerSku: item.sellerSku,
      placement,
      sourceUrl: null,
      storageFile: { publicUrl: `https://cdn.ncmedia/${item.productId}-${placement}.png` },
    })),
  );

  const record = {
    id: 'ful-1',
    organizationId: ORG,
    accountId: ACCOUNT.id,
    provider: FulfillmentProvider.PRESSIFY,
    podOrderId: POD_ORDER,
    externalOrderId: TIKTOK_ORDER,
    providerOrderId: options.providerOrderId ?? (null as string | null),
    status: options.existingStatus ?? FulfillmentStatus.DRAFT,
    providerStatus: null as string | null,
    trackingNumber: null as string | null,
    trackingUrl: null,
    carrier: null,
    labelUrl: null,
    subtotal: null,
    shippingFee: null,
    total: null,
    currency: null,
    lastErrorCode: null as string | null,
    submittedAt: null as Date | null,
    createdAt: new Date(),
    cancelledAt: null,
  };
  let rows: Array<Record<string, unknown>> = [];
  const histories: Array<Record<string, unknown>> = [];
  const updateOrder = jest.fn((_id: string, data: Record<string, unknown>) => {
    Object.assign(record, data);
    return Promise.resolve(record);
  });
  const repo = {
    findByPodOrder: jest.fn(() => Promise.resolve(options.existingStatus ? record : null)),
    countAttempts: jest.fn().mockResolvedValue(0),
    supersedeCancelled: jest.fn().mockResolvedValue(true),
    findBlockingRecordOfOtherProvider: jest.fn().mockResolvedValue(null),
    findAccountById: jest.fn().mockResolvedValue(ACCOUNT),
    listMappingsForOrganization: jest.fn().mockResolvedValue(mappings),
    listProductDesigns: jest.fn().mockResolvedValue(designs),
    createDraft: jest.fn(() => Promise.resolve(record)),
    replaceItems: jest.fn((_id: string, _org: string, input: Array<Record<string, unknown>>) => {
      rows = input.map((row, index) => ({
        ...row,
        id: `fi-${index + 1}`,
        baseCostConfirmedAt: null,
        providerItemId: null,
      }));
      return Promise.resolve(rows);
    }),
    updateOrder,
    addHistory: jest.fn((entry: Record<string, unknown>) => {
      histories.push(entry);
      return Promise.resolve();
    }),
    addErrorLog: jest.fn().mockResolvedValue(undefined),
    touchAccountUsed: jest.fn().mockResolvedValue(undefined),
    updateAccount: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(() => Promise.resolve({ ...record, items: rows })),
    listItemsWithLineRef: jest.fn(() => Promise.resolve(rows)),
    applyProviderItemCosts: jest.fn().mockResolvedValue(1),
  } as unknown as FulfillmentRepository;

  const catalogRepo = {
    findVariantsByExternalIds: jest.fn((_account: string, ids: string[]) =>
      Promise.resolve(
        options.missingInCatalog
          ? []
          : ids.map((id) => ({
              externalVariantId: id,
              sku: '',
              status: options.variantStatus ?? FulfillmentCatalogItemStatus.ACTIVE,
              rawData: { variant_id: Number(id), product_style: options.style ?? 'T-shirt' },
            })),
      ),
    ),
  } as unknown as FulfillmentCatalogRepository;

  const pages = [...(options.listPages ?? [[]])];
  const listOrders = jest.fn(() => {
    const next = pages.length > 1 ? pages.shift() : pages[0];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      data: { data: next, meta: { current_page: 1, last_page: 1 } },
      requestId: 'req-list',
      durationMs: 3,
      httpStatus: 200,
    });
  });
  const createOrder = jest.fn<Promise<unknown>, [unknown, PressifyCreateOrderBody]>(() =>
    options.create instanceof Error
      ? Promise.reject(options.create)
      : Promise.resolve({
          data: {
            data: options.create?.data ?? 2885109,
            price: { total: 12.97 },
            msg: '',
            status: 'success',
          },
          requestId: 'req-create',
          durationMs: 20,
          httpStatus: 200,
        }),
  );
  const getOrder = jest.fn(() =>
    Promise.resolve({
      data: detailOf(options.detail),
      requestId: 'req-detail',
      durationMs: 5,
      httpStatus: 200,
    }),
  );
  const cancelOrder = jest.fn(() =>
    Promise.resolve({
      data: {
        data: 2885109,
        ...(options.cancel ?? { status: 'success', msg: 'Order was canceled successfully' }),
      },
      requestId: 'req-cancel',
      durationMs: 5,
      httpStatus: 200,
    }),
  );
  const listAccessories = jest.fn();
  const client = {
    createOrder,
    getOrder,
    listOrders,
    cancelOrder,
    listAccessories,
  } as unknown as PressifyApiClient;

  const lock = {
    withLock: <T>(_key: string, _ttl: number, task: () => Promise<T>) => task(),
  } as unknown as DistributedLockService;

  const service = new PressifyFulfillmentService(
    { get: () => undefined } as unknown as ConfigService,
    repo,
    catalogRepo,
    { findById: jest.fn().mockResolvedValue(order) } as unknown as PodOrderRepository,
    new FulfillmentReadinessService(encryption, new MangoOrderMapper()),
    client,
    new PressifyOrderMapper(),
    new PressifyCredentialService(encryption),
    lock,
  );
  return {
    service,
    record,
    histories,
    rows: () => rows,
    repoMocks: repo as unknown as Record<string, jest.Mock>,
    createOrder,
    getOrder,
    listOrders,
    cancelOrder,
    listAccessories,
  };
}

const fulfill = (harness: ReturnType<typeof build>, options: Record<string, unknown> = {}) =>
  harness.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, {
    fulfillmentAccountId: ACCOUNT.id,
    ...options,
  });

/** Tham số thứ `index` của lần gọi `call` (âm = đếm từ cuối) — có kiểu, không đụng `any`. */
function argOf<T>(mock: jest.Mock, call: number, index: number): T {
  const calls = mock.mock.calls as unknown[][];
  return calls[call < 0 ? calls.length + call : call]?.[index] as T;
}

describe('PressifyFulfillmentService — gửi đơn', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('Pressify mua nhãn: body đúng hợp đồng tài liệu — variant_id, mockup, print_files, address; KHÔNG field nhà cung cấp khác', async () => {
    const harness = build();

    await fulfill(harness);

    expect(harness.createOrder).toHaveBeenCalledTimes(1);
    const body = harness.createOrder.mock.calls[0][1];
    expect(body).toEqual({
      ref_id: TIKTOK_ORDER,
      order_status: 'new_order',
      shipping_method: 'standard',
      address: {
        name: 'Jane Doe',
        phone: '5551234567',
        street1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'US',
      },
      line_items: [
        {
          variant_id: 188,
          quantity: 1,
          product_name: 'Retro Sunset Tee 1',
          mockup: 'https://p16.tiktokcdn/sku-1.jpg',
          print_files: [{ key: 'front', url: 'https://cdn.ncmedia/TT-P1-FRONT.png' }],
        },
      ],
    });
    // Không có field của Mango / Sellerwix, không có key trong object request.
    const json = JSON.stringify(body);
    for (const foreign of [
      'store_id',
      'facility',
      'speed_type',
      'rush_service',
      'production_line',
      'sku',
      'api_key',
    ]) {
      expect(json).not.toContain(`"${foreign}"`);
    }
    expect(harness.record.status).toBe(FulfillmentStatus.SUBMITTED);
    expect(harness.record.providerOrderId).toBe('2885109');
    expect(harness.record.currency).toBe('USD');
    // Đọc lại chi tiết đơn ngay sau khi tạo.
    expect(harness.getOrder).toHaveBeenCalledWith(expect.anything(), '2885109');
    expect(harness.record.providerStatus).toBe('pending');
  });

  it('raw_request lưu xuống đã che PII và KHÔNG có api_key', async () => {
    const harness = build();
    await fulfill(harness);
    const stored = harness.repoMocks.updateOrder.mock.calls
      .map(([, data]) => (data as Record<string, unknown>).rawRequest)
      .find(Boolean);
    const json = JSON.stringify(stored);
    expect(json).not.toContain('Jane Doe');
    expect(json).not.toContain('123 Main St');
    expect(json).not.toContain(KEY);
  });

  it('Base Cost: ảnh chụp từ Product Mapping chép vào dòng hàng lúc gửi (không lấy từ danh mục global)', async () => {
    const harness = build({ mappingBaseCost: new Prisma.Decimal('5.39') as unknown as number });
    await fulfill(harness);
    expect(argOf<unknown[]>(harness.repoMocks.replaceItems, 0, 2)).toEqual([
      expect.objectContaining({ podOrderItemId: 'poi-1', providerSku: '', baseCost: 5.39 }),
    ]);
  });

  it('Đơn có nhãn vận chuyển ⇒ gửi shipping_label, KHÔNG gửi address', async () => {
    const harness = build({ labelUrl: 'https://cdn.ncmedia/labels/tt.pdf' });
    await fulfill(harness);
    const body = harness.createOrder.mock.calls[0][1];
    expect(body.shipping_label).toBe('https://cdn.ncmedia/labels/tt.pdf');
    expect(body).not.toHaveProperty('address');
  });

  it('Tuỳ chọn Pressify: priority + DTG (T-shirt) ⇒ order_status / production đúng; DTF ⇒ không gửi production', async () => {
    const dtg = build();
    await fulfill(dtg, {
      handlingType: 'priority',
      printMethod: 'DTG',
      shippingMethod: 'priority',
    });
    expect(dtg.createOrder.mock.calls[0][1]).toMatchObject({
      order_status: 'priority',
      production: 'DTG',
      shipping_method: 'priority',
    });

    const dtf = build();
    await fulfill(dtf, { printMethod: 'DTF' });
    expect(dtf.createOrder.mock.calls[0][1]).not.toHaveProperty('production');
  });

  it('Thiếu ảnh SKU TikTok ⇒ mockup = file in mặt đầu tiên (Pressify bắt buộc ít nhất một mockup)', async () => {
    const harness = build({ skuImage: null });
    await fulfill(harness);
    expect(harness.createOrder.mock.calls[0][1].line_items[0].mockup).toBe(
      'https://cdn.ncmedia/TT-P1-FRONT.png',
    );
  });

  it.each([
    ['facility (Mango)', { facility: 'US' }],
    ['speedType (Mango)', { speedType: 'rush' }],
    ['rushService (Sellerwix)', { rushService: true }],
    ['handlingType lạ', { handlingType: 'oversize' }],
    ['printMethod lạ', { printMethod: 'SCREEN' }],
    ['shippingMethod của Mango', { shippingMethod: 'express' }],
  ])('Từ chối tuỳ chọn không thuộc Pressify: %s — không gọi Pressify', async (_label, option) => {
    const harness = build();
    await expect(fulfill(harness, option)).rejects.toBeInstanceOf(FulfillmentValidationException);
    expect(harness.createOrder).not.toHaveBeenCalled();
  });

  it('Ánh xạ chưa có variant_id Pressify ⇒ chặn, nói rõ cách sửa', async () => {
    const harness = build({ variantIds: [null] });
    const error = (await fulfill(harness).catch(
      (caught: unknown) => caught,
    )) as FulfillmentValidationException;
    expect(error).toBeInstanceOf(FulfillmentValidationException);
    expect(JSON.stringify(error.getResponse())).toContain('variant_id');
    expect(harness.createOrder).not.toHaveBeenCalled();
  });

  it('variant_id chưa có trong danh mục đã đồng bộ / đã ngừng bán ⇒ chặn trước khi gọi Pressify', async () => {
    const missing = build({ missingInCatalog: true });
    await expect(fulfill(missing)).rejects.toBeInstanceOf(FulfillmentValidationException);
    const inactive = build({ variantStatus: FulfillmentCatalogItemStatus.INACTIVE });
    await expect(fulfill(inactive)).rejects.toBeInstanceOf(FulfillmentValidationException);
    expect(missing.createOrder).not.toHaveBeenCalled();
    expect(inactive.createOrder).not.toHaveBeenCalled();
  });

  it('DTG cho style không hỗ trợ (Poster) hoặc vị trí ngoài Front/Back ⇒ chặn', async () => {
    const poster = build({ style: 'Poster' });
    await expect(fulfill(poster, { printMethod: 'DTG' })).rejects.toBeInstanceOf(
      FulfillmentValidationException,
    );
    const sleeve = build({ placements: ['FRONT', 'LEFT'] });
    await expect(fulfill(sleeve, { printMethod: 'DTG' })).rejects.toBeInstanceOf(
      FulfillmentValidationException,
    );
    expect(poster.createOrder).not.toHaveBeenCalled();
    expect(sleeve.createOrder).not.toHaveBeenCalled();
  });

  it('Design chỉ có nhãn cổ (LABEL — Pressify không có vị trí này) ⇒ readiness chặn, không gửi sai chỗ', async () => {
    const harness = build({ placements: ['LABEL'] });
    await expect(fulfill(harness)).rejects.toBeInstanceOf(FulfillmentNotReadyException);
    expect(harness.createOrder).not.toHaveBeenCalled();
  });

  it('422 "ref id has already been taken" ⇒ tra GET /orders theo ref_id ⇒ LIÊN KẾT đơn có sẵn, không tạo lại', async () => {
    const harness = build({
      create: new FulfillmentClientError(
        FulfillmentErrorClass.VALIDATION,
        'The ref id has already been taken.',
        422,
      ),
      listPages: [
        [
          { id: 999, ref_id: 'someone-else' },
          { id: 2885109, ref_id: TIKTOK_ORDER },
        ],
      ],
    });

    await fulfill(harness);

    expect(harness.createOrder).toHaveBeenCalledTimes(1);
    expect(harness.listOrders).toHaveBeenCalled();
    expect(harness.record.status).toBe(FulfillmentStatus.SUBMITTED);
    expect(harness.record.providerOrderId).toBe('2885109');
    expect(
      harness.histories.some((entry) => (entry.payload as { adopted?: boolean })?.adopted),
    ).toBe(true);
  });

  it('Lỗi mạng khi tạo + tra không thấy ⇒ FAILED (gửi lại an toàn)', async () => {
    const harness = build({
      create: new FulfillmentClientError(FulfillmentErrorClass.NETWORK, 'timeout'),
      listPages: [[]],
    });
    await expect(fulfill(harness)).rejects.toBeDefined();
    expect(harness.record.status).toBe(FulfillmentStatus.FAILED);
  });

  it('Lỗi mạng khi tạo + tra cũng lỗi ⇒ giữ SUBMITTING chờ đối soát, KHÔNG đánh FAILED', async () => {
    const harness = build({
      create: new FulfillmentClientError(FulfillmentErrorClass.SERVER, '502', 502),
      listPages: [new FulfillmentClientError(FulfillmentErrorClass.NETWORK, 'down')],
    });
    await expect(fulfill(harness)).rejects.toBeInstanceOf(
      FulfillmentReconciliationPendingException,
    );
    expect(harness.record.status).toBe(FulfillmentStatus.SUBMITTING);
  });

  it('Đơn bị quy tắc nghiệp vụ từ chối (HTTP 500 + msg) ⇒ FAILED ngay, KHÔNG tra lại (không mập mờ)', async () => {
    const harness = build({
      create: new FulfillmentClientError(
        FulfillmentErrorClass.VALIDATION,
        'Debit limit reached. Please pay or contact support.',
        500,
        PRESSIFY_BUSINESS_RULE_CODE,
      ),
    });
    await expect(fulfill(harness)).rejects.toBeDefined();
    expect(harness.listOrders).not.toHaveBeenCalled();
    expect(harness.record.status).toBe(FulfillmentStatus.FAILED);
    expect(harness.record.lastErrorCode).toBe(PRESSIFY_BUSINESS_RULE_CODE);
  });
});

describe('PressifyFulfillmentService — đồng bộ, giá vốn, huỷ, kiểm tra kết nối', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('Đã thanh toán ⇒ giá vốn dòng = items[].price Pressify thực trừ (ghép theo variant_id duy nhất)', async () => {
    const harness = build({
      detail: {
        fulfill_status: 'processing',
        payment_status: 'paid',
        items: [{ id: 3218607, price: '7.98', quantity: 1, variant_id: '188' }],
      },
    });
    await fulfill(harness);
    const costs = argOf<Array<Record<string, unknown>>>(
      harness.repoMocks.applyProviderItemCosts,
      -1,
      1,
    );
    expect(costs).toEqual([
      { id: 'fi-1', baseCost: 7.98, color: null, size: null, providerItemId: '3218607' },
    ]);
    expect(harness.record.status).toBe(FulfillmentStatus.IN_PRODUCTION);
  });

  it('Chưa thanh toán ⇒ KHÔNG xác nhận giá vốn (giữ ảnh chụp lúc gửi)', async () => {
    const harness = build({ detail: { payment_status: 'unpaid' } });
    await fulfill(harness);
    expect(harness.repoMocks.applyProviderItemCosts).not.toHaveBeenCalled();
  });

  it('Hai dòng CÙNG variant_id ⇒ nhập nhằng ⇒ không ghi giá vốn cho dòng nào', async () => {
    const harness = build({
      twoItems: true,
      detail: {
        payment_status: 'paid',
        items: [
          { id: 1, price: '7.98', quantity: 1, variant_id: '188' },
          { id: 2, price: '9.10', quantity: 1, variant_id: '188' },
        ],
      },
    });
    await fulfill(harness);
    const costs = argOf<Array<{ baseCost: unknown }>>(
      harness.repoMocks.applyProviderItemCosts,
      -1,
      1,
    );
    expect(costs.every((cost) => cost.baseCost === null)).toBe(true);
  });

  it('Đồng bộ: shipped + tracking ⇒ SHIPPED, có mã vận đơn và hãng', async () => {
    const harness = build({
      existingStatus: FulfillmentStatus.SUBMITTED,
      providerOrderId: '2885109',
      detail: {
        fulfill_status: 'shipped',
        payment_status: 'paid',
        tracking_id: '9400111899223344556677',
        shipping_service: 'USPS',
      },
    });
    const result = await harness.service.syncOne(
      harness.record as never,
      ACCOUNT as never,
      FulfillmentTrigger.CRON,
    );
    expect(result.changed).toBe(true);
    expect(harness.record.status).toBe(FulfillmentStatus.SHIPPED);
    expect(harness.record.trackingNumber).toBe('9400111899223344556677');
    expect(harness.record.carrier).toBe('USPS');
  });

  it('Đồng bộ bản ghi chưa có mã Pressify (SUBMITTING) ⇒ tra theo ref_id, có thì khôi phục', async () => {
    const harness = build({
      existingStatus: FulfillmentStatus.SUBMITTING,
      listPages: [[{ id: 2885109, ref_id: TIKTOK_ORDER }]],
    });
    await harness.service.syncOne(
      harness.record as never,
      ACCOUNT as never,
      FulfillmentTrigger.CRON,
    );
    expect(harness.record.providerOrderId).toBe('2885109');
    expect(harness.record.status).toBe(FulfillmentStatus.SUBMITTED);
  });

  it('Huỷ: đơn pending, chưa thanh toán, < 60 phút ⇒ gọi huỷ ⇒ đọc lại trạng thái cancelled', async () => {
    const harness = build({
      existingStatus: FulfillmentStatus.SUBMITTED,
      providerOrderId: '2885109',
    });
    harness.getOrder
      .mockResolvedValueOnce({ data: detailOf(), requestId: 'a', durationMs: 1, httpStatus: 200 })
      .mockResolvedValueOnce({
        data: detailOf({ fulfill_status: 'cancelled' }),
        requestId: 'b',
        durationMs: 1,
        httpStatus: 200,
      });

    await harness.service.cancel(ORG, USER, POD_ORDER, 'khách huỷ', 'ADMIN');

    expect(harness.cancelOrder).toHaveBeenCalledWith(expect.anything(), '2885109');
    expect(harness.record.status).toBe(FulfillmentStatus.CANCELLED);
  });

  it('Huỷ: đơn đã priority / đã thanh toán ⇒ từ chối, KHÔNG gọi endpoint huỷ', async () => {
    const harness = build({
      existingStatus: FulfillmentStatus.SUBMITTED,
      providerOrderId: '2885109',
      detail: { fulfill_status: 'priority', payment_status: 'paid' },
    });
    await expect(harness.service.cancel(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentValidationException,
    );
    expect(harness.cancelOrder).not.toHaveBeenCalled();
  });

  it('Huỷ: Pressify trả HTTP 200 nhưng status "error" ⇒ báo lỗi, ghi CANCEL_FAILED, không đổi trạng thái', async () => {
    const harness = build({
      existingStatus: FulfillmentStatus.SUBMITTED,
      providerOrderId: '2885109',
      cancel: {
        status: 'error',
        msg: 'Order can only be cancelled within 60 minutes of creation.',
      },
    });
    await expect(harness.service.cancel(ORG, USER, POD_ORDER)).rejects.toBeDefined();
    expect(
      harness.histories.some((entry) => entry.eventType === FulfillmentEventType.CANCEL_FAILED),
    ).toBe(true);
    expect(harness.record.status).not.toBe(FulfillmentStatus.CANCELLED);
  });

  it('Test connection: key hợp lệ ⇒ Connected; key sai ⇒ không kết nối, gợi ý dùng Store API key, không lộ key', async () => {
    const ok = build();
    ok.listAccessories.mockResolvedValue({
      data: { data: [], message: 'success' },
      requestId: 'r',
      durationMs: 1,
      httpStatus: 200,
    });
    await expect(ok.service.testConnection(ACCOUNT as never)).resolves.toMatchObject({
      connected: true,
      message: 'Connected',
    });

    const bad = build();
    bad.listAccessories.mockRejectedValue(
      new FulfillmentClientError(FulfillmentErrorClass.AUTH, 'invalid seller', 404),
    );
    const result = await bad.service.testConnection(ACCOUNT as never);
    expect(result.connected).toBe(false);
    expect(result.message).toContain('Store API key');
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('Phương thức vận chuyển: đúng standard / priority của tài liệu', async () => {
    const harness = build();
    const methods = await harness.service.shippingMethods(ACCOUNT as never, {} as never, []);
    expect(methods.options.map((option) => option.value)).toEqual(['standard', 'priority']);
  });
});
