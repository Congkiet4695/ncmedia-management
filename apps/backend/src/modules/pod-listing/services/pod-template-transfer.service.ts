import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PodImageAssetType, PodPriceAdjustmentType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CsvParseError, parseCsv, toCsv } from '../../../common/csv/csv.util';
import { PrismaService } from '../../../database/prisma.service';
import {
  POD_IMAGE_TEMPLATE_MAX_ITEMS,
  POD_TEMPLATE_BUNDLE_VERSION,
  type PodTemplateKind,
} from '../constants/pod-listing.constants';
import {
  POD_TEMPLATE_CSV_COLUMNS,
  POD_TEMPLATE_CSV_MAX_ROWS,
  type PodTemplateCsvColumn,
  type PodTemplateCsvKind,
} from '../constants/pod-template-csv.constants';
import {
  POD_TEMPLATE_BUNDLE_MAX_ITEMS,
  type ExportTemplateBundle,
  type ImportTemplateBundleDto,
  type ImportTemplateItemError,
  type ImportTemplateResult,
} from '../dto/pod-template-transfer.dto';
import {
  CreateCategoryTemplateDto,
  CreateDescriptionTemplateDto,
  CreateImageTemplateDto,
  CreateListingTemplateDto,
  CreatePricingStrategyDto,
  CreateSkuTemplateDto,
  type PodTemplateQueryDto,
} from '../dto/pod-template.dto';
import { IMAGE_TEMPLATE_INCLUDE, PodImageTemplateService } from './pod-image-template.service';
import { PodListingImageUrlService } from './pod-listing-image-url.service';
import { PodListingTemplateService } from './pod-listing-template.service';
import {
  CATEGORY_TEMPLATE_INCLUDE,
  DESCRIPTION_TEMPLATE_INCLUDE,
  PodTemplateService,
  SKU_TEMPLATE_INCLUDE,
} from './pod-template.service';

/** Kết quả import kèm cảnh báo (tham chiếu bị bỏ vì không có ở tổ chức đích). */
export interface ImportTemplateResultWithWarnings extends ImportTemplateResult {
  warnings: string[];
}

/** Số template tối đa lấy ra trong một lần Export. */
const EXPORT_MAX_ITEMS = 500;

/** Loại template còn dùng gói JSON theo bộ lọc (Pricing, Listing). 4 tab còn lại đi theo dòng bằng CSV. */
export type PodBundleKind = Extract<PodTemplateKind, 'PRICING' | 'LISTING'>;

/** File trong Storage của tổ chức đích — nguồn sự thật cho url / key / mime của ảnh khi nạp. */
interface OwnedFile {
  id: string;
  publicUrl: string | null;
  objectKey: string;
  mimeType: string;
  fileSize: number;
}

/** Tham chiếu file trong file import: id (cùng tổ chức) và/hoặc URL công khai (chép sang tổ chức khác). */
interface FileRef {
  fileId: string | null;
  url: string | null;
}

/** Ngữ cảnh của MỘT lần import. */
interface ImportContext {
  organizationId: string;
  userId: string;
  warnings: string[];
  /** URL đã chép trong lần import này — cùng một ảnh dùng ở nhiều dòng chỉ chép một lần. */
  copiedByUrl: Map<string, OwnedFile>;
}

type ImageRestoreRows = Parameters<PodImageTemplateService['restoreItems']>[2];

const OWNED_FILE_SELECT = {
  id: true,
  publicUrl: true,
  objectKey: true,
  mimeType: true,
  fileSize: true,
} as const;

/**
 * PodTemplateTransferService — Export / Import cho cả sáu loại template.
 *
 *   - Category · SKU · Description · Image: THEO DÒNG bằng CSV (`exportRowsCsv` / `importRowsCsv`) —
 *     chỉ các template người dùng chọn, một dòng CSV = một template.
 *   - Pricing · Listing: gói JSON theo bộ lọc (`export` / `import`) — giữ nguyên.
 *
 * Nguyên tắc của dữ liệu mang đi:
 *
 * 1. **Không mang `id`.** Import luôn TẠO MỚI trong tổ chức đang đăng nhập. Không có
 *    đường nào để một file ghi đè dữ liệu của tổ chức khác.
 * 2. **Tham chiếu đi theo tên, không theo khoá.** Listing Template trỏ tới template con
 *    bằng TÊN; kho đi theo `tiktokWarehouseId`; ảnh đi theo URL công khai (chép sang tổ chức
 *    đích). Khoá UUID chỉ có nghĩa trong đúng một database, mang sang nơi khác là rác.
 * 3. **Tham chiếu không giải được thì bỏ và NÓI RA** (`warnings`), không im lặng tạo ra
 *    một template thiếu mảnh mà người dùng không biết.
 * 4. **Vẫn đi qua đúng bộ validate của API.** Mỗi phần tử được dựng thành DTO và chạy
 *    `class-validator` y như khi tạo bằng tay — file import không phải cửa sau vào database.
 */
@Injectable()
export class PodTemplateTransferService {
  private readonly logger = new Logger(PodTemplateTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: PodTemplateService,
    private readonly images: PodImageTemplateService,
    private readonly listingTemplates: PodListingTemplateService,
    private readonly imageUrls: PodListingImageUrlService,
  ) {}

  // =========================================================================
  // Export (gói JSON — Pricing, Listing)
  // =========================================================================

  async export(
    organizationId: string,
    kind: PodBundleKind,
    query: PodTemplateQueryDto,
  ): Promise<ExportTemplateBundle> {
    const listQuery: PodTemplateQueryDto = { ...query, page: 1, limit: EXPORT_MAX_ITEMS };
    const items = await this.collect(organizationId, kind, listQuery);

    return {
      version: POD_TEMPLATE_BUNDLE_VERSION,
      kind,
      exportedAt: new Date().toISOString(),
      count: items.length,
      items,
    };
  }

