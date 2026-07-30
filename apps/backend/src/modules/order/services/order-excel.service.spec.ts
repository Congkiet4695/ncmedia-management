import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderItemStatus, OrderNoteType, OrderStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../../database/prisma.service';
import { bufferToWorkbook, readSheet } from '../../../common/excel/excel.util';
import {
  EXPORT_ONLY_COLUMN,
  INSTRUCTIONS_SHEET,
  ITEM_COLUMN,
  ITEM_HEADERS,
  ITEMS_SHEET,
  NOTE_COLUMN,
  NOTE_HEADERS,
  NOTES_SHEET,
  ORDER_COLUMNS,
  ORDER_EXPORT_HEADERS,
  ORDER_TEMPLATE_HEADERS,
  ORDERS_SHEET,
  PLATFORM_DERIVE_ERROR,
  REFERENCE_SHEET,
} from '../constants/order-excel.constants';
import { OrderExcelService } from './order-excel.service';

const ORG = 'org-1';
const ACTOR = 'admin-1';
const H = [...ORDER_TEMPLATE_HEADERS];

const PLATFORMS = [
  { code: 'TIKTOK_SHOP', name: 'TikTok Shop' },
  { code: 'EBAY', name: 'eBay' },
];

/** Account mặc định: 1 account, có platform TIKTOK_SHOP. */
const ACCOUNT_TTS = {
  id: 'acc-tts',
  name: 'Tiktok_US_01',
  sellerUserId: 'seller-1',
  platform: { code: 'TIKTOK_SHOP' },
};

interface SheetSpec {
  name: string;
  headers: readonly string[];
  rows: Array<Array<string | number | Date>>;
}

