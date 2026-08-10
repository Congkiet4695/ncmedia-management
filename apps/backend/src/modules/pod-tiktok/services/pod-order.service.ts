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
import {
  PodOrderQueryDto,
  PodSyncLogQueryDto,
  TriggerSyncDto,
} from '../dto/pod-order-query.dto';
import {
  PodOrderNotFoundException,
  PodTiktokAccountNotFoundException,
  PodTiktokSyncInProgressException,
} from '../exceptions/pod-tiktok.exceptions';
import { PodOrderResponseMapper } from '../mappers/pod-order-response.mapper';
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
  ) {}

  async findAll(
    organizationId: string,
    query: PodOrderQueryDto,
  ): Promise<PaginatedPodOrderResponseDto> {
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

    return {
      items: items.map((order) => this.mapper.toListItem(order)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async findOne(organizationId: string, id: string): Promise<PodOrderResponseDto> {
    const order = await this.repo.findById(organizationId, id);
    if (!order) throw new PodOrderNotFoundException();
    return this.mapper.toResponse(order);
  }

  async stats(organizationId: string): Promise<PodOrderStatsDto> {
    const rows = await this.repo.countByStatus(organizationId);
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
  ): Promise<PaginatedPodSyncLogResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.syncLogRepo.findMany(organizationId, {
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