  private async collect(
    organizationId: string,
    kind: PodBundleKind,
    query: PodTemplateQueryDto,
  ): Promise<Array<Record<string, unknown>>> {
    switch (kind) {
      case 'PRICING': {
        const { items } = await this.templates.listPricingStrategies(organizationId, query);
        return items.map((strategy) => ({
          name: strategy.name,
          cost: Number(strategy.cost),
          shippingCost: Number(strategy.shippingCost),
          markupType: strategy.markupType,
          markupValue: Number(strategy.markupValue),
          formula: strategy.formula,
          retailPriceMultiplier: Number(strategy.retailPriceMultiplier),
          discountPercent: Number(strategy.discountPercent),
          roundingIncrement: Number(strategy.roundingIncrement),
          currency: strategy.currency,
          displayOrder: strategy.displayOrder,
          note: strategy.note,
        }));
      }

      case 'LISTING': {
        const { items } = await this.listingTemplates.list(organizationId, query);
        return items.map((template) => ({
          name: template.name,
          market: template.market,
          // Tham chiếu theo TÊN — UUID mang sang database khác là vô nghĩa.
          categoryTemplateName: template.categoryTemplate?.name ?? null,
          skuTemplateName: template.skuTemplate?.name ?? null,
          descriptionTemplateName: template.descriptionTemplate?.name ?? null,
          imageTemplateName: template.imageTemplate?.name ?? null,
          pricingStrategyName: template.pricingStrategy?.name ?? null,
          tiktokWarehouseId: null,
          tiktokBrandId: template.tiktokBrandId,
          brandName: template.brandName,
          shippingTemplateId: template.shippingTemplateId,
          handlingDays: template.handlingDays,
          packageWeight: template.packageWeight,
          weightUnit: template.weightUnit,
          packageLength: template.packageLength,
          packageWidth: template.packageWidth,
          packageHeight: template.packageHeight,
          dimensionUnit: template.dimensionUnit,
          // Phạm vi áp dụng đi theo gói: mang template sang tổ chức khác mà mất phạm vi
          // thì bên nhận phải khai lại "áp cho sản phẩm nào" — đúng phần tốn công nhất.
          scopes: template.scopes.map((scope) => ({
            matchType: scope.matchType,
            value: scope.value,
            valueLabel: scope.valueLabel,
            isExclude: scope.isExclude,
          })),
          displayOrder: template.displayOrder,
          note: template.note,
        }));
      }
    }
  }

  // =========================================================================
  // Export THEO DÒNG (CSV) — Category · SKU · Description · Image
  // =========================================================================

  /**
   * CSV của ĐÚNG các template đã chọn.
   *
   * 🔴 Mọi id phải thuộc tổ chức trong token và chưa xoá. Thiếu dù một ⇒ 404 và KHÔNG xuất gì: âm thầm
   * bỏ id lạ thì người dùng nhận một file thiếu dòng mà không biết; xuất id của tổ chức khác là rò rỉ.
   */
  async exportRowsCsv(
    organizationId: string,
    kind: PodTemplateCsvKind,
    ids: string[],
  ): Promise<{ csv: string; count: number }> {
    const unique = [...new Set(ids)];
    const items = await this.collectRows(organizationId, kind, unique);
    const columns = POD_TEMPLATE_CSV_COLUMNS[kind];
    const csv = toCsv(
      columns.map((column) => column.key),
      items.map((item) => columns.map((column) => this.csvValue(item[column.key], column))),
    );

    this.logger.log({
      module: 'pod-listing',
      operation: 'template.exportRows',
      organizationId,
      kind,
      count: items.length,
      msg: 'Đã export template theo dòng',
    });
    return { csv, count: items.length };
  }

