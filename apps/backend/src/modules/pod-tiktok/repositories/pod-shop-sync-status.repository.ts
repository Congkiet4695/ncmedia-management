import { Injectable } from '@nestjs/common';
import { PodShopSyncType, PodSyncStatus, PodSyncTrigger, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { shopScopeFilter } from '../shared/shop-scope';

/** Khoá của MỘT dòng trạng thái + fencing token của lượt đang ghi. */
export interface SyncRunHandle {
  organizationId: string;
  shopId: string;
  syncType: PodShopSyncType;
  runId: string;
  startedAt: Date;
}

/** Kết quả một lượt đồng bộ. */
export interface SyncRunResult {
  status: PodSyncStatus;
  totalCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  /** `null` / bỏ trống ⇒ XOÁ lỗi cũ (lượt sau thành công không còn mang lỗi của lượt trước). */
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Chỉ số chẩn đoán riêng từng loại (xem cột `details`). */
  details?: Prisma.InputJsonValue | null;
}

export interface SyncStatusQuery {
  syncType: PodShopSyncType;
  /** Phạm vi shop của người dùng (`PodAccessScopeService`). `undefined` = toàn tổ chức. */
  shopScope?: string[];
  shopId?: string;
}

/**
 * PodShopSyncStatusRepository — TRẠNG THÁI LẦN ĐỒNG BỘ GẦN NHẤT của từng shop (không phải lịch sử).
 *
 * Mỗi (organization_id, shop_id, sync_type) có ĐÚNG MỘT dòng:
 *  - `start`  : `INSERT … ON CONFLICT (khoá) DO UPDATE` — MỘT câu lệnh nguyên tử. Cron và "Sync Now"
 *               chạy cùng lúc cho cùng shop vẫn chỉ ra một dòng (PostgreSQL tuần tự hoá trên UNIQUE index);
 *               không có khe "đọc rồi mới ghi" để hai bên cùng INSERT.
 *  - `finish` : chỉ ghi khi `run_id` còn là của lượt này (fencing). Lượt cũ kết thúc muộn (bị lượt mới
 *               hơn "giành" dòng) không ghi đè trạng thái của lượt mới hơn.
 *
 * Không có retention / dọn dẹp: số dòng = số shop × số loại đồng bộ, không tăng theo thời gian.
 */
@Injectable()
export class PodShopSyncStatusRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Bắt đầu một lượt: INSERT lần đầu, các lần sau UPDATE đúng dòng đó (đặt lại về RUNNING). */
  async start(data: {
    organizationId: string;
    accountId: string;
    shopId: string;
    syncType: PodShopSyncType;
    trigger: PodSyncTrigger;
    triggeredBy?: string | null;
    startedAt: Date;
  }): Promise<SyncRunHandle> {
    const runId = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "pod_shop_sync_statuses" (
        "id", "organization_id", "account_id", "shop_id", "sync_type", "run_id", "trigger", "status",
        "started_at", "finished_at", "duration_ms", "total_count", "created_count", "updated_count",
        "skipped_count", "failed_count", "error_code", "error_message", "details", "triggered_by",
        "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${data.organizationId}::uuid, ${data.accountId}::uuid, ${data.shopId}::uuid,
        ${data.syncType}::"pod_shop_sync_type", ${runId}::uuid, ${data.trigger}::"pod_sync_trigger",
        'RUNNING'::"pod_sync_status", ${data.startedAt}, NULL, NULL, 0, 0, 0, 0, 0, NULL, NULL, NULL,
        ${data.triggeredBy ?? null}::uuid, now(), now()
      )
      ON CONFLICT ("organization_id", "shop_id", "sync_type") DO UPDATE SET
        "account_id"    = EXCLUDED."account_id",
        "run_id"        = EXCLUDED."run_id",
        "trigger"       = EXCLUDED."trigger",
        "status"        = 'RUNNING'::"pod_sync_status",
        "started_at"    = EXCLUDED."started_at",
        "finished_at"   = NULL,
        "duration_ms"   = NULL,
        "total_count"   = 0,
        "created_count" = 0,
        "updated_count" = 0,
        "skipped_count" = 0,
        "failed_count"  = 0,
        "error_code"    = NULL,
        "error_message" = NULL,
        "details"       = NULL,
        "triggered_by"  = EXCLUDED."triggered_by",
        "updated_at"    = now()`;
    return {
      organizationId: data.organizationId,
      shopId: data.shopId,
      syncType: data.syncType,
      runId,
      startedAt: data.startedAt,
    };
  }

  /**
   * Kết thúc lượt. Trả `false` khi dòng đã thuộc về một lượt MỚI HƠN (fencing) — kết quả của lượt cũ
   * bị bỏ, vì dòng luôn phải phản ánh lần đồng bộ gần nhất.
   */
  async finish(handle: SyncRunHandle, result: SyncRunResult): Promise<boolean> {
    const finishedAt = new Date();
    const updated = await this.prisma.podShopSyncStatus.updateMany({
      where: {
        organizationId: handle.organizationId,
        shopId: handle.shopId,
        syncType: handle.syncType,
        runId: handle.runId,
      },
      data: {
        status: result.status,
        totalCount: result.totalCount,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
        errorCode: result.errorCode?.slice(0, 64) ?? null,
        errorMessage: result.errorMessage?.slice(0, 2000) ?? null,
        details: result.details ?? Prisma.JsonNull,
        finishedAt,
        durationMs: finishedAt.getTime() - handle.startedAt.getTime(),
      },
    });
    return updated.count === 1;
  }

  /**
   * Lượt kẹt RUNNING (tiến trình chết giữa chừng / deploy cắt ngang) ⇒ FAILED, để trạng thái không treo
   * và "Sync Now" không bị chặn mãi.
   */
  async failStaleRuns(syncType: PodShopSyncType, olderThan: Date): Promise<number> {
    const result = await this.prisma.podShopSyncStatus.updateMany({
      where: { syncType, status: PodSyncStatus.RUNNING, startedAt: { lt: olderThan } },
      data: {
        status: PodSyncStatus.FAILED,
        errorCode: 'STALE',
        errorMessage: 'Lượt đồng bộ bị treo (tiến trình dừng giữa chừng) — tự đánh dấu thất bại',
        finishedAt: new Date(),
      },
    });
    return result.count;
  }

  /** Có lượt nào đang chạy cho shop này không (chặn trigger thủ công trùng). */
  async isRunning(organizationId: string, shopId: string, syncType: PodShopSyncType): Promise<boolean> {
    const count = await this.prisma.podShopSyncStatus.count({
      where: { organizationId, shopId, syncType, status: PodSyncStatus.RUNNING },
    });
    return count > 0;
  }

  /**
   * Trạng thái gần nhất của các shop trong phạm vi — tối đa MỘT dòng mỗi shop cho loại đang xem, nên
   * không cần phân trang (số dòng = số shop người dùng được xem).
   */
  findLatest(organizationId: string, query: SyncStatusQuery) {
    const shopFilter = shopScopeFilter(query.shopScope, query.shopId);
    return this.prisma.podShopSyncStatus.findMany({
      where: {
        organizationId,
        syncType: query.syncType,
        // GIAO phạm vi với bộ lọc — không gán đè (xem `shopScopeFilter`).
        ...(shopFilter === undefined ? {} : { shopId: shopFilter }),
      },
      include: {
        shop: { select: { id: true, name: true } },
        account: { select: { id: true, accountName: true } },
      },
      orderBy: { startedAt: 'desc' },
    });
  }
}
