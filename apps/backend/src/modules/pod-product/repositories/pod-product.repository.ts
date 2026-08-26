import { Injectable } from '@nestjs/common';
import { Prisma, PodProductRawSource } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { PodProductSortField } from '../constants/pod-product.constants';
import type { MappedProduct } from '../mappers/pod-product.mapper';
import { accountScopeFilter, shopScopeFilter } from '../../pod-tiktok/shared/shop-scope';

/** Bộ lọc danh sách sản phẩm — đúng những gì màn hình Products cần. */
export interface PodProductFindManyParams {
  page: number;
  limit: number;
  /** Tìm theo: tiêu đề · TikTok Product ID · Seller SKU (khớp một trong ba là ra). */
  search?: string;
  accountId?: string;
  shopId?: string;
  status?: string;
  categoryId?: string;
  brandId?: string;
  sortBy: PodProductSortField;
  sortOrder: 'asc' | 'desc';
  /**
   * 🔴 Phạm vi shop của người dùng. `undefined` = không giới hạn (có `pod.shop.all`);
   * mảng RỖNG = chưa được gán shop nào ⇒ phải trả về rỗng, KHÔNG phải trả về tất cả.
   * Xem `PodAccessScopeService`.
   */
  shopScope?: string[];
  /** Phạm vi TikTok Account — cùng nguyên tắc với `shopScope`. */
  accountScope?: string[];
}

/** Include dùng cho màn hình DANH SÁCH — chỉ lấy đủ để hiển thị một dòng. */
export const POD_PRODUCT_LIST_INCLUDE = {
  shop: { select: { id: true, name: true, region: true } },
  account: { select: { id: true, accountName: true } },
  images: {
    where: { variantId: null },
    orderBy: { sortOrder: 'asc' },
    take: 1,
    select: { url: true, thumbUrl: true },
  },
} satisfies Prisma.PodProductInclude;

/** Include cho màn hình CHI TIẾT — đầy đủ biến thể, ảnh, video, thuộc tính. */
export const POD_PRODUCT_DETAIL_INCLUDE = {
  shop: { select: { id: true, name: true, region: true } },
  account: { select: { id: true, accountName: true } },
  variants: { orderBy: { createdAt: 'asc' } },
  images: { orderBy: [{ variantId: 'asc' }, { sortOrder: 'asc' }] },
  videos: true,
  attributes: { orderBy: { name: 'asc' } },
} satisfies Prisma.PodProductInclude;

export type PodProductListRow = Prisma.PodProductGetPayload<{
  include: typeof POD_PRODUCT_LIST_INCLUDE;
}>;
export type PodProductDetailRow = Prisma.PodProductGetPayload<{
  include: typeof POD_PRODUCT_DETAIL_INCLUDE;
}>;

/**
 * PodProductRepository — data access cho aggregate Sản phẩm.
 *
 * Ràng buộc tenant (ADR-004): MỌI method nhận `organizationId`. Public App phục vụ
 * nhiều seller nên đây không phải hình thức — hai tổ chức có thể có cùng `tiktok_product_id`.
 */
