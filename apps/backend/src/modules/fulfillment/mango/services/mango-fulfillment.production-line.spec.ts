import { ConfigService } from '@nestjs/config';
import { FulfillmentStatus, FulfillmentTrigger } from '@prisma/client';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
  FulfillmentValidationException,
} from '../../exceptions/fulfillment.exceptions';
import { FulfillmentCatalogRepository } from '../../repositories/fulfillment-catalog.repository';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { FulfillmentOptionsService } from '../../services/fulfillment-options.service';
import { FulfillmentReadinessService } from '../../services/fulfillment-readiness.service';
import { PodOrderRepository } from '../../../pod-tiktok/repositories/pod-order.repository';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import { DistributedLockService } from '../../../pod-tiktok/infra/distributed-lock.service';
import type { PodOrderWithRelations } from '../../../pod-tiktok/types/pod-order-with-relations.type';
import { MangoApiClient } from '../clients/mango-api.client';
import { MangoOrderMapper } from '../mappers/mango-order.mapper';
import type { MangoCreateOrderRequest } from '../types/mango-api.types';
import { MangoCredentialService } from './mango-credential.service';
import { MangoFulfillmentService } from './mango-fulfillment.service';

/**
 * **Line sản xuất: người dùng chọn gì thì xưởng in nhận đúng cái đó — qua SKU.**
 *
 * ```
 *   Cấu hình sản phẩm (ánh xạ)  →  fulfillment_product_mappings.production_line  (id xưởng)
 *        ↓ thắng mặc định tài khoản (mặc định chỉ là DỰ PHÒNG)
 *   MangoFulfillmentService     →  KIỂM mọi SKU thuộc đúng xưởng đó (raw_data.production_line)
 *        ↓
 *   Create Order                →  KHÔNG có production_line_id (OrderCreateSchema không có, và
 *                                  additionalProperties: false ⇒ "Extra inputs are not permitted")
 * ```
 *
 * 🔴 Mango xếp đơn theo SKU: cùng Color/Size có một SKU cho MỖI xưởng. Lỗi cũ: chọn TIKTOK nhưng lưu
 * SKU của FASTUS (`12129`) ⇒ đơn sản xuất ở FASTUS. Nay lệch là CHẶN trước khi gửi, nói rõ lý do.
 */

const ORG = 'org-1';
const USER = 'user-1';
const POD_ORDER = 'pod-order-1';

const LINES = [
  { value: 'LINE-TIKTOK', label: 'TIKTOK' },
  { value: 'LINE-FASTUS', label: 'FASTUS' },
];

const ADDRESS = {
  first_name: 'John',
  last_name: 'Doe',
  phone: '+1999',
  address_line_1: '1 Main St',
  address_line_2: null,
  city: 'Austin',
  state: 'TX',
  country: 'US',
  zip: '78701',
};

function resolvedItem(over: Record<string, unknown> = {}) {
  return {
    podOrderItemId: 'poi-1',
    providerSku: 'SKU-A',
    quantity: 1,
    productionConfig: null,
    baseCost: null,
    productionLine: null,
    printFiles: [{ key: 'front' as const, url: 'https://cdn.ncmedia/design-front.png' }],
    ...over,
  };
}

interface Options {
  /** Line khai ở ánh xạ sản phẩm (thứ người dùng chọn trên màn hình). */
  mappingLine?: string | null;
  /** Mặc định của tài khoản nhà cung cấp. */
  accountLine?: string | null;
  items?: Array<ReturnType<typeof resolvedItem>>;
  createError?: Error;
  fulfillOptions?: Record<string, unknown>;
  /** SKU của dòng hàng mặc định. */
  sku?: string;
  /** SKU ⇒ xưởng theo danh mục đã đồng bộ (`raw_data.production_line`). */
  catalog?: Record<string, string | null>;
  /** Nhãn vận chuyển ĐÃ LƯU của đơn (lấy từ TikTok hoặc dán tay). */
  orderLabel?: { url: string; source: 'TIKTOK' | 'MANUAL'; trackingNumber: string | null };
}

/** Danh mục mặc định: mỗi xưởng một SKU cho CÙNG Black / 3XL (đúng như dữ liệu thật). */
const CATALOG: Record<string, string | null> = {
  'SKU-TT': 'TIKTOK',
  'SKU-FU': 'FASTUS',
  'SKU-NOLINE': null,
};

