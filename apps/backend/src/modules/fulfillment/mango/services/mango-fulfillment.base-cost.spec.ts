import { ConfigService } from '@nestjs/config';
import { FulfillmentOptionsService } from '../../services/fulfillment-options.service';
import { FulfillmentStatus, FulfillmentTrigger, Prisma } from '@prisma/client';
import {
  FulfillmentAlreadySubmittedException,
  FulfillmentCannotCancelException,
  FulfillmentClientError,
  FulfillmentErrorClass,
  FulfillmentNotReadyException,
  FulfillmentProviderNotAssignedException,
  FulfillmentProviderTimeoutException,
  FulfillmentValidationException,
} from '../../exceptions/fulfillment.exceptions';
import { FulfillmentRepository } from '../../repositories/fulfillment.repository';
import { FulfillmentReadinessService } from '../../services/fulfillment-readiness.service';
import { PodOrderRepository } from '../../../pod-tiktok/repositories/pod-order.repository';
import { TiktokEncryptionService } from '../../../pod-tiktok/services/tiktok-encryption.service';
import type { PodOrderWithRelations } from '../../../pod-tiktok/types/pod-order-with-relations.type';
import { DistributedLockService } from '../../../pod-tiktok/infra/distributed-lock.service';
import { MangoApiClient } from '../clients/mango-api.client';
import { MangoOrderMapper } from '../mappers/mango-order.mapper';
import type { MangoCreateOrderRequest, MangoOrderResponse } from '../types/mango-api.types';
import { MangoCredentialService } from './mango-credential.service';
import { MangoFulfillmentService } from './mango-fulfillment.service';

/**
 * **Gửi đơn POD sang MangoTeePrints — giá vốn và chống gửi trùng.**
 *
 * Bốn luật được khoá lại ở đây:
 *  1. Giá vốn đến TỪ NHÀ CUNG CẤP. Response tạo đơn đã là `OrderResponseSchema` (có
 *     `items[].base_cost`, `subtotal`, `shipping_fee`, `total`) ⇒ phải dùng ngay, và chỉ khi
 *     thiếu mới hỏi lại `GET /orders/{order_id}`.
 *  2. Ghép giá vốn theo `items[].item_id` — id dòng nội bộ ta tự gửi đi. Hai dòng cùng SKU vẫn
 *     nhận đúng giá của mình.
 *  3. Thiếu dữ liệu ⇒ KHÔNG có request nào rời khỏi hệ thống; lỗi nhà cung cấp ⇒ đơn FAILED
 *     kèm mã + thông điệp, không bao giờ đánh dấu đã gửi.
 *  4. Bấm hai lần / đơn đã gửi ⇒ đúng MỘT đơn ở xưởng in.
 */

const ORG = 'org-1';
const USER = 'user-1';
const POD_ORDER = 'pod-order-1';

