import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PodSyncTrigger } from '@prisma/client';
import { DistributedLockService } from '../infra/distributed-lock.service';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodSyncLogRepository } from '../repositories/pod-sync-log.repository';
import { PodOrderSyncService, ShopSyncOutcome, SyncShopTarget } from './pod-order-sync.service';
import { PodPayoutSyncService } from './pod-payout-sync.service';

/** Tuỳ chọn cho một lượt chạy toàn hệ thống (dùng khi kích hoạt thủ công). */
export interface RunAllOptions {
  /** Kéo lại TOÀN BỘ lịch sử đơn cho mọi shop trong phạm vi chạy. */
  backfill?: boolean;
  /** Bỏ qua so sánh hash — ghi đè toàn bộ. */
  force?: boolean;
  /** User bấm Manual Sync (NULL = scheduler). */
  triggeredBy?: string;
}

/** Tổng hợp kết quả một lượt chạy toàn hệ thống. */
export interface OrchestratorResult {
  shopsTotal: number;
  shopsSucceeded: number;
  shopsFailed: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  ordersFailed: number;
  durationMs: number;
  skippedByLock: boolean;
}

/**
 * PodSyncOrchestratorService — điều phối đồng bộ cho TOÀN BỘ shop đang hoạt động.
 *
 * Nguyên tắc:
 *  - **Fail-soft**: một shop lỗi KHÔNG làm dừng vòng lặp (yêu cầu Sprint 2).
 *  - **Fair-share**: xếp shop theo vòng round-robin giữa các Organization, để một org
 *    nhiều shop không làm org khác bị đói (quota TikTok dùng chung một `app_key`).
 *  - **Concurrency có kiểm soát**: tối đa N shop chạy song song.
 *  - **Deadline**: cả lượt phải kết thúc trước chu kỳ cron kế tiếp.
 *
 * Tách khỏi lớp Scheduler để có thể gọi lại từ API (sync thủ công) và test độc lập.
 */
@Injectable()
export class PodSyncOrchestratorService {
  private readonly logger = new Logger(PodSyncOrchestratorService.name);

  private static readonly GLOBAL_LOCK_KEY = 'pod:tiktok:sync:global';

  constructor(
    private readonly config: ConfigService,
    private readonly accountRepo: PodTiktokAccountRepository,
    private readonly syncLogRepo: PodSyncLogRepository,
    private readonly syncService: PodOrderSyncService,
    private readonly payoutSyncService: PodPayoutSyncService,
    private readonly lock: DistributedLockService,
  ) {}

