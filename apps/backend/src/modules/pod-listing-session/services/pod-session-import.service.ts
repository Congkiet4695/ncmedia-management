import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PodListingSessionStatus } from '@prisma/client';
import { Workbook, type Row, type Worksheet } from 'exceljs';
import { Readable } from 'node:stream';
import { bufferToWorkbook, workbookToBuffer } from '../../../common/excel/excel.util';
import { PrismaService } from '../../../database/prisma.service';
import {
  POD_SESSION_IMPORT_COLUMNS,
  POD_SESSION_IMPORT_MAX_IMAGES,
  POD_SESSION_IMPORT_MAX_ROWS,
  POD_SESSION_MAX_PRODUCTS,
  POD_SESSION_TITLE_COLUMN,
} from '../constants/pod-listing-session.constants';
import { PodSessionImportMode, type ImportSessionProductsDto } from '../dto/pod-listing-session.dto';
import { PodListingSessionService } from './pod-listing-session.service';

/** Một dòng lỗi trong file — người dùng sửa đúng dòng đó rồi nhập lại. */
export interface ImportRowError {
  row: number;
  message: string;
}

/** Kết quả một lần import vào session. */
export interface SessionImportResult {
  sessionId: string;
  fileName: string;
  mode: PodSessionImportMode;
  totalRows: number;
  createdProducts: number;
  createdImages: number;
  replacedProducts: number;
  skippedRows: number;
  errors: ImportRowError[];
  productIds: string[];
}

/** Một dòng đã đọc xong: tên sản phẩm + danh sách ảnh gốc. */
interface ProductRow {
  title: string;
  urls: string[];
  row: number;
}

/**
 * PodSessionImportService — đọc Excel/CSV thành **Draft Product bên trong một session**.
 *
 * 🔴 File chỉ có ĐÚNG 11 CỘT: `title` + `URL1..URL10`. Mỗi dòng là MỘT sản phẩm, và hệ thống
 * **không đọc thêm bất kỳ cột nào khác**. Mô tả, biến thể, giá, tồn, danh mục, thuộc tính,
 * kiện hàng đều được dựng từ bộ template của session lúc Start Listing — file chỉ mang đúng
 * thứ mà template không thể biết: tên sản phẩm và ảnh của nó.
 *
 * 🔴 KHÔNG gọi sàn. Import chỉ đọc file, kiểm tra và ghi database — người dùng còn phải xem
 * lại và sửa trước khi có bất cứ thứ gì rời khỏi hệ thống.
 */
@Injectable()
export class PodSessionImportService {
  private readonly logger = new Logger(PodSessionImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: PodListingSessionService,
  ) {}

