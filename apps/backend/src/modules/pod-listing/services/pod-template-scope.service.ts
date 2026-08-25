import { Injectable, NotFoundException } from '@nestjs/common';
import { PodListingScopeMatch, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { POD_TEMPLATE_DRY_RUN_MAX_PRODUCTS } from '../constants/pod-listing.constants';
import type {
  ListingTemplateDryRunDto,
  ListingTemplateProductQueryDto,
} from '../dto/pod-template.dto';
import { LISTING_TEMPLATE_INCLUDE } from './pod-listing-template.service';
import { PodListingResolverService } from './pod-listing-resolver.service';

/** Một dòng quy tắc chọn sản phẩm (chỉ phần service cần đọc). */
export interface ScopeRule {
  matchType: PodListingScopeMatch;
  value: string | null;
  isExclude: boolean;
}

/** Kết quả chạy thử template trên một sản phẩm. */
export interface DryRunProductResult {
  productId: string;
  title: string | null;
  tiktokProductId: string;
  shopId: string;
  /** Không còn lỗi mức ERROR ⇒ sprint sau sinh draft và publish được ngay. */
  ready: boolean;
  errorCount: number;
  warningCount: number;
  variantCount: number;
  imageCount: number;
  resolvedTitle: string;
  salePrice: string | null;
  issues: Array<{ level: string; code: string; field: string; message: string }>;
}

export interface DryRunResult {
  listingTemplateId: string;
  listingTemplateName: string;
  /** Tổng số sản phẩm template đang bao phủ (không chỉ số đã chạy thử). */
  matchedProducts: number;
  testedProducts: number;
  readyProducts: number;
  products: DryRunProductResult[];
}

/**
 * PodTemplateScopeService — trả lời đúng một câu hỏi: **template này áp cho những sản phẩm nào?**
 *
 * ```
 *   Listing Template ──(scopes)──► WHERE ──► tập sản phẩm (10.000 cái cũng được)
 * ```
 *
 * 🔴 Chiều quan hệ là **Template → Product**. Sản phẩm không mang cột trỏ về template, nên:
 *
 * - Thêm một template mới không phải đụng tới một dòng sản phẩm nào.
 * - Sản phẩm mới đồng bộ về **tự động** nằm trong phạm vi của template phù hợp — không cần
 *   ai gán lại.
 * - Sprint sau chỉ việc lấy danh sách này rồi sinh draft hàng loạt; không phải sửa database.
 *
 * Ngữ nghĩa ghép quy tắc: cùng loại = **HOẶC**, khác loại = **VÀ**, dòng `isExclude` loại
 * trừ sau cùng. "Tất cả áo thun (danh mục X hoặc Y) của shop Z, trừ mã sample" viết được
 * bằng bốn dòng.
 */
@Injectable()
export class PodTemplateScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PodListingResolverService,
  ) {}

  /**
   * Dựng điều kiện WHERE từ các dòng quy tắc.
   *
   * KHÔNG có quy tắc nào ⇒ trả về điều kiện **không khớp gì cả**. Đây là lựa chọn có chủ ý:
   * một template chưa khai báo phạm vi mà lại mặc định "khớp toàn bộ kho hàng" là cái bẫy —
   * người dùng bấm sinh draft và bất ngờ tạo ra 10.000 listing. Muốn bao tất cả thì thêm
   * đúng một dòng `ALL`, tức là phải nói ra ý định đó.
   */
  buildProductWhere(organizationId: string, scopes: ScopeRule[]): Prisma.PodProductWhereInput {
    const base: Prisma.PodProductWhereInput = { organizationId, deletedAt: null };

    const includes = scopes.filter((scope) => !scope.isExclude);
    const excludes = scopes.filter((scope) => scope.isExclude);

    if (includes.length === 0) return { ...base, id: { in: [] } };

    // Cùng loại gộp thành OR; các nhóm khác loại nối bằng AND.
    const byType = new Map<PodListingScopeMatch, Prisma.PodProductWhereInput[]>();
    for (const scope of includes) {
      if (scope.matchType === PodListingScopeMatch.ALL) continue;
      const condition = this.conditionOf(scope);
      if (!condition) continue;
      byType.set(scope.matchType, [...(byType.get(scope.matchType) ?? []), condition]);
    }

    const and: Prisma.PodProductWhereInput[] = [...byType.values()].map((conditions) =>
      conditions.length === 1 ? conditions[0] : { OR: conditions },
    );

    const notConditions = excludes
      .map((scope) => this.conditionOf(scope))
      .filter((condition): condition is Prisma.PodProductWhereInput => condition !== null);

    return {
      ...base,
      ...(and.length > 0 ? { AND: and } : {}),
      ...(notConditions.length > 0 ? { NOT: { OR: notConditions } } : {}),
    };
  }

  /** Số sản phẩm template đang bao phủ. */
  async countMatchingProducts(organizationId: string, listingTemplateId: string): Promise<number> {
    const scopes = await this.loadScopes(organizationId, listingTemplateId);
    return this.prisma.podProduct.count({
      where: this.buildProductWhere(organizationId, scopes),
    });
  }

  /** Danh sách sản phẩm template đang bao phủ (phân trang). */
  async listMatchingProducts(
    organizationId: string,
    listingTemplateId: string,
    query: ListingTemplateProductQueryDto,
  ) {
    const scopes = await this.loadScopes(organizationId, listingTemplateId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.PodProductWhereInput = {
      ...this.buildProductWhere(organizationId, scopes),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { tiktokProductId: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podProduct.findMany({
        where,
        select: {
          id: true,
          tiktokProductId: true,
          title: true,
          status: true,
          categoryName: true,
          brandName: true,
          skuCount: true,
          shop: { select: { id: true, name: true, region: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podProduct.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /**
   * Chạy thử template trên vài sản phẩm THẬT — **không ghi gì vào database**.
   *
   * Đây là bằng chứng chạy được cho câu "một template áp cho nhiều sản phẩm": cùng một
   * template, nhiều sản phẩm khác nhau, mỗi sản phẩm ra một listing đã giải xong với tiêu
   * đề / ảnh / biến thể / giá của riêng nó.
   */
  async dryRun(
    organizationId: string,
    listingTemplateId: string,
    dto: ListingTemplateDryRunDto,
  ): Promise<DryRunResult> {
    const template = await this.prisma.podListingTemplate.findFirst({
      where: { id: listingTemplateId, organizationId, deletedAt: null },
      include: LISTING_TEMPLATE_INCLUDE,
    });
    if (!template) {
      throw new NotFoundException({
        code: 'POD_LISTING_TEMPLATE_NOT_FOUND',
        message: 'Không tìm thấy Listing Template',
      });
    }

    const scopes = template.scopes.map((scope) => ({
      matchType: scope.matchType,
      value: scope.value,
      isExclude: scope.isExclude,
    }));
    const where = this.buildProductWhere(organizationId, scopes);
    const limit = Math.min(dto.limit ?? 5, POD_TEMPLATE_DRY_RUN_MAX_PRODUCTS);

    const [matchedProducts, products] = await Promise.all([
      this.prisma.podProduct.count({ where }),
      this.prisma.podProduct.findMany({
        where: dto.productIds?.length
          ? { id: { in: dto.productIds }, organizationId, deletedAt: null }
          : where,
        select: { id: true, tiktokProductId: true, title: true, shopId: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const results: DryRunProductResult[] = [];
    for (const product of products) {
      const resolved = await this.resolver.resolve(organizationId, {
        template,
        productId: product.id,
        shopId: product.shopId,
      });

      const errorCount = resolved.issues.filter((issue) => issue.level === 'ERROR').length;
      results.push({
        productId: product.id,
        title: product.title,
        tiktokProductId: product.tiktokProductId,
        shopId: product.shopId,
        ready: errorCount === 0,
        errorCount,
        warningCount: resolved.issues.length - errorCount,
        variantCount: resolved.payload.variants.length,
        imageCount: resolved.payload.images.length,
        resolvedTitle: resolved.payload.title,
        salePrice: resolved.payload.variants[0]?.salePrice ?? null,
        issues: resolved.issues,
      });
    }

    return {
      listingTemplateId: template.id,
      listingTemplateName: template.name,
      matchedProducts,
      testedProducts: results.length,
      readyProducts: results.filter((result) => result.ready).length,
      products: results,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async loadScopes(
    organizationId: string,
    listingTemplateId: string,
  ): Promise<ScopeRule[]> {
    const template = await this.prisma.podListingTemplate.findFirst({
      where: { id: listingTemplateId, organizationId, deletedAt: null },
      select: { scopes: { select: { matchType: true, value: true, isExclude: true } } },
    });
    if (!template) {
      throw new NotFoundException({
        code: 'POD_LISTING_TEMPLATE_NOT_FOUND',
        message: 'Không tìm thấy Listing Template',
      });
    }
    return template.scopes;
  }

  /** Một dòng quy tắc ⇒ một điều kiện Prisma. Dòng thiếu giá trị bị bỏ qua. */
  private conditionOf(scope: ScopeRule): Prisma.PodProductWhereInput | null {
    const value = scope.value?.trim();

    switch (scope.matchType) {
      case PodListingScopeMatch.ALL:
        return null;
      case PodListingScopeMatch.CATEGORY:
        return value ? { tiktokCategoryId: value } : null;
      case PodListingScopeMatch.BRAND:
        return value ? { tiktokBrandId: value } : null;
      case PodListingScopeMatch.SHOP:
        return value ? { shopId: value } : null;
      case PodListingScopeMatch.TITLE_KEYWORD:
        return value ? { title: { contains: value, mode: 'insensitive' } } : null;
      case PodListingScopeMatch.SELLER_SKU_PREFIX:
        return value ? { variants: { some: { sellerSku: { startsWith: value } } } } : null;
      case PodListingScopeMatch.PRODUCT_STATUS:
        return value ? { status: value } : null;
    }
  }
}
