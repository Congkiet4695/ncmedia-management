import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PodShopSyncType, PodSyncTrigger, Prisma } from '@prisma/client';
import { DEFAULT_BUSINESS_TIMEZONE } from '../../../common/time/business-time';
import { resolveDateRange } from '../utils/date-range.util';
import {
  PaginatedPodOrderResponseDto,
  PodOrderResponseDto,
  PodOrderStatsDto,
  PodSelectedOrderSyncItemDto,
  PodSelectedOrdersSyncResultDto,
  PodSyncTriggerResultDto,
} from '../dto/pod-order-response.dto';
import {
  PodOrderQueryDto,
  SyncSelectedPodOrdersDto,
  TriggerSyncDto,
  UpdatePodOrderDesignAmountDto,
} from '../dto/pod-order-query.dto';
import { PodShopSyncStatusListDto, PodShopSyncStatusQueryDto } from '../dto/pod-shop-sync-status.dto';
import {
  PodOrderNotFoundException,
  PodTiktokAccountNotFoundException,
  PodTiktokSyncInProgressException,
} from '../exceptions/pod-tiktok.exceptions';
import { PodOrderResponseMapper } from '../mappers/pod-order-response.mapper';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from './pod-access-scope.service';
import { PodOrderDesignResolver } from './pod-order-design-resolver.service';
import { PodOrderProductImageResolver } from './pod-order-product-image.resolver';
import { PodOrderRepository } from '../repositories/pod-order.repository';
import { PodOrderFinanceService } from './pod-order-finance.service';
import { PodShopSyncStatusRepository } from '../repositories/pod-shop-sync-status.repository';
import { PodShopSyncStatusService } from './pod-shop-sync-status.service';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodOrderSyncService, type SelectedOrderRef } from './pod-order-sync.service';
import { OrderSyncHookRegistry } from '../../../common/hooks/order-sync-hook.registry';
import { runWithBoundedConcurrency } from '../shared/bounded-concurrency';
import { PodSyncOrchestratorService } from './pod-sync-orchestrator.service';

/**
 * PodOrderService — nghiệp vụ đọc đơn TikTok và kích hoạt đồng bộ thủ công.
 * Tất cả method nhận `organizationId` từ JWT (tenant isolation — ADR-004).
 */
@Injectable()
export class PodOrderService {
  private readonly logger = new Logger(PodOrderService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly repo: PodOrderRepository,
    private readonly syncStatusRepo: PodShopSyncStatusRepository,
    private readonly syncStatusService: PodShopSyncStatusService,
    private readonly accountRepo: PodTiktokAccountRepository,
    private readonly mapper: PodOrderResponseMapper,
    private readonly syncService: PodOrderSyncService,
    private readonly orchestrator: PodSyncOrchestratorService,
    /** Ghép line item → Product Mapping để lấy design (đơn chỉ ĐỌC, không sở hữu design). */
    private readonly designResolver: PodOrderDesignResolver,
    private readonly productImageResolver: PodOrderProductImageResolver,
    private readonly accessScope: PodAccessScopeService,
    private readonly finance: PodOrderFinanceService,
    /** Hook sau đồng bộ (ánh xạ tự động của Fulfillment) — dùng cho "Sync Orders theo lựa chọn". */
    private readonly syncHooks: OrderSyncHookRegistry,
  ) {}

  /**
   * Hạn chót bắt đầu shop mới của "Sync Orders theo lựa chọn" (ms). Shop đã bắt đầu thì chạy nốt
   * (≤ 2 lời gọi Get Order Detail), nên tổng thời gian vẫn nằm dưới timeout 290s của trình duyệt.
   */
  private static readonly SYNC_SELECTED_DEADLINE_MS = 150_000;

