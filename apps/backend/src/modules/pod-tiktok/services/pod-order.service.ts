import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PodSyncTrigger } from '@prisma/client';
import { resolveDateRange } from '../utils/date-range.util';
import {
  PaginatedPodOrderResponseDto,
  PaginatedPodSyncLogResponseDto,
  PodOrderResponseDto,
  PodOrderStatsDto,
  PodSyncTriggerResultDto,
} from '../dto/pod-order-response.dto';
import { PodOrderQueryDto, PodSyncLogQueryDto, TriggerSyncDto } from '../dto/pod-order-query.dto';
import {
  PodOrderNotFoundException,
  PodTiktokAccountNotFoundException,
  PodTiktokSyncInProgressException,
} from '../exceptions/pod-tiktok.exceptions';
import { PodOrderResponseMapper } from '../mappers/pod-order-response.mapper';
import { PodAccessScopeService, type PodAccessScope } from './pod-access-scope.service';
import { PodOrderDesignResolver } from './pod-order-design-resolver.service';
import { PodOrderRepository } from '../repositories/pod-order.repository';
import { PodSyncLogRepository } from '../repositories/pod-sync-log.repository';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodOrderSyncService } from './pod-order-sync.service';
import { PodSyncOrchestratorService } from './pod-sync-orchestrator.service';

/**
 * PodOrderService — nghiệp vụ đọc đơn TikTok và kích hoạt đồng bộ thủ công.
 * Tất cả method nhận `organizationId` từ JWT (tenant isolation — ADR-004).
 */
@Injectable()
export class PodOrderService {
  constructor(
    private readonly config: ConfigService,
    private readonly repo: PodOrderRepository,
    private readonly syncLogRepo: PodSyncLogRepository,
    private readonly accountRepo: PodTiktokAccountRepository,
    private readonly mapper: PodOrderResponseMapper,
    private readonly syncService: PodOrderSyncService,
    private readonly orchestrator: PodSyncOrchestratorService,
    /** Ghép line item → Product Mapping để lấy design (đơn chỉ ĐỌC, không sở hữu design). */
    private readonly designResolver: PodOrderDesignResolver,
    private readonly accessScope: PodAccessScopeService,
  ) {}

  async findAll(
    organizationId: string,
    query: PodOrderQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodOrderResponseDto> {
    // Chọn shop ngoài phạm vi ⇒ 403 ngay, thay vì danh sách rỗng khó hiểu.
    this.accessScope.assertShopAllowed(scope, query.shopId);
    this.accessScope.assertAccountAllowed(scope, query.accountId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Lọc thời gian quy đổi Ở BACKEND theo múi giờ vận hành (không filter ở frontend).
    const range = resolveDateRange(
      query.datePreset,
      this.config.get<number>('timezoneOffsetMinutes', 420),
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
      orderedFrom: range.from,
      orderedTo: range.to,
      sortBy: query.sortBy ?? 'orderedAt',
      sortOrder: query.sortOrder ?? 'desc',
    });

    // 🔴 Design đọc từ Product Mapping — MỘT truy vấn cho cả trang, không N+1.
    const designs = await this.designResolver.resolveForOrders(organizationId, items);

    return {
      items: items.map((order) => this.mapper.toListItem(order, designs)),
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

    const designs = await this.designResolver.resolveForOrders(organizationId, [order]);
    return this.mapper.toResponse(order, designs);
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

    const range = resolveDateRange(
      query.datePreset,
      this.config.get<number>('timezoneOffsetMinutes', 420),
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
      orderedFrom: range.from,
      orderedTo: range.to,
    });
    const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all;
      return acc;
    }, {});
    const total = rows.reduce((sum, row) => sum + row._count._all, 0);
    return { total, byStatus };
  }

  async findSyncLogs(
    organizationId: string,
    query: PodSyncLogQueryDto,
    scope: PodAccessScope,
  ): Promise<PaginatedPodSyncLogResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    this.accessScope.assertShopAllowed(scope, query.shopId);
    this.accessScope.assertAccountAllowed(scope, query.accountId);
    const { items, total } = await this.syncLogRepo.findMany(organizationId, {
      // Nhật ký đồng bộ cũng gắn với shop ⇒ cùng phạm vi.
      shopScope: scope.allShops ? undefined : scope.shopIds,
      page,
      limit,
      shopId: query.shopId,
      accountId: query.accountId,
      status: query.status,
      trigger: query.trigger,
    });
    return {
      items: items.map((log) => this.mapper.toSyncLogDto(log)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
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
    await this.syncLogRepo.failStaleRuns(new Date(Date.now() - 2 * deadlineMs));

    if (await this.syncLogRepo.hasRunningForShop(organizationId, dto.shopId)) {
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
}
