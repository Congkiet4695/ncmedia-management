import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PodPricingMarkupType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { resolveSkuItemPrice } from './pod-sku-price';
import {
  POD_SKU_TEMPLATE_MAX_ITEMS,
  type PodTemplateSortField,
} from '../constants/pod-listing.constants';
import type {
  BulkUpdateSkuItemsDto,
  CategoryTemplateAttributeDto,
  CreateCategoryTemplateDto,
  CreateDescriptionTemplateDto,
  CreatePricingStrategyDto,
  CreateSkuTemplateDto,
  DescriptionTemplateTokenDto,
  GenerateSkuItemsDto,
  PodTemplateQueryDto,
  PreviewDescriptionDto,
  SkuTemplateVariantDto,
  UpdateCategoryTemplateDto,
  UpdateDescriptionTemplateDto,
  UpdatePricingStrategyDto,
  UpdateSkuItemDto,
  UpdateSkuTemplateDto,
} from '../dto/pod-template.dto';
import { assertPricingFormulaValid } from './pod-pricing.formula';
import { applyTokens, findUnknownTokens, isSystemToken } from './pod-token.engine';

/** Không tìm thấy template trong Organization (hoặc đã xoá). */
export class PodTemplateNotFoundException extends NotFoundException {
  constructor(kind: string) {
    super({ code: 'POD_TEMPLATE_NOT_FOUND', message: `Không tìm thấy ${kind}` });
  }
}

/** Số tổ hợp SKU vượt trần cho phép. */
export class PodTooManySkuItemsException extends BadRequestException {
  constructor(count: number) {
    super({
      code: 'POD_SKU_TEMPLATE_TOO_MANY_ITEMS',
      message:
        `Bộ trục biến thể sinh ra ${count} SKU, vượt trần ${POD_SKU_TEMPLATE_MAX_ITEMS}. ` +
        'Hãy giảm bớt giá trị hoặc tách thành nhiều template.',
    });
  }
}

/**
 * Client Prisma dùng cho các hàm ĐỌC.
 *
 * 🔴 Khi đọc lại bản ghi vừa ghi TRONG một transaction, phải đọc bằng chính `tx` đó:
 * `this.prisma` chạy trên connection khác nên KHÔNG thấy dữ liệu chưa commit — create
 * sẽ ném NOT_FOUND, update sẽ trả về dữ liệu cũ.
 */
type PrismaReader = PrismaService | Prisma.TransactionClient;

/** Tham số phân trang + sắp xếp đã chuẩn hoá. */
interface Paging {
  page: number;
  limit: number;
  skip: number;
  sortBy: PodTemplateSortField;
  sortOrder: 'asc' | 'desc';
}

/** Trục biến thể đã làm sạch (bỏ khoảng trắng thừa, bỏ giá trị trùng). */
interface NormalizedVariant {
  name: string;
  sortOrder: number;
  values: Array<{ value: string; code: string; sortOrder: number }>;
}

/**
 * Định nghĩa thuộc tính do TikTok cấp (đọc từ `pod_category_attributes`).
 *
 * 🔴 Nguồn sự thật cho quyền nhập custom value. Cờ cùng tên trong DTO chỉ là ảnh chụp để
 * hiển thị lại đúng như lúc nhập — không phải thứ được quyền quyết định.
 */
interface AttributeDefinition {
  name: string | null;
  type: string | null;
  isRequired: boolean;
  isMultipleSelection: boolean;
  isCustomizable: boolean;
  /** Tên các giá trị chính thức — dùng để chặn nhập trùng. */
  values: string[];
}

/** Phần dữ liệu do người dùng sửa tay trên một dòng SKU — giữ lại khi tạo lại bảng. */
interface SkuItemSnapshot {
  skuCode: string | null;
  barcode: string | null;
  retailPrice: Prisma.Decimal | null;
  salePrice: Prisma.Decimal | null;
  quantity: number;
  discount: Prisma.Decimal | null;
  imageFileId: string | null;
  isActive: boolean;
}

/** Một tổ hợp SKU sẽ sinh ra. */
interface SkuCombination {
  variantName: string;
  skuCode: string;
  /** Khoá tra `${tên trục}||${giá trị}` → id của `pod_sku_template_variant_values`. */
  valueKeys: string[];
}

export const CATEGORY_TEMPLATE_INCLUDE = {
  attributes: {
    orderBy: { sortOrder: 'asc' },
    include: {
      values: { orderBy: { sortOrder: 'asc' } },
      // Giá trị tự nhập đi kèm giá trị chính thức: màn hình và bộ dựng listing đều cần cả
      // hai, tách ra hai lần truy vấn chỉ để nhập lại làm một chỗ là vô ích.
      customValues: { orderBy: { displayOrder: 'asc' } },
    },
  },
  warehouse: {
    select: { id: true, name: true, tiktokWarehouseId: true, regionCode: true },
  },
} satisfies Prisma.PodCategoryTemplateInclude;

