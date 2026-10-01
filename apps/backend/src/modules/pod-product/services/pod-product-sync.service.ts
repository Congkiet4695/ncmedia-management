import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PodProductRawSource,
  PodProductSyncAction,
  PodProductSyncScope,
  PodProductSyncStatus,
  PodProductSyncTrigger,
  PodShopSyncType,
  PodSyncStatus,
  PodSyncTrigger,
  PodTiktokAccountStatus,
  PodTiktokShopStatus,
  Prisma,
} from '@prisma/client';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import {
  PodShopSyncStatusRepository,
  type SyncRunHandle,
} from '../../pod-tiktok/repositories/pod-shop-sync-status.repository';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { PodTiktokTokenService } from '../../pod-tiktok/services/pod-tiktok-token.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { runWithBoundedConcurrency } from '../../pod-tiktok/shared/bounded-concurrency';
import { TIKTOK_PRODUCT_API_VERSIONS } from '../../tiktok-sdk/tiktok-sdk.constants';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import type { TiktokProductSummary } from '../../tiktok-sdk/types/tiktok-product.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  POD_PRODUCT_SYNC_REQUEUE_DELAY_MS,
  POD_PRODUCT_SYNC_PUBLISH_MAX_WAIT_MS,
  POD_PRODUCT_SYNC_PUBLISH_DELAY_MS,
  POD_PRODUCT_SYNC_DUE_BATCH,
  POD_PRODUCT_DETAIL_CONCURRENCY,
  POD_PRODUCT_SYNC_TIKTOK_STATUSES,
  toLocalProductStatus,
  POD_PRODUCT_SYNC_LOCK_PREFIX,
  POD_PRODUCT_SYNC_LOCK_TTL_MS,
  POD_PRODUCT_SYNC_OVERLAP_SECONDS,
} from '../constants/pod-product.constants';
import { PodProductSyncQueue } from './pod-product-sync.queue';
import { PodProductMapper } from '../mappers/pod-product.mapper';
import { PodProductRepository } from '../repositories/pod-product.repository';
import {
  PodProductSyncRepository,
  type ProductSyncCandidate,
  type ProductSyncScopeParams,
  type ProductSyncTarget,
} from '../repositories/pod-product-sync.repository';

/**
 * Lý do một shop bị BỎ QUA (không gọi TikTok) trong lượt đồng bộ nhiều shop.
 *
 * `SHOP_INACTIVE` / `SHOP_DEAUTHORIZED` đến từ Shop Sync (`pod_tiktok_shops.status`);
 * `ACCOUNT_<status>` đến từ vòng đời token của kết nối; `PRODUCT_SYNC_DISABLED` là cờ cục bộ.
 */
export type ProductSyncSkipReason =
  | 'SHOP_INACTIVE'
  | 'SHOP_DEAUTHORIZED'
  | 'PRODUCT_SYNC_DISABLED'
  | `ACCOUNT_${Exclude<PodTiktokAccountStatus, 'ACTIVE'>}`;

/** Mã lỗi khi lượt đồng bộ THỦ CÔNG hết ngân sách thời gian — phần còn lại chạy ở nền. */
export const PRODUCT_SYNC_DEADLINE_CODE = 'SYNC_DEADLINE_EXCEEDED';

/** Hết ngân sách thời gian giữa chừng một shop — KHÔNG phải lỗi TikTok, không tính circuit breaker. */
class ProductSyncDeadlineError extends Error {
  constructor() {
    super('Hết thời gian của lượt đồng bộ thủ công — phần còn lại chạy tiếp ở hàng đợi nền');
    this.name = 'ProductSyncDeadlineError';
  }
}

/** Trigger của module sản phẩm ⇒ trigger chung của trạng thái shop (SCHEDULER = lịch tự động = CRON). */
function toShopSyncTrigger(trigger: PodProductSyncTrigger): PodSyncTrigger {
  return trigger === PodProductSyncTrigger.SCHEDULER ? PodSyncTrigger.CRON : PodSyncTrigger.MANUAL;
}

/**
 * Kết quả đồng bộ MỘT shop.
 *
 * `status` có thêm các giá trị KHÔNG thuộc enum DB:
 *  - `'LOCKED'`   — đang có lượt khác chạy cho shop này (không ghi trạng thái);
 *  - `'SKIPPED'`  — shop không đủ điều kiện, KHÔNG gọi TikTok (`skipReason` nói vì sao);
 *  - `'DEFERRED'` — lượt thủ công hết ngân sách thời gian, shop được chuyển sang hàng đợi nền.
 * Không thêm chúng vào enum DB: chỉ `DEFERRED` được ghi vào trạng thái shop (`PARTIAL` + mã lỗi rõ ràng).
 */
