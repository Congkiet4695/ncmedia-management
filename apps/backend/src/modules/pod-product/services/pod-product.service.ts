import { Injectable, NotFoundException } from '@nestjs/common';
import { PodProductSyncTrigger, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type {
  PaginatedPodProductResponseDto,
  PaginatedPodProductSyncHistoryDto,
  PodProductDetailDto,
  PodProductSyncResultDto,
} from '../dto/pod-product-response.dto';
import type {
  PodProductQueryDto,
  PodProductSyncHistoryQueryDto,
  TriggerProductSyncDto,
} from '../dto/pod-product-query.dto';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { PodProductResponseMapper } from '../mappers/pod-product-response.mapper';
import { PodProductRepository } from '../repositories/pod-product.repository';
import { PodProductSyncRepository } from '../repositories/pod-product-sync.repository';
import { PodProductCatalogService } from './pod-product-catalog.service';
import { PodProductSyncService } from './pod-product-sync.service';

/**
 * Phân biệt UUID nội bộ với mã danh mục của TikTok.
 *
 * TikTok dùng chuỗi số ("1237008"), hệ thống dùng UUID v4 — hai dạng không thể lẫn, nên một
 * endpoint nhận được cả hai mà không cần thêm tham số "kiểu mã".
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Không tìm thấy sản phẩm trong Organization (hoặc đã bị xoá). */
export class PodProductNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_PRODUCT_NOT_FOUND', message: 'Không tìm thấy sản phẩm' });
  }
}

/**
 * PodProductService — nghiệp vụ ĐỌC cho giao diện + điểm vào của đồng bộ thủ công.
 *
 * Mọi method nhận `organizationId` từ JWT (ADR-004). Public App phục vụ nhiều seller
 * nên ranh giới tenant phải tuyệt đối, kể cả ở màn hình chỉ để xem.
 */
