import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PodFlashSaleStatus, Prisma } from '@prisma/client';
import {
  describeHttpFailure,
  type RowFailure,
} from '../../../common/utils/describe-http-failure.util';
import { isLockNotAvailable } from '../../../common/utils/postgres-error.util';
import { PrismaService } from '../../../database/prisma.service';
import {
  DistributedLockService,
  type AcquiredLock,
} from '../../pod-tiktok/infra/distributed-lock.service';
import {
  PodAccessScopeService,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import {
  FLASH_SALE_AUTO_LOCK_PREFIX,
  FLASH_SALE_DELETE_LOCK_TIMEOUT,
  FLASH_SALE_DELETE_LOCK_TTL_MS,
  FLASH_SALE_DELETE_TX_OPTIONS,
  FLASH_SALE_IMPORT_LOCK_PREFIX,
  FLASH_SALE_LIVE_STATUSES,
} from '../constants/pod-flash-sale.constants';
import {
  PodFlashSaleAutoBusyException,
  PodFlashSaleImportBusyException,
  PodFlashSaleInvalidStateException,
  PodFlashSaleLockedException,
  PodFlashSaleNotFoundException,
} from '../exceptions/pod-flash-sale.exceptions';

/** Kết quả xoá hàng loạt — THEO TỪNG DÒNG, không bao giờ báo "thành công" chung khi có dòng hỏng. */
export interface FlashSaleBulkDeleteResult {
  requested: number;
  deleted: string[];
  failed: Array<{ id: string } & RowFailure>;
}

/** Ứng viên đã qua kiểm tra phạm vi + trạng thái (chưa khoá). */
interface DeleteCandidate {
  id: string;
  shopId: string;
  status: PodFlashSaleStatus;
  /** Đợt thuộc chuỗi Auto (đang bật Auto hoặc là một mắt xích) ⇒ phải giữ khoá Auto của tổ chức. */
  inAutoChain: boolean;
}

interface ExecuteOutcome {
  deleted: string[];
  failures: Map<string, HttpException>;
}

const ACTION = 'xoá Flash Sale';

/**
 * PodFlashSaleDeletionService — XOÁ CỨNG Flash Sale (từng đợt và hàng loạt).
 *
 * ```
 *   ids ─▶ thuộc tổ chức + trong phạm vi shop ─▶ không RUNNING / PUBLISHING
 *       ─▶ khoá Redis: import của shop (+ Auto của tổ chức nếu đợt thuộc chuỗi Auto)
 *       ─▶ TRANSACTION: SELECT … FOR UPDATE (kiểm lại trạng thái) ─▶ ghi bia mộ ─▶ DELETE
 *            └─ CASCADE: pod_flash_sale_items, pod_flash_sale_logs · SET NULL: auto_parent_id của đợt con
 * ```
 *
 * 🔴 Không đụng tới: sản phẩm / biến thể (chỉ được tham chiếu), Flash Sale Template (bản cấu hình
 * dùng lại — `source_template_id` chỉ trỏ tới nó), activity phía TikTok (đợt đang sống bị chặn ở
 * bước trạng thái; đợt đã kết thúc thì activity trên sàn cũng đã kết thúc).
 *
 * 🔴 Bia mộ (`pod_flash_sale_tombstones`): đợt có `provider_flash_sale_id` mà xoá cứng thì "Sync from
 * TikTok" sẽ import lại nó — bia mộ giữ đúng khoá khớp để đồng bộ tiếp tục bỏ qua.
 *
 * 🔴 Vì sao giữ khoá Redis: lượt import (theo shop) và lượt Auto (theo tổ chức) đọc rồi GHI lại đợt
 * sale ngoài transaction này. Xoá chen giữa lúc chúng đang chạy là để một tiến trình nền ghi lên bản
 * ghi đã mất. Không giành được khoá ⇒ dòng đó báo BUSY, KHÔNG xoá.
 */
@Injectable()
export class PodFlashSaleDeletionService {
  private readonly logger = new Logger(PodFlashSaleDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: PodAccessScopeService,
    private readonly locks: DistributedLockService,
  ) {}

  /** Xoá MỘT đợt — ném đúng exception của dòng đó (404 / 403 / 409). */
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

  /** Xoá NHIỀU đợt — dòng hỏng không chặn dòng khác, kết quả theo từng dòng. */
  async removeMany(
    organizationId: string,
    userId: string,
    ids: string[],
    scope: PodAccessScope,
  ): Promise<FlashSaleBulkDeleteResult> {
    const uniqueIds = [...new Set(ids)];
    const { deleted, failures } = await this.execute(organizationId, userId, uniqueIds, scope);
    return {
      requested: uniqueIds.length,
      deleted,
      failed: [...failures].map(([id, error]) => ({
        id,
        ...describeHttpFailure(error, 'POD_FLASH_SALE_DELETE_FAILED', 'Không xoá được Flash Sale'),
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
  ): Promise<ExecuteOutcome> {
    const failures = new Map<string, HttpException>();
    const candidates = await this.loadCandidates(organizationId, ids, scope, failures);
    if (candidates.length === 0) return this.finish(organizationId, userId, ids, [], failures);

    const held: AcquiredLock[] = [];
    try {
      const ready = await this.lockCandidates(organizationId, candidates, held, failures);
      const deleted =
        ready.length === 0
          ? []
          : await this.deleteLockedOrBusy(organizationId, userId, ready, failures);
      return this.finish(organizationId, userId, ids, deleted, failures);
    } finally {
      for (const lock of held) await this.locks.release(lock);
    }
  }

  /** Kiểm tổ chức + phạm vi shop + trạng thái. Dòng không đạt ⇒ ghi lỗi, không vào danh sách. */
  private async loadCandidates(
    organizationId: string,
    ids: string[],
    scope: PodAccessScope,
    failures: Map<string, HttpException>,
  ): Promise<DeleteCandidate[]> {
    const rows = await this.prisma.podFlashSale.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      select: { id: true, shopId: true, status: true, autoMode: true, autoChainId: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const candidates: DeleteCandidate[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        failures.set(id, new PodFlashSaleNotFoundException());
        continue;
      }
      try {
        this.accessScope.assertShopAllowed(scope, row.shopId);
      } catch (error) {
        failures.set(id, error as HttpException);
        continue;
      }
      if (FLASH_SALE_LIVE_STATUSES.includes(row.status)) {
        failures.set(id, new PodFlashSaleInvalidStateException(ACTION, row.status));
        continue;
      }
      candidates.push({
        id: row.id,
        shopId: row.shopId,
        status: row.status,
        inAutoChain: row.autoMode || row.autoChainId !== null,
      });
    }
    return candidates;
  }

  /** Giành khoá import của từng shop (+ khoá Auto của tổ chức khi cần). Trả các dòng xoá được. */
  private async lockCandidates(
    organizationId: string,
    candidates: DeleteCandidate[],
    held: AcquiredLock[],
    failures: Map<string, HttpException>,
  ): Promise<DeleteCandidate[]> {
    let autoLocked = true;
    if (candidates.some((candidate) => candidate.inAutoChain)) {
      const lock = await this.locks.acquire(
        `${FLASH_SALE_AUTO_LOCK_PREFIX}${organizationId}`,
        FLASH_SALE_DELETE_LOCK_TTL_MS,
      );
      if (lock) held.push(lock);
      else autoLocked = false;
    }

    const busyShops = new Set<string>();
    for (const shopId of new Set(candidates.map((candidate) => candidate.shopId))) {
      const lock = await this.locks.acquire(
        `${FLASH_SALE_IMPORT_LOCK_PREFIX}${shopId}`,
        FLASH_SALE_DELETE_LOCK_TTL_MS,
      );
      if (lock) held.push(lock);
      else busyShops.add(shopId);
    }

    return candidates.filter((candidate) => {
      if (busyShops.has(candidate.shopId)) {
        failures.set(candidate.id, new PodFlashSaleImportBusyException());
        return false;
      }
      if (candidate.inAutoChain && !autoLocked) {
        failures.set(candidate.id, new PodFlashSaleAutoBusyException());
        return false;
      }
      return true;
    });
  }

  /** Hết `lock_timeout` (một lượt ghi khác giữ đợt sale) ⇒ cả lô báo LOCKED, không có gì bị xoá. */
  private async deleteLockedOrBusy(
    organizationId: string,
    userId: string,
    candidates: DeleteCandidate[],
    failures: Map<string, HttpException>,
  ): Promise<string[]> {
    try {
      return await this.deleteLocked(organizationId, userId, candidates, failures);
    } catch (error) {
      if (!isLockNotAvailable(error)) throw error;
      for (const candidate of candidates)
        failures.set(candidate.id, new PodFlashSaleLockedException());
      return [];
    }
  }

  /**
   * Một transaction: khoá hàng, kiểm LẠI trạng thái (publisher có thể vừa chuyển sang PUBLISHING sau
   * lần đọc đầu), ghi bia mộ, rồi DELETE. Lỗi bất kỳ ⇒ rollback toàn bộ, không xoá dở dang.
   */
  private async deleteLocked(
    organizationId: string,
    userId: string,
    candidates: DeleteCandidate[],
    failures: Map<string, HttpException>,
  ): Promise<string[]> {
    const ids = candidates.map((candidate) => candidate.id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT set_config('lock_timeout', ${FLASH_SALE_DELETE_LOCK_TIMEOUT}, true)`,
      );
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          status: PodFlashSaleStatus;
          shop_id: string;
          provider_flash_sale_id: string | null;
        }>
      >(Prisma.sql`
        SELECT id, status, shop_id, provider_flash_sale_id
          FROM pod_flash_sales
         WHERE id = ANY(${ids}::uuid[])
           AND organization_id = ${organizationId}::uuid
           AND deleted_at IS NULL
         FOR UPDATE`);
      const lockedById = new Map(locked.map((row) => [row.id, row]));

      const deletable: typeof locked = [];
      for (const id of ids) {
        const row = lockedById.get(id);
        if (!row) failures.set(id, new PodFlashSaleNotFoundException());
        else if (FLASH_SALE_LIVE_STATUSES.includes(row.status)) {
          failures.set(id, new PodFlashSaleInvalidStateException(ACTION, row.status));
        } else deletable.push(row);
      }
      if (deletable.length === 0) return [];

      const tombstones = deletable
        .filter((row) => row.provider_flash_sale_id)
        .map((row) => ({
          organizationId,
          shopId: row.shop_id,
          providerFlashSaleId: row.provider_flash_sale_id as string,
          createdBy: userId,
        }));
      if (tombstones.length > 0) {
        await tx.podFlashSaleTombstone.createMany({ data: tombstones, skipDuplicates: true });
      }

      const deletableIds = deletable.map((row) => row.id);
      await tx.podFlashSale.deleteMany({ where: { id: { in: deletableIds }, organizationId } });
      return deletableIds;
    }, FLASH_SALE_DELETE_TX_OPTIONS);
  }

  private finish(
    organizationId: string,
    userId: string,
    ids: string[],
    deleted: string[],
    failures: Map<string, HttpException>,
  ): ExecuteOutcome {
    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.delete',
      organizationId,
      userId,
      requested: ids.length,
      deleted: deleted.length,
      failed: failures.size,
      msg: 'Xoá cứng Flash Sale',
    });
    return { deleted, failures };
  }
}