  /** Đọc các template theo id — MỘT truy vấn cho cả lô (không N+1), giữ đúng thứ tự người dùng chọn. */
  private async collectRows(
    organizationId: string,
    kind: PodTemplateCsvKind,
    ids: string[],
  ): Promise<Array<Record<string, unknown>>> {
    const where = { id: { in: ids }, organizationId, deletedAt: null };
    let rows: Array<{ id: string; item: Record<string, unknown> }>;

    switch (kind) {
      case 'CATEGORY': {
        const found = await this.prisma.podCategoryTemplate.findMany({
          where,
          include: CATEGORY_TEMPLATE_INCLUDE,
        });
        const sizeCharts = await this.ownedFiles(
          organizationId,
          found.map((template) => template.sizeChartFileId),
        );
        rows = found.map((template) => ({
          id: template.id,
          item: {
            name: template.name,
            market: template.market,
            tiktokCategoryId: template.tiktokCategoryId,
            categoryName: template.categoryName,
            categoryPath: template.categoryPath,
            // "No brand" (NONE) là lựa chọn có chủ đích — thiếu cột này thì nạp lại thành UNSET.
            brandMode: template.brandMode,
            tiktokBrandId: template.tiktokBrandId,
            brandName: template.brandName,
            tiktokWarehouseId: template.warehouse?.tiktokWarehouseId ?? null,
            packageWeight: template.packageWeight,
            weightUnit: template.weightUnit,
            packageLength: template.packageLength,
            packageWidth: template.packageWidth,
            packageHeight: template.packageHeight,
            dimensionUnit: template.dimensionUnit,
            sizeChartFileId: template.sizeChartFileId,
            sizeChartUrl: template.sizeChartFileId
              ? (sizeCharts.get(template.sizeChartFileId)?.publicUrl ?? null)
              : null,
            videoFileId: template.videoFileId,
            displayOrder: template.displayOrder,
            note: template.note,
            attributes: template.attributes.map((attribute) => ({
              tiktokAttributeId: attribute.tiktokAttributeId,
              attributeName: attribute.attributeName,
              attributeType: attribute.attributeType,
              isRequired: attribute.isRequired,
              isMultipleSelection: attribute.isMultipleSelection,
              isCustomizable: attribute.isCustomizable,
              customValues: attribute.customValues.map((custom) => custom.value),
              sortOrder: attribute.sortOrder,
              values: attribute.values.map((value) => ({
                tiktokValueId: value.tiktokValueId,
                valueName: value.valueName,
              })),
            })),
          },
        }));
        break;
      }

      case 'SKU': {
        const found = await this.prisma.podSkuTemplate.findMany({
          where,
          include: SKU_TEMPLATE_INCLUDE,
        });
        rows = found.map((template) => ({
          id: template.id,
          item: {
            name: template.name,
            skuPrefix: template.skuPrefix,
            skuSuffix: template.skuSuffix,
            defaultRetailPrice: this.num(template.defaultRetailPrice),
            defaultSalePrice: this.num(template.defaultSalePrice),
            defaultQuantity: template.defaultQuantity,
            defaultDiscount: this.num(template.defaultDiscount),
            currency: template.currency,
            displayOrder: template.displayOrder,
            note: template.note,
            variants: template.variants.map((variant) => ({
              name: variant.name,
              sortOrder: variant.sortOrder,
              values: variant.values.map((value) => ({
                value: value.value,
                code: value.code,
                sortOrder: value.sortOrder,
                imageFileId: value.image?.id ?? null,
                imageUrl: value.image?.publicUrl ?? null,
              })),
            })),
            // Giá / tồn / barcode / ảnh từng dòng: áp lại sau khi tổ hợp đã sinh (`applySkuItemOverrides`).
            items: template.items.map((item) => ({
              variantName: item.variantName,
              skuCode: item.skuCode,
              barcode: item.barcode,
              priceAdjustmentType: item.priceAdjustmentType,
              priceAdjustmentValue: this.num(item.priceAdjustmentValue),
              retailPrice: this.num(item.retailPrice),
              salePrice: this.num(item.salePrice),
              quantity: item.quantity,
              discount: this.num(item.discount),
              isActive: item.isActive,
              imageFileId: item.image?.id ?? null,
              imageUrl: item.image?.publicUrl ?? null,
            })),
          },
        }));
        break;
      }

      case 'DESCRIPTION': {
        const found = await this.prisma.podDescriptionTemplate.findMany({
          where,
          include: DESCRIPTION_TEMPLATE_INCLUDE,
        });
        rows = found.map((template) => ({
          id: template.id,
          item: {
            name: template.name,
            contentHtml: template.contentHtml,
            displayOrder: template.displayOrder,
            note: template.note,
            tokens: template.tokens.map((token) => ({
              code: token.code,
              label: token.label,
              value: token.value,
              sortOrder: token.sortOrder,
            })),
          },
        }));
        break;
      }

      case 'IMAGE': {
        const found = await this.prisma.podImageTemplate.findMany({
          where,
          include: IMAGE_TEMPLATE_INCLUDE,
        });
        rows = found.map((template) => ({
          id: template.id,
          item: {
            name: template.name,
            description: template.description,
            displayOrder: template.displayOrder,
            // Tham chiếu ảnh, không mang bytes: `fileId` dùng lại khi nạp vào chính tổ chức nguồn, `imageUrl`
            // (URL công khai) để chép ảnh sang tổ chức khác. Key lưu trữ là chi tiết nội bộ — không xuất.
            images: template.items.map((item) => ({
              title: item.title,
              assetType: item.assetType,
              fileId: item.fileId,
              imageUrl: item.imageUrl || null,
              width: item.width,
              height: item.height,
              isRequired: item.isRequired,
            })),
          },
        }));
        break;
      }
    }

    if (rows.length !== ids.length) {
      throw new NotFoundException({
        code: 'POD_TEMPLATE_EXPORT_NOT_FOUND',
        message: `${ids.length - rows.length}/${ids.length} template đã chọn không tồn tại hoặc không thuộc tổ chức của bạn — không export.`,
      });
    }
    const byId = new Map(rows.map((row) => [row.id, row.item]));
    return ids.map((id) => byId.get(id) as Record<string, unknown>);
  }

