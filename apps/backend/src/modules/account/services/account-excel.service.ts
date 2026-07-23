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
  missingHeaders,
  readSheet,
  workbookToBuffer,
} from '../../../common/excel/excel.util';

/** Tên cột (giữ đúng theo yêu cầu). */
const H = {
  id: 'ID',
  name: 'Account Name',
  platform: 'Platform',
  username: 'Username',
  password: 'Password',
  email: 'Email',
  proxy: 'Proxy',
  note: 'Note',
  status: 'Status',
  createdAt: 'Created At',
  updatedAt: 'Updated At',
} as const;

const IMPORT_HEADERS = [H.name, H.platform, H.username, H.password, H.email, H.proxy, H.note, H.status];
const EXPORT_HEADERS = [H.id, ...IMPORT_HEADERS, H.createdAt, H.updatedAt];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mapping cột Excel → AccountCredential (mã hoá at-rest).
 * Username → gmail (login) · Password → platformPassword · Email → recoveryMail.
 */
const CRED_MAP = {
  [H.username]: 'gmail',
  [H.password]: 'platformPassword',
  [H.email]: 'recoveryMail',
} as const;

interface CredInput {
  gmail?: string;
  platformPassword?: string;
  recoveryMail?: string;
}

/**
 * AccountExcelService — Import/Export Excel cho Account (chỉ Admin).
 * Toàn bộ import chạy trong transaction; lỗi bất kỳ dòng nào → rollback + trả danh sách lỗi.
 */
