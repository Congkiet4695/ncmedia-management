import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PodPriceAdjustmentType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../../database/prisma.service';
import {
  POD_TEMPLATE_BUNDLE_VERSION,
  type PodTemplateKind,
} from '../constants/pod-listing.constants';
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
import { PodImageTemplateService } from './pod-image-template.service';
import { PodListingTemplateService } from './pod-listing-template.service';
import { PodTemplateService } from './pod-template.service';

/** Kết quả import kèm cảnh báo (tham chiếu bị bỏ vì không có ở tổ chức đích). */
export interface ImportTemplateResultWithWarnings extends ImportTemplateResult {
  warnings: string[];
}

/** Số template tối đa lấy ra trong một lần Export. */
const EXPORT_MAX_ITEMS = 500;

/**
 * PodTemplateTransferService — Export / Import cho cả sáu loại template.
 *
 * Nguyên tắc của gói mang đi:
 *
 * 1. **Không mang `id`.** Import luôn TẠO MỚI trong tổ chức đang đăng nhập. Không có
 *    đường nào để một gói ghi đè dữ liệu của tổ chức khác.
 * 2. **Tham chiếu đi theo tên, không theo khoá.** Listing Template trỏ tới template con
 *    bằng TÊN; kho đi theo `tiktokWarehouseId`. Khoá UUID chỉ có nghĩa trong đúng một
 *    database, mang sang nơi khác là rác.
 * 3. **Tham chiếu không giải được thì bỏ và NÓI RA** (`warnings`), không im lặng tạo ra
 *    một template thiếu mảnh mà người dùng không biết.
 * 4. **Vẫn đi qua đúng bộ validate của API.** Mỗi phần tử được dựng thành DTO và chạy
 *    `class-validator` y như khi tạo bằng tay — file JSON không phải cửa sau vào database.
 */
@Injectable()
export class PodTemplateTransferService {
  private readonly logger = new Logger(PodTemplateTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: PodTemplateService,
    private readonly images: PodImageTemplateService,
    private readonly listingTemplates: PodListingTemplateService,
  ) {}

  // =========================================================================
  // Export
  // =========================================================================

