import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PodListingPayloadStatus, PodListingSessionStatus, Prisma } from '@prisma/client';
import {
  describeHttpFailure,
  type RowFailure,
} from '../../../common/utils/describe-http-failure.util';
import { isLockNotAvailable } from '../../../common/utils/postgres-error.util';
import { PrismaService } from '../../../database/prisma.service';
import {
  POD_LISTING_JOB_ACTIVE_STATUSES,
  POD_LISTING_JOB_ITEM_ACTIVE_STATUSES,
  POD_SESSION_START_LOCK_PREFIX,
} from '../../pod-listing/constants/pod-listing.constants';
import {
  DistributedLockService,
  type AcquiredLock,
} from '../../pod-tiktok/infra/distributed-lock.service';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import {
  POD_SESSION_DELETE_LOCK_TIMEOUT,
  POD_SESSION_DELETE_TX_OPTIONS,
} from '../constants/pod-listing-session.constants';
import {
  PodListingSessionInProgressException,
  PodListingSessionNotFoundException,
} from './pod-listing-session.service';

/** Kết quả xoá hàng loạt — THEO TỪNG DÒNG, không bao giờ báo "thành công" chung khi có dòng hỏng. */
export interface ListingSessionBulkDeleteResult {
  requested: number;
  deleted: string[];
  failed: Array<{ id: string } & RowFailure>;
}

const BUSY_MESSAGE =
  'Lượt đăng đang chạy hoặc còn lượt đưa lên sàn / publish chưa xong — chờ chạy xong (hoặc huỷ) rồi xoá.';
const LOCKED_MESSAGE =
  'Lượt đăng đang được một thao tác khác cập nhật — vui lòng thử lại sau ít giây.';

/**
 * PodListingSessionDeletionService — XOÁ CỨNG Auto Listing (Listing Session), từng lượt và hàng loạt.
 *
 * ```
 *   ids ─▶ thuộc tổ chức + MỌI shop của lượt nằm trong phạm vi ─▶ không LISTING
 *       ─▶ khoá Redis `pod:session-start:<id>` (cùng khoá với Start Listing)
 *       ─▶ TRANSACTION: SELECT … FOR UPDATE ─▶ kiểm LẠI: trạng thái + không còn việc nền dở dang
 *            ─▶ DELETE pod_listing_sessions — CASCADE xuống:
 *                 shops · templates (bảng nối) · Draft Product → ảnh, payload → biến thể payload,
 *                 job item (kể cả của job PUBLISH ngoài lượt) · job của lượt → item, log
 * ```
 *
 * "Việc nền dở dang" = job của lượt còn PENDING/PROCESSING, job item của Draft Product còn
 * PENDING/PROCESSING/RETRYING (kể cả trong job PUBLISH tạo từ màn Draft Listings), hoặc payload đang
 * PUBLISHING. Có ⇒ TỪ CHỐI xoá (không dừng hộ): worker trong hàng đợi đang giữ id của chúng, xoá dưới
 * chân nó là để worker ghi lên bản ghi đã mất hoặc gọi TikTok cho một sản phẩm không còn ai theo dõi.
 *
 * 🔴 Không đụng tới: template (chỉ được tham chiếu, `Restrict`), Group Template, file trong Storage
 * (ảnh do người dùng tải lên — `file_id` chỉ trỏ tới), shop, sản phẩm đã đồng bộ, và sản phẩm đã tạo
 * trên TikTok (xoá lượt đăng không gỡ hàng khỏi shop).
 */
@Injectable()
export class PodListingSessionDeletionService {
  private readonly logger = new Logger(PodListingSessionDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: PodAccessScopeService,
    private readonly locks: DistributedLockService,
  ) {}

  /** Xoá MỘT lượt đăng — ném đúng exception của dòng đó (404 / 403 / 400). */
  async remove(
    organizationId: string,
    userId: string,
    id: string,
    scope: PodAccessScope,
  ): Promise<void> {
    const { failures } = await this.execute(organizationId, userId, [id], scope);
    const failure = failures.get(id);
    if (failure) throw failure;
  }

