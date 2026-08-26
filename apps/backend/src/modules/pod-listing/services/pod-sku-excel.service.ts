import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PodPriceAdjustmentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  addSheet,
  bufferToWorkbook,
  normalizeHeader,
  parseDecimalCell,
  readSheet,
  workbookToBuffer,
} from '../../../common/excel/excel.util';
import { ImportResultDto, ImportRowErrorDto } from '../../../common/excel/import-result.dto';
import { POD_SKU_IMPORT_MAX_ROWS } from '../constants/pod-listing.constants';
import { PodTemplateNotFoundException } from './pod-template.service';

const DATA_SHEET = 'SKUs';
const INSTRUCTIONS_SHEET = 'Instructions';

/** Cột của file SKU. `Variant` là khoá đối chiếu — sửa cột này là mất dòng. */
const COLUMNS = {
  variant: { header: 'Variant', required: true, width: 28 },
  skuCode: { header: 'SKU Code', required: false, width: 20 },
  barcode: { header: 'Barcode', required: false, width: 18 },
  adjustType: { header: 'Price Adjust Type', required: false, width: 18 },
  adjustValue: { header: 'Price Adjust Value', required: false, width: 18 },
  retailPrice: { header: 'Retail Price', required: false, width: 14 },
  salePrice: { header: 'Sale Price', required: false, width: 14 },
  quantity: { header: 'Quantity', required: false, width: 12 },
  discount: { header: 'Discount (%)', required: false, width: 14 },
  enabled: { header: 'Enabled', required: false, width: 12 },
} as const;

/** Giá trị hợp lệ của cột điều chỉnh giá. */
const ADJUST_TYPES = Object.values(PodPriceAdjustmentType) as string[];

type ColumnKey = keyof typeof COLUMNS;
const COLUMN_ORDER = Object.keys(COLUMNS) as ColumnKey[];

const MONEY_FORMAT = '#,##0.00';
const MONEY_DECIMALS = 2;
const DISCOUNT_DECIMALS = 2;
const TRUE_WORDS = new Set(['true', '1', 'yes', 'y', 'x', 'enabled', 'on', 'có']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'n', 'disabled', 'off', 'không']);

/** Giá trị một dòng đã kiểm tra xong. `undefined` = ô trống → giữ nguyên giá trị hiện tại. */
interface RowValues {
  skuCode?: string;
  barcode?: string;
  priceAdjustmentType?: PodPriceAdjustmentType;
  priceAdjustmentValue?: Prisma.Decimal;
  retailPrice?: Prisma.Decimal | null;
  salePrice?: Prisma.Decimal | null;
  quantity?: number;
  discount?: Prisma.Decimal | null;
  isActive?: boolean;
}

/**
 * PodSkuExcelService — Import / Export bảng SKU của MỘT SKU Template.
 *
 * Vì sao riêng phần này dùng Excel trong khi các template khác dùng JSON: bảng SKU là dữ
 * liệu **dạng lưới** — vài trăm dòng giá / tồn / barcode. Đó đúng là việc của Excel, và
 * cũng là cách người vận hành đang làm sẵn.
 *
 * Ba ràng buộc:
 *
 * 1. **Không tạo và không xoá SKU.** Tổ hợp do trục biến thể sinh ra; file chỉ CẬP NHẬT
 *    các dòng đã có. Dòng lạ trong file là lỗi, không phải lý do để đẻ thêm SKU rời khỏi
 *    bộ trục.
 * 2. **All-or-nothing.** Kiểm tra toàn bộ file trước; chỉ cần một dòng sai là không dòng
 *    nào được ghi. Nhập một nửa bảng giá còn tệ hơn không nhập.
 * 3. **Ô trống = giữ nguyên.** Xoá trắng một cột trong Excel rồi import không được phép
 *    xoá sạch giá đang chạy.
 */
