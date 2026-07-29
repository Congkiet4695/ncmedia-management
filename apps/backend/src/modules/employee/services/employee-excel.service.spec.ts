import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmployeeStatus, UserStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../../database/prisma.service';
import { bufferToWorkbook, cellToString } from '../../../common/excel/excel.util';
import { EmployeeQueryDto } from '../dto/employee-query.dto';
import { EmployeeRepository, type EmployeeUserLookup } from '../repositories/employee.repository';
import {
  EMPLOYEE_SHEET,
  ERROR_COLUMN,
  EXPORT_COLUMN,
  INSTRUCTIONS_SHEET,
  TEMPLATE_HEADERS,
} from '../constants/employee-excel.constants';
import { EmployeeExcelService } from './employee-excel.service';

jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('$2b$12$hash') }));

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const ACTOR = 'admin-1';

const ROLE_EMPLOYEE = {
  id: 'role-emp',
  organizationId: ORG,
  code: 'EMPLOYEE',
  displayName: 'Employee',
  description: null,
  isSystem: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
};
const ROLE_ADMIN = { ...ROLE_EMPLOYEE, id: 'role-admin', code: 'ADMIN', displayName: 'Admin' };

/** Cột của file import theo đúng thứ tự template. */
const H = TEMPLATE_HEADERS;

/** Dựng buffer .xlsx từ mảng dòng (mỗi dòng là mảng ô theo thứ tự `headers`). */
async function buildXlsx(
  headers: readonly string[],
  rows: Array<Array<string | number | Date | null>>,
  sheetName = EMPLOYEE_SHEET,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow([...headers]);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Employee (kèm User + Role) giả lập cho export. */
function employeeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'emp-1',
    organizationId: ORG,
    userId: 'user-1',
    status: EmployeeStatus.ACTIVE,
    phone: '0901234567',
    dateOfBirth: new Date('1990-01-15T00:00:00.000Z'),
    salary: 15000000.5,
    createdAt: new Date('2026-07-15T08:30:00.000Z'),
    updatedAt: new Date('2026-07-16T09:00:00.000Z'),
    user: {
      id: 'user-1',
      fullName: 'Nguyen Van A',
      email: 'a@ncmedia.com',
      status: UserStatus.ACTIVE,
      role: { id: ROLE_EMPLOYEE.id, code: 'EMPLOYEE', displayName: 'Employee' },
    },
    ...overrides,
  } as never;
}

/** User đã tồn tại (luồng update). */
function existingUser(overrides: Partial<EmployeeUserLookup> = {}): EmployeeUserLookup {
  return {
    id: 'user-1',
    email: 'a@ncmedia.com',
    organizationId: ORG,
    deletedAt: null,
    fullName: 'Nguyen Van A',
    roleId: ROLE_EMPLOYEE.id,
    employee: {
      id: 'emp-1',
      deletedAt: null,
      phone: '0901234567',
      dateOfBirth: new Date('1990-01-15T00:00:00.000Z'),
      salary: { toString: () => '1000' } as never,
      status: EmployeeStatus.ACTIVE,
    },
    ...overrides,
  };
}

