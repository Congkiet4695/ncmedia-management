import { Injectable, Logger } from '@nestjs/common';
import { PodFlashSaleItemStatus, PodFlashSaleProductLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import type {
  ApplyFlashSaleTemplateDto,
  PodFlashSaleTemplateQueryDto,
  SaveFlashSaleTemplateDto,
  UpdateFlashSaleTemplateDto,
} from '../dto/pod-flash-sale.dto';
import type {
  PaginatedPodFlashSaleTemplateDto,
  PodFlashSaleTemplateDto,
} from '../dto/pod-flash-sale-response.dto';
import {
  PodFlashSaleNameTakenException,
  PodFlashSaleTemplateNotFoundException,
} from '../exceptions/pod-flash-sale.exceptions';
import {
  toFlashSaleTemplate,
  type FlashSaleDetailRow,
  type FlashSaleTemplateRow,
} from '../mappers/pod-flash-sale.mapper';
import {
  FLASH_SALE_TEMPLATE_CONFIG_VERSION,
  parseTemplateConfig,
  type PodFlashSaleTemplateConfig,
  type PodFlashSaleTemplateItem,
} from '../types/pod-flash-sale-template-config.type';
import { computeFlashSalePricing, toDecimal } from './pod-flash-sale-pricing';
import { PodFlashSaleService } from './pod-flash-sale.service';

const TEMPLATE_INCLUDE = {
  shop: { select: { id: true, name: true, region: true } },
} satisfies Prisma.PodFlashSaleTemplateInclude;

/**
 * PodFlashSaleTemplateService — lưu một cấu hình đợt sale và dựng lại nó cho ngày khác.
 *
 * Đây là chức năng làm nên giá trị của cả sprint:
 *
 * ```
 *   Flash Sale hôm nay ──▶ Save as Template ──▶ (ngày mai) Apply ──▶ Flash Sale mới
 *                          không có ngày giờ                        chỉ cần đặt giờ
 * ```
 *
 * 🔴 Template lưu **% giảm**, không lưu giá deal tuyệt đối. Giá gốc của sản phẩm đổi theo
 * thời gian: "giảm 30%" áp lại sau ba tháng vẫn đúng ý định, còn "bán 20.99" thì có thể đã
 * thành bán dưới giá vốn. Giá deal ghi kèm chỉ để hiển thị lại con số lúc lưu.
 *
 * 🔴 Template KHÔNG giữ khoá ngoại sang sản phẩm (cột `config` là JSON). Một sản phẩm bị
 * xoá thì template vẫn còn và chỉ dòng đó báo "không còn khả dụng" lúc áp — thay vì cả
 * template hỏng theo, hoặc tệ hơn là bị xoá lây theo `ON DELETE CASCADE`.
 */
@Injectable()
export class PodFlashSaleTemplateService {
  private readonly logger = new Logger(PodFlashSaleTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: PodAccessScopeService,
    private readonly flashSales: PodFlashSaleService,
  ) {}

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------

  async list(
    organizationId: string,
    query: PodFlashSaleTemplateQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodFlashSaleTemplateDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    this.accessScope.assertShopAllowed(scope, query.shopId);
    this.accessScope.assertAccountAllowed(scope, query.accountId);

    const where: Prisma.PodFlashSaleTemplateWhereInput = {
      organizationId,
      deletedAt: null,
      ...(scope.allShops ? {} : { shopId: { in: scope.shopIds } }),
      ...(query.shopId ? { shopId: query.shopId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.podFlashSaleTemplate.findMany({
        where,
        include: TEMPLATE_INCLUDE,
        orderBy: { [query.sortBy ?? 'updatedAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podFlashSaleTemplate.count({ where }),
    ]);

    return {
      items: rows.map(toFlashSaleTemplate),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /** Nạp một template, ĐÃ kiểm phạm vi shop. Cửa vào duy nhất của mọi thao tác trên template. */
  async get(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<FlashSaleTemplateRow> {
    const row = await this.prisma.podFlashSaleTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: TEMPLATE_INCLUDE,
    });
    if (!row) throw new PodFlashSaleTemplateNotFoundException();
    this.accessScope.assertShopAllowed(scope, row.shopId);
    return row;
  }

  async getDetail(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodFlashSaleTemplateDto> {
    return toFlashSaleTemplate(await this.get(organizationId, id, scope));
  }

  // ---------------------------------------------------------------------------
  // Ghi
  // ---------------------------------------------------------------------------

  /**
   * "Save as Template" — chụp lại cấu hình sản phẩm của một đợt sale.
   *
   * Chụp lại NHỮNG GÌ: danh sách sản phẩm/SKU, % giảm, giá deal (tham chiếu), giới hạn mua,
   * mức áp dụng. KHÔNG chụp: ngày giờ, trạng thái, `activity_id`, lỗi, nhật ký — đúng theo
   * yêu cầu sprint, và cũng là điều khiến template dùng lại được cho mọi ngày.
   */
  async saveFromFlashSale(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    dto: SaveFlashSaleTemplateDto,
    scope: PodAccessScope,
  ): Promise<PodFlashSaleTemplateDto> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    const name = await this.ensureUniqueName(organizationId, dto.name, null);

    const config = this.buildConfig(flashSale);

    const created = await this.prisma.podFlashSaleTemplate.create({
      data: {
        organizationId,
        accountId: flashSale.accountId,
        shopId: flashSale.shopId,
        name,
        description: dto.description ?? null,
        config: config as unknown as Prisma.InputJsonValue,
        createdBy: userId,
        updatedBy: userId,
      },
      include: TEMPLATE_INCLUDE,
    });

    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'template.save',
      organizationId,
      templateId: created.id,
      flashSaleId,
      items: config.items.length,
      msg: 'Đã lưu Flash Sale Template',
    });
    return toFlashSaleTemplate(created);
  }

  /** Đổi tên / mô tả. Nội dung sản phẩm chỉ đổi bằng cách lưu lại từ một đợt sale. */
  async update(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdateFlashSaleTemplateDto,
    scope: PodAccessScope,
  ): Promise<PodFlashSaleTemplateDto> {
    await this.get(organizationId, id, scope);
    const name =
      dto.name === undefined ? undefined : await this.ensureUniqueName(organizationId, dto.name, id);

    const updated = await this.prisma.podFlashSaleTemplate.update({
      where: { id },
      data: {
        ...(name === undefined ? {} : { name }),
        ...(dto.description === undefined ? {} : { description: dto.description }),
        updatedBy: userId,
      },
      include: TEMPLATE_INCLUDE,
    });
    return toFlashSaleTemplate(updated);
  }

  async remove(
    organizationId: string,
    userId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<void> {
    await this.get(organizationId, id, scope);
    await this.prisma.podFlashSaleTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
  }

  /**
   * Tạo một đợt sale MỚI từ template — người dùng chỉ nhập tên và giờ.
   *
   * 🔴 Giá deal được **TÍNH LẠI** từ `%` đã lưu và giá gốc HIỆN HÀNH của sản phẩm, không
   * dùng lại con số cũ. Đó là toàn bộ lý do template lưu `%` thay vì giá.
   *
   * Dòng nào không còn khớp (sản phẩm đã xoá, SKU đã biến mất, sản phẩm không thuộc shop
   * đích) bị BỎ QUA và ghi vào log — template vẫn dùng được, chỉ ngắn đi.
   */
  async apply(
    organizationId: string,
    userId: string,
    templateId: string,
    dto: ApplyFlashSaleTemplateDto,
    scope: PodAccessScope,
  ): Promise<string> {
    const template = await this.get(organizationId, templateId, scope);
    const config = parseTemplateConfig(template.config);

    // `create` đã tự kiểm phạm vi shop và tự giải `accountId` từ shop — không lặp lại ở đây.
    const shopId = dto.shopId ?? template.shopId;

    const flashSale = await this.flashSales.create(
      organizationId,
      userId,
      {
        shopId,
        name: dto.name,
        description: template.description ?? undefined,
        startAt: dto.startAt,
        endAt: dto.endAt,
        timezone: dto.timezone,
        productLevel: config.productLevel,
      },
      scope,
    );

    const { rows, skipped } = await this.resolveTemplateItems(
      organizationId,
      shopId,
      flashSale.id,
      config,
    );

    if (rows.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.podFlashSaleItem.createMany({ data: rows });
        await this.flashSales.refreshItemCount(flashSale.id, tx);
      });
    }

    await this.prisma.podFlashSale.update({
      where: { id: flashSale.id },
      data: { sourceTemplateId: templateId },
    });

    if (skipped.length > 0) {
      await this.flashSales.writeLog({
        organizationId,
        flashSaleId: flashSale.id,
        action: 'VALIDATE',
        level: 'WARN',
        message: `${skipped.length} dòng của template không còn khả dụng và đã bị bỏ qua.`,
        response: skipped,
        userId,
      });
    }

    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'template.apply',
      organizationId,
      templateId,
      flashSaleId: flashSale.id,
      applied: rows.length,
      skipped: skipped.length,
      msg: 'Đã tạo Flash Sale từ template',
    });
    return flashSale.id;
  }

  /**
   * Áp template vào một đợt sale VỪA tạo (nhánh `templateId` của Create Flash Sale).
   *
   * Tách khỏi `apply` vì ở đây đợt sale đã tồn tại: dùng chung sẽ thành tạo hai bản ghi.
   */
  async applyToExisting(
    organizationId: string,
    userId: string,
    templateId: string,
    flashSale: FlashSaleDetailRow,
    scope: PodAccessScope,
  ): Promise<void> {
    const template = await this.get(organizationId, templateId, scope);
    const config = parseTemplateConfig(template.config);

    const { rows, skipped } = await this.resolveTemplateItems(
      organizationId,
      flashSale.shopId,
      flashSale.id,
      config,
    );

    await this.prisma.$transaction(async (tx) => {
      if (rows.length > 0) await tx.podFlashSaleItem.createMany({ data: rows });
      await tx.podFlashSale.update({
        where: { id: flashSale.id },
        data: { sourceTemplateId: templateId, productLevel: config.productLevel, updatedBy: userId },
      });
      await this.flashSales.refreshItemCount(flashSale.id, tx);
    });

    if (skipped.length > 0) {
      await this.flashSales.writeLog({
        organizationId,
        flashSaleId: flashSale.id,
        action: 'VALIDATE',
        level: 'WARN',
        message: `${skipped.length} dòng của template không còn khả dụng và đã bị bỏ qua.`,
        response: skipped,
        userId,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Đợt sale ⇒ nội dung cột `config`. */
  private buildConfig(flashSale: FlashSaleDetailRow): PodFlashSaleTemplateConfig {
    return {
      version: FLASH_SALE_TEMPLATE_CONFIG_VERSION,
      productLevel: flashSale.productLevel,
      items: flashSale.items
        .filter((item) => item.status !== PodFlashSaleItemStatus.REMOVED)
        .map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          skuId: item.skuId,
          providerProductId: item.providerProductId,
          providerVariantId: item.providerVariantId,
          productTitle: item.product?.title ?? null,
          variantName: item.variant?.variantName ?? null,
          discountPercent: item.discountPercent.toString(),
          flashSalePrice: item.flashSalePrice.toString(),
          totalPurchaseLimit: item.totalPurchaseLimit,
          customerPurchaseLimit: item.customerPurchaseLimit,
        })),
    };
  }

  /**
   * Dòng template ⇒ dòng thật, với giá tính lại theo giá gốc HIỆN HÀNH.
   *
   * Khớp lại theo hai đường, theo đúng thứ tự đáng tin cậy:
   *  1. `variantId` nội bộ — chính xác tuyệt đối khi áp lại trong cùng shop.
   *  2. `seller_sku` — cứu được trường hợp áp sang shop khác hoặc sản phẩm đã đồng bộ lại
   *     và đổi id nội bộ. Mã SKU là thứ người vận hành đặt và giữ nguyên qua các lần đồng bộ.
   */
  private async resolveTemplateItems(
    organizationId: string,
    shopId: string,
    flashSaleId: string,
    config: PodFlashSaleTemplateConfig,
  ): Promise<{ rows: Prisma.PodFlashSaleItemCreateManyInput[]; skipped: string[] }> {
    const rows: Prisma.PodFlashSaleItemCreateManyInput[] = [];
    const skipped: string[] = [];
    if (config.items.length === 0) return { rows, skipped };

    const products = await this.prisma.podProduct.findMany({
      where: {
        organizationId,
        shopId,
        deletedAt: null,
        OR: [
          { id: { in: config.items.map((item) => item.productId) } },
          {
            tiktokProductId: {
              in: config.items
                .map((item) => item.providerProductId)
                .filter((id): id is string => Boolean(id)),
            },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        tiktokProductId: true,
        currency: true,
        minPrice: true,
        variants: {
          where: { deletedAt: null },
          select: {
            id: true,
            tiktokSkuId: true,
            sellerSku: true,
            variantName: true,
            salePrice: true,
            listPrice: true,
            currency: true,
          },
        },
      },
    });

    const byId = new Map(products.map((product) => [product.id, product]));
    const byTiktokId = new Map(products.map((product) => [product.tiktokProductId, product]));

    const seen = new Set<string>();
    let sortOrder = 0;

    for (const item of config.items) {
      const product =
        byId.get(item.productId) ??
        (item.providerProductId ? byTiktokId.get(item.providerProductId) : undefined);
      if (!product) {
        skipped.push(`${item.productTitle ?? item.productId}: sản phẩm không còn trong shop này`);
        continue;
      }

      const target = this.matchVariant(config.productLevel, product, item);
      if (!target) {
        skipped.push(
          `${item.productTitle ?? product.id} (${item.variantName ?? item.skuId ?? '—'}): không tìm thấy biến thể`,
        );
        continue;
      }

      const key = `${product.id}::${target.variantId ?? 'PRODUCT'}`;
      if (seen.has(key)) continue;

      const originalPrice = toDecimal(target.originalPrice);
      if (!originalPrice || originalPrice.lessThanOrEqualTo(0)) {
        skipped.push(`${item.productTitle ?? product.id}: chưa có giá bán hiện hành`);
        continue;
      }

      const pricing = computeFlashSalePricing({
        originalPrice,
        discountPercent: item.discountPercent,
      });
      if (!pricing) {
        skipped.push(`${item.productTitle ?? product.id}: % giảm trong template không hợp lệ`);
        continue;
      }

      rows.push({
        organizationId,
        flashSaleId,
        productId: product.id,
        variantId: target.variantId,
        skuId: target.sellerSku,
        originalPrice: pricing.originalPrice,
        flashSalePrice: pricing.flashSalePrice,
        discountPercent: pricing.discountPercent,
        currency: target.currency ?? product.currency,
        totalPurchaseLimit: item.totalPurchaseLimit,
        customerPurchaseLimit: item.customerPurchaseLimit,
        providerProductId: product.tiktokProductId,
        providerVariantId: target.tiktokSkuId,
        status: PodFlashSaleItemStatus.READY,
        sortOrder: sortOrder++,
      });
      seen.add(key);
    }

    return { rows, skipped };
  }

  /** Tìm lại biến thể tương ứng của một dòng template trong sản phẩm hiện tại. */
  private matchVariant(
    productLevel: PodFlashSaleProductLevel,
    product: {
      id: string;
      currency: string | null;
      minPrice: Prisma.Decimal | null;
      variants: Array<{
        id: string;
        tiktokSkuId: string;
        sellerSku: string | null;
        variantName: string | null;
        salePrice: Prisma.Decimal | null;
        listPrice: Prisma.Decimal | null;
        currency: string | null;
      }>;
    },
    item: PodFlashSaleTemplateItem,
  ): {
    variantId: string | null;
    tiktokSkuId: string | null;
    sellerSku: string | null;
    originalPrice: Prisma.Decimal | null;
    currency: string | null;
  } | null {
    if (productLevel === PodFlashSaleProductLevel.PRODUCT) {
      return {
        variantId: null,
        tiktokSkuId: null,
        sellerSku: null,
        originalPrice: product.minPrice,
        currency: product.currency,
      };
    }

    const variant =
      product.variants.find((candidate) => candidate.id === item.variantId) ??
      product.variants.find(
        (candidate) => item.providerVariantId && candidate.tiktokSkuId === item.providerVariantId,
      ) ??
      product.variants.find((candidate) => item.skuId && candidate.sellerSku === item.skuId);

    if (!variant) return null;
    return {
      variantId: variant.id,
      tiktokSkuId: variant.tiktokSkuId,
      sellerSku: variant.sellerSku,
      originalPrice: variant.salePrice ?? variant.listPrice,
      currency: variant.currency,
    };
  }

  /** Tên template duy nhất trong tổ chức. */
  private async ensureUniqueName(
    organizationId: string,
    name: string,
    excludeId: string | null,
  ): Promise<string> {
    const trimmed = name.trim();
    const existing = await this.prisma.podFlashSaleTemplate.findFirst({
      where: {
        organizationId,
        name: trimmed,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) throw new PodFlashSaleNameTakenException('ORGANIZATION');
    return trimmed;
  }
}
