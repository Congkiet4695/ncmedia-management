import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodTiktokTokenService } from '../../pod-tiktok/services/pod-tiktok-token.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import type { TiktokCategoryNode } from '../../tiktok-sdk/types/tiktok-product.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  POD_TIKTOK_NO_BRAND_ID,
  POD_TIKTOK_NO_BRAND_NAME,
  isNoBrandName,
} from '../constants/pod-product.constants';
import { PodProductMapper } from '../mappers/pod-product.mapper';
import {
  PodProductSyncRepository,
  type ProductSyncTarget,
} from '../repositories/pod-product-sync.repository';

/** Số danh mục lá được đồng bộ thuộc tính trong một lượt (mỗi danh mục là một call). */
const CATEGORY_ATTRIBUTE_BATCH = 50;

/**
 * PodProductCatalogService — đồng bộ **dữ liệu danh mục dùng chung** của một shop:
 * cây Category, Brand và định nghĩa thuộc tính theo danh mục.
 *
 * 🔴 Vì sao tách khỏi đồng bộ sản phẩm: ba thứ này đổi rất chậm (theo tuần/tháng) trong
 * khi sản phẩm đổi hàng giờ. Gộp chung sẽ tiêu quota TikTok vô ích, mà quota lại dùng
 * chung cho toàn bộ app (App × Shop).
 *
 * 🔴 Vì sao scope theo shop: danh mục và thương hiệu phụ thuộc thị trường của shop —
 * hệ thống phục vụ nhiều seller ở nhiều thị trường (Public App).
 */