  /** Giá trị một ô CSV: rỗng cho null, JSON cho cột lồng nhau, chuỗi cho phần còn lại. */
  private csvValue(value: unknown, column: PodTemplateCsvColumn): string {
    if (value === null || value === undefined) return '';
    if (column.type === 'json') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  // =========================================================================
  // Import THEO DÒNG (CSV) — Category · SKU · Description · Image
  // =========================================================================

  /**
   * Nạp CSV đã export (từ chính tổ chức này hoặc tổ chức khác) vào tổ chức trong token.
   *
   * - Chỉ TẠO template cho các dòng có trong file — không xoá / sửa template nào khác của tổ chức
   *   (cùng quy tắc với import gói JSON: trùng tên ⇒ thêm hậu tố, không ghi đè).
   * - Từng dòng độc lập (fail-soft): dòng lỗi không chặn dòng khác; kết quả nêu số dòng + lý do.
   * - Mỗi dòng nguyên tử: lỗi giữa chừng ⇒ dọn template vừa tạo, không để lại template thiếu mảnh.
   */
  async importRowsCsv(
    organizationId: string,
    userId: string,
    kind: PodTemplateCsvKind,
    content: string,
  ): Promise<ImportTemplateResultWithWarnings> {
    const { header, rows } = this.readCsv(kind, content);
    const warnings: string[] = [];
    const copiedByUrl = new Map<string, OwnedFile>();
    const errors: ImportTemplateItemError[] = [];
    const nameIndex = header.indexOf('name');
    let created = 0;

    for (const [index, cells] of rows.entries()) {
      const row = index + 2;
      const name = cells[nameIndex]?.trim() || null;
      const rowWarnings: string[] = [];
      try {
        const raw = this.rowToItem(kind, header, cells);
        await this.importOne(
          { organizationId, userId, warnings: rowWarnings, copiedByUrl },
          kind,
          raw,
          true,
        );
        created += 1;
      } catch (error) {
        errors.push({ index, row, name, message: this.message(error) });
      }
      warnings.push(...rowWarnings.map((warning) => `Dòng ${row}: ${warning}`));
    }

    this.logger.log({
      module: 'pod-listing',
      operation: 'template.importRows',
      organizationId,
      kind,
      total: rows.length,
      created,
      failed: errors.length,
      warnings: warnings.length,
      msg: 'Đã import template theo dòng',
    });

    return { total: rows.length, created, failed: errors.length, errors, warnings };
  }

  /** Đọc + kiểm khung file: đúng bộ cột của loại template, có dữ liệu, không quá trần. */
  private readCsv(kind: PodTemplateCsvKind, content: string): { header: string[]; rows: string[][] } {
    let table: string[][];
    try {
      table = parseCsv(content);
    } catch (error) {
      if (!(error instanceof CsvParseError)) throw error;
      throw new BadRequestException({ code: 'POD_TEMPLATE_CSV_INVALID', message: error.message });
    }

    const [headerRow, ...rows] = table;
    const header = (headerRow ?? []).map((cell) => cell.trim());
    const columns = POD_TEMPLATE_CSV_COLUMNS[kind];
    const known = new Set(columns.map((column) => column.key));
    const unknown = header.filter((key) => !known.has(key));
    const missing = columns.filter((column) => column.required && !header.includes(column.key));
    const duplicated = [...new Set(header.filter((key, index) => header.indexOf(key) !== index))];
    if (unknown.length > 0 || missing.length > 0 || duplicated.length > 0) {
      const detail = [
        unknown.length ? `cột lạ: ${unknown.join(', ')}` : '',
        missing.length ? `thiếu cột: ${missing.map((column) => column.key).join(', ')}` : '',
        duplicated.length ? `cột trùng: ${duplicated.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      throw new BadRequestException({
        code: 'POD_TEMPLATE_CSV_COLUMNS_MISMATCH',
        message: `File không phải CSV của ${kind} Template (${detail}). Hãy dùng file Export từ đúng tab này.`,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException({
        code: 'POD_TEMPLATE_CSV_EMPTY',
        message: 'File không có dòng dữ liệu nào.',
      });
    }
    if (rows.length > POD_TEMPLATE_CSV_MAX_ROWS) {
      throw new BadRequestException({
        code: 'POD_TEMPLATE_BUNDLE_TOO_LARGE',
        message: `File có ${rows.length} dòng, vượt trần ${POD_TEMPLATE_CSV_MAX_ROWS}.`,
      });
    }
    return { header, rows };
  }

  /** Một dòng CSV ⇒ phần tử gói (đúng hình dạng importer đọc). Ô rỗng = không khai báo. */
  private rowToItem(
    kind: PodTemplateCsvKind,
    header: string[],
    cells: string[],
  ): Record<string, unknown> {
    if (cells.length !== header.length) {
      throw this.rowInvalid(`Dòng có ${cells.length} ô nhưng tiêu đề có ${header.length} cột.`);
    }
    const types = new Map(POD_TEMPLATE_CSV_COLUMNS[kind].map((column) => [column.key, column.type]));
    const item: Record<string, unknown> = {};

    header.forEach((key, index) => {
      const cell = cells[index];
      if (cell.trim() === '') return;
      const type = types.get(key);

      if (type === 'number' || type === 'integer') {
        const value = Number(cell.trim());
        if (!Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) {
          throw this.rowInvalid(
            `Cột ${key}: "${cell}" không phải ${type === 'integer' ? 'số nguyên' : 'số'}.`,
          );
        }
        item[key] = value;
      } else if (type === 'json') {
        let value: unknown;
        try {
          value = JSON.parse(cell);
        } catch {
          throw this.rowInvalid(`Cột ${key}: JSON không hợp lệ.`);
        }
        if (!Array.isArray(value)) throw this.rowInvalid(`Cột ${key}: phải là mảng JSON.`);
        item[key] = value;
      } else {
        item[key] = cell;
      }
    });
    return item;
  }

  private rowInvalid(message: string): BadRequestException {
    return new BadRequestException({ code: 'POD_TEMPLATE_CSV_ROW_INVALID', message });
  }

  // =========================================================================
  // Import (gói JSON — Pricing, Listing)
  // =========================================================================

  async import(
    organizationId: string,
    userId: string,
    kind: PodBundleKind,
    bundle: ImportTemplateBundleDto,
  ): Promise<ImportTemplateResultWithWarnings> {
    if (bundle.kind && bundle.kind !== kind) {
      throw new BadRequestException({
        code: 'POD_TEMPLATE_BUNDLE_KIND_MISMATCH',
        message: `Gói này chứa template loại ${bundle.kind}, không nạp vào ${kind} được.`,
      });
    }
    if (bundle.items.length > POD_TEMPLATE_BUNDLE_MAX_ITEMS) {
      throw new BadRequestException({
        code: 'POD_TEMPLATE_BUNDLE_TOO_LARGE',
        message: `Gói có ${bundle.items.length} template, vượt trần ${POD_TEMPLATE_BUNDLE_MAX_ITEMS}.`,
      });
    }

    const errors: ImportTemplateItemError[] = [];
    const warnings: string[] = [];
    const ctx: ImportContext = { organizationId, userId, warnings, copiedByUrl: new Map() };
    let created = 0;

    for (const [index, raw] of bundle.items.entries()) {
      const name = typeof raw.name === 'string' ? raw.name : null;
      try {
        await this.importOne(ctx, kind, raw, bundle.renameOnConflict ?? true);
        created += 1;
      } catch (error) {
        // Fail-soft từng phần tử: một template hỏng không được chặn 199 cái còn lại.
        errors.push({ index, name, message: this.message(error) });
      }
    }

    this.logger.log({
      module: 'pod-listing',
      operation: 'template.import',
      organizationId,
      kind,
      total: bundle.items.length,
      created,
      failed: errors.length,
      msg: 'Đã import template',
    });

    return { total: bundle.items.length, created, failed: errors.length, errors, warnings };
  }

  private async importOne(
    ctx: ImportContext,
    kind: PodTemplateKind,
    raw: Record<string, unknown>,
    renameOnConflict: boolean,
  ): Promise<void> {
    const { organizationId, userId } = ctx;
    const payload = await this.prepare(ctx, kind, raw);
    payload.name = await this.resolveName(
      organizationId,
      kind,
      this.str(payload.name) ?? '',
      renameOnConflict,
    );

    switch (kind) {
      case 'CATEGORY': {
        const dto = await this.toDto(CreateCategoryTemplateDto, payload);
        await this.templates.createCategoryTemplate(organizationId, userId, dto);
        return;
      }
      case 'SKU': {
        const dto = await this.toDto(CreateSkuTemplateDto, payload);
        const created = await this.templates.createSkuTemplate(organizationId, userId, dto);
        // Tạo template chỉ ghi TRỤC (từ sprint SKU Generator). File có kèm bảng SKU thì sinh
        // luôn rồi áp lại giá/tồn — "Import lại giữ nguyên" phải đúng nghĩa là giữ nguyên.
        if (!Array.isArray(payload.items) || payload.items.length === 0) return;

        await this.undoOnFailure(
          () => this.prisma.podSkuTemplate.delete({ where: { id: created.id } }),
          async () => {
            const template = await this.templates.generateSkuItems(
              organizationId,
              userId,
              created.id,
            );
            await this.applySkuItemOverrides(template.id, template.items, payload.items);
          },
        );
        return;
      }
      case 'DESCRIPTION': {
        const dto = await this.toDto(CreateDescriptionTemplateDto, payload);
        await this.templates.createDescriptionTemplate(organizationId, userId, dto);
        return;
      }
      case 'IMAGE': {
        const dto = await this.toDto(CreateImageTemplateDto, payload);
        // Ảnh đã được giải về file CỦA tổ chức đích ở `prepare` (dùng lại / chép từ URL) — thiếu một ảnh là
        // dòng đã lỗi ở đó, trước khi tạo gì.
        const rows = (payload.items ?? []) as ImageRestoreRows;
        const template = await this.images.create(organizationId, userId, dto);
        await this.undoOnFailure(
          () => this.prisma.podImageTemplate.delete({ where: { id: template.id } }),
          async () => {
            const restored = await this.images.restoreItems(organizationId, template.id, rows);
            if (restored.skipped > 0) {
              throw new BadRequestException({
                code: 'POD_TEMPLATE_IMAGE_UNAVAILABLE',
                message: `${restored.skipped} ảnh không còn trong tổ chức này.`,
              });
            }
          },
        );
        return;
      }
      case 'PRICING': {
        const dto = await this.toDto(CreatePricingStrategyDto, payload);
        await this.templates.createPricingStrategy(organizationId, userId, dto);
        return;
      }
      case 'LISTING': {
        const dto = await this.toDto(CreateListingTemplateDto, payload);
        await this.listingTemplates.create(organizationId, userId, dto);
        return;
      }
    }
  }

  /**
   * Bước sau khi đã tạo template hỏng ⇒ xoá hẳn template vừa tạo (con đi theo bằng cascade) rồi ném lại
   * lỗi. Template vừa tạo chưa ai tham chiếu nên xoá cứng là an toàn; giữ lại thì người dùng nhận một
   * template thiếu mảnh dưới nhãn "lỗi".
   */
  private async undoOnFailure(
    undo: () => Promise<unknown>,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      await undo().catch((cleanupError: unknown) =>
        this.logger.error({
          module: 'pod-listing',
          operation: 'template.import.undo',
          msg: 'Không dọn được template nhập dở',
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        }),
      );
      throw error;
    }
  }

  /** Giải các tham chiếu theo tên / theo mã TikTok / theo URL về id của tổ chức đích. */
  private async prepare(
    ctx: ImportContext,
    kind: PodTemplateKind,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { organizationId, warnings } = ctx;
    const payload: Record<string, unknown> = { ...raw };
    const label = typeof raw.name === 'string' ? raw.name : '(không tên)';

    if (kind === 'CATEGORY' || kind === 'LISTING') {
      delete payload.warehouseId;
      const warehouseCode = this.str(raw.tiktokWarehouseId);
      if (warehouseCode) {
        const warehouse = await this.prisma.podTiktokWarehouse.findFirst({
          where: { organizationId, tiktokWarehouseId: warehouseCode, deletedAt: null },
          select: { id: true },
        });
        if (warehouse) payload.warehouseId = warehouse.id;
        else
          warnings.push(`"${label}": không có kho ${warehouseCode} trong tổ chức — đã bỏ trống.`);
      }
      delete payload.tiktokWarehouseId;
    }

    if (kind === 'CATEGORY') {
      const sizeChart = await this.resolveOptionalImage(
        ctx,
        { fileId: this.str(raw.sizeChartFileId), url: this.str(raw.sizeChartUrl) },
        `"${label}": size chart`,
      );
      payload.sizeChartFileId = sizeChart?.id;
      delete payload.sizeChartUrl;
      // Video không chép qua URL (nặng, TikTok xử lý riêng) — chỉ dùng lại khi nạp vào chính tổ chức nguồn.
      payload.videoFileId = await this.keepExistingFile(
        organizationId,
        this.str(raw.videoFileId),
        label,
        'video',
        warnings,
      );
    }

    if (kind === 'SKU') {
      // Ảnh của giá trị trục và của từng tổ hợp: dùng lại / chép sang tổ chức đích; không được ⇒ bỏ ảnh +
      // cảnh báo (ảnh là phần phụ, không chặn cả template).
      if (Array.isArray(raw.variants)) {
        payload.variants = await this.mapSequential(raw.variants, async (variant) => {
          if (!this.isRecord(variant) || !Array.isArray(variant.values)) return variant;
          const values = await this.mapSequential(variant.values, async (value) => {
            if (!this.isRecord(value)) return value;
            const image = await this.resolveOptionalImage(
              ctx,
              { fileId: this.str(value.imageFileId), url: this.str(value.imageUrl) },
              `"${label}": ảnh của giá trị "${this.str(value.value) ?? ''}"`,
            );
            return { ...this.omit(value, 'imageUrl'), imageFileId: image?.id ?? null };
          });
          return { ...variant, values };
        });
      }
      if (Array.isArray(raw.items)) {
        payload.items = await this.mapSequential(raw.items, async (item) => {
          if (!this.isRecord(item)) return item;
          const image = await this.resolveOptionalImage(
            ctx,
            { fileId: this.str(item.imageFileId), url: this.str(item.imageUrl) },
            `"${label}": ảnh của SKU "${this.str(item.variantName) ?? ''}"`,
          );
          return { ...this.omit(item, 'imageUrl'), imageFileId: image?.id ?? null };
        });
      }
    }

    if (kind === 'IMAGE') {
      // `images` (CSV) ⇒ dòng ảnh của tổ chức đích. Ảnh là NỘI DUNG của Image Template (không phải tham
      // chiếu phụ) ⇒ ảnh nào không dùng lại / chép được là lỗi cả dòng, không tạo một template rỗng.
      payload.items = await this.resolveTemplateImages(ctx, raw.images);
      delete payload.images;
      delete payload.slots;
    }

    if (kind === 'LISTING') {
      const links: Array<[string, string, () => Promise<{ id: string } | null>]> = [
        [
          'categoryTemplateId',
          'Category Template',
          () =>
            this.prisma.podCategoryTemplate.findFirst({
              where: {
                organizationId,
                name: this.str(raw.categoryTemplateName) ?? '',
                deletedAt: null,
              },
              select: { id: true },
            }),
        ],
        [
          'skuTemplateId',
          'SKU Template',
          () =>
            this.prisma.podSkuTemplate.findFirst({
              where: { organizationId, name: this.str(raw.skuTemplateName) ?? '', deletedAt: null },
              select: { id: true },
            }),
        ],
        [
          'descriptionTemplateId',
          'Description Template',
          () =>
            this.prisma.podDescriptionTemplate.findFirst({
              where: {
                organizationId,
                name: this.str(raw.descriptionTemplateName) ?? '',
                deletedAt: null,
              },
              select: { id: true },
            }),
        ],
        [
          'imageTemplateId',
          'Image Template',
          () =>
            this.prisma.podImageTemplate.findFirst({
              where: {
                organizationId,
                name: this.str(raw.imageTemplateName) ?? '',
                deletedAt: null,
              },
              select: { id: true },
            }),
        ],
        [
          'pricingStrategyId',
          'Pricing Strategy',
          () =>
            this.prisma.podPricingStrategy.findFirst({
              where: {
                organizationId,
                name: this.str(raw.pricingStrategyName) ?? '',
                deletedAt: null,
              },
              select: { id: true },
            }),
        ],
      ];

      const sourceNames: Record<string, string> = {
        categoryTemplateId: 'categoryTemplateName',
        skuTemplateId: 'skuTemplateName',
        descriptionTemplateId: 'descriptionTemplateName',
        imageTemplateId: 'imageTemplateName',
        pricingStrategyId: 'pricingStrategyName',
      };

      for (const [field, kindLabel, find] of links) {
        const sourceName = this.str(raw[sourceNames[field]]);
        delete payload[sourceNames[field]];
        if (!sourceName) continue;

        const found = await find();
        if (found) payload[field] = found.id;
        else {
          warnings.push(
            `"${label}": không tìm thấy ${kindLabel} tên "${sourceName}" — đã bỏ trống mảnh này.`,
          );
        }
      }
    }

    // Trường chỉ có ý nghĩa để đọc, không thuộc DTO tạo mới.
    delete payload.isDefault;
    delete payload.isActive;
    return payload;
  }

  /**
   * Áp lại giá / tồn / barcode / ảnh của từng SKU sau khi tổ hợp đã được sinh.
   * DTO tạo mới chỉ nhận trục biến thể, nên đây là bước thứ hai — nếu bỏ, gói mang đi sẽ
   * mất đúng phần người dùng tốn công nhất.
   */
  private async applySkuItemOverrides(
    skuTemplateId: string,
    createdItems: Array<{ id: string; variantName: string }>,
    rawItems: unknown,
  ): Promise<void> {
    if (!Array.isArray(rawItems) || rawItems.length === 0) return;

    const byName = new Map(createdItems.map((item) => [item.variantName, item.id]));
    const updates = (rawItems as Array<Record<string, unknown>>)
      .map((item) => {
        const id = byName.get(this.str(item.variantName) ?? '');
        if (!id) return null;
        return this.prisma.podSkuTemplateItem.update({
          where: { id },
          data: {
            skuCode: this.str(item.skuCode) ?? undefined,
            barcode: this.str(item.barcode) ?? undefined,
            priceAdjustmentType: this.adjustmentType(item.priceAdjustmentType),
            priceAdjustmentValue: this.decimal(item.priceAdjustmentValue),
            retailPrice: this.decimal(item.retailPrice),
            salePrice: this.decimal(item.salePrice),
            quantity: typeof item.quantity === 'number' ? item.quantity : undefined,
            discount: this.decimal(item.discount),
            isActive: typeof item.isActive === 'boolean' ? item.isActive : undefined,
            // Đã giải về file của tổ chức đích ở `prepare`; không có ảnh riêng ⇒ giữ nguyên.
            imageFileId: this.str(item.imageFileId) ?? undefined,
          },
        });
      })
      .filter((update): update is NonNullable<typeof update> => update !== null);

    if (updates.length > 0) await this.prisma.$transaction(updates);

    // Gói mang bao nhiêu dòng thì bản nhập vào phải có đúng bấy nhiêu: người dùng đã xoá bớt
    // vài tổ hợp trước khi Export, nhập lại mà chúng sống dậy thì không còn là "giữ nguyên".
    // Chỉ chạm tổ hợp của CHÍNH template vừa tạo.
    const wanted = new Set(
      (rawItems as Array<Record<string, unknown>>)
        .map((item) => this.str(item.variantName))
        .filter((name): name is string => Boolean(name)),
    );
    const extra = createdItems.filter((item) => !wanted.has(item.variantName));
    if (extra.length > 0) {
      await this.prisma.podSkuTemplateItem.deleteMany({
        where: { skuTemplateId, id: { in: extra.map((item) => item.id) } },
      });
    }

    this.logger.debug({
      module: 'pod-listing',
      operation: 'template.import.skuItems',
      skuTemplateId,
      applied: updates.length,
      removed: extra.length,
    });
  }

  // =========================================================================
  // Private — file (ảnh) của tổ chức đích
  // =========================================================================

  /** Ảnh của Image Template trong CSV ⇒ đúng tham số `restoreItems`, với file thuộc tổ chức đích. */
  private async resolveTemplateImages(ctx: ImportContext, value: unknown): Promise<ImageRestoreRows> {
    const entries: unknown[] = Array.isArray(value) ? value : [];
    if (entries.length > POD_IMAGE_TEMPLATE_MAX_ITEMS) {
      throw this.rowInvalid(
        `Có ${entries.length} ảnh, vượt trần ${POD_IMAGE_TEMPLATE_MAX_ITEMS} ảnh mỗi template.`,
      );
    }

    const rows: ImageRestoreRows = [];
    for (const [index, entry] of entries.entries()) {
      const position = `Ảnh #${index + 1}`;
      if (!this.isRecord(entry)) throw this.rowInvalid(`${position}: sai định dạng.`);
      const title = this.str(entry.title);
      const assetType = this.str(entry.assetType);
      if (!title || !assetType || !(assetType in PodImageAssetType)) {
        throw this.rowInvalid(
          `${position}: thiếu tiêu đề hoặc loại ảnh không hợp lệ (${assetType ?? 'trống'}).`,
        );
      }

      let file: OwnedFile | null;
      try {
        file = await this.resolveFile(ctx, {
          fileId: this.str(entry.fileId),
          url: this.str(entry.imageUrl),
        });
      } catch (error) {
        throw new BadRequestException({
          code: 'POD_TEMPLATE_IMAGE_UNAVAILABLE',
          message: `${position} "${title}": không chép được ảnh — ${this.message(error)}`,
        });
      }
      if (!file) {
        throw new BadRequestException({
          code: 'POD_TEMPLATE_IMAGE_UNAVAILABLE',
          message: `${position} "${title}": ảnh không có trong tổ chức này và không có URL công khai để chép.`,
        });
      }

      rows.push({
        title: title.slice(0, 255),
        assetType: assetType as PodImageAssetType,
        fileId: file.id,
        // url / key / mime / dung lượng lấy từ file Storage của tổ chức đích — không tin giá trị trong file.
        imageUrl: file.publicUrl ?? '',
        imageKey: file.objectKey,
        contentType: file.mimeType,
        fileSize: file.fileSize,
        width: typeof entry.width === 'number' ? entry.width : null,
        height: typeof entry.height === 'number' ? entry.height : null,
        isRequired: entry.isRequired === true,
        displayOrder: index,
      });
    }
    return rows;
  }

  /** Ảnh tuỳ chọn (size chart, ảnh SKU): không giải được ⇒ bỏ trống + cảnh báo, không chặn cả dòng. */
  private async resolveOptionalImage(
    ctx: ImportContext,
    ref: FileRef,
    what: string,
  ): Promise<OwnedFile | null> {
    if (!ref.fileId && !ref.url) return null;
    try {
      const file = await this.resolveFile(ctx, ref);
      if (file) return file;
      ctx.warnings.push(
        `${what} không có trong tổ chức này và không có URL công khai để chép — đã bỏ trống.`,
      );
    } catch (error) {
      ctx.warnings.push(`${what}: không chép được ảnh (${this.message(error)}) — đã bỏ trống.`);
    }
    return null;
  }

  /**
   * Tham chiếu file trong file import ⇒ file CỦA tổ chức đích.
   *
   * 1. `fileId` thuộc tổ chức đích (nạp lại vào chính tổ chức nguồn) ⇒ dùng lại, không chép.
   * 2. Không ⇒ có URL công khai ⇒ CHÉP ảnh vào Storage của tổ chức đích qua `PodListingImageUrlService`
   *    (cùng hàng rào SSRF + kiểm chữ ký ảnh với "Thêm ảnh bằng URL"). Id của tổ chức nguồn không bao giờ
   *    được ghi vào tổ chức đích.
   * 3. Không có gì ⇒ `null`. Chép hỏng ⇒ ném lỗi (nơi gọi quyết định lỗi dòng hay cảnh báo).
   */
  private async resolveFile(ctx: ImportContext, ref: FileRef): Promise<OwnedFile | null> {
    if (ref.fileId) {
      const own = await this.prisma.storageFile.findFirst({
        where: { id: ref.fileId, organizationId: ctx.organizationId, deletedAt: null },
        select: OWNED_FILE_SELECT,
      });
      if (own) return own;
    }
    if (!ref.url) return null;

    const cached = ctx.copiedByUrl.get(ref.url);
    if (cached) return cached;
    const copied = await this.imageUrls.importImage(ctx.organizationId, ctx.userId, ref.url);
    const file = await this.prisma.storageFile.findFirstOrThrow({
      where: { id: copied.id, organizationId: ctx.organizationId },
      select: OWNED_FILE_SELECT,
    });
    ctx.copiedByUrl.set(ref.url, file);
    return file;
  }

  /** File của tổ chức theo id (một truy vấn cho cả lô). */
  private async ownedFiles(
    organizationId: string,
    fileIds: Array<string | null>,
  ): Promise<Map<string, OwnedFile>> {
    const unique = [...new Set(fileIds.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.storageFile.findMany({
      where: { id: { in: unique }, organizationId, deletedAt: null },
      select: OWNED_FILE_SELECT,
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  // =========================================================================
  // Private — tiện ích
  // =========================================================================

  /**
   * Dựng DTO rồi chạy đúng bộ validate của API.
   * File import đi qua cùng một cổng kiểm tra với form trên giao diện — không có cửa sau.
   */
  private async toDto<T extends object>(
    ctor: new () => T,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const instance = plainToInstance(ctor, payload, { enableImplicitConversion: false });
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: false,
      skipMissingProperties: false,
    });
    if (errors.length > 0) {
      const detail = errors
        .map((error) => Object.values(error.constraints ?? {}).join('; ') || error.property)
        .join(' · ');
      throw new BadRequestException({ code: 'POD_TEMPLATE_BUNDLE_INVALID', message: detail });
    }
    return instance;
  }

  /** Trùng tên ⇒ thêm hậu tố. Tên template không unique ở DB nhưng trùng tên thì không tra được. */
  private async resolveName(
    organizationId: string,
    kind: PodTemplateKind,
    name: string,
    renameOnConflict: boolean,
  ): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed || !renameOnConflict) return trimmed;

    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = attempt === 0 ? trimmed : `${trimmed} (import ${attempt})`;
      if (!(await this.nameExists(organizationId, kind, candidate))) return candidate;
    }
    return `${trimmed} (import ${Date.now()})`;
  }

  private async nameExists(
    organizationId: string,
    kind: PodTemplateKind,
    name: string,
  ): Promise<boolean> {
    const where = { organizationId, name, deletedAt: null };
    switch (kind) {
      case 'CATEGORY':
        return (await this.prisma.podCategoryTemplate.count({ where })) > 0;
      case 'SKU':
        return (await this.prisma.podSkuTemplate.count({ where })) > 0;
      case 'DESCRIPTION':
        return (await this.prisma.podDescriptionTemplate.count({ where })) > 0;
      case 'IMAGE':
        return (await this.prisma.podImageTemplate.count({ where })) > 0;
      case 'PRICING':
        return (await this.prisma.podPricingStrategy.count({ where })) > 0;
      case 'LISTING':
        return (await this.prisma.podListingTemplate.count({ where })) > 0;
    }
  }

  private async keepExistingFile(
    organizationId: string,
    fileId: string | null,
    label: string,
    what: string,
    warnings: string[],
  ): Promise<string | undefined> {
    if (!fileId) return undefined;
    const existing = await this.ownedFiles(organizationId, [fileId]);
    if (existing.has(fileId)) return fileId;
    warnings.push(`"${label}": file ${what} không có trong tổ chức — đã bỏ trống.`);
    return undefined;
  }

  /** Map tuần tự (ảnh chép qua mạng — không bắn song song hàng chục lệnh tải). */
  private async mapSequential<T>(items: unknown[], fn: (item: unknown) => Promise<T>): Promise<T[]> {
    const out: T[] = [];
    for (const item of items) out.push(await fn(item));
    return out;
  }

  private omit(record: Record<string, unknown>, key: string): Record<string, unknown> {
    const rest = { ...record };
    delete rest[key];
    return rest;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private str(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private num(value: { toString(): string } | null): number | null {
    return value === null ? null : Number(value.toString());
  }

  private decimal(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private adjustmentType(value: unknown): PodPriceAdjustmentType | undefined {
    return typeof value === 'string' && value in PodPriceAdjustmentType
      ? (value as PodPriceAdjustmentType)
      : undefined;
  }

  private message(error: unknown): string {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { message?: string } }).response;
      if (response?.message) return response.message;
    }
    return error instanceof Error ? error.message : 'Lỗi không xác định';
  }
}