  /** Xoá NHIỀU lượt đăng — dòng hỏng không chặn dòng khác, kết quả theo từng dòng. */
  async removeMany(
    organizationId: string,
    userId: string,
    ids: string[],
    scope: PodAccessScope,
  ): Promise<ListingSessionBulkDeleteResult> {
    const uniqueIds = [...new Set(ids)];
    const { deleted, failures } = await this.execute(organizationId, userId, uniqueIds, scope);
    return {
      requested: uniqueIds.length,
      deleted,
      failed: [...failures].map(([id, error]) => ({
        id,
        ...describeHttpFailure(error, 'POD_SESSION_DELETE_FAILED', 'Không xoá được lượt đăng'),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async execute(
    organizationId: string,
    userId: string,
    ids: string[],
    scope: PodAccessScope,
  ): Promise<{ deleted: string[]; failures: Map<string, HttpException> }> {
    const failures = new Map<string, HttpException>();
    const candidates = await this.loadCandidates(organizationId, ids, scope, failures);

    const held: AcquiredLock[] = [];
    let deleted: string[] = [];
    try {
      const ready: string[] = [];
      for (const id of candidates) {
        const lock = await this.locks.acquire(
          `${POD_SESSION_START_LOCK_PREFIX}${id}`,
          POD_SESSION_DELETE_TX_OPTIONS.timeout,
        );
        if (lock) {
          held.push(lock);
          ready.push(id);
        } else {
          failures.set(id, new PodListingSessionInProgressException(BUSY_MESSAGE));
        }
      }
      if (ready.length > 0)
        deleted = await this.deleteLockedOrBusy(organizationId, ready, failures);
    } finally {
      for (const lock of held) await this.locks.release(lock);
    }

    this.logger.log({
      module: 'pod-listing-session',
      operation: 'session.delete',
      organizationId,
      userId,
      requested: ids.length,
      deleted: deleted.length,
      failed: failures.size,
      msg: 'Xoá cứng Auto Listing (Listing Session)',
    });
    return { deleted, failures };
  }

  /** Kiểm tổ chức + phạm vi (MỌI shop của lượt) + trạng thái. Trả id các lượt đi tiếp. */
  private async loadCandidates(
    organizationId: string,
    ids: string[],
    scope: PodAccessScope,
    failures: Map<string, HttpException>,
  ): Promise<string[]> {
    const rows = await this.prisma.podListingSession.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      select: { id: true, status: true, shops: { select: { shopId: true } } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const candidates: string[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        failures.set(id, new PodListingSessionNotFoundException());
        continue;
      }
      try {
        // Cùng luật với mọi thao tác ghi khác trên lượt đăng: chạm MỘT shop ngoài phạm vi là từ chối.
        for (const link of row.shops) this.accessScope.assertShopAllowed(scope, link.shopId);
      } catch (error) {
        failures.set(id, error as HttpException);
        continue;
      }
      if (row.status === PodListingSessionStatus.LISTING) {
        failures.set(id, new PodListingSessionInProgressException(BUSY_MESSAGE));
        continue;
      }
      candidates.push(id);
    }
    return candidates;
  }

  /** Hết `lock_timeout` ⇒ cả lô báo bận, không có gì bị xoá. */
  private async deleteLockedOrBusy(
    organizationId: string,
    ids: string[],
    failures: Map<string, HttpException>,
  ): Promise<string[]> {
    try {
      return await this.deleteLocked(organizationId, ids, failures);
    } catch (error) {
      if (!isLockNotAvailable(error)) throw error;
      for (const id of ids)
        failures.set(id, new PodListingSessionInProgressException(LOCKED_MESSAGE));
      return [];
    }
  }

  /** Một transaction: khoá hàng → kiểm lại → DELETE. Lỗi bất kỳ ⇒ rollback toàn bộ. */
  private async deleteLocked(
    organizationId: string,
    ids: string[],
    failures: Map<string, HttpException>,
  ): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT set_config('lock_timeout', ${POD_SESSION_DELETE_LOCK_TIMEOUT}, true)`,
      );
      const locked = await tx.$queryRaw<Array<{ id: string; status: PodListingSessionStatus }>>(
        Prisma.sql`
          SELECT id, status FROM pod_listing_sessions
           WHERE id = ANY(${ids}::uuid[])
             AND organization_id = ${organizationId}::uuid
             AND deleted_at IS NULL
           FOR UPDATE`,
      );
      const lockedById = new Map(locked.map((row) => [row.id, row]));
      const busy = await this.sessionsWithActiveWork(tx, ids);

      const deletable: string[] = [];
      for (const id of ids) {
        const row = lockedById.get(id);
        if (!row) failures.set(id, new PodListingSessionNotFoundException());
        else if (row.status === PodListingSessionStatus.LISTING || busy.has(id)) {
          failures.set(id, new PodListingSessionInProgressException(BUSY_MESSAGE));
        } else deletable.push(id);
      }
      if (deletable.length === 0) return [];

      await tx.podListingSession.deleteMany({ where: { id: { in: deletable }, organizationId } });
      return deletable;
    }, POD_SESSION_DELETE_TX_OPTIONS);
  }

  /** Lượt đăng nào còn việc nền dở dang (job / job item / publish) — xem chú thích lớp. */
  private async sessionsWithActiveWork(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<Set<string>> {
    const jobStatuses = [...POD_LISTING_JOB_ACTIVE_STATUSES];
    const itemStatuses = [...POD_LISTING_JOB_ITEM_ACTIVE_STATUSES];
    const rows = await tx.$queryRaw<Array<{ session_id: string }>>(Prisma.sql`
      SELECT j.session_id
        FROM pod_listing_jobs j
       WHERE j.session_id = ANY(${ids}::uuid[])
         AND j.status::text = ANY(${jobStatuses}::text[])
      UNION
      SELECT p.session_id
        FROM pod_listing_job_items i
        JOIN pod_listing_session_products p ON p.id = i.session_product_id
       WHERE p.session_id = ANY(${ids}::uuid[])
         AND i.status::text = ANY(${itemStatuses}::text[])
      UNION
      SELECT p.session_id
        FROM pod_listing_payloads pl
        JOIN pod_listing_session_products p ON p.id = pl.session_product_id
       WHERE p.session_id = ANY(${ids}::uuid[])
         AND pl.status::text = ${PodListingPayloadStatus.PUBLISHING}`);
    return new Set(rows.map((row) => row.session_id));
  }
}
