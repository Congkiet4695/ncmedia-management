import { Injectable, Logger } from '@nestjs/common';
import {
  PodProductRawSource,
  PodProductSyncAction,
  PodProductSyncScope,
  PodProductSyncStatus,
  PodProductSyncTrigger,
  Prisma,
} from '@prisma/client';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { PodTiktokTokenService } from '../../pod-tiktok/services/pod-tiktok-token.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { TIKTOK_PRODUCT_API_VERSIONS } from '../../tiktok-sdk/tiktok-sdk.constants';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import type { TiktokProductSummary } from '../../tiktok-sdk/types/tiktok-product.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  POD_PRODUCT_DETAIL_CONCURRENCY,
  POD_PRODUCT_SYNC_LOCK_PREFIX,
  POD_PRODUCT_SYNC_LOCK_TTL_MS,
  POD_PRODUCT_SYNC_OVERLAP_SECONDS,
} from '../constants/pod-product.constants';
import { PodProductMapper } from '../mappers/pod-product.mapper';
import { PodProductRepository } from '../repositories/pod-product.repository';
import {
  PodProductSyncRepository,
  type ProductSyncTarget,
} from '../repositories/pod-product-sync.repository';

/**
 * Kết quả đồng bộ MỘT shop.
 *
 * `status` có thêm giá trị `'LOCKED'` (không thuộc enum DB) cho trường hợp bỏ qua vì
 * đang có lượt khác chạy — trường hợp đó KHÔNG tạo bản ghi lịch sử nên cũng không cần
 * (và không nên) thêm một giá trị enum vào database chỉ để mô tả nó.
 */