const encryption = {
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

const ACCOUNT = {
  id: 'acc-1',
  organizationId: ORG,
  name: 'Mango US',
  isActive: true,
  apiKeyEnc: 'enc:live-key-123456',
  baseUrlOverride: 'https://v3.mangoteeprints.com/api/public/v1',
  defaultProductionLine: 'TIKTOK',
  defaultShippingMethod: 'standard',
  defaultFacility: null,
};

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

/** Một dòng hàng đã qua cổng readiness (SKU + design đầy đủ). */
function resolvedItem(podOrderItemId: string, providerSku: string, baseCost: number | null = null) {
  return {
    podOrderItemId,
    providerSku,
    quantity: 1,
    productionConfig: null,
    baseCost,
    productionLine: null,
    printFiles: [{ key: 'front' as const, url: 'https://cdn.ncmedia/design-front.png' }],
  };
}

interface Harness {
  items?: ReturnType<typeof resolvedItem>[];
  ready?: boolean;
  issues?: Array<{ code: string; message: string }>;
  existing?: { status: FulfillmentStatus; attemptCount?: number; providerStatus?: string } | null;
  /** Lỗi của Get Order Detail (đối soát trước khi gửi lại / hỏi trạng thái trước khi huỷ). */
  getError?: Error;
  /** `data` của Cancel Order. */
  cancelData?: { status?: string };
  /** `data` của Create Order. */
  createData?: MangoOrderResponse | Error;
  /** `data` của Get Order Detail (chỉ dùng khi create thiếu giá vốn). */
  getData?: MangoOrderResponse;
  lockBusy?: boolean;
  fulfillmentAccountId?: string | null;
}

function buildService(options: Harness = {}) {
  const items = options.items ?? [resolvedItem('poi-1', 'SKU-A')];
  // Bảng dòng hàng trong DB — `replaceItems` ghi, `listItems` đọc, `applyProviderItemCosts` sửa.
  let rows = items.map((item, index) => ({
    id: `fi-${index + 1}`,
    podOrderItemId: item.podOrderItemId,
    providerSku: item.providerSku,
    quantity: item.quantity,
    baseCost: item.baseCost === null ? null : new Prisma.Decimal(item.baseCost),
    color: null as string | null,
    size: null as string | null,
    providerItemId: null as string | null,
    // Ảnh chụp giá catalog lúc gửi ⇒ CHƯA được nhà cung cấp xác nhận.
    baseCostConfirmedAt: null as Date | null,
  }));

  const updates: Array<Record<string, unknown>> = [];
  const histories: Array<Record<string, unknown>> = [];
  const record = {
    id: 'ful-1',
    organizationId: ORG,
    accountId: ACCOUNT.id,
    podOrderId: POD_ORDER,
    externalOrderId: 'NC-TT-1',
    status: options.existing?.status ?? FulfillmentStatus.DRAFT,
    attemptCount: options.existing?.attemptCount ?? 0,
    providerOrderId: null as string | null,
    providerStatus: options.existing?.providerStatus ?? null,
    providerFulfillId: null,
    trackingNumber: null,
    trackingUrl: null,
    carrier: null,
    labelUrl: null,
    subtotal: null,
    shippingFee: null,
    tax: null,
    total: null,
    productionLine: 'TIKTOK',
    completedAt: null,
    cancelledAt: null,
    submittedAt: null,
    items: rows,
  };

  const createDraft = jest.fn().mockResolvedValue(record);
  const repo = {
    findByPodOrder: jest.fn().mockResolvedValue(options.existing ? record : null),
    countAttempts: jest.fn().mockResolvedValue(0),
    supersedeCancelled: jest.fn().mockResolvedValue(true),
    // Đơn chưa được nhà cung cấp khác nhận (chống sản xuất hai lần qua hai nhà cung cấp).
    findBlockingRecordOfOtherProvider: jest.fn().mockResolvedValue(null),
    findAccountById: jest.fn().mockResolvedValue(ACCOUNT),
    createDraft,
    findById: jest.fn().mockImplementation(() => Promise.resolve({ ...record, items: rows })),
    replaceItems: jest.fn().mockImplementation(() => Promise.resolve(rows)),
    listItems: jest.fn().mockImplementation(() => Promise.resolve(rows)),
    applyProviderItemCosts: jest.fn(
      (
        _id: string,
        costs: Array<{ id: string; baseCost: number | null; color: string | null; size: string | null; providerItemId: string | null }>,
      ) => {
        let written = 0;
        rows = rows.map((row) => {
          const cost = costs.find((entry) => entry.id === row.id);
          if (!cost || (cost.baseCost === null && !cost.color && !cost.size && !cost.providerItemId)) return row;
          written += 1;
          return {
            ...row,
            baseCost: cost.baseCost === null ? row.baseCost : new Prisma.Decimal(cost.baseCost),
            // Giống repository thật: số do nhà cung cấp báo ⇒ đã xác nhận.
            baseCostConfirmedAt: cost.baseCost === null ? row.baseCostConfirmedAt : new Date(),
            color: cost.color ?? row.color,
            size: cost.size ?? row.size,
            providerItemId: cost.providerItemId ?? row.providerItemId,
          };
        });
        record.items = rows;
        return Promise.resolve(written);
      },
    ),
    updateOrder: jest.fn((_id: string, data: Record<string, unknown>) => {
      updates.push(data);
      Object.assign(record, data);
      return Promise.resolve(record);
    }),
    addHistory: jest.fn((entry: Record<string, unknown>) => {
      histories.push(entry);
      return Promise.resolve();
    }),
    addErrorLog: jest.fn().mockResolvedValue(undefined),
    touchAccountUsed: jest.fn().mockResolvedValue(undefined),
    listMappingsForOrganization: jest.fn().mockResolvedValue([]),
    listProductDesigns: jest.fn().mockResolvedValue([]),
    // Nhà cung cấp khả dụng của tổ chức: mặc định chỉ có ACCOUNT này. Case "chưa gán nhà cung
    // cấp cho TikTok Account" truyền `fulfillmentAccountId: null` và không có lựa chọn nào.
    listAccounts: jest
      .fn()
      .mockResolvedValue(options.fulfillmentAccountId === null ? [] : [ACCOUNT]),
  } as unknown as FulfillmentRepository;

  const order = {
    id: POD_ORDER,
    tiktokOrderId: 'TT-1',
    sellerNote: 'Giao nhanh giúp',
    buyerEmail: 'buyer@example.com',
    shop: { name: 'Shop A' },
    account: {
      id: 'tt-1',
      accountName: 'NCMedia US',
      fulfillmentAccountId:
        options.fulfillmentAccountId === undefined ? ACCOUNT.id : options.fulfillmentAccountId,
    },
    items: [],
  } as unknown as PodOrderWithRelations;

  const readiness = {
    check: jest.fn().mockReturnValue(
      options.ready === false
        ? { ready: false, issues: options.issues ?? [], address: undefined, items: [] }
        : { ready: true, issues: [], address: ADDRESS, items },
    ),
  } as unknown as FulfillmentReadinessService;

  const createOrder = jest.fn<Promise<unknown>, [unknown, MangoCreateOrderRequest]>(() =>
    options.createData instanceof Error
      ? Promise.reject(options.createData)
      : Promise.resolve({ data: options.createData ?? {}, requestId: 'req-create', durationMs: 12 }),
  );
  const getOrder = jest.fn(() =>
    options.getError
      ? Promise.reject(options.getError)
      : Promise.resolve({ data: options.getData ?? {}, requestId: 'req-get', durationMs: 9 }),
  );
  const cancelOrder = jest.fn().mockResolvedValue({
    data: options.cancelData ?? {},
    requestId: 'req-cancel',
    durationMs: 7,
  });
  const client = { createOrder, getOrder, cancelOrder } as unknown as MangoApiClient;

  const lock = {
    withLock: <T>(_key: string, _ttl: number, task: () => Promise<T>) =>
      options.lockBusy === true ? Promise.resolve(null) : task(),
  } as unknown as DistributedLockService;

  const service = new MangoFulfillmentService(
    { get: () => undefined } as unknown as ConfigService,
    repo,
    { findById: jest.fn().mockResolvedValue(order) } as unknown as PodOrderRepository,
    readiness,
    client,
    new MangoOrderMapper(),
    new MangoCredentialService(encryption),
    lock,
    // Xưởng TIKTOK (khớp mặc định tài khoản) — spec không kiểm phần phụ thuộc xưởng, chỉ cần nhất quán.
    {
      forAccount: () => Promise.resolve({ productionLines: [{ value: 'TIKTOK', label: 'TIKTOK' }] }),
    } as unknown as FulfillmentOptionsService,
    // Mọi SKU của spec thuộc xưởng TIKTOK (raw_data.production_line) — đúng xưởng đang chọn.
    {
      findCostCurrency: jest.fn().mockResolvedValue('USD'),
      findVariantsForAccount: (_id: string, skus: string[]) =>
        Promise.resolve(skus.map((sku) => ({ sku, status: 'ACTIVE', rawData: { production_line: 'TIKTOK' } }))),
    } as never,
  );

  // Mock dạng jest.Mock (repo được ép kiểu thành class nên truy cập method sẽ vướng unbound-method).
  const repoMocks = repo as unknown as Record<string, jest.Mock>;
  return {
    service,
    repo,
    repoMocks,
    createDraft,
    createOrder,
    getOrder,
    cancelOrder,
    updates,
    histories,
    record,
    rows: () => rows,
  };
}

/** Response tạo/đọc đơn của Mango (OrderResponseSchema) — chỉ những field nghiệp vụ dùng tới. */
function orderResponse(
  items: Array<{ item_id?: string; sku: string; base_cost?: number | null; color?: string; size?: string }>,
  over: Partial<MangoOrderResponse> = {},
): MangoOrderResponse {
  return {
    id: 'MG-1001',
    order_id: 'NC-TT-1',
    status: 'new_order',
    subtotal: 12.5,
    shipping_fee: 4.25,
    tax: 0,
    total: 16.75,
    items,
    ...over,
  };
}

describe('MangoFulfillmentService.fulfill — CASE 1..2, 10: giá vốn từ MangoTee', () => {
  it('CASE 1: đơn đủ dữ liệu ⇒ tạo đơn, lưu mã Mango + trạng thái, lấy giá vốn từ CHÍNH response tạo đơn', async () => {
    const harness = buildService({
      createData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: 8.25, color: 'Black', size: 'L' }]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER);

    expect(harness.createOrder).toHaveBeenCalledTimes(1);
    // Không cần hỏi lại: giá vốn đã có ngay trong response tạo đơn.
    expect(harness.getOrder).not.toHaveBeenCalled();

    const request = harness.createOrder.mock.calls[0][1];
    expect(request.order_id).toBe('NC-TT-1');
    expect(request.items[0]).toMatchObject({ sku: 'SKU-A', quantity: 1, item_id: 'fi-1' });
    expect(request.shipping_method).toBe('standard');
    expect(request.note).toBe('Giao nhanh giúp');

    const submitted = harness.updates.find((update) => update.status === FulfillmentStatus.SUBMITTED);
    expect(submitted).toMatchObject({ providerOrderId: 'MG-1001', providerStatus: 'new_order' });
    expect(harness.rows()[0]).toMatchObject({ color: 'Black', size: 'L', providerItemId: 'fi-1' });
    expect(Number(harness.rows()[0].baseCost)).toBe(8.25);
  });

  it('CASE 2: response tạo đơn CHƯA có giá vốn ⇒ gọi Get Order Detail một lần và lấy giá từ đó', async () => {
    const harness = buildService({
      createData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: null }], {
        subtotal: undefined,
        total: undefined,
      }),
      getData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: 9.9 }]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER);

    expect(harness.getOrder).toHaveBeenCalledTimes(1);
    expect(Number(harness.rows()[0].baseCost)).toBe(9.9);
    const costUpdate = harness.updates.find((update) => update.subtotal !== undefined);
    expect(costUpdate?.subtotal).toBeTruthy();
  });

  it('CASE 2b: cả hai lần đều chưa có giá ⇒ KHÔNG ghi 0, không ghi đè giá cũ, đơn vẫn SUBMITTED', async () => {
    const harness = buildService({
      items: [resolvedItem('poi-1', 'SKU-A', 5)],
      createData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: null }]),
      getData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: null }]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER);

    // Giá vốn giữ nguyên ảnh chụp từ Product Mapping (5), KHÔNG bị null/0 ghi đè.
    expect(Number(harness.rows()[0].baseCost)).toBe(5);
    expect(harness.record.status).toBe(FulfillmentStatus.SUBMITTED);
  });

  it('CASE 10: nhiều dòng — kể cả TRÙNG SKU — giá vốn ghép đúng từng dòng theo item_id', async () => {
    const harness = buildService({
      items: [resolvedItem('poi-1', 'SKU-A'), resolvedItem('poi-2', 'SKU-A'), resolvedItem('poi-3', 'SKU-B')],
      createData: orderResponse([
        { item_id: 'fi-2', sku: 'SKU-A', base_cost: 7.5 },
        { item_id: 'fi-1', sku: 'SKU-A', base_cost: 6.25 },
        { item_id: 'fi-3', sku: 'SKU-B', base_cost: 11 },
      ]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER);

    const request = harness.createOrder.mock.calls[0][1];
    expect(request.items.map((item) => item.item_id)).toEqual(['fi-1', 'fi-2', 'fi-3']);
    expect(harness.rows().map((row) => Number(row.baseCost))).toEqual([6.25, 7.5, 11]);
  });

  it('dòng cùng SKU mà nhà cung cấp KHÔNG trả item_id ⇒ không đoán, giữ nguyên giá cũ', async () => {
    const harness = buildService({
      items: [resolvedItem('poi-1', 'SKU-A'), resolvedItem('poi-2', 'SKU-A')],
      createData: orderResponse([
        { sku: 'SKU-A', base_cost: 7.5 },
        { sku: 'SKU-A', base_cost: 6.25 },
      ]),
      getData: orderResponse([
        { sku: 'SKU-A', base_cost: 7.5 },
        { sku: 'SKU-A', base_cost: 6.25 },
      ]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER);

    expect(harness.rows().map((row) => row.baseCost)).toEqual([null, null]);
  });

  it('SKU duy nhất và nhà cung cấp không trả item_id (đơn cũ) ⇒ vẫn ghép được theo SKU', async () => {
    const harness = buildService({
      createData: orderResponse([{ sku: 'SKU-A', base_cost: 4.75 }]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER);

    expect(Number(harness.rows()[0].baseCost)).toBe(4.75);
  });
});

describe('MangoFulfillmentService.fulfill — CASE 3..6: validate & lỗi nhà cung cấp', () => {
  it('CASE 3: thiếu ánh xạ SKU ⇒ 422 kèm lý do, KHÔNG gọi MangoTee', async () => {
    const harness = buildService({
      ready: false,
      issues: [{ code: 'MAPPING_MISSING', message: 'Chưa khai báo ánh xạ sản phẩm' }],
    });

    await expect(harness.service.fulfill(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentNotReadyException,
    );
    expect(harness.createOrder).not.toHaveBeenCalled();
  });

  it('CASE 4: thiếu file in ⇒ 422 kèm lý do, KHÔNG gọi MangoTee', async () => {
    const harness = buildService({
      ready: false,
      issues: [{ code: 'DESIGN_MISSING', message: 'Sản phẩm chưa có file design' }],
    });

    await expect(harness.service.fulfill(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentNotReadyException,
    );
    expect(harness.createOrder).not.toHaveBeenCalled();
  });

  it('CASE 5: MangoTee từ chối SKU (VALIDATION_ERROR) ⇒ đơn FAILED, lưu mã lỗi + thông điệp', async () => {
    const harness = buildService({
      createData: new FulfillmentClientError(
        FulfillmentErrorClass.VALIDATION,
        'sku not found',
        422,
        'VALIDATION_ERROR',
        [{ field: 'items.0.sku', message: 'SKU không tồn tại' }],
      ),
    });

    await expect(harness.service.fulfill(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentValidationException,
    );
    const failed = harness.updates.find((update) => update.status === FulfillmentStatus.FAILED);
    expect(failed).toMatchObject({ lastErrorCode: 'VALIDATION_ERROR' });
    expect(String(failed?.lastErrorMessage)).toContain('sku not found');
    // Không bao giờ đánh dấu đã gửi khi nhà cung cấp từ chối.
    expect(harness.updates.some((update) => update.status === FulfillmentStatus.SUBMITTED)).toBe(false);
  });

  it('CASE 6: timeout ⇒ 504 và lỗi được đánh dấu THỬ LẠI ĐƯỢC (bấm lại = retry, cùng order_id)', async () => {
    const timeout = new FulfillmentClientError(FulfillmentErrorClass.NETWORK, 'Hết thời gian chờ sau 30000ms');
    const harness = buildService({ createData: timeout });

    await expect(harness.service.fulfill(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentProviderTimeoutException,
    );
    expect(timeout.retryable).toBe(true);
    expect(harness.updates.some((update) => update.status === FulfillmentStatus.FAILED)).toBe(true);
  });
});

describe('MangoFulfillmentService.fulfill — CASE 7..9: chống gửi trùng & phạm vi nhà cung cấp', () => {
  it('CASE 7: bấm hai lần (khoá đang giữ) ⇒ 409, KHÔNG có lời gọi tạo đơn thứ hai', async () => {
    const harness = buildService({ lockBusy: true });

    await expect(harness.service.fulfill(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentAlreadySubmittedException,
    );
    expect(harness.createOrder).not.toHaveBeenCalled();
  });

  it('CASE 8: đơn đã gửi thành công ⇒ 409, không tạo đơn mới ở xưởng in', async () => {
    const harness = buildService({ existing: { status: FulfillmentStatus.IN_PRODUCTION } });

    await expect(harness.service.fulfill(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentAlreadySubmittedException,
    );
    expect(harness.createOrder).not.toHaveBeenCalled();
  });

  it('đơn FAILED ⇒ gửi lại được và DÙNG LẠI đúng order_id cũ (nhà cung cấp tự chặn trùng)', async () => {
    const harness = buildService({
      existing: { status: FulfillmentStatus.FAILED },
      createData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: 8 }]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.RETRY);

    expect(harness.createOrder.mock.calls[0][1].order_id).toBe('NC-TT-1');
    // Không tạo bản ghi mới: gửi lại phải dùng ĐÚNG bản ghi (và order_id) cũ.
    expect(harness.createDraft).not.toHaveBeenCalled();
  });

  it('CASE 9: kết nối TikTok của đơn CHƯA gán nhà cung cấp ⇒ chặn tại chỗ, không gọi MangoTee', async () => {
    const harness = buildService({ fulfillmentAccountId: null });

    await expect(harness.service.fulfill(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentProviderNotAssignedException,
    );
    expect(harness.createOrder).not.toHaveBeenCalled();
  });
});

describe('MangoFulfillmentService.fulfill — tuỳ chọn gửi đơn', () => {
  it('tuỳ chọn của người dùng thắng mặc định tài khoản và được gửi đúng tên field của MangoTee', async () => {
    const harness = buildService({ createData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: 3 }]) });

    await harness.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.MANUAL, {
      shippingMethod: 'by_tiktok',
      facility: 'TX',
      // speed_type chỉ hợp lệ với xưởng FASTUS (đơn này ở TIKTOK) — tên field của nó được kiểm ở
      // mango-fulfillment.production-line.spec.ts ('Speed type + xưởng FASTUS').
      preferredCarrier: 'usps',
      isScanLabel: true,
      labelUrl: 'https://labels.example/label.pdf',
      note: 'Ghi chú riêng cho lần gửi này',
    });

    expect(harness.createOrder.mock.calls[0][1]).toMatchObject({
      shipping_method: 'by_tiktok',
      facility: 'TX',
      preferred_carrier: 'usps',
      is_scan_label: true,
      label_url: 'https://labels.example/label.pdf',
      note: 'Ghi chú riêng cho lần gửi này',
    });
    // Lưu lại đúng thứ đã gửi để đối soát và hiển thị.
    expect(harness.updates.some((update) => update.shippingMethod === 'by_tiktok')).toBe(true);
  });

  it('không truyền tuỳ chọn ⇒ giữ nguyên hành vi cũ: mặc định tài khoản + ghi chú của người bán', async () => {
    const harness = buildService({ createData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: 3 }]) });

    await harness.service.fulfill(ORG, USER, POD_ORDER);

    const request = harness.createOrder.mock.calls[0][1];
    expect(request.shipping_method).toBe('standard');
    expect(request.speed_type).toBeUndefined();
    expect(request.is_scan_label).toBeUndefined();
    expect(request.label_url).toBeUndefined();
  });
});

describe('MangoFulfillmentService — Cancel ⇒ Fulfill lại (lần thử mới, không trùng order_id)', () => {
  it('🔴 bản ghi CANCELLED ⇒ lưu trữ bản ghi cũ, tạo bản ghi MỚI với order_id NC-{id}-R2', async () => {
    const harness = buildService({
      existing: { status: FulfillmentStatus.CANCELLED, attemptCount: 1 },
      createData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: 8 }]),
    });
    harness.repoMocks.countAttempts.mockResolvedValue(1);

    await harness.service.fulfill(ORG, USER, POD_ORDER);

    expect(harness.repoMocks.supersedeCancelled).toHaveBeenCalledWith(
      // Mock dùng chung một object (bị cập nhật sau đó) ⇒ chỉ kiểm đúng bản ghi được lưu trữ.
      expect.objectContaining({ id: 'ful-1' }),
      USER,
      FulfillmentTrigger.MANUAL,
    );
    expect(harness.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ externalOrderId: 'NC-TT-1-R2' }),
    );
    expect(harness.createOrder.mock.calls[0][1].order_id).toBe('NC-TT-1-R2');
  });

  it('lần gửi ĐẦU TIÊN giữ nguyên mã cũ NC-{id} (hành vi không đổi)', async () => {
    const harness = buildService({
      createData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: 8 }]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER);

    expect(harness.repoMocks.supersedeCancelled).not.toHaveBeenCalled();
    expect(harness.createOrder.mock.calls[0][1].order_id).toBe('NC-TT-1');
  });

  it('🔴 đơn đang ở xưởng (SUBMITTED) ⇒ KHÔNG gửi lại', async () => {
    const harness = buildService({ existing: { status: FulfillmentStatus.SUBMITTED } });

    await expect(harness.service.fulfill(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentAlreadySubmittedException,
    );
    expect(harness.createOrder).not.toHaveBeenCalled();
    expect(harness.repoMocks.supersedeCancelled).not.toHaveBeenCalled();
  });
});