export interface ProductSyncOutcome {
  shopId: string;
  shopName: string;
  status: PodProductSyncStatus | 'LOCKED' | 'SKIPPED' | 'DEFERRED';
  skipReason?: ProductSyncSkipReason;
  scope: PodProductSyncScope;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  pagesFetched: number;
  apiCalls: number;
  /** Số sản phẩm bị đánh dấu ngừng bán ở lượt này (chỉ FULL sync). */
  deactivated: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface SyncOptions {
  trigger: PodProductSyncTrigger;
  triggeredBy?: string | null;
  /** Ép quét toàn bộ, bỏ qua watermark (người dùng bấm "Đồng bộ toàn bộ"). */
  full?: boolean;
  /** Chỉ đồng bộ đúng một sản phẩm (màn hình chi tiết). */
  tiktokProductId?: string;
  /**
   * Hạn chót (epoch ms) của lượt THỦ CÔNG. Shop chưa bắt đầu / đang dở khi hết giờ được chuyển
   * sang hàng đợi nền và báo `DEFERRED`. Bỏ trống (scheduler, worker) = không giới hạn.
   */
  deadlineAt?: number;
}

/** Tham số vận hành đọc từ `tiktok.productSync` (một nguồn — configuration.ts). */
interface ProductSyncSettings {
  shopConcurrency: number;
}

/** Bộ đếm nội bộ của một lượt chạy. */
interface RunCounters {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  pages: number;
  apiCalls: number;
  /** Số sản phẩm bị đánh dấu ngừng bán ở lượt này (chỉ FULL sync). */
  deactivated: number;
  /** Lượt dừng giữa chừng vì hết ngân sách thời gian (chỉ lượt thủ công). */
  deadlineHit: boolean;
}

/**
 * PodProductSyncService — đồng bộ sản phẩm TikTok → NCMedia.
 *
 * 🔴 MỘT CHIỀU: Sprint này chỉ ĐỌC. Không tạo, không sửa, không publish, không xoá sản
 * phẩm trên TikTok. Mọi lời gọi đi qua `TiktokProductApiService` (SDK chính thức).
 *
 * Cách chạy một lượt (áp dụng cho cả thủ công lẫn theo lịch — P3: một pipeline duy nhất):
 *
 * ```
 *  khoá theo shop (Redis)                     ← không cho 2 lượt chồng nhau
 *      ↓
 *  chọn phạm vi: FULL (chưa có watermark / người dùng ép) | INCREMENTAL (update_time_ge)
 *      ↓
 *  Search Products → đi HẾT các trang (page_token)
 *      ↓  với mỗi trang: so `payload_hash` để biết sản phẩm nào thực sự đổi
 *  Get Product cho các sản phẩm cần cập nhật  ← chạy song song có giới hạn
 *      ↓
 *  lưu payload gốc + ghi aggregate trong transaction + ghi log từng sản phẩm
 *      ↓
 *  đẩy watermark CHỈ KHI không có sản phẩm lỗi
 * ```
 *
 * Fail-soft (P6): một sản phẩm lỗi không làm hỏng cả lượt; một shop lỗi không chặn shop khác.
 */
@Injectable()
export class PodProductSyncService {
  private readonly logger = new Logger(PodProductSyncService.name);

  constructor(
    private readonly repo: PodProductRepository,
    private readonly syncRepo: PodProductSyncRepository,
    /** Dòng "Latest Sync Status" (PRODUCT) của shop — một dòng mỗi shop, không phải lịch sử. */
    private readonly syncStatus: PodShopSyncStatusRepository,
    private readonly mapper: PodProductMapper,
    private readonly productApi: TiktokProductApiService,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
    private readonly lock: DistributedLockService,
    /** Hàng đợi hoãn theo shop — đặt cuối để mọi nơi khởi tạo bằng vị trí chỉ thêm vào cuối. */
    private readonly queue: PodProductSyncQueue,
    /**
     * Tham số vận hành (`tiktok.productSync.*`). `@Optional()` + đặt cuối: test dựng service
     * bằng vị trí vẫn chạy với giá trị mặc định.
     */
    @Optional() config?: ConfigService,
  ) {
    this.settings = {
      shopConcurrency: config?.get<number>('tiktok.productSync.shopConcurrency', 2) ?? 2,
    };
  }

  private readonly settings: ProductSyncSettings;