function buildService(options: Options = {}) {
  const account = {
    id: 'acc-1',
    organizationId: ORG,
    name: 'Mango US',
    isActive: true,
    apiKeyEnc: 'enc:live-key-123456',
    baseUrlOverride: 'https://v3.mangoteeprints.com/api/public/v1',
    defaultProductionLine: options.accountLine === undefined ? null : options.accountLine,
    defaultShippingMethod: 'standard',
    defaultFacility: null,
  };

  const updates: Array<Record<string, unknown>> = [];
  const record = {
    id: 'ful-1',
    organizationId: ORG,
    accountId: account.id,
    podOrderId: POD_ORDER,
    externalOrderId: 'NC-TT-1',
    status: FulfillmentStatus.DRAFT,
    items: [{ id: 'fi-1', podOrderItemId: 'poi-1', providerSku: 'SKU-A', quantity: 1 }],
  };

  const repo = {
    findByPodOrder: jest.fn().mockResolvedValue(null),
    // Đơn chưa được nhà cung cấp khác nhận (chống sản xuất hai lần qua hai nhà cung cấp).
    findBlockingRecordOfOtherProvider: jest.fn().mockResolvedValue(null),
    findAccountById: jest.fn().mockResolvedValue(account),
    createDraft: jest.fn().mockResolvedValue(record),
    findById: jest.fn().mockResolvedValue(record),
    replaceItems: jest.fn().mockResolvedValue(record.items),
    listItems: jest.fn().mockResolvedValue(record.items),
    applyProviderItemCosts: jest.fn().mockResolvedValue(0),
    updateOrder: jest.fn((_id: string, data: Record<string, unknown>) => {
      updates.push(data);
      Object.assign(record, data);
      return Promise.resolve(record);
    }),
    addHistory: jest.fn().mockResolvedValue(undefined),
    addErrorLog: jest.fn().mockResolvedValue(undefined),
    touchAccountUsed: jest.fn().mockResolvedValue(undefined),
    listMappingsForOrganization: jest.fn().mockResolvedValue([]),
    listProductDesigns: jest.fn().mockResolvedValue([]),
  } as unknown as FulfillmentRepository;

  const order = {
    id: POD_ORDER,
    tiktokOrderId: 'TT-1',
    sellerNote: null,
    buyerEmail: null,
    shippingLabelUrl: options.orderLabel?.url ?? null,
    shippingLabelSource: options.orderLabel?.source ?? null,
    shippingLabelTrackingNumber: options.orderLabel?.trackingNumber ?? null,
    shop: { name: 'Shop A' },
    account: { id: 'tt-1', accountName: 'NCMedia US', fulfillmentAccountId: account.id },
    items: [],
  } as unknown as PodOrderWithRelations;

  const readiness = {
    check: jest.fn().mockReturnValue({
      ready: true,
      issues: [],
      address: ADDRESS,
      items: options.items ?? [resolvedItem({ providerSku: options.sku ?? 'SKU-TT' })],
      // Line của ánh xạ — đây là "user selection" theo đúng luồng sản phẩm.
      productionLine: options.mappingLine === undefined ? null : options.mappingLine,
    }),
  } as unknown as FulfillmentReadinessService;

  const createOrder = jest.fn<Promise<unknown>, [unknown, MangoCreateOrderRequest]>(() =>
    options.createError
      ? Promise.reject(options.createError)
      : Promise.resolve({ data: {}, requestId: 'req-create', durationMs: 5 }),
  );
  const client = {
    createOrder,
    getOrder: jest.fn().mockResolvedValue({ data: {}, requestId: 'req-get', durationMs: 3 }),
  } as unknown as MangoApiClient;

  const service = new MangoFulfillmentService(
    { get: () => undefined } as unknown as ConfigService,
    repo,
    { findById: jest.fn().mockResolvedValue(order) } as unknown as PodOrderRepository,
    readiness,
    client,
    new MangoOrderMapper(),
    new MangoCredentialService({
      decrypt: (value: string) => value.replace(/^enc:/, ''),
    } as unknown as TiktokEncryptionService),
    {
      withLock: <T>(_key: string, _ttl: number, task: () => Promise<T>) => task(),
    } as unknown as DistributedLockService,
    {
      forAccount: () => Promise.resolve({ productionLines: LINES }),
    } as unknown as FulfillmentOptionsService,
    {
      findVariantsForAccount: (_accountId: string, skus: string[]) =>
        Promise.resolve(
          skus
            .filter((sku) => sku in (options.catalog ?? CATALOG))
            .map((sku) => ({
              sku,
              status: 'ACTIVE',
              rawData: { sku, production_line: (options.catalog ?? CATALOG)[sku] },
            })),
        ),
    } as unknown as FulfillmentCatalogRepository,
  );

  const fulfill = () =>
    service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, options.fulfillOptions ?? {});
  const sentRequest = (): MangoCreateOrderRequest =>
    (createOrder.mock.calls[0] as unknown[])[1] as MangoCreateOrderRequest;

  return { service, fulfill, createOrder, sentRequest, updates, repo };
}