@Injectable()
export class PodProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PodProductRepository,
    private readonly syncRepo: PodProductSyncRepository,
    private readonly mapper: PodProductResponseMapper,
    private readonly syncService: PodProductSyncService,
    private readonly catalogService: PodProductCatalogService,
    private readonly accessScope: PodAccessScopeService,
  ) {}

  async findAll(
    organizationId: string,
    query: PodProductQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodProductResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Chọn shop ngoài phạm vi ⇒ 403 ngay, thay vì trả danh sách rỗng khó hiểu.
    this.accessScope.assertShopAllowed(scope, query.shopId);
    this.accessScope.assertAccountAllowed(scope, query.accountId);

    const { items, total } = await this.repo.findMany(organizationId, {
      shopScope: scope.allShops ? undefined : scope.shopIds,
      accountScope: scope.allShops ? undefined : scope.accountIds,
      page,
      limit,
      search: query.search,
      accountId: query.accountId,
      shopId: query.shopId,
      status: query.status,
      categoryId: query.categoryId,
      brandId: query.brandId,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'desc',
    });

    return {
      items: items.map((item) => this.mapper.toListItem(item)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async findOne(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodProductDetailDto> {
    const product = await this.repo.findById(organizationId, id);
    if (!product) throw new PodProductNotFoundException();
    // 🔴 Lọc danh sách là chưa đủ: người dùng vẫn gọi thẳng được `/products/{id}` bằng id
    // đoán được. Kiểm shop của CHÍNH bản ghi vừa đọc.
    this.accessScope.assertShopAllowed(scope, product.shopId);
    return this.mapper.toDetail(product);
  }

  /**
   * Đồng bộ thủ công ("Sync Now").
   *
   * Chạy ĐỒNG BỘ (chờ xong mới trả) có chủ ý: người dùng vừa bấm nút cần thấy kết quả
   * ngay. Với shop rất lớn, lượt chạy vẫn an toàn nhờ khoá theo shop + trần số trang;
   * khi quy mô tăng, chỉ cần chuyển lời gọi này sang hàng đợi mà KHÔNG đổi nghiệp vụ.
   */
  async triggerSync(
    organizationId: string,
    userId: string,
    dto: TriggerProductSyncDto,
  ): Promise<PodProductSyncResultDto> {
    if (dto.includeCatalog) {
      // Danh mục/thương hiệu phải có TRƯỚC để sản phẩm nối được FK ngay trong lượt này.
      await this.catalogService.syncCatalogForShops({
        organizationId,
        accountId: dto.accountId,
        shopId: dto.shopId,
      });
    }

    const outcomes = await this.syncService.syncShops(
      { organizationId, accountId: dto.accountId, shopId: dto.shopId },
      {
        trigger: PodProductSyncTrigger.MANUAL,
        triggeredBy: userId,
        full: dto.full,
      },
    );

    return {
      shopsProcessed: outcomes.length,
      productsFetched: outcomes.reduce((sum, item) => sum + item.fetched, 0),
      productsCreated: outcomes.reduce((sum, item) => sum + item.created, 0),
      productsUpdated: outcomes.reduce((sum, item) => sum + item.updated, 0),
      productsSkipped: outcomes.reduce((sum, item) => sum + item.skipped, 0),
      productsFailed: outcomes.reduce((sum, item) => sum + item.failed, 0),
      historyIds: outcomes.map((item) => item.historyId).filter(Boolean),
    };
  }

  /** Đồng bộ lại đúng một sản phẩm (nút trên màn hình chi tiết). */
  async resyncOne(
    organizationId: string,
    userId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodProductDetailDto> {
    const product = await this.repo.findById(organizationId, id);
    if (!product) throw new PodProductNotFoundException();

    const targets = await this.syncRepo.findSyncTargets({ organizationId, shopId: product.shopId });
    const target = targets[0];
    if (!target) throw new PodProductNotFoundException();

    await this.syncService.syncShop(target, {
      trigger: PodProductSyncTrigger.MANUAL,
      triggeredBy: userId,
      tiktokProductId: product.tiktokProductId,
    });

    return this.findOne(organizationId, id, scope);
  }

  async findSyncHistories(
    organizationId: string,
    query: PodProductSyncHistoryQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodProductSyncHistoryDto> {
    this.accessScope.assertShopAllowed(scope, query.shopId);
    this.accessScope.assertAccountAllowed(scope, query.accountId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { items, total } = await this.syncRepo.findHistories(organizationId, {
      page,
      limit,
      accountId: query.accountId,
      shopId: query.shopId,
      shopScope: this.accessScope.shopFilter(scope)?.in,
      accountScope: this.accessScope.accountFilter(scope)?.in,
    });

    return {
      items: items.map((item) => this.mapper.toSyncHistory(item)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /**
   * Cây danh mục TikTok đã đồng bộ (màn hình **POD → Categories** và bộ chọn danh mục
   * của Category Template).
   *
   * 🔴 Đây là dữ liệu ĐỌC TỪ TIKTOK, không phải danh mục do NCMedia tự định nghĩa.
   */
  async findCategories(
    organizationId: string,
    params: {
      shopId?: string;
      search?: string;
      leafOnly?: boolean;
      limit?: number;
      /** Tra CHÍNH XÁC một danh mục theo mã TikTok — dùng khi mở lại template đã lưu. */
      tiktokCategoryId?: string;
    } = {},
  ) {
    return this.prisma.podProductCategory.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(params.shopId ? { shopId: params.shopId } : {}),
        ...(params.leafOnly ? { isLeaf: true } : {}),
        ...(params.tiktokCategoryId ? { tiktokCategoryId: params.tiktokCategoryId } : {}),
        ...(params.search
          ? {
              OR: [
                { localName: { contains: params.search, mode: 'insensitive' } },
                { path: { contains: params.search, mode: 'insensitive' } },
                { tiktokCategoryId: { contains: params.search } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        tiktokCategoryId: true,
        localName: true,
        path: true,
        level: true,
        isLeaf: true,
        syncedAt: true,
        shop: { select: { id: true, name: true } },
      },
      orderBy: [{ path: 'asc' }],
      take: params.limit ?? 500,
    });
  }

  /**
   * Thuộc tính của một danh mục — nguồn để Category Template render form ĐỘNG.
   *
   * 🔴 Nhận **cả hai loại mã**: UUID nội bộ của `pod_product_categories`, hoặc `category_id`
   * của TikTok. Category Template lưu mã TikTok (để dùng lại được cho mọi shop cùng thị
   * trường), nên nếu chỉ nhận UUID thì mở template ra sửa là không nạp được thuộc tính —
   * đúng cái lỗi "Select a category to load attributes" trong khi danh mục đã chọn rồi.
   *
   * Một mã TikTok có thể ứng với nhiều dòng cache (mỗi shop một dòng) ⇒ gộp theo
   * `tiktok_attribute_id` để form không hiện thuộc tính lặp lại.
   */
  async findCategoryAttributes(organizationId: string, categoryRef: string) {
    const categoryIds = await this.resolveCategoryIds(organizationId, categoryRef);
    if (categoryIds.length === 0) return [];

    return this.prisma.podCategoryAttribute.findMany({
      where: { organizationId, categoryId: { in: categoryIds } },
      distinct: ['tiktokAttributeId'],
      orderBy: [{ isRequired: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Danh mục nội bộ ứng với một mã bất kỳ.
   *
   * UUID ⇒ chính nó. Mã TikTok ⇒ mọi dòng cache của tổ chức mang mã đó (nhiều shop).
   */
  private async resolveCategoryIds(organizationId: string, categoryRef: string): Promise<string[]> {
    if (UUID_PATTERN.test(categoryRef)) return [categoryRef];

    const rows = await this.prisma.podProductCategory.findMany({
      where: { organizationId, tiktokCategoryId: categoryRef, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Thương hiệu đã đồng bộ (màn hình **POD → Brands** và bộ chọn brand).
   *
   * 🔴 Có **phân trang** vì một shop có thể có hàng chục nghìn thương hiệu: bộ chọn ở
   * frontend tìm kiếm phía server và chỉ tải đúng trang đang xem, không bao giờ tải hết.
   *
   * 🔴 **"No brand" luôn đứng đầu** danh sách, kể cả khi đang lọc: đó là lựa chọn mặc định
   * của gần như mọi mặt hàng POD, bắt người dùng cuộn tìm nó giữa 20.000 dòng là vô lý.
   */
  async findBrands(
    organizationId: string,
    params: { shopId?: string; keyword?: string; page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const keyword = params.keyword?.trim();

    const where: Prisma.PodProductBrandWhereInput = {
      organizationId,
      deletedAt: null,
      ...(params.shopId ? { shopId: params.shopId } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { tiktokBrandId: { contains: keyword } },
            ],
          }
        : {}),
    };

    const select = {
      id: true,
      tiktokBrandId: true,
      name: true,
      authorizedStatus: true,
      brandStatus: true,
      isNoBrand: true,
      isSystem: true,
      syncedAt: true,
      shop: { select: { id: true, name: true } },
    } satisfies Prisma.PodProductBrandSelect;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podProductBrand.findMany({
        where,
        select,
        orderBy: [{ isNoBrand: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.podProductBrand.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit: pageSize,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Bộ lọc cho màn hình danh sách: danh mục / thương hiệu / trạng thái / shop ĐANG CÓ
   * dữ liệu thật. Trả về từ dữ liệu đã đồng bộ nên dropdown không bao giờ hiện lựa chọn
   * cho ra 0 kết quả.
   */
  async findFilterOptions(
    organizationId: string,
    scope: PodAccessScope,
  ): Promise<{
    categories: Array<{ id: string; name: string }>;
    brands: Array<{ id: string; name: string }>;
    statuses: string[];
    shops: Array<{ id: string; name: string }>;
  }> {
    const [categories, brands, statuses, shops] = await Promise.all([
      this.prisma.podProductCategory.findMany({
        where: { organizationId, deletedAt: null, products: { some: { deletedAt: null } } },
        select: { id: true, localName: true, path: true },
        orderBy: { path: 'asc' },
        take: 500,
      }),
      this.prisma.podProductBrand.findMany({
        where: { organizationId, deletedAt: null, products: { some: { deletedAt: null } } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      this.prisma.podProduct.findMany({
        where: { organizationId, deletedAt: null, status: { not: null } },
        select: { status: true },
        distinct: ['status'],
        orderBy: { status: 'asc' },
      }),
      this.prisma.podTiktokShop.findMany({
        // 🔴 Dropdown shop cũng phải theo phạm vi. Để lọt shop người khác vào đây là vừa lộ
        // tên shop, vừa mời người dùng bấm vào một bộ lọc chắc chắn trả 403.
        where: {
          organizationId,
          deletedAt: null,
          ...(scope.allShops ? {} : { id: { in: scope.shopIds } }),
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      categories: categories.map((category) => ({
        id: category.id,
        name: category.path ?? category.localName ?? category.id,
      })),
      brands: brands.map((brand) => ({ id: brand.id, name: brand.name ?? brand.id })),
      statuses: statuses
        .map((row) => row.status)
        .filter((status): status is string => Boolean(status)),
      shops: shops.map((shop) => ({ id: shop.id, name: shop.name })),
    };
  }
}
