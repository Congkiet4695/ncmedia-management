import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { EncryptionService } from '../../../common/services/encryption.service';
import {
  ImportResultDto,
  ImportRowErrorDto,
} from '../../../common/excel/import-result.dto';
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
  ACCOUNT_AMOUNT_DECIMALS,
  ACCOUNT_AMOUNT_MAX,
} from '../constants/account.constants';
import {
  ACCOUNT_IMPORT_MAX_ROWS,
  ACCOUNT_IMPORT_TX_MAX_WAIT_MS,
  ACCOUNT_IMPORT_TX_TIMEOUT_MS,
  ACCOUNT_SHEET,
  ACCOUNT_STATUS_CODES,
  CREDENTIAL_COLUMN_MAP,
  DATE_COLUMN_KEYS,
  EXCEL_DATE_FORMAT,
  EXCEL_DATETIME_FORMAT,
  EXCEL_MONEY_FORMAT,
  EXPORT_HEADERS,
  EXPORT_ONLY_COLUMN,
  FIELD_MAX_LENGTH,
  IMPORT_COLUMNS,
  IMPORT_COLUMN_ORDER,
  IMPORT_DATE_FORMAT_HINT,
  INSTRUCTIONS_SHEET,
  MONEY_COLUMN_KEYS,
  TEMPLATE_HEADERS,
  UUID_RE,
  type AccountImportColumnKey,
} from '../constants/account-excel.constants';
import { AccountWriteData } from '../repositories/account.repository';

/** Credential đọc từ file (plaintext, sẽ mã hoá trước khi ghi). */
type CredInput = Partial<Record<(typeof CREDENTIAL_COLUMN_MAP)[keyof typeof CREDENTIAL_COLUMN_MAP], string>>;

/** Giá trị một dòng đã validate. `undefined` = ô trống → giữ nguyên khi update. */
interface RowValues {
  name: string;
  platformId: string;
  data: AccountWriteData;
  cred: CredInput;
}

/** Một dòng thô đọc từ file. */
interface RawRow {
  rowNumber: number;
  cells: Record<string, string>;
}

/** Kết quả đọc + kiểm tra cấu trúc file. */
interface SheetData {
  headerByKey: Map<AccountImportColumnKey, string>;
  /** Header `ID` thật trong file (chỉ dùng cho import update). */
  idHeader?: string;
  rows: RawRow[];
  sheetName: string;
}

/** Account tối thiểu để đối chiếu khi import. */
interface ExistingAccount {
  id: string;
  name: string;
  platformId: string | null;
}

/**
 * AccountExcelService — Import / Export / Template Excel cho Account (permission `account.export`
 * / `account.import`).
 *
 * Nguyên tắc:
 * - Tenant isolation: mọi truy vấn kèm `organizationId` (ADR-004).
 * - Import "all-or-nothing": validate TOÀN BỘ file trước; chỉ ghi khi sạch lỗi và ghi trong
 *   MỘT transaction (lỗi bất kỳ → rollback toàn bộ).
 * - Import theo khoá (Account Name + Platform): chưa có → tạo mới; đã có → cập nhật.
 * - Header khớp qua `normalizeHeader` nên chịu được file đã đi qua Excel/Google Sheets, và
 *   nhận cả tên cột cũ (alias) → **không phá file Import/Export cũ**.
 */