export const SKU_TEMPLATE_INCLUDE = {
  variants: {
    orderBy: { sortOrder: 'asc' },
    include: { values: { orderBy: { sortOrder: 'asc' } } },
  },
  items: {
    orderBy: { sortOrder: 'asc' },
    include: {
      image: { select: { id: true, publicUrl: true, originalName: true } },
      values: {
        include: {
          variantValue: {
            select: {
              id: true,
              value: true,
              // `code` để Bulk Update dựng lại mã SKU theo tiền tố mà không phải đoán.
              code: true,
              variant: { select: { id: true, name: true, sortOrder: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PodSkuTemplateInclude;

export const DESCRIPTION_TEMPLATE_INCLUDE = {
  tokens: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.PodDescriptionTemplateInclude;

/**
 * PodTemplateService — CRUD cho 5 loại template nhỏ của Template Engine.
 *
 * Vì sao gom vào một service: cả năm đều là CRUD trên bảng riêng nhưng chung hệt nhau
 * năm quy tắc — (1) mọi truy vấn ràng buộc `organizationId` (ADR-004), (2) soft delete,
 * (3) chỉ MỘT bản ghi `isDefault` mỗi loại, (4) chặn xoá khi Listing Template đang dùng,
 * (5) Clone. Tách năm file chỉ để lặp lại năm quy tắc đó là DRY ngược.
 *
 * Nghiệp vụ THỰC SỰ khác nhau thì nằm ở method riêng: sinh tổ hợp SKU, cập nhật hàng
 * loạt, kiểm tra công thức giá, thay token mô tả.
 */
@Injectable()
export class PodTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Category Template
  // =========================================================================

  async listCategoryTemplates(organizationId: string, query: PodTemplateQueryDto) {
    const paging = this.paging(query);
    const where: Prisma.PodCategoryTemplateWhereInput = {
      ...this.baseWhere(organizationId, query),
      ...(query.market ? { market: query.market } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podCategoryTemplate.findMany({
        where,
        include: {
          ...CATEGORY_TEMPLATE_INCLUDE,
          _count: { select: { listingTemplates: true } },
        },
        orderBy: this.orderBy(paging),
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.podCategoryTemplate.count({ where }),
    ]);

    return this.paginated(items, total, paging);
  }

  async getCategoryTemplate(organizationId: string, id: string, client: PrismaReader = this.prisma) {
    const template = await client.podCategoryTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: CATEGORY_TEMPLATE_INCLUDE,
    });
    if (!template) throw new PodTemplateNotFoundException('Category Template');
    return template;
  }

  async createCategoryTemplate(
    organizationId: string,
    userId: string,
    dto: CreateCategoryTemplateDto,
  ) {
    await this.assertWarehouseBelongsToOrg(organizationId, dto.warehouseId);
    await this.assertFilesBelongToOrg(
      organizationId,
      [dto.sizeChartFileId, dto.videoFileId].filter((id): id is string => Boolean(id)),
    );

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearCategoryDefault(tx, organizationId, dto.market);

      const { attributes, ...data } = dto;
      const template = await tx.podCategoryTemplate.create({
        data: { ...data, organizationId, createdBy: userId },
        select: { id: true },
      });

      await this.writeCategoryAttributes(
        tx,
        organizationId,
        template.id,
        dto.tiktokCategoryId,
        attributes,
      );
      return this.getCategoryTemplate(organizationId, template.id, tx);
    });
  }

  async updateCategoryTemplate(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdateCategoryTemplateDto,
  ) {
    const existing = await this.getCategoryTemplate(organizationId, id);
    await this.assertWarehouseBelongsToOrg(organizationId, dto.warehouseId);
    await this.assertFilesBelongToOrg(
      organizationId,
      [dto.sizeChartFileId, dto.videoFileId].filter((value): value is string => Boolean(value)),
    );

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearCategoryDefault(tx, organizationId, dto.market, id);

      const { attributes, ...data } = dto;
      await tx.podCategoryTemplate.update({
        where: { id },
        data: { ...data, isActive: dto.isActive ?? true, updatedBy: userId },
      });

      // Thuộc tính: **chỉ đụng tới khi request có gửi lên**.
      //
      // 🔴 Không gửi `attributes` nghĩa là "không sửa phần này" — đúng ngữ nghĩa của PATCH.
      // Trước đây mọi lần cập nhật đều xoá sạch rồi ghi lại, nên một request chỉ đổi tên
      // template cũng thổi bay toàn bộ giá trị thuộc tính đã chọn.
      //
      // Gửi lên thì ghi đè TRỌN BỘ: danh mục đổi ⇒ bộ thuộc tính đổi hoàn toàn, merge từng
      // phần sẽ để sót giá trị của danh mục cũ.
      if (attributes !== undefined) {
        await tx.podCategoryTemplateAttribute.deleteMany({ where: { categoryTemplateId: id } });
        await this.writeCategoryAttributes(
          tx,
          organizationId,
          id,
          // Request chỉ sửa thuộc tính (không gửi lại danh mục) vẫn phải đối chiếu được với
          // đúng định nghĩa TikTok ⇒ rơi về danh mục đang lưu.
          dto.tiktokCategoryId ?? existing.tiktokCategoryId,
          attributes,
        );
      }

      return this.getCategoryTemplate(organizationId, id, tx);
    });
  }

  async cloneCategoryTemplate(organizationId: string, userId: string, id: string, name?: string) {
    const source = await this.getCategoryTemplate(organizationId, id);

    return this.createCategoryTemplate(organizationId, userId, {
      name: name?.trim() || `${source.name} (copy)`,
      market: source.market,
      tiktokCategoryId: source.tiktokCategoryId,
      categoryName: source.categoryName ?? undefined,
      categoryPath: source.categoryPath ?? undefined,
      tiktokBrandId: source.tiktokBrandId ?? undefined,
      brandName: source.brandName ?? undefined,
      warehouseId: source.warehouseId ?? undefined,
      packageWeight: source.packageWeight ?? undefined,
      weightUnit: source.weightUnit ?? undefined,
      packageLength: source.packageLength ?? undefined,
      packageWidth: source.packageWidth ?? undefined,
      packageHeight: source.packageHeight ?? undefined,
      dimensionUnit: source.dimensionUnit ?? undefined,
      sizeChartFileId: source.sizeChartFileId ?? undefined,
      videoFileId: source.videoFileId ?? undefined,
      displayOrder: source.displayOrder,
      note: source.note ?? undefined,
      // Bản sao KHÔNG kế thừa cờ mặc định: hai template cùng là mặc định thì cái nào thắng?
      isDefault: false,
      attributes: source.attributes.map((attribute) => ({
        tiktokAttributeId: attribute.tiktokAttributeId,
        attributeName: attribute.attributeName ?? undefined,
        attributeType: attribute.attributeType ?? undefined,
        isRequired: attribute.isRequired,
        isMultipleSelection: attribute.isMultipleSelection,
        isCustomizable: attribute.isCustomizable,
        customValues: attribute.customValues.map((custom) => custom.value),
        sortOrder: attribute.sortOrder,
        values: attribute.values.map((value) => ({
          tiktokValueId: value.tiktokValueId,
          valueName: value.valueName ?? undefined,
        })),
      })),
    });
  }

  async removeCategoryTemplate(organizationId: string, userId: string, id: string): Promise<void> {
    await this.getCategoryTemplate(organizationId, id);
    await this.ensureNotUsedByListingTemplate(organizationId, { categoryTemplateId: id });
    await this.prisma.podCategoryTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  // =========================================================================
  // SKU Template
  // =========================================================================

  async listSkuTemplates(organizationId: string, query: PodTemplateQueryDto) {
    const paging = this.paging(query);
    const where = this.baseWhere(organizationId, query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podSkuTemplate.findMany({
        where,
        include: {
          variants: {
            orderBy: { sortOrder: 'asc' },
            include: { values: { orderBy: { sortOrder: 'asc' } } },
          },
          _count: { select: { items: true, listingTemplates: true } },
        },
        orderBy: this.orderBy(paging),
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.podSkuTemplate.count({ where }),
    ]);

    return this.paginated(items.map((item) => this.withSkuStatus(item)), total, paging);
  }

  async getSkuTemplate(organizationId: string, id: string, client: PrismaReader = this.prisma) {
    const template = await client.podSkuTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: SKU_TEMPLATE_INCLUDE,
    });
    if (!template) throw new PodTemplateNotFoundException('SKU Template');
    return this.withSkuStatus(this.withEffectivePrice(template));
  }

  /**
   * Gắn thêm trạng thái sinh SKU vào bản ghi đọc ra.
   *
   * `expectedItemCount` = tích số giá trị của các trục — chính con số "Color (3) × Size (6)
   * = 18 SKU" mà màn hình hiển thị. `isStale` = trục đã đổi sau lần Tạo SKU gần nhất.
   * Tính ở server để màn hình và engine không bao giờ nói hai điều khác nhau.
   */
  /**
   * `0` ở ô giá nghĩa là **CHƯA ĐẶT**, không phải "bán 0 đồng".
   *
   * 🔴 Lưới SKU gửi `Number('')` cho ô để trống — ra đúng số `0`. Lưu nguyên 0 thì tổ hợp đó
   * mang một "giá hợp lệ" bằng 0, che mất mọi phương án dự phòng (giá gốc − giảm giá, Pricing
   * Template) và bị cổng validate chặn với thông điệp "chưa có giá bán hợp lệ". Đổi về NULL
   * ngay tại cửa ghi để dữ liệu trong bảng luôn nói đúng ý người dùng.
   */
  private normalizePriceFields(dto: {
    retailPrice?: number | null;
    salePrice?: number | null;
    discount?: number | null;
  }): Record<string, number | null> {
    const normalized: Record<string, number | null> = {};
    for (const field of ['retailPrice', 'salePrice', 'discount'] as const) {
      const value = dto[field];
      if (value === undefined) continue;
      normalized[field] = value === null || value <= 0 ? null : value;
    }
    return normalized;
  }

  /**
   * Gắn **giá bán hiệu lực** vào từng tổ hợp SKU.
   *
   * Màn hình phải hiện đúng con số mà engine sẽ gửi lên TikTok. Tính ở server bằng CHÍNH hàm
   * mà bộ giải listing dùng (`resolveSkuItemPrice`) — không để frontend tự tính lại theo một
   * quy tắc riêng rồi hai bên nói hai con số khác nhau.
   */
  private withEffectivePrice<
    T extends {
      items?: Array<{
        retailPrice: Prisma.Decimal | null;
        salePrice: Prisma.Decimal | null;
        discount: Prisma.Decimal | null;
      }>;
    },
  >(template: T): T {
    if (!template.items) return template;

    return {
      ...template,
      items: template.items.map((item) => {
        const price = resolveSkuItemPrice(item);
        return {
          ...item,
          effectiveSalePrice: price.salePrice,
          effectiveRetailPrice: price.retailPrice,
          priceSource: price.source,
        };
      }),
    };
  }

  private withSkuStatus<
    T extends {
      axesUpdatedAt: Date;
      itemsGeneratedAt: Date | null;
      variants: Array<{ values: unknown[] }>;
    },
  >(template: T): T & { expectedItemCount: number; isStale: boolean } {
    const expectedItemCount = template.variants.length
      ? template.variants.reduce((product, variant) => product * variant.values.length, 1)
      : 0;

    return {
      ...template,
      expectedItemCount,
      isStale:
        template.itemsGeneratedAt === null ||
        template.axesUpdatedAt.getTime() > template.itemsGeneratedAt.getTime(),
    };
  }

  /**
   * Tạo SKU Template — **chỉ ghi trục biến thể**, KHÔNG sinh tổ hợp.
   *
   * 🔴 Sinh SKU là hành động riêng, do người dùng bấm "Tạo SKU" (`generateSkuItems`).
   * Xem `PodSkuTemplate.axesUpdatedAt` trong schema để biết vì sao tách.
   */
  async createSkuTemplate(organizationId: string, userId: string, dto: CreateSkuTemplateDto) {
    const variants = this.normalizeVariants(dto.variants);
    this.assertCombinationCount(variants);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, 'podSkuTemplate', organizationId);

      const template = await tx.podSkuTemplate.create({
        data: {
          organizationId,
          name: dto.name,
          skuPrefix: dto.skuPrefix,
          skuSuffix: dto.skuSuffix,
          defaultRetailPrice: dto.defaultRetailPrice,
          defaultSalePrice: dto.defaultSalePrice,
          defaultQuantity: dto.defaultQuantity ?? 0,
          defaultDiscount: dto.defaultDiscount,
          currency: dto.currency ?? 'USD',
          isDefault: dto.isDefault ?? false,
          displayOrder: dto.displayOrder ?? 0,
          note: dto.note,
          axesUpdatedAt: new Date(),
          createdBy: userId,
        },
        select: { id: true },
      });

      await this.writeAxes(tx, organizationId, template.id, variants);
      return this.getSkuTemplate(organizationId, template.id, tx);
    });
  }

  /**
   * Cập nhật SKU Template.
   *
   * 🔴 KHÔNG sinh lại tổ hợp. Trục đổi ⇒ chỉ dời mốc `axesUpdatedAt`, bảng SKU giữ nguyên và
   * màn hình hiện cảnh báo "Variant đã thay đổi, hãy tạo lại SKU". Tự sinh lại ở đây là cách
   * chắc chắn nhất để xoá sạch giá/tồn người dùng vừa nhập tay cho hàng chục dòng.
   *
   * Trục KHÔNG đổi (chỉ sửa tên template, giá mặc định…) thì không đụng vào trục, cũng không
   * dời mốc — sửa một cái tên không nên biến cả bảng SKU thành "đã cũ".
   */
  async updateSkuTemplate(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdateSkuTemplateDto,
  ) {
    const existing = await this.getSkuTemplate(organizationId, id);
    const variants = this.normalizeVariants(dto.variants);
    this.assertCombinationCount(variants);
    const axesChanged = !this.sameAxes(existing.variants, variants);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, 'podSkuTemplate', organizationId, id);

      await tx.podSkuTemplate.update({
        where: { id },
        data: {
          name: dto.name,
          skuPrefix: dto.skuPrefix,
          skuSuffix: dto.skuSuffix,
          defaultRetailPrice: dto.defaultRetailPrice,
          defaultSalePrice: dto.defaultSalePrice,
          defaultQuantity: dto.defaultQuantity ?? 0,
          defaultDiscount: dto.defaultDiscount,
          currency: dto.currency ?? 'USD',
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          displayOrder: dto.displayOrder ?? 0,
          note: dto.note,
          ...(axesChanged ? { axesUpdatedAt: new Date() } : {}),
          updatedBy: userId,
        },
      });

      if (axesChanged) {
        // Xoá trục: cascade cuốn theo giá trị trục và bảng nối. Bảng SKU (`items`) KHÔNG bị
        // đụng — dòng cũ vẫn còn nguyên giá/tồn, chỉ mất liên kết trục cho tới lần tạo lại.
        await tx.podSkuTemplateVariant.deleteMany({ where: { skuTemplateId: id } });
        await this.writeAxes(tx, organizationId, id, variants);
      }

      return this.getSkuTemplate(organizationId, id, tx);
    });
  }

  /**
   * **Tạo SKU** — sinh toàn bộ tổ hợp từ trục biến thể đang lưu.
   *
   * Đây là nơi DUY NHẤT ghi vào `pod_sku_template_items`. Mặc định giữ lại giá / tồn /
   * barcode / ảnh của tổ hợp trùng tên (thêm một màu mới không được xoá bảng giá của 40 dòng
   * cũ); `resetEdits = true` mới dựng lại từ giá trị mặc định.
   */
  async generateSkuItems(
    organizationId: string,
    userId: string,
    id: string,
    dto: GenerateSkuItemsDto = {},
  ) {
    const existing = await this.getSkuTemplate(organizationId, id);
    const variants = this.normalizeVariants(
      existing.variants.map((variant) => ({
        name: variant.name,
        sortOrder: variant.sortOrder,
        values: variant.values.map((value) => ({
          value: value.value,
          code: value.code ?? undefined,
          sortOrder: value.sortOrder,
        })),
      })),
    );
    const combinations = this.buildCombinations(variants);
    const previous = dto.resetEdits
      ? new Map<string, SkuItemSnapshot>()
      : new Map(existing.items.map((item) => [item.variantName, item]));

    return this.prisma.$transaction(async (tx) => {
      await tx.podSkuTemplateItem.deleteMany({ where: { skuTemplateId: id } });
      await this.writeSkuItems(tx, organizationId, id, combinations, existing, previous);

      await tx.podSkuTemplate.update({
        where: { id },
        data: { itemsGeneratedAt: new Date(), updatedBy: userId },
      });

      return this.getSkuTemplate(organizationId, id, tx);
    });
  }

  /** Xoá MỘT tổ hợp SKU. Trục biến thể giữ nguyên — chỉ dòng đó biến mất. */
  async removeSkuItem(organizationId: string, templateId: string, itemId: string) {
    await this.getSkuTemplate(organizationId, templateId);

    const deleted = await this.prisma.podSkuTemplateItem.deleteMany({
      where: { id: itemId, skuTemplateId: templateId, organizationId },
    });
    if (deleted.count === 0) throw new PodTemplateNotFoundException('SKU');

    return this.getSkuTemplate(organizationId, templateId);
  }

  async cloneSkuTemplate(organizationId: string, userId: string, id: string, name?: string) {
    const source = await this.getSkuTemplate(organizationId, id);

    const clone = await this.createSkuTemplate(organizationId, userId, {
      name: name?.trim() || `${source.name} (copy)`,
      variants: source.variants.map((variant) => ({
        name: variant.name,
        sortOrder: variant.sortOrder,
        values: variant.values.map((value) => ({
          value: value.value,
          code: value.code ?? undefined,
          sortOrder: value.sortOrder,
        })),
      })),
      skuPrefix: source.skuPrefix ?? undefined,
      skuSuffix: source.skuSuffix ?? undefined,
      defaultRetailPrice: this.toNumber(source.defaultRetailPrice),
      defaultSalePrice: this.toNumber(source.defaultSalePrice),
      defaultQuantity: source.defaultQuantity,
      defaultDiscount: this.toNumber(source.defaultDiscount),
      currency: source.currency ?? undefined,
      displayOrder: source.displayOrder,
      note: source.note ?? undefined,
      isDefault: false,
    });

    // Bản gốc đã bấm "Tạo SKU" thì bản sao cũng phải có sẵn bảng SKU — bắt người dùng bấm
    // lại trên bản sao là biến Clone thành "tạo mới có sẵn tên".
    if (source.items.length === 0) return clone;
    const generated = await this.generateSkuItems(organizationId, userId, clone.id);

    // Giá / tồn / barcode / ảnh đã sửa tay ở từng dòng phải theo sang bản sao — bản sao
    // mà mất bảng giá thì "Clone" không tiết kiệm được gì.
    const bySourceName = new Map(source.items.map((item) => [item.variantName, item]));
    await this.prisma.$transaction(
      generated.items
        .filter((item) => bySourceName.has(item.variantName))
        .map((item) => {
          const origin = bySourceName.get(item.variantName)!;
          return this.prisma.podSkuTemplateItem.update({
            where: { id: item.id },
            data: {
              skuCode: origin.skuCode,
              barcode: origin.barcode,
              retailPrice: origin.retailPrice,
              salePrice: origin.salePrice,
              quantity: origin.quantity,
              discount: origin.discount,
              imageFileId: origin.imageFileId,
              isActive: origin.isActive,
            },
          });
        }),
    );

    return this.getSkuTemplate(organizationId, clone.id);
  }

  async updateSkuItem(
    organizationId: string,
    templateId: string,
    itemId: string,
    dto: UpdateSkuItemDto,
  ) {
    await this.getSkuTemplate(organizationId, templateId);
    if (dto.imageFileId) await this.assertFilesBelongToOrg(organizationId, [dto.imageFileId]);

    const item = await this.prisma.podSkuTemplateItem.findFirst({
      where: { id: itemId, skuTemplateId: templateId, organizationId },
      select: { id: true },
    });
    if (!item) throw new PodTemplateNotFoundException('SKU');

    await this.prisma.podSkuTemplateItem.update({
      where: { id: itemId },
      data: { ...dto, ...this.normalizePriceFields(dto) },
    });
    return this.getSkuTemplate(organizationId, templateId);
  }

  /**
   * Cập nhật hàng loạt tổ hợp.
   *
   * Ba cách chọn dòng, dùng chồng lên nhau được:
   *  - `itemIds` — người dùng tick chọn từng dòng
   *  - `filters` — theo giá trị trục ("chỉ sửa Color = Black"): cùng trục là **HOẶC**, khác
   *    trục là **VÀ** (Black ∨ White) ∧ (XL) — cùng quy ước với phạm vi Listing Template
   *  - không truyền gì — áp cho TẤT CẢ
   *
   * `skuPrefix` / `barcodePrefix` phải ghi từng dòng (mỗi dòng một giá trị khác nhau) nên
   * không dùng `updateMany` được; các trường còn lại thì một câu `updateMany` là xong.
   */
  async bulkUpdateSkuItems(
    organizationId: string,
    templateId: string,
    dto: BulkUpdateSkuItemsDto,
  ) {
    const template = await this.getSkuTemplate(organizationId, templateId);

    const { itemIds, filters, skuPrefix, barcodePrefix, ...values } = dto;
    // Chỉ ghi những trường thực sự được gửi lên — tránh vô tình xoá giá bằng `undefined`.
    const data = {
      ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
      ...this.normalizePriceFields(values),
    };

    const targets = this.matchSkuItems(template.items, filters, itemIds);
    if (targets.length === 0) return template;

    if (Object.keys(data).length > 0) {
      await this.prisma.podSkuTemplateItem.updateMany({
        where: { id: { in: targets.map((item) => item.id) }, organizationId },
        data,
      });
    }

    if (skuPrefix !== undefined || barcodePrefix !== undefined) {
      await this.prisma.$transaction(
        targets.map((item, index) =>
          this.prisma.podSkuTemplateItem.update({
            where: { id: item.id },
            data: {
              // Hậu tố dựng lại từ chính giá trị trục của dòng ⇒ bấm Apply nhiều lần vẫn ra
              // một kết quả, không cộng dồn tiền tố lên mã cũ.
              ...(skuPrefix !== undefined
                ? { skuCode: this.composeSkuCode(skuPrefix, item) }
                : {}),
              ...(barcodePrefix !== undefined
                ? { barcode: barcodePrefix ? `${barcodePrefix}${String(index + 1).padStart(4, '0')}` : null }
                : {}),
            },
          }),
        ),
      );
    }

    return this.getSkuTemplate(organizationId, templateId);
  }

  /** Lọc dòng SKU theo `itemIds` và/hoặc điều kiện trục. */
  private matchSkuItems<
    T extends {
      id: string;
      values: Array<{ variantValue: { value: string; variant: { name: string } } }>;
    },
  >(
    items: T[],
    filters: BulkUpdateSkuItemsDto['filters'],
    itemIds: string[] | undefined,
  ): T[] {
    const byId = itemIds?.length ? new Set(itemIds) : null;

    // Gom điều kiện theo tên trục để "cùng trục = HOẶC" thành phép kiểm tra một lần.
    const wanted = new Map<string, Set<string>>();
    for (const filter of filters ?? []) {
      const key = filter.variantName.trim().toLowerCase();
      const set = wanted.get(key) ?? new Set<string>();
      set.add(filter.value.trim().toLowerCase());
      wanted.set(key, set);
    }

    return items.filter((item) => {
      if (byId && !byId.has(item.id)) return false;
      if (wanted.size === 0) return true;

      for (const [axis, allowed] of wanted) {
        const hit = item.values.some(
          (link) =>
            link.variantValue.variant.name.trim().toLowerCase() === axis &&
            allowed.has(link.variantValue.value.trim().toLowerCase()),
        );
        if (!hit) return false;
      }
      return true;
    });
  }

  /** `{prefix}-{mã tổ hợp}`; bỏ trống tiền tố thì trả về mã tổ hợp trần. */
  private composeSkuCode(
    prefix: string,
    item: { values: Array<{ variantValue: { value: string; code?: string | null } }> },
  ): string {
    const suffix = item.values
      .map((link) => link.variantValue.code?.trim() || this.shortCode(link.variantValue.value))
      .join('-');
    return [prefix.trim(), suffix].filter(Boolean).join('-');
  }

  async removeSkuTemplate(organizationId: string, userId: string, id: string): Promise<void> {
    await this.getSkuTemplate(organizationId, id);
    await this.ensureNotUsedByListingTemplate(organizationId, { skuTemplateId: id });
    await this.prisma.podSkuTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  // =========================================================================
  // Description Template
  // =========================================================================

  async listDescriptionTemplates(organizationId: string, query: PodTemplateQueryDto) {
    const paging = this.paging(query);
    const where = this.baseWhere(organizationId, query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podDescriptionTemplate.findMany({
        where,
        include: {
          ...DESCRIPTION_TEMPLATE_INCLUDE,
          _count: { select: { listingTemplates: true } },
        },
        orderBy: this.orderBy(paging),
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.podDescriptionTemplate.count({ where }),
    ]);

    return this.paginated(items, total, paging);
  }

  async getDescriptionTemplate(
    organizationId: string,
    id: string,
    client: PrismaReader = this.prisma,
  ) {
    const template = await client.podDescriptionTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: DESCRIPTION_TEMPLATE_INCLUDE,
    });
    if (!template) throw new PodTemplateNotFoundException('Description Template');
    return template;
  }

  async createDescriptionTemplate(
    organizationId: string,
    userId: string,
    dto: CreateDescriptionTemplateDto,
  ) {
    const tokens = this.normalizeTokens(dto.tokens);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, 'podDescriptionTemplate', organizationId);

      const created = await tx.podDescriptionTemplate.create({
        data: {
          organizationId,
          name: dto.name,
          contentHtml: dto.contentHtml,
          isDefault: dto.isDefault ?? false,
          displayOrder: dto.displayOrder ?? 0,
          note: dto.note,
          createdBy: userId,
          tokens: { createMany: { data: tokens.map((token) => ({ ...token, organizationId })) } },
        },
        select: { id: true },
      });

      return this.getDescriptionTemplate(organizationId, created.id, tx);
    });
  }

  async updateDescriptionTemplate(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdateDescriptionTemplateDto,
  ) {
    await this.getDescriptionTemplate(organizationId, id);
    const tokens = this.normalizeTokens(dto.tokens);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, 'podDescriptionTemplate', organizationId, id);

      await tx.podDescriptionTemplate.update({
        where: { id },
        data: {
          name: dto.name,
          contentHtml: dto.contentHtml,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          displayOrder: dto.displayOrder ?? 0,
          note: dto.note,
          updatedBy: userId,
        },
      });

      await tx.podDescriptionTemplateToken.deleteMany({ where: { descriptionTemplateId: id } });
      if (tokens.length > 0) {
        await tx.podDescriptionTemplateToken.createMany({
          data: tokens.map((token) => ({ ...token, organizationId, descriptionTemplateId: id })),
        });
      }

      return this.getDescriptionTemplate(organizationId, id, tx);
    });
  }

  async cloneDescriptionTemplate(
    organizationId: string,
    userId: string,
    id: string,
    name?: string,
  ) {
    const source = await this.getDescriptionTemplate(organizationId, id);

    return this.createDescriptionTemplate(organizationId, userId, {
      name: name?.trim() || `${source.name} (copy)`,
      contentHtml: source.contentHtml,
      displayOrder: source.displayOrder,
      note: source.note ?? undefined,
      isDefault: false,
      tokens: source.tokens.map((token) => ({
        code: token.code,
        label: token.label ?? undefined,
        value: token.value,
        sortOrder: token.sortOrder,
      })),
    });
  }

  async removeDescriptionTemplate(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    await this.getDescriptionTemplate(organizationId, id);
    await this.ensureNotUsedByListingTemplate(organizationId, { descriptionTemplateId: id });
    await this.prisma.podDescriptionTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  /**
   * Xem trước mô tả sau khi thay token — **không ghi gì vào database**.
   *
   * Trả kèm `unknownTokens` để người dùng thấy ngay `{{MATERAIL}}` viết sai, thay vì phát
   * hiện khi listing đã lên sàn với một chỗ trống giữa bài.
   */
  async previewDescription(organizationId: string, dto: PreviewDescriptionDto) {
    const tokens = this.normalizeTokens(dto.tokens);
    const product = dto.productId
      ? await this.prisma.podProduct.findFirst({
          where: { id: dto.productId, organizationId, deletedAt: null },
          select: {
            title: true,
            description: true,
            categoryName: true,
            brandName: true,
            variants: { select: { sellerSku: true }, take: 1 },
          },
        })
      : null;

    const values: Record<string, string> = {
      'PRODUCT.TITLE': product?.title ?? '',
      'PRODUCT.DESCRIPTION': product?.description ?? '',
      'PRODUCT.SELLER_SKU': product?.variants?.[0]?.sellerSku ?? '',
      'PRODUCT.CATEGORY': product?.categoryName ?? '',
      'PRODUCT.BRAND': product?.brandName ?? '',
      'SHOP.NAME': '',
      'TEMPLATE.NAME': '',
      'VARIANT.NAME': '',
      ...Object.fromEntries(tokens.map((token) => [token.code, token.value])),
    };

    return {
      html: applyTokens(dto.contentHtml, values),
      unknownTokens: findUnknownTokens(
        dto.contentHtml,
        tokens.map((token) => token.code),
      ),
    };
  }

  // =========================================================================
  // Pricing Strategy
  // =========================================================================

  async listPricingStrategies(organizationId: string, query: PodTemplateQueryDto) {
    const paging = this.paging(query);
    const where = this.baseWhere(organizationId, query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podPricingStrategy.findMany({
        where,
        include: { _count: { select: { listingTemplates: true } } },
        orderBy: this.orderBy(paging),
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.podPricingStrategy.count({ where }),
    ]);

    return this.paginated(items, total, paging);
  }

  async getPricingStrategy(organizationId: string, id: string) {
    const strategy = await this.prisma.podPricingStrategy.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!strategy) throw new PodTemplateNotFoundException('Pricing Strategy');
    return strategy;
  }

  async createPricingStrategy(
    organizationId: string,
    userId: string,
    dto: CreatePricingStrategyDto,
  ) {
    this.assertPricingDtoValid(dto);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, 'podPricingStrategy', organizationId);
      return tx.podPricingStrategy.create({
        data: { ...dto, organizationId, createdBy: userId },
      });
    });
  }

  async updatePricingStrategy(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdatePricingStrategyDto,
  ) {
    await this.getPricingStrategy(organizationId, id);
    this.assertPricingDtoValid(dto);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, 'podPricingStrategy', organizationId, id);
      return tx.podPricingStrategy.update({
        where: { id },
        data: { ...dto, isActive: dto.isActive ?? true, updatedBy: userId },
      });
    });
  }

  async clonePricingStrategy(organizationId: string, userId: string, id: string, name?: string) {
    const source = await this.getPricingStrategy(organizationId, id);

    return this.createPricingStrategy(organizationId, userId, {
      name: name?.trim() || `${source.name} (copy)`,
      cost: Number(source.cost),
      shippingCost: Number(source.shippingCost),
      markupType: source.markupType,
      markupValue: Number(source.markupValue),
      formula: source.formula ?? undefined,
      retailPriceMultiplier: Number(source.retailPriceMultiplier),
      discountPercent: Number(source.discountPercent),
      roundingIncrement: Number(source.roundingIncrement),
      currency: source.currency,
      displayOrder: source.displayOrder,
      note: source.note ?? undefined,
      isDefault: false,
    });
  }

  async removePricingStrategy(organizationId: string, userId: string, id: string): Promise<void> {
    await this.getPricingStrategy(organizationId, id);
    await this.ensureNotUsedByListingTemplate(organizationId, { pricingStrategyId: id });
    await this.prisma.podPricingStrategy.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  // =========================================================================
  // Private — SKU
  // =========================================================================

  /** Bỏ khoảng trắng thừa, bỏ trục rỗng và giá trị trùng (phân biệt hoa/thường). */
  /**
   * Làm sạch và **kiểm tra nghiêm** bộ trục biến thể.
   *
   * 🔴 Trục rỗng / trùng tên / giá trị trùng đều bị **từ chối**, không im lặng bỏ qua. Bỏ qua
   * lặng lẽ nghĩa là người dùng gõ "Color" hai lần rồi ngồi tự hỏi vì sao sinh ra 4 SKU chứ
   * không phải 8 — báo lỗi ngay ở chỗ họ vừa gõ thì sửa được.
   */
  private normalizeVariants(variants: SkuTemplateVariantDto[]): NormalizedVariant[] {
    const seenNames = new Set<string>();
    const normalized: NormalizedVariant[] = [];

    variants.forEach((variant, index) => {
      const name = variant.name.trim();
      if (!name) {
        throw new BadRequestException({
          code: 'POD_SKU_TEMPLATE_VARIANT_EMPTY',
          message: `Trục biến thể thứ ${index + 1} chưa có tên.`,
        });
      }
      if (seenNames.has(name.toLowerCase())) {
        throw new BadRequestException({
          code: 'POD_SKU_TEMPLATE_VARIANT_DUPLICATE',
          message: `Trục biến thể "${name}" bị khai báo hai lần.`,
        });
      }
      seenNames.add(name.toLowerCase());

      const seenValues = new Set<string>();
      const values: NormalizedVariant['values'] = [];
      variant.values.forEach((entry, valueIndex) => {
        const value = entry.value.trim();
        if (!value) {
          throw new BadRequestException({
            code: 'POD_SKU_TEMPLATE_VALUE_EMPTY',
            message: `Trục "${name}" có giá trị để trống.`,
          });
        }
        if (seenValues.has(value.toLowerCase())) {
          throw new BadRequestException({
            code: 'POD_SKU_TEMPLATE_VALUE_DUPLICATE',
            message: `Trục "${name}" có giá trị "${value}" lặp lại.`,
          });
        }
        seenValues.add(value.toLowerCase());
        values.push({
          value,
          code: (entry.code?.trim() || this.shortCode(value)).toUpperCase(),
          sortOrder: entry.sortOrder ?? valueIndex,
        });
      });

      if (values.length === 0) {
        throw new BadRequestException({
          code: 'POD_SKU_TEMPLATE_VARIANT_NO_VALUE',
          message: `Trục "${name}" chưa có giá trị nào.`,
        });
      }
      normalized.push({ name, sortOrder: variant.sortOrder ?? index, values });
    });

    if (normalized.length === 0) {
      throw new BadRequestException({
        code: 'POD_SKU_TEMPLATE_NO_VARIANT',
        message: 'Cần ít nhất một trục biến thể có giá trị (vd Color: Black, White).',
      });
    }
    return normalized;
  }

  /**
   * Sinh TOÀN BỘ tổ hợp từ các trục (tích Descartes).
   * `[Color: Black, White] × [Size: S, M]` ⇒ Black/S · Black/M · White/S · White/M.
   */
  private buildCombinations(variants: NormalizedVariant[]): SkuCombination[] {
    const total = variants.reduce((product, variant) => product * variant.values.length, 1);
    if (total > POD_SKU_TEMPLATE_MAX_ITEMS) throw new PodTooManySkuItemsException(total);

    let combos: Array<Array<{ variantName: string; value: string; code: string }>> = [[]];
    for (const variant of variants) {
      combos = combos.flatMap((combo) =>
        variant.values.map((entry) => [
          ...combo,
          { variantName: variant.name, value: entry.value, code: entry.code },
        ]),
      );
    }

    return combos.map((combo) => ({
      variantName: combo.map((entry) => entry.value).join(' / '),
      skuCode: combo.map((entry) => entry.code).join('-'),
      valueKeys: combo.map((entry) => this.valueKey(entry.variantName, entry.value)),
    }));
  }

  /**
   * Ghi trục → giá trị trục → tổ hợp → bảng nối.
   *
   * `previous` giữ dữ liệu người dùng đã sửa tay ở lần trước (khoá theo tên tổ hợp) để
   * lần sinh lại không xoá mất bảng giá.
   */
  /** Ghi trục + giá trị trục. KHÔNG đụng tới bảng SKU. */
  private async writeAxes(
    tx: Prisma.TransactionClient,
    organizationId: string,
    skuTemplateId: string,
    variants: NormalizedVariant[],
  ): Promise<void> {
    for (const variant of variants) {
      const created = await tx.podSkuTemplateVariant.create({
        data: {
          organizationId,
          skuTemplateId,
          name: variant.name,
          sortOrder: variant.sortOrder,
        },
        select: { id: true },
      });

      await tx.podSkuTemplateVariantValue.createMany({
        data: variant.values.map((entry) => ({
          organizationId,
          variantId: created.id,
          value: entry.value,
          code: entry.code,
          sortOrder: entry.sortOrder,
        })),
      });
    }
  }

  /**
   * Ghi bảng SKU + bảng nối tổ hợp ⇄ giá trị trục.
   *
   * Giá trị mặc định (giá / tồn / giảm giá) lấy từ chính template — người dùng khai báo một
   * lần ở phần "Giá trị mặc định", mọi tổ hợp sinh ra đều nhận.
   */
  private async writeSkuItems(
    tx: Prisma.TransactionClient,
    organizationId: string,
    skuTemplateId: string,
    combinations: SkuCombination[],
    defaults: {
      defaultRetailPrice: Prisma.Decimal | null;
      defaultSalePrice: Prisma.Decimal | null;
      defaultQuantity: number;
      defaultDiscount: Prisma.Decimal | null;
    },
    previous: Map<string, SkuItemSnapshot>,
  ): Promise<void> {
    // Trục đã nằm sẵn trong DB ⇒ đọc id giá trị trục để nối, không tạo lại.
    const valueIdByKey = new Map<string, string>();
    const rows = await tx.podSkuTemplateVariantValue.findMany({
      where: { variant: { skuTemplateId } },
      select: { id: true, value: true, variant: { select: { name: true } } },
    });
    for (const row of rows) {
      valueIdByKey.set(this.valueKey(row.variant.name, row.value), row.id);
    }

    const items = await tx.podSkuTemplateItem.createManyAndReturn({
      data: combinations.map((combo, index) => {
        const kept = previous.get(combo.variantName);
        return {
          organizationId,
          skuTemplateId,
          variantName: combo.variantName,
          skuCode: kept?.skuCode ?? combo.skuCode,
          barcode: kept?.barcode ?? null,
          retailPrice: kept?.retailPrice ?? defaults.defaultRetailPrice ?? null,
          salePrice: kept?.salePrice ?? defaults.defaultSalePrice ?? null,
          quantity: kept?.quantity ?? defaults.defaultQuantity,
          discount: kept?.discount ?? defaults.defaultDiscount ?? null,
          imageFileId: kept?.imageFileId ?? null,
          isActive: kept?.isActive ?? true,
          sortOrder: index,
        };
      }),
      select: { id: true, variantName: true },
    });

    // Bảng nối tổ hợp ⇄ giá trị trục (thay cho mảng JSON của thiết kế cũ).
    const itemIdByName = new Map(items.map((item) => [item.variantName, item.id]));
    const links: Prisma.PodSkuTemplateItemValueCreateManyInput[] = [];
    for (const combo of combinations) {
      const itemId = itemIdByName.get(combo.variantName);
      if (!itemId) continue;
      for (const key of combo.valueKeys) {
        const variantValueId = valueIdByKey.get(key);
        if (variantValueId) links.push({ organizationId, itemId, variantValueId });
      }
    }
    if (links.length > 0) await tx.podSkuTemplateItemValue.createMany({ data: links });
  }

  /** Bộ trục có thật sự đổi không — so tên trục, thứ tự và toàn bộ giá trị. */
  private sameAxes(
    current: Array<{ name: string; values: Array<{ value: string; code: string | null }> }>,
    next: NormalizedVariant[],
  ): boolean {
    const shape = (
      axes: Array<{ name: string; values: Array<{ value: string; code?: string | null }> }>,
    ): string =>
      axes
        .map(
          (axis) =>
            `${axis.name.toLowerCase()}:${axis.values
              .map((value) => `${value.value.toLowerCase()}|${(value.code ?? '').toLowerCase()}`)
              .join(',')}`,
        )
        .join(';');

    return shape(current) === shape(next);
  }

  /** Chặn nổ tổ hợp ngay lúc LƯU TRỤC, không đợi tới lúc bấm Tạo SKU mới báo. */
  private assertCombinationCount(variants: NormalizedVariant[]): void {
    const total = variants.reduce((product, variant) => product * variant.values.length, 1);
    if (total > POD_SKU_TEMPLATE_MAX_ITEMS) throw new PodTooManySkuItemsException(total);
  }

  private valueKey(variantName: string, value: string): string {
    return `${variantName.toLowerCase()}||${value.toLowerCase()}`;
  }

  /** Mã gợi ý từ giá trị ("Sand Dune" → "SANDDU"). Người dùng sửa lại được từng dòng. */
  private shortCode(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .slice(0, 6)
      .toUpperCase();
  }

  private toNumber(value: Prisma.Decimal | null): number | undefined {
    return value === null ? undefined : Number(value);
  }

  // =========================================================================
  // Private — chung
  // =========================================================================

  private async writeCategoryAttributes(
    tx: Prisma.TransactionClient,
    organizationId: string,
    categoryTemplateId: string,
    tiktokCategoryId: string,
    attributes?: CategoryTemplateAttributeDto[],
  ): Promise<void> {
    if (!attributes?.length) return;

    const definitions = await this.loadAttributeDefinitions(
      tx,
      organizationId,
      tiktokCategoryId,
      attributes.map((attribute) => attribute.tiktokAttributeId),
    );

    for (const [index, attribute] of attributes.entries()) {
      const definition = definitions.get(attribute.tiktokAttributeId);
      // 🔴 Quyền nhập custom value do ĐỊNH NGHĨA TỪ TIKTOK quyết định, không phải cờ client
      // gửi lên. Không có định nghĩa trong cache (danh mục chưa đồng bộ thuộc tính) ⇒ giữ
      // nguyên cờ đã chụp, vì lúc đó ta không có gì để đối chiếu.
      const allowCustom = definition?.isCustomizable ?? attribute.isCustomizable ?? false;
      const customValues = this.normalizeCustomValues(
        attribute,
        definition?.values ?? [],
        allowCustom,
      );

      const created = await tx.podCategoryTemplateAttribute.create({
        data: {
          organizationId,
          categoryTemplateId,
          tiktokAttributeId: attribute.tiktokAttributeId,
          attributeName: attribute.attributeName ?? definition?.name ?? undefined,
          attributeType: attribute.attributeType ?? definition?.type ?? undefined,
          isRequired: definition?.isRequired ?? attribute.isRequired ?? false,
          isMultipleSelection:
            definition?.isMultipleSelection ?? attribute.isMultipleSelection ?? false,
          isCustomizable: allowCustom,
          sortOrder: attribute.sortOrder ?? index,
        },
        select: { id: true },
      });

      const seen = new Set<string>();
      const values = (attribute.values ?? []).filter((value) => {
        if (!value.tiktokValueId || seen.has(value.tiktokValueId)) return false;
        seen.add(value.tiktokValueId);
        return true;
      });

      if (values.length > 0) {
        await tx.podCategoryTemplateAttributeValue.createMany({
          data: values.map((value, valueIndex) => ({
            organizationId,
            templateAttributeId: created.id,
            tiktokValueId: value.tiktokValueId,
            valueName: value.valueName,
            sortOrder: valueIndex,
          })),
        });
      }

      if (customValues.length > 0) {
        await tx.podCategoryTemplateAttributeCustomValue.createMany({
          data: customValues.map((value, valueIndex) => ({
            organizationId,
            templateAttributeId: created.id,
            value,
            displayOrder: valueIndex,
          })),
        });
      }
    }
  }

  /**
   * Đọc ĐỊNH NGHĨA thuộc tính do TikTok cấp (bảng cache `pod_category_attributes`).
   *
   * Đây là nguồn sự thật cho câu hỏi "thuộc tính này có cho tự nhập không". Không có nó thì
   * mọi kiểm tra chỉ là hỏi lại chính client — client nào cũng trả lời "được".
   */
  private async loadAttributeDefinitions(
    tx: Prisma.TransactionClient,
    organizationId: string,
    tiktokCategoryId: string,
    tiktokAttributeIds: string[],
  ): Promise<Map<string, AttributeDefinition>> {
    const rows = await tx.podCategoryAttribute.findMany({
      where: {
        organizationId,
        tiktokAttributeId: { in: tiktokAttributeIds },
        category: { tiktokCategoryId },
      },
      select: {
        tiktokAttributeId: true,
        name: true,
        type: true,
        isRequired: true,
        isMultipleSelection: true,
        isCustomizable: true,
        values: true,
      },
    });

    return new Map(
      rows.map((row) => [
        row.tiktokAttributeId,
        {
          name: row.name,
          type: row.type,
          isRequired: row.isRequired,
          isMultipleSelection: row.isMultipleSelection,
          isCustomizable: row.isCustomizable,
          values: ((row.values as Array<{ id?: string; name?: string }> | null) ?? []).map(
            (value) => value?.name ?? '',
          ),
        },
      ]),
    );
  }

  /**
   * Chuẩn hoá danh sách giá trị tự nhập: trim · bỏ rỗng · bỏ trùng (không phân biệt hoa
   * thường) · **bỏ giá trị đã có sẵn trong danh sách chính thức**.
   *
   * Gõ lại đúng một giá trị TikTok đã có không phải lỗi người dùng đáng chặn cả form — nhưng
   * lưu nó thành custom value thì listing sẽ mang hai lần cùng một giá trị, một cái có `id`
   * một cái không. Loại tại đây là xong.
   */
  private normalizeCustomValues(
    attribute: CategoryTemplateAttributeDto,
    officialNames: string[],
    allowCustom: boolean,
  ): string[] {
    const raw = attribute.customValues ?? [];
    if (raw.length === 0) return [];

    if (!allowCustom) {
      throw new BadRequestException({
        code: 'POD_ATTRIBUTE_CUSTOM_VALUE_NOT_ALLOWED',
        message:
          `Thuộc tính "${attribute.attributeName ?? attribute.tiktokAttributeId}" không cho ` +
          'phép nhập giá trị tự do — TikTok quy định chỉ được chọn trong danh sách có sẵn.',
      });
    }

    const official = new Set(officialNames.map((name) => name.trim().toLowerCase()));
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of raw) {
      const trimmed = value.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key) || official.has(key)) continue;
      seen.add(key);
      result.push(trimmed);
    }

    return result;
  }

  /** Bỏ token trùng mã và token đè lên token hệ thống. */
  private normalizeTokens(
    tokens?: DescriptionTemplateTokenDto[],
  ): Array<{ code: string; label: string | null; value: string; sortOrder: number }> {
    if (!tokens?.length) return [];

    const seen = new Set<string>();
    const result: Array<{ code: string; label: string | null; value: string; sortOrder: number }> =
      [];

    tokens.forEach((token, index) => {
      const code = token.code.trim().toUpperCase();
      if (!code || seen.has(code)) return;
      if (isSystemToken(code)) {
        throw new BadRequestException({
          code: 'POD_TEMPLATE_TOKEN_RESERVED',
          message: `"${code}" là token hệ thống, không đặt lại được. Hãy chọn mã khác.`,
        });
      }
      seen.add(code);
      result.push({
        code,
        label: token.label?.trim() || null,
        value: token.value,
        sortOrder: token.sortOrder ?? index,
      });
    });

    return result;
  }

  /** Công thức phải hợp lệ NGAY LÚC LƯU — không đợi tới lúc sinh listing hàng loạt mới lỗi. */
  private assertPricingDtoValid(dto: CreatePricingStrategyDto): void {
    if (dto.markupType !== PodPricingMarkupType.FORMULA) return;
    if (!dto.formula?.trim()) {
      throw new BadRequestException({
        code: 'POD_PRICING_FORMULA_REQUIRED',
        message: 'Chọn kiểu giá FORMULA thì phải nhập công thức.',
      });
    }
    assertPricingFormulaValid(dto.formula);
  }

  /**
   * File phải thuộc CÙNG Organization.
   * Không kiểm là mở đường cho một tenant tham chiếu file của tenant khác qua ID.
   */
  private async assertFilesBelongToOrg(organizationId: string, fileIds: string[]): Promise<void> {
    const unique = [...new Set(fileIds)];
    if (unique.length === 0) return;

    const count = await this.prisma.storageFile.count({
      where: { id: { in: unique }, organizationId, deletedAt: null },
    });
    if (count !== unique.length) {
      throw new BadRequestException({
        code: 'POD_TEMPLATE_FILE_INVALID',
        message: 'Có file không tồn tại hoặc không thuộc tổ chức này.',
      });
    }
  }

  private async assertWarehouseBelongsToOrg(
    organizationId: string,
    warehouseId?: string,
  ): Promise<void> {
    if (!warehouseId) return;
    const count = await this.prisma.podTiktokWarehouse.count({
      where: { id: warehouseId, organizationId, deletedAt: null },
    });
    if (count === 0) {
      throw new BadRequestException({
        code: 'POD_TEMPLATE_WAREHOUSE_INVALID',
        message: 'Kho không tồn tại hoặc không thuộc tổ chức này.',
      });
    }
  }

  /** Chặn xoá template đang được Listing Template sử dụng — xoá đi là listing sinh sai. */
  private async ensureNotUsedByListingTemplate(
    organizationId: string,
    where: Prisma.PodListingTemplateWhereInput,
  ): Promise<void> {
    const used = await this.prisma.podListingTemplate.count({
      where: { ...where, organizationId, deletedAt: null },
    });
    if (used > 0) {
      throw new BadRequestException({
        code: 'POD_TEMPLATE_IN_USE',
        message: `Template đang được ${used} Listing Template sử dụng — gỡ khỏi Listing Template trước khi xoá.`,
      });
    }
  }

  /** Chỉ MỘT bản ghi `isDefault` cho mỗi loại template trong một Organization. */
  private async clearDefault(
    tx: Prisma.TransactionClient,
    model: 'podSkuTemplate' | 'podDescriptionTemplate' | 'podPricingStrategy',
    organizationId: string,
    exceptId?: string,
  ): Promise<void> {
    const where = {
      organizationId,
      isDefault: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    };
    // Prisma không có delegate động có kiểu ⇒ switch tường minh, vẫn an toàn kiểu.
    switch (model) {
      case 'podSkuTemplate':
        await tx.podSkuTemplate.updateMany({ where, data: { isDefault: false } });
        return;
      case 'podDescriptionTemplate':
        await tx.podDescriptionTemplate.updateMany({ where, data: { isDefault: false } });
        return;
      case 'podPricingStrategy':
        await tx.podPricingStrategy.updateMany({ where, data: { isDefault: false } });
        return;
    }
  }

  /** Category Template mặc định tính theo TỪNG thị trường (US có default riêng, UK riêng). */
  private async clearCategoryDefault(
    tx: Prisma.TransactionClient,
    organizationId: string,
    market: CreateCategoryTemplateDto['market'],
    exceptId?: string,
  ): Promise<void> {
    await tx.podCategoryTemplate.updateMany({
      where: {
        organizationId,
        market,
        isDefault: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  /** Điều kiện lọc dùng chung: tenant + soft delete + search + trạng thái. */
  private baseWhere(organizationId: string, query: PodTemplateQueryDto) {
    return {
      organizationId,
      deletedAt: null,
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(query.defaultOnly ? { isDefault: true } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
  }

  private paging(query: PodTemplateQueryDto): Paging {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return {
      page,
      limit,
      skip: (page - 1) * limit,
      sortBy: query.sortBy ?? 'displayOrder',
      sortOrder: query.sortOrder ?? 'asc',
    };
  }

  /**
   * Sắp xếp theo cột người dùng chọn, luôn kèm `name` làm tiêu chí phụ.
   * Thiếu tiêu chí phụ thì các bản ghi cùng `displayOrder` (mặc định đều là 0) sẽ đảo
   * thứ tự ngẫu nhiên giữa hai lần tải trang.
   */
  private orderBy(paging: Paging): Prisma.PodCategoryTemplateOrderByWithRelationInput[] {
    return paging.sortBy === 'name'
      ? [{ name: paging.sortOrder }]
      : [{ [paging.sortBy]: paging.sortOrder }, { name: 'asc' }];
  }

  private paginated<T>(items: T[], total: number, paging: Paging) {
    return {
      items,
      meta: {
        total,
        page: paging.page,
        limit: paging.limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / paging.limit),
      },
    };
  }
}