  /**
   * Hẹn đồng bộ sản phẩm cho MỘT shop sau `POD_PRODUCT_SYNC_PUBLISH_DELAY_MS`.
   *
   * 🔴 Đây là cửa DUY NHẤT để đặt lịch đồng bộ hoãn. Nó không chạy gì cả — chỉ ghi một dòng
   * vào hàng đợi Redis; `PodProductSyncJob` mới là nơi lấy ra và gọi `syncShops`. Nhờ vậy
   * luồng publish trả về ngay, không giữ request nào sống 5 phút.
   *
   * 🔴 Phạm vi đúng MỘT shop: nơi gọi truyền `shopId` của chính listing vừa publish, và
   * tick sau cũng chỉ gọi `syncShops({ shopId })` — không có đường nào dẫn tới toàn cục.
   *
   * Lỗi Redis KHÔNG ném ra ngoài: publish đã thành công, mất một lần hẹn không được phép
   * biến thành publish thất bại. Lượt theo lịch vẫn quét tới sau đó.
   */
  async scheduleShopSync(shopId: string): Promise<Date | null> {
    try {
      const dueAt = await this.queue.schedule(
        shopId,
        POD_PRODUCT_SYNC_PUBLISH_DELAY_MS,
        POD_PRODUCT_SYNC_PUBLISH_MAX_WAIT_MS,
      );
      this.logger.log({
        module: 'pod-product',
        operation: 'sync.schedule',
        shopId,
        dueAt: dueAt.toISOString(),
        msg: 'Đã hẹn đồng bộ sản phẩm cho shop sau khi publish listing',
      });
      return dueAt;
    } catch (error) {
      this.logger.error({
        module: 'pod-product',
        operation: 'sync.schedule.fail',
        shopId,
        msg: error instanceof Error ? error.message : 'Lỗi không xác định',
      });
      return null;
    }
  }

  /**
   * Chạy các lượt đồng bộ ĐẾN HẠN trong hàng đợi hoãn. Gọi bởi `PodProductSyncJob`.
   *
   * 🔴 Mỗi shop MỘT lượt `syncShops({ shopId })` riêng. Không gom chung: một shop hỏng
   * (token chết) không được kéo theo các shop còn lại, và mỗi shop cần dòng lịch sử riêng.
   */
  async runDueShopSyncs(): Promise<{ shops: number; failed: number }> {
    const shopIds = await this.queue.claimDue(POD_PRODUCT_SYNC_DUE_BATCH);
    if (shopIds.length === 0) return { shops: 0, failed: 0 };

    let failed = 0;
    for (const shopId of shopIds) {
      try {
        // 🔴 `{ shopId }` — đúng một shop. KHÔNG truyền `organizationId`: tenant lấy từ chính
        // bản ghi shop trong `findSyncTargets` (nguyên tắc P5 của tiến trình nền), nên không
        // có đường nào chạm sang tổ chức khác.
        const outcomes = await this.syncShops(
          { shopId },
          { trigger: PodProductSyncTrigger.SCHEDULER },
        );
        if (outcomes.some((outcome) => outcome.status === PodProductSyncStatus.FAILED)) {
          failed += 1;
          await this.queue.requeue(shopId, POD_PRODUCT_SYNC_REQUEUE_DELAY_MS);
        }
      } catch (error) {
        failed += 1;
        await this.queue.requeue(shopId, POD_PRODUCT_SYNC_REQUEUE_DELAY_MS);
        this.logger.error({
          module: 'pod-product',
          operation: 'sync.due.fail',
          shopId,
          msg: error instanceof Error ? error.message : 'Lỗi không xác định',
        });
      }
    }

    return { shops: shopIds.length, failed };
  }

  /**
   * Đồng bộ nhiều shop (scheduler, "Sync Products" thủ công, lượt đầu sau khi liên kết).
   *
   * ```
   *  mọi shop trong phạm vi (findSyncCandidates)
   *      ├─ không đủ điều kiện ⇒ SKIPPED + lý do       ← KHÔNG gọi TikTok
   *      └─ đủ điều kiện       ⇒ song song có trần (`shopConcurrency`)
   *              ├─ hết hạn chót trước khi bắt đầu ⇒ DEFERRED + vào hàng đợi nền
   *              └─ syncShop()  (không bao giờ ném lỗi — lỗi thành FAILED của riêng shop đó)
   * ```
   *
   * 🔴 Một shop ngừng hoạt động / lỗi KHÔNG làm dừng các shop còn lại. Quota TikTok tính theo
   * App × Shop nên các shop khác nhau chạy song song không giành quota của nhau; trần song song
   * giữ tải DB/Redis ổn định, rate limit vẫn do `TikTokSdkService` (backoff + Retry-After) xử lý.
   */
  async syncShops(
    filter: ProductSyncScopeParams,
    options: SyncOptions,
  ): Promise<ProductSyncOutcome[]> {
    const candidates = await this.syncRepo.findSyncCandidates(filter);

    const outcomes = await runWithBoundedConcurrency(
      candidates,
      {
        limit: this.settings.shopConcurrency,
        deadlineAt: options.deadlineAt,
        onDeadline: (candidate) =>
          this.skipReasonOf(candidate)
            ? this.skippedOutcome(candidate)
            : this.defer(candidate, 'queued'),
      },
      async (candidate) => {
        if (this.skipReasonOf(candidate)) return this.skippedOutcome(candidate);
        const outcome = await this.syncShop(candidate, options);
        return outcome.status === 'DEFERRED' ? this.defer(candidate, 'partial', outcome) : outcome;
      },
    );

    return outcomes;
  }

