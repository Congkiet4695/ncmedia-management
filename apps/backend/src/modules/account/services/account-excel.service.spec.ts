import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../../database/prisma.service';
import { EncryptionService } from '../../../common/services/encryption.service';
import { bufferToWorkbook, readSheet } from '../../../common/excel/excel.util';
import {
  ACCOUNT_SHEET,
  EXPORT_HEADERS,
  EXPORT_ONLY_COLUMN,
  IMPORT_COLUMNS,
  INSTRUCTIONS_SHEET,
  TEMPLATE_HEADERS,
} from '../constants/account-excel.constants';
import { AccountExcelService } from './account-excel.service';

const ORG = 'org-1';
const ACTOR = 'admin-1';
const PLATFORM_ID = 'platform-tts';
const H = TEMPLATE_HEADERS;

/** Header cũ (trước khi bổ sung cột mới) — dùng kiểm tra backward compatibility. */
const LEGACY_HEADERS = [
  'Account Name',
  'Platform',
  'Username',
  'Password',
  'Email',
  'Proxy',
  'Note',
  'Status',
];

async function buildXlsx(
  headers: readonly string[],
  rows: Array<Array<string | number>>,
  sheetName = ACCOUNT_SHEET,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow([...headers]);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Một dòng đầy đủ theo thứ tự TEMPLATE_HEADERS. */
function fullRow(overrides: Partial<Record<string, string | number>> = {}): Array<string | number> {
  const base: Record<string, string | number> = {
    [IMPORT_COLUMNS.name.header]: 'ACC-01',
    [IMPORT_COLUMNS.platform.header]: 'TIKTOK_SHOP',
    [IMPORT_COLUMNS.loginTool.header]: 'Hidemyacc',
    [IMPORT_COLUMNS.sellerEmail.header]: '',
    [IMPORT_COLUMNS.status.header]: 'LIVE',
    [IMPORT_COLUMNS.issuedAt.header]: '2026-03-10',
    [IMPORT_COLUMNS.activatedAt.header]: '',
    [IMPORT_COLUMNS.diedBlankAt.header]: '',
    [IMPORT_COLUMNS.diedAt.header]: '',
    [IMPORT_COLUMNS.moneyReturnedAt.header]: '',
    [IMPORT_COLUMNS.dieReason.header]: '',
    [IMPORT_COLUMNS.holdAmount.header]: 100.5,
    [IMPORT_COLUMNS.netAmount.header]: 250,
    [IMPORT_COLUMNS.paidAmount.header]: 75.25,
    [IMPORT_COLUMNS.username.header]: 'login1',
    [IMPORT_COLUMNS.password.header]: 'p@ss',
    [IMPORT_COLUMNS.email.header]: 'rec@example.com',
    [IMPORT_COLUMNS.proxy.header]: '1.2.3.4:8080',
    [IMPORT_COLUMNS.docsUrl.header]: '',
    [IMPORT_COLUMNS.note.header]: 'ghi chú',
    [IMPORT_COLUMNS.note2.header]: '',
    ...overrides,
  };
  return H.map((h) => base[h] ?? '');
}

describe('AccountExcelService', () => {
  let service: AccountExcelService;

  const tx = {
    account: { create: jest.fn(), update: jest.fn() },
    accountCredential: { upsert: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((cb: (c: unknown) => unknown) => cb(tx)),
    account: { findMany: jest.fn() },
    platform: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const encryption = {
    encrypt: jest.fn((v: string) => `enc(${v})`),
    decryptOptional: jest.fn((v?: string | null) => (v ? v.replace(/^enc\((.*)\)$/, '$1') : null)),
  };

  /** Lấy `data` của lần gọi thứ `i` trên một jest.fn (mock.calls là `any` → ép kiểu một chỗ). */
  const callData = (fn: jest.Mock, i: number): Record<string, unknown> => {
    const calls = fn.mock.calls as Array<[{ data: Record<string, unknown> }]>;
    return calls[i][0].data;
  };
  const createArg = (i = 0): Record<string, unknown> => callData(tx.account.create, i);
  const updateArg = (i = 0): Record<string, unknown> => callData(tx.account.update, i);

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.platform.findMany.mockResolvedValue([
      { id: PLATFORM_ID, code: 'TIKTOK_SHOP', name: 'TikTok Shop' },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'seller@ncmedia.com' }]);
    prisma.account.findMany.mockResolvedValue([]);
    tx.account.create.mockResolvedValue({ id: 'acc-new' });
    tx.account.update.mockResolvedValue({});

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AccountExcelService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile();

    service = moduleRef.get(AccountExcelService);
  });

  // =========================================================================
  // TEMPLATE
  // =========================================================================
  describe('buildExample (Download Template)', () => {
    it('có đủ mọi cột nghiệp vụ, gồm Hold/Net/Paid Amount', async () => {
      const wb = await bufferToWorkbook(await service.buildExample());
      const ws = wb.getWorksheet(ACCOUNT_SHEET)!;
      const headers = (ws.getRow(1).values as string[]).slice(1);

      expect(headers).toEqual([...H]);
      expect(headers).toEqual(expect.arrayContaining(['Hold Amount', 'Net Amount', 'Paid Amount']));
      // Các cột cũ vẫn còn nguyên → file mẫu cũ vẫn dùng được.
      expect(headers).toEqual(expect.arrayContaining(LEGACY_HEADERS));
    });

    it('có sheet Instructions mô tả 3 trường tiền và quy tắc create/update', async () => {
      const wb = await bufferToWorkbook(await service.buildExample());
      const guide = wb.getWorksheet(INSTRUCTIONS_SHEET)!;
      const text = JSON.stringify(guide.getSheetValues());

      expect(text).toContain('Hold Amount');
      expect(text).toContain('Net Amount');
      expect(text).toContain('Paid Amount');
      expect(text).toContain('TẠO MỚI');
      expect(text).toContain('CẬP NHẬT');
      expect(text).toContain('TIKTOK_SHOP (TikTok Shop)');
      expect(text).toContain(AccountStatus.RETURNED);
    });

    it('freeze header + header in đậm + numFmt cột tiền', async () => {
      const wb = await bufferToWorkbook(await service.buildExample());
      const ws = wb.getWorksheet(ACCOUNT_SHEET)!;

      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.getRow(1).font?.bold).toBe(true);
      expect(ws.getColumn(H.indexOf('Hold Amount') + 1).numFmt).toBe('#,##0.00');
    });
  });

  // =========================================================================
  // EXPORT
  // =========================================================================
  describe('exportAll', () => {
    const account = {
      id: 'acc-1',
      name: 'ACC-01',
      platform: { code: 'TIKTOK_SHOP', name: 'TikTok Shop' },
      seller: { email: 'seller@ncmedia.com' },
      loginTool: 'Hidemyacc',
      status: AccountStatus.LIVE,
      issuedAt: new Date('2026-03-10T00:00:00.000Z'),
      activatedAt: null,
      diedBlankAt: null,
      diedAt: null,
      moneyReturnedAt: null,
      dieReason: null,
      holdAmount: '100.50',
      netAmount: '250.00',
      paidAmount: '75.25',
      proxy: '1.2.3.4:8080',
      docsUrl: null,
      note: 'ghi chú',
      note2: null,
      credential: { gmail: 'enc(login1)', platformPassword: 'enc(p@ss)', recoveryMail: null },
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      updatedAt: new Date('2026-07-02T09:00:00.000Z'),
    };

    it('xuất đủ toàn bộ cột (gồm 3 trường mới) và giữ nguyên cột cũ', async () => {
      prisma.account.findMany.mockResolvedValue([account]);
      const ws = (await bufferToWorkbook(await service.exportAll(ORG))).getWorksheet(ACCOUNT_SHEET)!;
      const headers = (ws.getRow(1).values as string[]).slice(1);

      expect(headers).toEqual([...EXPORT_HEADERS]);
      expect(headers).toEqual(expect.arrayContaining([...LEGACY_HEADERS, EXPORT_ONLY_COLUMN.id]));
      expect(headers).toEqual(expect.arrayContaining(['Hold Amount', 'Net Amount', 'Paid Amount']));
    });

    it('Hold/Net/Paid là cell Number, ngày là cell Date', async () => {
      prisma.account.findMany.mockResolvedValue([account]);
      const ws = (await bufferToWorkbook(await service.exportAll(ORG))).getWorksheet(ACCOUNT_SHEET)!;
      const at = (name: string): ExcelJS.CellValue =>
        ws.getRow(2).getCell((ws.getRow(1).values as string[]).indexOf(name)).value;

      expect(at('Hold Amount')).toBe(100.5);
      expect(at('Net Amount')).toBe(250);
      expect(at('Paid Amount')).toBe(75.25);
      expect(at('Issued At')).toBeInstanceOf(Date);
      expect(at(EXPORT_ONLY_COLUMN.createdAt)).toBeInstanceOf(Date);
      expect(at('Seller Email')).toBe('seller@ncmedia.com');
      expect(at('Status')).toBe(AccountStatus.LIVE);
    });

    it('chỉ đọc Account của Organization hiện tại', async () => {
      await service.exportAll(ORG);
      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG, deletedAt: null } }),
      );
    });
  });

  // =========================================================================
  // IMPORT — create
  // =========================================================================
  describe('importCreate — tạo mới', () => {
    it('tạo Account mới với đủ 3 trường tiền', async () => {
      const result = await service.importCreate(ORG, ACTOR, await buildXlsx(H, [fullRow()]));

      expect(result).toMatchObject({ total: 1, created: 1, updated: 0, failed: 0 });
      expect(createArg()).toMatchObject({
        organizationId: ORG,
        name: 'ACC-01',
        platformId: PLATFORM_ID,
        status: AccountStatus.LIVE,
        holdAmount: 100.5,
        netAmount: 250,
        paidAmount: 75.25,
        loginTool: 'Hidemyacc',
        proxy: '1.2.3.4:8080',
        createdBy: ACTOR,
      });
    });

    it('bỏ trống cột tiền → mặc định 0', async () => {
      const row = fullRow({ 'Hold Amount': '', 'Net Amount': '', 'Paid Amount': '' });
      const result = await service.importCreate(ORG, ACTOR, await buildXlsx(H, [row]));

      expect(result.created).toBe(1);
      expect(createArg()).toMatchObject({ holdAmount: 0, netAmount: 0, paidAmount: 0 });
    });

    it('gán Seller theo email trong cùng Organization', async () => {
      const row = fullRow({ 'Seller Email': 'seller@ncmedia.com' });
      await service.importCreate(ORG, ACTOR, await buildXlsx(H, [row]));
      expect(createArg().sellerUserId).toBe('user-1');
    });

    it('mã hoá credentials trước khi lưu', async () => {
      await service.importCreate(ORG, ACTOR, await buildXlsx(H, [fullRow()]));
      expect(encryption.encrypt).toHaveBeenCalledWith('p@ss');
      const upsertCalls = tx.accountCredential.upsert.mock.calls as Array<
        [{ create: Record<string, unknown> }]
      >;
      expect(upsertCalls[0][0].create).toMatchObject({
        platformPassword: 'enc(p@ss)',
        gmail: 'enc(login1)',
      });
    });
  });

  // =========================================================================
  // IMPORT — update
  // =========================================================================
  describe('importCreate — cập nhật khi Account đã tồn tại', () => {
    beforeEach(() => {
      prisma.account.findMany.mockResolvedValue([
        { id: 'acc-1', name: 'ACC-01', platformId: PLATFORM_ID },
      ]);
    });

    it('cùng (Account Name + Platform) → UPDATE, không tạo mới', async () => {
      const result = await service.importCreate(ORG, ACTOR, await buildXlsx(H, [fullRow()]));

      expect(result).toMatchObject({ total: 1, created: 0, updated: 1, failed: 0 });
      expect(tx.account.create).not.toHaveBeenCalled();
      expect(tx.account.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-1' } }),
      );
      expect(updateArg()).toMatchObject({
        holdAmount: 100.5,
        netAmount: 250,
        paidAmount: 75.25,
        updatedBy: ACTOR,
      });
    });

    it('so khớp tên không phân biệt hoa/thường', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildXlsx(H, [fullRow({ 'Account Name': 'acc-01' })]),
      );
      expect(result).toMatchObject({ created: 0, updated: 1 });
    });

    it('ô trống = giữ nguyên (không gửi field xuống DB)', async () => {
      const row = fullRow({ 'Hold Amount': '', Proxy: '', Note: '', Status: '' });
      await service.importCreate(ORG, ACTOR, await buildXlsx(H, [row]));

      const data = updateArg();
      expect(data.holdAmount).toBeUndefined();
      expect(data.proxy).toBeUndefined();
      expect(data.note).toBeUndefined();
      expect(data.status).toBeUndefined();
      expect(data.netAmount).toBe(250); // ô có giá trị vẫn được cập nhật
    });
  });

  // =========================================================================
  // VALIDATION — số tiền
  // =========================================================================
  describe('validate cột tiền', () => {
    const expectRejected = async (
      overrides: Record<string, string | number>,
      pattern: RegExp,
    ): Promise<void> => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildXlsx(H, [fullRow(overrides)]),
      );
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.failed).toBeGreaterThan(0);
      expect(tx.account.create).not.toHaveBeenCalled();
      expect(tx.account.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result.errors.map((e) => e.message).join(' | ')).toMatch(pattern);
    };

    it('Hold Amount âm → từ chối', async () => {
      await expectRejected({ 'Hold Amount': -1 }, /Hold Amount must be >= 0/);
    });

    it('Net Amount âm → từ chối', async () => {
      await expectRejected({ 'Net Amount': -0.01 }, /Net Amount must be >= 0/);
    });

    it('Paid Amount âm → từ chối', async () => {
      await expectRejected({ 'Paid Amount': -100 }, /Paid Amount must be >= 0/);
    });

    it('không phải số → từ chối', async () => {
      await expectRejected({ 'Hold Amount': 'abc' }, /không phải số hợp lệ/);
    });

    it('quá 2 chữ số thập phân → từ chối', async () => {
      await expectRejected({ 'Net Amount': '10.123' }, /không phải số hợp lệ/);
    });

    it('vượt giới hạn DECIMAL(15,2) → từ chối', async () => {
      await expectRejected({ 'Paid Amount': '99999999999999' }, /vượt giới hạn/);
    });

    it('chấp nhận dấu phẩy hàng nghìn (1,000.50)', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildXlsx(H, [fullRow({ 'Hold Amount': '1,000.50' })]),
      );
      expect(result.created).toBe(1);
      expect(createArg().holdAmount).toBe(1000.5);
    });
  });

  // =========================================================================
  // VALIDATION khác + rollback
  // =========================================================================
  describe('validate & rollback', () => {
    it('1 dòng lỗi → KHÔNG ghi dòng nào', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildXlsx(H, [
          fullRow({ 'Account Name': 'ACC-OK' }),
          fullRow({ 'Account Name': 'ACC-BAD', 'Hold Amount': -5 }),
        ]),
      );

      expect(result).toMatchObject({ total: 2, created: 0, updated: 0 });
      expect(result.failed).toBeGreaterThan(0);
      expect(tx.account.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('Platform không tồn tại → lỗi', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildXlsx(H, [fullRow({ Platform: 'KHONG_CO' })]),
      );
      expect(result.errors[0].message).toMatch(/Platform 'KHONG_CO' không tồn tại/);
    });

    it('Seller không thuộc Organization → lỗi (chốt chặn multi-tenant)', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildXlsx(H, [fullRow({ 'Seller Email': 'nguoi.la@other-org.com' })]),
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toMatch(/Không tìm thấy User/);
    });

    it('Status không hợp lệ → lỗi', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildXlsx(H, [fullRow({ Status: 'SAI' })]),
      );
      expect(result.errors[0].message).toMatch(/Status 'SAI' không hợp lệ/);
    });

    it('Ngày sai định dạng → lỗi', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildXlsx(H, [fullRow({ 'Issued At': '10/03/2026' })]),
      );
      expect(result.errors[0].message).toMatch(/không hợp lệ/);
    });

    it('trùng (Name + Platform) trong cùng file → lỗi', async () => {
      const result = await service.importCreate(
        ORG,
        ACTOR,
        await buildXlsx(H, [fullRow(), fullRow()]),
      );
      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toMatch(/trùng trong file/);
    });

    it('thiếu cột bắt buộc → IMPORT_FORMAT_ERROR', async () => {
      const buffer = await buildXlsx(['Note', 'Proxy'], [['a', 'b']]);
      await expect(service.importCreate(ORG, ACTOR, buffer)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // BACKWARD COMPATIBILITY
  // =========================================================================
  describe('tương thích ngược', () => {
    it('file Import CŨ (8 cột, chưa có 3 trường tiền) vẫn import được', async () => {
      const buffer = await buildXlsx(LEGACY_HEADERS, [
        ['ACC-LEGACY', 'TIKTOK_SHOP', 'u1', 'p1', 'e1@x.com', '1.1.1.1:80', 'note cũ', 'NEW'],
      ]);

      const result = await service.importCreate(ORG, ACTOR, buffer);

      expect(result).toMatchObject({ total: 1, created: 1, failed: 0 });
      expect(createArg()).toMatchObject({
        name: 'ACC-LEGACY',
        platformId: PLATFORM_ID,
        status: AccountStatus.NEW,
        note: 'note cũ',
        // Không có cột tiền trong file cũ → nhận mặc định 0, không lỗi.
        holdAmount: 0,
        netAmount: 0,
        paidAmount: 0,
      });
    });

    it('nạp lại chính file Export (import update theo ID) — cập nhật cả 3 trường tiền', async () => {
      prisma.account.findMany.mockResolvedValue([
        { id: '11111111-1111-4111-8111-111111111111', name: 'ACC-01', platformId: PLATFORM_ID },
      ]);
      const headers = [EXPORT_ONLY_COLUMN.id, ...H];
      const buffer = await buildXlsx(headers, [
        ['11111111-1111-4111-8111-111111111111', ...fullRow()],
      ]);

      const result = await service.importUpdate(ORG, ACTOR, buffer);

      expect(result).toMatchObject({ total: 1, updated: 1, failed: 0 });
      expect(updateArg()).toMatchObject({ holdAmount: 100.5, netAmount: 250, paidAmount: 75.25 });
    });

    it('import update: ID không thuộc Organization → lỗi, không ghi', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      const buffer = await buildXlsx(
        [EXPORT_ONLY_COLUMN.id, ...H],
        [['22222222-2222-4222-8222-222222222222', ...fullRow()]],
      );

      const result = await service.importUpdate(ORG, ACTOR, buffer);

      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toMatch(/Không tìm thấy Account ID/);
      expect(tx.account.update).not.toHaveBeenCalled();
    });

    it('header biến dạng (NBSP/xuống dòng) vẫn nhận diện đúng cột', async () => {
      const distorted = [...H].map((h) => h.replace(/ (?=[A-Za-z])/g, ' '));
      const result = await service.importCreate(ORG, ACTOR, await buildXlsx(distorted, [fullRow()]));

      expect(result).toMatchObject({ created: 1, failed: 0 });
      expect(createArg()).toMatchObject({ holdAmount: 100.5, netAmount: 250, paidAmount: 75.25 });
    });

    it('bỏ qua sheet Instructions khi tìm sheet dữ liệu', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet(INSTRUCTIONS_SHEET).addRow(['Mục', 'Nội dung']);
      const ws = wb.addWorksheet(ACCOUNT_SHEET);
      ws.addRow([...H]);
      ws.addRow(fullRow());

      const result = await service.importCreate(
        ORG,
        ACTOR,
        Buffer.from(await wb.xlsx.writeBuffer()),
      );
      expect(result).toMatchObject({ created: 1, failed: 0 });
    });
  });

  // =========================================================================
  // Round-trip Export → Import
  // =========================================================================
  it('round-trip: Export → Import Update giữ nguyên giá trị 3 trường tiền', async () => {
    prisma.account.findMany.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'ACC-RT',
        platform: { code: 'TIKTOK_SHOP', name: 'TikTok Shop' },
        platformId: PLATFORM_ID,
        seller: null,
        loginTool: null,
        status: AccountStatus.LIVE,
        issuedAt: null,
        activatedAt: null,
        diedBlankAt: null,
        diedAt: null,
        moneyReturnedAt: null,
        dieReason: null,
        holdAmount: '12.34',
        netAmount: '56.78',
        paidAmount: '90.12',
        proxy: null,
        docsUrl: null,
        note: null,
        note2: null,
        credential: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);

    const exported = await service.exportAll(ORG);
    const sheet = readSheet((await bufferToWorkbook(exported)).getWorksheet(ACCOUNT_SHEET)!);
    expect(sheet.rows[0]['Hold Amount']).toBe('12.34');

    const result = await service.importUpdate(ORG, ACTOR, exported);
    expect(result).toMatchObject({ updated: 1, failed: 0 });
    expect(updateArg()).toMatchObject({ holdAmount: 12.34, netAmount: 56.78, paidAmount: 90.12 });
  });
});