@Injectable()
export class PodProductCatalogService {
  private readonly logger = new Logger(PodProductCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncRepo: PodProductSyncRepository,
    private readonly mapper: PodProductMapper,
    private readonly productApi: TiktokProductApiService,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Đồng bộ TỪNG tài nguyên — dùng cho màn hình Resources (mỗi nút Sync một tài nguyên)
  //
  // 🔴 Vì sao tách lẻ: người vận hành cần kéo riêng cây danh mục mà không đụng tới brand
  // hay thuộc tính. Gộp cứng ba thứ vào một lệnh nghĩa là muốn làm mới danh mục thì phải
  // trả giá bằng quota của cả ba.
  // ---------------------------------------------------------------------------

  /** Chỉ đồng bộ cây danh mục của một shop. */
  async syncShopCategories(target: ProductSyncTarget): Promise<number> {
    return this.syncCategories(await this.buildContext(target), target);
  }

  /** Chỉ đồng bộ thương hiệu của một shop. */
  async syncShopBrands(target: ProductSyncTarget): Promise<number> {
    return this.syncBrands(await this.buildContext(target), target);
  }

  /**
   * Chỉ đồng bộ định nghĩa thuộc tính.
   *
   * `categoryIds` = danh mục nội bộ cần lấy thuộc tính. Bỏ trống ⇒ lấy các danh mục lá
   * đang có sản phẩm (hành vi mặc định, xem `syncCategoryAttributes`).
   */
  async syncShopCategoryAttributes(
    target: ProductSyncTarget,
    options: { categoryIds?: string[] } = {},
  ): Promise<number> {
    return this.syncCategoryAttributes(await this.buildContext(target), target, options);
  }

  /** Đồng bộ danh mục + thương hiệu (+ thuộc tính danh mục nếu bật) cho một shop. */
  async syncShopCatalog(
    target: ProductSyncTarget,
    options: { includeAttributes?: boolean } = {},
  ): Promise<{ categories: number; brands: number; attributes: number }> {
    const ctx = await this.buildContext(target);

    const categories = await this.syncCategories(ctx, target);
    const brands = await this.syncBrands(ctx, target);
    const attributes = options.includeAttributes
      ? await this.syncCategoryAttributes(ctx, target)
      : 0;

    this.logger.log({
      module: 'pod-product',
      operation: 'catalog.sync',
      organizationId: target.organizationId,
      shopId: target.id,
      categories,
      brands,
      attributes,
      msg: 'Đã đồng bộ danh mục / thương hiệu',
    });

    return { categories, brands, attributes };
  }

  /** Tìm shop rồi đồng bộ — tiện cho controller và scheduler. */
  async syncCatalogForShops(
    filter: { organizationId?: string; accountId?: string; shopId?: string },
    options: { includeAttributes?: boolean } = {},
  ): Promise<Array<{ shopId: string; categories: number; brands: number; attributes: number }>> {
    const targets = await this.syncRepo.findSyncTargets(filter);
    const results: Array<{
      shopId: string;
      categories: number;
      brands: number;
      attributes: number;
    }> = [];

    for (const target of targets) {
      try {
        results.push({ shopId: target.id, ...(await this.syncShopCatalog(target, options)) });
      } catch (error) {
        // Fail-soft: một shop hỏng không được chặn các shop còn lại.
        this.logger.error({
          module: 'pod-product',
          operation: 'catalog.sync.fail',
          organizationId: target.organizationId,
          shopId: target.id,
          msg: error instanceof Error ? error.message : 'Lỗi không xác định',
        });
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Đồng bộ cây danh mục.
   *
   * API trả về danh sách phẳng; `level` và `path` được dựng TẠI ĐÂY (một lần khi ghi)
   * để mọi truy vấn sau này khỏi phải đệ quy — danh mục TikTok sâu 4–6 tầng.
   */
  private async syncCategories(ctx: TiktokShopContext, target: ProductSyncTarget): Promise<number> {
    const { data: nodes } = await this.productApi.getCategories(ctx);
    const rows = nodes
      .map((node) => this.mapper.toCategoryRow(node))
      .filter((row): row is NonNullable<ReturnType<PodProductMapper['toCategoryRow']>> =>
        Boolean(row),
      );
    if (rows.length === 0) return 0;

    const paths = this.buildPaths(nodes);

    for (const row of rows) {
      const computed = paths.get(row.tiktokCategoryId);
      await this.prisma.podProductCategory.upsert({
        where: {
          shopId_tiktokCategoryId: {
            shopId: target.id,
            tiktokCategoryId: row.tiktokCategoryId,
          },
        },
        create: {
          organizationId: target.organizationId,
          shopId: target.id,
          ...row,
          permissionStatuses: row.permissionStatuses ?? Prisma.JsonNull,
          level: computed?.level ?? 0,
          path: computed?.path ?? row.localName,
        },
        update: {
          ...row,
          permissionStatuses: row.permissionStatuses ?? Prisma.JsonNull,
          level: computed?.level ?? 0,
          path: computed?.path ?? row.localName,
          syncedAt: new Date(),
          deletedAt: null,
        },
      });
    }

    return rows.length;
  }

  private async syncBrands(ctx: TiktokShopContext, target: ProductSyncTarget): Promise<number> {
    const brands = await this.productApi.getAllBrands(ctx);
    let count = 0;

    for (const brand of brands) {
      if (!brand.id) continue;
      const noBrand = isNoBrandName(brand.name);
      await this.prisma.podProductBrand.upsert({
        where: { shopId_tiktokBrandId: { shopId: target.id, tiktokBrandId: brand.id } },
        create: {
          organizationId: target.organizationId,
          shopId: target.id,
          tiktokBrandId: brand.id,
          name: brand.name ?? null,
          authorizedStatus: brand.authorizedStatus ?? null,
          brandStatus: brand.brandStatus ?? null,
          isNoBrand: noBrand,
        },
        update: {
          name: brand.name ?? null,
          authorizedStatus: brand.authorizedStatus ?? null,
          brandStatus: brand.brandStatus ?? null,
          isNoBrand: noBrand,
          // TikTok đã trả về thật ⇒ đây không còn là bản ghi hệ thống tự tạo.
          ...(noBrand ? { isSystem: false } : {}),
          syncedAt: new Date(),
          deletedAt: null,
        },
      });
      count += 1;
    }

    count += await this.ensureNoBrand(target);
    return count;
  }

  /**
   * Bảo đảm shop LUÔN có một lựa chọn **"No brand"**.
   *
   * 🔴 Vì sao cần: "No brand" là brand hợp lệ trong Seller Center và là lựa chọn mặc định của
   * gần như mọi mặt hàng POD, nhưng `Get Brands` không phải lúc nào cũng liệt kê nó (tuỳ
   * vùng, tuỳ quyền của app). Thiếu bản ghi này thì Category Template không có gì để chọn và
   * listing không đăng được — cổng validate đòi `brand_id`.
   *
   * Bản ghi tự tạo mang `is_system = true` và dùng `brand_id` toàn cầu của TikTok, nên
   * payload gửi đi vẫn là một id THẬT, không phải `null` hay field bị bỏ. Lần đồng bộ sau mà
   * TikTok trả về "No brand" thật thì `syncBrands` cập nhật đè lên và tắt cờ `is_system`.
   */
  private async ensureNoBrand(target: ProductSyncTarget): Promise<number> {
    const existing = await this.prisma.podProductBrand.findFirst({
      where: { shopId: target.id, isNoBrand: true, deletedAt: null },
      select: { id: true },
    });
    if (existing) return 0;

    await this.prisma.podProductBrand.upsert({
      where: {
        shopId_tiktokBrandId: { shopId: target.id, tiktokBrandId: POD_TIKTOK_NO_BRAND_ID },
      },
      create: {
        organizationId: target.organizationId,
        shopId: target.id,
        tiktokBrandId: POD_TIKTOK_NO_BRAND_ID,
        name: POD_TIKTOK_NO_BRAND_NAME,
        isNoBrand: true,
        isSystem: true,
      },
      update: { isNoBrand: true, syncedAt: new Date(), deletedAt: null },
    });

    this.logger.log({
      module: 'pod-product',
      operation: 'catalog.ensureNoBrand',
      organizationId: target.organizationId,
      shopId: target.id,
      msg: 'TikTok không trả về "No brand" — hệ thống tự tạo bản ghi để Template luôn chọn được',
    });
    return 1;
  }

  /**
   * Đồng bộ định nghĩa thuộc tính cho các danh mục LÁ **đang được dùng bởi sản phẩm**.
   *
   * 🔴 Cố ý không quét toàn bộ cây: TikTok có hàng nghìn danh mục lá, mỗi danh mục là một
   * call. Chỉ lấy phần thực sự cần (danh mục sản phẩm của shop đang nằm trong) là đủ cho
   * Template ở Sprint 3, và không đốt quota chung của app.
   */
  private async syncCategoryAttributes(
    ctx: TiktokShopContext,
    target: ProductSyncTarget,
    options: { categoryIds?: string[] } = {},
  ): Promise<number> {
    // Chỉ định danh mục cụ thể ⇒ lấy đúng chúng (người dùng vừa chọn danh mục đó trong
    // Category Template và cần thuộc tính ngay). Không chỉ định ⇒ giữ hành vi tiết kiệm
    // quota: chỉ những danh mục đang có sản phẩm, cũ nhất trước.
    //
    // 🔴 Lọc theo `tiktokCategoryId` chứ KHÔNG theo quan hệ `products`: sản phẩm thường
    // được đồng bộ TRƯỚC khi có cây danh mục, nên khoá ngoại `category_id` còn rỗng và
    // lọc theo quan hệ sẽ ra 0 danh mục — đúng cái bẫy làm cache thuộc tính luôn trống.
    const where = options.categoryIds?.length
      ? { id: { in: options.categoryIds }, shopId: target.id, deletedAt: null }
      : {
          shopId: target.id,
          isLeaf: true,
          deletedAt: null,
          tiktokCategoryId: { in: await this.categoryIdsInUse(target.id) },
        };

    const categories = await this.prisma.podProductCategory.findMany({
      where,
      select: { id: true, tiktokCategoryId: true },
      take: CATEGORY_ATTRIBUTE_BATCH,
      orderBy: { syncedAt: 'asc' },
    });

    let count = 0;
    for (const category of categories) {
      const { data: attributes } = await this.productApi.getCategoryAttributes(
        ctx,
        category.tiktokCategoryId,
      );

      for (const attribute of attributes) {
        const row = this.mapper.toCategoryAttributeRow(attribute);
        if (!row) continue;

        await this.prisma.podCategoryAttribute.upsert({
          where: {
            categoryId_tiktokAttributeId: {
              categoryId: category.id,
              tiktokAttributeId: row.tiktokAttributeId,
            },
          },
          create: {
            organizationId: target.organizationId,
            categoryId: category.id,
            ...row,
            values: row.values ?? Prisma.JsonNull,
          },
          update: { ...row, values: row.values ?? Prisma.JsonNull, syncedAt: new Date() },
        });
        count += 1;
      }
    }

    return count;
  }

  /** Mã danh mục TikTok mà sản phẩm của shop đang dùng — nguồn để chọn thuộc tính cần lấy. */
  private async categoryIdsInUse(shopId: string): Promise<string[]> {
    const rows = await this.prisma.podProduct.findMany({
      where: { shopId, deletedAt: null, tiktokCategoryId: { not: null } },
      select: { tiktokCategoryId: true },
      distinct: ['tiktokCategoryId'],
    });
    return rows
      .map((row) => row.tiktokCategoryId)
      .filter((id): id is string => Boolean(id));
  }

  /** Dựng `level` + `path` ("A > B > C") từ danh sách phẳng, an toàn với dữ liệu vòng. */
  private buildPaths(nodes: TiktokCategoryNode[]): Map<string, { level: number; path: string }> {
    const byId = new Map(nodes.filter((node) => node.id).map((node) => [node.id as string, node]));
    const result = new Map<string, { level: number; path: string }>();

    for (const node of byId.values()) {
      const names: string[] = [];
      let current: TiktokCategoryNode | undefined = node;
      const seen = new Set<string>();

      // Chặn vòng lặp vô hạn nếu TikTok trả dữ liệu cha-con vòng tròn.
      while (current?.id && !seen.has(current.id)) {
        seen.add(current.id);
        if (current.localName) names.unshift(current.localName);
        const parentId: string | undefined = current.parentId;
        current = parentId && parentId !== '0' ? byId.get(parentId) : undefined;
      }

      result.set(node.id as string, {
        level: Math.max(names.length - 1, 0),
        path: names.join(' > ').slice(0, 1024),
      });
    }

    return result;
  }

  private async buildContext(target: ProductSyncTarget): Promise<TiktokShopContext> {
    const token = await this.tokenService.ensureValidAccessToken(target.account);
    if (!token.ok) {
      throw new Error(`Không lấy được access token (${token.reason}): ${token.message}`);
    }
    return {
      accessToken: token.accessToken,
      shopCipher: this.encryption.decrypt(target.shopCipherEnc),
      shopId: target.id,
      organizationId: target.organizationId,
    };
  }
}