  /**
   * Shop có đủ điều kiện gọi TikTok không. `null` = đủ.
   *
   * Thứ tự kiểm là thứ tự "nguyên nhân gốc": kết nối chết thì mọi shop của nó đều không gọi
   * được, nên báo lý do cấp kết nối trước lý do cấp shop.
   */
  private skipReasonOf(candidate: ProductSyncCandidate): ProductSyncSkipReason | null {
    if (candidate.account.status !== PodTiktokAccountStatus.ACTIVE) {
      return `ACCOUNT_${candidate.account.status}` as ProductSyncSkipReason;
    }
    if (candidate.status === PodTiktokShopStatus.INACTIVE) return 'SHOP_INACTIVE';
    if (candidate.status === PodTiktokShopStatus.DEAUTHORIZED) return 'SHOP_DEAUTHORIZED';
    if (!candidate.productSyncEnabled) return 'PRODUCT_SYNC_DISABLED';
    return null;
  }

  /**
   * Chuyển shop sang hàng đợi nền (lượt thủ công hết giờ) và trả kết quả `DEFERRED`.
   *
   * 🔴 Hẹn chạy NGAY (`delay = 0`): worker lấy ra ở tick kế tiếp (≤ 1 phút). Hàng đợi khoá theo
   * shopId nên bấm lại nhiều lần cũng chỉ một dòng. Lỗi Redis không được làm hỏng response —
   * `scheduleShopSync`-style: ghi log, lượt theo lịch vẫn quét tới.
   */
  private async defer(
    target: ProductSyncTarget,
    stage: 'queued' | 'partial',
    partial?: ProductSyncOutcome,
  ): Promise<ProductSyncOutcome> {
    try {
      await this.queue.schedule(target.id, 0, 0);
    } catch (error) {
      this.logger.error({
        module: 'pod-product',
        operation: 'sync.defer.fail',
        organizationId: target.organizationId,
        shopId: target.id,
        msg: error instanceof Error ? error.message : 'Lỗi không xác định',
      });
    }
    this.logger.warn({
      module: 'pod-product',
      operation: 'sync.defer',
      organizationId: target.organizationId,
      shopId: target.id,
      stage,
      msg: 'Hết thời gian của lượt đồng bộ thủ công — shop được chuyển sang hàng đợi nền',
    });
    return (
      partial ?? {
        ...this.emptyOutcome(target),
        status: 'DEFERRED',
        errorCode: PRODUCT_SYNC_DEADLINE_CODE,
      }
    );
  }