  async import(
    organizationId: string,
    userId: string,
    sessionId: string,
    file: Express.Multer.File,
    dto: ImportSessionProductsDto,
  ): Promise<SessionImportResult> {
    const session = await this.sessions.get(organizationId, sessionId);
    if (session.status === PodListingSessionStatus.LISTING) {
      throw new BadRequestException({
        code: 'POD_SESSION_IN_PROGRESS',
        message: 'Lượt đăng đang chạy — chờ chạy xong rồi import.',
      });
    }

    const mode = dto.mode ?? PodSessionImportMode.APPEND;
    const sheet = await this.readSheet(file);
    const headers = this.mapHeaders(sheet);

    if (!headers.has(POD_SESSION_TITLE_COLUMN)) {
      throw new BadRequestException({
        code: 'POD_SESSION_IMPORT_MISSING_COLUMN',
        message:
          `File thiếu cột bắt buộc "${POD_SESSION_TITLE_COLUMN}". ` +
          `Đúng định dạng là ${POD_SESSION_IMPORT_COLUMNS.join(' · ')} — ` +
          'tải file mẫu ở nút "File mẫu".',
      });
    }

    const { rows, errors, totalRows, skippedRows } = this.collect(sheet, headers);
    if (rows.length === 0) {
      throw new BadRequestException({
        code: 'POD_SESSION_IMPORT_EMPTY',
        message:
          errors.length > 0
            ? `Không dòng nào hợp lệ. Lỗi đầu tiên: dòng ${errors[0].row} — ${errors[0].message}`
            : 'File không có dòng dữ liệu nào.',
      });
    }

    // Thứ tự sản phẩm cộng dồn qua các lần import bổ sung: dòng nạp sau đứng sau.
    const existing =
      mode === PodSessionImportMode.REPLACE
        ? 0
        : await this.prisma.podListingSessionProduct.count({
            where: { sessionId, deletedAt: null },
          });
    if (existing + rows.length > POD_SESSION_MAX_PRODUCTS) {
      throw new BadRequestException({
        code: 'POD_SESSION_IMPORT_TOO_MANY',
        message: `Lượt đăng sẽ có ${existing + rows.length} sản phẩm, vượt trần ${POD_SESSION_MAX_PRODUCTS}.`,
      });
    }

    // 🔴 Re-import: xoá sạch rồi nạp lại. Xoá MỀM — bản ghi của thứ đã nằm trên sàn là dấu
    // vết cần giữ, không phải rác cần dọn.
    let replacedProducts = 0;
    if (mode === PodSessionImportMode.REPLACE) {
      const removed = await this.prisma.podListingSessionProduct.updateMany({
        where: { sessionId, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: userId },
      });
      replacedProducts = removed.count;
    }

    const result: SessionImportResult = {
      sessionId,
      fileName: file.originalname,
      mode,
      totalRows,
      createdProducts: 0,
      createdImages: 0,
      replacedProducts,
      skippedRows,
      errors,
      productIds: [],
    };

    for (const [index, item] of rows.entries()) {
      const product = await this.prisma.podListingSessionProduct.create({
        data: {
          organizationId,
          sessionId,
          title: item.title.slice(0, 1024),
          sourceRow: item.row,
          importOrder: existing + index,
          // Giữ NGUYÊN TRẠNG dòng gốc: khi nghi hệ thống đọc sai cột, mở cái này ra là biết.
          rawData: { title: item.title, urls: item.urls },
          createdBy: userId,
          images: {
            create: item.urls.map((imageUrl, order) => ({
              organizationId,
              imageUrl: imageUrl.slice(0, 2048),
              sortOrder: order,
            })),
          },
        },
        select: { id: true, _count: { select: { images: true } } },
      });

      result.productIds.push(product.id);
      result.createdProducts += 1;
      result.createdImages += product._count.images;
    }

    await this.prisma.podListingSession.update({
      where: { id: sessionId },
      data: {
        sourceFile: file.originalname.slice(0, 512),
        importedAt: new Date(),
        // Có dữ liệu mới ⇒ phải kiểm lại trước khi chạy.
        status: PodListingSessionStatus.DRAFT,
        updatedBy: userId,
      },
    });

    this.logger.log({
      module: 'pod-listing-session',
      operation: 'session.import',
      organizationId,
      sessionId,
      file: file.originalname,
      mode,
      rows: totalRows,
      products: result.createdProducts,
      images: result.createdImages,
      errors: errors.length,
      msg: 'Đã import Draft Product vào Listing Session',
    });

    return result;
  }

  /** File mẫu (.xlsx) — ĐÚNG 11 cột, không thêm cột nào khác. */
  async buildTemplateFile(): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Products');

    sheet.addRow(POD_SESSION_IMPORT_COLUMNS);
    sheet.getRow(1).font = { bold: true };

    // Hai ví dụ: một sản phẩm nhiều ảnh, một sản phẩm chỉ có URL1 — cả hai đều hợp lệ.
    sheet.addRow([
      'Vintage Sunset Poster',
      'https://cdn.example/poster-front.jpg',
      'https://cdn.example/poster-back.jpg',
      'https://cdn.example/poster-detail.jpg',
    ]);
    sheet.addRow(['Retro Wave Tee', 'https://cdn.example/tee-front.jpg']);

    sheet.columns.forEach((column) => {
      column.width = 34;
    });

