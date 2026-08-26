import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PodSyncPhase, PodSyncStatus, PodSyncTrigger } from '@prisma/client';
import { TiktokOrderClient } from '../clients/tiktok-order.client';
import { TiktokClientError } from '../exceptions/pod-tiktok.exceptions';
import { OrderSyncHookRegistry } from '../../../common/hooks/order-sync-hook.registry';
import { DistributedLockService } from '../infra/distributed-lock.service';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodSyncLogRepository } from '../repositories/pod-sync-log.repository';
import { PodOrderIngestionService, IngestionResult } from './pod-order-ingestion.service';
import { PodTiktokTokenService } from './pod-tiktok-token.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';

/** Shop kèm account — đầu vào của một lượt đồng bộ. */
export interface SyncShopTarget {
  id: string;
  organizationId: string;
  accountId: string;
  tiktokShopId: string;
  shopCipherEnc: string;
  name: string;
  lastOrderSyncCursor: bigint | null;
  backfillDone: boolean;
  /** Watermark `create_time` của pha BACKFILL. NULL = chưa kéo lát lịch sử nào. */
  backfillCursor: bigint | null;
  account: {
    id: string;
    organizationId: string;
    accountName: string;
    accessTokenEnc: string;
    accessTokenExpiresAt: Date;
    refreshTokenEnc: string;
    refreshTokenExpiresAt: Date;
  };
}

/** Kết quả đồng bộ một shop. */
export interface ShopSyncOutcome {
  shopId: string;
  shopName: string;
  status: PodSyncStatus;
  /** Pha đã chạy trong lượt này. */
  phase: PodSyncPhase;
  pagesFetched: number;
  apiCalls: number;
  totalOrders: number;
  /** `total_count` TikTok báo ở trang đầu (nếu có) — dùng để đối soát. */
  tiktokTotalCount?: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  windowFrom: bigint;
  windowTo: bigint;
  errorCode?: string;
  errorMessage?: string;
  tiktokRequestId?: string;
}

export interface SyncShopOptions {
  trigger: PodSyncTrigger;
  triggeredBy?: string;
  /** Quét lùi thêm N phút so với watermark (dùng cho sync thủ công). */
  lookbackMinutes?: number;
  /** Bỏ qua so sánh hash — ghi đè toàn bộ. */
  force?: boolean;
  /** Thời điểm phải dừng (deadline của cả lượt cron). */
  deadlineAt?: number;
  /** Kéo lại TOÀN BỘ lịch sử: đặt lại cờ backfill trước khi chạy. */
  backfill?: boolean;
}

/**
 * PodOrderSyncService — điều phối một lượt đồng bộ đơn cho MỘT shop.
 *
 * HAI PHA, chọn theo cờ `backfillDone` của shop:
 *
 * 1. **BACKFILL** (`backfillDone = false`) — kéo TOÀN BỘ lịch sử:
 *      create_time_ge = backfillCursor ?? cấu hình, create_time_lt = now − LAG
 *      sort_field = create_time, sort_order = ASC
 *    `create_time` BẤT BIẾN ⇒ phân trang là snapshot ổn định. Quét hết ⇒ bật cờ và
 *    bàn giao watermark cho pha 2. Chưa hết ⇒ lưu `backfillCursor`, lượt sau chạy tiếp.
 *
 * 2. **INCREMENTAL** (`backfillDone = true`) — đồng bộ định kỳ:
 *      update_time_ge = watermark − OVERLAP  (bù cảnh báo "update_time may exceed the range")
 *      update_time_lt = now − LAG            (không đọc sát hiện tại)
 *      sort_field = update_time, sort_order = ASC
 *
 * 🔴 Vì sao phải tách: `update_time` chỉ bắt được đơn CÓ THAY ĐỔI GẦN ĐÂY. Đơn cũ đã
 * COMPLETED từ lâu có `update_time` nằm ngoài mọi cửa sổ tương lai, nên nếu chỉ dùng
 * `update_time` thì lịch sử KHÔNG BAO GIỜ về đủ (đo thực tế: 55/143 đơn).
 *
 * Watermark CHỈ tiến khi đã phân trang HẾT và ingest thành công (at-least-once):
 * fail giữa chừng ⇒ giữ nguyên watermark ⇒ lần sau quét lại ⇒ KHÔNG mất đơn.
 * Ingest idempotent nên việc quét lại không tạo đơn trùng.
 */