  /**
   * Chạy một lượt đồng bộ.
   *
   * - Không truyền `organizationId` (scheduler) → quét toàn hệ thống, dùng khoá toàn cục.
   * - Có `organizationId` (đồng bộ thủ công từ API) → 🔴 CHỈ quét shop của tổ chức đó và
   *   dùng khoá riêng theo tổ chức. Người dùng tổ chức A không được kích hoạt đồng bộ —
   *   và tiêu thụ quota TikTok — cho tổ chức B.
   *
   * Có khoá: nếu lượt trước chưa xong thì lượt này bỏ qua (không chồng lịch).
   */
  async runAll(
    trigger: PodSyncTrigger = PodSyncTrigger.CRON,
    organizationId?: string,
    options: RunAllOptions = {},
  ): Promise<OrchestratorResult> {
    const startedAt = Date.now();
    const deadlineMs = this.config.get<number>('tiktok.sync.runDeadlineMs', 240_000);

    const lockKey = organizationId
      ? `${PodSyncOrchestratorService.GLOBAL_LOCK_KEY}:org:${organizationId}`
      : PodSyncOrchestratorService.GLOBAL_LOCK_KEY;
    const acquired = await this.lock.acquire(lockKey, deadlineMs);
    if (!acquired) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'sync.run-all',
        msg: 'Lượt đồng bộ trước chưa kết thúc — bỏ qua lượt này',
      });
      return this.emptyResult(true, Date.now() - startedAt);
    }

    try {
      // Dọn nhật ký bị treo từ lần chạy trước (tiến trình chết / deploy cắt ngang).
      const stale = await this.syncLogRepo.failStaleRuns(new Date(Date.now() - 2 * deadlineMs));
      if (stale > 0) {
        this.logger.warn({
          module: 'pod-tiktok',
          operation: 'sync.run-all',
          msg: `Đã đánh dấu ${stale} lượt đồng bộ bị treo là FAILED`,
        });
      }

      const shops = (await this.accountRepo.listShopsForSync(
        new Date(),
        organizationId,
      )) as SyncShopTarget[];
      if (shops.length === 0) {
        this.logger.debug({
          module: 'pod-tiktok',
          operation: 'sync.run-all',
          msg: 'Không có shop nào cần đồng bộ',
        });
        return this.emptyResult(false, Date.now() - startedAt);
      }

      const ordered = this.interleaveByOrganization(shops);
      const deadlineAt = startedAt + deadlineMs;
      const outcomes = await this.runWithConcurrency(ordered, deadlineAt, trigger, options);

      // Payout chạy SAU đồng bộ đơn, tuần tự và chỉ với thời gian còn lại: dữ liệu tài
      // chính thay đổi theo ngày nên không cần realtime, và Finance API dùng chung quota
      // với Order API — ưu tiên đơn hàng trước.
      await this.runPayoutSync(ordered, deadlineAt);

      const result = this.aggregate(outcomes, Date.now() - startedAt);
      this.logger.log({
        module: 'pod-tiktok',
        operation: 'sync.run-all',
        ...result,
        msg: 'Hoàn tất lượt đồng bộ đơn TikTok',
      });
      return result;
    } finally {
      await this.lock.release(acquired);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Xếp xen kẽ shop theo Organization (round-robin).
   * VD: A1 B1 C1 A2 B2 A3 — thay vì A1 A2 A3 B1 B2 C1.
   * Mục đích: org 1 shop không phải chờ org 30 shop chạy xong.
   */
  private interleaveByOrganization(shops: SyncShopTarget[]): SyncShopTarget[] {
    const groups = new Map<string, SyncShopTarget[]>();
    for (const shop of shops) {
      const list = groups.get(shop.organizationId);
      if (list) list.push(shop);
      else groups.set(shop.organizationId, [shop]);
    }

    const buckets = [...groups.values()];
    const result: SyncShopTarget[] = [];
    let index = 0;
    let remaining = shops.length;
    while (remaining > 0) {
      for (const bucket of buckets) {
        if (index < bucket.length) {
          result.push(bucket[index]);
          remaining -= 1;
        }
      }
      index += 1;
    }
    return result;
  }

  /** Chạy song song có giới hạn, tôn trọng deadline chung. */
  private async runWithConcurrency(
    shops: SyncShopTarget[],
    deadlineAt: number,
    trigger: PodSyncTrigger,
    options: RunAllOptions,
  ): Promise<ShopSyncOutcome[]> {
    const limit = this.config.get<number>('tiktok.sync.maxConcurrency', 4);
    const outcomes: ShopSyncOutcome[] = [];
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < shops.length) {
        if (Date.now() >= deadlineAt) {
          this.logger.warn({
            module: 'pod-tiktok',
            operation: 'sync.run-all',
            msg: `Chạm deadline — còn ${shops.length - cursor} shop sẽ xử lý ở lượt sau`,
          });
          return;
        }
        const shop = shops[cursor++];
        // syncShop KHÔNG ném lỗi (fail-soft) — nhưng vẫn bọc để tuyệt đối an toàn.
        try {
          outcomes.push(
            await this.syncService.syncShop(shop, {
              trigger,
              deadlineAt,
              backfill: options.backfill,
              force: options.force,
              triggeredBy: options.triggeredBy,
            }),
          );
        } catch (error) {
          this.logger.error({
            module: 'pod-tiktok',
            operation: 'sync.run-all',
            organizationId: shop.organizationId,
            shopId: shop.id,
            msg: `Lỗi ngoài dự kiến khi đồng bộ shop: ${(error as Error).message}`,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, shops.length) }, () => worker()));
    return outcomes;
  }

  /**
   * Đồng bộ Payout cho các shop vừa xử lý.
   *
   * Fail-soft tuyệt đối: lỗi payout KHÔNG được ảnh hưởng tới kết quả đồng bộ đơn —
   * đơn hàng là dữ liệu vận hành, payout chỉ phục vụ báo cáo.
   */
  private async runPayoutSync(shops: SyncShopTarget[], deadlineAt: number): Promise<void> {
    if (!this.config.get<boolean>('tiktok.payout.enabled', true)) return;

    let succeeded = 0;
    let failed = 0;
    for (const shop of shops) {
      if (Date.now() >= deadlineAt) break;
      try {
        const outcome = await this.payoutSyncService.syncShop(shop, { deadlineAt });
        if (outcome.ok) succeeded += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error({
          module: 'pod-tiktok',
          operation: 'payout.sync',
          organizationId: shop.organizationId,
          shopId: shop.id,
          msg: `Lỗi ngoài dự kiến khi đồng bộ payout: ${(error as Error).message}`,
        });
      }
    }

    if (succeeded + failed > 0) {
      this.logger.log({
        module: 'pod-tiktok',
        operation: 'payout.sync',
        shopsSucceeded: succeeded,
        shopsFailed: failed,
        msg: 'Hoàn tất đồng bộ payout trong lượt cron',
      });
    }
  }

  private aggregate(outcomes: ShopSyncOutcome[], durationMs: number): OrchestratorResult {
    return outcomes.reduce<OrchestratorResult>(
      (acc, outcome) => {
        acc.shopsTotal += 1;
        if (outcome.status === 'SUCCESS') acc.shopsSucceeded += 1;
        else if (outcome.status === 'FAILED' || outcome.status === 'PARTIAL') acc.shopsFailed += 1;
        acc.ordersCreated += outcome.created;
        acc.ordersUpdated += outcome.updated;
        acc.ordersSkipped += outcome.skipped;
        acc.ordersFailed += outcome.failed;
        return acc;
      },
      { ...this.emptyResult(false, durationMs) },
    );
  }

  private emptyResult(skippedByLock: boolean, durationMs: number): OrchestratorResult {
    return {
      shopsTotal: 0,
      shopsSucceeded: 0,
      shopsFailed: 0,
      ordersCreated: 0,
      ordersUpdated: 0,
      ordersSkipped: 0,
      ordersFailed: 0,
      durationMs,
      skippedByLock,
    };
  }
}