    return workbookToBuffer(workbook);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** `.xlsx` đọc bằng workbook, `.csv` đọc qua stream — ExcelJS xử lý cả hai. */
  private async readSheet(file: Express.Multer.File): Promise<Worksheet> {
    const isCsv = file.originalname.toLowerCase().endsWith('.csv');

    let workbook: Workbook;
    try {
      if (isCsv) {
        workbook = new Workbook();
        await workbook.csv.read(Readable.from(file.buffer));
      } else {
        workbook = await bufferToWorkbook(file.buffer);
      }
    } catch {
      throw new BadRequestException({
        code: 'POD_SESSION_IMPORT_UNREADABLE',
        message: 'Không đọc được file. Hãy dùng đúng định dạng .xlsx hoặc .csv.',
      });
    }

    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) {
      throw new BadRequestException({
        code: 'POD_SESSION_IMPORT_EMPTY',
        message: 'File không có dòng dữ liệu nào (chỉ có dòng tiêu đề).',
      });
    }
    if (sheet.rowCount - 1 > POD_SESSION_IMPORT_MAX_ROWS) {
      throw new BadRequestException({
        code: 'POD_SESSION_IMPORT_TOO_MANY_ROWS',
        message: `File có ${sheet.rowCount - 1} dòng, vượt trần ${POD_SESSION_IMPORT_MAX_ROWS}.`,
      });
    }
    return sheet;
  }

  /**
   * Dòng 1 → bản đồ `tên cột đã chuẩn hoá → chỉ số cột`.
   *
   * 🔴 Chỉ nhận đúng 11 tên trong `POD_SESSION_IMPORT_COLUMNS`; mọi cột lạ bị BỎ QUA chứ
   * không phải đọc rồi vứt — hệ thống không hiểu chúng và cũng không được đoán.
   */
  private mapHeaders(sheet: Worksheet): Map<string, number> {
    const known = new Set(POD_SESSION_IMPORT_COLUMNS.map((name) => this.normalize(name)));
    const map = new Map<string, number>();

    sheet.getRow(1).eachCell((cell, index) => {
      const name = this.normalize(this.cellText(cell.value) ?? '');
      if (known.has(name) && !map.has(name)) map.set(name, index);
    });
    return map;
  }

  /** Đọc mọi dòng dữ liệu: mỗi dòng là một sản phẩm. */
  private collect(
    sheet: Worksheet,
    headers: Map<string, number>,
  ): { rows: ProductRow[]; errors: ImportRowError[]; totalRows: number; skippedRows: number } {
    const rows: ProductRow[] = [];
    const errors: ImportRowError[] = [];
    let totalRows = 0;
    let skippedRows = 0;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const title = this.valueOf(row, headers, POD_SESSION_TITLE_COLUMN)?.trim();
      const urls = this.readUrls(row, headers);

      if (!title && urls.length === 0) return; // dòng trống hoàn toàn
      totalRows += 1;

      if (!title) {
        skippedRows += 1;
        errors.push({ row: rowNumber, message: 'Thiếu title — không biết đây là sản phẩm nào.' });
        return;
      }

      rows.push({ title, urls, row: rowNumber });
    });

    return { rows, errors, totalRows, skippedRows };
  }

  /**
   * `URL1..URL10` → danh sách ảnh gốc.
   *
   * Ô trống bị bỏ qua, thứ tự cột được giữ nguyên (URL1 là ảnh đại diện), và URL trùng nhau
   * chỉ giữ một lần — cùng một tấm ảnh gửi lên sàn hai lần là hai lần upload vô ích.
   */
  private readUrls(row: Row, headers: Map<string, number>): string[] {
    const urls: string[] = [];
    for (let index = 1; index <= POD_SESSION_IMPORT_MAX_IMAGES; index += 1) {
      const raw = this.valueOf(row, headers, `URL${index}`)?.trim();
      if (!raw || !/^https?:\/\//i.test(raw)) continue;
      if (!urls.includes(raw)) urls.push(raw);
    }
    return urls;
  }

  private valueOf(row: Row, headers: Map<string, number>, column: string): string | null {
    const index = headers.get(this.normalize(column));
    return index ? this.cellText(row.getCell(index).value) : null;
  }

  /** Ô Excel có thể là số, ngày, công thức, rich text hoặc hyperlink — quy về chuỗi đã trim. */
  private cellText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();

    const rich = value as {
      text?: unknown;
      hyperlink?: unknown;
      result?: unknown;
      richText?: Array<{ text?: string }>;
    };
    // Ô dán URL vào Excel thường thành hyperlink: `text` là nhãn hiển thị, `hyperlink` mới
    // là địa chỉ thật. Lấy `hyperlink` trước, nếu không sẽ nhập vào một cái nhãn.
    if (typeof rich.hyperlink === 'string') return rich.hyperlink.trim() || null;
    if (typeof rich.text === 'string') return rich.text.trim() || null;
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((part) => part.text ?? '').join('').trim() || null;
    }
    // `result` của ô công thức: chỉ nhận primitive; object ở đây là lỗi công thức, không
    // phải dữ liệu — String(...) sẽ cho ra "[object Object]" và làm bẩn cả cột.
    const result: unknown = rich.result;
    if (typeof result === 'string') return result.trim() || null;
    if (typeof result === 'number' || typeof result === 'boolean') return String(result);
    return null;
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '');
  }
}
