import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { EmployeeStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';
import { ImportRowErrorDto } from '../../../common/excel/import-result.dto';
import {
  addSheet,
  bufferToWorkbook,
  normalizeHeader,
  parseDateCell,
  parseDecimalCell,
  readSheet,
  workbookToBuffer,
} from '../../../common/excel/excel.util';
import {
  EMPLOYEE_BCRYPT_COST,
  EMPLOYEE_SALARY_MAX,
  mapEmployeeStatusToUserStatus,
} from '../constants/employee.constants';
import {
  EMAIL_MAX_LENGTH,
  EMAIL_RE,
  EMPLOYEE_IMPORT_MAX_ROWS,
  EMPLOYEE_IMPORT_TX_MAX_WAIT_MS,
  EMPLOYEE_IMPORT_TX_TIMEOUT_MS,
  EMPLOYEE_SHEET,
  EMPLOYEE_STATUS_CODES,
  ERROR_COLUMN,
  ERROR_ROW_COLUMN,
  EXCEL_DATE_FORMAT,
  EXCEL_DATETIME_FORMAT,
  EXCEL_NUMBER_FORMAT,
  EXPORT_COLUMN,
  EXPORT_HEADERS,
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  IMPORT_COLUMNS,
  IMPORT_COLUMN_ORDER,
  IMPORT_DATE_FORMAT_HINT,
  INSTRUCTIONS_SHEET,
  PHONE_RE,
  TEMPLATE_HEADERS,
  type ImportColumnKey,
} from '../constants/employee-excel.constants';
import { EmployeeImportResultDto } from '../dto/employee-import-result.dto';
import { EmployeeQueryDto } from '../dto/employee-query.dto';
import {
  EmployeeRepository,
  type EmployeeFilterParams,
  type EmployeeUserLookup,
} from '../repositories/employee.repository';
import { generateTemporaryPassword } from '../utils/password-generator';

/**
 * Giá trị đã chuẩn hoá của một dòng import.
 * Field optional = ô trống → tạo mới dùng mặc định, cập nhật thì giữ nguyên giá trị cũ.
 */
interface RowValues {
  fullName: string;
  email: string;
  role: Role;
  phone?: string;
  dateOfBirth?: Date;
  salary?: number;
  status?: EmployeeStatus;
}

/** Một dòng đã đọc từ file (giữ giá trị gốc để dựng file lỗi). */
interface RawRow {
  rowNumber: number;
  cells: Record<string, string>;
}

/** Việc cần làm với một dòng sau khi validate xong (chưa hash mật khẩu). */
type PlannedAction =
  | { kind: 'create'; values: RowValues }
  | { kind: 'update'; values: RowValues; userId: string; employeeId: string }
  | { kind: 'skip' };

/** Action đã sẵn sàng ghi (nhánh create đã có sẵn passwordHash). */
type ResolvedAction =
  | { kind: 'create'; values: RowValues; passwordHash: string }
  | Extract<PlannedAction, { kind: 'update' } | { kind: 'skip' }>;

/** Kết quả đọc + kiểm tra cấu trúc file import. */
interface SheetData {
  /** columnKey → header thật trong file (chỉ chứa cột có mặt). */
  headerByKey: Map<ImportColumnKey, string>;
  /** Header gốc theo đúng thứ tự cột chuẩn (dùng dựng file lỗi). */
  presentHeaders: string[];
  rows: RawRow[];
}

/** Tham số dựng kết quả import. */
interface ResultInput {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowErrorDto[];
  startedAt: number;
  errorFile: string | null;
}

/**
 * EmployeeExcelService — Export / Template / Import Excel cho Employee (ADMIN-only).
 *
 * Nguyên tắc:
 * - Tenant isolation: mọi truy vấn đi qua EmployeeRepository kèm `organizationId` (ADR-004).
 * - Import "all-or-nothing": validate TOÀN BỘ file trước; chỉ ghi khi không còn lỗi, và
 *   ghi trong MỘT transaction duy nhất (lỗi ghi → rollback toàn bộ).
 * - Tái sử dụng repository/constant/util sẵn có của module Employee — không nhân bản logic.
 */
@Injectable()
export class EmployeeExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: EmployeeRepository,
  ) {}

  // ==========================================================================
  // I. EXPORT
  // ==========================================================================

  /**
   * Export Employee của Organization hiện tại ra .xlsx, áp dụng đúng filter đang dùng.
   * Trả kèm tên file dạng `employees_YYYYMMDD_HHmmss.xlsx`.
   */
  async export(
    organizationId: string,
    query: EmployeeQueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const employees = await this.repo.findAllForExport(organizationId, this.toFilterParams(query));

    const rows = employees.map((e) => ({
      [EXPORT_COLUMN.id]: e.id,
      [EXPORT_COLUMN.fullName]: e.user.fullName,
      [EXPORT_COLUMN.email]: e.user.email,
      [EXPORT_COLUMN.phone]: e.phone ?? '',
      [EXPORT_COLUMN.dateOfBirth]: e.dateOfBirth ?? '',
      [EXPORT_COLUMN.salary]: Number(e.salary),
      [EXPORT_COLUMN.role]: e.user.role.code,
      [EXPORT_COLUMN.status]: e.status,
      [EXPORT_COLUMN.createdAt]: e.createdAt,
      [EXPORT_COLUMN.updatedAt]: e.updatedAt,
    }));

    const wb = new ExcelJS.Workbook();
    // addSheet đã xử lý: header in đậm + màu nền, freeze dòng header, auto width.
    const ws = addSheet(
      wb,
      EMPLOYEE_SHEET,
      EXPORT_HEADERS.map((h) => ({ header: h, key: h })),
      rows,
    );

    // Date/Salary ghi bằng cell thật (Date/Number) → Excel lọc, sắp xếp, tính toán được.
    ws.getColumn(EXPORT_COLUMN.dateOfBirth).numFmt = EXCEL_DATE_FORMAT;
    ws.getColumn(EXPORT_COLUMN.createdAt).numFmt = EXCEL_DATETIME_FORMAT;
    ws.getColumn(EXPORT_COLUMN.updatedAt).numFmt = EXCEL_DATETIME_FORMAT;
    const salaryColumn = ws.getColumn(EXPORT_COLUMN.salary);
    salaryColumn.numFmt = EXCEL_NUMBER_FORMAT;
    salaryColumn.alignment = { horizontal: 'right' };

    return { buffer: await workbookToBuffer(wb), filename: this.exportFilename() };
  }

  /** `employees_YYYYMMDD_HHmmss.xlsx` theo giờ máy chủ. */
  private exportFilename(now: Date = new Date()): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
    const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    return `employees_${date}_${time}.xlsx`;
  }

  /** EmployeeQueryDto (filter của màn hình list) → tham số filter của repository. */
  private toFilterParams(query: EmployeeQueryDto): EmployeeFilterParams {
    return {
      fullname: query.fullname,
      email: query.email,
      status: query.status,
      department: query.department,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      roleId: query.roleId,
      search: query.search,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'desc',
    };
  }

  // ==========================================================================
  // II. TEMPLATE
  // ==========================================================================

  /** File mẫu để Import: sheet dữ liệu (chỉ có header) + sheet `Instructions`. */
  async buildTemplate(organizationId: string): Promise<Buffer> {
    const roles = await this.repo.findRolesInOrg(organizationId);

    const wb = new ExcelJS.Workbook();
    const ws = addSheet(
      wb,
      EMPLOYEE_SHEET,
      TEMPLATE_HEADERS.map((h) => ({ header: h, key: h })),
      [],
    );
    ws.getColumn(IMPORT_COLUMNS.dateOfBirth.header).numFmt = EXCEL_DATE_FORMAT;
    ws.getColumn(IMPORT_COLUMNS.salary.header).numFmt = EXCEL_NUMBER_FORMAT;

    addSheet(
      wb,
      INSTRUCTIONS_SHEET,
      [
        { header: 'Mục', key: 'item', width: 26 },
        { header: 'Nội dung', key: 'detail', width: 100 },
      ],
      this.instructionRows(roles),
    );

    return workbookToBuffer(wb);
  }

  /** Nội dung sheet Instructions — sinh từ metadata cột + Role thật của Organization. */
  private instructionRows(roles: Role[]): Array<Record<string, string>> {
    const headersOf = (required: boolean): string =>
      IMPORT_COLUMN_ORDER.filter((k) => IMPORT_COLUMNS[k].required === required)
        .map((k) => IMPORT_COLUMNS[k].header)
        .join(' · ');
    const row = (item: string, detail: string): Record<string, string> => ({ item, detail });

    return [
      row('Sheet dữ liệu', `Nhập dữ liệu vào sheet "${EMPLOYEE_SHEET}". Sheet này chỉ để tham khảo.`),
      row('Không sửa Header', 'Giữ nguyên dòng 1 (tên cột). Đổi hoặc xoá tên cột sẽ khiến import thất bại.'),
      row('Cột bắt buộc', headersOf(true)),
      row('Cột tuỳ chọn', headersOf(false)),
      row(
        'Format Date',
        `${IMPORT_COLUMNS.dateOfBirth.header}: ${IMPORT_DATE_FORMAT_HINT} (ví dụ 1990-01-15), hoặc ô định dạng Date của Excel.`,
      ),
      row(
        'Role hợp lệ',
        roles.length
          ? roles.map((r) => `${r.code} (${r.displayName})`).join(' · ')
          : 'Chưa có Role nào trong tổ chức.',
      ),
      row(
        'Status hợp lệ',
        `${EMPLOYEE_STATUS_CODES.join(' · ')}. Bỏ trống khi tạo mới → ${EmployeeStatus.ACTIVE}.`,
      ),
      row('Full Name', `Bắt buộc, ${FULL_NAME_MIN_LENGTH}–${FULL_NAME_MAX_LENGTH} ký tự.`),
      row(
        'Email',
        `Bắt buộc, đúng định dạng, tối đa ${EMAIL_MAX_LENGTH} ký tự, không được trùng nhau trong cùng file.`,
      ),
      row('Phone', 'Tuỳ chọn, 8–20 ký tự gồm chữ số, dấu +, dấu - và khoảng trắng.'),
      row('Salary', `Tuỳ chọn, số >= 0, tối đa 2 chữ số thập phân (tối đa ${EMPLOYEE_SALARY_MAX}).`),
      row(
        'Quy tắc Insert / Update',
        'Email chưa tồn tại → tạo nhân viên mới (mật khẩu sinh ngẫu nhiên). Email đã tồn tại trong tổ chức → cập nhật Full Name, Phone, Date Of Birth, Salary, Role, Status. Mật khẩu KHÔNG bao giờ bị thay đổi khi import.',
      ),
      row('Ô trống', 'Khi cập nhật, ô trống nghĩa là giữ nguyên giá trị hiện tại (không xoá dữ liệu cũ).'),
      row(
        'Xử lý lỗi',
        'Hệ thống kiểm tra toàn bộ file trước khi ghi. Chỉ cần 1 dòng lỗi thì KHÔNG dòng nào được ghi (rollback toàn bộ), và hệ thống trả về file lỗi kèm cột Error.',
      ),
      row('Giới hạn', `Tối đa ${EMPLOYEE_IMPORT_MAX_ROWS} dòng và 10MB mỗi lần import. Chỉ nhận file .xlsx.`),
    ];
  }

  // ==========================================================================
  // III. IMPORT
  // ==========================================================================

  /**
   * Import Employee từ .xlsx.
   * Bước 1 — đọc + kiểm tra cấu trúc. Bước 2 — validate toàn bộ dòng (file + DB).
   * Bước 3 — chỉ khi KHÔNG còn lỗi mới ghi, trong một transaction duy nhất.
   */
  async import(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
  ): Promise<EmployeeImportResultDto> {
    const startedAt = Date.now();
    const sheet = await this.readImportSheet(buffer);

    const roleByCode = await this.loadRoleMap(organizationId);
    const errorsByRow = new Map<number, string[]>();
    const errors: ImportRowErrorDto[] = [];

    const addError = (rowNumber: number, field: string | null, message: string): void => {
      errors.push({ sheet: EMPLOYEE_SHEET, row: rowNumber, field, message });
      const list = errorsByRow.get(rowNumber);
      if (list) list.push(message);
      else errorsByRow.set(rowNumber, [message]);
    };

    // --- Bước 2a: validate từng dòng (không phụ thuộc DB) + chống trùng email trong file ---
    const parsed: Array<{ raw: RawRow; values: RowValues }> = [];
    const emailFirstRow = new Map<string, number>();

    for (const raw of sheet.rows) {
      const values = this.validateRow(raw, sheet, roleByCode, addError);
      if (!values) continue;

      const firstRow = emailFirstRow.get(values.email);
      if (firstRow !== undefined) {
        addError(
          raw.rowNumber,
          IMPORT_COLUMNS.email.header,
          `Email '${values.email}' bị trùng trong file (đã xuất hiện ở dòng ${firstRow})`,
        );
        continue;
      }
      emailFirstRow.set(values.email, raw.rowNumber);
      parsed.push({ raw, values });
    }

    // --- Bước 2b: đối chiếu email với DB (tenant + trùng global) → quyết định create/update/skip ---
    const existingByEmail = await this.loadExistingUsers(parsed.map((p) => p.values.email));
    const plans: PlannedAction[] = [];

    for (const { raw, values } of parsed) {
      const existing = existingByEmail.get(values.email);
      if (!existing) {
        plans.push({ kind: 'create', values });
        continue;
      }
      const conflict = this.emailConflictReason(existing, organizationId);
      if (conflict) {
        addError(raw.rowNumber, IMPORT_COLUMNS.email.header, conflict);
        continue;
      }
      plans.push(this.planUpdate(values, existing));
    }

    // --- Có lỗi → KHÔNG ghi bất kỳ dòng nào, trả kèm file lỗi ---
    if (errors.length > 0) {
      return this.buildResult({
        total: sheet.rows.length,
        created: 0,
        updated: 0,
        skipped: 0,
        errors,
        startedAt,
        errorFile: await this.buildErrorFile(sheet, errorsByRow),
      });
    }

    // --- Bước 3: hash mật khẩu NGOÀI transaction (bcrypt chậm), rồi ghi một lần ---
    const resolved = await this.resolvePasswords(plans);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          for (const action of resolved) {
            if (action.kind === 'skip') {
              skipped++;
            } else if (action.kind === 'create') {
              const status = action.values.status ?? EmployeeStatus.ACTIVE;
              await this.repo.createWithUser(tx, {
                organizationId,
                actorUserId,
                roleId: action.values.role.id,
                email: action.values.email,
                passwordHash: action.passwordHash,
                fullName: action.values.fullName,
                employeeStatus: status,
                userStatus: mapEmployeeStatusToUserStatus(status),
                phone: action.values.phone,
                dateOfBirth: action.values.dateOfBirth,
                salary: action.values.salary,
              });
              created++;
            } else {
              // KHÔNG đụng tới email / mật khẩu / organizationId khi cập nhật.
              await this.repo.updateWithUser(tx, action.employeeId, action.userId, {
                actorUserId,
                fullName: action.values.fullName,
                roleId: action.values.role.id,
                employeeStatus: action.values.status,
                userStatus:
                  action.values.status !== undefined
                    ? mapEmployeeStatusToUserStatus(action.values.status)
                    : undefined,
                phone: action.values.phone,
                dateOfBirth: action.values.dateOfBirth,
                salary: action.values.salary,
              });
              updated++;
            }
          }
        },
        { maxWait: EMPLOYEE_IMPORT_TX_MAX_WAIT_MS, timeout: EMPLOYEE_IMPORT_TX_TIMEOUT_MS },
      );
    } catch (err) {
      return this.buildResult({
        total: sheet.rows.length,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [
          {
            sheet: EMPLOYEE_SHEET,
            row: 0,
            field: null,
            message: `Lỗi khi ghi dữ liệu (đã rollback toàn bộ): ${this.errorMessage(err)}`,
          },
        ],
        startedAt,
        errorFile: null,
      });
    }

    return this.buildResult({
      total: sheet.rows.length,
      created,
      updated,
      skipped,
      errors: [],
      startedAt,
      errorFile: null,
    });
  }

  /** Sinh + hash mật khẩu ngẫu nhiên cho các dòng tạo mới (giống luồng Create Employee). */
  private async resolvePasswords(plans: PlannedAction[]): Promise<ResolvedAction[]> {
    const resolved: ResolvedAction[] = [];
    for (const plan of plans) {
      if (plan.kind === 'create') {
        const passwordHash = await bcrypt.hash(generateTemporaryPassword(), EMPLOYEE_BCRYPT_COST);
        resolved.push({ ...plan, passwordHash });
      } else {
        resolved.push(plan);
      }
    }
    return resolved;
  }

  // ---------- Đọc file ----------

  /** Mở workbook, chọn sheet dữ liệu, map header và kiểm tra cột bắt buộc. */
  private async readImportSheet(buffer: Buffer): Promise<SheetData> {
    const ws = this.pickDataSheet(await this.loadWorkbook(buffer));
    const { headers, rows, rowNumbers } = readSheet(ws);

    // Header thật trong file → key cột.
    // So khớp qua normalizeHeader: bỏ `*`, gộp mọi khoảng trắng (kể cả NBSP/xuống dòng),
    // bỏ BOM/zero-width, lowercase → chịu được file đã đi qua Excel/Google Sheets.
    // Alias để nạp lại được chính file Export (VD cột `Role`).
    const actualByNormalized = new Map<string, string>();
    for (const h of headers) actualByNormalized.set(normalizeHeader(h), h);

    const headerByKey = new Map<ImportColumnKey, string>();
    const missing: string[] = [];
    for (const key of IMPORT_COLUMN_ORDER) {
      const column = IMPORT_COLUMNS[key];
      const found = [column.header, ...column.aliases]
        .map((candidate) => actualByNormalized.get(normalizeHeader(candidate)))
        .find((header): header is string => header !== undefined);
      if (found) headerByKey.set(key, found);
      else if (column.required) missing.push(column.header);
    }
    if (missing.length > 0) {
      // Kèm header đọc được để chẩn đoán ngay khi file có tên cột lạ.
      throw this.formatError(
        `Thiếu cột bắt buộc: ${missing.join(', ')}. Header đọc được ở sheet "${ws.name}": ` +
          `${headers.map((h) => `"${h}"`).join(', ') || '(không có)'}`,
      );
    }

    if (rows.length > EMPLOYEE_IMPORT_MAX_ROWS) {
      throw this.formatError(
        `File có ${rows.length} dòng, vượt giới hạn ${EMPLOYEE_IMPORT_MAX_ROWS} dòng mỗi lần import`,
      );
    }

    return {
      headerByKey,
      presentHeaders: IMPORT_COLUMN_ORDER.map((k) => headerByKey.get(k)).filter(
        (h): h is string => h !== undefined,
      ),
      rows: rows.map((cells, i) => ({ rowNumber: rowNumbers[i], cells })),
    };
  }

  private async loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
    try {
      return await bufferToWorkbook(buffer);
    } catch {
      throw this.formatError('File Excel (.xlsx) không hợp lệ hoặc bị hỏng');
    }
  }

  /** Ưu tiên sheet `Employees`; nếu không có thì lấy sheet đầu tiên khác `Instructions`. */
  private pickDataSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
    const isNamed = (sheet: ExcelJS.Worksheet, name: string): boolean =>
      sheet.name.trim().toLowerCase() === name.toLowerCase();
    const ws =
      wb.worksheets.find((s) => isNamed(s, EMPLOYEE_SHEET)) ??
      wb.worksheets.find((s) => !isNamed(s, INSTRUCTIONS_SHEET));
    if (!ws) throw this.formatError('File không có sheet dữ liệu');
    return ws;
  }

  private cell(raw: RawRow, sheet: SheetData, key: ImportColumnKey): string {
    const header = sheet.headerByKey.get(key);
    return header ? (raw.cells[header] ?? '').trim() : '';
  }

  // ---------- IV. VALIDATION ----------

  /**
   * Validate một dòng; trả `null` nếu dòng có lỗi.
   * Ghi nhận TẤT CẢ lỗi của dòng (không dừng ở lỗi đầu) để người dùng sửa một lần.
   */
  private validateRow(
    raw: RawRow,
    sheet: SheetData,
    roleByCode: Map<string, Role>,
    addError: (row: number, field: string | null, message: string) => void,
  ): RowValues | null {
    let ok = true;
    const fail = (field: string, message: string): void => {
      ok = false;
      addError(raw.rowNumber, field, message);
    };

    // Full Name — bắt buộc
    const fullName = this.cell(raw, sheet, 'fullName');
    if (!fullName) {
      fail(IMPORT_COLUMNS.fullName.header, 'Full Name không được rỗng');
    } else if (fullName.length < FULL_NAME_MIN_LENGTH || fullName.length > FULL_NAME_MAX_LENGTH) {
      fail(
        IMPORT_COLUMNS.fullName.header,
        `Full Name phải từ ${FULL_NAME_MIN_LENGTH} đến ${FULL_NAME_MAX_LENGTH} ký tự`,
      );
    }

    // Email — bắt buộc, đúng định dạng
    const email = this.cell(raw, sheet, 'email').toLowerCase();
    if (!email) {
      fail(IMPORT_COLUMNS.email.header, 'Email không được rỗng');
    } else if (email.length > EMAIL_MAX_LENGTH) {
      fail(IMPORT_COLUMNS.email.header, `Email vượt quá ${EMAIL_MAX_LENGTH} ký tự`);
    } else if (!EMAIL_RE.test(email)) {
      fail(IMPORT_COLUMNS.email.header, `Email '${email}' không đúng định dạng`);
    }

    // Role Code — bắt buộc, phải tồn tại trong Organization
    const roleCode = this.cell(raw, sheet, 'roleCode');
    let role: Role | undefined;
    if (!roleCode) {
      fail(IMPORT_COLUMNS.roleCode.header, 'Role Code không được rỗng');
    } else {
      role = roleByCode.get(roleCode.toLowerCase());
      if (!role) fail(IMPORT_COLUMNS.roleCode.header, `Role not found: '${roleCode}'`);
    }

    // Status — tuỳ chọn, phải hợp lệ
    const statusRaw = this.cell(raw, sheet, 'status');
    let status: EmployeeStatus | undefined;
    if (statusRaw) {
      const normalized = statusRaw.toUpperCase().replace(/\s+/g, '_');
      if (EMPLOYEE_STATUS_CODES.includes(normalized)) status = normalized as EmployeeStatus;
      else
        fail(
          IMPORT_COLUMNS.status.header,
          `Status '${statusRaw}' không hợp lệ (${EMPLOYEE_STATUS_CODES.join('/')})`,
        );
    }

    // Phone — tuỳ chọn
    const phoneRaw = this.cell(raw, sheet, 'phone');
    let phone: string | undefined;
    if (phoneRaw) {
      if (PHONE_RE.test(phoneRaw)) phone = phoneRaw;
      else fail(IMPORT_COLUMNS.phone.header, `Số điện thoại '${phoneRaw}' không hợp lệ`);
    }

    // Date Of Birth — tuỳ chọn, đúng định dạng
    const dobRaw = this.cell(raw, sheet, 'dateOfBirth');
    let dateOfBirth: Date | undefined;
    if (dobRaw) {
      const parsedDate = parseDateCell(dobRaw);
      if (parsedDate) dateOfBirth = parsedDate;
      else
        fail(
          IMPORT_COLUMNS.dateOfBirth.header,
          `Invalid Date: '${dobRaw}' (định dạng đúng: ${IMPORT_DATE_FORMAT_HINT})`,
        );
    }

    // Salary — tuỳ chọn, >= 0
    const salaryRaw = this.cell(raw, sheet, 'salary');
    let salary: number | undefined;
    if (salaryRaw) {
      const parsedSalary = parseDecimalCell(salaryRaw);
      if (parsedSalary === null) {
        fail(IMPORT_COLUMNS.salary.header, `Salary '${salaryRaw}' không phải số hợp lệ`);
      } else if (parsedSalary < 0) {
        fail(IMPORT_COLUMNS.salary.header, 'Salary must be >= 0');
      } else if (parsedSalary > EMPLOYEE_SALARY_MAX) {
        fail(IMPORT_COLUMNS.salary.header, `Salary vượt giới hạn ${EMPLOYEE_SALARY_MAX}`);
      } else {
        salary = parsedSalary;
      }
    }

    if (!ok || !role) return null;
    return { fullName, email, role, phone, dateOfBirth, salary, status };
  }

  // ---------- V. IMPORT LOGIC ----------

  private async loadRoleMap(organizationId: string): Promise<Map<string, Role>> {
    const roles = await this.repo.findRolesInOrg(organizationId);
    return new Map(roles.map((r) => [r.code.toLowerCase(), r]));
  }

  private async loadExistingUsers(emails: string[]): Promise<Map<string, EmployeeUserLookup>> {
    if (emails.length === 0) return new Map();
    const users = await this.repo.findUsersByEmails(emails);
    return new Map(users.map((u) => [u.email.toLowerCase(), u]));
  }

  /**
   * Email đã tồn tại nhưng KHÔNG thể cập nhật → trả thông báo lỗi (`null` = hợp lệ để cập nhật).
   * Đây là chốt chặn multi-tenant: bản ghi của Organization khác không bao giờ bị import ghi đè.
   */
  private emailConflictReason(user: EmployeeUserLookup, organizationId: string): string | null {
    if (user.organizationId !== organizationId) {
      return 'Email already exists (thuộc tổ chức khác)';
    }
    if (user.deletedAt !== null) {
      return 'Email already exists (tài khoản đã bị xoá, không thể dùng lại)';
    }
    if (!user.employee || user.employee.deletedAt !== null) {
      return 'Email already exists (tài khoản không có hồ sơ nhân viên đang hoạt động)';
    }
    return null;
  }

  /** Cập nhật, hoặc bỏ qua (skip) nếu mọi giá trị được cung cấp đều không đổi. */
  private planUpdate(values: RowValues, target: EmployeeUserLookup): PlannedAction {
    const employee = target.employee;
    if (!employee) return { kind: 'skip' };

    const changed =
      values.fullName !== target.fullName ||
      values.role.id !== target.roleId ||
      (values.status !== undefined && values.status !== employee.status) ||
      (values.phone !== undefined && values.phone !== employee.phone) ||
      (values.dateOfBirth !== undefined &&
        this.toDateString(values.dateOfBirth) !== this.toDateString(employee.dateOfBirth)) ||
      (values.salary !== undefined && values.salary !== Number(employee.salary));

    return changed
      ? { kind: 'update', values, userId: target.id, employeeId: employee.id }
      : { kind: 'skip' };
  }

  private toDateString(value: Date | null | undefined): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
  }

  // ---------- VI. KẾT QUẢ + FILE LỖI ----------

  /** File lỗi: cột `Row` + cột gốc của file upload + cột `Error` (gộp mọi lỗi của dòng). */
  private async buildErrorFile(
    sheet: SheetData,
    errorsByRow: Map<number, string[]>,
  ): Promise<string | null> {
    const failedRows = sheet.rows.filter((r) => errorsByRow.has(r.rowNumber));
    if (failedRows.length === 0) return null;

    const headers = [ERROR_ROW_COLUMN, ...sheet.presentHeaders, ERROR_COLUMN];
    const rows = failedRows.map((r) => {
      const record: Record<string, string> = { [ERROR_ROW_COLUMN]: String(r.rowNumber) };
      for (const header of sheet.presentHeaders) record[header] = r.cells[header] ?? '';
      record[ERROR_COLUMN] = (errorsByRow.get(r.rowNumber) ?? []).join(' | ');
      return record;
    });

    const wb = new ExcelJS.Workbook();
    addSheet(
      wb,
      EMPLOYEE_SHEET,
      headers.map((h) => ({ header: h, key: h })),
      rows,
    );
    return (await workbookToBuffer(wb)).toString('base64');
  }

  private buildResult(input: ResultInput): EmployeeImportResultDto {
    return {
      total: input.total,
      created: input.created,
      updated: input.updated,
      skipped: input.skipped,
      failed: input.errors.length,
      errors: input.errors,
      durationMs: Date.now() - input.startedAt,
      errorFile: input.errorFile,
      errorFileName: input.errorFile ? this.errorFilename() : null,
    };
  }

  private errorFilename(now: Date = new Date()): string {
    return this.exportFilename(now).replace(/^employees_/, 'employees_import_errors_');
  }

  // ---------- helpers ----------

  /** Lỗi cấu trúc file (sai/thiếu cột, file hỏng) — dùng kèm `throw`. */
  private formatError(message: string): BadRequestException {
    return new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message });
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