export interface ProductSyncOutcome {
  shopId: string;
  shopName: string;
  historyId: string;
  status: PodProductSyncStatus | 'LOCKED';
  scope: PodProductSyncScope;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  pagesFetched: number;
  apiCalls: number;
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
    private readonly mapper: PodProductMapper,
    private readonly productApi: TiktokProductApiService,
    private readonly tokenService: PodTiktokTokenService,
    private readonly encryption: TiktokEncryptionService,
    private readonly lock: DistributedLockService,
  ) {}

  /**
   * Đồng bộ nhiều shop (scheduler hoặc "Sync Now" ở màn hình danh sách).
   * Chạy TUẦN TỰ theo shop: quota TikTok tính theo App × Shop và dùng chung cho mọi
   * tenant — bung song song là tự làm nghẽn chính mình.
   */
  async syncShops(
    filter: { organizationId?: string; accountId?: string; shopId?: string },
    options: SyncOptions,
  ): Promise<ProductSyncOutcome[]> {
    const targets = await this.syncRepo.findSyncTargets(filter);
    const outcomes: ProductSyncOutcome[] = [];

    for (const target of targets) {
      outcomes.push(await this.syncShop(target, options));
    }

    return outcomes;
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
      return this.skippedOutcome(target);
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

    const historyId = await this.syncRepo.startHistory({
      organizationId: target.organizationId,
      accountId: target.accountId,
      shopId: target.id,
      scope,
      trigger: options.trigger,
      watermarkFrom,
      watermarkTo: nowSeconds,
      triggeredBy: options.triggeredBy ?? null,
    });

    const counters: RunCounters = {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      pages: 0,
      apiCalls: 0,
    };

    try {
      const ctx = await this.buildContext(target);

      const summaries =
        scope === PodProductSyncScope.SINGLE
          ? [{ id: options.tiktokProductId } as TiktokProductSummary]
          : await this.fetchSummaries(ctx, target, watermarkFrom, counters);

      counters.fetched = summaries.length;
      await this.ingestSummaries(ctx, target, historyId, summaries, counters);

      const status =
        counters.failed > 0 ? PodProductSyncStatus.PARTIAL : PodProductSyncStatus.SUCCESS;

      await this.syncRepo.finishHistory(historyId, {
        status,
        productsFetched: counters.fetched,
        productsCreated: counters.created,
        productsUpdated: counters.updated,
        productsSkipped: counters.skipped,
        productsFailed: counters.failed,
        pagesFetched: counters.pages,
        apiCalls: counters.apiCalls,
        startedAt,
      });

      // 🔴 Chỉ đẩy watermark khi KHÔNG còn sản phẩm lỗi và không phải lượt SINGLE.
      if (status === PodProductSyncStatus.SUCCESS && scope !== PodProductSyncScope.SINGLE) {
        await this.syncRepo.updateWatermark(target.id, nowSeconds);
      }

      this.logger.log({
        module: 'pod-product',
        operation: 'sync.finish',
        organizationId: target.organizationId,
        shopId: target.id,
        scope,
        status,
        ...counters,
        msg: 'Hoàn tất đồng bộ sản phẩm',
      });

      return { ...this.baseOutcome(target, historyId, scope, counters), status };
    } catch (error) {
      const described = this.describeError(error);
      await this.syncRepo.finishHistory(historyId, {
        status: PodProductSyncStatus.FAILED,
        productsFetched: counters.fetched,
        productsCreated: counters.created,
        productsUpdated: counters.updated,
        productsSkipped: counters.skipped,
        productsFailed: counters.failed,
        pagesFetched: counters.pages,
        apiCalls: counters.apiCalls,
        startedAt,
        ...described,
      });
      await this.syncRepo.incrementFailure(target.id);

      this.logger.error({
        module: 'pod-product',
        operation: 'sync.fail',
        organizationId: target.organizationId,
        shopId: target.id,
        scope,
        errorCode: described.errorCode,
        tiktokRequestId: described.tiktokRequestId,
        msg: described.errorMessage,
      });

      return {
        ...this.baseOutcome(target, historyId, scope, counters),
        status: PodProductSyncStatus.FAILED,
        errorCode: described.errorCode ?? undefined,
        errorMessage: described.errorMessage ?? undefined,
      };
    }
  }

  /** Quét danh sách sản phẩm qua Search Products, đi hết mọi trang. */
  private async fetchSummaries(
    ctx: TiktokShopContext,
    target: ProductSyncTarget,
    watermarkFrom: bigint | null,
    counters: RunCounters,
  ): Promise<TiktokProductSummary[]> {
    return this.productApi.searchAllProducts(
      ctx,
      watermarkFrom === null
        ? {}
        : // Quét lùi thêm overlap: `update_time` của TikTok có thể vượt khoảng tìm kiếm.
          { updateTimeGe: Number(watermarkFrom) - POD_PRODUCT_SYNC_OVERLAP_SECONDS },
      async (_page, pageIndex) => {
        counters.pages = pageIndex + 1;
        counters.apiCalls += 1;
        this.logger.log({
          module: 'pod-product',
          operation: 'sync.page',
          organizationId: target.organizationId,
          shopId: target.id,
          page: pageIndex + 1,
          msg: 'Đã lấy một trang danh sách sản phẩm',
        });
        return Promise.resolve();
      },
    );
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
    historyId: string,
    summaries: TiktokProductSummary[],
    counters: RunCounters,
  ): Promise<void> {
    const ids = summaries.map((summary) => summary.id).filter((id): id is string => Boolean(id));
    const knownHashes = await this.repo.findHashes(target.organizationId, target.id, ids);

    const logs: Parameters<PodProductSyncRepository['insertLogs']>[0] = [];

    for (let index = 0; index < ids.length; index += POD_PRODUCT_DETAIL_CONCURRENCY) {
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

        logs.push({
          organizationId: target.organizationId,
          historyId,
          productId: result.productId,
          tiktokProductId: result.tiktokProductId,
          action: result.action,
          message: result.message,
          errorCode: result.errorCode,
          tiktokRequestId: result.tiktokRequestId,
        });
      }
    }

    await this.syncRepo.insertLogs(logs);
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

  private baseOutcome(
    target: ProductSyncTarget,
    historyId: string,
    scope: PodProductSyncScope,
    counters: RunCounters,
  ): Omit<ProductSyncOutcome, 'status'> {
    return {
      shopId: target.id,
      shopName: target.name,
      historyId,
      scope,
      fetched: counters.fetched,
      created: counters.created,
      updated: counters.updated,
      skipped: counters.skipped,
      failed: counters.failed,
      pagesFetched: counters.pages,
      apiCalls: counters.apiCalls,
    };
  }

  private skippedOutcome(target: ProductSyncTarget): ProductSyncOutcome {
    return {
      shopId: target.id,
      shopName: target.name,
      historyId: '',
      status: 'LOCKED',
      scope: PodProductSyncScope.INCREMENTAL,
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      pagesFetched: 0,
      apiCalls: 0,
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
