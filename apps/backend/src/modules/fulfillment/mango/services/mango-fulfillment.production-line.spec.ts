import { ConfigService } from '@nestjs/config';
import { FulfillmentStatus, FulfillmentTrigger } from '@prisma/client';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
  FulfillmentValidationException,
} from '../../exceptions/fulfillment.exceptions';
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
 * **Line sản xuất: người dùng chọn gì thì xưởng in nhận đúng cái đó.**
 *
 * ```
 *   Cấu hình sản phẩm (ánh xạ)  →  fulfillment_product_mappings.production_line
 *        ↓ thắng mặc định tài khoản
 *   MangoFulfillmentService     →  production_line_id trong request Create Order
 * ```
 *
 * 🔴 Trước đây giá trị này KHÔNG được gửi đi: Mango tự chọn xưởng của họ (bằng chứng:
 * `production_line_id` xuất hiện trong response Create Order dù request không hề có trường đó),
 * nên đơn khai TIKTOK lại nằm ở FASTUS.
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
}

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
    shippingLabelUrl: null,
    shop: { name: 'Shop A' },
    account: { id: 'tt-1', accountName: 'NCMedia US', fulfillmentAccountId: account.id },
    items: [],
  } as unknown as PodOrderWithRelations;

  const readiness = {
    check: jest.fn().mockReturnValue({
      ready: true,
      issues: [],
      address: ADDRESS,
      items: options.items ?? [resolvedItem()],
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
  );

  const fulfill = () =>
    service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, options.fulfillOptions ?? {});
  const sentRequest = (): MangoCreateOrderRequest =>
    (createOrder.mock.calls[0] as unknown[])[1] as MangoCreateOrderRequest;

  return { service, fulfill, createOrder, sentRequest, updates, repo };
}

describe('Line sản xuất gửi sang MangoTeePrints', () => {
  it('CASE 1 — ánh xạ khai TIKTOK ⇒ request mang ĐÚNG line đó', async () => {
    const { fulfill, sentRequest } = buildService({ mappingLine: 'LINE-TIKTOK' });

    await fulfill();

    expect(sentRequest().production_line_id).toBe('LINE-TIKTOK');
  });

  it('CASE 2 — ánh xạ khai FASTUS ⇒ request mang FASTUS (không bị ép về giá trị khác)', async () => {
    const { fulfill, sentRequest } = buildService({ mappingLine: 'LINE-FASTUS' });

    await fulfill();

    expect(sentRequest().production_line_id).toBe('LINE-FASTUS');
  });

  it('🔴 lựa chọn của người dùng THẮNG mặc định của tài khoản', async () => {
    const { fulfill, sentRequest } = buildService({
      mappingLine: 'LINE-TIKTOK',
      accountLine: 'LINE-FASTUS',
    });

    await fulfill();

    expect(sentRequest().production_line_id).toBe('LINE-TIKTOK');
  });

  it('CASE 3 — không chọn line ⇒ dùng mặc định của TÀI KHOẢN', async () => {
    const { fulfill, sentRequest } = buildService({ accountLine: 'LINE-FASTUS' });

    await fulfill();

    expect(sentRequest().production_line_id).toBe('LINE-FASTUS');
  });

  it('không có line ở đâu cả ⇒ KHÔNG gửi trường này (giữ nguyên hành vi cũ)', async () => {
    const { fulfill, sentRequest } = buildService();

    await fulfill();

    expect('production_line_id' in sentRequest()).toBe(false);
  });

  it('line được ghi lại trên bản ghi fulfillment để đối soát', async () => {
    const { fulfill, updates } = buildService({ mappingLine: 'LINE-TIKTOK' });

    await fulfill();

    expect(updates.some((update) => update.productionLine === 'LINE-TIKTOK')).toBe(true);
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
      fulfillOptions: { speedType: 'rush' },
    });

    await fulfill();

    expect(sentRequest().speed_type).toBe('rush');
    expect(sentRequest().production_line_id).toBe('LINE-FASTUS');
  });

  it('🔴 Facility + xưởng FASTUS ⇒ chặn kèm tên xưởng đang gửi', async () => {
    const { fulfill, createOrder } = buildService({
      mappingLine: 'LINE-FASTUS',
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