@Injectable()
export class PodProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    organizationId: string,
    params: PodProductFindManyParams,
  ): Promise<{ items: PodProductListRow[]; total: number }> {
    const where = this.buildWhere(organizationId, params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podProduct.findMany({
        where,
        include: POD_PRODUCT_LIST_INCLUDE,
        orderBy: { [params.sortBy]: params.sortOrder },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.podProduct.count({ where }),
    ]);

    return { items, total };
  }

  findById(organizationId: string, id: string): Promise<PodProductDetailRow | null> {
    return this.prisma.podProduct.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: POD_PRODUCT_DETAIL_INCLUDE,
    });
  }

  /** Tra theo ID phía TikTok — dùng khi đồng bộ lại một sản phẩm cụ thể. */
  findByTiktokId(
    organizationId: string,
    shopId: string,
    tiktokProductId: string,
  ): Promise<{ id: string; payloadHash: string } | null> {
    return this.prisma.podProduct.findFirst({
      where: { organizationId, shopId, tiktokProductId, deletedAt: null },
      select: { id: true, payloadHash: true },
    });
  }

  /** Hash hiện có của nhiều sản phẩm — để quyết định sản phẩm nào cần đọc chi tiết. */
  async findHashes(
    organizationId: string,
    shopId: string,
    tiktokProductIds: string[],
  ): Promise<Map<string, string>> {
    if (tiktokProductIds.length === 0) return new Map();
    const rows = await this.prisma.podProduct.findMany({
      where: { organizationId, shopId, tiktokProductId: { in: tiktokProductIds } },
      select: { tiktokProductId: true, payloadHash: true },
    });
    return new Map(rows.map((row) => [row.tiktokProductId, row.payloadHash]));
  }

  /**
   * Ghi (tạo hoặc cập nhật) TRỌN VẸN một sản phẩm trong MỘT transaction.
   *
   * 🔴 Quan hệ con (biến thể/ảnh/video/thuộc tính) dùng chiến lược **xoá rồi ghi lại**:
   * TikTok trả về trạng thái đầy đủ ở mỗi lần đọc, nên đây là cách duy nhất phản ánh
   * đúng việc seller XOÁ bớt một SKU/ảnh. Biến thể dùng `deleteMany` theo `productId`
   * chứ không xoá mềm — bản ghi biến thể không có dữ liệu nghiệp vụ riêng cần giữ.
   */
  async upsertAggregate(
    organizationId: string,
    accountId: string,
    shopId: string,
    mapped: MappedProduct,
    actorUserId: string | null,
  ): Promise<{ id: string; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.podProduct.findFirst({
        where: { organizationId, shopId, tiktokProductId: mapped.product.tiktokProductId },
        select: { id: true },
      });

      const data = {
        ...mapped.product,
        productTags: mapped.product.productTags ?? Prisma.JsonNull,
        salesRegions: mapped.product.salesRegions ?? Prisma.JsonNull,
        productTypes: mapped.product.productTypes ?? Prisma.JsonNull,
        lastSyncedAt: new Date(),
      };

      const product = existing
        ? await tx.podProduct.update({
            where: { id: existing.id },
            data: { ...data, deletedAt: null, updatedBy: actorUserId },
            select: { id: true },
          })
        : await tx.podProduct.create({
            data: {
              ...data,
              organizationId,
              accountId,
              shopId,
              createdBy: actorUserId,
            },
            select: { id: true },
          });

      await tx.podProductImage.deleteMany({ where: { productId: product.id } });
      await tx.podProductVideo.deleteMany({ where: { productId: product.id } });
      await tx.podProductAttribute.deleteMany({ where: { productId: product.id } });
      await tx.podProductVariant.deleteMany({ where: { productId: product.id } });

      // Biến thể phải ghi TRƯỚC ảnh: ảnh của SKU cần `variantId` vừa tạo.
      const variantIdBySkuId = new Map<string, string>();
      for (const variant of mapped.variants) {
        if (!variant.tiktokSkuId) continue;
        const created = await tx.podProductVariant.create({
          data: {
            ...variant,
            salesAttributes: variant.salesAttributes ?? Prisma.JsonNull,
            inventory: variant.inventory ?? Prisma.JsonNull,
            organizationId,
            productId: product.id,
            createdBy: actorUserId,
          },
          select: { id: true },
        });
        variantIdBySkuId.set(variant.tiktokSkuId, created.id);
      }

      if (mapped.images.length > 0) {
        await tx.podProductImage.createMany({
          data: mapped.images.map((image) => ({
            organizationId,
            productId: product.id,
            variantId: image.variantSkuId
              ? (variantIdBySkuId.get(image.variantSkuId) ?? null)
              : null,
            uri: image.uri,
            url: image.url,
            thumbUrl: image.thumbUrl,
            width: image.width,
            height: image.height,
            sortOrder: image.sortOrder,
          })),
        });
      }

      if (mapped.videos.length > 0) {
        await tx.podProductVideo.createMany({
          data: mapped.videos.map((video) => ({
            organizationId,
            productId: product.id,
            ...video,
          })),
        });
      }

      if (mapped.attributes.length > 0) {
        await tx.podProductAttribute.createMany({
          data: mapped.attributes.map((attribute) => ({
            organizationId,
            productId: product.id,
            tiktokAttributeId: attribute.tiktokAttributeId,
            name: attribute.name,
            values: attribute.values ?? Prisma.JsonNull,
          })),
        });
      }

      // Nối sang danh mục/thương hiệu đã đồng bộ (nếu có) — chỉ là tiện ích hiển thị,
      // thiếu bản ghi danh mục KHÔNG được làm hỏng việc lưu sản phẩm.
      await this.linkCatalogReferences(tx, product.id, shopId, mapped);

      return { id: product.id, created: !existing };
    });
  }

  /** Lưu payload gốc — mỗi (shop, product, source) giữ đúng bản mới nhất. */
  async saveRawData(data: {
    organizationId: string;
    shopId: string;
    productId: string | null;
    tiktokProductId: string;
    source: PodProductRawSource;
    apiVersion: string;
    payload: Prisma.InputJsonValue;
    payloadHash: string;
    tiktokRequestId?: string | null;
  }): Promise<void> {
    const { organizationId, shopId, tiktokProductId, source, ...rest } = data;
    await this.prisma.podProductRawData.upsert({
      where: {
        shopId_tiktokProductId_source: { shopId, tiktokProductId, source },
      },
      create: { organizationId, shopId, tiktokProductId, source, ...rest, fetchedAt: new Date() },
      update: { ...rest, fetchedAt: new Date() },
    });
  }

  /** Đọc payload gốc — phục vụ debug và "chiếu lại" khi nâng cấp mapper. */
  findRawData(
    organizationId: string,
    productId: string,
    source: PodProductRawSource,
  ): Promise<{ payload: Prisma.JsonValue; fetchedAt: Date; apiVersion: string } | null> {
    return this.prisma.podProductRawData.findFirst({
      where: { organizationId, productId, source },
      select: { payload: true, fetchedAt: true, apiVersion: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private buildWhere(
    organizationId: string,
    params: PodProductFindManyParams,
  ): Prisma.PodProductWhereInput {
    const where: Prisma.PodProductWhereInput = { organizationId, deletedAt: null };

    // 🔴 GIAO phạm vi được gán với bộ lọc người dùng chọn — không bao giờ gán đè. Gán đè là
    // bug bảo mật: chỉ cần gửi `?shopId=<shop người khác>` là đọc được dữ liệu shop đó.
    const shopFilter = shopScopeFilter(params.shopScope, params.shopId);
    if (shopFilter !== undefined) where.shopId = shopFilter;

    const accountFilter = accountScopeFilter(params.accountScope, params.accountId);
    if (accountFilter !== undefined) where.accountId = accountFilter;
    if (params.status) where.status = params.status;
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.brandId) where.brandId = params.brandId;

    const search = params.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { tiktokProductId: { contains: search } },
        // Seller SKU nằm ở biến thể — tìm theo nó là yêu cầu tường minh của màn hình.
        { variants: { some: { sellerSku: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    return where;
  }

  /**
   * Gắn `brandId`/`categoryId` nội bộ dựa trên ID phía TikTok.
   * Danh mục/thương hiệu được đồng bộ ở luồng riêng nên có thể chưa tồn tại —
   * khi đó bỏ trống FK và vẫn còn `tiktok*Id` + tên để hiển thị.
   */
  private async linkCatalogReferences(
    tx: Prisma.TransactionClient,
    productId: string,
    shopId: string,
    mapped: MappedProduct,
  ): Promise<void> {
    const [category, brand] = await Promise.all([
      mapped.product.tiktokCategoryId
        ? tx.podProductCategory.findUnique({
            where: {
              shopId_tiktokCategoryId: {
                shopId,
                tiktokCategoryId: mapped.product.tiktokCategoryId,
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      mapped.product.tiktokBrandId
        ? tx.podProductBrand.findUnique({
            where: {
              shopId_tiktokBrandId: { shopId, tiktokBrandId: mapped.product.tiktokBrandId },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!category && !brand) return;
    await tx.podProduct.update({
      where: { id: productId },
      data: { categoryId: category?.id ?? null, brandId: brand?.id ?? null },
    });
  }
}
