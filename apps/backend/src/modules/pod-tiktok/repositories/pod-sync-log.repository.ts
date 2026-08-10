import { Injectable } from '@nestjs/common';
import { PodSyncPhase, PodSyncStatus, PodSyncTrigger, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface SyncLogQueryParams {
  page: number;
  limit: number;
  shopId?: string;
  accountId?: string;
  status?: PodSyncStatus;
  trigger?: PodSyncTrigger;
}

/** Số liệu kết thúc một lượt đồng bộ. */
export interface SyncLogFinishData {
  status: PodSyncStatus;
  /** Pha đã chạy — quyết định `windowFrom/To` nằm trên trục `create_time` hay `update_time`. */
  phase: PodSyncPhase;
  windowFrom?: bigint | null;
  windowTo?: bigint | null;
  pagesFetched: number;
  apiCalls: number;
  totalOrders: number;
  /** `total_count` TikTok báo — lệch so với `totalOrders` là dấu hiệu đồng bộ thiếu. */
  tiktokTotalCount?: number | null;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  tiktokRequestId?: string | null;
}

/**
 * PodSyncLogRepository — nhật ký đồng bộ.
 * Bảng log: ghi nhiều/đọc ít; không soft delete, có job dọn theo retention.
 */
@Injectable()
export class PodSyncLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Mở một lượt đồng bộ (trạng thái RUNNING). */
  start(data: {
    organizationId: string;
    accountId?: string | null;
    shopId?: string | null;
    trigger: PodSyncTrigger;
    triggeredBy?: string | null;
    startedAt: Date;
  }): Promise<{ id: string }> {
    return this.prisma.podSyncLog.create({
      data: {
        organizationId: data.organizationId,
        accountId: data.accountId ?? null,
        shopId: data.shopId ?? null,
        trigger: data.trigger,
        status: PodSyncStatus.RUNNING,
        triggeredBy: data.triggeredBy ?? null,
        startedAt: data.startedAt,
      },
      select: { id: true },
    });
  }

  /** Đóng một lượt đồng bộ kèm số liệu. */
  async finish(id: string, startedAt: Date, data: SyncLogFinishData): Promise<void> {
    const finishedAt = new Date();
    await this.prisma.podSyncLog.update({
      where: { id },
      data: {
        ...data,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });
  }

  /**
   * Dọn các lượt bị kẹt `RUNNING` (tiến trình chết giữa chừng / deploy cắt ngang).
   * Chạy đầu mỗi lượt cron để nhật ký không bị treo mãi.
   */
  async failStaleRuns(olderThan: Date): Promise<number> {
    const result = await this.prisma.podSyncLog.updateMany({
      where: { status: PodSyncStatus.RUNNING, startedAt: { lt: olderThan } },
      data: {
        status: PodSyncStatus.FAILED,
        errorCode: 'STALE',
        errorMessage: 'Lượt đồng bộ bị treo (tiến trình dừng giữa chừng) — tự đánh dấu thất bại',
        finishedAt: new Date(),
      },
    });
    return result.count;
  }

  async findMany(organizationId: string, params: SyncLogQueryParams) {
    const where: Prisma.PodSyncLogWhereInput = {
      organizationId,
      ...(params.shopId ? { shopId: params.shopId } : {}),
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.trigger ? { trigger: params.trigger } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podSyncLog.findMany({
        where,
        include: {
          shop: { select: { id: true, name: true } },
          account: { select: { id: true, accountName: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.podSyncLog.count({ where }),
    ]);
    return { items, total };
  }

  /** Có lượt đồng bộ nào đang chạy cho shop này không (chặn trigger thủ công trùng). */
  async hasRunningForShop(organizationId: string, shopId: string): Promise<boolean> {
    const count = await this.prisma.podSyncLog.count({
      where: { organizationId, shopId, status: PodSyncStatus.RUNNING },
    });
    return count > 0;
  }
}
