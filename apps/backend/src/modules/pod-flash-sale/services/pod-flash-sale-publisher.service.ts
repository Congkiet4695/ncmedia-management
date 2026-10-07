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
import {
  RETRYABLE_ERROR_CLASSES,
  TiktokErrorClass,
} from '../../pod-tiktok/constants/tiktok-error-code.constants';
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
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import { TiktokPromotionApiService } from '../../tiktok-sdk/tiktok-promotion-api.service';
import {
  TIKTOK_ACTIVITY_COMMAND_IMMUTABLE,
  TIKTOK_ACTIVITY_PRODUCT_LEVEL,
  TIKTOK_ACTIVITY_STATUS,
  TIKTOK_ACTIVITY_TYPE,
  TIKTOK_PRODUCT_STATUS,
} from '../../tiktok-sdk/tiktok-sdk.constants';
import type {
  TiktokActivityDetail,
  TiktokActivityProductInput,
} from '../../tiktok-sdk/types/tiktok-promotion.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  FLASH_SALE_BATCH_ISOLATION_ROUNDS,
  FLASH_SALE_BATCH_STATUS,
  FLASH_SALE_BATCH_TIMEOUT_MS,
  FLASH_SALE_BATCH_MAX_RETRIES,
  FLASH_SALE_BATCH_RETRY_BASE_MS,
  FLASH_SALE_BATCH_RETRY_MAX_MS,
  FLASH_SALE_CANCELLABLE_STATUSES,
  FLASH_SALE_ISSUE_CODES,
  FLASH_SALE_ITEM_ERROR_CODES,
  FLASH_SALE_LOG_MAX_FAILED_SKUS,
  FLASH_SALE_PUBLISHABLE_STATUSES,
  FLASH_SALE_PUBLISH_PARTIAL_CODE,
  FLASH_SALE_PUBLISH_LOCK_PREFIX,
  FLASH_SALE_PUBLISH_LOCK_RENEW_MS,
  FLASH_SALE_PUBLISH_LOCK_TTL_MS,
  FLASH_SALE_UNLIMITED,
  FLASH_SALE_VERIFY_CONCURRENCY,
  TIKTOK_TO_FLASH_SALE_STATUS,
} from '../constants/pod-flash-sale.constants';
import {
  batchStatusOf,
  initialBatchResults,
  skipUnfinishedBatches,
  summarizeBatchResults,
  type FlashSaleBatchResult,
} from './pod-flash-sale-batch-results';
import {
  chunkBySkuLimit,
  computeBatchRetryDelayMs,
  countActivitySkus,
} from './pod-flash-sale-batching';
import type { PodFlashSalePublishResultDto } from '../dto/pod-flash-sale-response.dto';
import {
  PodFlashSaleInvalidStateException,
  PodFlashSaleNotEditableOnProviderException,
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

/**
 * Kiểu một lượt gửi lô.
 *
 * - `PUBLISH` — đưa một đợt CHƯA lên sàn lên sàn. Hỏng ⇒ đợt về `FAILED` (Retry).
 * - `PUSH`    — gửi THÊM dòng mới vào một đợt ĐANG CHẠY trên sàn. Hỏng ⇒ đợt VẪN `RUNNING`
 *               (khuyến mãi trên TikTok vẫn đang chạy với các dòng cũ), lỗi ghi lên đợt và
 *               lên từng dòng hỏng; bấm gửi lại chỉ gửi phần còn thiếu.
 */
type PublishRunMode = 'PUBLISH' | 'PUSH';

/** Mọi thứ một lượt gửi lô chạy nền cần — gom lại để chữ ký hàm không dài mười tham số. */
interface PublishRunParams {
  mode: PublishRunMode;
  flashSale: FlashSaleDetailRow;
  /** Token của lượt. Mọi câu ghi tiến độ đều kèm điều kiện này. */
  runId: string;
  /** `activity_id` — MỘT giá trị duy nhất cho toàn bộ các lô của lượt. */
  activityId: string;
  batches: ActivityProductPlan[][];
  /** Kết quả từng lô — GIỮ TRONG BỘ NHỚ của lượt, ghi nguyên mảng sau mỗi lô (cùng điều kiện runId). */
  results: FlashSaleBatchResult[];
  /** Đợt đã có dòng trên sàn TRƯỚC lượt này (lượt chạy lại) — quyết định RUNNING hay FAILED khi kết thúc. */
  hadPublishedItems: boolean;
  /** Dòng bị loại ở pre-flight (đã đánh FAILED, không vào lô nào) — vẫn là "SKU lỗi" của lượt. */
  preflightFailed: number;
  userId: string | null;
  attempt: number;
}

/** Lỗi đã bóc tách thành ba mảnh mà mọi nơi trong module đều cần. */
export interface ProviderFailure {
  code: string | null;
  message: string;
  requestId: string | null;
}

/**
 * Lỗi khiến CẢ lượt phải dừng — khác lỗi của MỘT lô/SKU.
 *
 * Uỷ quyền shop hỏng, sai cấu hình, hoạt động khuyến mãi đã bị đóng: mọi lô phía sau chắc chắn hỏng
 * y hệt, gửi tiếp chỉ đốt quota. Lượt dừng, các lô chưa gửi thành `SKIPPED` kèm lý do (không `PENDING`).
 */
class PodFlashSaleRunAbortedError extends Error {
  constructor(readonly failure: ProviderFailure) {
    super(failure.message);
    this.name = 'PodFlashSaleRunAbortedError';
  }
}

/** Lớp lỗi TikTok áp cho CẢ shop/ứng dụng — không phải lỗi của một lô. */
const RUN_FATAL_ERROR_CLASSES: readonly TiktokErrorClass[] = [
  TiktokErrorClass.AUTH,
  TiktokErrorClass.TOKEN_EXPIRED,
  TiktokErrorClass.CONFIG,
  TiktokErrorClass.CLIENT_BUG,
];

/** Lỗi ghi lên MỘT dòng. */
interface ItemFailure {
  code: string;
  message: string;
}

/** Kết quả xử lý một lô ở phía TikTok — chưa ghi database. */
interface BatchOutcome {
  /** Phần TikTok đã nhận request (sau khi tách mục hỏng). Rỗng ⇒ lô không gửi được gì. */
  sentPlans: ActivityProductPlan[];
  result: ProviderBatchResult | null;
  /** Dòng của `sentPlans` mà Get Activity xác nhận KHÔNG có mặt. */
  rejected: Map<string, string>;
  /** Dòng bị tách ra trước khi gửi lại, hoặc cả lô khi không gửi được — kèm lý do. */
  failedItems: Map<string, ItemFailure>;
  /** Lỗi TikTok gần nhất của lô (nếu có) — hiển thị ở kết quả lô. */
  lastFailure: ProviderFailure | null;
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
    // Kiểm chứng sản phẩm/SKU của một lô bị TikTok từ chối (Get Product, đúng shop đang publish).
    private readonly productApi: TiktokProductApiService,
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
    const results = this.initialResults(batches);
    const hadPublishedItems = flashSale.items.some(
      (item) => item.status === PodFlashSaleItemStatus.PUBLISHED,
    );

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
        publishBatchResults: results as unknown as Prisma.InputJsonValue,
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

    // Dòng bị bỏ qua vì SKU/sản phẩm không gửi được (pre-flight) ⇒ FAILED kèm ĐÚNG lý do, để đếm được
    // và nhìn thấy được — không nằm im ở READY như thể "chưa tới lượt".
    const preflightFailed = await this.markInvalidItems(flashSale, validation.issues);

    const attempt = flashSale.retryCount;

    // Lượt gọi DUY NHẤT nằm trong request HTTP: tạo (hoặc cập nhật) hoạt động khuyến mãi.
    let activityId: string;
    try {
      const context = await this.resolveContext(organizationId, flashSale.shopId);
      activityId = await this.ensureActivity(context, flashSale, userId, attempt);
    } catch (error) {
      const failure = this.describeFailure(error);
      await this.failPublishRun(flashSale, runId, failure, userId, null, 'PUBLISH', results);
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
    const runParams: PublishRunParams = {
      mode: 'PUBLISH',
      flashSale,
      runId,
      activityId,
      batches,
      results,
      hadPublishedItems,
      preflightFailed,
      userId,
      attempt,
    };
    if (batches.length === 0) {
      await this.finishPublishRun(runParams, null);
    } else {
      this.launchPublishRun(runParams);
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
  // Gửi THÊM sản phẩm vào đợt ĐANG CHẠY
  // ---------------------------------------------------------------------------

  /**
   * Gửi các dòng CHƯA lên sàn của một đợt ĐANG CHẠY vào CÙNG hoạt động trên TikTok.
   *
   * ```
   *   đợt RUNNING (A1 A2 B1 đã PUBLISHED) + người dùng thêm C1 C2 (READY)
   *        ▼
   *   Get Activity — còn sửa được không?  (DEACTIVATED/EXPIRED/IMMUTABLE ⇒ chặn, nói rõ)
   *        ▼
   *   GIÀNH lượt: RUNNING ─▶ PUBLISHING (nguyên tử)
   *        ▼
   *   Update Activity Products với ĐÚNG C1 C2  ─▶ RUNNING
   * ```
   *
   * 🔴 **Incremental, không gửi lại toàn bộ.** Tài liệu Update Activity Products: `products` là
   * "the items to ADD to the list or the existing items … to edit" ⇒ gửi riêng phần mới là đủ;
   * dòng đã `PUBLISHED` không bị gửi lại, không bị gỡ, không bị ghi đè giá.
   *
   * 🔴 **Không tạo hoạt động mới, không gọi Update Activity** (tên/khung giờ của một hoạt động
   * đang chạy không phải thứ người dùng yêu cầu đổi ở đây).
   *
   * 🔴 Hỏng giữa chừng ⇒ đợt VẪN `RUNNING` (khuyến mãi vẫn chạy với dòng cũ); dòng hỏng mang lỗi
   * TikTok; gọi lại chỉ gửi phần còn thiếu — cùng cơ chế "tiếp tục theo trạng thái dòng" của publish.
   */
  async pushPendingItems(
    organizationId: string,
    userId: string | null,
    flashSaleId: string,
    scope: PodAccessScope,
  ): Promise<PodFlashSalePublishResultDto> {
    const flashSale = await this.flashSales.get(organizationId, flashSaleId, scope);
    if (flashSale.status !== PodFlashSaleStatus.RUNNING || !flashSale.providerFlashSaleId) {
      throw new PodFlashSaleInvalidStateException('gửi thêm sản phẩm lên TikTok', flashSale.status);
    }
    if (flashSale.endAt.getTime() <= Date.now()) {
      throw new PodFlashSaleInvalidStateException('gửi thêm sản phẩm lên TikTok', PodFlashSaleStatus.ENDED);
    }
    const activityId = flashSale.providerFlashSaleId;

    // Dòng CHƯA lên sàn và hợp lệ. Tính hai lần: trước khi hỏi TikTok (thoát sớm, không tốn một
    // lời gọi) và SAU khi giành lượt (xem chú thích ở bước giành lượt).
    const collectPending = (row: FlashSaleDetailRow) => {
      const ready = new Set(this.flashSales.validateItemsOnly(row).readyItemIds);
      const notOnProvider = row.items.filter(
        (item) =>
          item.status !== PodFlashSaleItemStatus.PUBLISHED &&
          item.status !== PodFlashSaleItemStatus.REMOVED,
      );
      const pending = notOnProvider.filter((item) => ready.has(item.id));
      return { pending, skipped: notOnProvider.length - pending.length };
    };
    let { pending, skipped: skippedItems } = collectPending(flashSale);

    const noop = (): PodFlashSalePublishResultDto => ({
      flashSaleId,
      status: PodFlashSaleStatus.RUNNING,
      providerFlashSaleId: activityId,
      publishedItems: 0,
      skippedItems,
      errorCode: null,
      errorMessage: null,
      totalItems: 0,
      totalBatches: 0,
      doneBatches: 0,
    });
    if (pending.length === 0) return noop();

    // Hỏi TikTok TRƯỚC khi giành lượt: hoạt động hết hạn/bị huỷ/bị khoá thì không có gì để gửi.
    const context = await this.resolveContext(organizationId, flashSale.shopId);
    let activity: TiktokActivityDetail;
    try {
      activity = (await this.withRequestTimeout(this.promotionApi.getActivity(context, activityId)))
        .data;
    } catch (error) {
      const failure = this.describeFailure(error);
      throw new PodFlashSaleProviderException(failure.code, failure.message, failure.requestId ?? undefined);
    }
    const immutable = Boolean(activity.activityCommands?.includes(TIKTOK_ACTIVITY_COMMAND_IMMUTABLE));
    const closed = [
      TIKTOK_ACTIVITY_STATUS.DEACTIVATED,
      TIKTOK_ACTIVITY_STATUS.EXPIRED,
      TIKTOK_ACTIVITY_STATUS.NOT_EFFECTIVE,
    ].includes(activity.status as never);
    if (immutable || closed) {
      await this.flashSales.writeLog({
        organizationId,
        flashSaleId,
        action: PodFlashSaleLogAction.UPDATE_PRODUCTS,
        level: PodFlashSaleLogLevel.ERROR,
        message: `Không gửi thêm sản phẩm: hoạt động TikTok ${activity.status ?? 'không rõ'}${immutable ? ' (IMMUTABLE)' : ''}.`,
        response: activity as unknown as Prisma.InputJsonValue,
        userId,
      });
      throw new PodFlashSaleNotEditableOnProviderException(activity.status ?? null, immutable);
    }

    const runId = randomUUID();
    const startedAt = new Date();
    // Cùng phép so-sánh-và-đổi nguyên tử như publish: hai lượt bấm cùng lúc ⇒ đúng một lượt chạy.
    const claim = await this.prisma.podFlashSale.updateMany({
      where: { id: flashSaleId, deletedAt: null, status: PodFlashSaleStatus.RUNNING },
      data: {
        status: PodFlashSaleStatus.PUBLISHING,
        publishRunId: runId,
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
      throw new PodFlashSaleInvalidStateException('gửi thêm sản phẩm lên TikTok', PodFlashSaleStatus.PUBLISHING);
    }

    // 🔴 Tính lại danh sách cần gửi SAU khi đã giữ lượt. Danh sách đọc lúc đầu có thể đã cũ: một
    // lượt gửi khác có thể đã chạy XONG giữa lúc đọc và lúc giành lượt (bấm hai lần liên tiếp)
    // ⇒ gửi theo danh sách cũ là gửi lại những dòng vừa lên sàn.
    const fresh = await this.flashSales.get(organizationId, flashSaleId, scope);
    ({ pending, skipped: skippedItems } = collectPending(fresh));
    if (pending.length === 0) {
      await this.prisma.podFlashSale.updateMany({
        where: { id: flashSaleId, publishRunId: runId },
        data: {
          status: PodFlashSaleStatus.RUNNING,
          publishTotalItems: 0,
          publishTotalBatches: 0,
          publishBatchResults: [],
          publishFinishedAt: new Date(),
        },
      });
      return noop();
    }
    const preflightFailed = await this.markInvalidItems(fresh, this.flashSales.validateItemsOnly(fresh).issues);
    const plans = this.buildProductPlans(fresh.productLevel, pending);
    const batches = chunkBySkuLimit(plans, (plan) => countActivitySkus(plan.input));
    const results = this.initialResults(batches);
    await this.prisma.podFlashSale.updateMany({
      where: { id: flashSaleId, publishRunId: runId },
      data: {
        publishTotalItems: pending.length,
        publishTotalBatches: batches.length,
        publishBatchResults: results as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.update.start',
      organizationId,
      flashSaleId,
      runId,
      activityId,
      totalItems: pending.length,
      totalBatches: batches.length,
      skipped: skippedItems,
      msg: `FLASH_SALE_UPDATE_STARTED: gửi thêm ${pending.length} dòng (${batches.length} lô) vào hoạt động ${activityId}`,
    });

    this.launchPublishRun({
      mode: 'PUSH',
      flashSale: fresh,
      runId,
      activityId,
      batches,
      results,
      hadPublishedItems: true,
      preflightFailed,
      userId,
      attempt: flashSale.retryCount,
    });

    return {
      flashSaleId,
      status: PodFlashSaleStatus.PUBLISHING,
      providerFlashSaleId: activityId,
      publishedItems: 0,
      skippedItems,
      errorCode: null,
      errorMessage: null,
      totalItems: pending.length,
      totalBatches: batches.length,
      doneBatches: 0,
    };
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
      await this.failPublishRun(
        flashSale,
        runId,
        this.describeFailure(error),
        params.userId,
        null,
        params.mode,
        params.results,
      );
    } finally {
      clearInterval(watchdog);
      await this.locks.release(lock);
    }
  }

  /**
   * Vòng gửi lô — tách khỏi phần khoá để đọc được mạch nghiệp vụ mà không lẫn hạ tầng.
   *
   * 🔴 **Một lô hỏng KHÔNG chặn các lô sau.** Mỗi lô có vòng đời riêng
   * `PENDING → PROCESSING → SUCCEEDED | PARTIAL | FAILED`, có try/catch riêng; lỗi của lô (SKU sai,
   * sản phẩm không còn bán, TikTok từ chối nghiệp vụ, hết lượt thử lại lỗi tạm thời) được ghi lên ĐÚNG
   * các dòng của lô đó rồi đi tiếp lô sau. Trước đây lô 1 hỏng là dừng cả lượt và 12 lô còn lại nằm
   * im — một SKU của sản phẩm đã bị xoá làm 3.000 SKU khác không lên sale.
   *
   * Chỉ lỗi áp cho CẢ lượt (`PodFlashSaleRunAbortedError`: uỷ quyền shop, hoạt động đã bị đóng) mới
   * dừng sớm — và khi đó mọi lô chưa gửi thành `SKIPPED` kèm lý do, không còn lô `PENDING`.
   *
   * 🔴 Không transaction nào bao lời gọi TikTok: mỗi lô gọi TikTok xong mới mở MỘT transaction ngắn
   * để ghi kết quả (`persistBatchOutcome`).
   */
  private async sendBatches(params: PublishRunParams, lock: AcquiredLock): Promise<void> {
    const { flashSale, runId, activityId, batches, results } = params;
    const context = await this.resolveContext(flashSale.organizationId, flashSale.shopId);
    let abort: ProviderFailure | null = null;

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const batchNo = index + 1;
      results[index] = {
        ...results[index],
        status: FLASH_SALE_BATCH_STATUS.PROCESSING,
        startedAt: new Date().toISOString(),
      };

      // Lượt mới hơn đã bắt đầu (người dùng bấm Retry) ⇒ lượt này rút lui, không ghi đè.
      if (!(await this.markBatchStarted(flashSale.id, runId, batchNo, results))) {
        this.logger.warn({
          module: 'pod-flash-sale',
          flashSaleId: flashSale.id,
          runId,
          msg: 'Lượt publish đã bị thay bằng lượt mới — dừng lượt cũ',
        });
        return;
      }

      this.logger.log({
        module: 'pod-flash-sale',
        operation: 'flashSale.publish.batch',
        flashSaleId: flashSale.id,
        shopId: flashSale.shopId,
        runId,
        activityId,
        batchIndex: batchNo,
        totalBatches: batches.length,
        batchSize: results[index].products,
        skuCount: results[index].skus,
        msg: `[FLASH_SALE] Lô ${batchNo}/${batches.length} bắt đầu`,
      });

      let outcome: BatchOutcome;
      try {
        outcome = await this.processBatch(params, context, batch, batchNo, lock);
      } catch (error) {
        if (!(error instanceof PodFlashSaleRunAbortedError)) throw error;
        // Lỗi của CẢ lượt: lô này coi như hỏng với đúng lỗi đó, các lô sau SKIPPED (ở `finishPublishRun`).
        abort = error.failure;
        const message = this.failureText(abort);
        outcome = {
          sentPlans: [],
          result: null,
          rejected: new Map(),
          failedItems: new Map(
            batch
              .flatMap((plan) => plan.itemIds)
              .map((itemId) => [itemId, { code: FLASH_SALE_ITEM_ERROR_CODES.BATCH_REJECTED, message }]),
          ),
          lastFailure: abort,
        };
      }

      await this.persistBatchOutcome(params, batch, batchNo, outcome);
      if (abort) break;
    }

    await this.finishPublishRun(params, abort);
  }

  /**
   * Xử lý MỘT lô ở phía TikTok. Không ném lỗi cho lỗi của lô — chỉ ném `PodFlashSaleRunAbortedError`
   * (lỗi của cả lượt). Lỗi lạ (bug, mất database) văng ra để `runPublishBatches` đóng lượt.
   *
   * ```
   *   gửi lô ──▶ OK ──▶ kiểm total_count (Get Activity nếu thiếu) ──▶ xong
   *     │
   *     └─ lỗi ── lớp AUTH / CONFIG / CLIENT_BUG ─────────────────▶ dừng CẢ lượt
   *            ── NETWORK / RATE_LIMIT / SERVER (đã hết lượt thử) ──▶ lô FAILED, đi tiếp
   *            ── lỗi nghiệp vụ (vd 17029016 "No SKU in the product matches")
   *                 ▼
   *               Get Product từng sản phẩm của lô (đúng shop): sản phẩm không ACTIVATE / SKU không
   *               còn trên sản phẩm / không tìm thấy ⇒ TÁCH các dòng đó ra (FAILED, ghi lý do) rồi gửi
   *               lại phần còn lại. Không tách được gì ⇒ kiểm hoạt động (đóng ⇒ dừng lượt), lô FAILED.
   * ```
   *
   * 🔴 Không "nuốt" lỗi: mỗi lần TikTok từ chối đều được ghi log (payload đã gửi, mã lỗi, request_id),
   * và mỗi dòng hỏng mang ĐÚNG lý do của nó.
   */
  private async processBatch(
    params: PublishRunParams,
    context: TiktokShopContext,
    batch: ActivityProductPlan[],
    batchNo: number,
    lock: AcquiredLock,
  ): Promise<BatchOutcome> {
    const { flashSale, activityId } = params;
    const failedItems = new Map<string, ItemFailure>();
    let plans = batch;
    let lastFailure: ProviderFailure | null = null;

    for (let round = 0; plans.length > 0; round += 1) {
      try {
        const result = await this.sendBatchWithRetry(context, activityId, plans, lock);
        // 🔴 Lượt gọi thành công KHÔNG có nghĩa mọi dòng đã vào hoạt động: response chỉ có
        // `total_count`. Ít hơn số đã gửi ⇒ hỏi Get Activity xem dòng nào thực sự có mặt.
        const rejected = await this.verifyBatchAcceptance(context, flashSale, activityId, plans, result);
        return { sentPlans: plans, result, rejected, failedItems, lastFailure };
      } catch (error) {
        if (this.isRunFatal(error)) throw new PodFlashSaleRunAbortedError(this.describeFailure(error));
        const failure = this.describeFailure(error);
        lastFailure = failure;
        await this.logRejectedAttempt(params, batchNo, round, plans, failure);

        // Lỗi tạm thời đã hết lượt thử, hoặc đã hết số vòng tách ⇒ không đoán thêm: cả phần còn lại FAILED.
        const exhaustedTransient = this.isTransient(error);
        const invalid =
          exhaustedTransient || round >= FLASH_SALE_BATCH_ISOLATION_ROUNDS
            ? new Map<string, ItemFailure>()
            : await this.findUnpublishableItems(context, plans, failure);

        if (invalid.size === 0) {
          if (!exhaustedTransient) await this.assertActivityWritable(context, activityId, failure);
          const message = this.failureText(failure);
          for (const itemId of plans.flatMap((plan) => plan.itemIds)) {
            failedItems.set(itemId, { code: FLASH_SALE_ITEM_ERROR_CODES.BATCH_REJECTED, message });
          }
          return { sentPlans: [], result: null, rejected: new Map(), failedItems, lastFailure };
        }

        for (const [itemId, itemFailure] of invalid) failedItems.set(itemId, itemFailure);
        plans = this.withoutItems(plans, new Set(invalid.keys()));
        this.logger.warn({
          module: 'pod-flash-sale',
          operation: 'flashSale.publish.batch.isolate',
          flashSaleId: flashSale.id,
          shopId: flashSale.shopId,
          activityId,
          batchIndex: batchNo,
          round: round + 1,
          failedCount: invalid.size,
          remaining: plans.reduce((sum, plan) => sum + plan.itemIds.length, 0),
          errorCode: failure.code,
          msg: `[FLASH_SALE] Lô ${batchNo}: tách ${invalid.size} dòng không gửi được, gửi lại phần còn lại`,
        });
      }
    }
    // Mọi dòng của lô đều bị tách ra — không còn gì để gửi.
    return { sentPlans: [], result: null, rejected: new Map(), failedItems, lastFailure };
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
    publishedAt: Date | null;
  }): Promise<boolean> {
    // 🔴 Đợt ĐÃ từng lên sàn (`publishedAt`) mà kẹt ở PUBLISHING nghĩa là lượt GỬI THÊM dòng mới
    // bị đứt. Hoạt động trên TikTok vẫn đang chạy ⇒ trả về RUNNING rồi gửi nốt phần còn thiếu —
    // KHÔNG đưa về FAILED (đợt đang chạy không phải "publish hỏng") và KHÔNG gọi Update Activity.
    if (flashSale.publishedAt) {
      const releasedRunning = await this.prisma.podFlashSale.updateMany({
        where: {
          id: flashSale.id,
          status: PodFlashSaleStatus.PUBLISHING,
          publishRunId: flashSale.publishRunId,
        },
        data: { status: PodFlashSaleStatus.RUNNING, publishFinishedAt: new Date() },
      });
      if (releasedRunning.count === 0) return false;
      await this.pushPendingItems(flashSale.organizationId, null, flashSale.id, POD_SCOPE_SYSTEM);
      return true;
    }

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

      // 🔴 Đang có lượt gửi lô (PUBLISHING): KHÔNG đổi trạng thái và KHÔNG đối soát dòng. Lượt
      // gửi đang dở nên "chưa có trên TikTok" là chuyện bình thường của các lô sau — trước đây
      // lượt đồng bộ 5 phút/lần đánh dấu chúng REMOVED giữa chừng, và Retry/Duplicate bỏ luôn.
      if (flashSale.status === PodFlashSaleStatus.PUBLISHING) {
        await this.prisma.podFlashSale.update({
          where: { id: flashSale.id },
          data: { providerStatus: result.data.status ?? null, lastSyncedAt: new Date() },
        });
        return flashSale.status;
      }

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

      await this.reconcileItemsWithActivity(flashSale.id, result.data);

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

  /** Ngữ cảnh gọi TikTok của một shop — lỗi ngữ cảnh đổi thành lỗi của module. Dùng chung với lượt đồng bộ. */
  async resolveContext(organizationId: string, shopId: string): Promise<TiktokShopContext> {
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
    results: FlashSaleBatchResult[],
  ): Promise<boolean> {
    const result = await this.prisma.podFlashSale.updateMany({
      where: { id: flashSaleId, publishRunId: runId },
      data: {
        publishCurrentBatch: batchNo,
        publishHeartbeatAt: new Date(),
        publishBatchResults: results as unknown as Prisma.InputJsonValue,
      },
    });
    return result.count > 0;
  }

  /**
   * Ghi kết quả MỘT lô trong MỘT transaction ngắn (không có lời gọi TikTok nào bên trong):
   *  - dòng TikTok nhận ⇒ `PUBLISHED`;
   *  - dòng TikTok không nhận (Get Activity vắng) ⇒ `FAILED` `NOT_ACCEPTED_BY_TIKTOK`;
   *  - dòng bị tách / cả lô không gửi được ⇒ `FAILED` kèm ĐÚNG lý do;
   *  - kết quả lô (SUCCEEDED / PARTIAL / FAILED) + số lô đã xử lý.
   *
   * 🔴 Ghi NGAY sau từng lô chứ không đợi hết lượt: lượt chết ở lô 33/34 vẫn để lại vết của 32 lô
   * trước, và lần chạy lại chỉ gửi phần chưa `PUBLISHED`.
   */
  private async persistBatchOutcome(
    params: PublishRunParams,
    batch: ActivityProductPlan[],
    batchNo: number,
    outcome: BatchOutcome,
  ): Promise<void> {
    const { flashSale, runId, activityId, results, userId, attempt } = params;
    const sentIds = outcome.sentPlans.flatMap((plan) => plan.itemIds);
    const acceptedIds = sentIds.filter((id) => !outcome.rejected.has(id));
    const failures = new Map<string, ItemFailure>(outcome.failedItems);
    for (const [itemId, message] of outcome.rejected) {
      failures.set(itemId, { code: FLASH_SALE_ITEM_ERROR_CODES.NOT_ACCEPTED, message });
    }

    const index = batchNo - 1;
    const notAccepted = outcome.rejected.size;
    results[index] = {
      ...results[index],
      status: batchStatusOf(acceptedIds.length, failures.size),
      succeeded: acceptedIds.length,
      failed: failures.size,
      errorCode:
        outcome.lastFailure?.code ??
        (notAccepted > 0 ? FLASH_SALE_ITEM_ERROR_CODES.NOT_ACCEPTED : null),
      errorMessage:
        outcome.lastFailure?.message.slice(0, 2000) ??
        (notAccepted > 0 ? `TikTok không nhận ${notAccepted} SKU của lô.` : null),
      requestId: outcome.result?.requestId ?? outcome.lastFailure?.requestId ?? null,
      finishedAt: new Date().toISOString(),
    };

    await this.prisma.$transaction(async (tx) => {
      if (acceptedIds.length > 0) {
        await tx.podFlashSaleItem.updateMany({
          where: { id: { in: acceptedIds } },
          data: {
            status: PodFlashSaleItemStatus.PUBLISHED,
            errorCode: null,
            error: null,
            publishBatch: batchNo,
          },
        });
      }
      // Gộp theo (mã, thông điệp): thông điệp gắn theo SẢN PHẨM nên số câu lệnh ~ số sản phẩm hỏng,
      // không phải số SKU. Dòng đã PUBLISHED (lượt khác vừa nhận) không bị hạ xuống FAILED.
      for (const [key, itemIds] of this.groupFailures(failures)) {
        const { code, message } = JSON.parse(key) as ItemFailure;
        await tx.podFlashSaleItem.updateMany({
          where: { id: { in: itemIds }, status: { not: PodFlashSaleItemStatus.PUBLISHED } },
          data: {
            status: PodFlashSaleItemStatus.FAILED,
            errorCode: code.slice(0, 32),
            error: message.slice(0, 2000),
            publishBatch: batchNo,
          },
        });
      }
      await tx.podFlashSale.updateMany({
        where: { id: flashSale.id, publishRunId: runId },
        data: {
          publishDoneBatches: batchNo,
          publishHeartbeatAt: new Date(),
          publishBatchResults: results as unknown as Prisma.InputJsonValue,
        },
      });
    });

    const level =
      failures.size === 0
        ? PodFlashSaleLogLevel.INFO
        : acceptedIds.length > 0
          ? PodFlashSaleLogLevel.WARN
          : PodFlashSaleLogLevel.ERROR;
    await this.flashSales.writeLog({
      organizationId: flashSale.organizationId,
      flashSaleId: flashSale.id,
      action: PodFlashSaleLogAction.UPDATE_PRODUCTS,
      level,
      message:
        `Lô ${batchNo}/${params.batches.length} (${results[index].status}): ${batch.length} sản phẩm, ` +
        `${results[index].skus} dòng; TikTok nhận ${acceptedIds.length}` +
        `${failures.size > 0 ? `, lỗi ${failures.size}` : ''}.`,
      request: {
        activityId,
        batch: batchNo,
        products: outcome.sentPlans.map((plan) => plan.input),
      } as unknown as Prisma.InputJsonValue,
      response: {
        provider: (outcome.result?.data ?? null) as unknown as Prisma.InputJsonValue,
        failedItems: this.describeFailedSkus(batch, failures),
      },
      errorCode: results[index].errorCode,
      errorMessage: results[index].errorMessage,
      requestId: results[index].requestId,
      attempt,
      userId,
    });

    const log = {
      module: 'pod-flash-sale',
      operation: 'flashSale.publish.batch',
      flashSaleId: flashSale.id,
      shopId: flashSale.shopId,
      runId,
      activityId,
      batchIndex: batchNo,
      batchSize: batch.length,
      skuCount: results[index].skus,
      successCount: acceptedIds.length,
      failedCount: failures.size,
      errorCode: results[index].errorCode,
      errorMessage: results[index].errorMessage,
      failedSkus: this.describeFailedSkus(batch, failures).slice(0, FLASH_SALE_LOG_MAX_FAILED_SKUS),
      msg: `[FLASH_SALE] Lô ${batchNo}/${params.batches.length} ${results[index].status}`,
    };
    if (failures.size > 0) this.logger.warn(log);
    else this.logger.log(log);
  }

  /**
   * Lượt đã chạy HẾT các lô (hoặc dừng sớm vì lỗi của cả lượt) ⇒ chốt trạng thái đợt từ kết quả lô.
   *
   * ```
   *   có dòng trên sàn (lượt này hoặc trước đó) ⇒ RUNNING — hoạt động ĐANG chạy trên TikTok
   *        còn SKU lỗi / lô SKIPPED            ⇒ kèm lastErrorCode = PUBLISH_PARTIAL + tóm tắt
   *   không dòng nào lên sàn                    ⇒ FAILED (Retry, cùng activity_id)
   *   lượt PUSH                                 ⇒ luôn RUNNING (khuyến mãi cũ vẫn bán)
   * ```
   *
   * 🔴 Không có trạng thái "thành công" khi còn lô hỏng: `lastErrorCode` + kết quả lô (`publish-status`)
   * nói rõ bao nhiêu SKU lỗi ở lô nào. Không thêm giá trị enum mới — `RUNNING` vẫn đúng nghĩa "đang
   * chạy trên sàn", và Retry phần lỗi đi đường "gửi thêm" có sẵn (`pushPendingItems`).
   */
  private async finishPublishRun(params: PublishRunParams, abort: ProviderFailure | null): Promise<void> {
    const { flashSale, runId, activityId, userId, mode } = params;
    const now = new Date();
    const results = abort
      ? skipUnfinishedBatches(
          params.results,
          { code: abort.code, message: `Không gửi vì lượt phải dừng: ${abort.message}` },
          now,
        )
      : params.results;
    params.results.splice(0, params.results.length, ...results);
    const summary = summarizeBatchResults(results);
    const onProvider = params.hadPublishedItems || summary.succeeded > 0;
    const status =
      mode === 'PUSH' || onProvider ? PodFlashSaleStatus.RUNNING : PodFlashSaleStatus.FAILED;
    const hasProblems = summary.failed > 0 || summary.skipped > 0 || params.preflightFailed > 0;
    const lastProblem = [...results].reverse().find((result) => result.errorCode !== null) ?? null;

    const error = !hasProblems
      ? { lastErrorCode: null, lastErrorMessage: null, lastErrorRequestId: null }
      : {
          lastErrorCode:
            status === PodFlashSaleStatus.RUNNING
              ? FLASH_SALE_PUBLISH_PARTIAL_CODE
              : (abort?.code ?? lastProblem?.errorCode ?? null),
          lastErrorMessage: (
            `${summary.succeeded} SKU lên sàn, ${summary.failed + params.preflightFailed} SKU lỗi` +
            `${params.preflightFailed > 0 ? ` (${params.preflightFailed} bị loại trước khi gửi: sản phẩm/SKU không hợp lệ)` : ''}` +
            `${summary.skipped > 0 ? `, ${summary.skipped} SKU chưa gửi` : ''} ` +
            `(${summary.failedBatches} lô lỗi, ${summary.partialBatches} lô một phần` +
            `${summary.skippedBatches > 0 ? `, ${summary.skippedBatches} lô bỏ qua` : ''}).` +
            `${(abort ?? lastProblem) ? ` Lỗi gần nhất: ${abort ? this.failureText(abort) : `[${lastProblem?.errorCode}] ${lastProblem?.errorMessage ?? ''}`}` : ''}`
          ).slice(0, 2000),
          lastErrorRequestId: abort?.requestId ?? lastProblem?.requestId ?? null,
        };

    const updated = await this.prisma.podFlashSale.updateMany({
      where: { id: flashSale.id, publishRunId: runId },
      data: {
        status,
        providerFlashSaleId: activityId,
        // Mốc lên sàn: lượt PUBLISH có dòng được nhận lần đầu. Lượt PUSH không đổi mốc.
        ...(mode === 'PUBLISH' && summary.succeeded > 0 && !params.hadPublishedItems ? { publishedAt: now } : {}),
        lastSyncedAt: now,
        publishFinishedAt: now,
        publishHeartbeatAt: now,
        publishCurrentBatch: null,
        publishFailedBatch: summary.firstProblemBatch,
        publishBatchResults: results as unknown as Prisma.InputJsonValue,
        ...error,
        ...(userId ? { updatedBy: userId } : {}),
      },
    });
    if (updated.count === 0) return;

    if (hasProblems) {
      await this.flashSales.writeLog({
        organizationId: flashSale.organizationId,
        flashSaleId: flashSale.id,
        action: PodFlashSaleLogAction.UPDATE_PRODUCTS,
        level: status === PodFlashSaleStatus.FAILED ? PodFlashSaleLogLevel.ERROR : PodFlashSaleLogLevel.WARN,
        message: `Lượt ${mode === 'PUSH' ? 'gửi thêm' : 'publish'} kết thúc (${status}): ${error.lastErrorMessage ?? ''}`,
        response: { batches: results } as unknown as Prisma.InputJsonValue,
        errorCode: error.lastErrorCode,
        errorMessage: error.lastErrorMessage,
        requestId: error.lastErrorRequestId,
        attempt: flashSale.retryCount,
        userId,
      });
    }

    this.logger.log({
      module: 'pod-flash-sale',
      operation: 'flashSale.publish.done',
      flashSaleId: flashSale.id,
      shopId: flashSale.shopId,
      runId,
      activityId,
      status,
      totalBatches: summary.totalBatches,
      succeededBatches: summary.succeededBatches,
      partialBatches: summary.partialBatches,
      failedBatches: summary.failedBatches,
      skippedBatches: summary.skippedBatches,
      successCount: summary.succeeded,
      failedCount: summary.failed,
      skippedCount: summary.skipped,
      msg: `[FLASH_SALE] Lượt kết thúc: ${summary.processedBatches}/${summary.totalBatches} lô đã xử lý`,
    });
  }

  /**
   * Lượt hỏng TRƯỚC khi gửi được lô nào (tạo hoạt động thất bại) hoặc dừng bất thường (bug, mất
   * database): đợt về `FAILED` (lượt PUSH: vẫn `RUNNING`), giữ nguyên MỌI dữ liệu.
   *
   * 🔴 Mọi lô chưa có kết quả ⇒ `SKIPPED` kèm lý do — không để `PENDING` treo sau khi lượt đã kết thúc.
   */
  private async failPublishRun(
    flashSale: FlashSaleDetailRow,
    runId: string,
    failure: ProviderFailure,
    userId: string | null,
    batchNo: number | null,
    mode: PublishRunMode,
    results: FlashSaleBatchResult[] = [],
  ): Promise<void> {
    const now = new Date();
    const skipped = skipUnfinishedBatches(
      results,
      { code: failure.code, message: `Không gửi vì lượt dừng: ${failure.message}` },
      now,
    );
    const summary = summarizeBatchResults(skipped);
    const onProvider =
      mode === 'PUSH' ||
      summary.succeeded > 0 ||
      flashSale.items.some((item) => item.status === PodFlashSaleItemStatus.PUBLISHED);
    const changed = await this.prisma.podFlashSale.updateMany({
      where: { id: flashSale.id, publishRunId: runId },
      data: {
        // 🔴 Đã có dòng trên sàn (lượt PUSH, hoặc lô trước đã được nhận): hoạt động VẪN chạy ⇒ RUNNING.
        status: onProvider ? PodFlashSaleStatus.RUNNING : PodFlashSaleStatus.FAILED,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message.slice(0, 2000),
        lastErrorRequestId: failure.requestId,
        publishFailedBatch: batchNo ?? summary.firstProblemBatch,
        publishCurrentBatch: null,
        publishFinishedAt: now,
        publishHeartbeatAt: now,
        ...(results.length > 0 ? { publishBatchResults: skipped as unknown as Prisma.InputJsonValue } : {}),
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
        mode === 'PUSH'
          ? `Gửi thêm sản phẩm vào Flash Sale đang chạy thất bại${batchNo === null ? '' : ` ở lô ${batchNo}`}.`
          : batchNo === null
            ? 'Publish Flash Sale thất bại.'
            : `Publish Flash Sale thất bại ở lô ${batchNo}.`,
      errorCode: failure.code,
      errorMessage: failure.message,
      requestId: failure.requestId,
      attempt: flashSale.retryCount,
      userId,
    });
  }

  /**
   * Lượt gọi thành công mà `total_count` < số mục đã gửi ⇒ TikTok không nhận hết. Hỏi Get
   * Activity để biết CHÍNH XÁC dòng nào không có mặt.
   *
   * 🔴 Trước đây mọi dòng của lô thành công đều được đánh dấu `PUBLISHED` — kể cả dòng TikTok bỏ
   * qua — nên danh sách báo "thành công" trong khi hoạt động trên sàn thiếu sản phẩm.
   *
   * Không đọc được Get Activity ⇒ KHÔNG đoán: coi như đã nhận (giữ hành vi cũ), ghi cảnh báo; lượt
   * đồng bộ định kỳ sẽ đối soát lại (`reconcileItemsWithActivity`).
   *
   * @returns id dòng bị từ chối ⇒ thông điệp lỗi của dòng đó.
   */
  private async verifyBatchAcceptance(
    context: TiktokShopContext,
    flashSale: FlashSaleDetailRow,
    activityId: string,
    batch: ActivityProductPlan[],
    result: ProviderBatchResult,
  ): Promise<Map<string, string>> {
    const rejected = new Map<string, string>();
    const isProductLevel = flashSale.productLevel === PodFlashSaleProductLevel.PRODUCT;
    const expected = isProductLevel
      ? batch.length
      : batch.reduce((sum, plan) => sum + plan.input.skus.length, 0);
    const reported = result.data.totalCount;
    if (typeof reported !== 'number' || reported >= expected) return rejected;

    let activity: TiktokActivityDetail;
    try {
      activity = (await this.withRequestTimeout(this.promotionApi.getActivity(context, activityId)))
        .data;
    } catch (error) {
      this.logger.warn({
        module: 'pod-flash-sale',
        operation: 'flashSale.publish.verify',
        flashSaleId: flashSale.id,
        activityId,
        expected,
        reported,
        msg: `TikTok báo nhận ${reported}/${expected} mục nhưng không đọc lại được hoạt động: ${this.describeFailure(error).message}`,
      });
      return rejected;
    }

    const presentProducts = new Set<string>();
    const presentSkus = new Set<string>();
    for (const product of activity.products ?? []) {
      if (product.id) presentProducts.add(product.id);
      for (const sku of product.skus ?? []) if (sku.id) presentSkus.add(sku.id);
    }
    const message =
      `TikTok chỉ nhận ${reported}/${expected} mục của lô; SKU/sản phẩm này không có trong hoạt ` +
      'động sau khi cập nhật (TikTok không trả lý do theo từng mục).';

    for (const plan of batch) {
      if (isProductLevel) {
        if (!presentProducts.has(plan.input.id)) plan.itemIds.forEach((id) => rejected.set(id, message));
        continue;
      }
      for (const [skuId, itemId] of plan.itemByVariantId) {
        if (!presentSkus.has(skuId)) rejected.set(itemId, message);
      }
    }
    return rejected;
  }

  /** Kết quả lô ban đầu (mọi lô PENDING) — `skus` là số DÒNG của lô. */
  private initialResults(batches: ActivityProductPlan[][]): FlashSaleBatchResult[] {
    return initialBatchResults(
      batches.map((batch) => ({
        products: batch.length,
        skus: batch.reduce((sum, plan) => sum + plan.itemIds.length, 0),
      })),
    );
  }

  /** Lỗi áp cho CẢ lượt: uỷ quyền / cấu hình / lỗi lập trình / ngữ cảnh shop. */
  private isRunFatal(error: unknown): boolean {
    if (error instanceof PodFlashSaleShopContextException) return true;
    return error instanceof TiktokClientError && RUN_FATAL_ERROR_CLASSES.includes(error.errorClass);
  }

  /** Lỗi tạm thời (đã đi hết lượt thử lại trong `sendBatchWithRetry`). */
  private isTransient(error: unknown): boolean {
    return (
      error instanceof PodFlashSaleBatchTimeoutError ||
      (error instanceof TiktokClientError && RETRYABLE_ERROR_CLASSES.includes(error.errorClass))
    );
  }

  private failureText(failure: ProviderFailure): string {
    return failure.code ? `[${failure.code}] ${failure.message}` : failure.message;
  }

  /** Mỗi lần TikTok từ chối một lô ⇒ một dòng nhật ký: payload ĐÃ gửi, mã lỗi, request_id. */
  private async logRejectedAttempt(
    params: PublishRunParams,
    batchNo: number,
    round: number,
    plans: ActivityProductPlan[],
    failure: ProviderFailure,
  ): Promise<void> {
    const { flashSale, activityId, userId, attempt } = params;
    await this.flashSales.writeLog({
      organizationId: flashSale.organizationId,
      flashSaleId: flashSale.id,
      action: PodFlashSaleLogAction.UPDATE_PRODUCTS,
      level: PodFlashSaleLogLevel.ERROR,
      message: `Lô ${batchNo}${round > 0 ? ` (gửi lại lần ${round})` : ''}: TikTok từ chối — ${this.failureText(failure)}`,
      request: {
        activityId,
        batch: batchNo,
        round,
        products: plans.map((plan) => plan.input),
      } as unknown as Prisma.InputJsonValue,
      errorCode: failure.code,
      errorMessage: failure.message,
      requestId: failure.requestId,
      attempt,
      userId,
    });
    this.logger.warn({
      module: 'pod-flash-sale',
      operation: 'flashSale.publish.batch.rejected',
      flashSaleId: flashSale.id,
      shopId: flashSale.shopId,
      activityId,
      batchIndex: batchNo,
      round,
      batchSize: plans.length,
      skuCount: plans.reduce((sum, plan) => sum + plan.itemIds.length, 0),
      errorCode: failure.code,
      errorMessage: failure.message,
      requestId: failure.requestId,
      msg: `[FLASH_SALE] Lô ${batchNo}: TikTok từ chối`,
    });
  }

  /**
   * Kiểm chứng TRÊN TIKTOK từng sản phẩm của một lô bị từ chối — Get Product bằng ngữ cảnh của ĐÚNG
   * shop đang publish, nên sản phẩm của shop khác cũng lộ ra ở đây (lỗi "không tìm thấy").
   *
   * 🔴 "SKU tồn tại trong database" ≠ "SKU gửi được". Một sản phẩm đã bị xoá / ngừng bán trên TikTok
`   * vẫn được Get Product trả về KÈM đủ SKU — điều duy nhất khác là `status` ≠ ACTIVATE. Vì vậy kiểm
   * CẢ trạng thái sản phẩm lẫn việc SKU còn nằm trên sản phẩm.
   *
   * Không đọc được (lỗi tạm thời) ⇒ KHÔNG kết luận gì về sản phẩm đó (không đánh hỏng oan).
   */
  private async findUnpublishableItems(
    context: TiktokShopContext,
    plans: ActivityProductPlan[],
    cause: ProviderFailure,
  ): Promise<Map<string, ItemFailure>> {
    const invalid = new Map<string, ItemFailure>();
    const tiktok = `TikTok từ chối lô: ${this.failureText(cause)}`;
    const queue = [...plans];
    const worker = async (): Promise<void> => {
      for (let plan = queue.shift(); plan; plan = queue.shift()) {
        const productId = plan.input.id;
        let detail: { status?: string; productStatus?: string; skus?: Array<{ id?: string }> };
        try {
          detail = (await this.withRequestTimeout(this.productApi.getProduct(context, productId))).data;
        } catch (error) {
          if (this.isTransient(error) || this.isRunFatal(error)) continue;
          const failure = this.describeFailure(error);
          const message = `Không đọc được sản phẩm ${productId} ở shop này (${this.failureText(failure)}). ${tiktok}`;
          plan.itemIds.forEach((itemId) =>
            invalid.set(itemId, { code: FLASH_SALE_ITEM_ERROR_CODES.PRODUCT_NOT_FOUND, message }),
          );
          continue;
        }

        const status = detail.productStatus ?? detail.status;
        if (status && status !== TIKTOK_PRODUCT_STATUS.ACTIVATE) {
          const message =
            `Sản phẩm ${productId} đang ở trạng thái ${status} trên TikTok — không còn bán nên không ` +
            `vào được Flash Sale (SKU vẫn tồn tại trên sản phẩm). ${tiktok}`;
          plan.itemIds.forEach((itemId) =>
            invalid.set(itemId, { code: FLASH_SALE_ITEM_ERROR_CODES.PRODUCT_NOT_LIVE, message }),
          );
          continue;
        }

        const skuIds = new Set((detail.skus ?? []).map((sku) => sku.id).filter(Boolean));
        for (const [skuId, itemId] of plan.itemByVariantId) {
          if (!skuIds.has(skuId)) {
            invalid.set(itemId, {
              code: FLASH_SALE_ITEM_ERROR_CODES.SKU_NOT_ON_PRODUCT,
              message: `SKU ${skuId} không còn thuộc sản phẩm ${productId} trên TikTok. ${tiktok}`,
            });
          }
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(FLASH_SALE_VERIFY_CONCURRENCY, plans.length) }, () => worker()),
    );
    return invalid;
  }

  /**
   * Lô bị từ chối mà KHÔNG tách được mục nào ⇒ có thể chính hoạt động đã bị đóng. Hỏi Get Activity:
   * đóng / bị khoá / không đọc được vì lỗi nghiệp vụ ⇒ lỗi của CẢ lượt (dừng, các lô sau SKIPPED);
   * còn mở ⇒ đây là lỗi riêng của lô, lượt đi tiếp.
   */
  private async assertActivityWritable(
    context: TiktokShopContext,
    activityId: string,
    cause: ProviderFailure,
  ): Promise<void> {
    let activity: TiktokActivityDetail;
    try {
      activity = (await this.withRequestTimeout(this.promotionApi.getActivity(context, activityId))).data;
    } catch (error) {
      if (this.isTransient(error)) return;
      throw new PodFlashSaleRunAbortedError(this.describeFailure(error));
    }
    const immutable = Boolean(activity.activityCommands?.includes(TIKTOK_ACTIVITY_COMMAND_IMMUTABLE));
    const closed = [
      TIKTOK_ACTIVITY_STATUS.DEACTIVATED,
      TIKTOK_ACTIVITY_STATUS.EXPIRED,
      TIKTOK_ACTIVITY_STATUS.NOT_EFFECTIVE,
    ].includes(activity.status as never);
    if (immutable || closed) {
      throw new PodFlashSaleRunAbortedError({
        code: cause.code,
        message:
          `Hoạt động TikTok ${activityId} không còn nhận sản phẩm (${activity.status ?? 'không rõ'}` +
          `${immutable ? ', IMMUTABLE' : ''}). ${cause.message}`,
        requestId: cause.requestId,
      });
    }
  }

  /** Bỏ các dòng hỏng khỏi kế hoạch gửi — sản phẩm không còn SKU nào thì bỏ cả mục. */
  private withoutItems(plans: ActivityProductPlan[], itemIds: Set<string>): ActivityProductPlan[] {
    const kept: ActivityProductPlan[] = [];
    for (const plan of plans) {
      if (plan.itemByVariantId.size === 0) {
        // Mức PRODUCT: một mục = một dòng.
        if (!plan.itemIds.some((id) => itemIds.has(id))) kept.push(plan);
        continue;
      }
      const variants = [...plan.itemByVariantId].filter(([, itemId]) => !itemIds.has(itemId));
      if (variants.length === 0) continue;
      const keptSkuIds = new Set(variants.map(([skuId]) => skuId));
      kept.push({
        input: { ...plan.input, skus: plan.input.skus.filter((sku) => keptSkuIds.has(sku.id)) },
        itemIds: plan.itemIds.filter((id) => !itemIds.has(id)),
        itemByVariantId: new Map(variants),
      });
    }
    return kept;
  }

  /** Gộp dòng hỏng theo (mã, thông điệp) — mỗi nhóm MỘT câu `updateMany`. */
  private groupFailures(failures: Map<string, ItemFailure>): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const [itemId, failure] of failures) {
      const key = JSON.stringify({ code: failure.code, message: failure.message });
      groups.set(key, [...(groups.get(key) ?? []), itemId]);
    }
    return groups;
  }

  /** `{productId, skuId, code}` của từng dòng hỏng — cho log (không chứa dữ liệu nhạy cảm). */
  private describeFailedSkus(
    batch: ActivityProductPlan[],
    failures: Map<string, ItemFailure>,
  ): Array<{ productId: string; skuId: string | null; code: string }> {
    const rows: Array<{ productId: string; skuId: string | null; code: string }> = [];
    for (const plan of batch) {
      const skuByItem = new Map([...plan.itemByVariantId].map(([skuId, itemId]) => [itemId, skuId]));
      for (const itemId of plan.itemIds) {
        const failure = failures.get(itemId);
        if (failure) rows.push({ productId: plan.input.id, skuId: skuByItem.get(itemId) ?? null, code: failure.code });
      }
    }
    return rows;
  }

  /**
   * Dòng bị bỏ qua ở pre-flight vì ĐỊNH DANH phía sàn không gửi được (sản phẩm không còn bán, SKU đã
   * xoá / bản chụp cũ, sai shop, trùng SKU, thiếu id) ⇒ FAILED kèm mã + lý do của validator.
   *
   * Lỗi GIÁ / GIỚI HẠN không đổi trạng thái dòng: đó là việc người dùng cần sửa, vẫn hiện ở danh sách
   * vấn đề như trước. Dòng đã PUBLISHED không bao giờ bị hạ xuống.
   */
  private async markInvalidItems(
    flashSale: FlashSaleDetailRow,
    issues: Array<{ level: string; code: string; message: string; itemId?: string | null }>,
  ): Promise<number> {
    const identityCodes: string[] = [
      FLASH_SALE_ISSUE_CODES.PRODUCT_NOT_ACTIVE,
      FLASH_SALE_ISSUE_CODES.SKU_PRODUCT_MISMATCH,
      FLASH_SALE_ISSUE_CODES.PRODUCT_SHOP_MISMATCH,
      FLASH_SALE_ISSUE_CODES.VARIANT_REMOVED,
      FLASH_SALE_ISSUE_CODES.DUPLICATE_SKU,
      FLASH_SALE_ISSUE_CODES.MISSING_PROVIDER_ID,
    ];
    const failures = new Map<string, ItemFailure>();
    for (const issue of issues) {
      if (issue.level !== 'ERROR' || !issue.itemId || !identityCodes.includes(issue.code)) continue;
      if (!failures.has(issue.itemId)) failures.set(issue.itemId, { code: issue.code, message: issue.message });
    }
    if (failures.size === 0) return 0;

    await this.prisma.$transaction(async (tx) => {
      for (const [key, itemIds] of this.groupFailures(failures)) {
        const { code, message } = JSON.parse(key) as ItemFailure;
        await tx.podFlashSaleItem.updateMany({
          where: { id: { in: itemIds }, flashSaleId: flashSale.id, status: { not: PodFlashSaleItemStatus.PUBLISHED } },
          data: { status: PodFlashSaleItemStatus.FAILED, errorCode: code.slice(0, 32), error: message.slice(0, 2000) },
        });
      }
    });
    this.logger.warn({
      module: 'pod-flash-sale',
      operation: 'flashSale.publish.preflight',
      flashSaleId: flashSale.id,
      shopId: flashSale.shopId,
      failedCount: failures.size,
      msg: `[FLASH_SALE] Pre-flight: ${failures.size} dòng không gửi được (sản phẩm/SKU không hợp lệ) — đánh FAILED`,
    });
    return failures.size;
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
   * Đối soát dòng trong database với danh sách sản phẩm của hoạt động trên TikTok.
   *
   * 🔴 CHỈ dòng đã `PUBLISHED` mới có thể trở thành `REMOVED` ("sàn đã gỡ ra"). Dòng chưa
   * gửi (READY/PENDING — vd vừa thêm vào đợt đang chạy) hay gửi hỏng (FAILED) vốn KHÔNG có trên
   * sàn; trước đây chúng cũng bị đánh `REMOVED`, rồi Retry và Duplicate bỏ qua ⇒ mất dòng.
   *
   * `REMOVED` vẫn là một DÒNG (không xoá) — Duplicate chép lại nó như mọi dòng khác.
   * Dùng chung cho lượt đồng bộ trạng thái và lượt đồng bộ Flash Sale từ TikTok.
   */
  async reconcileItemsWithActivity(
    flashSaleId: string,
    activity: TiktokActivityDetail,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const confirmedSkuIds = new Set<string>();
    const confirmedProductIds = new Set<string>();
    for (const product of activity.products ?? []) {
      if (product.id) confirmedProductIds.add(product.id);
      for (const sku of product.skus ?? []) if (sku.id) confirmedSkuIds.add(sku.id);
    }

    // TikTok trả `products` rỗng cho hoạt động đã kết thúc quá 180 ngày (theo tài liệu) —
    // trong trường hợp đó danh sách rỗng KHÔNG có nghĩa là mọi dòng đã bị gỡ.
    if (confirmedProductIds.size === 0) return 0;

    const items = await tx.podFlashSaleItem.findMany({
      where: { flashSaleId, status: PodFlashSaleItemStatus.PUBLISHED },
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
      await tx.podFlashSaleItem.updateMany({
        where: { id: { in: removedIds } },
        data: { status: PodFlashSaleItemStatus.REMOVED },
      });
      await this.flashSales.refreshItemCount(flashSaleId, tx);
    }
    return removedIds.length;
  }

  /**
   * Trạng thái TikTok ⇒ trạng thái hệ thống.
   *
   * Hết giờ mà TikTok vẫn báo `ONGOING` (sàn cập nhật trễ) thì tin ĐỒNG HỒ: `endAt` là con
   * số hệ thống đã gửi đi và người vận hành đang nhìn vào nó.
   */
  mapProviderStatus(activity: { status?: string; activityCommands?: string[] }, endAt: Date): PodFlashSaleStatus {
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
  describeFailure(error: unknown): ProviderFailure {
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