  async export(
    organizationId: string,
    kind: PodTemplateKind,
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
    kind: PodTemplateKind,
    query: PodTemplateQueryDto,
  ): Promise<Array<Record<string, unknown>>> {
    switch (kind) {
      case 'CATEGORY': {
        const { items } = await this.templates.listCategoryTemplates(organizationId, query);
        return items.map((template) => ({
          name: template.name,
          market: template.market,
          tiktokCategoryId: template.tiktokCategoryId,
          categoryName: template.categoryName,
          categoryPath: template.categoryPath,
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
        }));
      }

      case 'SKU': {
        // Danh sách rút gọn không kèm từng SKU ⇒ đọc chi tiết để gói mang theo cả bảng giá.
        const { items } = await this.templates.listSkuTemplates(organizationId, query);
        const details = await Promise.all(
          items.map((item) => this.templates.getSkuTemplate(organizationId, item.id)),
        );
        return details.map((template) => ({
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
            })),
          })),
          // Giá / tồn / barcode từng dòng: không nằm trong DTO tạo mới nên được áp lại
          // sau khi tổ hợp đã sinh (xem `applySkuItemOverrides`).
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
          })),
        }));
      }

      case 'DESCRIPTION': {
        const { items } = await this.templates.listDescriptionTemplates(organizationId, query);
        return items.map((template) => ({
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
        }));
      }

      case 'IMAGE': {
        const { items } = await this.images.list(organizationId, query);
        return items.map((template) => ({
          name: template.name,
          description: template.description,
          displayOrder: template.displayOrder,
          // Gói mang theo **tham chiếu ảnh**, không mang bytes. Nạp lại trong CÙNG tổ chức
          // là dùng đúng ảnh cũ; mang sang tổ chức khác thì ảnh không thuộc về họ nên bị
          // bỏ kèm cảnh báo — bên nhận tải mockup của mình lên.
          items: template.items.map((item) => ({
            title: item.title,
            assetType: item.assetType,
            fileId: item.fileId,
            imageUrl: item.imageUrl,
            imageKey: item.imageKey,
            contentType: item.contentType,
            fileSize: item.fileSize,
            width: item.width,
            height: item.height,
            isRequired: item.isRequired,
            displayOrder: item.displayOrder,
          })),
        }));
      }

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
  // Import
  // =========================================================================

  async import(
    organizationId: string,
    userId: string,
    kind: PodTemplateKind,
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
    let created = 0;

    for (const [index, raw] of bundle.items.entries()) {
      const name = typeof raw.name === 'string' ? raw.name : null;
      try {
        await this.importOne(organizationId, userId, kind, raw, bundle.renameOnConflict ?? true, warnings);
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
    organizationId: string,
    userId: string,
    kind: PodTemplateKind,
    raw: Record<string, unknown>,
    renameOnConflict: boolean,
    warnings: string[],
  ): Promise<void> {
    const payload = await this.prepare(organizationId, kind, raw, warnings);
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
        // Tạo template chỉ ghi TRỤC (từ sprint SKU Generator). Gói có kèm bảng SKU thì sinh
        // luôn rồi áp lại giá/tồn — "Import lại giữ nguyên" phải đúng nghĩa là giữ nguyên.
        if (!Array.isArray(payload.items) || payload.items.length === 0) return;

        const template = await this.templates.generateSkuItems(organizationId, userId, created.id);
        await this.applySkuItemOverrides(template.id, template.items, payload.items);
        return;
      }
      case 'DESCRIPTION': {
        const dto = await this.toDto(CreateDescriptionTemplateDto, payload);
        await this.templates.createDescriptionTemplate(organizationId, userId, dto);
        return;
      }
      case 'IMAGE': {
        const dto = await this.toDto(CreateImageTemplateDto, payload);
        const template = await this.images.create(organizationId, userId, dto);
        // Ảnh nằm ngoài DTO tạo mới (chúng là file đã upload) nên nạp ở bước hai.
        const rows = Array.isArray(payload.items) ? payload.items : [];
        const restored = await this.images.restoreItems(
          organizationId,
          template.id,
          rows as Parameters<PodImageTemplateService['restoreItems']>[2],
        );
        if (restored.skipped > 0) {
          warnings.push(
            `"${dto.name}": ${restored.skipped} ảnh không có trong tổ chức này — hãy tải mockup của bạn lên.`,
          );
        }
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

  /** Giải các tham chiếu theo tên / theo mã TikTok về id của tổ chức đích. */
  private async prepare(
    organizationId: string,
    kind: PodTemplateKind,
    raw: Record<string, unknown>,
    warnings: string[],
  ): Promise<Record<string, unknown>> {
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
        else warnings.push(`"${label}": không có kho ${warehouseCode} trong tổ chức — đã bỏ trống.`);
      }
      delete payload.tiktokWarehouseId;
    }

    if (kind === 'CATEGORY') {
      payload.sizeChartFileId = await this.keepExistingFile(
        organizationId,
        this.str(raw.sizeChartFileId),
        label,
        'size chart',
        warnings,
      );
      payload.videoFileId = await this.keepExistingFile(
        organizationId,
        this.str(raw.videoFileId),
        label,
        'video',
        warnings,
      );
    }

    if (kind === 'IMAGE') {
      // Ảnh giữ nguyên trong `payload.items`. Việc lọc bỏ file không thuộc tổ chức do
      // `PodImageTemplateService.restoreItems` làm, ngay tại chỗ ghi — kiểm tra quyền sở
      // hữu file nên nằm cạnh lệnh ghi, không rải ra hai nơi.
      delete payload.slots;
    }

    if (kind === 'LISTING') {
      const links: Array<[string, string, () => Promise<{ id: string } | null>]> = [
        [
          'categoryTemplateId',
          'Category Template',
          () =>
            this.prisma.podCategoryTemplate.findFirst({
              where: { organizationId, name: this.str(raw.categoryTemplateName) ?? '', deletedAt: null },
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
              where: { organizationId, name: this.str(raw.imageTemplateName) ?? '', deletedAt: null },
              select: { id: true },
            }),
        ],
        [
          'pricingStrategyId',
          'Pricing Strategy',
          () =>
            this.prisma.podPricingStrategy.findFirst({
              where: { organizationId, name: this.str(raw.pricingStrategyName) ?? '', deletedAt: null },
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
   * Áp lại giá / tồn / barcode của từng SKU sau khi tổ hợp đã được sinh.
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
          },
        });
      })
      .filter((update): update is NonNullable<typeof update> => update !== null);

    if (updates.length > 0) await this.prisma.$transaction(updates);

    // Gói mang bao nhiêu dòng thì bản nhập vào phải có đúng bấy nhiêu: người dùng đã xoá bớt
    // vài tổ hợp trước khi Export, nhập lại mà chúng sống dậy thì không còn là "giữ nguyên".
    const wanted = new Set(
      (rawItems as Array<Record<string, unknown>>)
        .map((item) => this.str(item.variantName))
        .filter((name): name is string => Boolean(name)),
    );
    const extra = createdItems.filter((item) => !wanted.has(item.variantName));
    if (extra.length > 0) {
      await this.prisma.podSkuTemplateItem.deleteMany({
        where: { id: { in: extra.map((item) => item.id) } },
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
  // Private — tiện ích
  // =========================================================================

  /**
   * Dựng DTO rồi chạy đúng bộ validate của API.
   * File JSON đi qua cùng một cổng kiểm tra với form trên giao diện — không có cửa sau.
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
    const existing = await this.existingFileIds(organizationId, [fileId]);
    if (existing.has(fileId)) return fileId;
    warnings.push(`"${label}": file ${what} không có trong tổ chức — đã bỏ trống.`);
    return undefined;
  }

  private async existingFileIds(
    organizationId: string,
    fileIds: string[],
  ): Promise<Set<string>> {
    const unique = [...new Set(fileIds)].filter(Boolean);
    if (unique.length === 0) return new Set();
    const rows = await this.prisma.storageFile.findMany({
      where: { id: { in: unique }, organizationId, deletedAt: null },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
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
