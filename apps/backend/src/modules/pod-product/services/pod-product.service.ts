import { Injectable, NotFoundException } from '@nestjs/common';
import { PodProductSyncStatus, PodProductSyncTrigger, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  SHOP_CONNECTION_SELECT,
  connectionNameOf,
} from '../../pod-tiktok/shared/shop-identity';
import { POD_PRODUCT_ACTIVE_STATUS } from '../constants/pod-product.constants';
import type {
  PaginatedPodProductVariantDto,
  PaginatedPodProductResponseDto,
  PaginatedPodProductSyncHistoryDto,
  PodProductDetailDto,
  PodProductSyncResultDto,
} from '../dto/pod-product-response.dto';
import type {
  PodProductVariantQueryDto,
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
      includeInactive: query.includeInactive,
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

  /**
   * Danh sách SKU có phân trang — nguồn của bộ chọn SKU ở Flash Sale (`Per Variant`).
   *
   * 🔴 Phạm vi shop được áp ở HAI chỗ, cố ý: `assertShopAllowed` cho bộ lọc người dùng gửi
   * lên (403 rõ ràng thay vì danh sách rỗng khó hiểu), và `shopScope` cho trường hợp không
   * gửi bộ lọc nào.
   */
  async findVariants(
    organizationId: string,
    query: PodProductVariantQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodProductVariantDto> {
    this.accessScope.assertShopAllowed(scope, query.shopId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { items, total } = await this.repo.findVariants(organizationId, {
      page,
      limit,
      search: query.search,
      shopId: query.shopId,
      productId: query.productId,
      shopScope: scope.allShops ? undefined : scope.shopIds,
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        productId: row.productId,
        productTitle: row.product.title,
        variantName: row.variantName,
        sellerSku: row.sellerSku,
        tiktokSkuId: row.tiktokSkuId,
        // 🔴 Cùng luật chọn giá gốc với `PodFlashSaleItemService`: `salePrice` (giá ĐANG bán)
        // trước, lùi về `listPrice`. Bộ chọn phải hiện ĐÚNG con số mà backend sẽ dùng để
        // tính giá deal, nếu không người dùng thấy một giá và hệ thống tính theo giá khác.
        originalPrice: row.salePrice
          ? Number(row.salePrice)
          : row.listPrice
            ? Number(row.listPrice)
            : null,
        currency: row.currency,
        imageUrl: row.imageUrl,
        status: row.status,
      })),
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
  /**
   * "Sync Now" — đồng bộ thủ công.
   *
   * 🔴 **Bị chặn theo phạm vi shop của người bấm.** Trước đây hàm này nhận thẳng
   * `accountId`/`shopId` từ request và không đi qua `PodAccessScopeService`, nên bỏ trống bộ
   * lọc là quét MỌI shop của tổ chức. Đó là lý do quyền `pod.product.sync` từng phải giữ
   * riêng cho Admin — không phải vì Seller không cần đồng bộ, mà vì đường này chưa an toàn
   * để trao. Vá đúng chỗ đó rồi thì quyền mới trao được.
   *
   * Hai lớp, không gộp:
   *  1. `assertShopAllowed` / `assertAccountAllowed` — bộ lọc người dùng GỬI LÊN phải nằm
   *     trong phạm vi, nếu không trả 403 rõ ràng thay vì một kết quả rỗng khó hiểu.
   *  2. `shopIds` — hàng rào cho trường hợp KHÔNG gửi bộ lọc nào.
   */
  async triggerSync(
    organizationId: string,
    userId: string,
    dto: TriggerProductSyncDto,
    scope: PodAccessScope,
  ): Promise<PodProductSyncResultDto> {
    this.accessScope.assertAccountAllowed(scope, dto.accountId);
    this.accessScope.assertShopAllowed(scope, dto.shopId);
    // 🔴 Cờ `includeCatalog` đã bị GỠ: nó cho phép bất kỳ Admin tổ chức nào ghi vào cây
    // danh mục / thương hiệu — dữ liệu nay dùng chung cho MỌI tổ chức. Đồng bộ master data
    // là việc của Super Admin (`POST /pod/master-data/sync`).

    const outcomes = await this.syncService.syncShops(
      {
        organizationId,
        accountId: dto.accountId,
        shopId: dto.shopId,
        // Admin (`allShops`) ⇒ không giới hạn. Seller ⇒ đúng những shop đã được gán.
        shopIds: scope.allShops ? undefined : scope.shopIds,
      },
      {
        trigger: PodProductSyncTrigger.MANUAL,
        triggeredBy: userId,
        full: dto.full,
      },
    );

    // 🔴 Shop hỏng KHÔNG được biến mất khỏi kết quả. Trước đây hàm này chỉ cộng các con số
    // rồi trả về, nên một lượt mà mọi shop đều hỏng vì token hết hạn vẫn ra HTTP 200 với
    // "0 sản phẩm" — và giao diện báo THÀNH CÔNG. Lỗi giữ nguyên văn để còn sửa được.
    const failedShops = outcomes.filter(
      (item) => item.status === PodProductSyncStatus.FAILED,
    );
    // `LOCKED` = shop đang có lượt đồng bộ khác chạy (khoá Redis theo shop). Không phải lỗi
    // — nhưng gộp nó vào "thành công" thì người dùng thấy "0 sản phẩm" mà không hiểu vì sao.
    const busyShops = outcomes.filter((item) => item.status === 'LOCKED');

    return {
      shopsProcessed: outcomes.length,
      shopsFailed: failedShops.length,
      shopsBusy: busyShops.length,
      productsFetched: outcomes.reduce((sum, item) => sum + item.fetched, 0),
      productsCreated: outcomes.reduce((sum, item) => sum + item.created, 0),
      productsUpdated: outcomes.reduce((sum, item) => sum + item.updated, 0),
      productsSkipped: outcomes.reduce((sum, item) => sum + item.skipped, 0),
      productsFailed: outcomes.reduce((sum, item) => sum + item.failed, 0),
      productsDeactivated: outcomes.reduce((sum, item) => sum + (item.deactivated ?? 0), 0),
      errors: failedShops.map((item) => ({
        shopId: item.shopId,
        shopName: item.shopName,
        errorCode: item.errorCode ?? null,
        errorMessage: item.errorMessage ?? null,
      })),
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
   * Điều kiện "sản phẩm ĐANG BÁN của tổ chức này" — dùng chung cho mọi bộ lọc.
   *
   * 🔴 Bộ lọc phải soi đúng tập sản phẩm mà màn hình đang hiển thị. Nếu không, dropdown sẽ
   * chào những danh mục/thương hiệu chỉ còn tồn tại ở các sản phẩm đã ngừng bán — người
   * dùng chọn vào và nhận về 0 kết quả.
   */
  private activeProductsOf(organizationId: string) {
    return {
      organizationId,
      deletedAt: null,
      status: POD_PRODUCT_ACTIVE_STATUS,
      deactivatedAt: null,
    };
  }

  /**
   * Cây danh mục TikTok đã đồng bộ (màn hình **POD → Categories** và bộ chọn danh mục
   * của Category Template).
   *
   * 🔴 Đây là dữ liệu ĐỌC TỪ TIKTOK, không phải danh mục do NCMedia tự định nghĩa, và nó
   * **TOÀN CỤC** — không nhận `organizationId` hay `shopId`. Mọi tổ chức thấy đúng một cây.
   * Đây là chỗ dễ hiểu nhầm nhất của sprint: thiếu bộ lọc tenant ở đây KHÔNG phải sơ suất
   * ADR-004 mà là bản chất của bảng (xem `PodMasterDataSyncService`).
   */
  async findCategories(
    params: {
      search?: string;
      leafOnly?: boolean;
      limit?: number;
      /** Tra CHÍNH XÁC một danh mục theo mã TikTok — dùng khi mở lại template đã lưu. */
      tiktokCategoryId?: string;
    } = {},
  ) {
    return this.prisma.podProductCategory.findMany({
      where: {
        deletedAt: null,
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
   * `distinct` giữ nguyên dù dữ liệu nay là toàn cục: TikTok vẫn trả về cùng một
   * `tiktok_attribute_id` ở nhiều bản ghi, và form không được hiện thuộc tính lặp lại.
   */
  async findCategoryAttributes(categoryRef: string) {
    const categoryIds = await this.resolveCategoryIds(categoryRef);
    if (categoryIds.length === 0) return [];

    return this.prisma.podCategoryAttribute.findMany({
      where: { categoryId: { in: categoryIds } },
      distinct: ['tiktokAttributeId'],
      orderBy: [{ isRequired: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Danh mục nội bộ ứng với một mã bất kỳ.
   *
   * UUID ⇒ chính nó. Mã TikTok ⇒ đúng MỘT bản ghi toàn cục (khoá `provider` +
   * `tiktokCategoryId`). Trả mảng để giữ nguyên hợp đồng với `findCategoryAttributes`.
   */
  private async resolveCategoryIds(categoryRef: string): Promise<string[]> {
    if (UUID_PATTERN.test(categoryRef)) return [categoryRef];

    const rows = await this.prisma.podProductCategory.findMany({
      where: { tiktokCategoryId: categoryRef, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Thương hiệu đã đồng bộ (màn hình **POD → Brands** và bộ chọn brand). **TOÀN CỤC** —
   * xem ghi chú ở `findCategories`.
   *
   * 🔴 Có **phân trang** vì TikTok có hàng chục nghìn thương hiệu: bộ chọn ở frontend tìm
   * kiếm phía server và chỉ tải đúng trang đang xem, không bao giờ tải hết.
   *
   * 🔴 **"No brand" luôn đứng đầu** danh sách, kể cả khi đang lọc: đó là lựa chọn mặc định
   * của gần như mọi mặt hàng POD, bắt người dùng cuộn tìm nó giữa 20.000 dòng là vô lý.
   */
  async findBrands(
    params: { keyword?: string; page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, params.page ?? 1);
    // Kẹp trong khoảng hợp lệ ngay tại đây: endpoint này nhận query thô (không qua DTO
    // validate) nên `limit = 0`, âm, hay 10.000 đều có thể tới. 200 là trần, 50 là mặc định.
    const pageSize = Math.min(200, Math.max(1, params.limit ?? 50));
    const keyword = params.keyword?.trim();

    const where: Prisma.PodProductBrandWhereInput = {
      deletedAt: null,
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
    shops: Array<{ id: string; name: string; connectionName: string }>;
  }> {
    const [categories, brands, statuses, shops] = await Promise.all([
      // 🔴 Bộ lọc phải đi qua quan hệ `products` CÓ `organizationId`. Bảng danh mục /
      // thương hiệu nay là toàn cục, nên `products: { some: { deletedAt: null } }` trần sẽ
      // trả về cả danh mục mà tổ chức KHÁC đang bán — vừa lộ thông tin, vừa mời người dùng
      // bấm một bộ lọc chắc chắn ra 0 kết quả.
      this.prisma.podProductCategory.findMany({
        where: { deletedAt: null, products: { some: this.activeProductsOf(organizationId) } },
        select: { id: true, localName: true, path: true },
        orderBy: { path: 'asc' },
        take: 500,
      }),
      this.prisma.podProductBrand.findMany({
        where: { deletedAt: null, products: { some: this.activeProductsOf(organizationId) } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      this.prisma.podProduct.findMany({
        where: this.activeProductsOf(organizationId),
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
        // Connection Name đi kèm để dropdown hiển thị đúng thứ người vận hành đặt tên.
        select: { id: true, name: true, ...SHOP_CONNECTION_SELECT },
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
      // 🔴 Trả CẢ HAI: dropdown dùng `connectionName` làm nhãn, `name` để phân biệt khi
      // hai kết nối được đặt tên giống nhau.
      shops: shops.map((shop) => ({
        id: shop.id,
        name: shop.name,
        connectionName: connectionNameOf(shop),
      })),
    };
  }
}