@Injectable()
export class AccountExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  // ==========================================================================
  // TEMPLATE
  // ==========================================================================

  /** File mẫu Import: sheet dữ liệu (đủ mọi cột + 1 dòng ví dụ) + sheet Instructions. */
  async buildExample(): Promise<Buffer> {
    const platforms = await this.loadPlatforms();
    const sampleStatus = AccountStatus.NEW;

    const wb = new ExcelJS.Workbook();
    const ws = addSheet(
      wb,
      ACCOUNT_SHEET,
      TEMPLATE_HEADERS.map((h) => ({ header: h, key: h })),
      [
        {
          [IMPORT_COLUMNS.name.header]: 'TTS Sample 01',
          [IMPORT_COLUMNS.platform.header]: platforms[0]?.code ?? '',
          [IMPORT_COLUMNS.loginTool.header]: 'Hidemyacc',
          [IMPORT_COLUMNS.sellerEmail.header]: '',
          [IMPORT_COLUMNS.status.header]: sampleStatus,
          [IMPORT_COLUMNS.issuedAt.header]: '2026-03-10',
          [IMPORT_COLUMNS.activatedAt.header]: '',
          [IMPORT_COLUMNS.diedBlankAt.header]: '',
          [IMPORT_COLUMNS.diedAt.header]: '',
          [IMPORT_COLUMNS.moneyReturnedAt.header]: '',
          [IMPORT_COLUMNS.dieReason.header]: '',
          [IMPORT_COLUMNS.holdAmount.header]: 0,
          [IMPORT_COLUMNS.netAmount.header]: 0,
          [IMPORT_COLUMNS.paidAmount.header]: 0,
          [IMPORT_COLUMNS.username.header]: 'seller_login',
          [IMPORT_COLUMNS.password.header]: 'P@ssw0rd1',
          [IMPORT_COLUMNS.email.header]: 'recovery@example.com',
          [IMPORT_COLUMNS.proxy.header]: '1.2.3.4:8080',
          [IMPORT_COLUMNS.docsUrl.header]: '',
          [IMPORT_COLUMNS.note.header]: 'Tài khoản mẫu',
          [IMPORT_COLUMNS.note2.header]: '',
        },
      ],
    );
    this.applyColumnFormats(ws);

    addSheet(
      wb,
      INSTRUCTIONS_SHEET,
      [
        { header: 'Mục', key: 'item', width: 26 },
        { header: 'Nội dung', key: 'detail', width: 100 },
      ],
      this.instructionRows(platforms),
    );

    return workbookToBuffer(wb);
  }

  private instructionRows(
    platforms: Array<{ code: string; name: string }>,
  ): Array<Record<string, string>> {
    const headersOf = (required: boolean): string =>
      IMPORT_COLUMN_ORDER.filter((k) => IMPORT_COLUMNS[k].required === required)
        .map((k) => IMPORT_COLUMNS[k].header)
        .join(' · ');
    const money = MONEY_COLUMN_KEYS.map((k) => IMPORT_COLUMNS[k].header).join(' · ');
    const dates = DATE_COLUMN_KEYS.map((k) => IMPORT_COLUMNS[k].header).join(' · ');
    const row = (item: string, detail: string): Record<string, string> => ({ item, detail });

    return [
      row('Sheet dữ liệu', `Nhập dữ liệu vào sheet "${ACCOUNT_SHEET}". Sheet này chỉ để tham khảo.`),
      row('Dòng ví dụ', 'Dòng dữ liệu mẫu trong sheet Accounts chỉ để minh hoạ định dạng — HÃY XOÁ trước khi import.'),
      row('Không sửa Header', 'Giữ nguyên dòng 1 (tên cột). Đổi hoặc xoá tên cột sẽ khiến import thất bại.'),
      row('Cột bắt buộc', headersOf(true)),
      row('Cột tuỳ chọn', headersOf(false)),
      row(
        'Quy tắc Create / Update',
        `Khoá đối chiếu = ${IMPORT_COLUMNS.name.header} + ${IMPORT_COLUMNS.platform.header}. Chưa tồn tại trong tổ chức → TẠO MỚI. Đã tồn tại → CẬP NHẬT.`,
      ),
      row('Ô trống', 'Khi cập nhật, ô trống nghĩa là giữ nguyên giá trị hiện tại (không xoá dữ liệu cũ).'),
      row('Platform', platforms.length ? platforms.map((p) => `${p.code} (${p.name})`).join(' · ') : 'Chưa có Platform nào.'),
      row('Status hợp lệ', `${ACCOUNT_STATUS_CODES.join(' · ')}. Bỏ trống khi tạo mới → ${AccountStatus.NEW}.`),
      row('Cột tiền (USD)', `${money}: số >= 0, tối đa ${ACCOUNT_AMOUNT_DECIMALS} chữ số thập phân, tối đa ${ACCOUNT_AMOUNT_MAX}. KHÔNG chấp nhận giá trị âm. Bỏ trống khi tạo mới → 0.`),
      row('Cột ngày', `${dates}: ${IMPORT_DATE_FORMAT_HINT} (ví dụ 2026-03-10) hoặc ô định dạng Date của Excel.`),
      row(
        IMPORT_COLUMNS.sellerEmail.header,
        'Email của User trong cùng tổ chức sẽ quản lý Account. Bỏ trống = không gán.',
      ),
      row(
        'Cột nhạy cảm',
        `${IMPORT_COLUMNS.username.header} / ${IMPORT_COLUMNS.password.header} / ${IMPORT_COLUMNS.email.header} được MÃ HOÁ khi lưu. Bỏ trống = giữ nguyên giá trị đang có.`,
      ),
      row(
        'Xử lý lỗi',
        'Hệ thống kiểm tra toàn bộ file trước khi ghi. Chỉ cần 1 dòng lỗi thì KHÔNG dòng nào được ghi (rollback toàn bộ).',
      ),
      row('Giới hạn', `Tối đa ${ACCOUNT_IMPORT_MAX_ROWS} dòng mỗi lần import. Chỉ nhận file .xlsx.`),
    ];
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  /** Export toàn bộ Account của Organization — đầy đủ mọi cột nghiệp vụ (kèm ID). */
  async exportAll(organizationId: string): Promise<Buffer> {
    const accounts = await this.prisma.account.findMany({
      where: { organizationId, deletedAt: null },
      include: { platform: true, credential: true, seller: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const rows = accounts.map((a) => ({
      [EXPORT_ONLY_COLUMN.id]: a.id,
      [IMPORT_COLUMNS.name.header]: a.name,
      [IMPORT_COLUMNS.platform.header]: a.platform?.code ?? '',
      [IMPORT_COLUMNS.loginTool.header]: a.loginTool ?? '',
      [IMPORT_COLUMNS.sellerEmail.header]: a.seller?.email ?? '',
      [IMPORT_COLUMNS.status.header]: a.status,
      [IMPORT_COLUMNS.issuedAt.header]: a.issuedAt ?? '',
      [IMPORT_COLUMNS.activatedAt.header]: a.activatedAt ?? '',
      [IMPORT_COLUMNS.diedBlankAt.header]: a.diedBlankAt ?? '',
      [IMPORT_COLUMNS.diedAt.header]: a.diedAt ?? '',
      [IMPORT_COLUMNS.moneyReturnedAt.header]: a.moneyReturnedAt ?? '',
      [IMPORT_COLUMNS.dieReason.header]: a.dieReason ?? '',
      [IMPORT_COLUMNS.holdAmount.header]: Number(a.holdAmount),
      [IMPORT_COLUMNS.netAmount.header]: Number(a.netAmount),
      [IMPORT_COLUMNS.paidAmount.header]: Number(a.paidAmount),
      [IMPORT_COLUMNS.username.header]: this.encryption.decryptOptional(a.credential?.gmail) ?? '',
      [IMPORT_COLUMNS.password.header]:
        this.encryption.decryptOptional(a.credential?.platformPassword) ?? '',
      [IMPORT_COLUMNS.email.header]:
        this.encryption.decryptOptional(a.credential?.recoveryMail) ?? '',
      [IMPORT_COLUMNS.proxy.header]: a.proxy ?? '',
      [IMPORT_COLUMNS.docsUrl.header]: a.docsUrl ?? '',
      [IMPORT_COLUMNS.note.header]: a.note ?? '',
      [IMPORT_COLUMNS.note2.header]: a.note2 ?? '',
      [EXPORT_ONLY_COLUMN.createdAt]: a.createdAt,
      [EXPORT_ONLY_COLUMN.updatedAt]: a.updatedAt,
    }));

    const wb = new ExcelJS.Workbook();
    // addSheet: header đậm + nền màu, freeze dòng 1, auto width.
    const ws = addSheet(
      wb,
      ACCOUNT_SHEET,
      EXPORT_HEADERS.map((h) => ({ header: h, key: h })),
      rows,
    );
    this.applyColumnFormats(ws);
    ws.getColumn(EXPORT_ONLY_COLUMN.createdAt).numFmt = EXCEL_DATETIME_FORMAT;
    ws.getColumn(EXPORT_ONLY_COLUMN.updatedAt).numFmt = EXCEL_DATETIME_FORMAT;

    return workbookToBuffer(wb);
  }

  /** numFmt cho cột ngày + cột tiền (dùng chung export/template). */
  private applyColumnFormats(ws: ExcelJS.Worksheet): void {
    for (const key of DATE_COLUMN_KEYS) {
      ws.getColumn(IMPORT_COLUMNS[key].header).numFmt = EXCEL_DATE_FORMAT;
    }
    for (const key of MONEY_COLUMN_KEYS) {
      const col = ws.getColumn(IMPORT_COLUMNS[key].header);
      col.numFmt = EXCEL_MONEY_FORMAT;
      col.alignment = { horizontal: 'right' };
    }
  }

  // ==========================================================================
  // IMPORT — create hoặc update theo (Account Name + Platform)
  // ==========================================================================

  async importCreate(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
  ): Promise<ImportResultDto> {
    const sheet = await this.readSheetData(buffer, false);
    const ctx = await this.loadLookups(organizationId);
    const errors: ImportRowErrorDto[] = [];

    const parsed: Array<{ raw: RawRow; values: RowValues }> = [];
    const keyFirstRow = new Map<string, number>();

    for (const raw of sheet.rows) {
      const values = this.validateRow(raw, sheet, ctx, errors);
      if (!values) continue;

      const key = this.accountKey(values.name, values.platformId);
      const first = keyFirstRow.get(key);
      if (first !== undefined) {
        errors.push(
          this.err(
            raw.rowNumber,
            IMPORT_COLUMNS.name.header,
            `Account '${values.name}' + Platform này bị trùng trong file (đã có ở dòng ${first})`,
          ),
        );
        continue;
      }
      keyFirstRow.set(key, raw.rowNumber);
      parsed.push({ raw, values });
    }

    if (errors.length > 0) return this.result(sheet.rows.length, 0, 0, 0, errors);

    // Đối chiếu DB: đã tồn tại → update, chưa có → create.
    const existingByKey = new Map(
      ctx.existing.map((a) => [this.accountKey(a.name, a.platformId ?? ''), a.id]),
    );

    let created = 0;
    let updated = 0;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          for (const { values } of parsed) {
            const existingId = existingByKey.get(this.accountKey(values.name, values.platformId));
            if (existingId) {
              await this.applyUpdate(tx, existingId, values, actorUserId);
              updated++;
            } else {
              await this.applyCreate(tx, organizationId, values, actorUserId);
              created++;
            }
          }
        },
        { maxWait: ACCOUNT_IMPORT_TX_MAX_WAIT_MS, timeout: ACCOUNT_IMPORT_TX_TIMEOUT_MS },
      );
    } catch (err) {
      return this.result(sheet.rows.length, 0, 0, 0, [
        this.err(0, null, `Lỗi khi ghi dữ liệu (đã rollback toàn bộ): ${this.msg(err)}`),
      ]);
    }

    return this.result(sheet.rows.length, created, updated, 0, []);
  }

  // ==========================================================================
  // IMPORT UPDATE — theo cột ID (nạp lại file Export)
  // ==========================================================================

  async importUpdate(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
  ): Promise<ImportResultDto> {
    const sheet = await this.readSheetData(buffer, true);
    const ctx = await this.loadLookups(organizationId);
    const errors: ImportRowErrorDto[] = [];
    const parsed: Array<{ raw: RawRow; id: string; values: RowValues }> = [];

    const existingIds = new Set(ctx.existing.map((a) => a.id));

    for (const raw of sheet.rows) {
      const id = (raw.cells[sheet.idHeader as string] ?? '').trim();
      const values = this.validateRow(raw, sheet, ctx, errors);

      if (!id) {
        errors.push(this.err(raw.rowNumber, EXPORT_ONLY_COLUMN.id, 'ID bắt buộc khi import update'));
        continue;
      }
      if (!UUID_RE.test(id)) {
        errors.push(
          this.err(raw.rowNumber, EXPORT_ONLY_COLUMN.id, `ID '${id}' không đúng định dạng UUID`),
        );
        continue;
      }
      // Tenant guard: ID phải thuộc Organization hiện tại.
      if (!existingIds.has(id)) {
        errors.push(
          this.err(raw.rowNumber, EXPORT_ONLY_COLUMN.id, `Không tìm thấy Account ID '${id}'`),
        );
        continue;
      }
      if (!values) continue;
      parsed.push({ raw, id, values });
    }

    if (errors.length > 0) return this.result(sheet.rows.length, 0, 0, 0, errors);

    let updated = 0;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          for (const { id, values } of parsed) {
            await this.applyUpdate(tx, id, values, actorUserId);
            updated++;
          }
        },
        { maxWait: ACCOUNT_IMPORT_TX_MAX_WAIT_MS, timeout: ACCOUNT_IMPORT_TX_TIMEOUT_MS },
      );
    } catch (err) {
      return this.result(sheet.rows.length, 0, 0, 0, [
        this.err(0, null, `Lỗi khi cập nhật (đã rollback toàn bộ): ${this.msg(err)}`),
      ]);
    }

    return this.result(sheet.rows.length, 0, updated, 0, []);
  }

  // ---------- ghi dữ liệu ----------

  private async applyCreate(
    tx: Prisma.TransactionClient,
    organizationId: string,
    values: RowValues,
    actorUserId: string,
  ): Promise<void> {
    const d = values.data;
    const account = await tx.account.create({
      data: {
        organizationId,
        name: values.name,
        platformId: values.platformId,
        loginTool: d.loginTool ?? null,
        sellerUserId: d.sellerUserId ?? null,
        status: d.status ?? AccountStatus.NEW,
        issuedAt: d.issuedAt ?? null,
        activatedAt: d.activatedAt ?? null,
        diedBlankAt: d.diedBlankAt ?? null,
        diedAt: d.diedAt ?? null,
        moneyReturnedAt: d.moneyReturnedAt ?? null,
        dieReason: d.dieReason ?? null,
        holdAmount: d.holdAmount ?? 0,
        netAmount: d.netAmount ?? 0,
        paidAmount: d.paidAmount ?? 0,
        proxy: d.proxy ?? null,
        docsUrl: d.docsUrl ?? null,
        note: d.note ?? null,
        note2: d.note2 ?? null,
        createdBy: actorUserId,
      },
      select: { id: true },
    });
    await this.writeCredential(tx, account.id, values.cred, actorUserId);
  }

  /** Chỉ ghi field được cung cấp (ô trống = giữ nguyên giá trị hiện tại). */
  private async applyUpdate(
    tx: Prisma.TransactionClient,
    accountId: string,
    values: RowValues,
    actorUserId: string,
  ): Promise<void> {
    const d = values.data;
    const patch: Prisma.AccountUncheckedUpdateInput = {
      name: values.name,
      platformId: values.platformId,
      updatedBy: actorUserId,
    };
    const assign = <K extends keyof AccountWriteData>(key: K): void => {
      const value = d[key];
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    };
    (
      [
        'loginTool',
        'sellerUserId',
        'status',
        'issuedAt',
        'activatedAt',
        'diedBlankAt',
        'diedAt',
        'moneyReturnedAt',
        'dieReason',
        'holdAmount',
        'netAmount',
        'paidAmount',
        'proxy',
        'docsUrl',
        'note',
        'note2',
      ] as const
    ).forEach(assign);

    await tx.account.update({ where: { id: accountId }, data: patch });
    await this.writeCredential(tx, accountId, values.cred, actorUserId);
  }

  /** Upsert credential đã mã hoá. Chỉ ghi field có giá trị (tránh xoá nhầm khi ô trống). */
  private async writeCredential(
    tx: Prisma.TransactionClient,
    accountId: string,
    cred: CredInput,
    actorUserId: string,
  ): Promise<void> {
    const cipher: Record<string, string> = {};
    for (const [field, value] of Object.entries(cred)) {
      if (value) cipher[field] = this.encryption.encrypt(value);
    }
    if (Object.keys(cipher).length === 0) return;

    await tx.accountCredential.upsert({
      where: { accountId },
      create: { accountId, ...cipher, createdBy: actorUserId },
      update: { ...cipher, updatedBy: actorUserId },
    });
  }

  // ---------- đọc file ----------

  private async readSheetData(buffer: Buffer, requireId: boolean): Promise<SheetData> {
    const ws = this.pickDataSheet(await this.loadWorkbook(buffer));
    const { headers, rows, rowNumbers } = readSheet(ws);

    const actualByNormalized = new Map<string, string>();
    for (const h of headers) actualByNormalized.set(normalizeHeader(h), h);

    const headerByKey = new Map<AccountImportColumnKey, string>();
    const missing: string[] = [];
    for (const key of IMPORT_COLUMN_ORDER) {
      const column = IMPORT_COLUMNS[key];
      const found = [column.header, ...column.aliases]
        .map((candidate) => actualByNormalized.get(normalizeHeader(candidate)))
        .find((header): header is string => header !== undefined);
      if (found) headerByKey.set(key, found);
      else if (column.required) missing.push(column.header);
    }

    const idHeader = actualByNormalized.get(normalizeHeader(EXPORT_ONLY_COLUMN.id));
    if (requireId && !idHeader) missing.push(EXPORT_ONLY_COLUMN.id);

    if (missing.length > 0) {
      throw this.structural(
        `Thiếu cột bắt buộc: ${missing.join(', ')}. Header đọc được ở sheet "${ws.name}": ` +
          `${headers.map((h) => `"${h}"`).join(', ') || '(không có)'}`,
      );
    }
    if (rows.length > ACCOUNT_IMPORT_MAX_ROWS) {
      throw this.structural(
        `File có ${rows.length} dòng, vượt giới hạn ${ACCOUNT_IMPORT_MAX_ROWS} dòng mỗi lần import`,
      );
    }

    return {
      headerByKey,
      idHeader,
      sheetName: ws.name,
      rows: rows.map((cells, i) => ({ rowNumber: rowNumbers[i], cells })),
    };
  }

  private async loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
    try {
      return await bufferToWorkbook(buffer);
    } catch {
      throw this.structural('File Excel (.xlsx) không hợp lệ hoặc bị hỏng');
    }
  }

  /** Ưu tiên sheet `Accounts`; nếu không có thì sheet đầu tiên khác `Instructions`. */
  private pickDataSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
    const isNamed = (sheet: ExcelJS.Worksheet, name: string): boolean =>
      sheet.name.trim().toLowerCase() === name.toLowerCase();
    const ws =
      wb.worksheets.find((s) => isNamed(s, ACCOUNT_SHEET)) ??
      wb.worksheets.find((s) => !isNamed(s, INSTRUCTIONS_SHEET));
    if (!ws) throw this.structural('File không có sheet dữ liệu');
    return ws;
  }

  private cell(raw: RawRow, sheet: SheetData, key: AccountImportColumnKey): string {
    const header = sheet.headerByKey.get(key);
    return header ? (raw.cells[header] ?? '').trim() : '';
  }

  // ---------- validate ----------

  /** Trả `null` nếu dòng có lỗi. Ghi nhận TẤT CẢ lỗi của dòng. */
  private validateRow(
    raw: RawRow,
    sheet: SheetData,
    ctx: LookupContext,
    errors: ImportRowErrorDto[],
  ): RowValues | null {
    let ok = true;
    const fail = (field: string, message: string): void => {
      ok = false;
      errors.push(this.err(raw.rowNumber, field, message));
    };

    const name = this.cell(raw, sheet, 'name');
    if (!name) fail(IMPORT_COLUMNS.name.header, 'Account Name không được rỗng');
    else if (name.length > FIELD_MAX_LENGTH.name) {
      fail(IMPORT_COLUMNS.name.header, `Account Name vượt quá ${FIELD_MAX_LENGTH.name} ký tự`);
    }

    const platformRaw = this.cell(raw, sheet, 'platform');
    let platformId = '';
    if (!platformRaw) fail(IMPORT_COLUMNS.platform.header, 'Platform không được rỗng');
    else {
      const found = ctx.platformByKey.get(platformRaw.toLowerCase());
      if (found) platformId = found;
      else fail(IMPORT_COLUMNS.platform.header, `Platform '${platformRaw}' không tồn tại`);
    }

    const data: AccountWriteData = {};

    // Status
    const statusRaw = this.cell(raw, sheet, 'status');
    if (statusRaw) {
      const normalized = statusRaw.toUpperCase().replace(/\s+/g, '_');
      if (ACCOUNT_STATUS_CODES.includes(normalized)) data.status = normalized as AccountStatus;
      else
        fail(
          IMPORT_COLUMNS.status.header,
          `Status '${statusRaw}' không hợp lệ (${ACCOUNT_STATUS_CODES.join('/')})`,
        );
    }

    // Seller (email trong cùng Organization — chốt chặn multi-tenant)
    const sellerRaw = this.cell(raw, sheet, 'sellerEmail');
    if (sellerRaw) {
      const userId = ctx.sellerByEmail.get(sellerRaw.toLowerCase());
      if (userId) data.sellerUserId = userId;
      else
        fail(
          IMPORT_COLUMNS.sellerEmail.header,
          `Không tìm thấy User '${sellerRaw}' trong tổ chức này`,
        );
    }

    // Ngày
    for (const key of DATE_COLUMN_KEYS) {
      const value = this.cell(raw, sheet, key);
      if (!value) continue;
      const date = parseDateCell(value);
      if (date) (data as Record<string, unknown>)[key] = date;
      else
        fail(
          IMPORT_COLUMNS[key].header,
          `Ngày '${value}' không hợp lệ (định dạng đúng: ${IMPORT_DATE_FORMAT_HINT})`,
        );
    }

    // Tiền: >= 0, decimal hợp lệ
    for (const key of MONEY_COLUMN_KEYS) {
      const value = this.cell(raw, sheet, key);
      if (!value) continue;
      const header = IMPORT_COLUMNS[key].header;
      const num = parseDecimalCell(value, ACCOUNT_AMOUNT_DECIMALS);
      if (num === null) {
        fail(
          header,
          `${header} '${value}' không phải số hợp lệ (tối đa ${ACCOUNT_AMOUNT_DECIMALS} chữ số thập phân)`,
        );
      } else if (num < 0) {
        fail(header, `${header} must be >= 0`);
      } else if (num > ACCOUNT_AMOUNT_MAX) {
        fail(header, `${header} vượt giới hạn ${ACCOUNT_AMOUNT_MAX}`);
      } else {
        (data as Record<string, unknown>)[key] = num;
      }
    }

    // Text tự do (có giới hạn độ dài)
    const texts: Array<[AccountImportColumnKey, keyof typeof FIELD_MAX_LENGTH]> = [
      ['loginTool', 'loginTool'],
      ['dieReason', 'dieReason'],
      ['proxy', 'proxy'],
      ['docsUrl', 'docsUrl'],
      ['note', 'note'],
      ['note2', 'note2'],
    ];
    for (const [key, limitKey] of texts) {
      const value = this.cell(raw, sheet, key);
      if (!value) continue;
      const max = FIELD_MAX_LENGTH[limitKey];
      if (value.length > max) fail(IMPORT_COLUMNS[key].header, `Vượt quá ${max} ký tự`);
      else (data as Record<string, unknown>)[key] = value;
    }

    // Credentials (mã hoá khi ghi)
    const cred: CredInput = {};
    for (const [columnKey, field] of Object.entries(CREDENTIAL_COLUMN_MAP) as Array<
      [AccountImportColumnKey, (typeof CREDENTIAL_COLUMN_MAP)[keyof typeof CREDENTIAL_COLUMN_MAP]]
    >) {
      const value = this.cell(raw, sheet, columnKey);
      if (value) cred[field] = value;
    }

    if (!ok) return null;
    return { name, platformId, data, cred };
  }

  // ---------- lookups ----------

  private async loadLookups(organizationId: string): Promise<LookupContext> {
    const [platforms, sellers, existing] = await Promise.all([
      this.loadPlatforms(),
      this.prisma.user.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true, email: true },
      }),
      this.prisma.account.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true, name: true, platformId: true },
      }),
    ]);

    const platformByKey = new Map<string, string>();
    for (const p of platforms) {
      platformByKey.set(p.code.toLowerCase(), p.id);
      platformByKey.set(p.name.toLowerCase(), p.id);
    }

    return {
      platformByKey,
      sellerByEmail: new Map(sellers.map((u) => [u.email.toLowerCase(), u.id])),
      existing,
    };
  }

  private loadPlatforms(): Promise<Array<{ id: string; code: string; name: string }>> {
    return this.prisma.platform.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  // ---------- helpers ----------

  /** Khoá đối chiếu Account: tên (không phân biệt hoa/thường) + platform. */
  private accountKey(name: string, platformId: string): string {
    return `${name.trim().toLowerCase()}||${platformId}`;
  }

  private err(row: number, field: string | null, message: string): ImportRowErrorDto {
    return { sheet: ACCOUNT_SHEET, row, field, message };
  }

  private result(
    total: number,
    created: number,
    updated: number,
    skipped: number,
    errors: ImportRowErrorDto[],
  ): ImportResultDto {
    return { total, created, updated, skipped, failed: errors.length, errors };
  }

  private structural(message: string): BadRequestException {
    return new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message });
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Dữ liệu tra cứu dùng chung cho một lần import. */
interface LookupContext {
  platformByKey: Map<string, string>;
  sellerByEmail: Map<string, string>;
  existing: ExistingAccount[];
}