describe('EmployeeExcelService', () => {
  let service: EmployeeExcelService;

  const repo = {
    findAllForExport: jest.fn(),
    findRolesInOrg: jest.fn(),
    findUsersByEmails: jest.fn(),
    createWithUser: jest.fn(),
    updateWithUser: jest.fn(),
  };
  const prisma = {
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})),
  };

  /** Đối số của lần gọi updateWithUser thứ `index` (jest.fn trả `any` → ép kiểu một chỗ). */
  const updateCall = (index = 0): [unknown, string, string, Record<string, unknown>] =>
    repo.updateWithUser.mock.calls[index] as [unknown, string, string, Record<string, unknown>];

  beforeEach(async () => {
    jest.clearAllMocks();
    repo.findRolesInOrg.mockResolvedValue([ROLE_ADMIN, ROLE_EMPLOYEE]);
    repo.findUsersByEmails.mockResolvedValue([]);
    repo.findAllForExport.mockResolvedValue([]);
    repo.createWithUser.mockResolvedValue({});
    repo.updateWithUser.mockResolvedValue({});

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeExcelService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeeRepository, useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(EmployeeExcelService);
  });

  // =========================================================================
  // I. EXPORT
  // =========================================================================
  describe('export', () => {
    it('xuất đủ cột, đúng tên file, Salary là Number và Date là cell ngày', async () => {
      repo.findAllForExport.mockResolvedValue([employeeRow()]);

      const { buffer, filename } = await service.export(ORG, {});
      expect(filename).toMatch(/^employees_\d{8}_\d{6}\.xlsx$/);

      const ws = (await bufferToWorkbook(buffer)).getWorksheet(EMPLOYEE_SHEET)!;
      expect(ws.getRow(1).values).toEqual(
        expect.arrayContaining([...Object.values(EXPORT_COLUMN)]),
      );

      const header = (name: string): number =>
        (ws.getRow(1).values as string[]).indexOf(name);
      const row = ws.getRow(2);
      expect(row.getCell(header(EXPORT_COLUMN.role)).value).toBe('EMPLOYEE');
      expect(row.getCell(header(EXPORT_COLUMN.status)).value).toBe(EmployeeStatus.ACTIVE);
      expect(row.getCell(header(EXPORT_COLUMN.salary)).value).toBe(15000000.5);
      expect(row.getCell(header(EXPORT_COLUMN.dateOfBirth)).value).toBeInstanceOf(Date);
      expect(row.getCell(header(EXPORT_COLUMN.createdAt)).value).toBeInstanceOf(Date);
    });

    it('freeze header + header có style', async () => {
      const { buffer } = await service.export(ORG, {});
      const ws = (await bufferToWorkbook(buffer)).getWorksheet(EMPLOYEE_SHEET)!;
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.getRow(1).font?.bold).toBe(true);
    });

    it('luôn truyền organizationId và filter hiện tại xuống repository (multi-tenant)', async () => {
      const query = {
        status: EmployeeStatus.ACTIVE,
        search: 'nguyen',
        department: 'Kinh doanh',
        startDate: '2026-01-01',
        sortBy: 'fullName',
        sortOrder: 'asc',
        page: 3,
        limit: 10,
      } as EmployeeQueryDto;

      await service.export(ORG, query);

      expect(repo.findAllForExport).toHaveBeenCalledWith(ORG, {
        fullname: undefined,
        email: undefined,
        status: EmployeeStatus.ACTIVE,
        department: 'Kinh doanh',
        startDate: new Date('2026-01-01'),
        roleId: undefined,
        search: 'nguyen',
        sortBy: 'fullName',
        sortOrder: 'asc',
      });
    });
  });

  // =========================================================================
  // II. TEMPLATE
  // =========================================================================
  describe('buildTemplate', () => {
    it('có sheet dữ liệu đúng header và sheet Instructions liệt kê Role/Status hợp lệ', async () => {
      const wb = await bufferToWorkbook(await service.buildTemplate(ORG));

      const data = wb.getWorksheet(EMPLOYEE_SHEET)!;
      expect((data.getRow(1).values as string[]).slice(1)).toEqual([...H]);
      expect(data.rowCount).toBe(1); // chỉ header, không sinh dữ liệu giả

      const guide = wb.getWorksheet(INSTRUCTIONS_SHEET)!;
      const text = JSON.stringify(guide.getSheetValues());
      expect(text).toContain('Full Name *');
      expect(text).toContain('EMPLOYEE (Employee)');
      expect(text).toContain(EmployeeStatus.RESIGNED);
      expect(text).toContain('YYYY-MM-DD');
      expect(text).toContain('Không sửa Header');
    });
  });

  // =========================================================================
  // III + V. IMPORT
  // =========================================================================
  describe('import — tạo mới', () => {
    it('tạo Employee mới với mật khẩu random và status mặc định ACTIVE', async () => {
      const buffer = await buildXlsx(H, [
        ['Tran Van B', 'b@ncmedia.com', '0912345678', '1995-03-20', 5000000, 'EMPLOYEE', ''],
      ]);

      const result = await service.import(ORG, ACTOR, buffer);

      expect(result).toMatchObject({ total: 1, created: 1, updated: 0, skipped: 0, failed: 0 });
      expect(result.errorFile).toBeNull();
      expect(typeof result.durationMs).toBe('number');
      expect(repo.createWithUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          organizationId: ORG,
          actorUserId: ACTOR,
          email: 'b@ncmedia.com',
          fullName: 'Tran Van B',
          roleId: ROLE_EMPLOYEE.id,
          passwordHash: '$2b$12$hash',
          employeeStatus: EmployeeStatus.ACTIVE,
          userStatus: UserStatus.ACTIVE,
          phone: '0912345678',
          salary: 5000000,
          dateOfBirth: new Date('1995-03-20T00:00:00.000Z'),
        }),
      );
    });

    it('chuẩn hoá email về chữ thường và chấp nhận Role Code khác hoa/thường', async () => {
      const buffer = await buildXlsx(H, [
        ['Tran Van B', '  B@NcMedia.com ', '', '', '', 'employee', 'suspended'],
      ]);

      const result = await service.import(ORG, ACTOR, buffer);

      expect(result.failed).toBe(0);
      expect(repo.createWithUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          email: 'b@ncmedia.com',
          employeeStatus: EmployeeStatus.SUSPENDED,
          userStatus: UserStatus.SUSPENDED,
        }),
      );
    });
  });

  describe('import — cập nhật', () => {
    it('email đã tồn tại trong Organization → update, KHÔNG đụng mật khẩu', async () => {
      repo.findUsersByEmails.mockResolvedValue([existingUser()]);
      const buffer = await buildXlsx(H, [
        ['Nguyen Van A Updated', 'a@ncmedia.com', '0999999999', '1991-02-02', 2000, 'ADMIN', 'INACTIVE'],
      ]);

      const result = await service.import(ORG, ACTOR, buffer);

      expect(result).toMatchObject({ total: 1, created: 0, updated: 1, skipped: 0, failed: 0 });
      expect(repo.createWithUser).not.toHaveBeenCalled();
      const [, employeeId, userId, data] = updateCall();
      expect(employeeId).toBe('emp-1');
      expect(userId).toBe('user-1');
      expect(data).toEqual(
        expect.objectContaining({
          actorUserId: ACTOR,
          fullName: 'Nguyen Van A Updated',
          roleId: ROLE_ADMIN.id,
          employeeStatus: EmployeeStatus.INACTIVE,
          phone: '0999999999',
          salary: 2000,
        }),
      );
      expect(data).not.toHaveProperty('passwordHash');
      expect(data).not.toHaveProperty('email');
    });

    it('không có gì thay đổi → skip (không gọi update)', async () => {
      repo.findUsersByEmails.mockResolvedValue([
        existingUser({
          employee: {
            id: 'emp-1',
            deletedAt: null,
            phone: '0901234567',
            dateOfBirth: new Date('1990-01-15T00:00:00.000Z'),
            salary: { toString: () => '1000' } as never,
            status: EmployeeStatus.ACTIVE,
          },
        }),
      ]);
      const buffer = await buildXlsx(H, [
        ['Nguyen Van A', 'a@ncmedia.com', '0901234567', '1990-01-15', 1000, 'EMPLOYEE', 'ACTIVE'],
      ]);

      const result = await service.import(ORG, ACTOR, buffer);

      expect(result).toMatchObject({ total: 1, created: 0, updated: 0, skipped: 1, failed: 0 });
      expect(repo.updateWithUser).not.toHaveBeenCalled();
    });

    it('ô trống khi cập nhật = giữ nguyên (không gửi field xuống repository)', async () => {
      repo.findUsersByEmails.mockResolvedValue([existingUser()]);
      const buffer = await buildXlsx(H, [
        ['Ten Moi', 'a@ncmedia.com', '', '', '', 'EMPLOYEE', ''],
      ]);

      await service.import(ORG, ACTOR, buffer);

      const [, , , data] = updateCall();
      expect(data.fullName).toBe('Ten Moi');
      expect(data.phone).toBeUndefined();
      expect(data.dateOfBirth).toBeUndefined();
      expect(data.salary).toBeUndefined();
      expect(data.employeeStatus).toBeUndefined();
    });
  });

  // =========================================================================
  // Regression: header bị biến dạng sau khi file đi qua Excel / Google Sheets.
  // Trước đây chỉ trim+lowercase → mọi cột có KHOẢNG TRẮNG BÊN TRONG (Full Name *,
  // Role Code *, Date Of Birth) không khớp, báo "Thiếu cột bắt buộc".
  // =========================================================================
  describe('import — header biến dạng (regression)', () => {
    /** Thay khoảng trắng GIỮA CÁC CHỮ (không đụng khoảng trắng trước dấu *). */
    const inner = (replacement: string): string[] =>
      [...TEMPLATE_HEADERS].map((h) => h.replace(/ (?=[A-Za-z])/g, replacement));

    const VARIANTS: Array<[string, string[]]> = [
      ['nguyên bản', [...TEMPLATE_HEADERS]],
      ['NBSP (U+00A0) bên trong', inner('\u00A0')],
      ['hai khoảng trắng bên trong', inner('  ')],
      ['tab bên trong', inner('\t')],
      ['xuống dòng bên trong', inner('\n')],
      ['zero-width (U+200B)', inner(' \u200B')],
      ['BOM đầu chuỗi', [...TEMPLATE_HEADERS].map((h) => `\uFEFF${h}`)],
      ['thừa khoảng trắng đầu/cuối', [...TEMPLATE_HEADERS].map((h) => `  ${h}  `)],
      ['CHỮ HOA', [...TEMPLATE_HEADERS].map((h) => h.toUpperCase())],
      ['chữ thường', [...TEMPLATE_HEADERS].map((h) => h.toLowerCase())],
      ['bỏ dấu *', [...TEMPLATE_HEADERS].map((h) => h.replace(/\s*\*$/, ''))],
      ['dấu * dính liền', [...TEMPLATE_HEADERS].map((h) => h.replace(/ \*$/, '*'))],
      [
        'header của file Export',
        ['Full Name', 'Email', 'Phone', 'Date Of Birth', 'Salary', 'Role', 'Status'],
      ],
    ];

    it.each(VARIANTS)('nhận diện đúng cột khi header %s', async (_label, headers) => {
      const buffer = await buildXlsx(headers, [
        ['Tran Van B', 'b@ncmedia.com', '0912345678', '1995-03-20', 5000000, 'EMPLOYEE', 'ACTIVE'],
      ]);

      const result = await service.import(ORG, ACTOR, buffer);

      expect(result).toMatchObject({ created: 1, failed: 0 });
      // Cột TUỲ CHỌN cũng phải map được — nếu không, dữ liệu bị bỏ qua âm thầm.
      expect(repo.createWithUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          fullName: 'Tran Van B',
          roleId: ROLE_EMPLOYEE.id,
          phone: '0912345678',
          salary: 5000000,
          dateOfBirth: new Date('1995-03-20T00:00:00.000Z'),
          employeeStatus: EmployeeStatus.ACTIVE,
        }),
      );
    });

    it('thông báo thiếu cột có kèm header đọc được để chẩn đoán', async () => {
      const buffer = await buildXlsx(['Ho Ten', 'Thu Dien Tu'], [['A', 'b@c.com']]);
      const err: unknown = await service.import(ORG, ACTOR, buffer).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { code: string; message: string };
      expect(body.code).toBe('IMPORT_FORMAT_ERROR');
      expect(body.message).toContain('Full Name *'); // cột còn thiếu
      expect(body.message).toContain('"Ho Ten"'); // header thực tế đọc được
    });
  });

  // =========================================================================
  // IV. VALIDATION + rollback
  // =========================================================================
  describe('import — validation (lỗi bất kỳ → không ghi dòng nào)', () => {
    const expectRejected = async (
      rows: Array<Array<string | number | Date | null>>,
      messagePattern: RegExp,
    ) => {
      const result = await service.import(ORG, ACTOR, await buildXlsx(H, rows));
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.failed).toBeGreaterThan(0);
      expect(repo.createWithUser).not.toHaveBeenCalled();
      expect(repo.updateWithUser).not.toHaveBeenCalled();
      expect(result.errors.map((e) => e.message).join(' | ')).toMatch(messagePattern);
      return result;
    };

    it('thiếu Full Name', async () => {
      await expectRejected([['', 'b@ncmedia.com', '', '', '', 'EMPLOYEE', '']], /Full Name/);
    });

    it('email sai định dạng', async () => {
      await expectRejected([['Tran B', 'not-an-email', '', '', '', 'EMPLOYEE', '']], /không đúng định dạng/);
    });

    it('email trùng nhau trong cùng file', async () => {
      await expectRejected(
        [
          ['Tran B', 'b@ncmedia.com', '', '', '', 'EMPLOYEE', ''],
          ['Tran C', 'b@ncmedia.com', '', '', '', 'EMPLOYEE', ''],
        ],
        /trùng trong file/,
      );
    });

    it('Role không tồn tại', async () => {
      await expectRejected([['Tran B', 'b@ncmedia.com', '', '', '', 'MANAGER', '']], /Role not found/);
    });

    it('Status không hợp lệ', async () => {
      await expectRejected([['Tran B', 'b@ncmedia.com', '', '', '', 'EMPLOYEE', 'ON_LEAVE']], /Status/);
    });

    it('Salary âm', async () => {
      await expectRejected([['Tran B', 'b@ncmedia.com', '', '', -1, 'EMPLOYEE', '']], /Salary must be >= 0/);
    });

    it('Salary không phải số', async () => {
      await expectRejected([['Tran B', 'b@ncmedia.com', '', '', 'abc', 'EMPLOYEE', '']], /không phải số/);
    });

    it('Date Of Birth sai định dạng', async () => {
      await expectRejected([['Tran B', 'b@ncmedia.com', '', '15/03/1995', '', 'EMPLOYEE', '']], /Invalid Date/);
    });

    it('Date Of Birth không tồn tại trên lịch', async () => {
      await expectRejected([['Tran B', 'b@ncmedia.com', '', '2024-02-31', '', 'EMPLOYEE', '']], /Invalid Date/);
    });

    it('một dòng lỗi làm cả file bị từ chối (rollback toàn bộ)', async () => {
      const result = await expectRejected(
        [
          ['Tran B', 'b@ncmedia.com', '', '', '', 'EMPLOYEE', ''],
          ['Tran C', 'c@ncmedia.com', '', '', '', 'KHONG_TON_TAI', ''],
        ],
        /Role not found/,
      );
      expect(result.total).toBe(2);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('gom nhiều lỗi trong cùng một dòng', async () => {
      const result = await expectRejected(
        [['', 'sai-email', '', 'hom-qua', -5, 'KHONG_CO', 'SAI']],
        /Full Name/,
      );
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    });
  });

  // =========================================================================
  // IX. SECURITY / MULTI-TENANT
  // =========================================================================
  describe('import — cách ly Organization', () => {
    it('email thuộc Organization khác → báo lỗi, không cập nhật', async () => {
      repo.findUsersByEmails.mockResolvedValue([existingUser({ organizationId: OTHER_ORG })]);
      const buffer = await buildXlsx(H, [
        ['Ke Gian', 'a@ncmedia.com', '', '', '', 'EMPLOYEE', ''],
      ]);

      const result = await service.import(ORG, ACTOR, buffer);

      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toContain('Email already exists');
      expect(repo.updateWithUser).not.toHaveBeenCalled();
      expect(repo.createWithUser).not.toHaveBeenCalled();
    });

    it('email của tài khoản đã bị xoá mềm → báo lỗi', async () => {
      repo.findUsersByEmails.mockResolvedValue([existingUser({ deletedAt: new Date() })]);
      const buffer = await buildXlsx(H, [
        ['Nguyen Van A', 'a@ncmedia.com', '', '', '', 'EMPLOYEE', ''],
      ]);

      const result = await service.import(ORG, ACTOR, buffer);

      expect(result.failed).toBe(1);
      expect(result.errors[0].message).toContain('Email already exists');
    });

    it('chỉ dùng Role của Organization hiện tại', async () => {
      await service.import(ORG, ACTOR, await buildXlsx(H, []));
      expect(repo.findRolesInOrg).toHaveBeenCalledWith(ORG);
    });
  });

  // =========================================================================
  // VI. FILE LỖI
  // =========================================================================
  describe('file lỗi', () => {
    it('gồm cột gốc + cột Error, chỉ chứa dòng lỗi', async () => {
      const result = await service.import(
        ORG,
        ACTOR,
        await buildXlsx(H, [
          ['Tran B', 'b@ncmedia.com', '', '', '', 'EMPLOYEE', ''],
          ['Tran C', 'c@ncmedia.com', '', '', '', 'KHONG_CO', ''],
        ]),
      );

      expect(result.errorFile).toBeTruthy();
      expect(result.errorFileName).toMatch(/^employees_import_errors_\d{8}_\d{6}\.xlsx$/);

      const wb = await bufferToWorkbook(Buffer.from(result.errorFile as string, 'base64'));
      const ws = wb.getWorksheet(EMPLOYEE_SHEET)!;
      const headers = (ws.getRow(1).values as string[]).slice(1);
      expect(headers).toEqual(expect.arrayContaining([...H, ERROR_COLUMN]));
      expect(ws.rowCount).toBe(2); // header + đúng 1 dòng lỗi
      expect(cellToString(ws.getRow(2).getCell(headers.indexOf(ERROR_COLUMN) + 1).value)).toContain(
        'Role not found',
      );
    });
  });

  // =========================================================================
  // Cấu trúc file
  // =========================================================================
  describe('import — cấu trúc file', () => {
    it('thiếu cột bắt buộc → IMPORT_FORMAT_ERROR', async () => {
      const buffer = await buildXlsx(['Full Name *', 'Phone'], [['A', '0900000000']]);
      await expect(service.import(ORG, ACTOR, buffer)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('chấp nhận header của file Export (không có dấu *)', async () => {
      const buffer = await buildXlsx(
        ['Full Name', 'Email', 'Phone', 'Date Of Birth', 'Salary', 'Role', 'Status'],
        [['Tran B', 'b@ncmedia.com', '', '', '', 'EMPLOYEE', '']],
      );

      const result = await service.import(ORG, ACTOR, buffer);
      expect(result).toMatchObject({ created: 1, failed: 0 });
    });

    it('bỏ qua sheet Instructions khi tìm sheet dữ liệu', async () => {
      const wb = new ExcelJS.Workbook();
      const guide = wb.addWorksheet(INSTRUCTIONS_SHEET);
      guide.addRow(['Mục', 'Nội dung']);
      const data = wb.addWorksheet(EMPLOYEE_SHEET);
      data.addRow([...H]);
      data.addRow(['Tran B', 'b@ncmedia.com', '', '', '', 'EMPLOYEE', '']);

      const result = await service.import(ORG, ACTOR, Buffer.from(await wb.xlsx.writeBuffer()));
      expect(result).toMatchObject({ created: 1, failed: 0 });
    });

    it('file không phải .xlsx hợp lệ → IMPORT_FORMAT_ERROR', async () => {
      await expect(
        service.import(ORG, ACTOR, Buffer.from('day khong phai excel')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('file rỗng (chỉ header) → không ghi gì, không lỗi', async () => {
      const result = await service.import(ORG, ACTOR, await buildXlsx(H, []));
      expect(result).toMatchObject({ total: 0, created: 0, updated: 0, skipped: 0, failed: 0 });
    });
  });
});