@Injectable()
export class PodSkuExcelService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  async export(
    organizationId: string,
    skuTemplateId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const template = await this.loadTemplate(organizationId, skuTemplateId);

    const rows = template.items.map((item) => ({
      [COLUMNS.variant.header]: item.variantName,
      [COLUMNS.skuCode.header]: item.skuCode ?? '',
      [COLUMNS.barcode.header]: item.barcode ?? '',
      [COLUMNS.adjustType.header]: item.priceAdjustmentType,
      [COLUMNS.adjustValue.header]: Number(item.priceAdjustmentValue),
      [COLUMNS.retailPrice.header]: item.retailPrice === null ? '' : Number(item.retailPrice),
      [COLUMNS.salePrice.header]: item.salePrice === null ? '' : Number(item.salePrice),
      [COLUMNS.quantity.header]: item.quantity,
      [COLUMNS.discount.header]: item.discount === null ? '' : Number(item.discount),
      [COLUMNS.enabled.header]: item.isActive ? 'TRUE' : 'FALSE',
    }));

    const workbook = new ExcelJS.Workbook();
    const sheet = addSheet(
      workbook,
      DATA_SHEET,
      COLUMN_ORDER.map((key) => ({
        header: COLUMNS[key].header,
        key: COLUMNS[key].header,
        width: COLUMNS[key].width,
      })),
      rows,
    );
    for (const key of ['retailPrice', 'salePrice'] as const) {
      const column = sheet.getColumn(COLUMNS[key].header);
      column.numFmt = MONEY_FORMAT;
      column.alignment = { horizontal: 'right' };
    }

    addSheet(
      workbook,
      INSTRUCTIONS_SHEET,
      [
        { header: 'Mục', key: 'item', width: 26 },
        { header: 'Nội dung', key: 'detail', width: 100 },
      ],
      this.instructionRows(template.name),
    );

    return {
      buffer: await workbookToBuffer(workbook),
      filename: `sku-template-${this.slug(template.name)}.xlsx`,
    };
  }

  private instructionRows(templateName: string): Array<Record<string, string>> {
    const row = (item: string, detail: string): Record<string, string> => ({ item, detail });
    return [
      row('Template', templateName),
      row('Sheet dữ liệu', `Chỉ sửa sheet "${DATA_SHEET}". Sheet này chỉ để tham khảo.`),
      row(
        'Không sửa Header',
        'Giữ nguyên dòng 1 (tên cột). Đổi hoặc xoá tên cột sẽ khiến import thất bại.',
      ),
      row(
        `Cột ${COLUMNS.variant.header}`,
        'Khoá đối chiếu, KHÔNG được sửa. Muốn thêm/bớt SKU thì sửa trục biến thể trong màn hình SKU Template — file này chỉ cập nhật dòng đã có.',
      ),
      row('Ô trống', 'Giữ nguyên giá trị đang có. Muốn xoá giá thì ghi 0.'),
      row(
        'Điều chỉnh giá (khuyến nghị)',
        `${COLUMNS.adjustType.header} = ${ADJUST_TYPES.join(' / ')}; ${COLUMNS.adjustValue.header} là số tiền hoặc phần trăm (cho phép ÂM). Đây là QUY TẮC cộng lên giá do Pricing Template tính, nên dùng chung được cho mọi sản phẩm.`,
      ),
      row(
        'Cột tiền (tuỳ chọn)',
        `${COLUMNS.retailPrice.header} = giá gốc (gạch ngang) · ${COLUMNS.salePrice.header} = giá bán. Số >= 0, tối đa ${MONEY_DECIMALS} chữ số thập phân. Điền vào đây là ĐẶT CỨNG giá, bỏ qua Pricing Template — chỉ nên dùng khi cả bộ SKU đồng giá.`,
      ),
      row(COLUMNS.quantity.header, 'Số nguyên >= 0.'),
      row(
        COLUMNS.discount.header,
        `Phần trăm từ 0 đến 100, tối đa ${DISCOUNT_DECIMALS} chữ số thập phân.`,
      ),
      row(COLUMNS.enabled.header, 'TRUE / FALSE (chấp nhận 1/0, YES/NO). Bỏ trống = giữ nguyên.'),
      row(
        'Xử lý lỗi',
        'Hệ thống kiểm tra toàn bộ file trước khi ghi. Chỉ cần 1 dòng lỗi thì KHÔNG dòng nào được ghi (rollback toàn bộ).',
      ),
      row(
        'Giới hạn',
        `Tối đa ${POD_SKU_IMPORT_MAX_ROWS} dòng mỗi lần import. Chỉ nhận file .xlsx.`,
      ),
    ];
  }

  // ==========================================================================
  // IMPORT
  // ==========================================================================

  async import(
    organizationId: string,
    skuTemplateId: string,
    buffer: Buffer,
  ): Promise<ImportResultDto> {
    const template = await this.loadTemplate(organizationId, skuTemplateId);
    const sheet = await this.readSheetData(buffer);

    const itemIdByVariant = new Map(template.items.map((item) => [item.variantName, item.id]));
    const errors: ImportRowErrorDto[] = [];
    const parsed: Array<{ id: string; values: RowValues }> = [];
    const seen = new Map<string, number>();

    for (const raw of sheet.rows) {
      const variant = this.cell(raw, sheet, 'variant');
      if (!variant) {
        errors.push(this.err(raw.rowNumber, COLUMNS.variant.header, 'Variant không được rỗng'));
        continue;
      }

      const first = seen.get(variant);
      if (first !== undefined) {
        errors.push(
          this.err(
            raw.rowNumber,
            COLUMNS.variant.header,
            `Variant "${variant}" bị trùng trong file (đã có ở dòng ${first})`,
          ),
        );
        continue;
      }
      seen.set(variant, raw.rowNumber);

      const itemId = itemIdByVariant.get(variant);
      if (!itemId) {
        errors.push(
          this.err(
            raw.rowNumber,
            COLUMNS.variant.header,
            `Template không có SKU "${variant}". File chỉ cập nhật SKU đã có — muốn thêm thì sửa trục biến thể.`,
          ),
        );
        continue;
      }

      const values = this.validateRow(raw, sheet, errors);
      if (values) parsed.push({ id: itemId, values });
    }

    if (errors.length > 0) {
      return {
        total: sheet.rows.length,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: errors.length,
        errors,
      };
    }

    const updates = parsed.filter(({ values }) => Object.keys(values).length > 0);
    if (updates.length > 0) {
      await this.prisma.$transaction(
        updates.map(({ id, values }) =>
          this.prisma.podSkuTemplateItem.update({ where: { id }, data: values }),
        ),
      );
    }

    return {
      total: sheet.rows.length,
      created: 0,
      updated: updates.length,
      skipped: parsed.length - updates.length,
      failed: 0,
      errors: [],
    };
  }

  // ==========================================================================
  // Private
  // ==========================================================================

  private async loadTemplate(organizationId: string, id: string) {
    const template = await this.prisma.podSkuTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            variantName: true,
            skuCode: true,
            barcode: true,
            priceAdjustmentType: true,
            priceAdjustmentValue: true,
            retailPrice: true,
            salePrice: true,
            quantity: true,
            discount: true,
            isActive: true,
          },
        },
      },
    });
    if (!template) throw new PodTemplateNotFoundException('SKU Template');
    return template;
  }

  private async readSheetData(buffer: Buffer): Promise<SheetData> {
    const workbook = await this.loadWorkbook(buffer);
    const worksheet = this.pickDataSheet(workbook);
    const { headers, rows, rowNumbers } = readSheet(worksheet);

    const actualByNormalized = new Map<string, string>();
    for (const header of headers) actualByNormalized.set(normalizeHeader(header), header);

    const headerByKey = new Map<ColumnKey, string>();
    const missing: string[] = [];
    for (const key of COLUMN_ORDER) {
      const found = actualByNormalized.get(normalizeHeader(COLUMNS[key].header));
      if (found) headerByKey.set(key, found);
      else if (COLUMNS[key].required) missing.push(COLUMNS[key].header);
    }

    if (missing.length > 0) {
      throw this.structural(
        `Thiếu cột bắt buộc: ${missing.join(', ')}. Header đọc được ở sheet "${worksheet.name}": ` +
          `${headers.map((header) => `"${header}"`).join(', ') || '(không có)'}`,
      );
    }
    if (rows.length > POD_SKU_IMPORT_MAX_ROWS) {
      throw this.structural(
        `File có ${rows.length} dòng, vượt giới hạn ${POD_SKU_IMPORT_MAX_ROWS} dòng mỗi lần import`,
      );
    }

    return {
      headerByKey,
      rows: rows.map((cells, index) => ({ rowNumber: rowNumbers[index], cells })),
    };
  }

  private async loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
    try {
      return await bufferToWorkbook(buffer);
    } catch {
      throw this.structural('File Excel (.xlsx) không hợp lệ hoặc bị hỏng');
    }
  }

  /** Ưu tiên sheet `SKUs`; nếu không có thì sheet đầu tiên khác `Instructions`. */
  private pickDataSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
    const named = (sheet: ExcelJS.Worksheet, name: string): boolean =>
      sheet.name.trim().toLowerCase() === name.toLowerCase();
    const worksheet =
      workbook.worksheets.find((sheet) => named(sheet, DATA_SHEET)) ??
      workbook.worksheets.find((sheet) => !named(sheet, INSTRUCTIONS_SHEET));
    if (!worksheet) throw this.structural('File không có sheet dữ liệu');
    return worksheet;
  }

  private cell(raw: RawRow, sheet: SheetData, key: ColumnKey): string {
    const header = sheet.headerByKey.get(key);
    return header ? (raw.cells[header] ?? '').trim() : '';
  }

  /** Trả `null` nếu dòng có lỗi. Ghi nhận TẤT CẢ lỗi của dòng, không dừng ở lỗi đầu tiên. */
  private validateRow(
    raw: RawRow,
    sheet: SheetData,
    errors: ImportRowErrorDto[],
  ): RowValues | null {
    let ok = true;
    const fail = (field: string, message: string): void => {
      ok = false;
      errors.push(this.err(raw.rowNumber, field, message));
    };

    const values: RowValues = {};

    const skuCode = this.cell(raw, sheet, 'skuCode');
    if (skuCode) {
      if (skuCode.length > 128) fail(COLUMNS.skuCode.header, 'Vượt quá 128 ký tự');
      else values.skuCode = skuCode;
    }

    const barcode = this.cell(raw, sheet, 'barcode');
    if (barcode) {
      if (barcode.length > 64) fail(COLUMNS.barcode.header, 'Vượt quá 64 ký tự');
      else values.barcode = barcode;
    }

    const adjustType = this.cell(raw, sheet, 'adjustType').toUpperCase();
    if (adjustType) {
      if (ADJUST_TYPES.includes(adjustType)) {
        values.priceAdjustmentType = adjustType as PodPriceAdjustmentType;
      } else {
        fail(COLUMNS.adjustType.header, `"${adjustType}" không hợp lệ (${ADJUST_TYPES.join('/')})`);
      }
    }

    const adjustValue = this.cell(raw, sheet, 'adjustValue');
    if (adjustValue) {
      // Cho phép số ÂM: "size S rẻ hơn 1.00" cũng là một quy tắc hợp lệ.
      const parsed = parseDecimalCell(adjustValue, MONEY_DECIMALS);
      if (parsed === null)
        fail(COLUMNS.adjustValue.header, `"${adjustValue}" không phải số hợp lệ`);
      else values.priceAdjustmentValue = new Prisma.Decimal(parsed);
    }

    for (const key of ['retailPrice', 'salePrice'] as const) {
      const value = this.cell(raw, sheet, key);
      if (!value) continue;
      const parsed = parseDecimalCell(value, MONEY_DECIMALS);
      if (parsed === null) {
        fail(
          COLUMNS[key].header,
          `"${value}" không phải số hợp lệ (tối đa ${MONEY_DECIMALS} chữ số thập phân)`,
        );
      } else if (parsed < 0) {
        fail(COLUMNS[key].header, `${COLUMNS[key].header} phải >= 0`);
      } else {
        values[key] = new Prisma.Decimal(parsed);
      }
    }

    const quantity = this.cell(raw, sheet, 'quantity');
    if (quantity) {
      if (!/^\d+$/.test(quantity))
        fail(COLUMNS.quantity.header, `"${quantity}" phải là số nguyên >= 0`);
      else values.quantity = Number(quantity);
    }

    const discount = this.cell(raw, sheet, 'discount');
    if (discount) {
      const parsed = parseDecimalCell(discount, DISCOUNT_DECIMALS);
      if (parsed === null) fail(COLUMNS.discount.header, `"${discount}" không phải số hợp lệ`);
      else if (parsed < 0 || parsed > 100)
        fail(COLUMNS.discount.header, 'Phải nằm trong khoảng 0–100');
      else values.discount = new Prisma.Decimal(parsed);
    }

    const enabled = this.cell(raw, sheet, 'enabled').toLowerCase();
    if (enabled) {
      if (TRUE_WORDS.has(enabled)) values.isActive = true;
      else if (FALSE_WORDS.has(enabled)) values.isActive = false;
      else fail(COLUMNS.enabled.header, `"${enabled}" không hợp lệ (dùng TRUE / FALSE)`);
    }

    return ok ? values : null;
  }

  private err(row: number, field: string | null, message: string): ImportRowErrorDto {
    return { sheet: DATA_SHEET, row, field, message };
  }

  private structural(message: string): BadRequestException {
    return new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message });
  }

  private slug(value: string): string {
    return (
      value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 60) || 'export'
    );
  }
}

/** Một dòng thô đọc từ file. */
interface RawRow {
  rowNumber: number;
  cells: Record<string, string>;
}

/** Kết quả đọc + kiểm tra cấu trúc file. */
interface SheetData {
  headerByKey: Map<ColumnKey, string>;
  rows: RawRow[];
}