describe('MangoFulfillmentService — retry sau timeout KHÔNG tạo đơn trùng', () => {
  it('🔴 FAILED sau một lần gửi, Mango THỰC RA đã có đơn ⇒ liên kết, KHÔNG gọi Create Order', async () => {
    const harness = buildService({
      existing: { status: FulfillmentStatus.FAILED, attemptCount: 1 },
      getData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: 8 }]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.RETRY);

    expect(harness.getOrder).toHaveBeenCalledWith(expect.anything(), 'NC-TT-1');
    expect(harness.createOrder).not.toHaveBeenCalled();
    expect(harness.record.providerOrderId).toBe('MG-1001');
    expect(harness.record.status).toBe(FulfillmentStatus.SUBMITTED);
  });

  it('FAILED và Mango trả 404 (chưa từng tới) ⇒ gửi lại với ĐÚNG order_id cũ', async () => {
    const harness = buildService({
      existing: { status: FulfillmentStatus.FAILED, attemptCount: 1 },
      getError: new FulfillmentClientError(FulfillmentErrorClass.NOT_FOUND, 'not found', 404),
      createData: orderResponse([{ item_id: 'fi-1', sku: 'SKU-A', base_cost: 8 }]),
    });

    await harness.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.RETRY);

    expect(harness.createOrder).toHaveBeenCalledTimes(1);
    expect(harness.createOrder.mock.calls[0][1].order_id).toBe('NC-TT-1');
  });

  it('🔴 tra lại bị lỗi mạng ⇒ KHÔNG gửi (có thể đã có đơn), báo lỗi thử lại được', async () => {
    const harness = buildService({
      existing: { status: FulfillmentStatus.FAILED, attemptCount: 1 },
      getError: new FulfillmentClientError(FulfillmentErrorClass.NETWORK, 'timeout', 0),
    });

    await expect(
      harness.service.fulfill(ORG, USER, POD_ORDER, FulfillmentTrigger.RETRY),
    ).rejects.toBeInstanceOf(FulfillmentProviderTimeoutException);
    expect(harness.createOrder).not.toHaveBeenCalled();
  });
});

