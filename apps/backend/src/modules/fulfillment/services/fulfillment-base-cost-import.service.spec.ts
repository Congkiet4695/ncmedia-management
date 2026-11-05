import 'reflect-metadata';
import ExcelJS from 'exceljs';
import { FulfillmentProvider, FulfillmentSource, FulfillmentStatus, Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator';
import {
  EMPLOYEE_DEFAULT_PERMISSIONS,
  FULFILLMENT_DEFAULT_PERMISSIONS,
} from '../../auth/constants/default-roles';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import { FulfillmentController } from '../controllers/fulfillment.controller';
import { BASE_COST_IMPORT_MAX_ROWS } from '../constants/base-cost-import.constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BaseCostImportQueryDto, MANUAL_BASE_COST_MAX } from '../dto/fulfillment.dto';
import {
  FulfillmentBaseCostImportInvalidException,
  FulfillmentBaseCostImportStaleException,
} from '../exceptions/fulfillment.exceptions';
import { resolveOrderLevelBaseCost } from '../shared/manual-base-cost';
import { FulfillmentBaseCostImportService } from './fulfillment-base-cost-import.service';

/**
 * **Import Base Cost (Excel)** + luật Base Cost cấp đơn. File .xlsx thật (exceljs); repository giả lập DB.
 */
const ORG = 'org-1';
const ADMIN_ID = 'admin-1';
const ADMIN: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const SELLER: PodAccessScope = { allShops: false, accountIds: ['acc-1'], shopIds: ['shop-1'] };

interface FakeOrder {
  tiktokOrderId: string;
  shopId: string;
  orgId?: string;
  /** Trạng thái đơn phía TikTok. */
  tiktokStatus?: string;
  record?: ReturnType<typeof fulfilled> | null;
  /** Dòng đơn TikTok (cho đơn chưa fulfill — dựng dòng hàng từ Product Mapping). */
  lines?: Array<Record<string, unknown>>;
  /** Nhà cung cấp gán cho kết nối TikTok; `null` = chưa gán. */
  fulfillmentAccount?: { id: string; provider: FulfillmentProvider } | null;
  currency?: string | null;
}

const PROVIDER_ACCOUNT = { id: 'facc-1', provider: FulfillmentProvider.MANGO };
const line = (over: Record<string, unknown> = {}) => ({
  id: `line-${Math.random().toString(36).slice(2, 8)}`,
  productId: 'P1',
  skuId: 'V-1',
  sellerSku: 'SKU-1',
  isGift: false,
  ...over,
});
const MAPPING = {
  accountId: PROVIDER_ACCOUNT.id,
  tiktokProductId: 'P1',
  tiktokSkuId: 'V-1',
  sellerSku: 'SKU-1',
  providerSku: 'MG-TEE-BLK-L',
  productionConfig: 'DTG',
  providerColor: 'Black',
  providerSize: 'L',
  isActive: true,
};

function fulfilled(over: Record<string, unknown> = {}, items?: Array<Record<string, unknown>>) {
  return {
    id: `ful-${Math.random().toString(36).slice(2, 8)}`,
    status: FulfillmentStatus.SHIPPED as FulfillmentStatus,
    source: FulfillmentSource.PROVIDER as FulfillmentSource,
    submittedAt: new Date('2026-10-02T03:57:00Z') as Date | null,
    currency: 'USD' as string | null,
    accountId: PROVIDER_ACCOUNT.id,
    provider: PROVIDER_ACCOUNT.provider as FulfillmentProvider,
    providerOrderId: 'mg-1' as string | null,
    trackingNumber: null as string | null,
    lastErrorCode: null as string | null,
    lastErrorMessage: null as string | null,
    items: (items ?? [{}]).map((item, index) => ({
      id: `fi-${index}-${Math.random().toString(36).slice(2, 8)}`,
      quantity: 1,
      baseCost: null as Prisma.Decimal | null,
      baseCostConfirmedAt: null as Date | null,
      ...item,
    })),
    ...over,
  };
}

function build(orders: FakeOrder[], mappings: Array<Record<string, unknown>> = [MAPPING]) {
  const byPodId = new Map(orders.map((order, index) => [`pod-${index}`, order]));
  const podOrderRepo = {
    findRefsByTiktokOrderIds: jest.fn((org: string, ids: string[], shopIds: string[] | null) =>
      Promise.resolve(
        [...byPodId.entries()]
          .filter(
            ([, order]) =>
              (order.orgId ?? ORG) === org &&
              ids.includes(order.tiktokOrderId) &&
              (shopIds === null || shopIds.includes(order.shopId)),
          )
          .map(([id, order]) => ({ id, tiktokOrderId: order.tiktokOrderId, status: order.tiktokStatus ?? 'AWAITING_SHIPMENT' })),
      ),
    ),
    findManyByIds: jest.fn((_org: string, ids: string[]) =>
      Promise.resolve(
        ids.map((id) => {
          const order = byPodId.get(id) as FakeOrder;
          return {
            id,
            currency: order.currency === undefined ? 'USD' : order.currency,
            items: order.lines ?? [line()],
            account: {
              accountName: 'Shop A',
              fulfillmentAccount: order.fulfillmentAccount === undefined ? PROVIDER_ACCOUNT : order.fulfillmentAccount,
            },
          };
        }),
      ),
    ),
  };
  const repo = {
    findCurrentByPodOrders: jest.fn((_org: string, ids: string[]) =>
      Promise.resolve(
        new Map(
          ids
            .map((id) => [id, byPodId.get(id)?.record ?? null] as const)
            .filter((entry): entry is readonly [string, NonNullable<FakeOrder['record']>] => entry[1] !== null),
        ),
      ),
    ),
    applyManualItemCostsBatch: jest.fn((_params: unknown) => Promise.resolve()),
    applyImportRow: jest.fn((_params: unknown) => Promise.resolve('ful-new')),
    listMappingsForProducts: jest.fn(() => Promise.resolve(mappings)),
  };
  const service = new FulfillmentBaseCostImportService(repo as never, podOrderRepo as never);
  return { service, repo, podOrderRepo };
}

async function xlsx(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

type ApplyParams = {
  organizationId: string;
  costs: Array<{ itemId: string; fulfillmentOrderId: string; baseCost: number }>;
  histories: Array<{ eventType: string; performedBy: string; payload: Record<string, unknown> }>;
};

describe('resolveOrderLevelBaseCost', () => {
  it('nhận đơn đã fulfill một dòng, 0 là giá hợp lệ (khác chưa có giá)', () => {
    const verdict = resolveOrderLevelBaseCost(fulfilled(), 0, MANUAL_BASE_COST_MAX);
    expect(verdict).toMatchObject({ ok: true, before: null, unchanged: false, currency: 'USD' });
  });

  it.each([
    ['chưa fulfill', null, 9, 'NOT_FULFILLED'],
    ['chưa được nhà cung cấp nhận', fulfilled({ status: FulfillmentStatus.FAILED }), 9, 'NOT_SUBMITTED'],
    ['không có mốc gửi', fulfilled({ submittedAt: null }), 9, 'NOT_SUBMITTED'],
    ['nhiều dòng', fulfilled({}, [{}, {}]), 9, 'MULTI_ITEM'],
    ['số lượng 2', fulfilled({}, [{ quantity: 2 }]), 9, 'MULTI_ITEM'],
    ['âm', fulfilled(), -1, 'OUT_OF_RANGE'],
    ['NaN', fulfilled(), Number.NaN, 'OUT_OF_RANGE'],
    ['Infinity', fulfilled(), Number.POSITIVE_INFINITY, 'OUT_OF_RANGE'],
    ['vượt trần', fulfilled(), MANUAL_BASE_COST_MAX + 1, 'OUT_OF_RANGE'],
    ['thiếu đơn vị tiền', fulfilled({ currency: null }), 9, 'CURRENCY_REQUIRED'],
    ['quá số lẻ USD', fulfilled(), 9.123, 'TOO_MANY_DECIMALS'],
  ])('từ chối: %s', (_label, record, value, reason) => {
    expect(resolveOrderLevelBaseCost(record, value, MANUAL_BASE_COST_MAX)).toMatchObject({ ok: false, reason });
  });

  it('giá đã đúng và đã xác nhận ⇒ unchanged; chưa xác nhận ⇒ vẫn ghi (để xác nhận)', () => {
    const confirmed = fulfilled({}, [{ baseCost: new Prisma.Decimal('12.5'), baseCostConfirmedAt: new Date() }]);
    expect(resolveOrderLevelBaseCost(confirmed, 12.5, MANUAL_BASE_COST_MAX)).toMatchObject({ ok: true, unchanged: true });
    const pending = fulfilled({}, [{ baseCost: new Prisma.Decimal('12.5') }]);
    expect(resolveOrderLevelBaseCost(pending, 12.5, MANUAL_BASE_COST_MAX)).toMatchObject({ ok: true, unchanged: false });
  });
});

describe('FulfillmentBaseCostImportService', () => {
  it('file hợp lệ nhiều đơn: dryRun chỉ xem trước, không ghi', async () => {
    const { service, repo } = build([
      { tiktokOrderId: '576000000000000001', shopId: 'shop-1', record: fulfilled() },
      { tiktokOrderId: '576000000000000002', shopId: 'shop-2', record: fulfilled() },
    ]);
    const file = await xlsx([
      ['OrderID', 'Basecost'],
      ['576000000000000001', 12.5],
      ['576000000000000002', '18.00'],
    ]);
    const result = await service.import(ORG, ADMIN_ID, file, ADMIN, true);
    expect(result).toMatchObject({ status: 'READY', dryRun: true, totalRows: 2, validRows: 2, updatedOrders: 0 });
    expect(result.changes.map((change) => change.after)).toEqual([12.5, 18]);
    expect(repo.applyManualItemCostsBatch).not.toHaveBeenCalled();
  });

  it('xác nhận: ghi tất cả trong một lần, chỉ base cost, có nhật ký người làm', async () => {
    const one = fulfilled();
    const { service, repo } = build([{ tiktokOrderId: 'A1', shopId: 'shop-1', record: one }]);
    const file = await xlsx([
      ['  base cost ', 'Order ID', 'Ghi chú'],
      [7, 'A1', 'bỏ qua'],
    ]);
    const result = await service.import(ORG, ADMIN_ID, file, ADMIN, false);
    expect(result).toMatchObject({ status: 'APPLIED', updatedOrders: 1, ignoredHeaders: ['Ghi chú'] });
    const params = repo.applyManualItemCostsBatch.mock.calls[0][0] as ApplyParams;
    expect(params.organizationId).toBe(ORG);
    expect(params.costs).toEqual([{ itemId: one.items[0].id, fulfillmentOrderId: one.id, baseCost: 7 }]);
    expect(params.histories[0]).toMatchObject({
      eventType: 'BASE_COST_MANUAL_UPDATED',
      performedBy: ADMIN_ID,
      payload: { source: 'EXCEL_IMPORT', row: 2 },
    });
  });

  it('có dòng lỗi ⇒ PARTIAL: dòng hợp lệ vẫn ghi, dòng lỗi bị bỏ qua và liệt kê theo số dòng', async () => {
    const { service, repo } = build([
      { tiktokOrderId: 'OK1', shopId: 'shop-1', record: fulfilled() },
      { tiktokOrderId: 'MULTI', shopId: 'shop-1', record: fulfilled({}, [{}, {}]) },
      { tiktokOrderId: 'NOFUL', shopId: 'shop-1', record: null },
    ]);
    const file = await xlsx([
      ['OrderID', 'Basecost'],
      ['OK1', 5],
      [],
      ['MULTI', 5],
      ['GHOST', 5],
      ['NOFUL', 5],
      ['OK1x', 'abc'],
      ['OK2', ''],
      ['', 3],
      ['NEG', -1],
      ['DEC', 1.234],
      ['EU', '12,5'],
    ]);
    const result = await service.import(ORG, ADMIN_ID, file, ADMIN, false);
    expect(result.status).toBe('PARTIAL');
    expect(result.updatedOrders).toBe(1);
    expect(repo.applyManualItemCostsBatch).toHaveBeenCalledTimes(1);
    expect((repo.applyManualItemCostsBatch.mock.calls[0][0] as ApplyParams).costs).toHaveLength(1);
    expect(repo.applyImportRow).not.toHaveBeenCalled();
    // dòng trống (dòng 3) bị bỏ qua, không tính
    expect(result.totalRows).toBe(10);
    expect(result.errors.map((error) => [error.row, error.code])).toEqual([
      [4, 'MULTI_ITEM'],
      [5, 'ORDER_NOT_FOUND'],
      [6, 'NOT_FULFILLED'],
      [7, 'BASE_COST_INVALID'],
      [8, 'BASE_COST_REQUIRED'],
      [9, 'ORDER_ID_REQUIRED'],
      [10, 'OUT_OF_RANGE'],
      [11, 'ORDER_NOT_FOUND'],
      [12, 'BASE_COST_INVALID'],
    ]);
    expect(result.notFoundRows).toBe(2);
    expect(result.validRows).toBe(1);
  });

  it('DEC 1.234 USD có đơn ⇒ TOO_MANY_DECIMALS', async () => {
    const { service } = build([{ tiktokOrderId: 'DEC', shopId: 'shop-1', record: fulfilled() }]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([['OrderID', 'Basecost'], ['DEC', 1.234]]), ADMIN, true);
    expect(result.errors[0]).toMatchObject({ row: 2, code: 'TOO_MANY_DECIMALS' });
  });

  it('OrderID trùng ⇒ MỌI dòng trùng đều lỗi, không tự chọn dòng nào', async () => {
    const { service, repo } = build([{ tiktokOrderId: 'D1', shopId: 'shop-1', record: fulfilled() }]);
    const file = await xlsx([
      ['OrderID', 'Basecost'],
      ['D1', 5],
      ['D1', 6],
    ]);
    const result = await service.import(ORG, ADMIN_ID, file, ADMIN, false);
    expect(result).toMatchObject({ status: 'REJECTED', duplicateRows: 2, invalidRows: 2, validRows: 0 });
    expect(result.errors.every((error) => error.code === 'DUPLICATE_ORDER_ID')).toBe(true);
    expect(repo.applyManualItemCostsBatch).not.toHaveBeenCalled();
  });

  it('đơn của tổ chức khác ⇒ ORDER_NOT_FOUND (tra theo organizationId của JWT)', async () => {
    const { service, podOrderRepo } = build([
      { tiktokOrderId: 'X1', shopId: 'shop-1', orgId: 'org-2', record: fulfilled() },
    ]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([['OrderID', 'Basecost'], ['X1', 5]]), ADMIN, false);
    expect(result.errors[0]).toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect(podOrderRepo.findRefsByTiktokOrderIds).toHaveBeenCalledWith(ORG, ['X1'], null);
  });

  it('người dùng giới hạn shop: đơn ngoài shop ⇒ ORDER_NOT_FOUND', async () => {
    const { service, podOrderRepo } = build([
      { tiktokOrderId: 'S2', shopId: 'shop-2', record: fulfilled() },
    ]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([['OrderID', 'Basecost'], ['S2', 5]]), SELLER, false);
    expect(result.errors[0]).toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect(podOrderRepo.findRefsByTiktokOrderIds).toHaveBeenCalledWith(ORG, ['S2'], ['shop-1']);
  });

  it('gửi lại cùng file ⇒ dòng đã đúng giá không ghi lại', async () => {
    const same = fulfilled({}, [{ baseCost: new Prisma.Decimal('5'), baseCostConfirmedAt: new Date() }]);
    const { service, repo } = build([{ tiktokOrderId: 'R1', shopId: 'shop-1', record: same }]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([['OrderID', 'Basecost'], ['R1', 5]]), ADMIN, false);
    expect(result).toMatchObject({ status: 'APPLIED', unchangedRows: 1, updatedOrders: 0 });
    expect(repo.applyManualItemCostsBatch).not.toHaveBeenCalled();
  });

  it('OrderID lưu dạng SỐ đã mất chữ số ⇒ ORDER_ID_PRECISION_LOST; số nguyên an toàn vẫn nhận', async () => {
    const { service } = build([{ tiktokOrderId: '12345', shopId: 'shop-1', record: fulfilled() }]);
    const file = await xlsx([
      ['OrderID', 'Basecost'],
      [5.76e17, 5], // mã 18 chữ số Excel lưu dạng số ⇒ đã mất chữ số cuối
      [12345, 5],
    ]);
    const result = await service.import(ORG, ADMIN_ID, file, ADMIN, true);
    expect(result.errors).toEqual([expect.objectContaining({ row: 2, code: 'ORDER_ID_PRECISION_LOST' })]);
    expect(result.changes).toEqual([expect.objectContaining({ row: 3, orderId: '12345' })]);
  });

  it('dữ liệu đổi giữa chừng ⇒ dòng đó báo WRITE_STALE (đã rollback), các dòng khác vẫn ghi', async () => {
    const { service, repo } = build([
      { tiktokOrderId: 'C1', shopId: 'shop-1', record: fulfilled() },
      { tiktokOrderId: 'C2', shopId: 'shop-1', record: fulfilled() },
    ]);
    // Lô gộp hỏng ⇒ ghi lại từng dòng: C1 vẫn cũ, C2 ghi được.
    repo.applyManualItemCostsBatch
      .mockRejectedValueOnce(new FulfillmentBaseCostImportStaleException())
      .mockRejectedValueOnce(new FulfillmentBaseCostImportStaleException())
      .mockResolvedValueOnce(undefined);
    const result = await service.import(
      ORG,
      ADMIN_ID,
      await xlsx([['OrderID', 'Basecost'], ['C1', 5], ['C2', 6]]),
      ADMIN,
      false,
    );
    expect(result).toMatchObject({ status: 'PARTIAL', updatedOrders: 1, writeFailedRows: 1, baseCostUpdated: 1 });
    expect(result.errors).toEqual([expect.objectContaining({ row: 2, orderId: 'C1', code: 'WRITE_STALE' })]);
    expect(result.changes.map((change) => [change.orderId, change.applied])).toEqual([
      ['C1', false],
      ['C2', true],
    ]);
  });

  describe('lỗi cả file', () => {
    const reasonOf = async (buffer: Buffer) => {
      const { service } = build([]);
      try {
        await service.import(ORG, ADMIN_ID, buffer, ADMIN, true);
      } catch (error) {
        expect(error).toBeInstanceOf(FulfillmentBaseCostImportInvalidException);
        return ((error as FulfillmentBaseCostImportInvalidException).getResponse() as { details: { reason: string } })
          .details.reason;
      }
      return 'NO_ERROR';
    };

    it('không phải xlsx (dù đuôi đúng)', async () => {
      expect(await reasonOf(Buffer.from('OrderID,Basecost\nA,1'))).toBe('FORMAT');
    });
    it('zip hỏng', async () => {
      expect(await reasonOf(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBe('FORMAT');
    });
    it('sheet rỗng', async () => {
      expect(await reasonOf(await xlsx([]))).toBe('EMPTY');
    });
    it('chỉ có header', async () => {
      expect(await reasonOf(await xlsx([['OrderID', 'Basecost']]))).toBe('EMPTY');
    });
    it('thiếu cột', async () => {
      expect(await reasonOf(await xlsx([['OrderID', 'Price'], ['A', 1]]))).toBe('MISSING_COLUMN');
    });
    it('cột lặp', async () => {
      expect(await reasonOf(await xlsx([['OrderID', 'Basecost', 'Order ID'], ['A', 1, 'B']]))).toBe('DUPLICATE_COLUMN');
    });
    it('vượt số dòng', async () => {
      const rows: unknown[][] = [['OrderID', 'Basecost']];
      for (let i = 0; i <= BASE_COST_IMPORT_MAX_ROWS; i += 1) rows.push([`O${i}`, 1]);
      expect(await reasonOf(await xlsx(rows))).toBe('TOO_MANY_ROWS');
    });
  });
});

type ImportRowParams = {
  organizationId: string;
  actorUserId: string;
  target: Record<string, unknown>;
  markFulfilled: boolean;
  currency: string | null;
  trackingNumber: string | null;
  baseCost: Record<string, unknown> | null;
  histories: Array<{ eventType: string; fromStatus?: string | null; toStatus?: string | null; payload: Record<string, unknown> }>;
};
const HEAD = ['OrderID', 'Basecost', 'Tracking Number'];

describe('Import Excel Base Cost + Tracking Number', () => {
  it('1. đơn CHƯA fulfill, đủ Basecost + Tracking ⇒ tạo bản ghi nhập tay SHIPPED dưới nhà cung cấp của kết nối TikTok', async () => {
    const lineItem = line({ id: 'line-1' });
    const { service, repo } = build([{ tiktokOrderId: 'N1', shopId: 'shop-1', record: null, lines: [lineItem] }]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['N1', 7.5, '9400111202555842']]), ADMIN, false);

    expect(result).toMatchObject({ status: 'APPLIED', markedFulfilled: 1, baseCostUpdated: 1, trackingUpdated: 1, updatedOrders: 1 });
    expect(result.changes[0]).toMatchObject({
      action: 'MARK_FULFILLED',
      statusBefore: null,
      statusAfter: 'SHIPPED',
      after: 7.5,
      trackingAfter: '9400111202555842',
      applied: true,
    });
    const params = repo.applyImportRow.mock.calls[0][0] as ImportRowParams;
    expect(params).toMatchObject({
      organizationId: ORG,
      actorUserId: ADMIN_ID,
      target: { kind: 'CREATE', accountId: 'facc-1', provider: 'MANGO', podOrderId: 'pod-0', externalOrderId: 'IMPORT-N1' },
      markFulfilled: true,
      currency: 'USD',
      trackingNumber: '9400111202555842',
      baseCost: {
        value: 7.5,
        create: { podOrderItemId: 'line-1', providerSku: 'MG-TEE-BLK-L', productionConfig: 'DTG', color: 'Black', size: 'L' },
      },
    });
    expect(params.histories.map((entry) => entry.eventType)).toEqual([
      'STATUS_CHANGED',
      'BASE_COST_MANUAL_UPDATED',
      'SHIPMENT_UPDATED',
    ]);
    expect(params.histories[0]).toMatchObject({ fromStatus: null, toStatus: 'SHIPPED', payload: { source: 'EXCEL_IMPORT', createdRecord: true } });
    expect(repo.applyManualItemCostsBatch).not.toHaveBeenCalled();
  });

  it('2. đơn fulfill THẤT BẠI (chưa có mã đơn nhà cung cấp) ⇒ cập nhật tại chỗ, giữ lỗi cũ trong nhật ký', async () => {
    const failed = fulfilled({
      status: FulfillmentStatus.FAILED,
      submittedAt: null,
      providerOrderId: null,
      lastErrorCode: 'MANGO_400',
      lastErrorMessage: 'Invalid address',
    });
    const { service, repo } = build([{ tiktokOrderId: 'F1', shopId: 'shop-1', record: failed }]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['F1', 4, 'TRK-001']]), ADMIN, false);

    expect(result).toMatchObject({ status: 'APPLIED', markedFulfilled: 1 });
    expect(result.changes[0]).toMatchObject({ statusBefore: 'FAILED', statusAfter: 'SHIPPED' });
    const params = repo.applyImportRow.mock.calls[0][0] as ImportRowParams;
    expect(params.target).toEqual({
      kind: 'EXISTING',
      fulfillmentOrderId: failed.id,
      expectedStatus: 'FAILED',
      requireNoProviderOrder: true,
    });
    expect(params.baseCost).toEqual({ itemId: failed.items[0].id, value: 4 });
    // Bản ghi đã có đơn vị tiền ⇒ không ghi đè.
    expect(params.currency).toBeNull();
    expect(params.histories[0].payload).toMatchObject({
      createdRecord: false,
      previousError: { code: 'MANGO_400', message: 'Invalid address' },
    });
  });

  it('3. đơn ĐÃ fulfill, chỉ Basecost ⇒ đường UPDATE gộp cũ, không đổi trạng thái / tracking', async () => {
    const one = fulfilled({ trackingNumber: 'OLD-TRK' });
    const { service, repo } = build([{ tiktokOrderId: 'S1', shopId: 'shop-1', record: one }]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['S1', 9, '']]), ADMIN, false);

    expect(result).toMatchObject({ status: 'APPLIED', baseCostUpdated: 1, trackingUpdated: 0, markedFulfilled: 0 });
    expect(result.changes[0]).toMatchObject({ action: 'UPDATE', statusBefore: 'SHIPPED', statusAfter: 'SHIPPED', trackingAfter: null });
    expect((repo.applyManualItemCostsBatch.mock.calls[0][0] as ApplyParams).costs).toEqual([
      { itemId: one.items[0].id, fulfillmentOrderId: one.id, baseCost: 9 },
    ]);
    expect(repo.applyImportRow).not.toHaveBeenCalled();
  });

  it('4. đơn ĐÃ fulfill, Basecost + Tracking ⇒ một transaction, KHÔNG đánh dấu lại / không tạo lần fulfill mới', async () => {
    const one = fulfilled({ status: FulfillmentStatus.IN_PRODUCTION, trackingNumber: null });
    const { service, repo } = build([{ tiktokOrderId: 'S2', shopId: 'shop-1', record: one }]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['S2', 9, '1Z999AA10123456784']]), ADMIN, false);

    expect(result).toMatchObject({ status: 'APPLIED', baseCostUpdated: 1, trackingUpdated: 1, markedFulfilled: 0 });
    const params = repo.applyImportRow.mock.calls[0][0] as ImportRowParams;
    expect(params).toMatchObject({
      target: { kind: 'EXISTING', fulfillmentOrderId: one.id, expectedStatus: 'IN_PRODUCTION', requireNoProviderOrder: false },
      markFulfilled: false,
      trackingNumber: '1Z999AA10123456784',
      baseCost: { itemId: one.items[0].id, value: 9 },
    });
    expect(params.histories.map((entry) => entry.eventType)).toEqual(['BASE_COST_MANUAL_UPDATED', 'SHIPMENT_UPDATED']);
    expect(repo.applyManualItemCostsBatch).not.toHaveBeenCalled();
  });

  it('5. file CŨ (không có cột Tracking): đơn đã fulfill vẫn ghi giá; đơn chưa fulfill giữ mã lỗi cũ kèm hướng dẫn', async () => {
    const { service, repo } = build([
      { tiktokOrderId: 'OK', shopId: 'shop-1', record: fulfilled() },
      { tiktokOrderId: 'NEW', shopId: 'shop-1', record: null },
      { tiktokOrderId: 'DRF', shopId: 'shop-1', record: fulfilled({ status: FulfillmentStatus.DRAFT, submittedAt: null, providerOrderId: null }) },
    ]);
    const result = await service.import(
      ORG,
      ADMIN_ID,
      await xlsx([['OrderID', 'Basecost'], ['OK', 3], ['NEW', 3], ['DRF', 3]]),
      ADMIN,
      false,
    );
    expect(result).toMatchObject({ status: 'PARTIAL', baseCostUpdated: 1, markedFulfilled: 0 });
    expect(result.errors.map((error) => [error.orderId, error.code])).toEqual([
      ['NEW', 'NOT_FULFILLED'],
      ['DRF', 'NOT_SUBMITTED'],
    ]);
    expect(result.errors[0].message).toContain('Tracking Number');
    expect(repo.applyImportRow).not.toHaveBeenCalled();
  });

  it('6. ô trống KHÔNG ghi đè: chỉ Tracking ⇒ không đụng Base Cost; đơn chưa fulfill thiếu một trong hai ⇒ từ chối', async () => {
    const one = fulfilled({}, [{ baseCost: new Prisma.Decimal('5'), baseCostConfirmedAt: new Date() }]);
    const { service, repo } = build([
      { tiktokOrderId: 'T1', shopId: 'shop-1', record: one },
      { tiktokOrderId: 'N2', shopId: 'shop-1', record: null },
      { tiktokOrderId: 'N3', shopId: 'shop-1', record: null },
    ]);
    const result = await service.import(
      ORG,
      ADMIN_ID,
      await xlsx([HEAD, ['T1', '', 'TRK-777'], ['N2', 5, ''], ['N3', '', 'TRK-778'], ['N4', '', '']]),
      ADMIN,
      false,
    );
    const params = repo.applyImportRow.mock.calls[0][0] as ImportRowParams;
    expect(repo.applyImportRow).toHaveBeenCalledTimes(1);
    expect(params).toMatchObject({ trackingNumber: 'TRK-777', baseCost: null, markFulfilled: false });
    expect(result.changes[0]).toMatchObject({ orderId: 'T1', before: 5, after: null, baseCostChanged: false });
    expect(result.errors.map((error) => [error.orderId, error.code])).toEqual([
      ['N2', 'MARK_REQUIRES_BOTH'],
      ['N3', 'MARK_REQUIRES_BOTH'],
      ['N4', 'NOTHING_TO_UPDATE'],
    ]);
  });

  it('7–9. OrderID không có / trùng / Basecost & Tracking sai ⇒ lỗi từng dòng, không ghi', async () => {
    const { service, repo } = build([{ tiktokOrderId: 'D1', shopId: 'shop-1', record: null }]);
    const result = await service.import(
      ORG,
      ADMIN_ID,
      await xlsx([
        HEAD,
        ['GHOST', 1, 'TRK-1'],
        ['D1', 1, 'TRK-2'],
        ['D1', 2, 'TRK-3'],
        ['BAD', 'abc', 'TRK-4'],
        ['BAD2', 1, 'TRK 5 6'],
        ['BAD3', 1, 9.4001112025558e21],
      ]),
      ADMIN,
      false,
    );
    expect(result.status).toBe('REJECTED');
    expect(result.errors.map((error) => [error.row, error.code])).toEqual([
      [2, 'ORDER_NOT_FOUND'],
      [3, 'DUPLICATE_ORDER_ID'],
      [4, 'DUPLICATE_ORDER_ID'],
      [5, 'BASE_COST_INVALID'],
      [6, 'TRACKING_INVALID'],
      [7, 'TRACKING_PRECISION_LOST'],
    ]);
    expect(repo.applyImportRow).not.toHaveBeenCalled();
    expect(repo.applyManualItemCostsBatch).not.toHaveBeenCalled();
  });

  it('10. người dùng giới hạn shop: đơn chưa fulfill ngoài shop ⇒ ORDER_NOT_FOUND, không nạp đơn', async () => {
    const { service, repo, podOrderRepo } = build([{ tiktokOrderId: 'X9', shopId: 'shop-9', record: null }]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['X9', 1, 'TRK-9']]), SELLER, false);
    expect(result.errors[0]).toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect(podOrderRepo.findRefsByTiktokOrderIds).toHaveBeenCalledWith(ORG, ['X9'], ['shop-1']);
    expect(podOrderRepo.findManyByIds).not.toHaveBeenCalled();
    expect(repo.applyImportRow).not.toHaveBeenCalled();
  });

  it('11. trạng thái đặc biệt KHÔNG bị chuyển sang đã fulfill', async () => {
    const { service, repo } = build([
      { tiktokOrderId: 'TC', shopId: 'shop-1', tiktokStatus: 'CANCELLED', record: null },
      { tiktokOrderId: 'FC', shopId: 'shop-1', record: fulfilled({ status: FulfillmentStatus.CANCELLED }) },
      { tiktokOrderId: 'FR', shopId: 'shop-1', record: fulfilled({ status: FulfillmentStatus.REJECTED }) },
      { tiktokOrderId: 'FS', shopId: 'shop-1', record: fulfilled({ status: FulfillmentStatus.SUBMITTING, submittedAt: null }) },
      { tiktokOrderId: 'FP', shopId: 'shop-1', record: fulfilled({ status: FulfillmentStatus.FAILED, providerOrderId: 'mg-77' }) },
    ]);
    const result = await service.import(
      ORG,
      ADMIN_ID,
      await xlsx([HEAD, ['TC', 1, 'TRK-1'], ['FC', 1, 'TRK-2'], ['FR', 1, 'TRK-3'], ['FS', 1, 'TRK-4'], ['FP', 1, 'TRK-5']]),
      ADMIN,
      false,
    );
    expect(result.status).toBe('REJECTED');
    expect(result.errors.map((error) => [error.orderId, error.code])).toEqual([
      ['TC', 'ORDER_CANCELLED'],
      ['FC', 'STATUS_NOT_ALLOWED'],
      ['FR', 'STATUS_NOT_ALLOWED'],
      ['FS', 'NOT_SUBMITTED'],
      ['FP', 'PROVIDER_RECEIVED'],
    ]);
    expect(repo.applyImportRow).not.toHaveBeenCalled();
  });

  describe('🔴 kết nối TikTok CHƯA gán nhà cung cấp / chưa có Product Mapping (PO 2026-11-03)', () => {
    it('2–4. chưa gán nhà cung cấp ⇒ VẪN import (Basecost + Tracking): bản ghi nhập tay KHÔNG có nhà cung cấp', async () => {
      const { service, repo } = build([
        { tiktokOrderId: 'NA', shopId: 'shop-1', record: null, fulfillmentAccount: null, lines: [line({ id: 'line-na' })] },
      ]);
      const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['NA', 6.5, 'TRK-NA']]), ADMIN, false);
      expect(result).toMatchObject({ status: 'APPLIED', markedFulfilled: 1, baseCostUpdated: 1, trackingUpdated: 1 });
      expect(result.errors).toEqual([]);
      const params = repo.applyImportRow.mock.calls[0][0] as ImportRowParams;
      expect(params.target).toEqual({
        kind: 'CREATE',
        accountId: null,
        provider: null,
        podOrderId: 'pod-0',
        externalOrderId: 'IMPORT-NA',
      });
      // Mapping khớp sản phẩm nhưng KHÔNG có nhà cung cấp để đối chiếu ⇒ không ghi SKU nhà cung cấp.
      expect(params.baseCost).toEqual({
        value: 6.5,
        create: { podOrderItemId: 'line-na', providerSku: null, productionConfig: null, color: null, size: null },
      });
      expect(params).toMatchObject({ markFulfilled: true, trackingNumber: 'TRK-NA', currency: 'USD' });
    });

    it('đơn ĐÃ fulfill của kết nối chưa gán nhà cung cấp ⇒ chỉ Basecost / chỉ Tracking vẫn cập nhật bình thường', async () => {
      const manual = fulfilled({ source: 'MANUAL_IMPORT', accountId: null, provider: null, submittedAt: null, providerOrderId: null });
      const { service, repo } = build([
        { tiktokOrderId: 'B1', shopId: 'shop-1', record: manual, fulfillmentAccount: null },
        { tiktokOrderId: 'T1', shopId: 'shop-1', record: fulfilled({ ...manual, id: 'ful-t1' }), fulfillmentAccount: null },
      ]);
      const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['B1', 4, ''], ['T1', '', 'TRK-T1']]), ADMIN, false);
      expect(result).toMatchObject({ status: 'APPLIED', baseCostUpdated: 1, trackingUpdated: 1, markedFulfilled: 0 });
      expect(repo.applyManualItemCostsBatch).toHaveBeenCalledTimes(1);
      expect((repo.applyImportRow.mock.calls[0][0] as ImportRowParams)).toMatchObject({ trackingNumber: 'TRK-T1', markFulfilled: false });
    });

    it('chưa có Product Mapping / ánh xạ của nhà cung cấp KHÁC ⇒ vẫn import, không mượn SKU của nhà cung cấp khác', async () => {
      const { service, repo } = build(
        [
          { tiktokOrderId: 'NM', shopId: 'shop-1', record: null, lines: [line({ skuId: 'V-UNMAPPED', sellerSku: 'UNMAPPED' })] },
          { tiktokOrderId: 'OP', shopId: 'shop-1', record: null, lines: [line({ productId: 'P-OTHER' })] },
          { tiktokOrderId: 'OK', shopId: 'shop-1', record: null },
        ],
        [MAPPING, { ...MAPPING, tiktokProductId: 'P-OTHER', accountId: 'facc-OTHER', providerSku: 'OTHER-SKU' }],
      );
      const result = await service.import(
        ORG,
        ADMIN_ID,
        await xlsx([HEAD, ['NM', 1, 'TRK-1'], ['OP', 1, 'TRK-2'], ['OK', 1, 'TRK-3']]),
        ADMIN,
        false,
      );
      expect(result.errors).toEqual([]);
      const skus = repo.applyImportRow.mock.calls.map(
        (call) => ((call[0] as ImportRowParams).baseCost as { create: { providerSku: string | null } }).create.providerSku,
      );
      // Có nhà cung cấp (facc-1): ánh xạ đúng nhà cung cấp ⇒ ghi SKU; không có / nhà cung cấp khác ⇒ NULL.
      expect(skus).toEqual([null, null, 'MG-TEE-BLK-L']);
      expect((repo.applyImportRow.mock.calls[0][0] as ImportRowParams).target).toMatchObject({ accountId: 'facc-1', provider: 'MANGO' });
    });

    it('validation khác GIỮ NGUYÊN: nhiều dòng hàng ⇒ MULTI_ITEM; quà chưa ánh xạ không tính là dòng thứ hai', async () => {
      const { service, repo } = build([
        { tiktokOrderId: 'ML', shopId: 'shop-1', record: null, fulfillmentAccount: null, lines: [line(), line()] },
        { tiktokOrderId: 'GF', shopId: 'shop-1', record: null, fulfillmentAccount: null, lines: [line(), line({ isGift: true, skuId: 'V-GIFT', sellerSku: 'GIFT' })] },
        { tiktokOrderId: 'TC', shopId: 'shop-1', record: null, fulfillmentAccount: null, tiktokStatus: 'CANCELLED' },
      ]);
      const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['ML', 1, 'TRK-4'], ['GF', 1, 'TRK-5'], ['TC', 1, 'TRK-6']]), ADMIN, false);
      expect(result.errors.map((error) => [error.orderId, error.code])).toEqual([
        ['ML', 'MULTI_ITEM'],
        ['TC', 'ORDER_CANCELLED'],
      ]);
      expect(repo.applyImportRow).toHaveBeenCalledTimes(1);
      expect((repo.applyImportRow.mock.calls[0][0] as ImportRowParams).target).toMatchObject({ externalOrderId: 'IMPORT-GF', provider: null });
    });

    it('nhiều đơn thuộc các shop được phép (có / không có nhà cung cấp) ⇒ mỗi đơn đúng bản ghi của nó', async () => {
      const { service, repo } = build([
        { tiktokOrderId: 'S1', shopId: 'shop-1', record: null },
        { tiktokOrderId: 'S2', shopId: 'shop-1', record: null, fulfillmentAccount: null },
      ]);
      const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['S1', 1, 'TRK-S1'], ['S2', 2, 'TRK-S2']]), SELLER, false);
      expect(result).toMatchObject({ status: 'APPLIED', markedFulfilled: 2 });
      expect(repo.applyImportRow.mock.calls.map((call) => {
        const params = call[0] as ImportRowParams;
        return [params.target.podOrderId, params.target.provider, params.trackingNumber];
      })).toEqual([
        ['pod-0', 'MANGO', 'TRK-S1'],
        ['pod-1', null, 'TRK-S2'],
      ]);
    });
  });

  it('12. ghi hỏng ⇒ dòng KHÔNG được tính là đã fulfill, báo lỗi rõ, không ném cả request', async () => {
    const { service, repo } = build([
      { tiktokOrderId: 'W1', shopId: 'shop-1', record: null },
      { tiktokOrderId: 'W2', shopId: 'shop-1', record: null },
    ]);
    repo.applyImportRow
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockRejectedValueOnce(new FulfillmentBaseCostImportStaleException());
    const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['W1', 1, 'TRK-1'], ['W2', 1, 'TRK-2']]), ADMIN, false);
    expect(result).toMatchObject({ status: 'REJECTED', markedFulfilled: 0, updatedOrders: 0, writeFailedRows: 2 });
    expect(result.errors.map((error) => [error.orderId, error.code])).toEqual([
      ['W1', 'WRITE_FAILED'],
      ['W2', 'WRITE_STALE'],
    ]);
    expect(result.changes.every((change) => !change.applied)).toBe(true);
  });

  it('13. gửi lại cùng file sau khi đã đánh dấu ⇒ không ghi gì, không tạo bản ghi / nhật ký mới', async () => {
    const marked = fulfilled(
      { source: FulfillmentSource.MANUAL_IMPORT, submittedAt: null, providerOrderId: null, trackingNumber: 'TRK-1' },
      [{ baseCost: new Prisma.Decimal('7.5'), baseCostConfirmedAt: new Date() }],
    );
    const { service, repo } = build([{ tiktokOrderId: 'N1', shopId: 'shop-1', record: marked }]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['N1', 7.5, 'TRK-1']]), ADMIN, false);
    expect(result).toMatchObject({ status: 'APPLIED', unchangedRows: 1, updatedOrders: 0, markedFulfilled: 0 });
    expect(result.changes[0]).toMatchObject({ action: 'UPDATE', unchanged: true });
    expect(repo.applyImportRow).not.toHaveBeenCalled();
    expect(repo.applyManualItemCostsBatch).not.toHaveBeenCalled();
  });

  it('dryRun có dòng lỗi ⇒ PARTIAL, đếm "sẽ cập nhật", không ghi gì', async () => {
    const { service, repo } = build([{ tiktokOrderId: 'N1', shopId: 'shop-1', record: null }]);
    const result = await service.import(ORG, ADMIN_ID, await xlsx([HEAD, ['N1', 2, 'TRK-1'], ['GHOST', 1, 'TRK-2']]), ADMIN, true);
    expect(result).toMatchObject({ status: 'PARTIAL', dryRun: true, markedFulfilled: 1, updatedOrders: 0, invalidRows: 1 });
    expect(repo.applyImportRow).not.toHaveBeenCalled();
  });

  it('14. service import KHÔNG phụ thuộc gateway / adapter nhà cung cấp (không thể gọi API gửi đơn)', () => {
    const params = Reflect.getMetadata('design:paramtypes', FulfillmentBaseCostImportService) as Array<{ name: string }>;
    expect(params.map((type) => type.name)).toEqual(['FulfillmentRepository', 'PodOrderRepository']);
  });

  it('chỉ có cột Tracking Number (không Basecost) ⇒ nhận; không có cả hai cột ⇒ lỗi cả file', async () => {
    const { service } = build([{ tiktokOrderId: 'S1', shopId: 'shop-1', record: fulfilled() }]);
    const ok = await service.import(ORG, ADMIN_ID, await xlsx([['Order ID', 'tracking'], ['S1', 'TRK-1']]), ADMIN, true);
    expect(ok).toMatchObject({ status: 'READY', trackingUpdated: 1 });
    await expect(
      service.import(ORG, ADMIN_ID, await xlsx([['OrderID', 'Note'], ['S1', 'x']]), ADMIN, true),
    ).rejects.toBeInstanceOf(FulfillmentBaseCostImportInvalidException);
  });
});