@Injectable()
export class PodOrderSyncService {
  private readonly logger = new Logger(PodOrderSyncService.name);

  private static readonly SHOP_LOCK_PREFIX = 'pod:tiktok:sync:shop:';

  constructor(
    private readonly config: ConfigService,
    private readonly orderClient: TiktokOrderClient,
    private readonly ingestion: PodOrderIngestionService,
    private readonly tokenService: PodTiktokTokenService,
    private readonly accountRepo: PodTiktokAccountRepository,
    private readonly syncLogRepo: PodSyncLogRepository,
    private readonly encryption: TiktokEncryptionService,
    private readonly lock: DistributedLockService,
    private readonly syncHooks: OrderSyncHookRegistry,
  ) {}

  /**
   * Đồng bộ một shop. KHÔNG ném lỗi ra ngoài — mọi sự cố được gói vào
   * `ShopSyncOutcome` để scheduler tiếp tục với shop kế tiếp (fail-soft).
   */
  async syncShop(target: SyncShopTarget, options: SyncShopOptions): Promise<ShopSyncOutcome> {
    const lockKey = `${PodOrderSyncService.SHOP_LOCK_PREFIX}${target.id}`;
    const lockTtl = this.config.get<number>('tiktok.sync.runDeadlineMs', 240_000);
    const acquired = await this.lock.acquire(lockKey, lockTtl);

    if (!acquired) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'order.sync',
        shopId: target.id,
        msg: 'Shop đang được đồng bộ bởi tiến trình khác — bỏ qua lượt này',
      });
      return this.emptyOutcome(target, PodSyncStatus.SKIPPED, PodSyncPhase.INCREMENTAL, {
        errorCode: 'LOCKED',
        errorMessage: 'Đang có lượt đồng bộ khác cho shop này',
      });
    }

    // Yêu cầu kéo lại lịch sử: xoá cờ + cursor để `runSync` chọn pha BACKFILL từ đầu.
    if (options.backfill) {
      await this.accountRepo.resetBackfill(target.id);
      target = { ...target, backfillDone: false, backfillCursor: null };
    }

    const startedAt = new Date();
    const log = await this.syncLogRepo.start({
      organizationId: target.organizationId,
      accountId: target.accountId,
      shopId: target.id,
      trigger: options.trigger,
      triggeredBy: options.triggeredBy,
      startedAt,
    });

    let outcome: ShopSyncOutcome;
    try {
      outcome = await this.runSync(target, options);
    } catch (error) {
      outcome = this.emptyOutcome(
        target,
        PodSyncStatus.FAILED,
        target.backfillDone ? PodSyncPhase.INCREMENTAL : PodSyncPhase.BACKFILL,
        this.describeError(error),
      );
      this.logger.error({
        module: 'pod-tiktok',
        operation: 'order.sync',
        organizationId: target.organizationId,
        shopId: target.id,
        msg: `Đồng bộ shop thất bại: ${outcome.errorMessage}`,
      });
    } finally {
      await this.lock.release(acquired);
    }

    await this.syncLogRepo.finish(log.id, startedAt, {
      status: outcome.status,
      phase: outcome.phase,
      windowFrom: outcome.windowFrom,
      windowTo: outcome.windowTo,
      pagesFetched: outcome.pagesFetched,
      apiCalls: outcome.apiCalls,
      totalOrders: outcome.totalOrders,
      tiktokTotalCount: outcome.tiktokTotalCount ?? null,
      createdCount: outcome.created,
      updatedCount: outcome.updated,
      skippedCount: outcome.skipped,
      failedCount: outcome.failed,
      errorCode: outcome.errorCode ?? null,
      errorMessage: outcome.errorMessage ?? null,
      tiktokRequestId: outcome.tiktokRequestId ?? null,
    });

    await this.applyCircuitBreaker(target, outcome);

    // 🔴 Đơn vừa về ⇒ báo cho các module quan tâm (hiện là ánh xạ tự động của Fulfillment).
    //
    // Đi qua registry ở `common/` chứ KHÔNG gọi thẳng service của Fulfillment: quan hệ phụ
    // thuộc giữa hai module là một chiều `Fulfillment → PodTiktok`, gọi ngược lại là tạo vòng
    // phụ thuộc Nest. Registry tự nuốt mọi lỗi của hook — đồng bộ đơn là nghiệp vụ chính và
    // không được hỏng vì một tiện ích chạy kèm.
    //
    // Chỉ báo khi thực sự có đơn được ghi: một lượt đồng bộ không thay đổi gì thì cũng không
    // có cặp khoá mới nào để rà.
    if (outcome.created + outcome.updated > 0) {
      await this.syncHooks.notifyOrdersSynced({ organizationId: target.organizationId });
    }

    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async runSync(
    target: SyncShopTarget,
    options: SyncShopOptions,
  ): Promise<ShopSyncOutcome> {
    // --- Bước 1: đảm bảo access token còn dùng được (refresh nếu cần) ---
    const token = await this.tokenService.ensureValidAccessToken(target.account);
    if (!token.ok) {
      return this.emptyOutcome(target, PodSyncStatus.FAILED, PodSyncPhase.INCREMENTAL, {
        errorCode: token.reason,
        errorMessage: token.message,
      });
    }

    // --- Bước 2: chọn PHA và tính cửa sổ ---
    // Shop chưa kéo xong lịch sử ⇒ chạy BACKFILL theo `create_time` (bất biến).
    // Đã xong ⇒ chạy INCREMENTAL theo `update_time` (bắt thay đổi của cả đơn cũ).
    const backfillEnabled = this.config.get<boolean>('tiktok.sync.backfill.enabled', true);
    const phase =
      backfillEnabled && !target.backfillDone ? PodSyncPhase.BACKFILL : PodSyncPhase.INCREMENTAL;

    const { windowFrom, windowTo } =
      phase === PodSyncPhase.BACKFILL
        ? this.computeBackfillWindow(target)
        : this.computeIncrementalWindow(target, options);

    if (windowFrom >= windowTo) {
      return this.emptyOutcome(
        target,
        PodSyncStatus.SUCCESS,
        phase,
        undefined,
        windowFrom,
        windowTo,
      );
    }

    // --- Bước 3: phân trang cho tới khi hết ---
    const pageSize = this.config.get<number>('tiktok.sync.pageSize', 100);
    const maxPages =
      phase === PodSyncPhase.BACKFILL
        ? this.config.get<number>('tiktok.sync.backfill.maxPagesPerRun', 200)
        : this.config.get<number>('tiktok.sync.maxPagesPerRun', 50);
    const shopCipher = this.encryption.decrypt(target.shopCipherEnc);

    const totals: IngestionResult = {
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      maxUpdateTime: 0n,
    };

    let pageToken: string | undefined;
    let pagesFetched = 0;
    let apiCalls = 0;
    let lastRequestId: string | undefined;
    let tiktokTotalCount: number | undefined;
    let maxCreateTime = 0n;
    let exhausted = false;

    while (pagesFetched < maxPages) {
      if (options.deadlineAt && Date.now() >= options.deadlineAt) break;

      const page = await this.orderClient.searchOrders({
        shopCipher,
        accessToken: token.accessToken,
        query: {
          page_size: pageSize,
          page_token: pageToken,
          // ASC theo trục đang quét: fail giữa chừng thì phần đã xử lý luôn là tiền tố
          // của cửa sổ ⇒ chạy lại an toàn, cursor không bao giờ nhảy cóc.
          sort_field: phase === PodSyncPhase.BACKFILL ? 'create_time' : 'update_time',
          sort_order: 'ASC',
        },
        body:
          phase === PodSyncPhase.BACKFILL
            ? { create_time_ge: Number(windowFrom), create_time_lt: Number(windowTo) }
            : { update_time_ge: Number(windowFrom), update_time_lt: Number(windowTo) },
      });

      apiCalls += 1;
      pagesFetched += 1;
      lastRequestId = page.requestId ?? lastRequestId;
      // `total_count` chỉ đáng tin ở trang đầu của một cửa sổ.
      if (tiktokTotalCount === undefined) tiktokTotalCount = page.totalCount;

      const batch = await this.ingestion.ingestBatch(page.orders ?? [], {
        organizationId: target.organizationId,
        accountId: target.accountId,
        shopId: target.id,
        source:
          phase === PodSyncPhase.BACKFILL
            ? 'BACKFILL'
            : options.trigger === PodSyncTrigger.CRON
              ? 'CRON'
              : 'MANUAL',
        force: options.force,
      });

      totals.total += batch.total;
      totals.created += batch.created;
      totals.updated += batch.updated;
      totals.skipped += batch.skipped;
      totals.failed += batch.failed;
      if (batch.maxUpdateTime > totals.maxUpdateTime) totals.maxUpdateTime = batch.maxUpdateTime;

      // Watermark của pha BACKFILL bám theo `create_time` — chỉ tính các đơn ĐÃ ghi
      // thành công, để lượt sau quét lại đúng phần còn thiếu.
      if (batch.failed === 0) {
        for (const order of page.orders ?? []) {
          const createTime = BigInt(order.create_time ?? 0);
          if (createTime > maxCreateTime) maxCreateTime = createTime;
        }
      }

      if (!page.nextPageToken) {
        exhausted = true;
        break;
      }
      // Bảo vệ trước lỗi phía TikTok: nếu token trả về TRÙNG token vừa gửi đi thì
      // trang kế tiếp sẽ y hệt trang hiện tại ⇒ dừng ngay để tránh lặp vô hạn.
      if (page.nextPageToken === pageToken) {
        this.logger.error({
          module: 'pod-tiktok',
          operation: 'order.sync',
          shopId: target.id,
          tiktokRequestId: page.requestId,
          msg: 'next_page_token trùng với page_token đã gửi — dừng phân trang',
        });
        break;
      }
      pageToken = page.nextPageToken;
    }

    // --- Bước 4: chỉ tiến watermark khi đã quét HẾT và không có đơn lỗi ---
    const complete = exhausted && totals.failed === 0;
    const now = new Date();
    if (phase === PodSyncPhase.BACKFILL) {
      if (complete) {
        // Kéo xong lịch sử: bật cờ và giao lại cho pha INCREMENTAL từ chính mốc này.
        await this.accountRepo.completeBackfill(target.id, windowTo, now);
        this.logger.log({
          module: 'pod-tiktok',
          operation: 'order.backfill',
          organizationId: target.organizationId,
          shopId: target.id,
          totalOrders: totals.total,
          tiktokTotalCount,
          msg: 'Đã kéo xong lịch sử đơn — chuyển sang đồng bộ định kỳ',
        });
      } else if (maxCreateTime > 0n) {
        // Chưa hết: ghi nhận phần đã kéo để lượt sau chạy tiếp, KHÔNG bật cờ.
        await this.accountRepo.advanceBackfillCursor(target.id, maxCreateTime, now);
      }
    } else if (complete) {
      await this.accountRepo.advanceSyncCursor(target.id, windowTo, now);
    }
    if (complete) await this.accountRepo.touchLastSyncedAt(target.accountId, now);

    this.warnOnCountMismatch(target, phase, totals.total, tiktokTotalCount, complete);

    return {
      shopId: target.id,
      shopName: target.name,
      status: complete ? PodSyncStatus.SUCCESS : PodSyncStatus.PARTIAL,
      phase,
      pagesFetched,
      apiCalls,
      totalOrders: totals.total,
      tiktokTotalCount,
      created: totals.created,
      updated: totals.updated,
      skipped: totals.skipped,
      failed: totals.failed,
      windowFrom,
      windowTo,
      tiktokRequestId: lastRequestId,
      ...(complete
        ? {}
        : {
            errorCode: 'INCOMPLETE',
            errorMessage: exhausted
              ? `${totals.failed} đơn ghi thất bại — giữ nguyên watermark để lượt sau quét lại`
              : 'Chưa quét hết cửa sổ (chạm giới hạn trang hoặc deadline) — lượt sau tiếp tục',
          }),
    };
  }

  /**
   * Cửa sổ `create_time` của pha BACKFILL.
   *
   * `create_time` KHÔNG BAO GIỜ đổi ⇒ phân trang một cửa sổ `create_time` là snapshot
   * ổn định, kéo được toàn bộ lịch sử trong một (hoặc vài) lượt. Đây là lý do pha này
   * KHÔNG dùng `update_time`: đơn cũ đã COMPLETED từ lâu có `update_time` nằm ngoài mọi
   * cửa sổ tương lai nên sẽ không bao giờ được kéo về.
   *
   * Không chia nhỏ cửa sổ như pha incremental: cursor bám theo `create_time` của đơn
   * đã ghi, nên lượt sau tiếp tục đúng chỗ dừng mà không bỏ sót khoảng nào.
   */
  private computeBackfillWindow(target: SyncShopTarget): {
    windowFrom: bigint;
    windowTo: bigint;
  } {
    const nowSec = Math.floor(Date.now() / 1000);
    const lag = this.config.get<number>('tiktok.sync.lagSeconds', 60);
    const fromDays = this.config.get<number>('tiktok.sync.backfill.fromDays', 0);

    // fromDays = 0 ⇒ toàn bộ lịch sử shop (TikTok hiểu create_time_ge = 0 là từ đầu).
    const configuredFrom = fromDays > 0 ? nowSec - fromDays * 86_400 : 0;
    // Đã kéo dở ⇒ tiếp tục từ cursor. Không trừ overlap: `create_time` bất biến,
    // và bản thân `_ge` đã bao gồm mốc nên đơn tại đúng mốc vẫn được lấy lại (ingest idempotent).
    const fromSec = target.backfillCursor !== null ? Number(target.backfillCursor) : configuredFrom;

    return { windowFrom: BigInt(Math.max(fromSec, 0)), windowTo: BigInt(nowSec - lag) };
  }

  /**
   * Cửa sổ `update_time` của pha INCREMENTAL.
   * Mất watermark ⇒ quét lùi tối đa `initialLookbackSeconds` (lưới an toàn, KHÔNG phải
   * cơ chế kéo lịch sử — việc đó thuộc pha BACKFILL).
   * Cửa sổ quá dài ⇒ tự chia nhỏ (mỗi lượt tối đa `maxWindowSeconds`).
   */
  private computeIncrementalWindow(
    target: SyncShopTarget,
    options: SyncShopOptions,
  ): { windowFrom: bigint; windowTo: bigint } {
    const nowSec = Math.floor(Date.now() / 1000);
    const lag = this.config.get<number>('tiktok.sync.lagSeconds', 60);
    const overlap = this.config.get<number>('tiktok.sync.overlapSeconds', 300);
    const maxWindow = this.config.get<number>('tiktok.sync.maxWindowSeconds', 86_400);
    const initialLookback = this.config.get<number>(
      'tiktok.sync.initialLookbackSeconds',
      2_592_000,
    );

    let fromSec: number;
    if (options.lookbackMinutes) {
      fromSec = nowSec - options.lookbackMinutes * 60;
    } else if (target.lastOrderSyncCursor === null) {
      fromSec = nowSec - initialLookback;
    } else {
      fromSec = Number(target.lastOrderSyncCursor) - overlap;
    }
    if (fromSec < 0) fromSec = 0;

    let toSec = nowSec - lag;
    if (toSec < fromSec) toSec = fromSec;

    /**
     * Cửa sổ quá dài (shop mới, hoặc lâu không sync) ⇒ chỉ xử lý LÁT ĐẦU TIÊN
     * bằng cách kéo `windowTo` LÙI LẠI — tuyệt đối KHÔNG đẩy `windowFrom` tiến lên.
     *
     * Đẩy `windowFrom` tiến sẽ bỏ qua vĩnh viễn toàn bộ đơn nằm giữa watermark và
     * cửa sổ mới (mất đơn không thể phục hồi). Kéo `windowTo` lùi thì watermark
     * tiến dần từng lát, các lượt sau tự động xử lý nốt phần còn lại.
     */
    if (toSec - fromSec > maxWindow) {
      toSec = fromSec + maxWindow;
    }

    return { windowFrom: BigInt(fromSec), windowTo: BigInt(toSec) };
  }

  /**
   * Đối soát số đơn đã xử lý với `total_count` TikTok báo.
   *
   * Chính vì tín hiệu này bị bỏ qua mà lỗi "55/143" tồn tại âm thầm: hệ thống báo
   * SUCCESS ở mọi lượt trong khi thiếu 2/3 số đơn. Lệch ⇒ WARN để phát hiện sớm.
   */
  private warnOnCountMismatch(
    target: SyncShopTarget,
    phase: PodSyncPhase,
    ingested: number,
    tiktokTotalCount: number | undefined,
    complete: boolean,
  ): void {
    if (!complete || tiktokTotalCount === undefined || ingested >= tiktokTotalCount) return;
    this.logger.warn({
      module: 'pod-tiktok',
      operation: 'order.sync',
      organizationId: target.organizationId,
      shopId: target.id,
      phase,
      ingested,
      tiktokTotalCount,
      msg: `Đã quét hết cửa sổ nhưng chỉ nhận ${ingested}/${tiktokTotalCount} đơn TikTok báo — kiểm tra lại bộ lọc`,
    });
  }

  /** Circuit breaker: shop lỗi liên tiếp bị tạm ngưng với backoff tăng dần. */
  private async applyCircuitBreaker(
    target: SyncShopTarget,
    outcome: ShopSyncOutcome,
  ): Promise<void> {
    if (outcome.status === PodSyncStatus.SUCCESS || outcome.status === PodSyncStatus.SKIPPED) {
      return;
    }
    const threshold = this.config.get<number>('tiktok.sync.failureThreshold', 5);
    // Đọc số lần lỗi LIÊN TIẾP thật sau khi tăng (trước đây hardcode = 1 nên
    // ngưỡng không bao giờ đạt tới và circuit breaker chưa từng hoạt động).
    const failureCount = await this.accountRepo.recordShopSyncFailure(target.id, null);
    if (failureCount < threshold) return;

    // Backoff tăng dần theo số lần vượt ngưỡng, chặn trên để không ngưng quá lâu.
    const backoffMinutes = Math.min(15 * (failureCount - threshold + 1), 240);
    await this.accountRepo.pauseShopSync(
      target.id,
      new Date(Date.now() + backoffMinutes * 60 * 1000),
    );
    this.logger.warn({
      module: 'pod-tiktok',
      operation: 'order.sync',
      organizationId: target.organizationId,
      shopId: target.id,
      failureCount,
      backoffMinutes,
      msg: `Shop lỗi ${failureCount} lượt liên tiếp — tạm ngưng đồng bộ ${backoffMinutes} phút`,
    });
  }

  private describeError(error: unknown): { errorCode: string; errorMessage: string } {
    if (error instanceof TiktokClientError) {
      return {
        errorCode: String(error.tiktokCode),
        errorMessage: `${error.errorClass}: ${error.tiktokMessage}`.slice(0, 1000),
      };
    }
    return {
      errorCode: 'INTERNAL',
      errorMessage: (error as Error).message?.slice(0, 1000) ?? 'Lỗi không xác định',
    };
  }

  private emptyOutcome(
    target: SyncShopTarget,
    status: PodSyncStatus,
    phase: PodSyncPhase,
    error?: { errorCode: string; errorMessage: string },
    windowFrom = 0n,
    windowTo = 0n,
  ): ShopSyncOutcome {
    return {
      shopId: target.id,
      shopName: target.name,
      status,
      phase,
      pagesFetched: 0,
      apiCalls: 0,
      totalOrders: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      windowFrom,
      windowTo,
      errorCode: error?.errorCode,
      errorMessage: error?.errorMessage,
    };
  }
}