  /** Đồng bộ MỘT shop. Không bao giờ ném lỗi ra ngoài — lỗi được ghi vào lịch sử. */
  async syncShop(target: ProductSyncTarget, options: SyncOptions): Promise<ProductSyncOutcome> {
    const lockKey = `${POD_PRODUCT_SYNC_LOCK_PREFIX}${target.id}`;
    const handle = await this.lock.acquire(lockKey, POD_PRODUCT_SYNC_LOCK_TTL_MS);

    if (!handle) {
      this.logger.warn({
        module: 'pod-product',
        operation: 'sync.skip',
        organizationId: target.organizationId,
        shopId: target.id,
        msg: 'Đang có lượt đồng bộ khác cho shop này — bỏ qua lượt hiện tại',
      });
      return this.lockedOutcome(target);
    }

    try {
      return await this.runSync(target, options);
    } finally {
      await this.lock.release(handle);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — luồng chính
  // ---------------------------------------------------------------------------

  private async runSync(
    target: ProductSyncTarget,
    options: SyncOptions,
  ): Promise<ProductSyncOutcome> {
    const scope = this.resolveScope(target, options);
    const startedAt = new Date();
    const nowSeconds = BigInt(Math.floor(startedAt.getTime() / 1000));
    const watermarkFrom = this.resolveWatermarkFrom(target, scope);

    // 🔴 SINGLE (làm mới MỘT sản phẩm) không phải lượt đồng bộ của SHOP ⇒ không ghi đè trạng thái shop.
    const run =
      scope === PodProductSyncScope.SINGLE
        ? null
        : await this.syncStatus.start({
            organizationId: target.organizationId,
            accountId: target.accountId,
            shopId: target.id,
            syncType: PodShopSyncType.PRODUCT,
            trigger: toShopSyncTrigger(options.trigger),
            triggeredBy: options.triggeredBy ?? null,
            startedAt,
          });
    const watermark = { from: watermarkFrom, to: nowSeconds };

    const counters: RunCounters = {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      pages: 0,
      apiCalls: 0,
      deactivated: 0,
      deadlineHit: false,
    };

    this.logger.log({
      module: 'pod-product',
      operation: 'sync.start',
      organizationId: target.organizationId,
      accountId: target.accountId,
      shopId: target.id,
      scope,
      trigger: options.trigger,
      msg: 'Bắt đầu đồng bộ sản phẩm',
    });

    try {
      const ctx = await this.buildContext(target);

      const summaries =
        scope === PodProductSyncScope.SINGLE
          ? [{ id: options.tiktokProductId } as TiktokProductSummary]
          : await this.fetchSummaries(ctx, target, watermarkFrom, counters, options.deadlineAt);

      counters.fetched = summaries.length;
      await this.ingestSummaries(ctx, target, summaries, counters, options.deadlineAt);

      // Đối soát hai chiều (danh sách tóm tắt đã ĐẦY ĐỦ kể cả khi phần ghi dừng vì hết giờ):
      //   1. Có mặt trong danh sách của một trạng thái được quản lý ⇒ gỡ dấu "rời tập".
      //   2. Vắng mặt ở lượt FULL ⇒ đánh dấu "rời tập" (DRAFT / DELETED / ngoài bảng ánh xạ).
      await this.reconcileActive(target, scope, summaries, counters);

      const status =
        counters.failed > 0 || counters.deadlineHit
          ? PodProductSyncStatus.PARTIAL
          : PodProductSyncStatus.SUCCESS;

      await this.recordFinish(run, status, scope, counters, watermark, {
        ...(counters.deadlineHit
          ? {
              errorCode: PRODUCT_SYNC_DEADLINE_CODE,
              errorMessage: new ProductSyncDeadlineError().message,
            }
          : {}),
      });

      // 🔴 Chỉ đẩy watermark khi KHÔNG còn sản phẩm lỗi và không phải lượt SINGLE. Lượt dừng vì
      // hết giờ là PARTIAL ⇒ không đẩy, lượt nền kế tiếp quét lại từ mốc cũ.
      if (status === PodProductSyncStatus.SUCCESS && scope !== PodProductSyncScope.SINGLE) {
        await this.syncRepo.updateWatermark(target.id, nowSeconds);
      }

      this.logger.log({
        module: 'pod-product',
        operation: 'sync.finish',
        organizationId: target.organizationId,
        accountId: target.accountId,
        shopId: target.id,
        scope,
        status,
        durationMs: Date.now() - startedAt.getTime(),
        ...counters,
        msg: 'Hoàn tất đồng bộ sản phẩm',
      });

      return {
        ...this.baseOutcome(target, scope, counters),
        ...(counters.deadlineHit
          ? { status: 'DEFERRED' as const, errorCode: PRODUCT_SYNC_DEADLINE_CODE }
          : { status }),
      };
    } catch (error) {
      if (error instanceof ProductSyncDeadlineError) {
        // Hết giờ ngay ở bước quét danh sách: không phải lỗi TikTok ⇒ KHÔNG tăng bộ đếm lỗi
        // (circuit breaker), không đẩy watermark. Lượt nền sẽ chạy lại đầy đủ.
        await this.recordFinish(run, PodProductSyncStatus.PARTIAL, scope, counters, watermark, {
          errorCode: PRODUCT_SYNC_DEADLINE_CODE,
          errorMessage: error.message,
        });
        return {
          ...this.baseOutcome(target, scope, counters),
          status: 'DEFERRED',
          errorCode: PRODUCT_SYNC_DEADLINE_CODE,
          errorMessage: error.message,
        };
      }

      const described = this.describeError(error);
      await this.recordFinish(run, PodProductSyncStatus.FAILED, scope, counters, watermark, described);
      await this.syncRepo.incrementFailure(target.id);

      this.logger.error({
        module: 'pod-product',
        operation: 'sync.fail',
        organizationId: target.organizationId,
        accountId: target.accountId,
        shopId: target.id,
        scope,
        durationMs: Date.now() - startedAt.getTime(),
        productsFetched: counters.fetched,
        errorCode: described.errorCode,
        tiktokRequestId: described.tiktokRequestId,
        msg: described.errorMessage,
      });

      return {
        ...this.baseOutcome(target, scope, counters),
        status: PodProductSyncStatus.FAILED,
        errorCode: described.errorCode ?? undefined,
        errorMessage: described.errorMessage ?? undefined,
      };
    }
  }

  /**
   * Đối soát "tập được quản lý" (mọi trạng thái trong `POD_PRODUCT_STATUS_MAP`) giữa TikTok và
   * database, hai chiều.
   *
   * 🔴 Phần đánh dấu CHỈ chạy với lượt **FULL**, và đây là giới hạn có chủ đích. Lượt
   * INCREMENTAL chỉ hỏi TikTok "có gì đổi sau mốc X", nên một sản phẩm không xuất hiện có thể vì
   * nó **rời tập** (thành DRAFT/DELETED) — hoặc đơn giản vì nó **không đổi gì**. Không phân biệt
   * được hai điều đó, nên đối soát ở lượt incremental sẽ ẩn sạch mọi sản phẩm bình thường.
   *
   * Sản phẩm quay lại tập được quản lý ở lượt sau tự khôi phục (`reactivateSeen`).
   */
  private async reconcileActive(
    target: ProductSyncTarget,
    scope: PodProductSyncScope,
    summaries: TiktokProductSummary[],
    counters: RunCounters,
  ): Promise<void> {
    const seen = summaries.map((summary) => summary.id).filter((id): id is string => Boolean(id));

    // (1) Bán lại được thì khôi phục — chạy ở MỌI phạm vi. Không thể gộp vào đường ghi:
    // sản phẩm có nội dung không đổi bị bỏ qua trước khi tới `upsertAggregate`.
    const restored = await this.repo.reactivateSeen(target.organizationId, target.id, seen);
    if (restored > 0) {
      this.logger.log({
        module: 'pod-product',
        operation: 'sync.reactivate',
        organizationId: target.organizationId,
        shopId: target.id,
        restored,
        msg: 'Sản phẩm bán lại trên TikTok — đã gỡ dấu ngừng bán',
      });
    }

    // (2) Đánh dấu ngừng bán — chỉ ở lượt FULL.
    if (scope !== PodProductSyncScope.FULL) return;

    counters.deactivated = await this.repo.deactivateMissing(
      target.organizationId,
      target.id,
      seen,
    );

    if (counters.deactivated > 0) {
      this.logger.log({
        module: 'pod-product',
        operation: 'sync.deactivate',
        organizationId: target.organizationId,
        shopId: target.id,
        deactivated: counters.deactivated,
        msg: 'Đã đánh dấu ngừng bán các sản phẩm không còn ACTIVATE trên TikTok',
      });
    }
  }

  /**
   * Quét danh sách sản phẩm qua Search Products — MỘT lượt cho MỖI trạng thái được quản lý
   * (`POD_PRODUCT_SYNC_TIKTOK_STATUSES`), mỗi lượt đi hết mọi trang.
   *
   * 🔴 Lọc NGAY TẠI REQUEST, không dùng `status = ALL`: trên shop thật 82% bản ghi là DELETED,
   * và mỗi sản phẩm tải về tốn thêm một lời gọi Get Product — phần đắt nhất của cả lượt.
   *
   * 🔴 Khử trùng lặp theo `id`: sản phẩm đổi trạng thái ĐÚNG lúc đang quét có thể xuất hiện ở
   * hai danh sách. Giữ một bản — Get Product sau đó mới là nguồn của trạng thái thật.
   */
  private async fetchSummaries(
    ctx: TiktokShopContext,
    target: ProductSyncTarget,
    watermarkFrom: bigint | null,
    counters: RunCounters,
    deadlineAt?: number,
  ): Promise<TiktokProductSummary[]> {
    const byId = new Map<string, TiktokProductSummary>();

    for (const status of POD_PRODUCT_SYNC_TIKTOK_STATUSES) {
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
        throw new ProductSyncDeadlineError();
      }

      const summaries = await this.productApi.searchAllProducts(
        ctx,
        {
          status,
          ...(watermarkFrom === null
            ? {}
            : // Quét lùi thêm overlap: `update_time` của TikTok có thể vượt khoảng tìm kiếm.
              { updateTimeGe: Number(watermarkFrom) - POD_PRODUCT_SYNC_OVERLAP_SECONDS }),
        },
        async (_page, pageIndex) => {
          counters.pages += 1;
          counters.apiCalls += 1;
          this.logger.log({
            module: 'pod-product',
            operation: 'sync.page',
            organizationId: target.organizationId,
            shopId: target.id,
            tiktokStatus: status,
            page: pageIndex + 1,
            msg: 'Đã lấy một trang danh sách sản phẩm',
          });
          return Promise.resolve();
        },
      );

      for (const summary of summaries) {
        if (summary.id) byId.set(summary.id, summary);
      }
    }

    return [...byId.values()];
  }

  /**
   * Lấy chi tiết + ghi DB cho từng sản phẩm.
   *
   * Bỏ qua sớm những sản phẩm mà `update_time` không đổi so với lần đồng bộ trước
   * (so `payload_hash` của payload tóm tắt) — tiết kiệm đúng thứ đắt nhất: một call
   * Get Product cho mỗi sản phẩm.
   */
  private async ingestSummaries(
    ctx: TiktokShopContext,
    target: ProductSyncTarget,
    summaries: TiktokProductSummary[],
    counters: RunCounters,
    deadlineAt?: number,
  ): Promise<void> {
    const ids = summaries.map((summary) => summary.id).filter((id): id is string => Boolean(id));
    const knownHashes = await this.repo.findHashes(target.organizationId, target.id, ids);

    for (let index = 0; index < ids.length; index += POD_PRODUCT_DETAIL_CONCURRENCY) {
      // 🔴 Hạn chót kiểm GIỮA các lô, không cắt ngang lô đang chạy: lô dở dang là sản phẩm đã
      // gọi TikTok mà không ghi được. Phần còn lại do lượt nền (watermark chưa đẩy) quét lại.
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
        counters.deadlineHit = true;
        this.logger.warn({
          module: 'pod-product',
          operation: 'sync.deadline',
          organizationId: target.organizationId,
          shopId: target.id,
          processed: index,
          remaining: ids.length - index,
          msg: 'Hết thời gian của lượt thủ công — dừng ghi, phần còn lại chạy ở hàng đợi nền',
        });
        break;
      }

      const batch = ids.slice(index, index + POD_PRODUCT_DETAIL_CONCURRENCY);
      const results = await Promise.all(
        batch.map((productId) =>
          this.ingestOne(ctx, target, productId, knownHashes.get(productId)),
        ),
      );

      for (const result of results) {
        counters.apiCalls += result.apiCalls;
        if (result.action === PodProductSyncAction.CREATED) counters.created += 1;
        if (result.action === PodProductSyncAction.UPDATED) counters.updated += 1;
        if (result.action === PodProductSyncAction.SKIPPED) counters.skipped += 1;
        if (result.action === PodProductSyncAction.FAILED) counters.failed += 1;
      }
    }
  }