describe('MangoFulfillmentService.cancel — hỏi trạng thái THẬT trước khi huỷ', () => {
  it('🔴 Mango báo đã SHIPPED ⇒ KHÔNG gọi huỷ, báo không huỷ được', async () => {
    const harness = buildService({
      existing: { status: FulfillmentStatus.SUBMITTED },
      getData: orderResponse([], { status: 'shipped' }),
    });

    await expect(harness.service.cancel(ORG, USER, POD_ORDER)).rejects.toBeInstanceOf(
      FulfillmentCannotCancelException,
    );
    expect(harness.cancelOrder).not.toHaveBeenCalled();
  });

  it('Mango xác nhận cancelled ⇒ bản ghi CANCELLED (mở lại nút Fulfill)', async () => {
    const harness = buildService({
      existing: { status: FulfillmentStatus.SUBMITTED },
      getData: orderResponse([], { status: 'new_order' }),
      cancelData: { status: 'cancelled' },
    });

    await harness.service.cancel(ORG, USER, POD_ORDER, 'sai size', 'EMPLOYEE');

    expect(harness.cancelOrder).toHaveBeenCalledWith(expect.anything(), 'NC-TT-1', {
      reason: 'sai size',
    });
    expect(harness.record.status).toBe(FulfillmentStatus.CANCELLED);
    // Audit: truy vết được Seller nào đã huỷ, với vai trò gì, vì sao.
    expect(harness.repoMocks.addHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CANCEL_REQUEST',
        performedBy: USER,
        payload: { reason: 'sai size', actorRole: 'EMPLOYEE' },
      }),
    );
  });

  it('🔴 Mango CHƯA xác nhận huỷ ⇒ KHÔNG giả thành công, giữ trạng thái thật', async () => {
    const harness = buildService({
      existing: { status: FulfillmentStatus.SUBMITTED },
      getData: orderResponse([], { status: 'new_order' }),
      cancelData: {},
    });

    await harness.service.cancel(ORG, USER, POD_ORDER);

    expect(harness.record.status).toBe(FulfillmentStatus.SUBMITTED);
    const cancelEntry = harness.histories.find((entry) => entry.eventType === 'CANCEL_SUCCESS');
    expect(cancelEntry?.success).toBe(false);
  });
});