async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow([...s.headers]);
    for (const r of s.rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Dòng sheet Orders theo thứ tự ORDER_TEMPLATE_HEADERS. */
function orderRow(over: Partial<Record<string, string | number | Date>> = {}): Array<string | number | Date> {
  const base: Record<string, string | number | Date> = {
    [ORDER_COLUMNS.orderNumber.header]: 'ORD-1',
    [ORDER_COLUMNS.platform.header]: 'TIKTOK_SHOP',
    [ORDER_COLUMNS.account.header]: 'Tiktok_US_01',
    [ORDER_COLUMNS.orderDate.header]: '2026-03-10',
    [ORDER_COLUMNS.shippingAddress.header]: '123 Main St',
    [ORDER_COLUMNS.currency.header]: 'USD',
    [ORDER_COLUMNS.status.header]: OrderStatus.WAITING,
    ...over,
  };
  return H.map((h) => base[h] ?? '');
}

/** Sheet Order Items tối thiểu (1 sản phẩm) liên kết theo Order Number. */
function itemsSheet(orderNumber = 'ORD-1'): SheetSpec {
  return {
    name: ITEMS_SHEET,
    headers: ITEM_HEADERS,
    rows: [
      ITEM_HEADERS.map((h) => {
        if (h === ITEM_COLUMN.orderNumber) return orderNumber;
        if (h === ITEM_COLUMN.productName) return 'T-Shirt';
        if (h === ITEM_COLUMN.quantity) return 2;
        if (h === ITEM_COLUMN.unitPrice) return 19.9;
        if (h === ITEM_COLUMN.fulfillmentStatus) return OrderItemStatus.PENDING;
        return '';
      }),
    ],
  };
}

describe('OrderExcelService', () => {
  let service: OrderExcelService;

  const tx = {
    order: { createMany: jest.fn(), update: jest.fn() },
    orderItem: { createMany: jest.fn(), deleteMany: jest.fn() },
    orderNote: { createMany: jest.fn(), deleteMany: jest.fn() },
    orderStatusHistory: { createMany: jest.fn() },
    orderLog: { createMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((cb: (c: unknown) => unknown) => cb(tx)),
    platform: { findMany: jest.fn() },
    account: { findMany: jest.fn() },
    order: { findMany: jest.fn() },
  };

  /** Dữ liệu `data` của lần gọi createMany thứ `i`. */
  const createManyData = (fn: jest.Mock, i = 0): Array<Record<string, unknown>> => {
    const calls = fn.mock.calls as Array<[{ data: Array<Record<string, unknown>> }]>;
    return calls[i][0].data;
  };
  const updateData = (i = 0): Record<string, unknown> => {
    const calls = tx.order.update.mock.calls as Array<[{ data: Record<string, unknown> }]>;
    return calls[i][0].data;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.platform.findMany.mockResolvedValue(PLATFORMS);
    prisma.account.findMany.mockResolvedValue([ACCOUNT_TTS]);
    prisma.order.findMany.mockResolvedValue([]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [OrderExcelService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(OrderExcelService);
  });

  // =========================================================================
  // I + VII. TEMPLATE
  // =========================================================================
  describe('buildExample (Download Template)', () => {
    it('sheet Orders có cột Order Date và giữ nguyên cột Platform', async () => {
      const wb = await bufferToWorkbook(await service.buildExample());
      const headers = (wb.getWorksheet(ORDERS_SHEET)!.getRow(1).values as string[]).slice(1);

      expect(headers).toEqual([...H]);
      expect(headers).toContain(ORDER_COLUMNS.orderDate.header);
      expect(headers).toContain(ORDER_COLUMNS.platform.header);
    });

    it('có đủ 5 sheet gồm Instructions và Reference', async () => {
      const wb = await bufferToWorkbook(await service.buildExample());
      const names = wb.worksheets.map((w) => w.name);
      expect(names).toEqual(
        expect.arrayContaining([ORDERS_SHEET, ITEMS_SHEET, NOTES_SHEET, INSTRUCTIONS_SHEET, REFERENCE_SHEET]),
      );
    });

    it('Instructions hướng dẫn nhập Order Date (3 định dạng)', async () => {
      const wb = await bufferToWorkbook(await service.buildExample());
      const text = JSON.stringify(wb.getWorksheet(INSTRUCTIONS_SHEET)!.getSheetValues());

      expect(text).toContain(ORDER_COLUMNS.orderDate.header);
      expect(text).toContain('dd/MM/yyyy');
      expect(text).toContain('yyyy-MM-dd');
      expect(text).toContain('Serial');
      expect(text).toContain('NGÀY trước THÁNG');
    });

    it('Instructions nêu rõ quy tắc Platform trống → lấy từ Account', async () => {
      const wb = await bufferToWorkbook(await service.buildExample());
      const text = JSON.stringify(wb.getWorksheet(INSTRUCTIONS_SHEET)!.getSheetValues());

      expect(text).toContain('TỰ ĐỘNG LẤY PLATFORM TỪ ACCOUNT');
      expect(text).toContain(PLATFORM_DERIVE_ERROR.accountNotFound);
      expect(text).toContain(PLATFORM_DERIVE_ERROR.multipleAccounts);
    });

    it('Reference lấy Platform từ DB (không hardcode)', async () => {
      const wb = await bufferToWorkbook(await service.buildExample());
      const text = JSON.stringify(wb.getWorksheet(REFERENCE_SHEET)!.getSheetValues());
      expect(text).toContain('TIKTOK_SHOP (TikTok Shop)');
      expect(text).toContain('EBAY (eBay)');
    });

    it('freeze header + header in đậm', async () => {
      const wb = await bufferToWorkbook(await service.buildExample());
      const ws = wb.getWorksheet(ORDERS_SHEET)!;
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.getRow(1).font?.bold).toBe(true);
    });
  });

  // =========================================================================
  // I. ĐỒNG BỘ Template / Import / Export
  // =========================================================================
  describe('đồng bộ 3 chức năng', () => {
    it('mọi cột của Template đều có trong Export', () => {
      expect(ORDER_EXPORT_HEADERS).toEqual(expect.arrayContaining([...ORDER_TEMPLATE_HEADERS]));
    });

    it('Export = ID + Template + cột read-only', () => {
      expect(ORDER_EXPORT_HEADERS[0]).toBe(EXPORT_ONLY_COLUMN.id);
      expect(ORDER_EXPORT_HEADERS).toContain(EXPORT_ONLY_COLUMN.totalAmount);
      expect(ORDER_EXPORT_HEADERS).toContain(EXPORT_ONLY_COLUMN.createdAt);
    });

    it('Template do hệ thống sinh ra import lại được ngay', async () => {
      const tpl = await service.buildExample();
      const wb = await bufferToWorkbook(tpl);
      // Template dùng Account mẫu 'TTS Sample 01' → khai báo account đó để import chạy.
      prisma.account.findMany.mockResolvedValue([
        { ...ACCOUNT_TTS, name: 'TTS Sample 01', sellerUserId: null },
      ]);

      const result = await service.importCreate(ORG, ACTOR, Buffer.from(await wb.xlsx.writeBuffer()), undefined);
      expect(result).toMatchObject({ created: 1, failed: 0 });
    });
  });

  // =========================================================================
  // II. ORDER DATE
  // =========================================================================
  describe('Order Date', () => {
    const importWith = async (value: string | number | Date) =>
      service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([
          { name: ORDERS_SHEET, headers: H, rows: [orderRow({ [ORDER_COLUMNS.orderDate.header]: value })] },
          itemsSheet(),
        ]),
        undefined,
      );

    it('nhận yyyy-MM-dd', async () => {
      const result = await importWith('2026-03-10');
      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0].orderedAt).toEqual(
        new Date('2026-03-10T00:00:00.000Z'),
      );
    });

    it('nhận dd/MM/yyyy (ngày trước tháng)', async () => {
      const result = await importWith('10/03/2026');
      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0].orderedAt).toEqual(
        new Date('2026-03-10T00:00:00.000Z'),
      );
    });

    it('nhận Excel Date Serial (số)', async () => {
      // Serial 46091 = 2026-03-10 (mốc: 45292 = 2024-01-01).
      const result = await importWith(46091);
      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0].orderedAt).toEqual(
        new Date('2026-03-10T00:00:00.000Z'),
      );
    });

    it('nhận ô Date thật của Excel', async () => {
      const result = await importWith(new Date('2026-03-10T00:00:00.000Z'));
      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0].orderedAt).toEqual(
        new Date('2026-03-10T00:00:00.000Z'),
      );
    });

    it('ngày không tồn tại (31/02/2026) → lỗi, không import', async () => {
      const result = await importWith('31/02/2026');
      expect(result).toMatchObject({ created: 0, failed: 1 });
      expect(result.errors[0].message).toMatch(/Order Date '31\/02\/2026' không hợp lệ/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('chuỗi rác → lỗi rõ ràng, rollback', async () => {
      const result = await importWith('hom-qua');
      expect(result.failed).toBe(1);
      expect(result.errors[0].field).toBe(ORDER_COLUMNS.orderDate.header);
      expect(result.errors[0].message).toContain('dd/MM/yyyy');
      expect(tx.order.createMany).not.toHaveBeenCalled();
    });

    it('bỏ trống khi tạo mới → dùng thời điểm import', async () => {
      const result = await importWith('');
      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0].orderedAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // III + IV + V. PLATFORM SUY RA TỪ ACCOUNT
  // =========================================================================
  describe('Platform suy ra từ Account', () => {
    const importRow = async (over: Partial<Record<string, string>>) =>
      service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([
          { name: ORDERS_SHEET, headers: H, rows: [orderRow(over)] },
          itemsSheet(),
        ]),
        undefined,
      );

    it('Platform CÓ dữ liệu → dùng như hiện tại', async () => {
      const result = await importRow({ [ORDER_COLUMNS.platform.header]: 'TIKTOK_SHOP' });
      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0]).toMatchObject({
        platform: 'TIKTOK_SHOP',
        accountId: ACCOUNT_TTS.id,
      });
    });

    it('Platform TRỐNG + Account tồn tại → tự lấy Platform của Account', async () => {
      const result = await importRow({ [ORDER_COLUMNS.platform.header]: '' });
      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0]).toMatchObject({
        platform: 'TIKTOK_SHOP',
        accountId: ACCOUNT_TTS.id,
      });
    });

    it('Platform TRỐNG + Account KHÔNG tồn tại → đúng thông báo yêu cầu', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      const result = await importRow({ [ORDER_COLUMNS.platform.header]: '' });

      expect(result).toMatchObject({ created: 0, failed: 1 });
      expect(result.errors[0].message).toBe(PLATFORM_DERIVE_ERROR.accountNotFound);
      expect(result.errors[0].field).toBe(ORDER_COLUMNS.platform.header);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('Platform TRỐNG + trùng tên Account trên 2 nền tảng → đúng thông báo yêu cầu', async () => {
      prisma.account.findMany.mockResolvedValue([
        ACCOUNT_TTS,
        { id: 'acc-ebay', name: 'Tiktok_US_01', sellerUserId: 'seller-1', platform: { code: 'EBAY' } },
      ]);
      const result = await importRow({ [ORDER_COLUMNS.platform.header]: '' });

      expect(result).toMatchObject({ created: 0, failed: 1 });
      expect(result.errors[0].message).toBe(PLATFORM_DERIVE_ERROR.multipleAccounts);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('Platform TRỐNG + Account chưa gán Platform → báo lỗi rõ ràng', async () => {
      prisma.account.findMany.mockResolvedValue([
        { id: 'acc-x', name: 'Tiktok_US_01', sellerUserId: null, platform: null },
      ]);
      const result = await importRow({ [ORDER_COLUMNS.platform.header]: '' });

      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toMatch(/chưa được gán Platform/);
    });

    it('Platform CÓ dữ liệu nhưng không tồn tại → lỗi như cũ', async () => {
      const result = await importRow({ [ORDER_COLUMNS.platform.header]: 'KHONG_CO' });
      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toMatch(/Platform 'KHONG_CO' không tồn tại/);
    });

    it('Platform CÓ dữ liệu + Account không thuộc nền tảng đó → lỗi', async () => {
      const result = await importRow({ [ORDER_COLUMNS.platform.header]: 'EBAY' });
      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toMatch(/không tồn tại/);
    });

    it('nhận tên nền tảng (không chỉ code)', async () => {
      const result = await importRow({ [ORDER_COLUMNS.platform.header]: 'TikTok Shop' });
      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0].platform).toBe('TIKTOK_SHOP');
    });

    it('chỉ dùng Account của Organization hiện tại', async () => {
      await importRow({});
      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG, deletedAt: null } }),
      );
    });

    it('sellerScope: Employee không quản lý Account → bị từ chối', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([
          { name: ORDERS_SHEET, headers: H, rows: [orderRow({ [ORDER_COLUMNS.platform.header]: '' })] },
          itemsSheet(),
        ]),
        'seller-khac',
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toMatch(/Bạn không quản lý Account/);
    });
  });

  // =========================================================================
  // IMPORT CREATE / SKIP / ROLLBACK
  // =========================================================================
  describe('importCreate', () => {
    it('ghi theo LÔ bằng createMany (không N+1)', async () => {
      const rows = [1, 2, 3].map((n) =>
        orderRow({ [ORDER_COLUMNS.orderNumber.header]: `ORD-${n}` }),
      );
      const items: SheetSpec = {
        name: ITEMS_SHEET,
        headers: ITEM_HEADERS,
        rows: [1, 2, 3].map((n) =>
          ITEM_HEADERS.map((h) => {
            if (h === ITEM_COLUMN.orderNumber) return `ORD-${n}`;
            if (h === ITEM_COLUMN.productName) return 'P';
            if (h === ITEM_COLUMN.quantity) return 1;
            if (h === ITEM_COLUMN.unitPrice) return 5;
            return '';
          }),
        ),
      };

      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([{ name: ORDERS_SHEET, headers: H, rows }, items]),
        undefined,
      );

      expect(result).toMatchObject({ total: 3, created: 3, failed: 0 });
      // 3 đơn nhưng chỉ 1 lần createMany cho mỗi bảng.
      expect(tx.order.createMany).toHaveBeenCalledTimes(1);
      expect(tx.orderItem.createMany).toHaveBeenCalledTimes(1);
      expect(tx.orderStatusHistory.createMany).toHaveBeenCalledTimes(1);
      expect(tx.orderLog.createMany).toHaveBeenCalledTimes(1);
      expect(createManyData(tx.order.createMany)).toHaveLength(3);
      expect(createManyData(tx.orderItem.createMany)).toHaveLength(3);
    });

    it('items liên kết đúng orderId đã sinh', async () => {
      await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([{ name: ORDERS_SHEET, headers: H, rows: [orderRow()] }, itemsSheet()]),
        undefined,
      );
      const orderId = createManyData(tx.order.createMany)[0].id;
      expect(createManyData(tx.orderItem.createMany)[0].orderId).toBe(orderId);
      expect(createManyData(tx.orderStatusHistory.createMany)[0].orderId).toBe(orderId);
    });

    it('đơn đã tồn tại → skip, không tạo trùng', async () => {
      prisma.order.findMany.mockResolvedValue([{ platform: 'TIKTOK_SHOP', orderNumber: 'ORD-1' }]);
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([{ name: ORDERS_SHEET, headers: H, rows: [orderRow()] }, itemsSheet()]),
        undefined,
      );
      expect(result).toMatchObject({ total: 1, created: 0, skipped: 1, failed: 0 });
      expect(tx.order.createMany).not.toHaveBeenCalled();
    });

    it('thiếu sản phẩm → lỗi', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([{ name: ORDERS_SHEET, headers: H, rows: [orderRow()] }]),
        undefined,
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toMatch(/phải có ít nhất 1 sản phẩm/);
    });

    it('1 dòng lỗi → KHÔNG ghi dòng nào (rollback toàn bộ)', async () => {
      const rows = [
        orderRow({ [ORDER_COLUMNS.orderNumber.header]: 'ORD-1' }),
        orderRow({ [ORDER_COLUMNS.orderNumber.header]: 'ORD-2', [ORDER_COLUMNS.status.header]: 'SAI' }),
      ];
      const items: SheetSpec = {
        name: ITEMS_SHEET,
        headers: ITEM_HEADERS,
        rows: ['ORD-1', 'ORD-2'].map((n) =>
          ITEM_HEADERS.map((h) => {
            if (h === ITEM_COLUMN.orderNumber) return n;
            if (h === ITEM_COLUMN.productName) return 'P';
            if (h === ITEM_COLUMN.quantity) return 1;
            if (h === ITEM_COLUMN.unitPrice) return 5;
            return '';
          }),
        ),
      };

      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([{ name: ORDERS_SHEET, headers: H, rows }, items]),
        undefined,
      );

      expect(result).toMatchObject({ total: 2, created: 0, updated: 0 });
      expect(result.failed).toBeGreaterThan(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.order.createMany).not.toHaveBeenCalled();
    });

    it('lỗi khi ghi DB → trả lỗi rollback', async () => {
      prisma.$transaction.mockImplementationOnce(() => Promise.reject(new Error('deadlock')));
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([{ name: ORDERS_SHEET, headers: H, rows: [orderRow()] }, itemsSheet()]),
        undefined,
      );
      expect(result).toMatchObject({ created: 0, failed: 1 });
      expect(result.errors[0].message).toMatch(/đã rollback/);
    });

    it('thiếu cột bắt buộc → IMPORT_FORMAT_ERROR', async () => {
      const buffer = await buildWorkbook([
        { name: ORDERS_SHEET, headers: ['Order Number'], rows: [['ORD-1']] },
      ]);
      await expect(service.importCreate(ORG, ACTOR, buffer, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ghi kèm notes khi có sheet Order Notes', async () => {
      const notes: SheetSpec = {
        name: NOTES_SHEET,
        headers: NOTE_HEADERS,
        rows: [
          NOTE_HEADERS.map((h) => {
            if (h === NOTE_COLUMN.orderNumber) return 'ORD-1';
            if (h === NOTE_COLUMN.type) return OrderNoteType.SELLER;
            if (h === NOTE_COLUMN.content) return 'Giao nhanh';
            return '';
          }),
        ],
      };
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([
          { name: ORDERS_SHEET, headers: H, rows: [orderRow()] },
          itemsSheet(),
          notes,
        ]),
        undefined,
      );
      expect(result.created).toBe(1);
      expect(createManyData(tx.orderNote.createMany)[0]).toMatchObject({
        type: OrderNoteType.SELLER,
        content: 'Giao nhanh',
      });
    });
  });

  // =========================================================================
  // IMPORT UPDATE
  // =========================================================================
  describe('importUpdate', () => {
    const ID = '11111111-1111-4111-8111-111111111111';
    const updateHeaders = [EXPORT_ONLY_COLUMN.id, ...H];

    beforeEach(() => {
      prisma.order.findMany.mockResolvedValue([{ id: ID, status: OrderStatus.WAITING }]);
    });

    it('cập nhật Order Date từ file', async () => {
      const result = await service.importUpdate(
        ORG,
        ACTOR,
        await buildWorkbook([
          {
            name: ORDERS_SHEET,
            headers: updateHeaders,
            rows: [[ID, ...orderRow({ [ORDER_COLUMNS.orderDate.header]: '25/12/2026' })]],
          },
        ]),
        undefined,
      );

      expect(result).toMatchObject({ updated: 1, failed: 0 });
      expect(updateData().orderedAt).toEqual(new Date('2026-12-25T00:00:00.000Z'));
    });

    it('Order Date trống → giữ nguyên (không ghi field)', async () => {
      await service.importUpdate(
        ORG,
        ACTOR,
        await buildWorkbook([
          {
            name: ORDERS_SHEET,
            headers: updateHeaders,
            rows: [[ID, ...orderRow({ [ORDER_COLUMNS.orderDate.header]: '' })]],
          },
        ]),
        undefined,
      );
      expect(updateData().orderedAt).toBeUndefined();
    });

    it('Order Date sai định dạng → lỗi, không cập nhật', async () => {
      const result = await service.importUpdate(
        ORG,
        ACTOR,
        await buildWorkbook([
          {
            name: ORDERS_SHEET,
            headers: updateHeaders,
            rows: [[ID, ...orderRow({ [ORDER_COLUMNS.orderDate.header]: '2026/31/31' })]],
          },
        ]),
        undefined,
      );
      expect(result.failed).toBe(1);
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('ghi status history khi status đổi + log theo lô', async () => {
      const result = await service.importUpdate(
        ORG,
        ACTOR,
        await buildWorkbook([
          {
            name: ORDERS_SHEET,
            headers: updateHeaders,
            rows: [[ID, ...orderRow({ [ORDER_COLUMNS.status.header]: OrderStatus.CANCELLED })]],
          },
        ]),
        undefined,
      );

      expect(result.updated).toBe(1);
      expect(createManyData(tx.orderStatusHistory.createMany)[0]).toMatchObject({
        oldStatus: OrderStatus.WAITING,
        newStatus: OrderStatus.CANCELLED,
      });
      expect(tx.orderLog.createMany).toHaveBeenCalledTimes(1);
    });

    it('ID ngoài phạm vi → lỗi, không ghi', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      const result = await service.importUpdate(
        ORG,
        ACTOR,
        await buildWorkbook([
          { name: ORDERS_SHEET, headers: updateHeaders, rows: [[ID, ...orderRow()]] },
        ]),
        undefined,
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toMatch(/Không tìm thấy Order ID/);
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('thiếu cột ID → IMPORT_FORMAT_ERROR', async () => {
      const buffer = await buildWorkbook([{ name: ORDERS_SHEET, headers: H, rows: [orderRow()] }]);
      await expect(service.importUpdate(ORG, ACTOR, buffer, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // VI. EXPORT
  // =========================================================================
  describe('exportAll', () => {
    const order = {
      id: '22222222-2222-4222-8222-222222222222',
      orderNumber: 'ORD-EXP',
      platform: 'TIKTOK_SHOP',
      account: { name: 'Tiktok_US_01' },
      fulfilledBy: { email: 'ff@ncmedia.com' },
      orderedAt: new Date('2026-03-10T07:30:00.000Z'),
      shippingAddress: '123 Main St',
      currency: 'USD',
      status: OrderStatus.WAITING,
      claimedAt: new Date('2026-03-11T02:00:00.000Z'),
      createdAt: new Date('2026-03-09T00:00:00.000Z'),
      updatedAt: new Date('2026-03-12T00:00:00.000Z'),
      items: [
        {
          productName: 'T-Shirt',
          productLink: null,
          color: 'Black',
          size: 'XL',
          quantity: 2,
          unitPrice: '19.90',
          trackingNumber: null,
          fulfillmentStatus: OrderItemStatus.PENDING,
          image: null,
          remark: null,
        },
      ],
      notes: [{ type: OrderNoteType.SELLER, content: 'Giao nhanh' }],
    };

    it('có cột Order Date và xuất đúng dữ liệu (cell Date)', async () => {
      prisma.order.findMany.mockResolvedValue([order]);
      const ws = (await bufferToWorkbook(await service.exportAll(ORG))).getWorksheet(ORDERS_SHEET)!;
      const headers = (ws.getRow(1).values as string[]).slice(1);

      expect(headers).toEqual([...ORDER_EXPORT_HEADERS]);
      expect(headers).toContain(ORDER_COLUMNS.orderDate.header);
      const cell = ws.getRow(2).getCell(
        (ws.getRow(1).values as string[]).indexOf(ORDER_COLUMNS.orderDate.header),
      );
      expect(cell.value).toEqual(order.orderedAt);
    });

    it('xuất đủ trường: Total Amount, Fulfilled By, Claimed At', async () => {
      prisma.order.findMany.mockResolvedValue([order]);
      const sheet = readSheet(
        (await bufferToWorkbook(await service.exportAll(ORG))).getWorksheet(ORDERS_SHEET)!,
      );
      const row = sheet.rows[0];
      expect(row[EXPORT_ONLY_COLUMN.totalAmount]).toBe('39.8');
      expect(row[EXPORT_ONLY_COLUMN.fulfilledBy]).toBe('ff@ncmedia.com');
      expect(row[ORDER_COLUMNS.platform.header]).toBe('TIKTOK_SHOP');
      expect(row[ORDER_COLUMNS.account.header]).toBe('Tiktok_US_01');
    });

    it('file Export nạp lại được ngay bằng importUpdate (không cần sửa)', async () => {
      prisma.order.findMany.mockResolvedValue([order]);
      const exported = await service.exportAll(ORG);

      prisma.order.findMany.mockResolvedValue([{ id: order.id, status: OrderStatus.WAITING }]);
      const result = await service.importUpdate(ORG, ACTOR, exported, undefined);

      expect(result).toMatchObject({ total: 1, updated: 1, failed: 0 });
      // Order Date round-trip nguyên vẹn (giữ cả giờ).
      expect(updateData().orderedAt).toEqual(order.orderedAt);
      // Items được nạp lại theo Order ID.
      expect(createManyData(tx.orderItem.createMany)[0]).toMatchObject({
        orderId: order.id,
        productName: 'T-Shirt',
        quantity: 2,
      });
    });

    it('tenant + sellerScope được truyền xuống query', async () => {
      await service.exportAll(ORG, 'seller-1');
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, deletedAt: null, account: { sellerUserId: 'seller-1' } },
        }),
      );
    });
  });

  // =========================================================================
  // VIII. BACKWARD COMPATIBILITY
  // =========================================================================
  describe('tương thích ngược', () => {
    /** Header sheet Orders của bản CŨ (chưa có Order Date). */
    const LEGACY_HEADERS = [
      'Order Number',
      'Platform',
      'Account',
      'Shipping Address',
      'Currency',
      'Status',
    ];

    it('file Import CŨ (không có cột Order Date) vẫn import được', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([
          {
            name: ORDERS_SHEET,
            headers: LEGACY_HEADERS,
            rows: [['ORD-OLD', 'TIKTOK_SHOP', 'Tiktok_US_01', 'addr', 'USD', OrderStatus.WAITING]],
          },
          itemsSheet('ORD-OLD'),
        ]),
        undefined,
      );

      expect(result).toMatchObject({ total: 1, created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0].orderedAt).toBeInstanceOf(Date);
    });

    it('header biến dạng (NBSP) vẫn nhận diện đúng cột', async () => {
      const distorted = H.map((h) => h.replace(/ (?=[A-Za-z])/g, ' '));
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([
          { name: ORDERS_SHEET, headers: distorted, rows: [orderRow()] },
          itemsSheet(),
        ]),
        undefined,
      );
      expect(result).toMatchObject({ created: 1, failed: 0 });
    });

    it('nhận alias tên cột (Ordered At)', async () => {
      const aliased = H.map((h) => (h === ORDER_COLUMNS.orderDate.header ? 'Ordered At' : h));
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildWorkbook([
          { name: ORDERS_SHEET, headers: aliased, rows: [orderRow()] },
          itemsSheet(),
        ]),
        undefined,
      );
      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createManyData(tx.order.createMany)[0].orderedAt).toEqual(
        new Date('2026-03-10T00:00:00.000Z'),
      );
    });
  });
});