  /** Đọc chi tiết và ghi MỘT sản phẩm. Lỗi được nuốt và biến thành log — fail-soft. */
  private async ingestOne(
    ctx: TiktokShopContext,
    target: ProductSyncTarget,
    tiktokProductId: string,
    knownHash?: string,
  ): Promise<{
    tiktokProductId: string;
    productId: string | null;
    action: PodProductSyncAction;
    apiCalls: number;
    message?: string | null;
    errorCode?: string | null;
    tiktokRequestId?: string | null;
  }> {
    try {
      const { data: detail, requestId } = await this.productApi.getProduct(ctx, tiktokProductId);
      const mapped = this.mapper.toWriteData(detail, detail);

      // 🔴 Trạng thái ngoài bảng ánh xạ (TikTok thêm giá trị mới, hoặc sản phẩm vừa chuyển sang
      // DRAFT/DELETED giữa lúc quét): lưu NGUYÊN chuỗi gốc, KHÔNG quy về ACTIVE. Bản ghi không
      // thuộc nhóm nào trên màn hình Products — log để bổ sung bảng ánh xạ khi cần.
      if (toLocalProductStatus(detail.status) === null) {
        this.logger.warn({
          module: 'pod-product',
          operation: 'sync.product.status.unmapped',
          organizationId: target.organizationId,
          shopId: target.id,
          tiktokProductId,
          tiktokStatus: detail.status ?? null,
          msg: 'Trạng thái TikTok chưa có trong bảng ánh xạ POD_PRODUCT_STATUS_MAP',
        });
      }

      if (knownHash && knownHash === mapped.product.payloadHash) {
        return {
          tiktokProductId,
          productId: null,
          action: PodProductSyncAction.SKIPPED,
          apiCalls: 1,
          message: 'Payload không đổi',
        };
      }

      const { id, created } = await this.repo.upsertAggregate(
        target.organizationId,
        target.accountId,
        target.id,
        mapped,
        null,
      );

      // Lưu payload gốc SAU khi ghi thành công để có `productId` gắn kèm.
      await this.repo.saveRawData({
        organizationId: target.organizationId,
        shopId: target.id,
        productId: id,
        tiktokProductId,
        source: PodProductRawSource.DETAIL,
        apiVersion: TIKTOK_PRODUCT_API_VERSIONS.getProduct,
        payload: detail as unknown as Prisma.InputJsonValue,
        payloadHash: mapped.product.payloadHash,
        tiktokRequestId: requestId,
      });

      return {
        tiktokProductId,
        productId: id,
        action: created ? PodProductSyncAction.CREATED : PodProductSyncAction.UPDATED,
        apiCalls: 1,
        tiktokRequestId: requestId,
      };
    } catch (error) {
      const described = this.describeError(error);
      this.logger.warn({
        module: 'pod-product',
        operation: 'sync.product.fail',
        organizationId: target.organizationId,
        shopId: target.id,
        tiktokProductId,
        errorCode: described.errorCode,
        tiktokRequestId: described.tiktokRequestId,
        msg: described.errorMessage,
      });
      return {
        tiktokProductId,
        productId: null,
        action: PodProductSyncAction.FAILED,
        apiCalls: 1,
        message: described.errorMessage,
        errorCode: described.errorCode,
        tiktokRequestId: described.tiktokRequestId,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Private — tiện ích
  // ---------------------------------------------------------------------------

  /** Dựng ngữ cảnh gọi API: token còn hạn (tự refresh nếu cần) + `shop_cipher` đã giải mã. */
  private async buildContext(target: ProductSyncTarget): Promise<TiktokShopContext> {
    const token = await this.tokenService.ensureValidAccessToken(target.account);
    if (!token.ok) {
      throw new Error(`Không lấy được access token (${token.reason}): ${token.message}`);
    }
    return {
      accessToken: token.accessToken,
      shopCipher: this.encryption.decrypt(target.shopCipherEnc),
      shopId: target.id,
      organizationId: target.organizationId,
    };
  }

  /**
   * FULL khi: người dùng ép, chưa từng đồng bộ (chưa có watermark), hoặc đồng bộ 1 sản phẩm.
   * Ngược lại INCREMENTAL theo `update_time_ge`.
   */
  private resolveScope(target: ProductSyncTarget, options: SyncOptions): PodProductSyncScope {
    if (options.tiktokProductId) return PodProductSyncScope.SINGLE;
    if (options.full || target.productSyncCursor === null) return PodProductSyncScope.FULL;
    return PodProductSyncScope.INCREMENTAL;
  }

  private resolveWatermarkFrom(
    target: ProductSyncTarget,
    scope: PodProductSyncScope,
  ): bigint | null {
    return scope === PodProductSyncScope.INCREMENTAL ? target.productSyncCursor : null;
  }

  /**
   * Ghi kết quả lượt vào dòng trạng thái của shop (`run = null` ⇒ lượt SINGLE, không ghi). Không truyền
   * lỗi ⇒ cột lỗi được XOÁ (FAILED → SUCCESS không còn mang lỗi của lượt trước).
   */
  private async recordFinish(
    run: SyncRunHandle | null,
    status: PodProductSyncStatus,
    scope: PodProductSyncScope,
    counters: RunCounters,
    watermark: { from: bigint | null; to: bigint },
    error: { errorCode?: string | null; errorMessage?: string | null; tiktokRequestId?: string | null },
  ): Promise<void> {
    if (!run) return;
    await this.syncStatus.finish(run, {
      status: PodSyncStatus[status],
      totalCount: counters.fetched,
      createdCount: counters.created,
      updatedCount: counters.updated,
      skippedCount: counters.skipped,
      failedCount: counters.failed,
      errorCode: error.errorCode ?? null,
      errorMessage: error.errorMessage ?? null,
      details: {
        scope,
        productsDeactivated: counters.deactivated,
        pagesFetched: counters.pages,
        apiCalls: counters.apiCalls,
        ...(watermark.from === null ? {} : { watermarkFrom: watermark.from.toString() }),
        watermarkTo: watermark.to.toString(),
        ...(error.tiktokRequestId ? { tiktokRequestId: error.tiktokRequestId } : {}),
      },
    });
  }

  private baseOutcome(
    target: ProductSyncTarget,
    scope: PodProductSyncScope,
    counters: RunCounters,
  ): Omit<ProductSyncOutcome, 'status'> {
    return {
      shopId: target.id,
      shopName: target.name,
      scope,
      fetched: counters.fetched,
      created: counters.created,
      updated: counters.updated,
      skipped: counters.skipped,
      failed: counters.failed,
      pagesFetched: counters.pages,
      apiCalls: counters.apiCalls,
      deactivated: counters.deactivated,
    };
  }

  /** Shop không đủ điều kiện — KHÔNG gọi TikTok, không ghi trạng thái. */
  private skippedOutcome(candidate: ProductSyncCandidate): ProductSyncOutcome {
    const skipReason = this.skipReasonOf(candidate) ?? undefined;
    this.logger.log({
      module: 'pod-product',
      operation: 'sync.skip',
      organizationId: candidate.organizationId,
      accountId: candidate.accountId,
      shopId: candidate.id,
      skipReason,
      msg: 'Bỏ qua shop không đủ điều kiện đồng bộ sản phẩm',
    });
    return { ...this.emptyOutcome(candidate), status: 'SKIPPED', skipReason };
  }

  /** Shop đang có lượt đồng bộ khác chạy (khoá Redis). */
  private lockedOutcome(target: ProductSyncTarget): ProductSyncOutcome {
    return { ...this.emptyOutcome(target), status: 'LOCKED' };
  }

  private emptyOutcome(target: ProductSyncTarget): Omit<ProductSyncOutcome, 'status'> {
    return {
      shopId: target.id,
      shopName: target.name,
      scope: PodProductSyncScope.INCREMENTAL,
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      pagesFetched: 0,
      apiCalls: 0,
      deactivated: 0,
    };
  }

  private describeError(error: unknown): {
    errorCode: string | null;
    errorMessage: string | null;
    tiktokRequestId: string | null;
  } {
    if (error instanceof TiktokClientError) {
      return {
        errorCode: String(error.tiktokCode),
        errorMessage: error.tiktokMessage,
        tiktokRequestId: error.requestId ?? null,
      };
    }
    return {
      errorCode: null,
      errorMessage: error instanceof Error ? error.message : 'Lỗi không xác định',
      tiktokRequestId: null,
    };
  }
}