@Injectable()
export class AccountExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  // ---------- Export ----------

  /** File mẫu (có 1 dòng dữ liệu, không ID). */
  async buildExample(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    addSheet(
      wb,
      'Accounts',
      IMPORT_HEADERS.map((h) => ({ header: h, key: h })),
      [
        {
          [H.name]: 'TTS Sample 01',
          [H.platform]: 'TIKTOK_SHOP',
          [H.username]: 'seller_login',
          [H.password]: 'P@ssw0rd1',
          [H.email]: 'recovery@example.com',
          [H.proxy]: '1.2.3.4:8080',
          [H.note]: 'Tài khoản mẫu',
          [H.status]: 'NEW',
        },
      ],
    );
    return workbookToBuffer(wb);
  }

  /** Export toàn bộ Account (kèm ID + credentials đã giải mã — chỉ Admin). */
  async exportAll(organizationId: string): Promise<Buffer> {
    const accounts = await this.prisma.account.findMany({
      where: { organizationId, deletedAt: null },
      include: { platform: true, credential: true },
      orderBy: { createdAt: 'asc' },
    });

    const rows = accounts.map((a) => ({
      [H.id]: a.id,
      [H.name]: a.name,
      [H.platform]: a.platform?.code ?? '',
      [H.username]: this.encryption.decryptOptional(a.credential?.gmail) ?? '',
      [H.password]: this.encryption.decryptOptional(a.credential?.platformPassword) ?? '',
      [H.email]: this.encryption.decryptOptional(a.credential?.recoveryMail) ?? '',
      [H.proxy]: a.proxy ?? '',
      [H.note]: a.note ?? '',
      [H.status]: a.status,
      [H.createdAt]: a.createdAt.toISOString(),
      [H.updatedAt]: a.updatedAt.toISOString(),
    }));

    const wb = new ExcelJS.Workbook();
    addSheet(
      wb,
      'Accounts',
      EXPORT_HEADERS.map((h) => ({ header: h, key: h })),
      rows,
    );
    return workbookToBuffer(wb);
  }

  // ---------- Import (create-only) ----------

  async importCreate(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
  ): Promise<ImportResultDto> {
    const ws = await this.firstSheet(buffer);
    const { headers, rows, rowNumbers } = readSheet(ws);
    const miss = missingHeaders(headers, IMPORT_HEADERS);
    if (miss.length) this.structural(`Thiếu cột bắt buộc: ${miss.join(', ')}`);

    const platformMap = await this.loadPlatformMap();
    const errors: ImportRowErrorDto[] = [];
    const items: Array<{ key: string; name: string; platformId: string; status: AccountStatus; proxy: string; note: string; cred: CredInput }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = rowNumbers[i];
      const name = (r[H.name] ?? '').trim();
      if (!name) {
        errors.push(this.err(rowNum, H.name, 'Account Name không được rỗng'));
        continue;
      }
      const platRaw = (r[H.platform] ?? '').trim();
      if (!platRaw) {
        errors.push(this.err(rowNum, H.platform, 'Platform không được rỗng'));
        continue;
      }
      const platformId = platformMap.get(platRaw.toLowerCase());
      if (!platformId) {
        errors.push(this.err(rowNum, H.platform, `Platform '${platRaw}' không tồn tại`));
        continue;
      }
      const status = this.parseStatus(r[H.status]);
      if (status === null) {
        errors.push(this.err(rowNum, H.status, `Status '${r[H.status]}' không hợp lệ (NEW/LIVE/DIE_TRANG/DIE/RETURNED)`));
        continue;
      }
      items.push({
        key: `${name.toLowerCase()}||${platformId}`,
        name,
        platformId,
        status,
        proxy: (r[H.proxy] ?? '').trim(),
        note: (r[H.note] ?? '').trim(),
        cred: this.readCred(r),
      });
    }

    if (errors.length) {
      return this.result(rows.length, 0, 0, 0, errors);
    }

    // Skip nếu (name+platform) đã tồn tại trong DB hoặc trùng trong file.
    const existing = await this.prisma.account.findMany({
      where: { organizationId, deletedAt: null },
      select: { name: true, platformId: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.name.toLowerCase()}||${e.platformId ?? ''}`));

    let created = 0;
    let skipped = 0;
    const seen = new Set<string>();

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const it of items) {
          if (existingKeys.has(it.key) || seen.has(it.key)) {
            skipped++;
            continue;
          }
          seen.add(it.key);
          const account = await tx.account.create({
            data: {
              organizationId,
              name: it.name,
              platformId: it.platformId,
              status: it.status,
              proxy: it.proxy || null,
              note: it.note || null,
              createdBy: actorUserId,
            },
            select: { id: true },
          });
          const cipher = this.encryptCred(it.cred);
          if (Object.keys(cipher).length) {
            await tx.accountCredential.create({
              data: { accountId: account.id, ...cipher, createdBy: actorUserId },
            });
          }
          created++;
        }
      });
    } catch (err) {
      return this.result(rows.length, 0, 0, 0, [
        this.err(0, null, `Lỗi khi ghi dữ liệu (đã rollback toàn bộ): ${this.msg(err)}`),
      ]);
    }

    return this.result(rows.length, created, 0, skipped, []);
  }

  // ---------- Import Update (by ID) ----------

  async importUpdate(
    organizationId: string,
    actorUserId: string,
    buffer: Buffer,
  ): Promise<ImportResultDto> {
    const ws = await this.firstSheet(buffer);
    const { headers, rows, rowNumbers } = readSheet(ws);
    const miss = missingHeaders(headers, [H.id, ...IMPORT_HEADERS]);
    if (miss.length) this.structural(`Thiếu cột bắt buộc: ${miss.join(', ')}`);

    const platformMap = await this.loadPlatformMap();
    const errors: ImportRowErrorDto[] = [];
    const items: Array<{ id: string; name: string; platformId: string | null; status: AccountStatus | undefined; proxy: string; note: string; cred: CredInput }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = rowNumbers[i];
      const id = (r[H.id] ?? '').trim();
      if (!id) {
        errors.push(this.err(rowNum, H.id, 'ID bắt buộc khi import update'));
        continue;
      }
      if (!UUID_RE.test(id)) {
        errors.push(this.err(rowNum, H.id, `ID '${id}' không đúng định dạng UUID`));
        continue;
      }
      const name = (r[H.name] ?? '').trim();
      if (!name) {
        errors.push(this.err(rowNum, H.name, 'Account Name không được rỗng'));
        continue;
      }
      const platRaw = (r[H.platform] ?? '').trim();
      let platformId: string | null = null;
      if (platRaw) {
        platformId = platformMap.get(platRaw.toLowerCase()) ?? null;
        if (!platformId) {
          errors.push(this.err(rowNum, H.platform, `Platform '${platRaw}' không tồn tại`));
          continue;
        }
      }
      const status = this.parseStatus(r[H.status] ?? '');
      if (status === null) {
        errors.push(this.err(rowNum, H.status, `Status '${r[H.status]}' không hợp lệ`));
        continue;
      }
      items.push({
        id,
        name,
        platformId,
        status: status ?? undefined,
        proxy: (r[H.proxy] ?? '').trim(),
        note: (r[H.note] ?? '').trim(),
        cred: this.readCred(r),
      });
    }

    if (errors.length) return this.result(rows.length, 0, 0, 0, errors);

    // Tất cả ID phải tồn tại trong Org (không tạo mới).
    const ids = items.map((i) => i.id);
    const found = await this.prisma.account.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      select: { id: true },
    });
    const foundSet = new Set(found.map((f) => f.id));
    for (let i = 0; i < items.length; i++) {
      if (!foundSet.has(items[i].id)) {
        errors.push(this.err(rowNumbers[i], H.id, `Không tìm thấy Account ID '${items[i].id}'`));
      }
    }
    if (errors.length) return this.result(rows.length, 0, 0, 0, errors);

    let updated = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const it of items) {
          const data: Prisma.AccountUpdateInput = { name: it.name, updatedBy: actorUserId };
          if (it.platformId) data.platform = { connect: { id: it.platformId } };
          if (it.status !== undefined) data.status = it.status;
          data.proxy = it.proxy || null;
          data.note = it.note || null;
          await tx.account.update({ where: { id: it.id }, data });

          // Credentials: chỉ cập nhật field có giá trị (tránh xoá nhầm khi cell rỗng).
          const cipher = this.encryptCred(it.cred);
          if (Object.keys(cipher).length) {
            await tx.accountCredential.upsert({
              where: { accountId: it.id },
              create: { accountId: it.id, ...cipher, createdBy: actorUserId },
              update: { ...cipher, updatedBy: actorUserId },
            });
          }
          updated++;
        }
      });
    } catch (err) {
      return this.result(rows.length, 0, 0, 0, [
        this.err(0, null, `Lỗi khi cập nhật (đã rollback toàn bộ): ${this.msg(err)}`),
      ]);
    }

    return this.result(rows.length, 0, updated, 0, []);
  }

  // ---------- helpers ----------

  private async firstSheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
    let wb: ExcelJS.Workbook;
    try {
      wb = await bufferToWorkbook(buffer);
    } catch {
      this.structural('File Excel (.xlsx) không hợp lệ hoặc bị hỏng');
    }
    const ws = wb!.worksheets[0];
    if (!ws) this.structural('File không có sheet dữ liệu');
    return ws;
  }

  private async loadPlatformMap(): Promise<Map<string, string>> {
    const platforms = await this.prisma.platform.findMany({ select: { id: true, code: true, name: true } });
    const map = new Map<string, string>();
    for (const p of platforms) {
      map.set(p.code.toLowerCase(), p.id);
      map.set(p.name.toLowerCase(), p.id);
    }
    return map;
  }

  private readCred(r: Record<string, string>): CredInput {
    const cred: CredInput = {};
    for (const [col, field] of Object.entries(CRED_MAP)) {
      const v = (r[col] ?? '').trim();
      if (v) cred[field] = v;
    }
    return cred;
  }

  private encryptCred(cred: CredInput): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [field, value] of Object.entries(cred) as Array<[string, string | undefined]>) {
      if (value) out[field] = this.encryption.encrypt(value);
    }
    return out;
  }

  private parseStatus(raw: string | undefined): AccountStatus | null {
    const v = (raw ?? '').trim();
    if (!v) return AccountStatus.NEW;
    const norm = v.toUpperCase().replace(/\s+/g, '_');
    return (Object.values(AccountStatus) as string[]).includes(norm) ? (norm as AccountStatus) : null;
  }

  private err(row: number, field: string | null, message: string): ImportRowErrorDto {
    return { sheet: 'Accounts', row, field, message };
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

  private structural(message: string): never {
    throw new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message });
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