describe('resolveOrderLevelBaseCost — bản ghi nhập tay', () => {
  it('MANUAL_IMPORT không có mốc gửi vẫn nhận Base Cost; PROVIDER không có mốc gửi thì không', () => {
    const manual = fulfilled({ source: FulfillmentSource.MANUAL_IMPORT, submittedAt: null });
    expect(resolveOrderLevelBaseCost(manual, 3, MANUAL_BASE_COST_MAX)).toMatchObject({ ok: true });
    expect(resolveOrderLevelBaseCost(fulfilled({ submittedAt: null }), 3, MANUAL_BASE_COST_MAX)).toMatchObject({
      ok: false,
      reason: 'NOT_SUBMITTED',
    });
  });
});

describe('Quyền endpoint Base Cost', () => {
  const permissionsOf = (method: keyof FulfillmentController) =>
    Reflect.getMetadata(PERMISSIONS_KEY, FulfillmentController.prototype[method]) as string[];

  it('sửa tại chỗ và import đều đòi fulfillment.basecost.update; role Employee mặc định không có', () => {
    expect(permissionsOf('updateOrderBaseCost')).toEqual(['fulfillment.basecost.update']);
    expect(permissionsOf('importBaseCost')).toEqual(['fulfillment.basecost.update']);
    expect(EMPLOYEE_DEFAULT_PERMISSIONS).not.toContain('fulfillment.basecost.update');
    expect(FULFILLMENT_DEFAULT_PERMISSIONS).not.toContain('fulfillment.basecost.update');
  });
});

describe('BaseCostImportQueryDto.dryRun', () => {
  // Cùng tuỳ chọn với ValidationPipe toàn cục (main.ts): `enableImplicitConversion` từng biến "false" thành true.
  const parse = (dryRun: unknown) =>
    plainToInstance(BaseCostImportQueryDto, { dryRun }, { enableImplicitConversion: true });

  it.each([
    ['true', true],
    ['false', false],
    [undefined, undefined],
  ])('?dryRun=%s ⇒ %s', (raw, expected) => {
    const dto = parse(raw);
    expect(dto.dryRun).toBe(expected);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('giá trị lạ ⇒ lỗi validate (không âm thầm coi là ghi thật)', () => {
    expect(validateSync(parse('yes')).length).toBeGreaterThan(0);
  });
});
