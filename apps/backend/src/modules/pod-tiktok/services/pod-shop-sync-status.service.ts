import { Injectable } from '@nestjs/common';
import { PodShopSyncType } from '@prisma/client';
import { PodShopSyncStatusListDto } from '../dto/pod-shop-sync-status.dto';
import { PodShopSyncStatusRepository } from '../repositories/pod-shop-sync-status.repository';
import { PodAccessScopeService, type PodAccessScope } from './pod-access-scope.service';

type StatusRow = Awaited<ReturnType<PodShopSyncStatusRepository['findLatest']>>[number];

/**
 * PodShopSyncStatusService — đọc "Latest Sync Status" (đơn và sản phẩm dùng chung).
 *
 * Phạm vi: Admin (allShops) thấy mọi shop của tổ chức; Seller chỉ thấy shop được gán. Lọc theo
 * shop ngoài phạm vi ⇒ 403 (giống mọi API POD khác), không âm thầm trả rỗng.
 */
@Injectable()
export class PodShopSyncStatusService {
  constructor(
    private readonly repo: PodShopSyncStatusRepository,
    private readonly accessScope: PodAccessScopeService,
  ) {}

  async findLatest(
    organizationId: string,
    syncType: PodShopSyncType,
    scope: PodAccessScope,
    shopId?: string,
  ): Promise<PodShopSyncStatusListDto> {
    this.accessScope.assertShopAllowed(scope, shopId);
    const rows = await this.repo.findLatest(organizationId, {
      syncType,
      shopScope: scope.allShops ? undefined : scope.shopIds,
      shopId,
    });
    return { items: rows.map((row) => PodShopSyncStatusService.toDto(row)) };
  }

  private static toDto(row: StatusRow) {
    return {
      shopId: row.shopId,
      shopName: row.shop?.name ?? null,
      accountName: row.account?.accountName ?? null,
      syncType: row.syncType,
      trigger: row.trigger,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      durationMs: row.durationMs,
      total: row.totalCount,
      created: row.createdCount,
      updated: row.updatedCount,
      skipped: row.skippedCount,
      failed: row.failedCount,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      details:
        row.details && typeof row.details === 'object' && !Array.isArray(row.details)
          ? (row.details as Record<string, unknown>)
          : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
