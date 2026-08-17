import { Injectable, NotFoundException } from '@nestjs/common';
import { PodProductSyncTrigger } from '@prisma/client';
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
import { PodProductResponseMapper } from '../mappers/pod-product-response.mapper';
import { PodProductRepository } from '../repositories/pod-product.repository';
import { PodProductSyncRepository } from '../repositories/pod-product-sync.repository';
import { PodProductCatalogService } from './pod-product-catalog.service';
import { PodProductSyncService } from './pod-product-sync.service';

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
  ) {}

  async findAll(
    organizationId: string,
    query: PodProductQueryDto,
  ): Promise<PaginatedPodProductResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { items, total } = await this.repo.findMany(organizationId, {
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

  async findOne(organizationId: string, id: string): Promise<PodProductDetailDto> {
    const product = await this.repo.findById(organizationId, id);
    if (!product) throw new PodProductNotFoundException();
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

    return this.findOne(organizationId, id);
  }

  async findSyncHistories(
    organizationId: string,
    query: PodProductSyncHistoryQueryDto,
  ): Promise<PaginatedPodProductSyncHistoryDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { items, total } = await this.syncRepo.findHistories(organizationId, {
      page,
      limit,
      accountId: query.accountId,
      shopId: query.shopId,
    });

    return {
      items: items.map((item) => this.mapper.toSyncHistory(item)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /**
   * Bộ lọc cho màn hình danh sách: danh mục / thương hiệu / trạng thái / shop ĐANG CÓ
   * dữ liệu thật. Trả về từ dữ liệu đã đồng bộ nên dropdown không bao giờ hiện lựa chọn
   * cho ra 0 kết quả.
   */
  async findFilterOptions(organizationId: string): Promise<{
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
        where: { organizationId, deletedAt: null },
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
