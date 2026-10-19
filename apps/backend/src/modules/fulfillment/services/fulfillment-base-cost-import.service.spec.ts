import 'reflect-metadata';
import ExcelJS from 'exceljs';
import { FulfillmentStatus, Prisma } from '@prisma/client';
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
  record?: ReturnType<typeof fulfilled> | null;
}

function fulfilled(over: Record<string, unknown> = {}, items?: Array<Record<string, unknown>>) {
  return {
    id: `ful-${Math.random().toString(36).slice(2, 8)}`,
    status: FulfillmentStatus.SHIPPED as FulfillmentStatus,
    submittedAt: new Date('2026-10-02T03:57:00Z') as Date | null,
    currency: 'USD' as string | null,
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

function build(orders: FakeOrder[]) {
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
          .map(([id, order]) => ({ id, tiktokOrderId: order.tiktokOrderId })),
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

  it('có một dòng lỗi ⇒ REJECTED, không ghi đơn nào (atomic), lỗi theo số dòng', async () => {
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
    expect(result.status).toBe('REJECTED');
    expect(result.updatedOrders).toBe(0);
    expect(repo.applyManualItemCostsBatch).not.toHaveBeenCalled();
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

  it('lỗi ghi do dữ liệu đổi giữa chừng được ném ra (repo rollback)', async () => {
    const { service, repo } = build([{ tiktokOrderId: 'C1', shopId: 'shop-1', record: fulfilled() }]);
    repo.applyManualItemCostsBatch.mockRejectedValueOnce(new FulfillmentBaseCostImportStaleException());
    await expect(
      service.import(ORG, ADMIN_ID, await xlsx([['OrderID', 'Basecost'], ['C1', 5]]), ADMIN, false),
    ).rejects.toBeInstanceOf(FulfillmentBaseCostImportStaleException);
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
