import { insertFlashSaleItems } from './pod-flash-sale-batching';
import { Injectable, Logger } from '@nestjs/common';
import {
  PodFlashSaleItemStatus,
  PodFlashSaleLogAction,
  PodFlashSaleLogLevel,
  PodFlashSaleProductLevel,
  PodFlashSaleStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { TIKTOK_ACTIVITY_MAX_TITLE_LENGTH } from '../../tiktok-sdk/tiktok-sdk.constants';
import {
  FLASH_SALE_LIVE_STATUSES,
  FLASH_SALE_PUBLISH_FAILURES_LIMIT,
  FLASH_SALE_EDITABLE_STATUSES,
  FLASH_SALE_MAX_ITEMS,
  POD_FLASH_SALE_PROVIDER_TIKTOK,
  FLASH_SALE_WRITE_TX_OPTIONS,
} from '../constants/pod-flash-sale.constants';
import type {
  PodFlashSaleProductQueryDto,
  CreateFlashSaleDto,
  DuplicateFlashSaleDto,
  PodFlashSaleLogQueryDto,
  PodFlashSaleQueryDto,
  UpdateFlashSaleDto,
} from '../dto/pod-flash-sale.dto';
import type {
  PodFlashSaleItemDto,
  PaginatedPodFlashSaleProductDto,
  PodFlashSalePublishStatusDto,
  PaginatedPodFlashSaleDto,
  PaginatedPodFlashSaleLogDto,
  PodFlashSaleDetailDto,
  PodFlashSaleItemStatsDto,
  PodFlashSaleValidationDto,
} from '../dto/pod-flash-sale-response.dto';
import {
  PodFlashSaleInvalidStateException,
  PodFlashSaleNameTakenException,
  PodFlashSaleNotFoundException,
  PodFlashSaleProductMismatchException,
  PodFlashSaleTooManyItemsException,
} from '../exceptions/pod-flash-sale.exceptions';
import {
  countItems,
  FLASH_SALE_DETAIL_INCLUDE,
  FLASH_SALE_LIST_INCLUDE,
  isCancellable,
  isEditable,
  isPublishable,
  toFlashSaleItem,
  toFlashSaleListItem,
  computeItemStats,
  toFlashSaleLog,
  type FlashSaleDetailRow,
} from '../mappers/pod-flash-sale.mapper';
import { PodFlashSaleValidatorService } from './pod-flash-sale-validator.service';
import { parseBatchResults, summarizeBatchResults } from './pod-flash-sale-batch-results';

/** Đủ để dựng phần đầu của một đợt sale mới — dùng chung cho Create, Duplicate và Apply Template. */
export interface FlashSaleHeaderInput {
  shopId: string;
  name: string;
  description?: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  productLevel: PodFlashSaleProductLevel;
  sourceTemplateId?: string | null;
}

/**
 * PodFlashSaleService — vòng đời của MỘT đợt Flash Sale trong hệ thống.
 *
 * ```
 *   Create ──▶ Add Products ──▶ Validate ──▶ Publish ──▶ (scheduler) Sync ──▶ Ended
 *      │                                        │
 *      └── Duplicate / Save as Template ◀───────┘
 * ```
 *
 * 🔴 **Không hàm nào ở đây gọi TikTok.** Đẩy lên sàn, huỷ trên sàn và đọc lại trạng thái
 * đều nằm ở `PodFlashSalePublisherService`. Ranh giới này là thứ khiến màn hình danh sách
 * đọc được 10.000 đợt sale mà không tốn một lượt quota nào — đúng yêu cầu "Danh sách chỉ
 * đọc DB".
 *
 * 🔴 Mọi đường vào một đợt sale đi qua `get()`, nơi phép kiểm phạm vi shop được thực hiện
 * đúng MỘT lần. Rải phép kiểm ra từng method là rải cơ hội quên, và quên ở đây nghĩa là
 * seller sửa được đợt sale của shop người khác.
 */
@Injectable()
export class PodFlashSaleService {
  private readonly logger = new Logger(PodFlashSaleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: PodAccessScopeService,
    private readonly validator: PodFlashSaleValidatorService,
  ) {}

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------

  async list(
    organizationId: string,
    query: PodFlashSaleQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodFlashSaleDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // 🔴 Kiểm bộ lọc TRƯỚC khi dựng `where`: người dùng gửi `shopId` của shop người khác
    // phải nhận 403 rõ ràng, không phải một danh sách rỗng khiến họ tưởng chưa có dữ liệu.
    this.accessScope.assertShopAllowed(scope, query.shopId);
    this.accessScope.assertAccountAllowed(scope, query.accountId);

    const where: Prisma.PodFlashSaleWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      // Phạm vi là TRẦN CỨNG, bộ lọc chỉ thu hẹp thêm — xem `shopScopeFilter`. Ở đây hai
      // điều kiện cùng nằm trong một `where` nên Prisma tự AND, không có chuyện ghi đè.
      ...(scope.allShops ? {} : { shopId: { in: scope.shopIds } }),
      ...(query.shopId ? { shopId: query.shopId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.startFrom || query.startTo
        ? {
            startAt: {
              ...(query.startFrom ? { gte: new Date(query.startFrom) } : {}),
              ...(query.startTo ? { lte: new Date(query.startTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { providerFlashSaleId: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.podFlashSale.findMany({
        where,
        include: FLASH_SALE_LIST_INCLUDE,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podFlashSale.count({ where }),
    ]);

    const stats = await this.loadStats(
      organizationId,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => toFlashSaleListItem(row, stats.get(row.id))),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /**
   * Thống kê kết quả chạy cho CÁC ĐỢT CỦA TRANG HIỆN TẠI — MỘT truy vấn gộp, không N+1, không
   * nạp từng dòng về (một đợt có thể chứa hàng nghìn SKU). Cùng định nghĩa với `computeItemStats`.
   */
  async loadStats(
    organizationId: string,
    flashSaleIds: string[],
  ): Promise<Map<string, PodFlashSaleItemStatsDto>> {
    const result = new Map<string, PodFlashSaleItemStatsDto>();
    if (flashSaleIds.length === 0) return result;

    const rows = await this.prisma.$queryRaw<
      Array<{
        flash_sale_id: string;
        total_items: bigint;
        published_items: bigint;
        failed_items: bigint;
        removed_items: bigint;
        total_products: bigint;
        published_products: bigint;
        failed_products: bigint;
      }>
    >`
      SELECT
        flash_sale_id,
        COUNT(*) AS total_items,
        COUNT(*) FILTER (WHERE status = 'PUBLISHED') AS published_items,
        COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_items,
        COUNT(*) FILTER (WHERE status = 'REMOVED') AS removed_items,
        COUNT(DISTINCT product_id) AS total_products,
        COUNT(DISTINCT product_id) FILTER (WHERE status = 'PUBLISHED') AS published_products,
        COUNT(DISTINCT product_id) FILTER (WHERE status = 'FAILED') AS failed_products
      FROM pod_flash_sale_items
      WHERE organization_id = ${organizationId}::uuid
        AND flash_sale_id IN (${Prisma.join(flashSaleIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY flash_sale_id
    `;

    for (const row of rows) {
      const totalItems = Number(row.total_items);
      const publishedItems = Number(row.published_items);
      const failedItems = Number(row.failed_items);
      const removedItems = Number(row.removed_items);
      result.set(row.flash_sale_id, {
        totalItems,
        publishedItems,
        failedItems,
        removedItems,
        pendingItems: totalItems - publishedItems - failedItems - removedItems,
        totalProducts: Number(row.total_products),
        publishedProducts: Number(row.published_products),
        failedProducts: Number(row.failed_products),
      });
    }
    return result;
  }

  /**
   * Nạp một đợt sale, ĐÃ kiểm phạm vi shop.
   *
   * Cửa vào duy nhất của mọi thao tác trên một đợt sale. `scope` bắt buộc — tiến trình nền
   * truyền `POD_SCOPE_SYSTEM`, và CHỈ tiến trình nền.
   */
  async get(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<FlashSaleDetailRow> {
    const row = await this.prisma.podFlashSale.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: FLASH_SALE_DETAIL_INCLUDE,
    });
    if (!row) throw new PodFlashSaleNotFoundException();

    this.accessScope.assertShopAllowed(scope, row.shopId);
    return row;
  }

  async getDetail(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodFlashSaleDetailDto> {
    return this.toDetail(await this.get(organizationId, id, scope));
  }

  /** Dựng response chi tiết từ một bản ghi đã nạp — dùng lại ở mọi endpoint trả về chi tiết. */
  toDetail(row: FlashSaleDetailRow): PodFlashSaleDetailDto {
    const validation = this.validateRow(row);
    const active = row.items.filter((item) => item.status !== PodFlashSaleItemStatus.REMOVED);
    return {
      ...toFlashSaleListItem(row, computeItemStats(row.items)),
      // Chỉ id sản phẩm (đã lọc trùng, giữ thứ tự thêm) — không kèm dòng.
      productIds: [...new Set(active.map((item) => item.productId))],
      currency: active[0]?.currency ?? null,
      counts: countItems(row.items),
      validation,
      editable: isEditable(row.status),
      publishable: isPublishable(row.status) && validation.ok,
      cancellable: isCancellable(row.status),
    };
  }

  /** Kiểm tra một bản ghi đã nạp (không truy vấn thêm). */
  validateRow(row: FlashSaleDetailRow, now: Date = new Date()): PodFlashSaleValidationDto {
    const result = this.validator.validate(
      { id: row.id, shopId: row.shopId, name: row.name, startAt: row.startAt, endAt: row.endAt, items: row.items },
      now,
    );
    return {
      flashSaleId: row.id,
      ok: result.ok,
      issues: result.issues,
      readyItems: result.readyItemIds.length,
    };
  }

  /**
   * Kiểm RIÊNG các dòng (bỏ qua tên/khung giờ) — dùng cho đợt ĐANG CHẠY, nơi giờ bắt đầu đã qua
   * là bình thường. Cùng bộ luật dòng với `validateRow`.
   */
  validateItemsOnly(row: FlashSaleDetailRow): { issues: PodFlashSaleValidationDto['issues']; readyItemIds: string[] } {
    return this.validator.validateItems(row.items, row.shopId);
  }

  async validate(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodFlashSaleValidationDto> {
    return this.validateRow(await this.get(organizationId, id, scope));
  }

  async listLogs(
    organizationId: string,
    id: string,
    query: PodFlashSaleLogQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodFlashSaleLogDto> {
    // Kiểm phạm vi qua `get()` trước khi lộ bất kỳ dòng log nào — log chứa payload đã gửi
    // lên sàn, không phải dữ liệu công khai.
    await this.get(organizationId, id, scope);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PodFlashSaleLogWhereInput = { flashSaleId: id, organizationId };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.podFlashSaleLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podFlashSaleLog.count({ where }),
    ]);

    return {
      items: rows.map(toFlashSaleLog),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  // ---------------------------------------------------------------------------
  // Ghi
  // ---------------------------------------------------------------------------

  async create(
    organizationId: string,
    userId: string,
    dto: CreateFlashSaleDto,
    scope: PodAccessScope,
  ): Promise<FlashSaleDetailRow> {
    this.accessScope.assertShopAllowed(scope, dto.shopId);
    const accountId = await this.resolveAccountId(organizationId, dto.shopId);

    const name = await this.ensureUniqueName(organizationId, dto.shopId, dto.name, null);

    const created = await this.prisma.podFlashSale.create({
      data: {
        organizationId,
        accountId,
        shopId: dto.shopId,
        provider: POD_FLASH_SALE_PROVIDER_TIKTOK,
        name,
        description: dto.description ?? null,
        status: PodFlashSaleStatus.DRAFT,
        productLevel: dto.productLevel ?? PodFlashSaleProductLevel.VARIATION,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        timezone: dto.timezone ?? 'UTC',
        createdBy: userId,
        updatedBy: userId,
      },
      include: FLASH_SALE_DETAIL_INCLUDE,
    });

    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.create',
      organizationId,
      flashSaleId: created.id,
      shopId: dto.shopId,
      msg: 'Đã tạo Flash Sale ở trạng thái DRAFT',
    });
    return created;
  }

  async update(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdateFlashSaleDto,
    scope: PodAccessScope,
  ): Promise<FlashSaleDetailRow> {
    const current = await this.get(organizationId, id, scope);
    this.assertEditable(current.status, 'sửa Flash Sale');

    const name =
      dto.name === undefined
        ? undefined
        : await this.ensureUniqueName(organizationId, current.shopId, dto.name, id);

    // Đổi mức áp dụng sang PRODUCT ⇒ gộp các dòng SKU của cùng một sản phẩm. Làm TRƯỚC khi
    // ghi cột `productLevel` để không tồn tại khoảnh khắc nào dữ liệu mâu thuẫn với mức đã khai.
    if (dto.productLevel && dto.productLevel !== current.productLevel) {
      await this.applyProductLevelChange(current, dto.productLevel, userId);
    }

    await this.prisma.podFlashSale.update({
      where: { id },
      data: {
        ...(name === undefined ? {} : { name }),
        ...(dto.description === undefined ? {} : { description: dto.description }),
        ...(dto.startAt === undefined ? {} : { startAt: new Date(dto.startAt) }),
        ...(dto.endAt === undefined ? {} : { endAt: new Date(dto.endAt) }),
        ...(dto.timezone === undefined ? {} : { timezone: dto.timezone }),
        ...(dto.productLevel === undefined ? {} : { productLevel: dto.productLevel }),
        updatedBy: userId,
      },
    });

    return this.get(organizationId, id, scope);
  }

  /**
   * Xoá mềm.
   *
   * 🔴 Đợt sale ĐANG CHẠY trên sàn không được xoá thẳng: bản ghi biến mất khỏi hệ thống
   * nhưng khuyến mãi vẫn chạy trên TikTok, và không ai còn đường tắt nó. Phải Cancel trước.
   */
  async remove(
    organizationId: string,
    userId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<void> {
    const current = await this.get(organizationId, id, scope);
    if (
      current.status === PodFlashSaleStatus.RUNNING ||
      current.status === PodFlashSaleStatus.PUBLISHING
    ) {
      throw new PodFlashSaleInvalidStateException('xoá Flash Sale', current.status);
    }

    await this.prisma.podFlashSale.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
  }

  /**
   * Nhân bản một đợt sale.
   *
   * Đây là nghiệp vụ TRỌNG TÂM của sprint: "mỗi ngày chỉ mất khoảng 10 giây để tạo Flash
   * Sale mới". Bản sao mang theo TOÀN BỘ sản phẩm, giá deal, % giảm và giới hạn mua; người
   * dùng chỉ còn sửa tên và giờ.
   *
   * 🔴 KHÔNG sao chép: `providerFlashSaleId`, `status`, `publishedAt`, số lần retry, lỗi cũ
   * và mọi dòng nhật ký. Bản sao là một đợt sale MỚI ở trạng thái DRAFT — mang theo id phía
   * sàn sẽ khiến hai bản ghi cùng trỏ vào một hoạt động TikTok.
   */
  async duplicate(
    organizationId: string,
    userId: string,
    id: string,
    dto: DuplicateFlashSaleDto,
    scope: PodAccessScope,
  ): Promise<FlashSaleDetailRow> {
    const source = await this.get(organizationId, id, scope);

    const targetShopId = dto.shopId ?? source.shopId;
    this.accessScope.assertShopAllowed(scope, targetShopId);
    const accountId = await this.resolveAccountId(organizationId, targetShopId);

    // Giữ nguyên ĐỘ DÀI đợt khi người dùng chỉ đổi giờ bắt đầu — đợt sale 6 tiếng nhân bản
    // ra phải vẫn là 6 tiếng, không phải kết thúc theo giờ của hôm qua.
    const durationMs = source.endAt.getTime() - source.startAt.getTime();
    const startAt = dto.startAt ? new Date(dto.startAt) : source.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : new Date(startAt.getTime() + durationMs);

    const name = await this.ensureUniqueName(
      organizationId,
      targetShopId,
      dto.name ?? this.copyName(source.name),
      null,
    );

    // 🔴 Chép ĐỦ mọi dòng của bản gốc — kể cả dòng `FAILED` và `REMOVED`. Đó là CẤU HÌNH người
    // vận hành đã chọn; việc sàn gỡ/từ chối một dòng ở đợt CŨ không có nghĩa là họ muốn bỏ nó
    // ở đợt MỚI (FAILED ≠ DELETE). Trước đây bản sao bỏ qua dòng `REMOVED`, cộng với lỗi mất dòng
    // khi đồng bộ sản phẩm, là lý do "duplicate thiếu product/variant".
    const items = source.items;
    if (items.length > FLASH_SALE_MAX_ITEMS) throw new PodFlashSaleTooManyItemsException(FLASH_SALE_MAX_ITEMS);

    // Nhân bản sang shop khác: sản phẩm của shop nguồn không tồn tại ở shop đích, nên các
    // khoá ngoại sẽ trỏ sai. Chặn thẳng thay vì tạo ra một đợt sale hỏng âm thầm.
    if (targetShopId !== source.shopId) {
      await this.assertItemsBelongToShop(
        organizationId,
        targetShopId,
        items.map((item) => item.productId),
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const flashSale = await tx.podFlashSale.create({
        data: {
          organizationId,
          accountId,
          shopId: targetShopId,
          provider: source.provider,
          name,
          description: source.description,
          status: PodFlashSaleStatus.DRAFT,
          productLevel: source.productLevel,
          startAt,
          endAt,
          timezone: source.timezone,
          itemCount: items.length,
          sourceTemplateId: source.sourceTemplateId,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      if (items.length > 0) {
        // Chia lô (tới 10.000 dòng) — xem FLASH_SALE_ITEM_INSERT_CHUNK.
        await insertFlashSaleItems(
          tx,
          items.map((item, index) => ({
            organizationId,
            flashSaleId: flashSale.id,
            productId: item.productId,
            variantId: item.variantId,
            skuId: item.skuId,
            originalPrice: item.originalPrice,
            flashSalePrice: item.flashSalePrice,
            discountPercent: item.discountPercent,
            currency: item.currency,
            totalPurchaseLimit: item.totalPurchaseLimit,
            customerPurchaseLimit: item.customerPurchaseLimit,
            providerProductId: item.providerProductId,
            providerVariantId: item.providerVariantId,
            // `providerSkuId` là XÁC NHẬN của sàn cho đợt cũ — bản sao chưa lên sàn nên
            // không có gì để xác nhận.
            providerSkuId: null,
            // Bản sao chưa lên sàn: mọi dòng về "sẵn sàng gửi" — trừ dòng mà giá/giới hạn còn
            // chưa hợp lệ ngay từ bản gốc (`PENDING`), giữ nguyên để người dùng thấy cần sửa.
            status:
              item.status === PodFlashSaleItemStatus.PENDING
                ? PodFlashSaleItemStatus.PENDING
                : PodFlashSaleItemStatus.READY,
            sortOrder: index,
          })),
        );
      }

      return flashSale.id;
    }, FLASH_SALE_WRITE_TX_OPTIONS);

    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.duplicate',
      organizationId,
      sourceId: id,
      flashSaleId: created,
      items: items.length,
      msg: 'Đã nhân bản Flash Sale',
    });
    return this.get(organizationId, created, scope);
  }

  // ---------------------------------------------------------------------------
  // Hỗ trợ dùng chung (các service khác trong module gọi lại)
  // ---------------------------------------------------------------------------

  /** Chặn thao tác sửa khi trạng thái không cho phép. */
  assertEditable(status: PodFlashSaleStatus, action: string): void {
    if (!FLASH_SALE_EDITABLE_STATUSES.includes(status)) {
      throw new PodFlashSaleInvalidStateException(action, status);
    }
  }

  /**
   * Được THÊM dòng không: đợt còn sửa được, hoặc đợt ĐANG CHẠY (thêm rồi gửi riêng phần mới —
   * `PodFlashSalePublisherService.pushPendingItems`). Dòng cũ không bị đụng tới.
   */
  assertCanAddItems(status: PodFlashSaleStatus): void {
    if (FLASH_SALE_EDITABLE_STATUSES.includes(status) || status === PodFlashSaleStatus.RUNNING) {
      return;
    }
    throw new PodFlashSaleInvalidStateException('thêm sản phẩm', status);
  }

  /**
   * Được SỬA/XOÁ những dòng này không.
   *
   * 🔴 Đợt ĐANG CHẠY: chỉ dòng CHƯA lên TikTok (vừa thêm, hoặc gửi hỏng). Dòng đã `PUBLISHED`
   * đang bán thật trên sàn — sửa/xoá nó ở đây mà không đổi trên sàn là để hệ thống nói một đằng,
   * TikTok bán một nẻo. Gỡ sản phẩm khỏi đợt đang chạy không thuộc phạm vi thay đổi này.
   */
  assertItemsMutable(
    flashSale: FlashSaleDetailRow,
    itemIds: string[],
    action: string,
  ): void {
    if (FLASH_SALE_EDITABLE_STATUSES.includes(flashSale.status)) return;
    if (flashSale.status !== PodFlashSaleStatus.RUNNING) {
      throw new PodFlashSaleInvalidStateException(action, flashSale.status);
    }
    const onProvider = new Set(
      flashSale.items
        .filter(
          (item) =>
            item.status === PodFlashSaleItemStatus.PUBLISHED ||
            item.status === PodFlashSaleItemStatus.REMOVED,
        )
        .map((item) => item.id),
    );
    if (itemIds.some((id) => onProvider.has(id))) {
      throw new PodFlashSaleInvalidStateException(
        `${action} (dòng đã lên TikTok — chỉ sửa/xoá được dòng chưa gửi)`,
        flashSale.status,
      );
    }
  }

  /** Shop nào ⇒ account nào. Shop không tồn tại trong tổ chức ⇒ 404 ngay. */
  async resolveAccountId(organizationId: string, shopId: string): Promise<string> {
    const shop = await this.prisma.podTiktokShop.findFirst({
      where: { id: shopId, organizationId, deletedAt: null },
      select: { accountId: true },
    });
    if (!shop) throw new PodFlashSaleProductMismatchException();
    return shop.accountId;
  }

  /** Mọi sản phẩm phải thuộc đúng shop đích. */
  async assertItemsBelongToShop(
    organizationId: string,
    shopId: string,
    productIds: string[],
  ): Promise<void> {
    if (productIds.length === 0) return;
    const unique = [...new Set(productIds)];
    const count = await this.prisma.podProduct.count({
      where: { id: { in: unique }, organizationId, shopId, deletedAt: null },
    });
    if (count !== unique.length) throw new PodFlashSaleProductMismatchException();
  }

  /** Cập nhật `itemCount` sau mỗi lần thêm/xoá dòng — cột danh sách đọc thẳng cột này. */
  /**
   * Danh sách SẢN PHẨM của một đợt sale, **phân trang theo SẢN PHẨM**, kèm SKU bên trong.
   *
   * ```
   *   Trang 1              Trang 2
   *   ▼ Product A          ▼ Product D
   *       SKU A1               SKU D1
   *       SKU A2               SKU D2
   *   ▼ Product B          ▼ Product E
   *       SKU B1               SKU E1
   * ```
   *
   * 🔴 **Đơn vị phân trang là SẢN PHẨM, không phải SKU.** Phân trang theo SKU sẽ cắt đôi một
   * sản phẩm giữa hai trang — "Black / S" ở trang 1, "Black / M" ở trang 2 — và người vận
   * hành mất khả năng nhìn một sản phẩm như một khối để đặt giá cho nó.
   *
   * 🔴 **Đúng HAI truy vấn cho mỗi trang, không phụ thuộc số sản phẩm.** Lấy trang id sản
   * phẩm trước, rồi lấy MỌI dòng của đúng những id đó trong một lượt. Cách sai kinh điển là
   * lặp qua từng sản phẩm rồi hỏi SKU của nó — 100 sản phẩm thành 101 truy vấn.
   *
   * 🔴 Không thay thế `GET /:id`. Endpoint kia vẫn trả về đợt sale đầy đủ cho phần đầu và
   * phép kiểm tra; endpoint này chỉ phục vụ BẢNG sản phẩm.
   */
  async findProductGroups(
    organizationId: string,
    id: string,
    query: PodFlashSaleProductQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodFlashSaleProductDto> {
    // Đi qua đúng cửa kiểm phạm vi shop như mọi đường khác vào một đợt sale.
    const flashSale = await this.prisma.podFlashSale.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, shopId: true },
    });
    if (!flashSale) throw new PodFlashSaleNotFoundException();
    this.accessScope.assertShopAllowed(scope, flashSale.shopId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.PodFlashSaleItemWhereInput = {
      flashSaleId: id,
      // Dòng đã bị gỡ khỏi hoạt động trên sàn không còn là hàng của đợt sale nữa.
      status: { not: PodFlashSaleItemStatus.REMOVED },
      ...(search
        ? {
            OR: [
              { product: { title: { contains: search, mode: 'insensitive' } } },
              { product: { tiktokProductId: { contains: search, mode: 'insensitive' } } },
              { skuId: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // ---- Truy vấn 1: TRANG id sản phẩm + tổng số sản phẩm ---------------------
    //
    // 🔴 `groupBy` chứ không phải `findMany` rồi lọc trùng ở bộ nhớ: một đợt 10.000 SKU chỉ
    // có vài trăm sản phẩm, và kéo cả 10.000 dòng về chỉ để đếm sản phẩm là đúng thứ phân
    // trang sinh ra để tránh.
    const groups = await this.prisma.podFlashSaleItem.groupBy({
      by: ['productId'],
      where,
      _min: { sortOrder: true },
      // Giữ đúng thứ tự người dùng đã thêm sản phẩm.
      orderBy: { _min: { sortOrder: 'asc' } },
      skip: (page - 1) * limit,
      take: limit,
    });

    const [totalProducts, totalItems] = await Promise.all([
      this.prisma.podFlashSaleItem
        .groupBy({ by: ['productId'], where })
        .then((rows) => rows.length),
      this.prisma.podFlashSaleItem.count({ where }),
    ]);

    if (groups.length === 0) {
      return {
        items: [],
        meta: { total: totalProducts, page, limit, totalPages: totalProducts === 0 ? 0 : Math.ceil(totalProducts / limit) },
        totalItems,
      };
    }

    // ---- Truy vấn 2: MỌI dòng của đúng những sản phẩm trên trang này ----------
    const productIds = groups.map((group) => group.productId);
    const rows = await this.prisma.podFlashSaleItem.findMany({
      where: { ...where, productId: { in: productIds } },
      include: FLASH_SALE_DETAIL_INCLUDE.items.include,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // Gom về từng sản phẩm, GIỮ thứ tự của trang (thứ tự `groups`, không phải thứ tự `rows`).
    const byProduct = new Map<string, PodFlashSaleItemDto[]>(
      productIds.map((productId) => [productId, []]),
    );
    for (const row of rows) byProduct.get(row.productId)?.push(toFlashSaleItem(row));

    return {
      items: productIds.map((productId) => {
        const items = byProduct.get(productId) ?? [];
        const first = items[0];
        return {
          productId,
          // Tên/ảnh/id sàn giống nhau ở mọi dòng của cùng một sản phẩm ⇒ lấy dòng đầu.
          productTitle: first?.productTitle ?? null,
          providerProductId: first?.providerProductId ?? null,
          imageUrl: first?.imageUrl ?? null,
          items,
          itemCount: items.length,
        };
      }),
      meta: {
        total: totalProducts,
        page,
        limit,
        totalPages: totalProducts === 0 ? 0 : Math.ceil(totalProducts / limit),
      },
      totalItems,
    };
  }

  /**
   * Tiến độ lượt publish — truy vấn NHẸ dành riêng cho polling.
   *
   * 🔴 Không nạp danh sách dòng. Một đợt 10.000 SKU thì `getDetail` trả về vài MB; hỏi lại
   * vài giây một lần trong suốt lượt publish là tự tạo ra một vấn đề lớn hơn vấn đề đang
   * giải. Ở đây chỉ đọc mấy cột đếm cộng hai câu `count` có index.
   *
   * Vẫn đi qua kiểm tra phạm vi shop như mọi đường khác — nhẹ không có nghĩa là không canh.
   */
  async getPublishStatus(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodFlashSalePublishStatusDto> {
    const row = await this.prisma.podFlashSale.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: {
        id: true,
        shopId: true,
        status: true,
        providerFlashSaleId: true,
        publishTotalItems: true,
        publishTotalBatches: true,
        publishDoneBatches: true,
        publishCurrentBatch: true,
        publishFailedBatch: true,
        publishStartedAt: true,
        publishFinishedAt: true,
        publishBatchResults: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        lastErrorRequestId: true,
      },
    });
    if (!row) throw new PodFlashSaleNotFoundException();
    this.accessScope.assertShopAllowed(scope, row.shopId);

    // 🔴 FAILED KHÔNG phải "còn lại": trước đây `pendingItems` = mọi dòng chưa PUBLISHED, nên SKU lỗi bị
    // hiển thị như "đang chờ" và con số "còn lại" không bao giờ giảm sau một lô hỏng.
    const [counts, failures] = await Promise.all([
      this.prisma.podFlashSaleItem.groupBy({
        by: ['status'],
        where: { flashSaleId: id },
        _count: { _all: true },
      }),
      this.prisma.podFlashSaleItem.findMany({
        where: { flashSaleId: id, status: PodFlashSaleItemStatus.FAILED },
        orderBy: [{ publishBatch: { sort: 'asc', nulls: 'last' } }, { sortOrder: 'asc' }],
        take: FLASH_SALE_PUBLISH_FAILURES_LIMIT,
        select: {
          id: true,
          publishBatch: true,
          providerProductId: true,
          providerVariantId: true,
          errorCode: true,
          error: true,
          product: { select: { title: true } },
          variant: { select: { variantName: true, sellerSku: true } },
        },
      }),
    ]);
    const countOf = (statuses: PodFlashSaleItemStatus[]) =>
      counts.filter((entry) => statuses.includes(entry.status)).reduce((sum, entry) => sum + entry._count._all, 0);
    const publishedItems = countOf([PodFlashSaleItemStatus.PUBLISHED]);
    const pendingItems = countOf([PodFlashSaleItemStatus.READY, PodFlashSaleItemStatus.PENDING]);
    const failedItems = countOf([PodFlashSaleItemStatus.FAILED]);

    const batches = parseBatchResults(row.publishBatchResults);
    const summary = summarizeBatchResults(batches);
    // `live` (PUBLISHING | RUNNING) là luật tự làm mới; "lượt đang chạy" chỉ là PUBLISHING.
    const outcome =
      batches.length === 0
        ? null
        : row.status === PodFlashSaleStatus.PUBLISHING
          ? 'RUNNING'
          : summary.failed + summary.skipped + failedItems === 0
            ? 'SUCCEEDED'
            : summary.succeeded > 0 || row.status === PodFlashSaleStatus.RUNNING
              ? 'PARTIAL'
              : 'FAILED';

    return {
      flashSaleId: row.id,
      status: row.status,
      providerFlashSaleId: row.providerFlashSaleId,
      live: FLASH_SALE_LIVE_STATUSES.includes(row.status),
      totalItems: row.publishTotalItems,
      totalBatches: row.publishTotalBatches,
      doneBatches: row.publishDoneBatches,
      currentBatch: row.publishCurrentBatch,
      failedBatch: row.publishFailedBatch,
      publishedItems,
      pendingItems,
      failedItems,
      outcome,
      run: {
        succeeded: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped,
        pending: summary.pending,
        processedBatches: summary.processedBatches,
        succeededBatches: summary.succeededBatches,
        partialBatches: summary.partialBatches,
        failedBatches: summary.failedBatches,
        skippedBatches: summary.skippedBatches,
      },
      batches,
      failures: failures.map((item) => ({
        itemId: item.id,
        batch: item.publishBatch,
        productTitle: item.product?.title ?? null,
        providerProductId: item.providerProductId,
        providerVariantId: item.providerVariantId,
        variantName: item.variant?.variantName ?? null,
        sellerSku: item.variant?.sellerSku ?? null,
        errorCode: item.errorCode,
        error: item.error,
      })),
      errorCode: row.lastErrorCode,
      errorMessage: row.lastErrorMessage,
      errorRequestId: row.lastErrorRequestId,
      startedAt: row.publishStartedAt?.toISOString() ?? null,
      finishedAt: row.publishFinishedAt?.toISOString() ?? null,
    };
  }

  async refreshItemCount(
    flashSaleId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const itemCount = await tx.podFlashSaleItem.count({
      where: { flashSaleId, status: { not: PodFlashSaleItemStatus.REMOVED } },
    });
    await tx.podFlashSale.update({ where: { id: flashSaleId }, data: { itemCount } });
    return itemCount;
  }

  /** Ghi một dòng nhật ký. Không bao giờ ném lỗi ra ngoài — ghi log hỏng không được làm hỏng nghiệp vụ. */
  async writeLog(entry: {
    organizationId: string;
    flashSaleId: string;
    action: PodFlashSaleLogAction;
    level?: PodFlashSaleLogLevel;
    message: string;
    request?: Prisma.InputJsonValue;
    response?: Prisma.InputJsonValue;
    errorCode?: string | null;
    errorMessage?: string | null;
    requestId?: string | null;
    attempt?: number;
    userId?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.podFlashSaleLog.create({
        data: {
          organizationId: entry.organizationId,
          flashSaleId: entry.flashSaleId,
          action: entry.action,
          level: entry.level ?? PodFlashSaleLogLevel.INFO,
          message: entry.message.slice(0, 2000),
          ...(entry.request === undefined ? {} : { request: entry.request }),
          ...(entry.response === undefined ? {} : { response: entry.response }),
          errorCode: entry.errorCode ?? null,
          errorMessage: entry.errorMessage?.slice(0, 2000) ?? null,
          requestId: entry.requestId ?? null,
          attempt: entry.attempt ?? 0,
          createdBy: entry.userId ?? null,
        },
      });
    } catch (error) {
      this.logger.error({
        module: 'pod-flash-sale',
        operation: 'flashSale.writeLog',
        flashSaleId: entry.flashSaleId,
        msg: `Không ghi được nhật ký Flash Sale: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Bảo đảm tên duy nhất TRONG SHOP.
   *
   * TikTok yêu cầu `title` duy nhất trong shop và trả về một lỗi khó hiểu khi trùng; bắt ở
   * đây để người dùng biết ngay lúc gõ tên, không phải lúc bấm Publish.
   */
  private async ensureUniqueName(
    organizationId: string,
    shopId: string,
    name: string,
    excludeId: string | null,
  ): Promise<string> {
    const trimmed = name.trim().slice(0, TIKTOK_ACTIVITY_MAX_TITLE_LENGTH);
    const existing = await this.prisma.podFlashSale.findFirst({
      where: {
        organizationId,
        shopId,
        name: trimmed,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) throw new PodFlashSaleNameTakenException('SHOP');
    return trimmed;
  }

  /**
   * Tên bản sao: `<tên gốc> Copy`, cắt bớt phần đầu nếu vượt trần 50 ký tự của TikTok.
   *
   * Cắt PHẦN ĐẦU chứ không cắt hậu tố: mất chữ "Copy" thì người dùng không phân biệt được
   * bản sao với bản gốc, còn mất vài ký tự cuối của tên thì vẫn nhận ra.
   */
  private copyName(name: string): string {
    const suffix = ' Copy';
    const room = TIKTOK_ACTIVITY_MAX_TITLE_LENGTH - suffix.length;
    return `${name.slice(0, room)}${suffix}`;
  }

  /**
   * Đổi mức áp dụng PRODUCT ⇄ VARIATION.
   *
   * `VARIATION → PRODUCT`: mỗi sản phẩm chỉ được có MỘT dòng. Giữ dòng có giá deal THẤP
   * NHẤT và xoá phần còn lại — chọn giá thấp nhất là lựa chọn an toàn cho người mua và là
   * điều duy nhất không cần hỏi lại người vận hành giữa chừng.
   *
   * `PRODUCT → VARIATION`: KHÔNG tự bung ra mọi biến thể. Giá của từng SKU là quyết định
   * nghiệp vụ, không phải phép suy diễn; hệ thống giữ nguyên dòng mức sản phẩm và để người
   * dùng thêm biến thể một cách tường minh.
   */
  private async applyProductLevelChange(
    current: FlashSaleDetailRow,
    target: PodFlashSaleProductLevel,
    userId: string,
  ): Promise<void> {
    if (target !== PodFlashSaleProductLevel.PRODUCT) return;

    const keepByProduct = new Map<string, { id: string; price: Prisma.Decimal }>();
    for (const item of current.items) {
      if (item.status === PodFlashSaleItemStatus.REMOVED) continue;
      const kept = keepByProduct.get(item.productId);
      if (!kept || item.flashSalePrice.lessThan(kept.price)) {
        keepByProduct.set(item.productId, { id: item.id, price: item.flashSalePrice });
      }
    }

    const keepIds = new Set([...keepByProduct.values()].map((entry) => entry.id));
    const dropIds = current.items
      .filter((item) => !keepIds.has(item.id))
      .map((item) => item.id);

    await this.prisma.$transaction(async (tx) => {
      if (dropIds.length > 0) {
        await tx.podFlashSaleItem.deleteMany({ where: { id: { in: dropIds } } });
      }
      // Dòng còn lại chuyển sang mức sản phẩm: bỏ liên kết biến thể và định danh SKU phía sàn.
      await tx.podFlashSaleItem.updateMany({
        where: { id: { in: [...keepIds] } },
        data: { variantId: null, providerVariantId: null, providerSkuId: null },
      });
      await tx.podFlashSale.update({
        where: { id: current.id },
        data: { itemCount: keepIds.size, updatedBy: userId },
      });
    });
  }
}
