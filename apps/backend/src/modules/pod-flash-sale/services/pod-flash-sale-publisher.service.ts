import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PodFlashSaleItemStatus,
  PodFlashSaleLogAction,
  PodFlashSaleLogLevel,
  PodFlashSaleProductLevel,
  PodFlashSaleStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RETRYABLE_ERROR_CLASSES } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { DistributedLockService, type AcquiredLock } from '../../pod-tiktok/infra/distributed-lock.service';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import {
  POD_SCOPE_SYSTEM,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import {
  PodTiktokShopContextException,
  PodTiktokShopContextService,
} from '../../pod-tiktok/services/pod-tiktok-shop-context.service';
import { TiktokPromotionApiService } from '../../tiktok-sdk/tiktok-promotion-api.service';
import {
  TIKTOK_ACTIVITY_COMMAND_IMMUTABLE,
  TIKTOK_ACTIVITY_PRODUCT_LEVEL,
  TIKTOK_ACTIVITY_TYPE,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type {
  TiktokActivityDetail,
  TiktokActivityProductInput,
} from '../../tiktok-sdk/types/tiktok-promotion.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  FLASH_SALE_BATCH_TIMEOUT_MS,
  FLASH_SALE_BATCH_MAX_RETRIES,
  FLASH_SALE_BATCH_RETRY_BASE_MS,
  FLASH_SALE_BATCH_RETRY_MAX_MS,
  FLASH_SALE_CANCELLABLE_STATUSES,
  FLASH_SALE_PUBLISHABLE_STATUSES,
  FLASH_SALE_PUBLISH_LOCK_PREFIX,
  FLASH_SALE_PUBLISH_LOCK_RENEW_MS,
  FLASH_SALE_PUBLISH_LOCK_TTL_MS,
  FLASH_SALE_UNLIMITED,
  TIKTOK_TO_FLASH_SALE_STATUS,
} from '../constants/pod-flash-sale.constants';
import {
  chunkBySkuLimit,
  computeBatchRetryDelayMs,
  countActivitySkus,
} from './pod-flash-sale-batching';
import type { PodFlashSalePublishResultDto } from '../dto/pod-flash-sale-response.dto';
import {
  PodFlashSaleInvalidStateException,
  PodFlashSaleNotPublishableException,
  PodFlashSaleProviderException,
  PodFlashSaleShopContextException,
} from '../exceptions/pod-flash-sale.exceptions';
import type { FlashSaleDetailRow, FlashSaleItemRow } from '../mappers/pod-flash-sale.mapper';
import { formatPriceForProvider } from './pod-flash-sale-pricing';
import { PodFlashSaleService } from './pod-flash-sale.service';

/**
 * Kế hoạch gửi MỘT mục sản phẩm: payload cho TikTok + những dòng database sinh ra nó.
 *
 * 🔴 Phần `itemIds` là thứ làm cho lượt publish CHẠY LẠI ĐƯỢC. Sau mỗi lô thành công, đúng
 * những dòng này chuyển sang `PUBLISHED`; lần chạy sau chỉ gửi phần chưa `PUBLISHED`.
 */
interface ActivityProductPlan {
  input: TiktokActivityProductInput;
  /** Id các dòng `pod_flash_sale_items` gộp thành mục này. */
  itemIds: string[];
  /** `tiktok_sku_id` ⇒ id dòng — để ghi lại đúng SKU mà sàn xác nhận. */
  itemByVariantId: Map<string, string>;
}

/** Một lượt gọi TikTok quá hạn — xếp vào lỗi TẠM THỜI, đi vào nhánh thử lại. */
class PodFlashSaleBatchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Lượt gọi TikTok quá ${timeoutMs}ms không phản hồi`);
    this.name = 'PodFlashSaleBatchTimeoutError';
  }
}

/** Kết quả một lượt Update Activity Products. */
type ProviderBatchResult = Awaited<
  ReturnType<TiktokPromotionApiService['updateActivityProducts']>
>;

/** Mọi thứ một lượt gửi lô chạy nền cần — gom lại để chữ ký hàm không dài mười tham số. */
interface PublishRunParams {
  flashSale: FlashSaleDetailRow;
  /** Token của lượt. Mọi câu ghi tiến độ đều kèm điều kiện này. */
  runId: string;
  /** `activity_id` — MỘT giá trị duy nhất cho toàn bộ các lô của lượt. */
  activityId: string;
  batches: ActivityProductPlan[][];
  userId: string | null;
  attempt: number;
}

/** Lỗi đã bóc tách thành ba mảnh mà mọi nơi trong module đều cần. */
interface ProviderFailure {
  code: string | null;
  message: string;
  requestId: string | null;
}

/**
 * PodFlashSalePublisherService — **cửa duy nhất** giữa module Flash Sale và TikTok.
 *
 * ```
 *   Publish ──▶ Create Activity ──▶ Update Activity Products ──▶ RUNNING
 *      │              (hoặc Update Activity nếu đã có activity_id)
 *      └──▶ lỗi ──▶ FAILED (giữ nguyên dữ liệu) ──▶ Retry đi lại đúng đường trên
 *
 *   Cancel  ──▶ Deactivate Activity ──▶ CANCELLED
 *   Sync    ──▶ Get Activity ──▶ ánh xạ trạng thái sàn về trạng thái hệ thống
 * ```
 *
 * Ba nguyên tắc:
 *
 * 🔴 **Không có nghiệp vụ nào khác gọi TikTok.** Màn hình danh sách, chi tiết, thêm sản
 * phẩm, đổi giá đều chỉ đọc/ghi database. Nhờ vậy quota TikTok chỉ bị tiêu khi thực sự có
 * hàng cần đẩy.
 *
 * 🔴 **Mọi lượt gọi để lại vết.** Request đã gửi, response nhận về, mã lỗi và `request_id`
 * đều ghi vào `pod_flash_sale_logs` — đó là dữ liệu của tab History và là thứ duy nhất mở
 * ticket với TikTok dùng được.
 *
 * 🔴 **Thất bại KHÔNG xoá gì.** Đợt sale chuyển sang `FAILED` với toàn bộ sản phẩm, giá và
 * giới hạn còn nguyên; Retry chạy lại đúng đường cũ. `activity_id` đã cấp cũng được giữ để
 * lần thử sau đi nhánh Update thay vì tạo thêm một hoạt động mồ côi trên shop.
 */
@Injectable()
export class PodFlashSalePublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(PodFlashSalePublisherService.name);

  /**
   * Các lượt publish đang chạy NỀN trong tiến trình này, theo `flashSaleId`.
   *
   * Hai công dụng thật (không phải chỗ móc cho test):
   *  1. Chặn lượt thứ hai của cùng một đợt sale ngay trong tiến trình — rẻ hơn một vòng
   *     tới Redis, và là lớp đầu tiên trước khoá phân tán.
   *  2. `onModuleDestroy` chờ chúng kết thúc, để một lần deploy không cắt ngang lượt gửi
   *     giữa lô 12 và lô 13.
   */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly flashSales: PodFlashSaleService,
    private readonly promotionApi: TiktokPromotionApiService,
    private readonly shopContext: PodTiktokShopContextService,
    // 🔴 Tham số MỚI đặt ở CUỐI: các spec dựng service bằng `new` theo thứ tự vị trí, chèn
    // vào giữa là làm hỏng mọi lời gọi đó mà trình biên dịch chỉ báo ở một chỗ.
    private readonly locks: DistributedLockService,
  ) {}

  /**
   * Chờ lượt publish nền của một đợt sale (hoặc tất cả) kết thúc.
   *
   * Dùng bởi `onModuleDestroy` khi tiến trình đang tắt. Trả về ngay nếu không có gì chạy.
   */
  async whenPublishIdle(flashSaleId?: string): Promise<void> {
    const pending = flashSaleId
      ? [this.running.get(flashSaleId)].filter(Boolean)
      : [...this.running.values()];
    await Promise.allSettled(pending as Array<Promise<void>>);
  }

  /**
   * Tắt tiến trình ⇒ chờ các lượt đang gửi dở.
   *
   * 🔴 Không huỷ giữa chừng: lô đang bay đã tiêu quota của TikTok rồi. Chờ nó xong và ghi
   * lại kết quả thì lần chạy sau biết chính xác phải gửi tiếp từ đâu; cắt ngang thì không.
   */
  async onModuleDestroy(): Promise<void> {
    await this.whenPublishIdle();
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  /**
   * Đẩy một đợt sale lên TikTok.
   *
   * ```
   *   [request HTTP]  kiểm tra ─▶ GIÀNH lượt ─▶ Create/Update Activity ─▶ TRẢ VỀ ngay
   *                                                    │  activity_id = X
   *                                                    ▼
   *   [chạy nền]      lô 1 ─▶ lô 2 ─▶ … ─▶ lô N   (TẤT CẢ vào activity_id = X)
   * ```
   *
   * 🔴 **Chỉ MỘT lượt gọi TikTok nằm trong request HTTP** — lượt tạo hoạt động. Toàn bộ
   * việc gắn sản phẩm chạy nền. Với 10.000 SKU đó là 34 lượt gọi; giữ chúng trong request
   * là cầm chắc timeout ở Nginx (300s), ở trình duyệt, và ở mọi proxy phía trước.
   *
   * 🔴 Client nhận `providerFlashSaleId` NGAY trong response, nên màn hình có id thật để
   * theo dõi thay vì phải chờ hoặc đoán.
   *
   * `skipInvalidItems = false` (mặc định): còn một dòng sai là dừng cả lượt. Cố ý — publish
   * "một phần" mà không nói gì là cách để một nửa danh mục im lặng không lên sale.
   */
  async publish(
    organizationId: string,
    // 🔴 `null` = tiến trình NỀN (lượt quét nhặt việc dở), không có người dùng nào đứng sau.
    // Cột `updated_by` là UUID: ghi chuỗi rỗng vào đó là một lỗi Prisma, còn ghi id của người
    // bấm lần trước là nói dối về người thao tác. Không ghi gì mới là câu trả lời đúng.
    userId: string | null,
    flashSaleId: string,
    options: { skipInvalidItems?: boolean },
    scope: PodAccessScope,
  ): Promise<PodFlashSalePublishResultDto> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);

    if (!FLASH_SALE_PUBLISHABLE_STATUSES.includes(flashSale.status)) {
      throw new PodFlashSaleInvalidStateException('publish Flash Sale', flashSale.status);
    }

    const validation = this.flashSales.validateRow(flashSale);
    const skipInvalid = options.skipInvalidItems === true;
    if (!validation.ok && !skipInvalid) {
      await this.flashSales.writeLog({
        organizationId,
        flashSaleId,
        action: PodFlashSaleLogAction.VALIDATE,
        level: PodFlashSaleLogLevel.ERROR,
        message: `Publish bị chặn: ${validation.issues.length} vấn đề cần xử lý.`,
        response: validation.issues as unknown as Prisma.InputJsonValue,
        userId,
      });
      throw new PodFlashSaleNotPublishableException(validation.issues);
    }

    // Lỗi ở PHẦN ĐẦU (tên, khung giờ) không phải lỗi của một dòng nào — `skipInvalidItems`
    // không cứu được, vì hoạt động sẽ bị TikTok từ chối ngay ở bước Create.
    const headerIssues = validation.issues.filter(
      (issue) => issue.level === 'ERROR' && !issue.itemId,
    );
    if (headerIssues.length > 0) throw new PodFlashSaleNotPublishableException(headerIssues);

    const publishable = this.selectPublishableItems(flashSale, validation);
    const skippedItems = flashSale.items.filter(
      (item) => item.status !== PodFlashSaleItemStatus.REMOVED && !publishable.includes(item),
    ).length;

    // 🔴 Chỉ gửi những dòng CHƯA lên sàn. Lượt đầu: toàn bộ danh sách. Lượt chạy lại: đây
    // chính là cơ chế "tiếp tục từ lô hỏng" — dòng TikTok đã nhận mang `PUBLISHED` và không
    // bị gửi lần hai. Dùng trạng thái DÒNG chứ không dùng số thứ tự lô: thành phần của một
    // lô đổi khi người dùng sửa danh sách, còn trạng thái dòng thì không.
    const pending = publishable.filter((item) => item.status !== PodFlashSaleItemStatus.PUBLISHED);
    const plans = this.buildProductPlans(flashSale.productLevel, pending);
    const batches = chunkBySkuLimit(plans, (plan) => countActivitySkus(plan.input));

    // ----------------------------------------------------------------------
    // GIÀNH lượt — chống trùng (idempotency)
    //
    // 🔴 Đọc trạng thái rồi ghi ở hai câu lệnh rời chính là chỗ để hai request bấm cùng lúc
    // CÙNG thấy `READY` và cùng đi tiếp. Một câu `updateMany` mang luôn điều kiện trạng thái
    // là phép so-sánh-và-đổi nguyên tử: đúng một request thắng, request thua nhận `count = 0`.
    // Đây là chỗ chặn bấm Publish hai lần, F5 giữa chừng, và hai instance API cùng nhận việc.
    // ----------------------------------------------------------------------
    const runId = randomUUID();
    const startedAt = new Date();
    const claim = await this.prisma.podFlashSale.updateMany({
      where: { id: flashSaleId, deletedAt: null, status: { in: FLASH_SALE_PUBLISHABLE_STATUSES } },
      data: {
        status: PodFlashSaleStatus.PUBLISHING,
        publishRunId: runId,
        publishTotalItems: pending.length,
        publishTotalBatches: batches.length,
        publishDoneBatches: 0,
        publishCurrentBatch: 0,
        publishFailedBatch: null,
        publishStartedAt: startedAt,
        publishFinishedAt: null,
        publishHeartbeatAt: startedAt,
        ...(userId ? { updatedBy: userId } : {}),
      },
    });
    if (claim.count === 0) {
      // Ai đó đã giành trước trong khoảnh khắc giữa `get` và `updateMany`.
      throw new PodFlashSaleInvalidStateException(
        'publish Flash Sale',
        PodFlashSaleStatus.PUBLISHING,
      );
    }

    const attempt = flashSale.retryCount;

    // Lượt gọi DUY NHẤT nằm trong request HTTP: tạo (hoặc cập nhật) hoạt động khuyến mãi.
    let activityId: string;
    try {
      const context = await this.resolveContext(organizationId, flashSale.shopId);
      activityId = await this.ensureActivity(context, flashSale, userId, attempt);
    } catch (error) {
      const failure = this.describeFailure(error);
      await this.failPublishRun(flashSale, runId, failure, userId, null);
      this.logger.error({
        module: 'pod-flash-sale',
        operation: 'flashSale.publish.activity',
        organizationId,
        flashSaleId,
        runId,
        errorCode: failure.code,
        requestId: failure.requestId,
        msg: `Tạo hoạt động khuyến mãi thất bại: ${failure.message}`,
      });
      throw new PodFlashSaleProviderException(
        failure.code,
        failure.message,
        failure.requestId ?? undefined,
      );
    }

    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.publish.start',
      organizationId,
      flashSaleId,
      runId,
      activityId,
      totalItems: pending.length,
      totalBatches: batches.length,
      skipped: skippedItems,
      msg: `Bắt đầu đẩy Flash Sale: ${pending.length} dòng, ${batches.length} lô, cùng một hoạt động ${activityId}`,
    });

    // Không còn gì để gửi (mọi dòng đã lên sàn ở lượt trước) ⇒ chốt luôn, không chạy nền.
    if (batches.length === 0) {
      await this.finishPublishRun(flashSale, runId, activityId, userId);
    } else {
      this.launchPublishRun({ flashSale, runId, activityId, batches, userId, attempt });
    }

    return {
      flashSaleId,
      // 🔴 `PUBLISHING`, không phải `RUNNING`: các lô còn đang gửi. Nói `RUNNING` ở đây là
      // báo cáo một kết quả chưa xảy ra.
      status: batches.length === 0 ? PodFlashSaleStatus.RUNNING : PodFlashSaleStatus.PUBLISHING,
      providerFlashSaleId: activityId,
      publishedItems: batches.length === 0 ? pending.length : 0,
      skippedItems,
      errorCode: null,
      errorMessage: null,
      totalItems: pending.length,
      totalBatches: batches.length,
      doneBatches: 0,
    };
  }

  /**
   * Retry Publish — đi lại đúng đường của `publish`, chỉ khác ở chỗ đếm số lần thử.
   *
   * 🔴 Không viết một đường publish thứ hai cho retry: hai đường sẽ trôi dạt và "chạy lại"
   * sẽ không còn giống "chạy lần đầu".
   *
   * 🔴 **Không bao giờ tạo hoạt động thứ hai.** `ensureActivity` thấy `providerFlashSaleId`
   * đã có thì đi nhánh Update; và `publish` chỉ gửi những dòng chưa `PUBLISHED`, nên lượt
   * chạy lại tiếp tục từ đúng chỗ đã hỏng thay vì gửi lại từ lô 1.
   */
  async retry(
    organizationId: string,
    userId: string | null,
    flashSaleId: string,
    options: { skipInvalidItems?: boolean },
    scope: PodAccessScope,
  ): Promise<PodFlashSalePublishResultDto> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    if (flashSale.status !== PodFlashSaleStatus.FAILED) {
      throw new PodFlashSaleInvalidStateException('retry publish', flashSale.status);
    }

    await this.prisma.podFlashSale.update({
      where: { id: flashSaleId },
      data: { retryCount: { increment: 1 }, ...(userId ? { updatedBy: userId } : {}) },
    });

    return this.publish(organizationId, userId, flashSaleId, options, scope);
  }

  // ---------------------------------------------------------------------------
  // Lượt publish chạy nền
  // ---------------------------------------------------------------------------

  /**
   * Thả lượt gửi lô chạy nền và ghi nhận nó vào sổ `running`.
   *
   * 🔴 `void` là cố ý: `publish` KHÔNG chờ. Nhưng lời hứa vẫn được giữ trong sổ để
   * `onModuleDestroy` chờ được lúc tiến trình tắt — thả một promise không ai cầm là cách
   * mất việc trong im lặng giữa một lần deploy.
   */
  private launchPublishRun(params: PublishRunParams): void {
    const key = params.flashSale.id;
    if (this.running.has(key)) {
      this.logger.warn({
        module: 'pod-flash-sale',
        flashSaleId: key,
        msg: 'Đã có lượt publish chạy nền cho đợt sale này — bỏ qua lượt mới',
      });
      return;
    }

    const task = this.runPublishBatches(params).finally(() => {
      this.running.delete(key);
    });
    this.running.set(key, task);
  }

  /**
   * Gửi từng lô lên CÙNG MỘT hoạt động khuyến mãi, TUẦN TỰ.
   *
   * 🔴 Tuần tự chứ không song song. Bắn 34 request cùng lúc vào TikTok là cách nhanh nhất
   * để cả App bị giới hạn tần suất — quota cấp theo App × Shop và dùng chung cho MỌI tổ
   * chức, nên một đợt sale hỏng luôn việc của người khác. Tuần tự còn cho ba thứ miễn phí:
   * tiến độ chính xác, biết đúng lô nào hỏng, và chạy lại được từ đó.
   *
   * 🔴 Khoá phân tán bao cả lượt: `@nestjs/schedule` chạy trên mọi instance, nên lượt quét
   * nhặt việc mồ côi có thể trùng với lượt do người dùng bấm. Watchdog gia hạn khoá theo
   * nhịp để lượt chạy dài không tự đánh mất khoá giữa chừng.
   */
  private async runPublishBatches(params: PublishRunParams): Promise<void> {
    const { flashSale, runId } = params;
    const lockKey = `${FLASH_SALE_PUBLISH_LOCK_PREFIX}${flashSale.id}`;

    const lock = await this.locks.acquire(lockKey, FLASH_SALE_PUBLISH_LOCK_TTL_MS);
    if (!lock) {
      this.logger.warn({
        module: 'pod-flash-sale',
        flashSaleId: flashSale.id,
        runId,
        msg: 'Không giành được khoá publish — tiến trình khác đang gửi đợt sale này',
      });
      return;
    }

    const watchdog = setInterval(() => {
      void this.locks.renew(lock, FLASH_SALE_PUBLISH_LOCK_TTL_MS);
    }, FLASH_SALE_PUBLISH_LOCK_RENEW_MS);
    // Nhịp gia hạn không được giữ tiến trình sống khi mọi việc khác đã xong.
    if (typeof watchdog.unref === 'function') watchdog.unref();

    try {
      await this.sendBatches(params, lock);
    } catch (error) {
      // Lỗi ngoài dự tính (bug, mất database) — không được để promise nền văng ra ngoài.
      this.logger.error({
        module: 'pod-flash-sale',
        flashSaleId: flashSale.id,
        runId,
        msg: `Lượt publish nền dừng bất thường: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
      });
      await this.failPublishRun(flashSale, runId, this.describeFailure(error), params.userId, null);
    } finally {
      clearInterval(watchdog);
      await this.locks.release(lock);
    }
  }

  /** Vòng gửi lô — tách khỏi phần khoá để đọc được mạch nghiệp vụ mà không lẫn hạ tầng. */
  private async sendBatches(params: PublishRunParams, lock: AcquiredLock): Promise<void> {
    const { flashSale, runId, activityId, batches, userId, attempt } = params;
    const context = await this.resolveContext(flashSale.organizationId, flashSale.shopId);

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const batchNo = index + 1;

      // Lượt mới hơn đã bắt đầu (người dùng bấm Retry) ⇒ lượt này rút lui, không ghi đè.
      if (!(await this.markBatchStarted(flashSale.id, runId, batchNo))) {
        this.logger.warn({
          module: 'pod-flash-sale',
          flashSaleId: flashSale.id,
          runId,
          msg: 'Lượt publish đã bị thay bằng lượt mới — dừng lượt cũ',
        });
        return;
      }

      const skuCount = batch.reduce((sum, plan) => sum + countActivitySkus(plan.input), 0);
      this.logger.log({
        module: 'pod-flash-sale',
        operation: 'flashSale.publish.batch',
        flashSaleId: flashSale.id,
        runId,
        activityId,
        batch: `${batchNo}/${batches.length}`,
        products: batch.length,
        skus: skuCount,
        msg: `Lô ${batchNo}/${batches.length} bắt đầu`,
      });

      try {
        const result = await this.sendBatchWithRetry(context, activityId, batch, lock);
        await this.markBatchPublished({
          flashSale,
          runId,
          activityId,
          batch,
          batchNo,
          result,
          userId,
          attempt,
        });

        this.logger.log({
          module: 'pod-flash-sale',
          operation: 'flashSale.publish.batch',
          flashSaleId: flashSale.id,
          runId,
          activityId,
          batch: `${batchNo}/${batches.length}`,
          msg: `Lô ${batchNo}/${batches.length} hoàn tất`,
        });
      } catch (error) {
        const failure = this.describeFailure(error);
        await this.failPublishRun(flashSale, runId, failure, userId, batchNo);

        this.logger.error({
          module: 'pod-flash-sale',
          operation: 'flashSale.publish.batch',
          flashSaleId: flashSale.id,
          runId,
          activityId,
          batch: `${batchNo}/${batches.length}`,
          batchSize: skuCount,
          errorCode: failure.code,
          requestId: failure.requestId,
          msg: `Lô ${batchNo}/${batches.length} THẤT BẠI: ${failure.message}`,
        });
        // 🔴 Dừng hẳn. Gửi tiếp sau khi một lô đã hỏng là để đợt sale kết thúc ở một trạng
        // thái không ai mô tả được: vài lô lên sàn, vài lô không, và không biết vì sao.
        return;
      }
    }

    await this.finishPublishRun(flashSale, runId, activityId, userId);
    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.publish.done',
      flashSaleId: flashSale.id,
      runId,
      activityId,
      totalBatches: batches.length,
      msg: `Đồng bộ Flash Sale hoàn tất: ${batches.length}/${batches.length} lô`,
    });
  }

  /**
   * Gửi MỘT lô, thử lại khi gặp lỗi TẠM THỜI.
   *
   * 🔴 Phân biệt tạm thời / vĩnh viễn bằng `RETRYABLE_ERROR_CLASSES` — bảng phân loại đã có
   * sẵn ở tầng SDK (NETWORK · RATE_LIMIT · SERVER), không dựng bảng thứ hai. Lỗi vĩnh viễn
   * (SKU sai, hết hạn uỷ quyền, tham số không hợp lệ) thử lại bao nhiêu lần cũng hỏng: chỉ
   * làm chậm việc báo lỗi cho người vận hành và đốt thêm quota.
   *
   * Khoá được gia hạn trước mỗi lần chờ — lần lùi cuối có thể dài hơn một nhịp watchdog.
   */
  private async sendBatchWithRetry(
    context: TiktokShopContext,
    activityId: string,
    batch: ActivityProductPlan[],
    lock: AcquiredLock,
  ): Promise<ProviderBatchResult> {
    const products = batch.map((plan) => plan.input);

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.withRequestTimeout(
          this.promotionApi.updateActivityProducts(context, activityId, products),
        );
      } catch (error) {
        const retryable =
          (error instanceof PodFlashSaleBatchTimeoutError ||
            (error instanceof TiktokClientError &&
              RETRYABLE_ERROR_CLASSES.includes(error.errorClass))) &&
          attempt < FLASH_SALE_BATCH_MAX_RETRIES;
        if (!retryable) throw error;

        // TikTok nói rõ phải chờ bao lâu thì nghe theo; không thì lùi theo cấp số nhân.
        const retryAfterMs =
          error instanceof TiktokClientError && error.retryAfterSeconds
            ? error.retryAfterSeconds * 1_000
            : computeBatchRetryDelayMs(
                attempt + 1,
                FLASH_SALE_BATCH_RETRY_BASE_MS,
                FLASH_SALE_BATCH_RETRY_MAX_MS,
              );

        this.logger.warn({
          module: 'pod-flash-sale',
          operation: 'flashSale.publish.batch.retry',
          activityId,
          attempt: attempt + 1,
          delayMs: retryAfterMs,
          errorClass: error instanceof TiktokClientError ? error.errorClass : 'UNKNOWN',
          msg: 'Lô gặp lỗi tạm thời — sẽ thử lại',
        });

        await this.locks.renew(lock, FLASH_SALE_PUBLISH_LOCK_TTL_MS);
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      }
    }
  }

  /**
   * Nhặt lại một lượt publish ĐỨT GÁNH (tiến trình chết giữa chừng, deploy cắt ngang).
   *
   * Gọi bởi lượt quét định kỳ, không có người dùng nào đứng sau.
   *
   * 🔴 Không tạo hoạt động mới và không gửi lại từ lô 1: đợt sale được đưa về `FAILED` rồi
   * đi lại đúng đường `publish`, nên nó dùng lại `activity_id` cũ và chỉ gửi những dòng chưa
   * `PUBLISHED`. Đó là lý do việc đánh dấu dòng theo TỪNG LÔ là bắt buộc.
   *
   * 🔴 `POD_SCOPE_SYSTEM` là hợp lệ ở đây vì đây là tiến trình nền của hệ thống — tenant lấy
   * từ chính bản ghi đợt sale. Thấy hằng số này trong một controller thì đó là bug.
   */
  async resumeStalledPublish(flashSale: {
    id: string;
    organizationId: string;
    publishRunId: string | null;
  }): Promise<boolean> {
    // Đưa về FAILED để `publish` nhận lại được (PUBLISHING không nằm trong nhóm publishable).
    // Có điều kiện `publishRunId` để không cướp việc của một lượt vừa hồi sinh.
    const released = await this.prisma.podFlashSale.updateMany({
      where: {
        id: flashSale.id,
        status: PodFlashSaleStatus.PUBLISHING,
        publishRunId: flashSale.publishRunId,
      },
      data: {
        status: PodFlashSaleStatus.FAILED,
        lastErrorCode: 'PUBLISH_INTERRUPTED',
        lastErrorMessage:
          'Lượt publish bị gián đoạn (tiến trình dừng giữa chừng). Hệ thống đang gửi tiếp phần còn lại.',
        publishFinishedAt: new Date(),
      },
    });
    if (released.count === 0) return false;

    this.logger.warn({
      module: 'pod-flash-sale',
      operation: 'flashSale.publish.resume',
      flashSaleId: flashSale.id,
      msg: 'Nhặt lại lượt publish đứt gánh — gửi tiếp phần chưa lên sàn trên CÙNG hoạt động',
    });

    // 🔴 `null` chứ không phải chuỗi rỗng: `updated_by` là cột UUID.
    await this.publish(flashSale.organizationId, null, flashSale.id, {}, POD_SCOPE_SYSTEM);
    return true;
  }

  /**
   * Chặn trên thời gian chờ MỘT lượt gọi TikTok.
   *
   * 🔴 SDK vendored không đặt timeout cho từng request và `fetch` của Node cũng không có
   * mặc định — một socket treo sẽ giữ khoá publish và làm đợt sale kẹt ở `PUBLISHING`.
   *
   * 🔴 Đây KHÔNG phải cách chữa timeout của cả lượt publish: việc đó đã được giải bằng kiến
   * trúc (request HTTP trả về ngay, các lô chạy nền). Ở đây chỉ là hàng rào cho một lượt gọi.
   *
   * Lời hứa gốc không huỷ được (SDK không nhận `AbortSignal`), nên request vẫn chạy tiếp ở
   * nền — nhưng lượt publish không còn bị nó giữ chân, và lần thử lại vẫn nguyên tắc "gửi
   * lại cùng lô vào cùng hoạt động" nên không sinh dữ liệu lạ.
   */
  private async withRequestTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new PodFlashSaleBatchTimeoutError(FLASH_SALE_BATCH_TIMEOUT_MS)),
            FLASH_SALE_BATCH_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /**
   * Huỷ một đợt sale.
   *
   * Đã lên sàn ⇒ gọi Deactivate trước rồi mới đổi trạng thái nội bộ. Đổi trạng thái trước
   * là cách tạo ra đúng thứ tệ nhất: hệ thống nói "đã huỷ" trong khi khuyến mãi vẫn chạy
   * trên shop thật.
   */
  async cancel(
    organizationId: string,
    userId: string,
    flashSaleId: string,
    scope: PodAccessScope,
  ): Promise<PodFlashSalePublishResultDto> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    if (!FLASH_SALE_CANCELLABLE_STATUSES.includes(flashSale.status)) {
      throw new PodFlashSaleInvalidStateException('huỷ Flash Sale', flashSale.status);
    }

    if (flashSale.providerFlashSaleId) {
      try {
        const context = await this.resolveContext(organizationId, flashSale.shopId);
        const result = await this.promotionApi.deactivateActivity(
          context,
          flashSale.providerFlashSaleId,
        );
        await this.flashSales.writeLog({
          organizationId,
          flashSaleId,
          action: PodFlashSaleLogAction.DEACTIVATE,
          message: 'Đã gửi yêu cầu huỷ hoạt động khuyến mãi tới TikTok.',
          request: { activityId: flashSale.providerFlashSaleId },
          response: result.data,
          requestId: result.requestId ?? null,
          userId,
        });
      } catch (error) {
        const failure = this.describeFailure(error);
        await this.flashSales.writeLog({
          organizationId,
          flashSaleId,
          action: PodFlashSaleLogAction.DEACTIVATE,
          level: PodFlashSaleLogLevel.ERROR,
          message: 'Huỷ hoạt động khuyến mãi trên TikTok thất bại.',
          request: { activityId: flashSale.providerFlashSaleId },
          errorCode: failure.code,
          errorMessage: failure.message,
          requestId: failure.requestId,
          userId,
        });
        throw new PodFlashSaleProviderException(failure.code, failure.message, failure.requestId ?? undefined);
      }
    }

    await this.prisma.podFlashSale.update({
      where: { id: flashSaleId },
      data: { status: PodFlashSaleStatus.CANCELLED, updatedBy: userId },
    });

    return {
      flashSaleId,
      status: PodFlashSaleStatus.CANCELLED,
      providerFlashSaleId: flashSale.providerFlashSaleId,
      publishedItems: 0,
      skippedItems: 0,
      errorCode: null,
      errorMessage: null,
      // Huỷ không phải một lượt gửi lô — không có tiến độ nào để báo.
      totalItems: 0,
      totalBatches: 0,
      doneBatches: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Sync trạng thái
  // ---------------------------------------------------------------------------

  /**
   * Đọc lại trạng thái một đợt sale từ TikTok và ghi về database.
   *
   * Dùng bởi scheduler và bởi nút "Refresh" ở màn hình chi tiết. Đợt chưa từng lên sàn thì
   * không có gì để hỏi — trả về nguyên trạng.
   */
  async syncStatus(flashSale: {
    id: string;
    organizationId: string;
    shopId: string;
    providerFlashSaleId: string | null;
    status: PodFlashSaleStatus;
    endAt: Date;
  }): Promise<PodFlashSaleStatus> {
    if (!flashSale.providerFlashSaleId) return flashSale.status;

    try {
      const context = await this.resolveContext(flashSale.organizationId, flashSale.shopId);
      const result = await this.promotionApi.getActivity(context, flashSale.providerFlashSaleId);
      const next = this.mapProviderStatus(result.data, flashSale.endAt);

      await this.prisma.podFlashSale.update({
        where: { id: flashSale.id },
        data: {
          status: next,
          providerStatus: result.data.status ?? null,
          lastSyncedAt: new Date(),
          // Đồng bộ thành công ⇒ lỗi cũ không còn mô tả hiện trạng nữa.
          ...(next === PodFlashSaleStatus.FAILED
            ? {}
            : { lastErrorCode: null, lastErrorMessage: null, lastErrorRequestId: null }),
        },
      });

      await this.syncItemConfirmations(flashSale.id, result.data);

      await this.flashSales.writeLog({
        organizationId: flashSale.organizationId,
        flashSaleId: flashSale.id,
        action: PodFlashSaleLogAction.SYNC_STATUS,
        message: `Trạng thái TikTok: ${result.data.status ?? 'không rõ'} ⇒ ${next}.`,
        response: result.data as unknown as Prisma.InputJsonValue,
        requestId: result.requestId ?? null,
      });

      return next;
    } catch (error) {
      const failure = this.describeFailure(error);
      // 🔴 KHÔNG đổi trạng thái đợt sale khi chỉ mỗi lượt ĐỌC thất bại. Mạng chập một nhịp
      // không có nghĩa là khuyến mãi trên sàn đã hỏng; đánh dấu FAILED ở đây sẽ khiến người
      // vận hành đi huỷ một đợt đang chạy bình thường.
      await this.prisma.podFlashSale.update({
        where: { id: flashSale.id },
        data: { lastSyncedAt: new Date() },
      });
      await this.flashSales.writeLog({
        organizationId: flashSale.organizationId,
        flashSaleId: flashSale.id,
        action: PodFlashSaleLogAction.SYNC_STATUS,
        level: PodFlashSaleLogLevel.WARN,
        message: 'Không đọc được trạng thái hoạt động khuyến mãi từ TikTok.',
        errorCode: failure.code,
        errorMessage: failure.message,
        requestId: failure.requestId,
      });
      return flashSale.status;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — các bước của một lượt publish
  // ---------------------------------------------------------------------------

  private async resolveContext(organizationId: string, shopId: string): Promise<TiktokShopContext> {
    try {
      return await this.shopContext.resolve(organizationId, shopId);
    } catch (error) {
      if (error instanceof PodTiktokShopContextException) {
        throw new PodFlashSaleShopContextException(error.message);
      }
      throw error;
    }
  }

  /**
   * Bảo đảm có `activity_id`: tạo mới, hoặc cập nhật tên/giờ của hoạt động đã có.
   *
   * 🔴 Đợt sale đã từng lên sàn thì KHÔNG tạo hoạt động thứ hai — nếu không, mỗi lần Retry
   * lại đẻ thêm một khuyến mãi mồ côi trên shop thật mà không ai gỡ.
   */
  private async ensureActivity(
    context: TiktokShopContext,
    flashSale: FlashSaleDetailRow,
    userId: string | null,
    attempt: number,
  ): Promise<string> {
    const beginTime = Math.floor(flashSale.startAt.getTime() / 1_000);
    const endTime = Math.floor(flashSale.endAt.getTime() / 1_000);
    const productLevel =
      flashSale.productLevel === PodFlashSaleProductLevel.PRODUCT
        ? TIKTOK_ACTIVITY_PRODUCT_LEVEL.PRODUCT
        : TIKTOK_ACTIVITY_PRODUCT_LEVEL.VARIATION;

    if (flashSale.providerFlashSaleId) {
      const request = { title: flashSale.name, productLevel, beginTime, endTime };
      const result = await this.promotionApi.updateActivity(
        context,
        flashSale.providerFlashSaleId,
        request,
      );
      await this.flashSales.writeLog({
        organizationId: flashSale.organizationId,
        flashSaleId: flashSale.id,
        action: PodFlashSaleLogAction.UPDATE_ACTIVITY,
        message: 'Đã cập nhật tên và khung giờ của hoạt động khuyến mãi.',
        request: { activityId: flashSale.providerFlashSaleId, ...request },
        response: result.data as unknown as Prisma.InputJsonValue,
        requestId: result.requestId ?? null,
        attempt,
        userId,
      });
      return flashSale.providerFlashSaleId;
    }

    const request = {
      title: flashSale.name,
      activityType: TIKTOK_ACTIVITY_TYPE.FLASHSALE,
      productLevel,
      beginTime,
      endTime,
    };
    const result = await this.promotionApi.createActivity(context, request);

    // Ghi `activity_id` NGAY, trước khi gắn sản phẩm. Tiến trình chết ở bước sau thì lần
    // Retry vẫn tìm lại được hoạt động đã tạo thay vì tạo một cái mới.
    await this.prisma.podFlashSale.update({
      where: { id: flashSale.id },
      data: { providerFlashSaleId: result.data.activityId, providerStatus: result.data.status ?? null },
    });

    await this.flashSales.writeLog({
      organizationId: flashSale.organizationId,
      flashSaleId: flashSale.id,
      action: PodFlashSaleLogAction.CREATE_ACTIVITY,
      message: `Đã tạo hoạt động khuyến mãi ${result.data.activityId} trên TikTok.`,
      request,
      response: result.data as unknown as Prisma.InputJsonValue,
      requestId: result.requestId ?? null,
      attempt,
      userId,
    });

    return result.data.activityId;
  }

  /**
   * Dòng trong database ⇒ **kế hoạch gửi**: payload của TikTok + id những dòng sinh ra nó.
   *
   * 🔴 Vì sao mang theo id dòng chứ không chỉ payload: sau mỗi lô thành công, đúng những
   * dòng của lô đó được đánh dấu `PUBLISHED`. Không có phần ánh xạ này thì tiến trình chết
   * ở lô 12 sẽ không biết 11 lô trước đã lên sàn, và lần chạy lại phải gửi lại từ đầu —
   * vừa tốn quota, vừa ghi đè dữ liệu TikTok đã nhận.
   *
   * Hai mức hai hình dạng khác hẳn nhau:
   *  - `PRODUCT`: giá + giới hạn đặt ở SPU, `skus` bắt buộc là `[]`. MỘT dòng = MỘT mục.
   *  - `VARIATION`: giá + giới hạn đặt ở từng SKU, còn ở mức SPU **bắt buộc** là `-1` —
   *    TikTok từ chối cả request nếu gửi số khác. NHIỀU dòng gộp về MỘT mục theo sản phẩm cha.
   */
  private buildProductPlans(
    productLevel: PodFlashSaleProductLevel,
    items: FlashSaleItemRow[],
  ): ActivityProductPlan[] {
    if (productLevel === PodFlashSaleProductLevel.PRODUCT) {
      return items
        .filter((item) => item.providerProductId)
        .map((item) => ({
          input: {
            id: item.providerProductId as string,
            activityPriceAmount: formatPriceForProvider(item.flashSalePrice),
            quantityLimit: item.totalPurchaseLimit,
            quantityPerUser: item.customerPurchaseLimit,
            skus: [],
          },
          itemIds: [item.id],
          itemByVariantId: new Map<string, string>(),
        }));
    }

    // Gộp các dòng SKU về đúng sản phẩm cha — TikTok nhận một mục cho mỗi `product_id`.
    const byProduct = new Map<string, ActivityProductPlan>();
    for (const item of items) {
      if (!item.providerProductId || !item.providerVariantId) continue;

      const plan =
        byProduct.get(item.providerProductId) ??
        ({
          input: {
            id: item.providerProductId,
            quantityLimit: FLASH_SALE_UNLIMITED,
            quantityPerUser: FLASH_SALE_UNLIMITED,
            skus: [],
          },
          itemIds: [],
          itemByVariantId: new Map<string, string>(),
        } satisfies ActivityProductPlan);

      // 🔴 Mức VARIATION: mỗi SKU mang giá deal RIÊNG của nó, tính từ giá gốc RIÊNG của nó
      // (`pod-flash-sale-pricing`, toàn bộ bằng `Prisma.Decimal`). Đây là chỗ "giảm 30%" trở
      // thành bốn con số khác nhau cho bốn SKU khác giá, thay vì một con số dùng chung.
      plan.input.skus.push({
        id: item.providerVariantId,
        activityPriceAmount: formatPriceForProvider(item.flashSalePrice),
        quantityLimit: item.totalPurchaseLimit,
        quantityPerUser: item.customerPurchaseLimit,
      });
      plan.itemIds.push(item.id);
      plan.itemByVariantId.set(item.providerVariantId, item.id);
      byProduct.set(item.providerProductId, plan);
    }
    return [...byProduct.values()];
  }

  // ---------------------------------------------------------------------------
  // Ghi tiến độ của lượt publish
  //
  // 🔴 MỌI câu ghi ở đây đều mang điều kiện `publishRunId = runId` (`updateMany`, không phải
  // `update`). Đó là hàng rào chống lượt CŨ ghi đè lượt MỚI: người dùng bấm Retry trong lúc
  // lượt trước còn đang gửi thì lượt trước phải im lặng rút lui, không được phép hạ tiến độ
  // của lượt mới xuống hay đánh dấu nó thất bại.
  // ---------------------------------------------------------------------------

  /** Đánh dấu bắt đầu một lô. Trả `false` khi lượt này đã bị lượt mới hơn thay thế. */
  private async markBatchStarted(
    flashSaleId: string,
    runId: string,
    batchNo: number,
  ): Promise<boolean> {
    const result = await this.prisma.podFlashSale.updateMany({
      where: { id: flashSaleId, publishRunId: runId },
      data: { publishCurrentBatch: batchNo, publishHeartbeatAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * Một lô đã được TikTok nhận: đánh dấu đúng những dòng của lô đó, nhích tiến độ, ghi log.
   *
   * 🔴 Đánh dấu NGAY sau từng lô chứ không đợi hết lượt. Đợi hết lượt nghĩa là một lượt hỏng
   * ở lô 33/34 sẽ không để lại dấu vết nào về 32 lô đã thành công — và lần chạy lại gửi lại
   * toàn bộ 10.000 SKU.
   */
  private async markBatchPublished(params: {
    flashSale: FlashSaleDetailRow;
    runId: string;
    activityId: string;
    batch: ActivityProductPlan[];
    batchNo: number;
    result: ProviderBatchResult;
    userId: string | null;
    attempt: number;
  }): Promise<void> {
    const { flashSale, runId, activityId, batch, batchNo, result, userId, attempt } = params;

    const itemIds = batch.flatMap((plan) => plan.itemIds);
    // `sku_id` mà TikTok XÁC NHẬN đã vào hoạt động — chỉ ghi khi sàn thực sự trả về.
    const confirmed = new Map<string, string>();
    for (const product of result.data.products ?? []) {
      for (const sku of product.skus ?? []) {
        if (!sku.id) continue;
        for (const plan of batch) {
          const itemId = plan.itemByVariantId.get(sku.id);
          if (itemId) confirmed.set(itemId, sku.id);
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (itemIds.length > 0) {
        await tx.podFlashSaleItem.updateMany({
          where: { id: { in: itemIds } },
          data: { status: PodFlashSaleItemStatus.PUBLISHED, errorCode: null, error: null },
        });
      }
      for (const [itemId, skuId] of confirmed) {
        await tx.podFlashSaleItem.update({
          where: { id: itemId },
          data: { providerSkuId: skuId },
        });
      }
      await tx.podFlashSale.updateMany({
        where: { id: flashSale.id, publishRunId: runId },
        data: { publishDoneBatches: batchNo, publishHeartbeatAt: new Date() },
      });
    });

    await this.flashSales.writeLog({
      organizationId: flashSale.organizationId,
      flashSaleId: flashSale.id,
      action: PodFlashSaleLogAction.UPDATE_PRODUCTS,
      message: `Lô ${batchNo}: đã gửi ${batch.length} sản phẩm (${itemIds.length} dòng) vào hoạt động khuyến mãi.`,
      request: { activityId, batch: batchNo, products: batch.map((plan) => plan.input) } as unknown as Prisma.InputJsonValue,
      response: result.data as unknown as Prisma.InputJsonValue,
      requestId: result.requestId ?? null,
      attempt,
      userId,
    });
  }

  /** Cả lượt đã xong: đợt sale lên sàn. */
  private async finishPublishRun(
    flashSale: FlashSaleDetailRow,
    runId: string,
    activityId: string,
    userId: string | null,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.podFlashSale.updateMany({
      where: { id: flashSale.id, publishRunId: runId },
      data: {
        status: PodFlashSaleStatus.RUNNING,
        providerFlashSaleId: activityId,
        publishedAt: now,
        lastSyncedAt: now,
        publishFinishedAt: now,
        publishHeartbeatAt: now,
        publishCurrentBatch: null,
        publishFailedBatch: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastErrorRequestId: null,
        ...(userId ? { updatedBy: userId } : {}),
      },
    });
  }

  /**
   * Lượt hỏng: đợt sale về `FAILED`, giữ nguyên MỌI dữ liệu.
   *
   * 🔴 Trạng thái tuyệt đối KHÔNG được là `RUNNING`/hoàn tất khi còn lô chưa gửi. `failedBatch`
   * cộng với trạng thái từng dòng là đủ để người vận hành biết "hỏng ở lô 12/34" và để nút
   * Retry gửi tiếp từ đúng chỗ đó — trên CÙNG một hoạt động khuyến mãi.
   */
  private async failPublishRun(
    flashSale: FlashSaleDetailRow,
    runId: string,
    failure: ProviderFailure,
    userId: string | null,
    batchNo: number | null,
  ): Promise<void> {
    const now = new Date();
    const changed = await this.prisma.podFlashSale.updateMany({
      where: { id: flashSale.id, publishRunId: runId },
      data: {
        status: PodFlashSaleStatus.FAILED,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message.slice(0, 2000),
        lastErrorRequestId: failure.requestId,
        publishFailedBatch: batchNo,
        publishFinishedAt: now,
        publishHeartbeatAt: now,
        ...(userId ? { updatedBy: userId } : {}),
      },
    });
    // Lượt đã bị thay thế ⇒ không ghi log thất bại cho một lượt không còn ai theo dõi.
    if (changed.count === 0) return;

    await this.flashSales.writeLog({
      organizationId: flashSale.organizationId,
      flashSaleId: flashSale.id,
      action: PodFlashSaleLogAction.UPDATE_PRODUCTS,
      level: PodFlashSaleLogLevel.ERROR,
      message:
        batchNo === null
          ? 'Publish Flash Sale thất bại.'
          : `Publish Flash Sale thất bại ở lô ${batchNo}.`,
      errorCode: failure.code,
      errorMessage: failure.message,
      requestId: failure.requestId,
      attempt: flashSale.retryCount,
      userId,
    });
  }

  /** Dòng nào được phép gửi: tất cả, hoặc chỉ những dòng không có lỗi khi bỏ qua dòng sai. */
  private selectPublishableItems(
    flashSale: FlashSaleDetailRow,
    validation: { issues: Array<{ level: string; itemId?: string | null }> },
  ): FlashSaleItemRow[] {
    const brokenIds = new Set(
      validation.issues
        .filter((issue) => issue.level === 'ERROR' && issue.itemId)
        .map((issue) => issue.itemId as string),
    );
    return flashSale.items.filter(
      (item) => item.status !== PodFlashSaleItemStatus.REMOVED && !brokenIds.has(item.id),
    );
  }

  /**
   * Ghi ngược `sku_id` mà TikTok xác nhận trong hoạt động (dùng ở lượt sync).
   *
   * Dòng nào có trong database mà KHÔNG có trong danh sách TikTok trả về nghĩa là sàn đã gỡ
   * nó ra (hết hàng, sản phẩm bị khoá) — đánh dấu `REMOVED` để người vận hành thấy đúng thứ
   * đang thực sự chạy, thay vì một danh sách đẹp không phản ánh hiện trạng.
   */
  private async syncItemConfirmations(
    flashSaleId: string,
    activity: TiktokActivityDetail,
  ): Promise<void> {
    const confirmedSkuIds = new Set<string>();
    const confirmedProductIds = new Set<string>();
    for (const product of activity.products ?? []) {
      if (product.id) confirmedProductIds.add(product.id);
      for (const sku of product.skus ?? []) if (sku.id) confirmedSkuIds.add(sku.id);
    }

    // TikTok trả `products` rỗng cho hoạt động đã kết thúc quá 180 ngày (theo tài liệu) —
    // trong trường hợp đó danh sách rỗng KHÔNG có nghĩa là mọi dòng đã bị gỡ.
    if (confirmedProductIds.size === 0) return;

    const items = await this.prisma.podFlashSaleItem.findMany({
      where: { flashSaleId, status: { not: PodFlashSaleItemStatus.REMOVED } },
      select: { id: true, providerProductId: true, providerVariantId: true },
    });

    const removedIds: string[] = [];
    for (const item of items) {
      const stillThere = item.providerVariantId
        ? confirmedSkuIds.has(item.providerVariantId)
        : Boolean(item.providerProductId && confirmedProductIds.has(item.providerProductId));
      if (!stillThere) removedIds.push(item.id);
    }

    if (removedIds.length > 0) {
      await this.prisma.podFlashSaleItem.updateMany({
        where: { id: { in: removedIds } },
        data: { status: PodFlashSaleItemStatus.REMOVED },
      });
      await this.flashSales.refreshItemCount(flashSaleId);
    }
  }

  /**
   * Trạng thái TikTok ⇒ trạng thái hệ thống.
   *
   * Hết giờ mà TikTok vẫn báo `ONGOING` (sàn cập nhật trễ) thì tin ĐỒNG HỒ: `endAt` là con
   * số hệ thống đã gửi đi và người vận hành đang nhìn vào nó.
   */
  private mapProviderStatus(activity: TiktokActivityDetail, endAt: Date): PodFlashSaleStatus {
    const mapped = activity.status
      ? TIKTOK_TO_FLASH_SALE_STATUS[activity.status as keyof typeof TIKTOK_TO_FLASH_SALE_STATUS]
      : undefined;

    if (mapped === PodFlashSaleStatus.RUNNING && endAt.getTime() <= Date.now()) {
      return PodFlashSaleStatus.ENDED;
    }
    // Hoạt động bị TikTok khoá cứng (`IMMUTABLE`) mà không rõ trạng thái ⇒ coi như đã kết
    // thúc: không còn thao tác nào thực hiện được trên nó nữa.
    if (!mapped) {
      return activity.activityCommands?.includes(TIKTOK_ACTIVITY_COMMAND_IMMUTABLE)
        ? PodFlashSaleStatus.ENDED
        : PodFlashSaleStatus.RUNNING;
    }
    return mapped;
  }

  /** Bóc lỗi TikTok thành `{code, message, requestId}` — dùng chung cho mọi đường. */
  private describeFailure(error: unknown): ProviderFailure {
    if (error instanceof TiktokClientError) {
      return {
        code: String(error.tiktokCode),
        message: error.tiktokMessage,
        requestId: error.requestId ?? null,
      };
    }
    if (error instanceof PodFlashSaleShopContextException) {
      return { code: 'SHOP_CONTEXT', message: error.message, requestId: null };
    }
    if (error instanceof PodFlashSaleBatchTimeoutError) {
      return { code: 'REQUEST_TIMEOUT', message: error.message, requestId: null };
    }
    return {
      code: null,
      message: error instanceof Error ? error.message : 'Lỗi không xác định khi gọi TikTok',
      requestId: null,
    };
  }
}