  async findAll(
    organizationId: string,
    query: PodOrderQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodOrderResponseDto> {
    // Chọn shop ngoài phạm vi ⇒ 403 ngay, thay vì danh sách rỗng khó hiểu.
    this.accessScope.assertShopAllowed(scope, query.shopId);
    this.accessScope.assertAccountAllowed(scope, query.accountId);
    this.accessScope.assertSellerFilterAllowed(scope, query.sellerId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Lọc thời gian quy đổi Ở BACKEND theo múi giờ nghiệp vụ (không filter ở frontend).
    const range = resolveDateRange(
      query.datePreset,
      this.businessTimeZone(),
      query.orderedFrom,
      query.orderedTo,
    );

    const { items, total } = await this.repo.findMany(organizationId, {
      shopScope: scope.allShops ? undefined : scope.shopIds,
      accountScope: scope.allShops ? undefined : scope.accountIds,
      page,
      limit,
      search: query.search,
      status: query.status,
      shopId: query.shopId,
      accountId: query.accountId,
      orderType: query.orderType,
      hasPodItem: query.hasPodItem,
      hasDesign: query.hasDesign,
      pushedToFulfillment: query.pushedToFulfillment,
      sellerId: query.sellerId,
      orderedFrom: range.from,
      orderedBefore: range.before,
      sortBy: query.sortBy ?? 'orderedAt',
      sortOrder: query.sortOrder ?? 'desc',
    });

    // 🔴 Design đọc từ Product Mapping — MỘT truy vấn cho cả trang, không N+1.
    // 🔴 Hai resolver chạy song song, mỗi cái MỘT truy vấn cho cả trang — không N+1.
    const [designs, productImages, financials] = await Promise.all([
      this.designResolver.resolveForOrders(organizationId, items),
      this.productImageResolver.resolveForOrders(organizationId, items),
      // Tiền thu về · giá vốn · lợi nhuận — MỘT lô truy vấn cho cả trang.
      this.finance.summarize(organizationId, items),
    ]);

    return {
      items: items.map((order) =>
        this.mapper.toListItem(order, designs, productImages, financials),
      ),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async findOne(
    organizationId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<PodOrderResponseDto> {
    const order = await this.repo.findById(organizationId, id);
    if (!order) throw new PodOrderNotFoundException();
    // 🔴 Lọc danh sách chưa đủ: `/orders/{id}` vẫn gọi thẳng được bằng id đoán ra.
    this.accessScope.assertShopAllowed(scope, order.shopId);

    const [designs, productImages, financials] = await Promise.all([
      this.designResolver.resolveForOrders(organizationId, [order]),
      this.productImageResolver.resolveForOrders(organizationId, [order]),
      this.finance.summarize(organizationId, [order]),
    ]);
    return this.mapper.toResponse(order, designs, productImages, financials);
  }

  /**
   * Cập nhật Design Amount của MỘT đơn (cột Giá → "Design Amount"). Lợi nhuận được tính lại lúc đọc (ADR-014),
   * nên trả về đơn đã tính lại để giao diện hiển thị ngay.
   *
   * 🔴 Kiểm phạm vi shop TRƯỚC khi ghi — người không có `pod.shop.all` chỉ sửa được đơn của shop được gán.
   */
  async updateDesignAmount(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpdatePodOrderDesignAmountDto,
    scope: PodAccessScope,
  ): Promise<PodOrderResponseDto> {
    const order = await this.repo.findById(organizationId, id);
    if (!order) throw new PodOrderNotFoundException();
    this.accessScope.assertShopAllowed(scope, order.shopId);

    const next = new Prisma.Decimal(dto.designAmount);
    const previous = await this.repo.updateDesignAmount(organizationId, order.id, next, actorUserId);
    if (previous === null) throw new PodOrderNotFoundException();
    this.logger.log({
      module: 'pod-tiktok',
      operation: 'order.update-design-amount',
      organizationId,
      orderId: order.id,
      previous: previous.toString(),
      next: next.toString(),
      actorUserId,
      msg: 'Đã cập nhật Design Amount của đơn',
    });
    return this.findOne(organizationId, order.id, scope);
  }

  /**
   * Thống kê cho các thẻ ở đầu màn hình danh sách.
   *
   * 🔴 Nhận ĐÚNG bộ lọc của danh sách và quy đổi khoảng ngày bằng CÙNG một hàm
   * `resolveDateRange`. Trước đây hàm này bỏ qua mọi bộ lọc, nên lọc "hôm qua" xong bảng còn
   * 3 đơn mà thẻ vẫn ghi 1.240 — hai con số mâu thuẫn trên cùng một màn hình.
   */
  async stats(
    organizationId: string,
    query: PodOrderQueryDto = {},
    scope: PodAccessScope,
  ): Promise<PodOrderStatsDto> {
    this.accessScope.assertShopAllowed(scope, query.shopId);
    this.accessScope.assertAccountAllowed(scope, query.accountId);
    this.accessScope.assertSellerFilterAllowed(scope, query.sellerId);

    const range = resolveDateRange(
      query.datePreset,
      this.businessTimeZone(),
      query.orderedFrom,
      query.orderedTo,
    );

    const rows = await this.repo.countByStatus(organizationId, {
      shopScope: scope.allShops ? undefined : scope.shopIds,
      accountScope: scope.allShops ? undefined : scope.accountIds,
      search: query.search,
      status: query.status,
      shopId: query.shopId,
      accountId: query.accountId,
      orderType: query.orderType,
      hasPodItem: query.hasPodItem,
      hasDesign: query.hasDesign,
      pushedToFulfillment: query.pushedToFulfillment,
      sellerId: query.sellerId,
      orderedFrom: range.from,
      orderedBefore: range.before,
    });
    const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all;
      return acc;
    }, {});
    const total = rows.reduce((sum, row) => sum + row._count._all, 0);
    return { total, byStatus };
  }

  /** Latest Sync Status (đơn) — một dòng mỗi shop trong phạm vi. */
  findSyncStatus(
    organizationId: string,
    query: PodShopSyncStatusQueryDto,
    scope: PodAccessScope,
  ): Promise<PodShopSyncStatusListDto> {
    return this.syncStatusService.findLatest(organizationId, PodShopSyncType.ORDER, scope, query.shopId);
  }

  /**
   * Đồng bộ thủ công.
   *
   * - Có `shopId` → chỉ đồng bộ shop đó (kiểm tra thuộc đúng Organization).
   * - Không có `shopId` → chạy toàn bộ (dùng lại orchestrator, có khoá toàn cục).
   */
  async triggerSync(
    organizationId: string,
    userId: string,
    dto: TriggerSyncDto,
  ): Promise<PodSyncTriggerResultDto> {
    // 🔴 Truyền organizationId để CHỈ đồng bộ shop của tổ chức người dùng —
    // không được kích hoạt đồng bộ (và tiêu thụ quota TikTok) cho tổ chức khác.
    if (!dto.shopId) {
      return this.orchestrator.runAll(PodSyncTrigger.MANUAL, organizationId, {
        backfill: dto.backfill,
        force: dto.force,
        triggeredBy: userId,
      });
    }

    const shop = await this.accountRepo.findShopForSync(organizationId, dto.shopId);
    if (!shop) throw new PodTiktokAccountNotFoundException();

    // Dọn nhật ký treo TRƯỚC khi kiểm tra: tiến trình chết giữa chừng để lại dòng
    // RUNNING vĩnh viễn, khiến người dùng không bao giờ bấm đồng bộ lại được cho shop
    // này (khoá Redis đã tự hết hạn từ lâu). `runAll` cũng dọn theo cách này.
    const deadlineMs = this.config.get<number>('tiktok.sync.runDeadlineMs', 240_000);
    await this.syncStatusRepo.failStaleRuns(
      PodShopSyncType.ORDER,
      new Date(Date.now() - 2 * deadlineMs),
    );

    if (await this.syncStatusRepo.isRunning(organizationId, dto.shopId, PodShopSyncType.ORDER)) {
      throw new PodTiktokSyncInProgressException();
    }

    const started = Date.now();
    const outcome = await this.syncService.syncShop(shop, {
      trigger: dto.backfill ? PodSyncTrigger.BACKFILL : PodSyncTrigger.MANUAL,
      triggeredBy: userId,
      // `lookbackMinutes` chỉ có nghĩa với pha INCREMENTAL — backfill quét theo create_time.
      lookbackMinutes: dto.backfill ? undefined : dto.lookbackMinutes,
      force: dto.force,
      backfill: dto.backfill,
    });

    return {
      shopsTotal: 1,
      shopsSucceeded: outcome.status === 'SUCCESS' ? 1 : 0,
      shopsFailed: outcome.status === 'SUCCESS' || outcome.status === 'SKIPPED' ? 0 : 1,
      ordersCreated: outcome.created,
      ordersUpdated: outcome.updated,
      ordersSkipped: outcome.skipped,
      ordersFailed: outcome.failed,
      durationMs: Date.now() - started,
      skippedByLock: outcome.status === 'SKIPPED',
    };
  }

  /**
   * **Sync Orders** cho các đơn đang chọn — kéo lại từng đơn từ TikTok (Get Order Detail).
   *
   * 🔴 Không tin danh sách ID từ client:
   *  1. Gộp ID trùng.
   *  2. Đọc lại đơn từ DB lọc theo `organizationId` của JWT — ID tổ chức khác không tồn tại với
   *     người gọi (trả `ORDER_NOT_FOUND`, không lộ là có tồn tại).
   *  3. Áp phạm vi shop (`assertShopAllowed`) — Seller chỉ đồng bộ được đơn của shop mình; đơn
   *     ngoài phạm vi trả CÙNG mã `ORDER_NOT_FOUND` như danh sách/chi tiết vốn ẩn chúng.
   *
   * 🔴 Chống bão request: chia theo shop, shop chạy song song có trần (`tiktok.sync.maxConcurrency`
   * — đúng trần của đồng bộ shop), trong một shop gọi tuần tự theo lô 50. Mỗi shop giữ khoá
   * đồng bộ của nó nên bấm hai lần / chạy cùng cron không bao giờ chạy chồng.
   *
   * Thành công một phần: một đơn / một shop hỏng không làm hỏng phần còn lại.
   */
  async syncSelected(
    organizationId: string,
    dto: SyncSelectedPodOrdersDto,
    scope: PodAccessScope,
  ): Promise<PodSelectedOrdersSyncResultDto> {
    const started = Date.now();
    const orderIds = [...new Set(dto.orderIds)];
    const rows = await this.repo.findSyncRefsByIds(organizationId, orderIds);

    const results = new Map<string, PodSelectedOrderSyncItemDto>();
    const byShop = new Map<string, SelectedOrderRef[]>();
    for (const row of rows) {
      if (!this.isShopInScope(scope, row.shopId)) continue;
      const refs = byShop.get(row.shopId) ?? [];
      refs.push({ id: row.id, tiktokOrderId: row.tiktokOrderId });
      byShop.set(row.shopId, refs);
    }

    let created = 0;
    let updated = 0;
    const shopIds = [...byShop.keys()];
    const outcomes = await runWithBoundedConcurrency(
      shopIds,
      {
        limit: this.config.get<number>('tiktok.sync.maxConcurrency', 4),
        // Hạn chót của request: shop CHƯA bắt đầu khi hết giờ không chạy nữa (trả DEADLINE_EXCEEDED)
        // ⇒ backend luôn trả lời trước timeout của trình duyệt (290s) và Nginx (300s).
        deadlineAt: started + PodOrderService.SYNC_SELECTED_DEADLINE_MS,
        onDeadline: (shopId) =>
          (byShop.get(shopId) ?? []).map((ref) => ({
            ...ref,
            status: 'FAILED' as const,
            errorCode: 'DEADLINE_EXCEEDED',
            errorMessage: 'Hết thời gian xử lý của lượt này — chọn lại đơn và đồng bộ tiếp.',
          })),
      },
      async (shopId) => {
        const refs = byShop.get(shopId) ?? [];
        const shop = await this.accountRepo.findShopForSync(organizationId, shopId);
        if (!shop) {
          return refs.map((ref) => ({
            ...ref,
            status: 'FAILED' as const,
            errorCode: 'SHOP_UNAVAILABLE',
            errorMessage: 'Shop của đơn này đã bị gỡ kết nối.',
          }));
        }
        const outcome = await this.syncService.syncSelectedOrders(shop, refs);
        created += outcome.created;
        updated += outcome.updated;
        return outcome.results;
      },
    );
    for (const result of outcomes.flat()) {
      results.set(result.id, {
        orderId: result.id,
        tiktokOrderId: result.tiktokOrderId,
        status: result.status,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      });
    }

    // Đơn có ghi thay đổi ⇒ báo MỘT lần cho cả tổ chức (ánh xạ tự động của Fulfillment) — cùng
    // hook mà đồng bộ shop dùng; registry tự nuốt lỗi của hook.
    if (created + updated > 0) {
      await this.syncHooks.notifyOrdersSynced({ organizationId });
    }

    // Giữ ĐÚNG thứ tự người dùng gửi; ID không đọc được (tổ chức khác / ngoài phạm vi / đã xoá).
    const ordered = orderIds.map(
      (orderId) =>
        results.get(orderId) ?? {
          orderId,
          tiktokOrderId: null,
          status: 'FAILED' as const,
          errorCode: 'ORDER_NOT_FOUND',
          errorMessage: 'Không tìm thấy đơn hoặc bạn không có quyền với đơn này.',
        },
    );
    const succeeded = ordered.filter((result) => result.status === 'SYNCED').length;
    const changed = Math.min(created + updated, succeeded);
    return {
      total: ordered.length,
      succeeded,
      failed: ordered.length - succeeded,
      updated: changed,
      unchanged: succeeded - changed,
      durationMs: Date.now() - started,
      results: ordered,
    };
  }

  /** Cùng luật với `assertShopAllowed` nhưng KHÔNG ném — để một đơn ngoài phạm vi không làm hỏng cả lô. */
  private isShopInScope(scope: PodAccessScope, shopId: string): boolean {
    try {
      this.accessScope.assertShopAllowed(scope, shopId);
      return true;
    } catch {
      return false;
    }
  }

  /** Múi giờ nghiệp vụ IANA của bộ lọc thời gian (`APP_BUSINESS_TIMEZONE`). */
  private businessTimeZone(): string {
    return this.config.get<string>('businessTimeZone', DEFAULT_BUSINESS_TIMEZONE);
  }
}
