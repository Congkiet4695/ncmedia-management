import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PodListingTemplateItemType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type {
  CreateListingTemplateDto,
  PodTemplateQueryDto,
  UpdateListingTemplateDto,
} from '../dto/pod-template.dto';
import { IMAGE_TEMPLATE_INCLUDE } from './pod-image-template.service';
import {
  CATEGORY_TEMPLATE_INCLUDE,
  DESCRIPTION_TEMPLATE_INCLUDE,
  SKU_TEMPLATE_INCLUDE,
} from './pod-template.service';

export class PodListingTemplateNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_LISTING_TEMPLATE_NOT_FOUND', message: 'Không tìm thấy Listing Template' });
  }
}

/** Include đầy đủ — màn hình Listing Template cần thấy mọi mảnh đã ghép. */
export const LISTING_TEMPLATE_INCLUDE = {
  categoryTemplate: { include: CATEGORY_TEMPLATE_INCLUDE },
  skuTemplate: { include: SKU_TEMPLATE_INCLUDE },
  descriptionTemplate: { include: DESCRIPTION_TEMPLATE_INCLUDE },
  imageTemplate: { include: IMAGE_TEMPLATE_INCLUDE },
  pricingStrategy: true,
  warehouse: true,
  items: { orderBy: { sortOrder: 'asc' } },
  scopes: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PodListingTemplateInclude;

export type ListingTemplateFull = Prisma.PodListingTemplateGetPayload<{
  include: typeof LISTING_TEMPLATE_INCLUDE;
}>;

/**
 * PodListingTemplateService — template LỚN NHẤT, ghép 5 mảnh + kho + brand + shipping.
 *
 * Ràng buộc nghiệp vụ được thực thi ở đây:
 *  - Mọi template con phải THUỘC CÙNG Organization (chống tham chiếu chéo tenant).
 *  - Category Template phải CÙNG THỊ TRƯỜNG với Listing Template — danh mục US không
 *    dùng được cho listing UK, phát hiện lúc lưu tốt hơn lúc publish thất bại.
 *  - Bảng `pod_listing_template_items` được đồng bộ lại mỗi lần lưu: nó giữ ảnh chụp
 *    tên + thứ tự các mảnh, phục vụ hiển thị và mở rộng sau này.
 */
@Injectable()
export class PodListingTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: PodTemplateQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PodListingTemplateWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.market ? { market: query.market } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(query.defaultOnly ? { isDefault: true } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const sortBy = query.sortBy ?? 'displayOrder';
    const sortOrder = query.sortOrder ?? 'asc';
    // Luôn có tiêu chí phụ `name`: các bản ghi cùng `displayOrder` (mặc định đều là 0)
    // sẽ đảo thứ tự ngẫu nhiên giữa hai lần tải trang nếu thiếu.
    const orderBy: Prisma.PodListingTemplateOrderByWithRelationInput[] =
      sortBy === 'name' ? [{ name: sortOrder }] : [{ [sortBy]: sortOrder }, { name: 'asc' }];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podListingTemplate.findMany({
        where,
        include: {
          categoryTemplate: { select: { id: true, name: true, categoryName: true } },
          skuTemplate: { select: { id: true, name: true, _count: { select: { items: true } } } },
          descriptionTemplate: { select: { id: true, name: true } },
          imageTemplate: { select: { id: true, name: true, _count: { select: { items: true } } } },
          pricingStrategy: { select: { id: true, name: true, currency: true } },
          warehouse: { select: { id: true, name: true } },
          scopes: { orderBy: { createdAt: 'asc' } },
          _count: { select: { scopes: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podListingTemplate.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /**
   * `client` — truyền `tx` khi đọc lại bản ghi vừa ghi TRONG transaction: `this.prisma`
   * chạy trên connection khác nên không thấy dữ liệu chưa commit.
   */
  async get(
    organizationId: string,
    id: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<ListingTemplateFull> {
    const template = await client.podListingTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: LISTING_TEMPLATE_INCLUDE,
    });
    if (!template) throw new PodListingTemplateNotFoundException();
    return template;
  }

  /**
   * Dựng một Listing Template **trong bộ nhớ** từ các mảnh rời.
   *
   * 🔴 Vì sao cần: Draft Listing cho phép chọn từng mảnh (chỉ Category + Pricing chẳng hạn)
   * mà không bắt tạo một Listing Template mới cho mỗi tổ hợp. Resolver thì chỉ biết làm việc
   * với `ListingTemplateFull`, nên chỗ này ghép các mảnh lại đúng hình dạng đó — một đường
   * code giải listing duy nhất cho cả hai lối vào.
   *
   * Có `listingTemplateId` thì lấy nguyên bản đã lưu rồi **ghi đè** bằng mảnh nào được chỉ
   * định riêng: draft chọn cả bộ nhưng đổi mỗi bộ ảnh là chuyện thường.
   */
  async getComposed(
    organizationId: string,
    parts: {
      listingTemplateId?: string | null;
      categoryTemplateId?: string | null;
      skuTemplateId?: string | null;
      descriptionTemplateId?: string | null;
      imageTemplateId?: string | null;
      pricingStrategyId?: string | null;
      market: ListingTemplateFull['market'];
      name: string;
    },
  ): Promise<ListingTemplateFull> {
    const base = parts.listingTemplateId
      ? await this.get(organizationId, parts.listingTemplateId)
      : this.emptyTemplate(organizationId, parts.market, parts.name);

    const [category, sku, description, image, pricing] = await Promise.all([
      parts.categoryTemplateId
        ? this.prisma.podCategoryTemplate.findFirst({
            where: { id: parts.categoryTemplateId, organizationId, deletedAt: null },
            include: CATEGORY_TEMPLATE_INCLUDE,
          })
        : null,
      parts.skuTemplateId
        ? this.prisma.podSkuTemplate.findFirst({
            where: { id: parts.skuTemplateId, organizationId, deletedAt: null },
            include: SKU_TEMPLATE_INCLUDE,
          })
        : null,
      parts.descriptionTemplateId
        ? this.prisma.podDescriptionTemplate.findFirst({
            where: { id: parts.descriptionTemplateId, organizationId, deletedAt: null },
            include: DESCRIPTION_TEMPLATE_INCLUDE,
          })
        : null,
      parts.imageTemplateId
        ? this.prisma.podImageTemplate.findFirst({
            where: { id: parts.imageTemplateId, organizationId, deletedAt: null },
            include: IMAGE_TEMPLATE_INCLUDE,
          })
        : null,
      parts.pricingStrategyId
        ? this.prisma.podPricingStrategy.findFirst({
            where: { id: parts.pricingStrategyId, organizationId, deletedAt: null },
          })
        : null,
    ]);

    return {
      ...base,
      name: parts.name || base.name,
      market: parts.market,
      categoryTemplate: category ?? base.categoryTemplate,
      skuTemplate: sku ?? base.skuTemplate,
      descriptionTemplate: description ?? base.descriptionTemplate,
      imageTemplate: image ?? base.imageTemplate,
      pricingStrategy: pricing ?? base.pricingStrategy,
      // Kho/brand chỉ có ở Listing Template đã lưu; chọn mảnh rời thì lấy của Category Template.
      warehouse: base.warehouse,
    };
  }

  /**
   * Ghép Listing Template **trong bộ nhớ** từ 5 mảnh mà một Listing Session đã chọn.
   *
   * 🔴 Đặt ở đây (không phải trong module Listing Session) để chỉ có MỘT nơi biết cách biến
   * các mảnh rời thành `ListingTemplateFull`: màn Preview, cổng Validate và Bulk Listing
   * Engine đều gọi cùng hàm này, nên thứ người dùng xem trước đúng bằng thứ được gửi đi.
   */
  async getForSession(organizationId: string, sessionId: string): Promise<ListingTemplateFull> {
    const session = await this.prisma.podListingSession.findFirst({
      where: { id: sessionId, organizationId, deletedAt: null },
      select: { id: true, name: true, market: true, templates: true },
    });
    if (!session) {
      throw new BadRequestException({
        code: 'POD_LISTING_SESSION_NOT_FOUND',
        message: 'Không tìm thấy Listing Session.',
      });
    }

    const pick = <K extends keyof (typeof session.templates)[number]>(key: K): string | null =>
      (session.templates.find((row) => row[key] !== null)?.[key] as string | null) ?? null;

    return this.getComposed(organizationId, {
      categoryTemplateId: pick('categoryTemplateId'),
      skuTemplateId: pick('skuTemplateId'),
      descriptionTemplateId: pick('descriptionTemplateId'),
      imageTemplateId: pick('imageTemplateId'),
      pricingStrategyId: pick('pricingStrategyId'),
      market: session.market,
      name: session.name,
    });
  }

  /** Khung Listing Template rỗng — dùng khi chỉ chọn mảnh rời, không chọn cả bộ. */
  private emptyTemplate(
    organizationId: string,
    market: ListingTemplateFull['market'],
    name: string,
  ): ListingTemplateFull {
    const now = new Date();
    return {
      id: '',
      organizationId,
      name,
      market,
      categoryTemplateId: null,
      skuTemplateId: null,
      descriptionTemplateId: null,
      imageTemplateId: null,
      pricingStrategyId: null,
      warehouseId: null,
      tiktokBrandId: null,
      brandName: null,
      shippingTemplateId: null,
      handlingDays: null,
      packageWeight: null,
      weightUnit: null,
      packageLength: null,
      packageWidth: null,
      packageHeight: null,
      dimensionUnit: null,
      isDefault: false,
      isActive: true,
      displayOrder: 0,
      note: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      categoryTemplate: null,
      skuTemplate: null,
      descriptionTemplate: null,
      imageTemplate: null,
      pricingStrategy: null,
      warehouse: null,
      items: [],
      scopes: [],
    };
  }

  async create(organizationId: string, userId: string, dto: CreateListingTemplateDto) {
    await this.assertReferencesValid(organizationId, dto);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, organizationId, dto.market);

      const { scopes, ...data } = dto;
      const template = await tx.podListingTemplate.create({
        data: { ...data, organizationId, createdBy: userId },
        select: { id: true },
      });
      await this.syncItems(tx, organizationId, template.id, dto);
      await this.syncScopes(tx, organizationId, template.id, scopes);

      return this.get(organizationId, template.id, tx);
    });
  }

  async update(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdateListingTemplateDto,
  ) {
    await this.get(organizationId, id);
    await this.assertReferencesValid(organizationId, dto);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, organizationId, dto.market, id);

      const { scopes, ...data } = dto;
      await tx.podListingTemplate.update({
        where: { id },
        data: { ...data, isActive: dto.isActive ?? true, updatedBy: userId },
      });
      await tx.podListingTemplateItem.deleteMany({ where: { listingTemplateId: id } });
      await this.syncItems(tx, organizationId, id, dto);
      await this.syncScopes(tx, organizationId, id, scopes);

      return this.get(organizationId, id, tx);
    });
  }

  async remove(organizationId: string, userId: string, id: string): Promise<void> {
    await this.get(organizationId, id);

    // Draft đã sinh vẫn cần biết mình sinh từ template nào ⇒ chỉ xoá mềm.
    await this.prisma.podListingTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  /** Nhân bản (Clone) — cùng cấu hình, tên mới, KHÔNG kế thừa cờ mặc định. */
  async clone(organizationId: string, userId: string, id: string, name?: string) {
    const source = await this.get(organizationId, id);

    return this.create(organizationId, userId, {
      name: name?.trim() || `${source.name} (copy)`,
      market: source.market,
      categoryTemplateId: source.categoryTemplateId ?? undefined,
      skuTemplateId: source.skuTemplateId ?? undefined,
      descriptionTemplateId: source.descriptionTemplateId ?? undefined,
      imageTemplateId: source.imageTemplateId ?? undefined,
      pricingStrategyId: source.pricingStrategyId ?? undefined,
      warehouseId: source.warehouseId ?? undefined,
      tiktokBrandId: source.tiktokBrandId ?? undefined,
      brandName: source.brandName ?? undefined,
      shippingTemplateId: source.shippingTemplateId ?? undefined,
      handlingDays: source.handlingDays ?? undefined,
      packageWeight: source.packageWeight ?? undefined,
      weightUnit: source.weightUnit ?? undefined,
      packageLength: source.packageLength ?? undefined,
      packageWidth: source.packageWidth ?? undefined,
      packageHeight: source.packageHeight ?? undefined,
      dimensionUnit: source.dimensionUnit ?? undefined,
      displayOrder: source.displayOrder,
      note: source.note ?? undefined,
      isDefault: false,
      // Bản sao giữ nguyên phạm vi: nhân bản một template rồi phải khai lại "áp cho những
      // sản phẩm nào" thì Clone gần như vô dụng.
      scopes: source.scopes.map((scope) => ({
        matchType: scope.matchType,
        value: scope.value ?? undefined,
        valueLabel: scope.valueLabel ?? undefined,
        isExclude: scope.isExclude,
      })),
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async assertReferencesValid(
    organizationId: string,
    dto: CreateListingTemplateDto,
  ): Promise<void> {
    if (dto.categoryTemplateId) {
      const category = await this.prisma.podCategoryTemplate.findFirst({
        where: { id: dto.categoryTemplateId, organizationId, deletedAt: null },
        select: { market: true },
      });
      if (!category) throw this.invalidRef('Category Template');
      if (category.market !== dto.market) {
        throw new BadRequestException({
          code: 'POD_LISTING_TEMPLATE_MARKET_MISMATCH',
          message:
            `Category Template thuộc thị trường ${category.market} nhưng Listing Template là ` +
            `${dto.market}. Danh mục của mỗi thị trường là khác nhau.`,
        });
      }
    }

    const checks: Array<[string | undefined, () => Promise<number>, string]> = [
      [
        dto.skuTemplateId,
        () =>
          this.prisma.podSkuTemplate.count({
            where: { id: dto.skuTemplateId, organizationId, deletedAt: null },
          }),
        'SKU Template',
      ],
      [
        dto.descriptionTemplateId,
        () =>
          this.prisma.podDescriptionTemplate.count({
            where: { id: dto.descriptionTemplateId, organizationId, deletedAt: null },
          }),
        'Description Template',
      ],
      [
        dto.imageTemplateId,
        () =>
          this.prisma.podImageTemplate.count({
            where: { id: dto.imageTemplateId, organizationId, deletedAt: null },
          }),
        'Image Template',
      ],
      [
        dto.pricingStrategyId,
        () =>
          this.prisma.podPricingStrategy.count({
            where: { id: dto.pricingStrategyId, organizationId, deletedAt: null },
          }),
        'Pricing Strategy',
      ],
      [
        dto.warehouseId,
        () =>
          this.prisma.podTiktokWarehouse.count({
            where: { id: dto.warehouseId, organizationId, deletedAt: null },
          }),
        'Warehouse',
      ],
    ];

    for (const [id, count, label] of checks) {
      if (!id) continue;
      if ((await count()) === 0) throw this.invalidRef(label);
    }
  }

  private invalidRef(label: string): BadRequestException {
    return new BadRequestException({
      code: 'POD_LISTING_TEMPLATE_INVALID_REF',
      message: `${label} không tồn tại hoặc không thuộc tổ chức này.`,
    });
  }

  /**
   * Ghi lại quy tắc chọn sản phẩm.
   *
   * Ghi đè trọn bộ thay vì merge từng dòng: quy tắc phạm vi là một **tập hợp có ý nghĩa
   * tổng thể** ("danh mục A hoặc B, trừ hàng sample"), sửa lẻ từng dòng thì rất dễ để sót
   * một dòng cũ và template im lặng bao phủ nhầm hàng nghìn sản phẩm.
   */
  private async syncScopes(
    tx: Prisma.TransactionClient,
    organizationId: string,
    listingTemplateId: string,
    scopes?: CreateListingTemplateDto['scopes'],
  ): Promise<void> {
    await tx.podListingTemplateScope.deleteMany({ where: { listingTemplateId } });
    if (!scopes?.length) return;

    await tx.podListingTemplateScope.createMany({
      data: scopes.map((scope) => ({
        organizationId,
        listingTemplateId,
        matchType: scope.matchType,
        value: scope.value,
        valueLabel: scope.valueLabel,
        isExclude: scope.isExclude ?? false,
      })),
    });
  }

  /** Ghi lại các mảnh đã ghép kèm ảnh chụp tên — nguồn cho màn hình cấu trúc template. */
  private async syncItems(
    tx: Prisma.TransactionClient,
    organizationId: string,
    listingTemplateId: string,
    dto: CreateListingTemplateDto,
  ): Promise<void> {
    const parts: Array<{ type: PodListingTemplateItemType; id?: string }> = [
      { type: PodListingTemplateItemType.CATEGORY, id: dto.categoryTemplateId },
      { type: PodListingTemplateItemType.SKU, id: dto.skuTemplateId },
      { type: PodListingTemplateItemType.DESCRIPTION, id: dto.descriptionTemplateId },
      { type: PodListingTemplateItemType.IMAGE, id: dto.imageTemplateId },
      { type: PodListingTemplateItemType.PRICING, id: dto.pricingStrategyId },
    ];

    const rows: Prisma.PodListingTemplateItemCreateManyInput[] = [];
    let sortOrder = 0;

    for (const part of parts) {
      if (!part.id) continue;
      rows.push({
        organizationId,
        listingTemplateId,
        itemType: part.type,
        refId: part.id,
        refName: await this.resolveRefName(tx, part.type, part.id),
        sortOrder: sortOrder++,
      });
    }

    if (rows.length > 0) await tx.podListingTemplateItem.createMany({ data: rows });
  }

  private async resolveRefName(
    tx: Prisma.TransactionClient,
    type: PodListingTemplateItemType,
    id: string,
  ): Promise<string | null> {
    switch (type) {
      case PodListingTemplateItemType.CATEGORY:
        return (
          await tx.podCategoryTemplate.findUnique({ where: { id }, select: { name: true } })
        )?.name ?? null;
      case PodListingTemplateItemType.SKU:
        return (
          await tx.podSkuTemplate.findUnique({ where: { id }, select: { name: true } })
        )?.name ?? null;
      case PodListingTemplateItemType.DESCRIPTION:
        return (
          await tx.podDescriptionTemplate.findUnique({ where: { id }, select: { name: true } })
        )?.name ?? null;
      case PodListingTemplateItemType.IMAGE:
        return (
          await tx.podImageTemplate.findUnique({ where: { id }, select: { name: true } })
        )?.name ?? null;
      case PodListingTemplateItemType.PRICING:
        return (
          await tx.podPricingStrategy.findUnique({ where: { id }, select: { name: true } })
        )?.name ?? null;
    }
  }

  private async clearDefault(
    tx: Prisma.TransactionClient,
    organizationId: string,
    market: CreateListingTemplateDto['market'],
    exceptId?: string,
  ): Promise<void> {
    await tx.podListingTemplate.updateMany({
      where: {
        organizationId,
        market,
        isDefault: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }
}