describe('Line sản xuất ⇒ Mango (theo SKU, KHÔNG có production_line_id)', () => {
  it('🔴 request Create Order KHÔNG BAO GIỜ chứa production_line_id (Mango: Extra inputs are not permitted)', async () => {
    for (const setup of [
      { mappingLine: 'LINE-TIKTOK', sku: 'SKU-TT' },
      { mappingLine: 'LINE-FASTUS', sku: 'SKU-FU' },
      { accountLine: 'LINE-FASTUS', sku: 'SKU-FU' },
      {},
    ]) {
      const { fulfill, sentRequest } = buildService(setup);
      await fulfill();
      expect('production_line_id' in sentRequest()).toBe(false);
    }
  });

  it('CASE 1 — chọn TIKTOK + SKU của xưởng TIKTOK ⇒ gửi đúng SKU đó (Mango xếp đơn vào TIKTOK)', async () => {
    const { fulfill, sentRequest, updates } = buildService({ mappingLine: 'LINE-TIKTOK', sku: 'SKU-TT' });

    await fulfill();

    expect(sentRequest().items[0].sku).toBe('SKU-TT');
    expect(updates.some((update) => update.productionLine === 'LINE-TIKTOK')).toBe(true);
  });

  it('CASE 2 — chọn FASTUS + SKU của FASTUS ⇒ gửi đúng SKU FASTUS', async () => {
    const { fulfill, sentRequest } = buildService({ mappingLine: 'LINE-FASTUS', sku: 'SKU-FU' });

    await fulfill();

    expect(sentRequest().items[0].sku).toBe('SKU-FU');
  });

  it('🔴 BUG TIKTOK → FASTUS: chọn TIKTOK nhưng SKU thuộc FASTUS ⇒ CHẶN trước khi gửi, nêu rõ SKU + hai xưởng', async () => {
    const { fulfill, createOrder } = buildService({ mappingLine: 'LINE-TIKTOK', sku: 'SKU-FU' });

    const error = (await fulfill().catch((caught: unknown) => caught)) as FulfillmentValidationException;

    expect(error).toBeInstanceOf(FulfillmentValidationException);
    const text = JSON.stringify(error.getResponse());
    expect(text).toContain('SKU-FU');
    expect(text).toContain('FASTUS');
    expect(text).toContain('TIKTOK');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('CASE 5 — chọn FASTUS nhưng SKU thuộc TIKTOK ⇒ CHẶN (không bị TIKTOK "override")', async () => {
    const { fulfill, createOrder } = buildService({ mappingLine: 'LINE-FASTUS', sku: 'SKU-TT' });

    await expect(fulfill()).rejects.toBeInstanceOf(FulfillmentValidationException);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('🔴 lựa chọn của người dùng THẮNG mặc định tài khoản (mặc định FASTUS không ép SKU TIKTOK bị chặn)', async () => {
    const { fulfill, sentRequest, updates } = buildService({
      mappingLine: 'LINE-TIKTOK',
      accountLine: 'LINE-FASTUS',
      sku: 'SKU-TT',
    });

    await fulfill();

    expect(sentRequest().items[0].sku).toBe('SKU-TT');
    expect(updates.some((update) => update.productionLine === 'LINE-TIKTOK')).toBe(true);
  });

  it('CASE 3 — không chọn line ⇒ mặc định TÀI KHOẢN là chuẩn để kiểm (SKU sai xưởng mặc định ⇒ chặn)', async () => {
    const ok = buildService({ accountLine: 'LINE-FASTUS', sku: 'SKU-FU' });
    await ok.fulfill();
    expect(ok.sentRequest().items[0].sku).toBe('SKU-FU');

    const wrong = buildService({ accountLine: 'LINE-FASTUS', sku: 'SKU-TT' });
    await expect(wrong.fulfill()).rejects.toBeInstanceOf(FulfillmentValidationException);
    expect(wrong.createOrder).not.toHaveBeenCalled();
  });

  it('không chọn line ở đâu cả ⇒ xưởng = xưởng của SKU (ghi lại id để đối soát), không chặn', async () => {
    const { fulfill, updates } = buildService({ sku: 'SKU-FU' });

    await fulfill();

    expect(updates.some((update) => update.productionLine === 'LINE-FASTUS')).toBe(true);
  });

  it('đã chọn line nhưng SKU không có trong danh mục ⇒ chặn (không xác minh được xưởng)', async () => {
    const { fulfill, createOrder } = buildService({ mappingLine: 'LINE-TIKTOK', sku: 'SKU-UNKNOWN' });

    const error = (await fulfill().catch((caught: unknown) => caught)) as FulfillmentValidationException;

    expect(JSON.stringify(error.getResponse())).toContain('Đồng bộ lại danh mục');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('đã chọn line nhưng không tra được tên xưởng (id lạ) ⇒ chặn, không gửi đánh cược', async () => {
    const { fulfill, createOrder } = buildService({ mappingLine: 'LINE-GONE', sku: 'SKU-TT' });

    await expect(fulfill()).rejects.toBeInstanceOf(FulfillmentValidationException);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('không chọn line, các SKU thuộc HAI xưởng ⇒ chặn (Mango chỉ nhận đơn của một xưởng)', async () => {
    const { fulfill, createOrder } = buildService({
      items: [
        resolvedItem({ providerSku: 'SKU-TT' }),
        resolvedItem({ podOrderItemId: 'poi-2', providerSku: 'SKU-FU' }),
      ],
    });

    await expect(fulfill()).rejects.toBeInstanceOf(FulfillmentValidationException);
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe('Kiểm tra trước khi gọi nhà cung cấp', () => {
  it('🔴 Speed type + xưởng TIKTOK ⇒ chặn TẠI CHỖ, không tốn một lời gọi nào', async () => {
    const { fulfill, createOrder } = buildService({
      mappingLine: 'LINE-TIKTOK',
      fulfillOptions: { speedType: 'rush' },
    });

    await expect(fulfill()).rejects.toBeInstanceOf(FulfillmentValidationException);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('Speed type + xưởng FASTUS ⇒ hợp lệ, vẫn gửi đi', async () => {
    const { fulfill, sentRequest } = buildService({
      mappingLine: 'LINE-FASTUS',
      sku: 'SKU-FU',
      fulfillOptions: { speedType: 'rush' },
    });

    await fulfill();

    expect(sentRequest().speed_type).toBe('rush');
    expect('production_line_id' in sentRequest()).toBe(false);
  });

  it('🔴 Facility + xưởng FASTUS ⇒ chặn kèm tên xưởng đang gửi', async () => {
    const { fulfill, createOrder } = buildService({
      mappingLine: 'LINE-FASTUS',
      sku: 'SKU-FU',
      fulfillOptions: { facility: 'TX' },
    });

    const error = await fulfill().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FulfillmentValidationException);
    expect(JSON.stringify((error as FulfillmentValidationException).getResponse())).toContain(
      'FASTUS',
    );
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('Scan label chỉ hợp lệ với xưởng TIKTOK', async () => {
    const tiktok = buildService({
      mappingLine: 'LINE-TIKTOK',
      fulfillOptions: { isScanLabel: true },
    });
    await tiktok.fulfill();
    expect(tiktok.sentRequest().is_scan_label).toBe(true);

    const fastus = buildService({
      mappingLine: 'LINE-FASTUS',
      sku: 'SKU-FU',
      fulfillOptions: { isScanLabel: true },
    });
    await expect(fastus.fulfill()).rejects.toBeInstanceOf(FulfillmentValidationException);
    expect(fastus.createOrder).not.toHaveBeenCalled();
  });

  it('dòng hàng số lượng 0 / file in không phải URL công khai ⇒ chặn trước, nêu đúng field', async () => {
    const { fulfill, createOrder } = buildService({
      items: [
        resolvedItem({ quantity: 0 }),
        resolvedItem({
          podOrderItemId: 'poi-2',
          printFiles: [{ key: 'front' as const, url: '/local/only.png' }],
        }),
      ],
    });

    const error = await fulfill().catch((caught: unknown) => caught);
    const body = JSON.stringify((error as FulfillmentValidationException).getResponse());

    expect(error).toBeInstanceOf(FulfillmentValidationException);
    expect(body).toContain('items[0].quantity');
    expect(body).toContain('items[1].print_files[0].url');
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe('Lỗi VALIDATION_ERROR của nhà cung cấp', () => {
  it('CASE 7 — chi tiết theo field được LƯU LẠI, không chỉ "Request validation failed"', async () => {
    const { fulfill, updates } = buildService({
      mappingLine: 'LINE-TIKTOK',
      createError: new FulfillmentClientError(
        FulfillmentErrorClass.VALIDATION,
        'Request validation failed',
        422,
        'VALIDATION_ERROR',
        [
          { field: 'items.0.item_id', message: 'String should have at most 26 characters' },
          { field: 'production_line_id', message: 'Invalid uuid' },
        ],
        'req-err',
      ),
    });

    await expect(fulfill()).rejects.toBeInstanceOf(FulfillmentValidationException);

    const failure = updates.find((update) => update.status === FulfillmentStatus.FAILED);
    expect(failure?.lastErrorCode).toBe('VALIDATION_ERROR');
    expect(String(failure?.lastErrorMessage)).toContain('items.0.item_id');
    expect(String(failure?.lastErrorMessage)).toContain('at most 26 characters');
    expect(String(failure?.lastErrorMessage)).toContain('production_line_id');
  });

  it('nhà cung cấp KHÔNG nêu field ⇒ giữ nguyên thông điệp gốc, không bịa thêm', async () => {
    const { fulfill, updates } = buildService({
      mappingLine: 'LINE-TIKTOK',
      createError: new FulfillmentClientError(
        FulfillmentErrorClass.VALIDATION,
        'Request validation failed',
        422,
        'VALIDATION_ERROR',
        [],
        'req-err',
      ),
    });

    await expect(fulfill()).rejects.toBeInstanceOf(FulfillmentValidationException);

    const failure = updates.find((update) => update.status === FulfillmentStatus.FAILED);
    expect(failure?.lastErrorMessage).toBe('Request validation failed');
  });
});

describe('Nhãn TikTok ⇒ Push to fulfillment (Mango)', () => {
  const TIKTOK_LABEL = {
    url: 'https://label.tiktok.test/PKG.pdf',
    source: 'TIKTOK' as const,
    trackingNumber: 'TRK-9',
  };

  it('🔴 CASE 11 — "By TikTok" + nhãn TikTok ĐÃ LƯU ⇒ gửi label_url + tracking_number của CHÍNH nhãn đó', async () => {
    const { fulfill, sentRequest } = buildService({
      sku: 'SKU-TT',
      orderLabel: TIKTOK_LABEL,
      fulfillOptions: { shippingMethod: 'by_tiktok' },
    });

    await fulfill();

    expect(sentRequest()).toMatchObject({
      shipping_method: 'by_tiktok',
      label_url: 'https://label.tiktok.test/PKG.pdf',
      tracking_number: 'TRK-9',
    });
  });

  it('"By TikTok" mà CHƯA có nhãn ⇒ chặn trước khi gọi Mango, chỉ đúng ô label_url', async () => {
    const { fulfill, createOrder } = buildService({ sku: 'SKU-TT', fulfillOptions: { shippingMethod: 'by_tiktok' } });

    const error = (await fulfill().catch((caught: unknown) => caught)) as FulfillmentValidationException;

    expect(error).toBeInstanceOf(FulfillmentValidationException);
    expect(JSON.stringify(error.getResponse())).toContain('label_url');
    expect(JSON.stringify(error.getResponse())).toContain('Lấy nhãn từ TikTok');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('nhãn DÁN TAY ⇒ gửi label_url, KHÔNG gửi tracking (không biết tracking của nhãn đó)', async () => {
    const { fulfill, sentRequest } = buildService({
      sku: 'SKU-TT',
      orderLabel: { url: 'https://drive.test/label.pdf', source: 'MANUAL', trackingNumber: null },
    });

    await fulfill();

    expect(sentRequest().label_url).toBe('https://drive.test/label.pdf');
    expect('tracking_number' in sentRequest()).toBe(false);
  });

  it('ghi đè URL nhãn trong lần gửi ⇒ KHÔNG kèm tracking của nhãn TikTok cũ (không khớp nhãn)', async () => {
    const { fulfill, sentRequest } = buildService({
      sku: 'SKU-TT',
      orderLabel: TIKTOK_LABEL,
      fulfillOptions: { labelUrl: 'https://drive.test/other.pdf' },
    });

    await fulfill();

    expect(sentRequest().label_url).toBe('https://drive.test/other.pdf');
    expect('tracking_number' in sentRequest()).toBe(false);
  });

  it('nhãn TikTok KHÔNG phụ thuộc line sản xuất: line FASTUS + nhãn TikTok vẫn gửi nhãn như cũ', async () => {
    const { fulfill, sentRequest } = buildService({
      mappingLine: 'LINE-FASTUS',
      sku: 'SKU-FU',
      orderLabel: TIKTOK_LABEL,
    });

    await fulfill();

    expect(sentRequest()).toMatchObject({ label_url: TIKTOK_LABEL.url, tracking_number: 'TRK-9' });
  });
});
