import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  PodListingPayloadStatus,
  PodListingJobItemStatus,
  PodListingJobStatus,
  PodListingJobType,
  PodListingLogLevel,
  PodListingMarket,
  PodListingReviewStatus,
  PodListingSessionProductStatus,
  PodListingSessionStatus,
  PodListingStep,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import {
  POD_SCOPE_SYSTEM,
  PodAccessScopeService,
  PodShopForbiddenException,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { shopScopeFilter } from '../../pod-tiktok/shared/shop-scope';
import {
  RETRYABLE_ERROR_CLASSES,
  TiktokErrorClass,
} from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  POD_LISTING_JOB_BATCH_FACTOR,
  POD_LISTING_JOB_CONCURRENCY,
  POD_LISTING_JOB_MAX_ITEMS,
  POD_LISTING_JOB_MAX_RETRIES,
  POD_LISTING_RETRY_BASE_DELAY_MS,
  POD_LISTING_RETRY_MAX_DELAY_MS,
  POD_LISTING_STALE_ITEM_MS,
  POD_LISTING_SWEEP_INTERVAL_MS,
  POD_LISTING_BLOCKER_CODES,
  POD_PRODUCT_CLONE_LOCK_MS,
  POD_PRODUCT_CLONE_WAIT_MS,
  POD_PUBLISH_BLOCKER_CODES,
  POD_PUBLISHABLE_PAYLOAD_STATUSES,
} from '../constants/pod-listing.constants';
import type {
  CreateListingJobDto,
  CreatePublishJobDto,
  PodListingJobItemQueryDto,
  PodListingJobQueryDto,
  PodListingLogQueryDto,
  RetryListingJobDto,
} from '../dto/pod-listing-job.dto';
import type { CloneProductDto } from '../dto/pod-product-clone.dto';
import { mapReviewStatus } from '../mappers/pod-review-status.mapper';
import { PodListingPayloadService } from './pod-listing-payload.service';
import { toJson, type ResolvedListing } from './pod-listing-resolver.service';
import {
  PodListingTemplateService,
  type ListingTemplateFull,
} from './pod-listing-template.service';
import {
  PodCategoryRuleException,
  PodImageUploadException,
  PodListingPublisherService,
  PodPublishPayloadException,
  PodShopContextException,
  PodWarehouseResolutionException,
  type ListingLogger,
} from './pod-listing-publisher.service';
import { humanizeTiktokListingError } from './pod-tiktok-error-message';
import {
  PodProductCloneResolverService,
  marketOfRegion,
  type CloneInProgress,
} from './pod-product-clone-resolver.service';
import { PodProductSyncService } from '../../pod-product/services/pod-product-sync.service';
import { PodListingValidatorService } from './pod-listing-validator.service';
import { computeRetryDelayMs, runWithConcurrency } from './pod-listing.queue';

/**
 * Kết quả lượt chạy → trạng thái Listing Session.
 *
 * Bảng tra thay cho chuỗi `if`: hai vòng đời song song nhau một-đối-một, viết ra bảng thì
 * thêm một trạng thái mới là lỗi biên dịch chứ không phải một nhánh bị quên.
 */
const SESSION_STATUS_BY_JOB: Record<PodListingJobStatus, PodListingSessionStatus> = {
  [PodListingJobStatus.PENDING]: PodListingSessionStatus.LISTING,
  [PodListingJobStatus.PROCESSING]: PodListingSessionStatus.LISTING,
  [PodListingJobStatus.COMPLETED]: PodListingSessionStatus.COMPLETED,
  [PodListingJobStatus.COMPLETED_WITH_ERRORS]: PodListingSessionStatus.COMPLETED_WITH_ERRORS,
  [PodListingJobStatus.FAILED]: PodListingSessionStatus.FAILED,
  [PodListingJobStatus.CANCELLED]: PodListingSessionStatus.CANCELLED,
};

export class PodListingJobNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_LISTING_JOB_NOT_FOUND', message: 'Không tìm thấy Listing Job' });
  }
}

/** Sản phẩm nguồn của lượt nhân bản không tồn tại trong tổ chức (hoặc đã bị xoá). */
export class PodCloneSourceNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_PRODUCT_NOT_FOUND', message: 'Không tìm thấy sản phẩm' });
  }
}

/** Đang có một lượt nhân bản khác vừa được tạo cho đúng sản phẩm này (bấm hai lần liên tiếp). */
export class PodCloneBusyException extends ConflictException {
  constructor() {
    super({
      code: 'POD_PRODUCT_CLONE_BUSY',
      message: 'Sản phẩm này vừa được gửi nhân bản ở một yêu cầu khác. Chờ lượt đó xong rồi thử lại.',
    });
  }
}

/** Không xác định được thị trường (market) của shop nguồn — không tạo được lượt chạy. */
export class PodCloneMarketUnknownException extends BadRequestException {
  constructor(region: string | null) {
    super({
      code: 'POD_PRODUCT_CLONE_MARKET_UNKNOWN',
      message: `Không xác định được thị trường của shop nguồn (vùng "${region ?? '?'}") — không nhân bản được.`,
    });
  }
}

/**
 * Lỗi **tạm thời** trong pipeline CLONE: một lượt KHÁC đang tạo đúng sản phẩm này lên đúng shop
 * này. Không phải lỗi nghiệp vụ ⇒ item chờ rồi thử lại (`POD_PRODUCT_CLONE_WAIT_MS`), hết lượt
 * chờ mới FAILED — với lý do nêu rõ lượt nào đang chặn, để người dùng Retry sau khi lượt kia xong.
 */
export class PodCloneInProgressException extends Error {
  readonly code = 'CLONE_IN_PROGRESS';

  constructor(readonly blocking: CloneInProgress) {
    const startedAt = blocking.startedAt ? blocking.startedAt.toISOString() : 'chưa bắt đầu';
    super(
      `Shop đích đang được một lượt nhân bản khác xử lý cho chính sản phẩm này ` +
        `(lượt #${blocking.jobId.slice(0, 8)}, bắt đầu ${startedAt}). Chờ lượt đó kết thúc rồi chạy lại.`,
    );
    this.name = 'PodCloneInProgressException';
  }
}

/** Item cần xử lý trong một vòng chạy. */
interface RunnableItem {
  id: string;
  /** Nguồn: sản phẩm đã đồng bộ… */
  productId: string | null;
  /** …hoặc Draft Product của Listing Session. Đúng một trong hai có giá trị. */
  sessionProductId: string | null;
  shopId: string;
  retryCount: number;
  /**
   * Draft Listing (payload) mà item này thao tác.
   *
   * Lượt CREATE_DRAFT sinh payload trong lúc chạy nên cột này trống lúc bắt đầu; lượt
   * PUBLISH thì ngược lại — payload là ĐẦU VÀO và bắt buộc phải có.
   */
  payloadId: string | null;
}

/**
 * PodListingJobService — **Bulk Listing Engine** (tạo Draft) và **Publish Engine** (gửi duyệt).
 *
 * ```
 *   type = CREATE_DRAFT                      type = PUBLISH
 *   Products × Shops × Template              Draft Listing đã có
 *        ↓ create()/createFromSession()           ↓ createPublishJob()
 *        ↓ Merge → Validate → Upload Images       ↓ Validate → Upload ảnh còn thiếu
 *        ↓ Create Product (AS_DRAFT)              ↓ Edit Product (LISTING)
 *        ↓ tiktok_draft_id                        ↓ status = PUBLISHED · UNDER_REVIEW
 *
 *   Dùng CHUNG: hàng đợi 5 luồng · retry 3 lần · backoff · sweeper · log · bộ đếm tiến độ
 * ```
 *
 * 🔴 Nguồn sự thật là DATABASE, không phải bộ nhớ. Hàng đợi trong tiến trình chỉ quyết định
 * "chạy cái nào tiếp theo"; mọi chuyển trạng thái đều được ghi ngay. Tiến trình chết giữa
 * chừng ⇒ bộ quét định kỳ nhặt lại job dang dở và chạy tiếp, không mất item nào.
 *
 * 🔴 KHÔNG BAO GIỜ tạo sản phẩm trùng: lượt PUBLISH gọi Edit Product trên đúng
 * `tiktok_draft_id` đã có. Ba chốt chặn — trạng thái PUBLISHING lúc tạo job (chống hai
 * request song song), bỏ qua payload đã PUBLISHED (chống bộ quét chạy lại), và nhánh Edit
 * trong publisher (chống Create lần hai).
 */
@Injectable()
export class PodListingJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PodListingJobService.name);

  /** Job đang chạy trong tiến trình này — chặn hai vòng chạy chồng lên cùng một job. */
  private readonly running = new Set<string>();
  private sweeper?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    /**
     * Đồng bộ sản phẩm — dùng ĐÚNG service hiện có (`PodProductSyncService`), không có
     * bản sao nào. `PodListingModule` vốn đã import `PodProductModule` nên không phát
     * sinh vòng phụ thuộc.
     */
    private readonly productSync: PodProductSyncService,
    private readonly prisma: PrismaService,
    private readonly listingTemplates: PodListingTemplateService,
    private readonly payloads: PodListingPayloadService,
    private readonly validator: PodListingValidatorService,
    private readonly publisher: PodListingPublisherService,
    private readonly accessScope: PodAccessScopeService,
    private readonly cloneResolver: PodProductCloneResolverService,
    private readonly lock: DistributedLockService,
  ) {}

  /**
   * Bộ quét: nhặt lại job dang dở sau khi tiến trình khởi động lại.
   *
   * Cũng là nơi đánh thức item đang chờ backoff — không giữ `setTimeout` cho từng item, vì
   * `setTimeout` chết theo tiến trình còn cột `next_attempt_at` thì không.
   */
  onModuleInit(): void {
    this.sweeper = setInterval(() => {
      void this.sweep();
    }, POD_LISTING_SWEEP_INTERVAL_MS);
    // Không giữ tiến trình sống chỉ vì bộ quét (quan trọng với test và lệnh CLI).
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.sweeper) clearInterval(this.sweeper);
  }

  // ---------------------------------------------------------------------------
  // Tạo & vận hành job
  // ---------------------------------------------------------------------------

  /**
   * Tạo Listing Job từ một **Listing Session** (nút Start Listing).
   *
   * 🔴 Khác `create()` ở đúng một điểm: nguồn là Draft Product của session chứ không phải
   * sản phẩm đã đồng bộ. Từ lúc job chạy trở đi hai đường đi chung một mạch — cùng hàng đợi,
   * cùng retry, cùng log, cùng `save_mode = AS_DRAFT`. Không có đường thứ hai tới TikTok.
   *
   * Bộ template nằm ở SESSION, dùng chung cho mọi item của lượt này, nên job không cần
   * `listingTemplateId`: `run()` ghép 5 mảnh của session lại MỘT LẦN cho cả lượt.
   */
  async createFromSession(
    organizationId: string,
    userId: string,
    input: {
      sessionId: string;
      name: string;
      market: PodListingMarket;
      /** Cặp (Draft Product, shop) — sản phẩm nào lên shop nào. */
      targets: Array<{ sessionProductId: string; shopId: string }>;
      products: number;
      /**
       * `CREATE_DRAFT` (mặc định — Draft trên sàn, `save_mode = AS_DRAFT`) hoặc `LIVE_LISTING`
       * (Publish Live TikTok — Create Product `save_mode = LISTING`, vào thẳng hàng chờ duyệt).
       */
      type?: typeof PodListingJobType.CREATE_DRAFT | typeof PodListingJobType.LIVE_LISTING;
    },
  ) {
    if (input.targets.length === 0) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_NO_TARGET',
        message: 'Không có cặp (sản phẩm, shop) nào để chạy.',
      });
    }
    if (input.targets.length > POD_LISTING_JOB_MAX_ITEMS) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_TOO_LARGE',
        message: `Một lượt tối đa ${POD_LISTING_JOB_MAX_ITEMS} listing (đang là ${input.targets.length}).`,
      });
    }

    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.podListingJob.create({
        data: {
          organizationId,
          sessionId: input.sessionId,
          name: input.name,
          market: input.market,
          type: input.type ?? PodListingJobType.CREATE_DRAFT,
          totalItems: input.targets.length,
          concurrency: POD_LISTING_JOB_CONCURRENCY,
          maxRetries: POD_LISTING_JOB_MAX_RETRIES,
          createdBy: userId,
        },
        select: { id: true },
      });

      await tx.podListingJobItem.createMany({
        data: input.targets.map((target) => ({
          organizationId,
          jobId: created.id,
          sessionProductId: target.sessionProductId,
          shopId: target.shopId,
        })),
      });

      const live = input.type === PodListingJobType.LIVE_LISTING;
      await tx.podListingLog.create({
        data: {
          organizationId,
          jobId: created.id,
          level: PodListingLogLevel.INFO,
          step: PodListingStep.LOAD_TEMPLATE,
          message: `${live ? 'Publish Live' : 'Start Listing'}: ${input.products} sản phẩm × ${input.targets.length} lượt đăng`,
          payload: toJson({ market: input.market, sessionId: input.sessionId, saveMode: live ? 'LISTING' : 'AS_DRAFT' }),
        },
      });

      return created;
    });

    this.runInBackground(organizationId, job.id);
    // Job vừa do chính lời gọi này tạo ra, và shop của từng item đã được kiểm ở tầng
    // trên trước khi ghi — đọc lại bằng phạm vi hệ thống, không phải một lối tắt.
    return this.get(organizationId, job.id, POD_SCOPE_SYSTEM);
  }

  /**
   * Tạo lượt **PUBLISH** — nút "Publish Selected" / "Publish All" ở màn hình Draft Listing.
   *
   * ```
   *   Draft Listing (pod_listing_payloads)
   *        ↓ chọn những Draft ĐỦ ĐIỀU KIỆN
   *        ↓ pod_listing_jobs(type = PUBLISH) + item, mỗi item = MỘT (draft × shop)
   *        ↓ run()  → chung hàng đợi 5 luồng, chung retry 3 lần với lượt tạo Draft
   *        ↓        → Edit Product (save_mode = LISTING) trên ĐÚNG draft đã có
   *        ↓ finalize() → COMPLETED / COMPLETED_WITH_ERRORS / FAILED
   * ```
   *
   * 🔴 Lọc điều kiện ở ĐÂY, không ở trình duyệt: người dùng chọn cả trang rồi bấm Publish thì
   * trong đó có cả draft lỗi và draft đã publish. Bỏ qua chúng lặng lẽ là sai (người dùng
   * tưởng đã publish), mà chặn cả lượt cũng sai — nên chúng được **trả về trong `skipped`**
   * kèm lý do, và lượt chạy vẫn tiến hành với phần hợp lệ.
   */
  async createPublishJob(
    organizationId: string,
    userId: string,
    dto: CreatePublishJobDto,
    scope: PodAccessScope,
  ) {
    const explicit = [...new Set(dto.draftIds ?? [])];
    // 🔴 `Publish All` không nhận id nào — nó publish theo BỘ LỌC. Nên phạm vi phải nằm
    // trong chính câu truy vấn chọn ứng viên bên dưới, và bộ lọc `shopId` do người dùng gửi
    // phải bị chặn ở đây trước khi được dùng.
    this.accessScope.assertShopAllowed(scope, dto.shopId);

    // "Publish All" = mọi Draft đủ điều kiện trong phạm vi bộ lọc đang hiển thị. Trần
    // POD_LISTING_JOB_MAX_ITEMS + 1 để phân biệt "vừa đủ" với "vượt trần".
    const candidates = await this.prisma.podListingPayload.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(explicit.length > 0 ? { id: { in: explicit } } : {}),
        ...(dto.sessionId ? { sessionProduct: { sessionId: dto.sessionId } } : {}),
        shopId: shopScopeFilter(this.accessScope.shopFilter(scope)?.in, dto.shopId),
        ...(dto.market ? { market: dto.market } : {}),
        // 🔴 "Publish All" phải bám ĐÚNG bộ lọc màn hình đang hiển thị. Bỏ qua chúng là
        // người dùng lọc còn 12 dòng, bấm Publish All, rồi 2.000 listing lên sàn.
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.search ? { title: { contains: dto.search, mode: 'insensitive' as const } } : {}),
        // "Publish All" chỉ nhặt cái đủ điều kiện; danh sách chọn tay thì lấy hết rồi phân
        // loại bên dưới, để nói được LÝ DO từng cái bị bỏ.
        ...(explicit.length > 0
          ? {}
          : { status: { in: [...POD_PUBLISHABLE_PAYLOAD_STATUSES] }, errorCount: 0 }),
      },
      select: {
        id: true,
        shopId: true,
        market: true,
        status: true,
        errorCount: true,
        productId: true,
        sessionProductId: true,
        title: true,
      },
      orderBy: { createdAt: 'asc' },
      take: POD_LISTING_JOB_MAX_ITEMS + 1,
    });

    const skipped: Array<{ draftId: string; title: string | null; reason: string }> = [];
    const eligible = candidates.filter((draft) => {
      if (!POD_PUBLISHABLE_PAYLOAD_STATUSES.includes(draft.status)) {
        skipped.push({
          draftId: draft.id,
          title: draft.title,
          reason:
            draft.status === PodListingPayloadStatus.PUBLISHED
              ? 'Đã publish rồi — không gửi lại để tránh sản phẩm trùng.'
              : draft.status === PodListingPayloadStatus.PUBLISHING
                ? 'Đang publish ở một lượt khác.'
                : `Trạng thái ${draft.status} không được phép publish.`,
        });
        return false;
      }
      if (draft.errorCount > 0) {
        skipped.push({
          draftId: draft.id,
          title: draft.title,
          reason: 'Draft còn lỗi dữ liệu — sửa rồi publish lại.',
        });
        return false;
      }
      return true;
    });

    if (eligible.length === 0) {
      throw new BadRequestException({
        code: 'POD_PUBLISH_JOB_NO_TARGET',
        message:
          skipped.length > 0
            ? `Không Draft nào đủ điều kiện publish. Ví dụ: ${skipped[0].reason}`
            : 'Không tìm thấy Draft nào để publish.',
      });
    }
    if (eligible.length > POD_LISTING_JOB_MAX_ITEMS) {
      throw new BadRequestException({
        code: 'POD_PUBLISH_JOB_TOO_LARGE',
        message: `Một lượt tối đa ${POD_LISTING_JOB_MAX_ITEMS} listing — lọc bớt rồi publish theo đợt.`,
      });
    }

    // Một job mang MỘT thị trường (cột `market` của bảng job). Trộn thị trường thì con số
    // trên màn hình sẽ nói dối, nên chặn và bảo người dùng lọc — rẻ hơn nhiều so với việc
    // ghi bừa thị trường của bản ghi đầu tiên.
    const markets = [...new Set(eligible.map((draft) => draft.market))];
    if (markets.length > 1) {
      throw new BadRequestException({
        code: 'POD_PUBLISH_JOB_MIXED_MARKET',
        message: `Các Draft đang chọn thuộc ${markets.length} thị trường (${markets.join(', ')}) — lọc theo một thị trường rồi publish.`,
      });
    }

    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.podListingJob.create({
        data: {
          organizationId,
          type: PodListingJobType.PUBLISH,
          name: dto.name?.trim() || `Publish — ${eligible.length} listing`,
          market: markets[0],
          totalItems: eligible.length,
          concurrency: POD_LISTING_JOB_CONCURRENCY,
          maxRetries: POD_LISTING_JOB_MAX_RETRIES,
          createdBy: userId,
        },
        select: { id: true },
      });

      await tx.podListingJobItem.createMany({
        data: eligible.map((draft) => ({
          organizationId,
          jobId: created.id,
          // Nguồn được chép lại từ payload để màn hình Job Detail hiển thị được tên sản
          // phẩm; `payloadId` mới là thứ pipeline publish thực sự đọc.
          productId: draft.productId,
          sessionProductId: draft.sessionProductId,
          shopId: draft.shopId,
          payloadId: draft.id,
        })),
      });

      await tx.podListingLog.create({
        data: {
          organizationId,
          jobId: created.id,
          level: PodListingLogLevel.INFO,
          step: PodListingStep.PUBLISH,
          message: `Publish ${eligible.length} Draft lên TikTok (chờ duyệt)`,
          payload: toJson({ market: markets[0], skipped: skipped.length }),
        },
      });

      // Đánh dấu PUBLISHING NGAY trong cùng transaction tạo job: hai người cùng bấm Publish
      // trên cùng một Draft thì người thứ hai không còn thấy nó "đủ điều kiện" nữa — đây là
      // chốt chặn duy nhất giữa hai request song song.
      await tx.podListingPayload.updateMany({
        where: { id: { in: eligible.map((draft) => draft.id) } },
        data: { status: PodListingPayloadStatus.PUBLISHING, publishError: null },
      });

      return created;
    });

    this.runInBackground(organizationId, job.id);
    return { ...(await this.get(organizationId, job.id, scope)), skipped };
  }

  /** Tạo job rồi khởi động ngay (không chặn request — HTTP trả về id để theo dõi tiến độ). */
  async create(
    organizationId: string,
    userId: string,
    dto: CreateListingJobDto,
    scope: PodAccessScope,
  ) {
    // 🔴 Chặn trước khi sinh item: một lượt chạy là `productIds × shopIds`, nên một shop lạ
    // lọt vào đây là hàng trăm listing được đẩy lên shop của người khác.
    for (const shopId of dto.shopIds) this.accessScope.assertShopAllowed(scope, shopId);

    const template = await this.listingTemplates.get(organizationId, dto.listingTemplateId);
    if (template.market !== dto.market) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_MARKET_MISMATCH',
        message: `Listing Template thuộc thị trường ${template.market}, không phải ${dto.market}.`,
      });
    }

    const shops = await this.prisma.podTiktokShop.findMany({
      where: { id: { in: dto.shopIds }, organizationId, deletedAt: null },
      select: { id: true, accountId: true, name: true },
    });
    if (shops.length !== new Set(dto.shopIds).size) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_INVALID_SHOP',
        message: 'Có shop không tồn tại hoặc không thuộc tổ chức này.',
      });
    }

    const products = await this.prisma.podProduct.findMany({
      where: { id: { in: dto.productIds }, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (products.length !== new Set(dto.productIds).size) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_INVALID_PRODUCT',
        message: 'Có sản phẩm không tồn tại hoặc không thuộc tổ chức này.',
      });
    }

    const total = products.length * shops.length;
    if (total > POD_LISTING_JOB_MAX_ITEMS) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_TOO_LARGE',
        message: `Một lượt tối đa ${POD_LISTING_JOB_MAX_ITEMS} listing (đang là ${total}).`,
      });
    }

    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.podListingJob.create({
        data: {
          organizationId,
          name: dto.name?.trim() || `${template.name} — ${products.length}×${shops.length}`,
          market: dto.market,
          listingTemplateId: template.id,
          imageTemplateId: dto.imageTemplateId ?? null,
          totalItems: total,
          concurrency: POD_LISTING_JOB_CONCURRENCY,
          maxRetries: POD_LISTING_JOB_MAX_RETRIES,
          createdBy: userId,
        },
        select: { id: true },
      });

      await tx.podListingJobItem.createMany({
        data: products.flatMap((product) =>
          shops.map((shop) => ({
            organizationId,
            jobId: created.id,
            productId: product.id,
            shopId: shop.id,
            listingTemplateId: template.id,
          })),
        ),
      });

      await tx.podListingLog.create({
        data: {
          organizationId,
          jobId: created.id,
          level: PodListingLogLevel.INFO,
          step: PodListingStep.LOAD_TEMPLATE,
          message: `Đã tạo lượt chạy: ${products.length} sản phẩm × ${shops.length} shop`,
          payload: toJson({
            listingTemplate: template.name,
            market: dto.market,
            shops: shops.map((shop) => shop.name),
          }),
        },
      });

      return created;
    });

    // Chạy nền: người dùng không phải giữ tab mở chờ 500 sản phẩm.
    this.runInBackground(organizationId, job.id);

    // Job vừa do chính lời gọi này tạo ra, và shop của từng item đã được kiểm ở tầng
    // trên trước khi ghi — đọc lại bằng phạm vi hệ thống, không phải một lối tắt.
    return this.get(organizationId, job.id, POD_SCOPE_SYSTEM);
  }

  /**
   * Tạo lượt **NHÂN BẢN**: MỘT sản phẩm đã đồng bộ ⇒ NHIỀU shop đích (nút "Nhân bản sản phẩm").
   *
   * ```
   *   1. Nạp sản phẩm nguồn (404 nếu không thuộc tổ chức)  →  kiểm shop NGUỒN trong phạm vi
   *   2. Từng shop đích: assertShopAllowed (một shop lạ ⇒ 403 CẢ request, không tạo gì)
   *   3. Từng shop đích: đã có sản phẩm này (chống trùng, lý do CUỐI CÙNG)? ⇒ item SKIPPED
   *      ngay lúc tạo, kèm lý do
   *   4. Job type = CLONE, một item cho mỗi shop đích còn lại → chạy nền
   * ```
   *
   * 🔴 **Không tin danh sách shop từ client.** Seller sửa request nhét shop của người khác thì
   * bước 2 chặn TRƯỚC khi bất kỳ bản ghi nào được tạo — không có chuyện "chạy phần hợp lệ,
   * lặng lẽ bỏ phần còn lại": người dùng phải biết request của họ có shop không được phép.
   *
   * 🔴 **Chống bấm đúp ở server**: khoá Redis theo sản phẩm nguồn quanh bước tạo job
   * (`pod:product-clone:{productId}`, TTL `POD_PRODUCT_CLONE_LOCK_MS`, tự hết hạn nếu tiến
   * trình chết). Disable nút ở trình duyệt chỉ là lớp đầu tiên.
   *
   * 🔴 "Đang có lượt khác chạy cho cặp (sản phẩm, shop)" là chuyện **tạm thời** và KHÔNG
   * được quyết ở đây: item vẫn được tạo PENDING, pipeline (`processCloneItem`) sẽ chờ lượt
   * kia xong — rồi hoặc thấy sản phẩm đã có (SKIPPED đúng nghĩa chống trùng), hoặc tự tạo
   * nếu lượt kia hỏng. Đánh SKIPPED ngay lúc tạo là biến một cái chờ thành một cái kết luận sai.
   */
  async createCloneJob(
    organizationId: string,
    userId: string,
    productId: string,
    dto: CloneProductDto,
    scope: PodAccessScope,
  ) {
    const product = await this.cloneResolver.loadSource(organizationId, productId);
    if (!product) throw new PodCloneSourceNotFoundException();
    // Sản phẩm nguồn phải thuộc shop người gọi được thấy — không thì với họ nó "không tồn tại".
    this.accessScope.assertShopAllowed(scope, product.shopId);

    const targetShopIds = [...new Set(dto.targetShopIds)];
    for (const shopId of targetShopIds) this.accessScope.assertShopAllowed(scope, shopId);

    const shops = await this.prisma.podTiktokShop.findMany({
      where: { id: { in: targetShopIds }, organizationId, deletedAt: null },
      select: { id: true, accountId: true, name: true, region: true },
    });
    if (shops.length !== targetShopIds.length) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_INVALID_SHOP',
        message: 'Có shop không tồn tại hoặc không thuộc tổ chức này.',
      });
    }

    const market = marketOfRegion(product.shop.region);
    if (!market) throw new PodCloneMarketUnknownException(product.shop.region);

    const created = await this.lock.withLock(
      `pod:product-clone:${product.id}`,
      POD_PRODUCT_CLONE_LOCK_MS,
      async () => {
        // Kiểm "đã có" (chống trùng — lý do cuối cùng) cho từng shop TRONG khoá: hai request
        // song song không cùng thấy "chưa có".
        const skips = new Map<string, string>();
        for (const shop of shops) {
          const reason = await this.cloneResolver.findSkipReason(organizationId, product, shop.id);
          if (reason) skips.set(shop.id, reason.message);
        }

        return this.prisma.$transaction(async (tx) => {
          const now = new Date();
          const job = await tx.podListingJob.create({
            data: {
              organizationId,
              name: `Nhân bản · ${(product.title ?? product.tiktokProductId).slice(0, 200)} → ${shops.length} shop`,
              market,
              type: PodListingJobType.CLONE,
              totalItems: shops.length,
              failedItems: skips.size,
              concurrency: POD_LISTING_JOB_CONCURRENCY,
              maxRetries: POD_LISTING_JOB_MAX_RETRIES,
              createdBy: userId,
            },
            select: { id: true },
          });

          await tx.podListingJobItem.createMany({
            data: shops.map((shop) => {
              const skip = skips.get(shop.id);
              return {
                organizationId,
                jobId: job.id,
                productId: product.id,
                shopId: shop.id,
                ...(skip
                  ? {
                      status: PodListingJobItemStatus.SKIPPED,
                      error: skip.slice(0, 2000),
                      errorCode: 'CLONE_SKIPPED',
                      startedAt: now,
                      finishedAt: now,
                      durationMs: 0,
                    }
                  : {}),
              };
            }),
          });

          await tx.podListingLog.create({
            data: {
              organizationId,
              jobId: job.id,
              level: PodListingLogLevel.INFO,
              step: PodListingStep.LOAD_PRODUCT,
              message: `Đã tạo lượt nhân bản: "${product.title ?? product.tiktokProductId}" → ${shops.length} shop (bỏ qua ${skips.size})`,
              payload: toJson({
                sourceProductId: product.id,
                sourceTiktokProductId: product.tiktokProductId,
                sourceShopId: product.shopId,
                market,
                shops: shops.map((shop) => ({
                  id: shop.id,
                  name: shop.name,
                  skipped: skips.get(shop.id) ?? null,
                })),
              }),
            },
          });

          return job;
        });
      },
    );
    if (!created) throw new PodCloneBusyException();

    this.runInBackground(organizationId, created.id);
    return this.get(organizationId, created.id, POD_SCOPE_SYSTEM);
  }

  /**
   * Khởi động một vòng chạy ở nền.
   *
   * 🔴 `run()` không bao giờ được để lỗi thoát ra dạng promise rejection không ai bắt: nó
   * chạy ngoài chu kỳ request, và một rejection không bắt sẽ giết cả tiến trình API.
   */
  private runInBackground(organizationId: string, jobId: string): void {
    void this.run(organizationId, jobId).catch((error: unknown) => {
      this.logger.error({
        module: 'pod-listing',
        operation: 'job.run.unhandled',
        organizationId,
        jobId,
        msg: error instanceof Error ? error.message : 'Lỗi không xác định',
      });
    });
  }

  /**
   * Vòng chạy của một job.
   *
   * Vòng lặp ngoài tồn tại vì **retry**: sau một lượt, những item lỗi được hẹn giờ chạy lại;
   * vòng sau chỉ nhặt item đã tới hẹn. Không có item nào tới hẹn thì ngủ tới mốc gần nhất.
   */
  async run(organizationId: string, jobId: string): Promise<void> {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);

    try {
      const job = await this.prisma.podListingJob.findFirst({
        where: { id: jobId, organizationId, deletedAt: null },
        select: {
          id: true,
          type: true,
          status: true,
          concurrency: true,
          maxRetries: true,
          startedAt: true,
          imageTemplateId: true,
          listingTemplateId: true,
          sessionId: true,
          createdBy: true,
        },
      });
      if (!job || job.status === PodListingJobStatus.CANCELLED) return;

      await this.prisma.podListingJob.update({
        where: { id: jobId },
        data: {
          status: PodListingJobStatus.PROCESSING,
          startedAt: job.startedAt ?? new Date(),
          finishedAt: null,
          durationMs: null,
        },
      });

      // Template của CẢ LƯỢT, ghép một lần: nguồn session thì ghép 5 mảnh của session, nguồn
      // sản phẩm đã đồng bộ thì đọc Listing Template đã lưu.
      //
      // 🔴 Lượt PUBLISH KHÔNG cần template: nội dung đã được chốt và lưu trong payload từ
      // lúc tạo Draft. Giải lại template ở đây là mở đường cho "cái đã gửi lên sàn" khác
      // "cái đang chờ duyệt" chỉ vì ai đó sửa template ở giữa.
      // Lượt CLONE cũng không có template: nội dung giải từ chính sản phẩm nguồn.
      const template =
        job.type === PodListingJobType.PUBLISH || job.type === PodListingJobType.CLONE
          ? null
          : job.sessionId
            ? await this.listingTemplates.getForSession(organizationId, job.sessionId)
            : await this.listingTemplates.get(organizationId, job.listingTemplateId ?? '');
      // Cache dùng chung cho cả lượt: token theo shop, uri ảnh theo file.
      const shopContexts = new Map<string, TiktokShopContext>();
      const imageUriCache = new Map<string, Promise<string>>();

      for (;;) {
        if (this.stopping) return;

        const ready = await this.claimReadyItems(
          jobId,
          job.concurrency * POD_LISTING_JOB_BATCH_FACTOR,
        );
        if (ready.length === 0) {
          const waitMs = await this.msUntilNextAttempt(jobId);
          if (waitMs === null) break;
          await this.delay(Math.min(waitMs, POD_LISTING_RETRY_MAX_DELAY_MS));
          continue;
        }

        await runWithConcurrency(
          ready.map(
            (item) => () =>
              this.processItem({
                organizationId,
                jobId,
                jobType: job.type,
                userId: job.createdBy,
                item,
                template,
                imageTemplateId: job.imageTemplateId,
                maxRetries: job.maxRetries,
                shopContexts,
                imageUriCache,
              }),
          ),
          job.concurrency,
        );
      }

      await this.finalize(organizationId, jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lỗi không xác định';
      this.logger.error({
        module: 'pod-listing',
        operation: 'job.run.fail',
        organizationId,
        jobId,
        msg: message,
      });
      // `updateMany`: job có thể đã bị xoá trong lúc lượt chạy còn dở — báo lỗi cho một
      // bản ghi không còn tồn tại thì không có gì để báo, và không được ném tiếp.
      await this.prisma.podListingJob.updateMany({
        where: { id: jobId },
        data: { status: PodListingJobStatus.FAILED, lastError: message.slice(0, 2000) },
      });
    } finally {
      this.running.delete(jobId);
    }
  }

  /**
   * Điều phối MỘT item về đúng pipeline của lượt chạy.
   *
   * 🔴 Hai pipeline dùng chung TOÀN BỘ phần khó: hàng đợi 5 luồng, retry 3 lần với backoff,
   * bộ quét item mồ côi, log theo bước, bộ đếm tiến độ. Chỉ lời gọi cuối tới TikTok là khác
   * nhau — vì thế Sprint 5 không sinh ra một cỗ máy hàng đợi thứ hai phải vận hành song song.
   */
  private async processItem(params: {
    organizationId: string;
    jobId: string;
    jobType: PodListingJobType;
    /** Người tạo job — draft sinh ra ghi đúng người chịu trách nhiệm. */
    userId: string | null;
    item: RunnableItem;
    /** `null` cho lượt PUBLISH — nội dung đã chốt trong payload, không giải lại template. */
    template: ListingTemplateFull | null;
    imageTemplateId: string | null;
    maxRetries: number;
    shopContexts: Map<string, TiktokShopContext>;
    /** Chứa Promise để năm luồng không cùng upload một tấm ảnh (xem publisher). */
    imageUriCache: Map<string, Promise<string>>;
  }): Promise<void> {
    if (params.jobType === PodListingJobType.PUBLISH) {
      return this.processPublishItem(params);
    }
    if (params.jobType === PodListingJobType.CLONE) {
      return this.processCloneItem(params);
    }
    return this.processCreateDraftItem({
      ...params,
      template: params.template as ListingTemplateFull,
      // Publish Live: cùng pipeline chuẩn bị, chỉ khác lời gọi cuối (LISTING thay vì AS_DRAFT).
      live: params.jobType === PodListingJobType.LIVE_LISTING,
    });
  }

  /**
   * Pipeline **PUBLISH** của MỘT item: Draft đã có ⇒ hàng chờ duyệt của TikTok.
   *
   * ```
   *   Load Payload → Validate → (Upload ảnh còn thiếu) → Edit Product (LISTING) → UNDER_REVIEW
   * ```
   *
   * 🔴 Nội dung gửi đi là payload ĐÃ LƯU — chính thứ đã tạo ra Draft trên sàn. Không giải
   * lại template: nếu ai đó sửa template giữa chừng thì bản đang chờ duyệt sẽ khác bản người
   * dùng đã xem trước, và không ai giải thích được vì sao.
   *
   * 🔴 Payload đã ở trạng thái PUBLISHED ⇒ coi là THÀNH CÔNG và không gọi TikTok. Đây là
   * chốt chặn chống publish hai lần khi bộ quét nhặt lại một item mồ côi.
   */
  private async processPublishItem(params: {
    organizationId: string;
    jobId: string;
    item: RunnableItem;
    maxRetries: number;
    shopContexts: Map<string, TiktokShopContext>;
    imageUriCache: Map<string, Promise<string>>;
  }): Promise<void> {
    const { organizationId, jobId, item } = params;
    const startedAt = Date.now();
    const log = this.itemLogger(organizationId, jobId, item.id);

    try {
      const draft = await this.prisma.podListingPayload.findFirst({
        where: { id: item.payloadId ?? '', organizationId, deletedAt: null },
        select: {
          id: true,
          shopId: true,
          status: true,
          errorCount: true,
          payload: true,
          tiktokDraftId: true,
          tiktokProductId: true,
          sessionProductId: true,
          publishRetryCount: true,
        },
      });
      if (!draft) {
        throw new PodPublishPayloadException('Draft Listing không còn tồn tại — đã bị xoá.');
      }
      if (draft.shopId !== item.shopId) {
        throw new PodPublishPayloadException('Draft Listing không thuộc shop của item này.');
      }

      // Đã publish rồi (lượt trước gửi xong nhưng chết trước khi ghi kết quả item): đóng sổ
      // THÀNH CÔNG, tuyệt đối không gọi TikTok lần nữa.
      if (draft.status === PodListingPayloadStatus.PUBLISHED) {
        await log(
          PodListingLogLevel.WARN,
          PodListingStep.PUBLISH,
          'Draft đã ở trạng thái PUBLISHED — bỏ qua, không gửi lại',
          { remoteProductId: draft.tiktokProductId },
        );
        await this.settleItem({
          organizationId,
          jobId,
          itemId: item.id,
          status: PodListingJobItemStatus.SUCCESS,
          remoteProductId: draft.tiktokProductId ?? undefined,
          error: null,
          errorCode: null,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      const resolved = draft.payload as unknown as ResolvedListing;

      // ---- Cổng VALIDATE (yêu cầu §9): Category · Brand · SKU · Images · Description ·
      // Pricing. KHÔNG kiểm kho — kho được resolve theo shop ngay trong bước publish.
      const validation = this.validator.validate(resolved);
      for (const warning of validation.warnings) {
        await log(PodListingLogLevel.WARN, PodListingStep.VALIDATE, warning.message, {
          code: warning.code,
        });
      }

      const blockers = [...validation.blockers];
      // "TikTok Draft ID tồn tại": chỉ bắt buộc khi Draft TỰ NHẬN là đã có trên sàn. Draft
      // mới nằm ở database (chưa từng chạm TikTok) vẫn publish được — nó đi nhánh Create ở
      // chế độ LISTING, vẫn đúng MỘT sản phẩm.
      if (draft.status === PodListingPayloadStatus.TIKTOK_DRAFT && !draft.tiktokDraftId) {
        blockers.push({
          code: POD_PUBLISH_BLOCKER_CODES.MISSING_TIKTOK_DRAFT,
          field: 'tiktokDraftId',
          message:
            'Draft ghi là đã có trên TikTok nhưng thiếu TikTok Draft ID — chạy lại Start Listing.',
        });
      }

      if (blockers.length > 0) {
        const message = blockers.map((blocker) => blocker.message).join(' · ');
        await log(
          PodListingLogLevel.ERROR,
          PodListingStep.VALIDATE,
          'Thiếu dữ liệu — không gửi TikTok',
          { blockers },
        );
        await this.prisma.podListingPayload.update({
          where: { id: draft.id },
          data: {
            // Trả về đúng trạng thái trước đó: bị cổng validate chặn thì Draft KHÔNG hỏng,
            // nó chỉ chưa đủ điều kiện — để nguyên FAILED là bắt người dùng sinh lại vô cớ.
            status: draft.tiktokDraftId
              ? PodListingPayloadStatus.TIKTOK_DRAFT
              : PodListingPayloadStatus.READY,
            publishError: message.slice(0, 2000),
          },
        });
        await this.settleItem({
          organizationId,
          jobId,
          itemId: item.id,
          status: PodListingJobItemStatus.SKIPPED,
          error: message,
          errorCode: blockers[0]?.code ?? null,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      await log(
        PodListingLogLevel.INFO,
        PodListingStep.VALIDATE,
        'Dữ liệu hợp lệ — được phép publish',
      );

      // ---- Gửi lên TikTok ----
      let ctx = params.shopContexts.get(item.shopId);
      if (!ctx) {
        ctx = await this.publisher.shopContext(organizationId, item.shopId);
        params.shopContexts.set(item.shopId, ctx);
      }

      const outcome = await this.publisher.publishListing({
        organizationId,
        ctx,
        payload: resolved,
        tiktokDraftId: draft.tiktokDraftId,
        imageUriCache: params.imageUriCache,
        log,
      });

      // ---- Ghi kết quả ----
      const publishedAt = new Date();
      // TikTok trả `audit.status` ngay sau Edit Product: dùng được thì dùng, không thì mặc
      // định UNDER_REVIEW đúng như yêu cầu §2 — scheduler 5 phút/lần sẽ chỉnh lại sau.
      const reviewStatus =
        mapReviewStatus(undefined, outcome.auditStatus) ?? PodListingReviewStatus.UNDER_REVIEW;

      await this.prisma.$transaction(async (tx) => {
        await tx.podListingPayload.update({
          where: { id: draft.id },
          data: {
            status: PodListingPayloadStatus.PUBLISHED,
            tiktokProductId: outcome.remoteProductId,
            // Nhánh CREATE vừa sinh ra draft id lần đầu — ghi lại để lần sau không tạo nữa.
            tiktokDraftId: draft.tiktokDraftId ?? outcome.remoteProductId,
            publishedAt,
            publishError: null,
            publishRetryCount: draft.publishRetryCount + item.retryCount,
            publishRequest: toJson(outcome.request as unknown as Record<string, unknown>),
            publishResponse: toJson({
              ...outcome.response,
              mode: outcome.mode,
              tiktokRequestId: outcome.tiktokRequestId,
            }),
            reviewStatus,
            reviewStatusRaw: null,
            reviewReason: null,
            reviewCheckedAt: null,
          },
        });

        for (const sku of outcome.skuIds) {
          await tx.podListingPayloadItem.updateMany({
            where: { payloadId: draft.id, sellerSku: sku.sellerSku },
            data: { tiktokSkuId: sku.tiktokSkuId },
          });
        }
      });

      await this.settleItem({
        organizationId,
        jobId,
        itemId: item.id,
        status: PodListingJobItemStatus.SUCCESS,
        remoteProductId: outcome.remoteProductId,
        error: null,
        errorCode: null,
        durationMs: Date.now() - startedAt,
      });

      // 🔴 ĐÂY là ranh giới nghiệp vụ "publish thành công": TikTok đã nhận, payload đã
      // chuyển sang PUBLISHED, item đã settle SUCCESS. Chỉ tới đây mới hẹn đồng bộ.
      //
      // Hẹn theo `item.shopId` — shop của CHÍNH listing vừa publish. Publish 50 listing của
      // cùng một shop vẫn chỉ ra một lịch hẹn (khoá hàng đợi là shopId), và shop khác không
      // bị đụng tới. Nhánh `catch` bên dưới KHÔNG hẹn gì: publish hỏng thì không đồng bộ.
      await this.productSync.scheduleShopSync(item.shopId);
    } catch (error) {
      await this.handleItemFailure({
        organizationId,
        jobId,
        jobType: PodListingJobType.PUBLISH,
        item,
        error,
        maxRetries: params.maxRetries,
        durationMs: Date.now() - startedAt,
        log,
      });
    }
  }

  /**
   * Pipeline **CLONE** của MỘT item: sản phẩm nguồn ⇒ một sản phẩm MỚI trên shop đích.
   *
   * ```
   *   Load Product → Resolve (từ sản phẩm, không template) → Lưu payload → Validate
   *      → Upload ảnh / ảnh mô tả / bảng size / video cho shop đích
   *      → Create Product (save_mode = LISTING) → PUBLISHED · UNDER_REVIEW → hẹn đồng bộ shop đích
   * ```
   *
   * 🔴 Ba chốt NGAY TRONG pipeline (ngoài các chốt lúc tạo job):
   *   - `findSkipReason` chạy lại: shop đích đã có sản phẩm này (do lượt khác vừa xong) ⇒ SKIPPED
   *     (chống trùng — lý do cuối cùng).
   *   - `findInProgress` — item của lượt KHÁC đang chạy cho đúng cặp (sản phẩm, shop) ⇒ lỗi
   *     tạm thời `PodCloneInProgressException` ⇒ RETRYING, chờ `POD_PRODUCT_CLONE_WAIT_MS` rồi
   *     thử lại; hết số lần chờ mới FAILED kèm lượt đang chặn. **Loại chính item này ra** khỏi
   *     query — hàng đợi đã đánh nó PROCESSING trước khi vào đây, không loại thì nó tự chặn mình.
   *   - payload của cặp (nguồn, đích) đã mang `tiktokProductId` ⇒ SUCCESS, không gọi TikTok —
   *     đó là item mồ côi được bộ quét nhặt lại sau khi Create đã xong.
   *
   * 🔴 Tồn kho 0 KHÔNG chặn: bản sao mang đúng tồn của nguồn; chặn là biến sản phẩm hết hàng
   * thành sản phẩm không nhân bản được. Hạ blocker MISSING_STOCK thành cảnh báo ở đây.
   */
  private async processCloneItem(params: {
    organizationId: string;
    jobId: string;
    userId: string | null;
    item: RunnableItem;
    maxRetries: number;
    shopContexts: Map<string, TiktokShopContext>;
    imageUriCache: Map<string, Promise<string>>;
  }): Promise<void> {
    const { organizationId, jobId, item } = params;
    const startedAt = Date.now();
    const log = this.itemLogger(organizationId, jobId, item.id);

    try {
      if (!item.productId) {
        throw new PodPublishPayloadException('Item nhân bản không có sản phẩm nguồn.');
      }
      const product = await this.cloneResolver.loadSource(organizationId, item.productId);
      if (!product) {
        throw new PodPublishPayloadException('Sản phẩm nguồn không còn tồn tại — đã bị xoá.');
      }
      const shop = await this.prisma.podTiktokShop.findFirst({
        where: { id: item.shopId, organizationId, deletedAt: null },
        select: { id: true, accountId: true, name: true, region: true },
      });
      if (!shop) throw new PodShopContextException('Shop đích đã bị xoá khỏi hệ thống');

      await log(PodListingLogLevel.DEBUG, PodListingStep.LOAD_PRODUCT, 'Nạp sản phẩm nguồn', {
        sourceTiktokProductId: product.tiktokProductId,
        sourceShopId: product.shopId,
        targetShop: shop.name,
      });

      // ---- Chốt 1: đã có trên shop đích (lượt khác vừa xong) — chống trùng, lý do cuối cùng ----
      const skip = await this.cloneResolver.findSkipReason(organizationId, product, shop.id);
      if (skip) {
        await log(PodListingLogLevel.WARN, PodListingStep.VALIDATE, `Bỏ qua: ${skip.message}`, {
          code: skip.code,
        });
        await this.settleItem({
          organizationId,
          jobId,
          itemId: item.id,
          status: PodListingJobItemStatus.SKIPPED,
          error: skip.message,
          errorCode: 'CLONE_SKIPPED',
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      // ---- Chốt 2: lượt KHÁC đang tạo đúng sản phẩm này lên đúng shop này — tạm thời, chờ ----
      const busy = await this.cloneResolver.findInProgress(organizationId, product.id, shop.id, item.id);
      if (busy) throw new PodCloneInProgressException(busy);

      // ---- Resolve từ sản phẩm nguồn (danh mục tra trong cây master toàn cục) ----
      const job = await this.prisma.podListingJob.findUnique({
        where: { id: jobId },
        select: { market: true },
      });
      const category = await this.cloneResolver.resolveCategory(product.tiktokCategoryId);
      const resolved = this.cloneResolver.resolve(
        product,
        shop,
        job?.market ?? (marketOfRegion(product.shop.region) as PodListingMarket),
        category,
      );
      await log(PodListingLogLevel.DEBUG, PodListingStep.MERGE, 'Giải nội dung từ sản phẩm nguồn', {
        category: resolved.payload.category.tiktokCategoryId,
        variants: resolved.payload.variants.length,
        images: resolved.payload.images.length,
        sizeChart: resolved.payload.sizeChart ? 'IMAGE' : 'NONE',
        video: resolved.payload.video ? 'URL' : 'NONE',
        issues: resolved.issues,
      });

      const saved = await this.payloads.saveClone(organizationId, params.userId, {
        productId: product.id,
        shop,
        resolved,
      });
      await this.prisma.podListingJobItem.update({
        where: { id: item.id },
        data: { payloadId: saved.id },
      });

      // ---- Chốt 2: payload đã có sản phẩm trên sàn (item mồ côi) ----
      const existingPayload = await this.prisma.podListingPayload.findUnique({
        where: { id: saved.id },
        select: { tiktokProductId: true, status: true },
      });
      if (existingPayload?.tiktokProductId) {
        await log(
          PodListingLogLevel.WARN,
          PodListingStep.PUBLISH,
          'Cặp (sản phẩm nguồn, shop đích) đã có sản phẩm trên sàn — không gửi lại',
          { remoteProductId: existingPayload.tiktokProductId },
        );
        await this.settleItem({
          organizationId,
          jobId,
          itemId: item.id,
          status: PodListingJobItemStatus.SUCCESS,
          remoteProductId: existingPayload.tiktokProductId,
          error: null,
          errorCode: null,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      // ---- Cổng VALIDATE: lỗi giải + lỗi chặn chung (trừ tồn kho 0) ----
      const validation = this.validator.validate(resolved.payload);
      const blockers = [
        ...resolved.issues
          .filter((issue) => issue.level === 'ERROR')
          .map((issue) => ({ code: issue.code, field: issue.field, message: issue.message })),
        ...validation.blockers.filter(
          (blocker) => blocker.code !== POD_LISTING_BLOCKER_CODES.MISSING_STOCK,
        ),
      ];
      const warnings = [
        ...resolved.issues.filter((issue) => issue.level === 'WARNING'),
        ...validation.warnings,
        ...validation.blockers.filter(
          (blocker) => blocker.code === POD_LISTING_BLOCKER_CODES.MISSING_STOCK,
        ),
      ];
      for (const warning of warnings) {
        await log(PodListingLogLevel.WARN, PodListingStep.VALIDATE, warning.message, {
          code: warning.code,
        });
      }
      if (blockers.length > 0) {
        // Gộp theo mã: một lỗi một dòng, không lặp cùng câu cho từng SKU.
        const unique = new Map<string, string>();
        for (const blocker of blockers) {
          if (!unique.has(blocker.code)) unique.set(blocker.code, blocker.message);
        }
        const message = [...unique.values()].join(' · ');
        await log(
          PodListingLogLevel.ERROR,
          PodListingStep.VALIDATE,
          'Thiếu dữ liệu — không gửi TikTok',
          { blockers },
        );
        await this.prisma.podListingPayload.update({
          where: { id: saved.id },
          data: { status: PodListingPayloadStatus.FAILED, publishError: message.slice(0, 2000) },
        });
        await this.settleItem({
          organizationId,
          jobId,
          itemId: item.id,
          status: PodListingJobItemStatus.FAILED,
          error: message,
          errorCode: blockers[0]?.code ?? null,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      await log(PodListingLogLevel.INFO, PodListingStep.VALIDATE, 'Dữ liệu hợp lệ — được phép gửi');

      // ---- Gửi lên TikTok: Create Product ở chế độ LISTING cho shop đích ----
      let ctx = params.shopContexts.get(item.shopId);
      if (!ctx) {
        ctx = await this.publisher.shopContext(organizationId, item.shopId);
        params.shopContexts.set(item.shopId, ctx);
      }

      const outcome = await this.publisher.publishListing({
        organizationId,
        ctx,
        payload: resolved.payload,
        tiktokDraftId: null,
        imageUriCache: params.imageUriCache,
        log,
      });

      // ---- Ghi kết quả ----
      const publishedAt = new Date();
      const reviewStatus =
        mapReviewStatus(undefined, outcome.auditStatus) ?? PodListingReviewStatus.UNDER_REVIEW;
      await this.prisma.$transaction(async (tx) => {
        await tx.podListingPayload.update({
          where: { id: saved.id },
          data: {
            status: PodListingPayloadStatus.PUBLISHED,
            tiktokProductId: outcome.remoteProductId,
            tiktokDraftId: outcome.remoteProductId,
            publishedAt,
            publishError: null,
            publishRetryCount: item.retryCount,
            publishRequest: toJson(outcome.request as unknown as Record<string, unknown>),
            publishResponse: toJson({
              ...outcome.response,
              mode: outcome.mode,
              tiktokRequestId: outcome.tiktokRequestId,
            }),
            reviewStatus,
            reviewStatusRaw: null,
            reviewReason: null,
            reviewCheckedAt: null,
          },
        });
        for (const sku of outcome.skuIds) {
          await tx.podListingPayloadItem.updateMany({
            where: { payloadId: saved.id, sellerSku: sku.sellerSku },
            data: { tiktokSkuId: sku.tiktokSkuId },
          });
        }
      });

      await this.settleItem({
        organizationId,
        jobId,
        itemId: item.id,
        status: PodListingJobItemStatus.SUCCESS,
        remoteProductId: outcome.remoteProductId,
        error: null,
        errorCode: null,
        durationMs: Date.now() - startedAt,
      });

      // Sản phẩm mới sẽ về màn hình Products của shop đích sau lượt đồng bộ được hẹn.
      await this.productSync.scheduleShopSync(item.shopId);
    } catch (error) {
      await this.handleItemFailure({
        organizationId,
        jobId,
        jobType: PodListingJobType.CLONE,
        item,
        error,
        maxRetries: params.maxRetries,
        durationMs: Date.now() - startedAt,
        log,
      });
    }
  }

  /**
   * Pipeline **CREATE_DRAFT** / **LIVE_LISTING** của MỘT item — đây là chỗ mọi thứ thực sự xảy ra.
   *
   * Load Product → Load Template → Merge → Validate → Upload Images → Create Draft → Save ID.
   * Mỗi bước ghi một dòng log gắn với item, nên khi 3/500 sản phẩm hỏng thì mở đúng ba dòng
   * đó ra đọc, không phải mò trong log ứng dụng.
   *
   * 🔴 `live = true` (Publish Live TikTok): y hệt tới bước Upload Images, rồi gửi Create Product
   * `save_mode = LISTING` — không dừng ở Draft trên sàn. Bản ghi `pod_listing_payloads` vẫn được
   * ghi (đó là Product Mapping: Draft Product ↔ shop ↔ TikTok Product ID) nhưng đi thẳng
   * `PUBLISHED`, không sinh một Draft Listing chờ publish. Chống trùng: (Draft Product, shop) đã
   * PUBLISHED ⇒ SUCCESS không gọi TikTok; đã có Draft trên sàn ⇒ Edit Product LISTING đúng draft
   * đó (không tạo sản phẩm thứ hai).
   */
  private async processCreateDraftItem(params: {
    organizationId: string;
    jobId: string;
    /** Người tạo job — draft sinh ra ghi đúng người chịu trách nhiệm. */
    userId: string | null;
    item: RunnableItem;
    template: ListingTemplateFull;
    imageTemplateId: string | null;
    maxRetries: number;
    shopContexts: Map<string, TiktokShopContext>;
    /** Chứa Promise để năm luồng không cùng upload một tấm ảnh (xem publisher). */
    imageUriCache: Map<string, Promise<string>>;
    /** Publish Live TikTok (`save_mode = LISTING`) thay vì Draft (`AS_DRAFT`). */
    live?: boolean;
  }): Promise<void> {
    const { organizationId, jobId, item } = params;
    const live = params.live === true;
    const startedAt = Date.now();
    const log = this.itemLogger(organizationId, jobId, item.id);

    try {
      const shop = await this.prisma.podTiktokShop.findFirst({
        where: { id: item.shopId, organizationId, deletedAt: null },
        select: { id: true, accountId: true, name: true },
      });
      if (!shop) throw new PodShopContextException('Shop đã bị xoá khỏi hệ thống');

      // ---- Publish Live: chốt chống trùng ĐỌC TRƯỚC khi sinh lại payload (persist ghi đè status) ----
      const priorMapping =
        live && item.sessionProductId
          ? await this.prisma.podListingPayload.findFirst({
              where: { organizationId, shopId: item.shopId, sessionProductId: item.sessionProductId, deletedAt: null },
              select: { id: true, status: true, tiktokProductId: true, tiktokDraftId: true },
            })
          : null;
      if (priorMapping?.status === PodListingPayloadStatus.PUBLISHED && priorMapping.tiktokProductId) {
        await log(
          PodListingLogLevel.INFO,
          PodListingStep.PUBLISH,
          `Đã publish lên shop này trước đó (TikTok Product ID ${priorMapping.tiktokProductId}) — không tạo lại`,
          { payloadId: priorMapping.id, tiktokProductId: priorMapping.tiktokProductId },
        );
        await this.prisma.podListingJobItem.update({ where: { id: item.id }, data: { payloadId: priorMapping.id } });
        await this.settleItem({
          organizationId,
          jobId,
          itemId: item.id,
          status: PodListingJobItemStatus.SUCCESS,
          remoteProductId: priorMapping.tiktokProductId,
          error: null,
          errorCode: null,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      await log(PodListingLogLevel.DEBUG, PodListingStep.MERGE, 'Ghép Product với Template');

      // Merge: dùng đúng đường code của Payload Generator ⇒ nội dung gửi lên TikTok bằng
      // đúng nội dung màn hình Preview đã cho xem. Nguồn là sản phẩm đã đồng bộ HOẶC Draft
      // Product của session — từ đây trở đi hai đường đi chung một mạch.
      const payload = await this.payloads.generateOne(organizationId, params.userId, {
        productId: item.productId,
        sessionProductId: item.sessionProductId,
        shop,
        template: params.template,
        imageTemplateId: params.imageTemplateId,
      });

      await this.prisma.podListingJobItem.update({
        where: { id: item.id },
        data: { payloadId: payload.id },
      });

      // ---- Cổng VALIDATE: thiếu dữ liệu ⇒ KHÔNG gửi request nào lên TikTok ----
      const validation = this.validator.validate(payload.resolved.payload);
      for (const warning of validation.warnings) {
        await log(PodListingLogLevel.WARN, PodListingStep.VALIDATE, warning.message, {
          code: warning.code,
        });
      }
      if (!validation.ok) {
        const message = validation.blockers.map((blocker) => blocker.message).join(' · ');
        await log(
          PodListingLogLevel.ERROR,
          PodListingStep.VALIDATE,
          'Thiếu dữ liệu — không gửi TikTok',
          {
            blockers: validation.blockers,
          },
        );
        await this.settleItem({
          organizationId,
          jobId,
          itemId: item.id,
          status: PodListingJobItemStatus.SKIPPED,
          error: message,
          errorCode: validation.blockers[0]?.code ?? null,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      await log(PodListingLogLevel.INFO, PodListingStep.VALIDATE, 'Dữ liệu hợp lệ — được phép gửi');

      // ---- Gửi lên TikTok ----
      let ctx = params.shopContexts.get(item.shopId);
      if (!ctx) {
        ctx = await this.publisher.shopContext(organizationId, item.shopId);
        params.shopContexts.set(item.shopId, ctx);
      }

      if (live) {
        // Draft đã có trên sàn từ lượt Start Listing trước ⇒ Edit Product LISTING đúng draft đó.
        const tiktokDraftId = priorMapping?.tiktokDraftId ?? priorMapping?.tiktokProductId ?? null;
        const outcome = await this.publisher.publishListing({
          organizationId,
          ctx,
          payload: payload.resolved.payload,
          tiktokDraftId,
          imageUriCache: params.imageUriCache,
          log,
        });
        await this.recordLiveListing({ organizationId, payloadId: payload.id, item, outcome });
        await this.settleItem({
          organizationId,
          jobId,
          itemId: item.id,
          status: PodListingJobItemStatus.SUCCESS,
          remoteProductId: outcome.remoteProductId,
          error: null,
          errorCode: null,
          durationMs: Date.now() - startedAt,
        });
        // Sản phẩm mới về màn hình Products của shop sau lượt đồng bộ được hẹn.
        await this.productSync.scheduleShopSync(item.shopId);
        return;
      }

      const outcome = await this.publisher.publishDraft({
        organizationId,
        ctx,
        payload: payload.resolved.payload,
        imageUriCache: params.imageUriCache,
        log,
      });

      // ---- Ghi kết quả ----
      const uploadedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.podListingPayload.update({
          where: { id: payload.id },
          data: {
            status: PodListingPayloadStatus.TIKTOK_DRAFT,
            tiktokProductId: outcome.remoteProductId,
            publishedAt: uploadedAt,
            publishError: null,
          },
        });

        // `sku_id` của TikTok khớp theo `seller_sku` — sprint sau sửa giá/tồn cần đúng id này.
        for (const sku of outcome.skuIds) {
          await tx.podListingPayloadItem.updateMany({
            where: { payloadId: payload.id, sellerSku: sku.sellerSku },
            data: { tiktokSkuId: sku.tiktokSkuId },
          });
        }

        // Draft Product đổi trạng thái sang UPLOADED — đây là thứ người vận hành nhìn thấy
        // trên màn hình session. `remote_product_id` KHÔNG ghi vào đây: một sản phẩm đăng
        // lên N shop có N id, và chúng nằm ở chính `pod_listing_job_items`.
        if (item.sessionProductId) {
          await tx.podListingSessionProduct.update({
            where: { id: item.sessionProductId },
            data: {
              status: PodListingSessionProductStatus.UPLOADED,
              uploadedAt,
              uploadError: null,
            },
          });
        }
      });

      await this.settleItem({
        organizationId,
        jobId,
        itemId: item.id,
        status: PodListingJobItemStatus.SUCCESS,
        remoteProductId: outcome.remoteProductId,
        error: null,
        errorCode: null,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await this.handleItemFailure({
        organizationId,
        jobId,
        jobType: live ? PodListingJobType.LIVE_LISTING : PodListingJobType.CREATE_DRAFT,
        item,
        error,
        maxRetries: params.maxRetries,
        durationMs: Date.now() - startedAt,
        log,
      });
    }
  }

  /**
   * Ghi kết quả **Publish Live** của một Draft Product: payload đi thẳng PUBLISHED (Product Mapping
   * mang TikTok Product ID, request/response đã gửi, trạng thái duyệt), SKU id theo seller_sku,
   * Draft Product của session ⇒ PUBLISHED. Cùng khuôn với lượt nhân bản.
   */
  private async recordLiveListing(params: {
    organizationId: string;
    payloadId: string;
    item: RunnableItem;
    outcome: Awaited<ReturnType<PodListingPublisherService['publishListing']>>;
  }): Promise<void> {
    const { item, outcome } = params;
    const publishedAt = new Date();
    const reviewStatus =
      mapReviewStatus(undefined, outcome.auditStatus) ?? PodListingReviewStatus.UNDER_REVIEW;
    await this.prisma.$transaction(async (tx) => {
      await tx.podListingPayload.update({
        where: { id: params.payloadId },
        data: {
          status: PodListingPayloadStatus.PUBLISHED,
          tiktokProductId: outcome.remoteProductId,
          tiktokDraftId: outcome.remoteProductId,
          publishedAt,
          publishError: null,
          publishRetryCount: item.retryCount,
          publishRequest: toJson(outcome.request as unknown as Record<string, unknown>),
          publishResponse: toJson({
            ...outcome.response,
            mode: outcome.mode,
            tiktokRequestId: outcome.tiktokRequestId,
          }),
          reviewStatus,
          reviewStatusRaw: null,
          reviewReason: null,
          reviewCheckedAt: null,
        },
      });
      for (const sku of outcome.skuIds) {
        await tx.podListingPayloadItem.updateMany({
          where: { payloadId: params.payloadId, sellerSku: sku.sellerSku },
          data: { tiktokSkuId: sku.tiktokSkuId },
        });
      }
      if (item.sessionProductId) {
        await tx.podListingSessionProduct.update({
          where: { id: item.sessionProductId },
          data: {
            status: PodListingSessionProductStatus.PUBLISHED,
            uploadedAt: publishedAt,
            publishedAt,
            uploadError: null,
          },
        });
      }
    });
  }

  /**
   * Một item thất bại: thử lại hay bỏ cuộc?
   *
   * 🔴 Chỉ **lỗi tạm thời** mới đáng thử lại (mạng đứt, 429, 5xx, token hết hạn). Lỗi nội
   * dung — tiêu đề quá dài, danh mục sai, thuộc tính không hợp lệ — thử lại 3 lần vẫn sai y
   * hệt, chỉ tốn quota và làm người dùng chờ. Sửa dữ liệu rồi bấm Retry mới là cách đúng.
   */
  private async handleItemFailure(params: {
    organizationId: string;
    jobId: string;
    jobType: PodListingJobType;
    item: RunnableItem;
    error: unknown;
    maxRetries: number;
    durationMs: number;
    log: ListingLogger;
  }): Promise<void> {
    const { organizationId, jobId, item, error } = params;
    const publishing = params.jobType === PodListingJobType.PUBLISH;
    // Ảnh upload hỏng: lỗi gốc TikTok nằm ở `cause` — quyết định thử lại theo mã đó, nhưng câu
    // hiển thị là câu đã có ngữ cảnh ("Không tải được ảnh biến thể Color=Black lên TikTok: …").
    const uploadError = error instanceof PodImageUploadException ? error : null;
    const tiktokError =
      error instanceof TiktokClientError
        ? error
        : uploadError?.cause instanceof TiktokClientError
          ? uploadError.cause
          : null;
    const rawMessage = error instanceof Error ? error.message : 'Lỗi không xác định';
    // Cột `error` của item là thứ hiện trên màn hình ⇒ dịch lỗi TikTok đã biết sang câu chỉ rõ
    // phải sửa gì. Câu gốc vẫn ghi vào log ngay dưới (`message`) để truy vết.
    const message =
      uploadError?.message ??
      (tiktokError ? humanizeTiktokListingError(tiktokError.tiktokCode, rawMessage) : null) ??
      rawMessage;
    const inProgress = error instanceof PodCloneInProgressException ? error : null;
    const errorCode = tiktokError ? String(tiktokError.tiktokCode) : (inProgress?.code ?? null);

    const permanent =
      error instanceof PodShopContextException ||
      // Vi phạm luật danh mục (vd bắt buộc bảng size): sửa cấu hình rồi chạy lại, thử lại vô ích.
      error instanceof PodCategoryRuleException ||
      // Thiếu cấu hình kho là lỗi CẤU HÌNH: thử lại vẫn thiếu y hệt, chỉ tốn quota và làm
      // người dùng chờ. Hỏng ngay, và chỉ hỏng đúng item của shop đó.
      error instanceof PodWarehouseResolutionException ||
      // Payload hỏng/mất: thử lại 3 lần vẫn không có gì để gửi.
      error instanceof PodPublishPayloadException ||
      (tiktokError !== null && !RETRYABLE_ERROR_CLASSES.includes(tiktokError.errorClass));
    const retryCount = item.retryCount + 1;
    const canRetry = !permanent && retryCount <= params.maxRetries;

    await params.log(
      PodListingLogLevel.ERROR,
      canRetry
        ? PodListingStep.RETRY
        : params.jobType === PodListingJobType.CREATE_DRAFT
          ? PodListingStep.CREATE_DRAFT
          : PodListingStep.PUBLISH,
      canRetry ? `Lỗi — sẽ thử lại lần ${retryCount}/${params.maxRetries}` : `Thất bại: ${message}`,
      {
        message: rawMessage,
        tiktokCode: tiktokError?.tiktokCode,
        tiktokRequestId: tiktokError?.requestId,
        errorClass: tiktokError?.errorClass ?? TiktokErrorClass.NETWORK,
        ...(uploadError ? { imageType: uploadError.imageUseCase, imageLabel: uploadError.imageLabel } : {}),
        ...(inProgress
          ? {
              blockingJobId: inProgress.blocking.jobId,
              blockingItemId: inProgress.blocking.itemId,
              blockingStartedAt: inProgress.blocking.startedAt?.toISOString() ?? null,
            }
          : {}),
      },
    );

    if (canRetry) {
      // Chờ lượt khác xong là chờ theo NHỊP của lượt đó (upload ảnh + Create ≈ vài chục giây),
      // không phải backoff lỗi mạng 2s/4s/8s — nếu không thì luôn hết lượt chờ trước khi kịp.
      const delayMs = inProgress
        ? POD_PRODUCT_CLONE_WAIT_MS
        : computeRetryDelayMs(
            retryCount,
            POD_LISTING_RETRY_BASE_DELAY_MS,
            POD_LISTING_RETRY_MAX_DELAY_MS,
          );
      await this.prisma.podListingJobItem.update({
        where: { id: item.id },
        data: {
          status: PodListingJobItemStatus.RETRYING,
          retryCount,
          nextAttemptAt: new Date(Date.now() + delayMs),
          error: message.slice(0, 2000),
          errorCode,
          durationMs: params.durationMs,
        },
      });
      return;
    }

    await this.settleItem({
      organizationId,
      jobId,
      itemId: item.id,
      status: PodListingJobItemStatus.FAILED,
      error: message,
      errorCode,
      retryCount: permanent ? item.retryCount : retryCount - 1,
      durationMs: params.durationMs,
    });

    if (publishing) {
      // 🔴 Publish hỏng KHÔNG làm hỏng Draft: bản Draft trên TikTok vẫn còn nguyên và vẫn
      // publish lại được. Đánh dấu FAILED ở đây là biến một lần gửi trượt thành "phải sinh
      // lại Draft" — mà sinh lại Draft chính là con đường tạo ra sản phẩm trùng trên shop.
      // Trả về đúng trạng thái trước lượt chạy, chỉ ghi lại lý do trượt.
      const draft = await this.prisma.podListingPayload.findFirst({
        where: { jobItems: { some: { id: item.id } } },
        select: { id: true, tiktokDraftId: true, publishRetryCount: true },
      });
      if (draft) {
        await this.prisma.podListingPayload.update({
          where: { id: draft.id },
          data: {
            status: draft.tiktokDraftId
              ? PodListingPayloadStatus.TIKTOK_DRAFT
              : PodListingPayloadStatus.READY,
            publishError: message.slice(0, 2000),
            publishRetryCount: draft.publishRetryCount + item.retryCount + 1,
          },
        });
      }
      return;
    }

    // Payload mang dấu vết thất bại để đối chiếu "đã gửi gì mà hỏng".
    await this.prisma.podListingPayload.updateMany({
      where: { jobItems: { some: { id: item.id } } },
      data: { status: PodListingPayloadStatus.FAILED, publishError: message.slice(0, 2000) },
    });

    // Draft Product cũng phải đỏ lên: màn hình session là nơi người vận hành sửa rồi chạy
    // lại. Lỗi chỉ nằm trong log của job thì không ai thấy.
    if (item.sessionProductId) {
      await this.prisma.podListingSessionProduct.updateMany({
        where: { id: item.sessionProductId },
        data: {
          status: PodListingSessionProductStatus.FAILED,
          uploadError: message.slice(0, 2000),
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Đọc dữ liệu cho màn hình
  // ---------------------------------------------------------------------------

  async list(organizationId: string, query: PodListingJobQueryDto, scope: PodAccessScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PodListingJobWhereInput = {
      organizationId,
      deletedAt: null,
      // 🔴 `PodListingJob` không mang `shop_id` — một lượt chạy có thể trải nhiều shop, shop
      // nằm ở từng item. Nên phạm vi phải hỏi qua quan hệ `items`, không lọc được bằng cột.
      ...(scope.allShops ? {} : { items: { some: { shopId: { in: scope.shopIds } } } }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.market ? { market: query.market } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podListingJob.findMany({
        where,
        include: {
          listingTemplate: { select: { id: true, name: true } },
          imageTemplate: { select: { id: true, name: true } },
        },
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podListingJob.count({ where }),
    ]);

    const shopsByJob = await this.shopsOfJobs(items.map((job) => job.id));

    return {
      items: items.map((job) => ({ ...job, shops: shopsByJob.get(job.id) ?? [] })),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /**
   * Shop nào có mặt trong từng lượt chạy — cột "Shop" của Publish History.
   *
   * 🔴 Một truy vấn cho CẢ TRANG, không phải một truy vấn cho mỗi dòng: trang 20 job × N item
   * là chỗ kinh điển để sinh ra N+1 query mà không ai để ý cho tới lúc bảng đủ lớn.
   */
  private async shopsOfJobs(
    jobIds: string[],
  ): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const result = new Map<string, Array<{ id: string; name: string }>>();
    if (jobIds.length === 0) return result;

    const rows = await this.prisma.podListingJobItem.findMany({
      where: { jobId: { in: jobIds } },
      distinct: ['jobId', 'shopId'],
      select: { jobId: true, shop: { select: { id: true, name: true } } },
    });

    for (const row of rows) {
      const list = result.get(row.jobId) ?? [];
      list.push(row.shop);
      result.set(row.jobId, list);
    }
    return result;
  }

  /**
   * Nạp một lượt chạy, ĐÃ kiểm phạm vi shop.
   *
   * 🔴 Cửa vào duy nhất cho `listItems` / `listLogs` / màn hình chi tiết. Kiểm ở đây thay vì
   * rải ra từng method — mỗi method là một cơ hội quên.
   */
  async get(organizationId: string, id: string, scope: PodAccessScope) {
    const job = await this.prisma.podListingJob.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        listingTemplate: { select: { id: true, name: true, market: true } },
        imageTemplate: { select: { id: true, name: true } },
        session: { select: { id: true, name: true, status: true } },
      },
    });
    if (!job) throw new PodListingJobNotFoundException();
    await this.assertJobInScope(organizationId, job.id, scope);

    // Đếm theo trạng thái để màn hình vẽ thanh tiến độ mà không phải tải hết item về.
    const grouped = await this.prisma.podListingJobItem.groupBy({
      by: ['status'],
      where: { jobId: id },
      _count: { _all: true },
    });

    return {
      ...job,
      shops: (await this.shopsOfJobs([id])).get(id) ?? [],
      counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])) as Record<
        PodListingJobItemStatus,
        number | undefined
      >,
    };
  }

  async listItems(
    organizationId: string,
    jobId: string,
    query: PodListingJobItemQueryDto,
    scope: PodAccessScope,
  ) {
    await this.get(organizationId, jobId, scope);

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.PodListingJobItemWhereInput = {
      jobId,
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.shopId ? { shopId: query.shopId } : {}),
      // Tìm theo tiêu đề ở CẢ HAI nguồn: item của lượt chạy từ session không có `product`.
      ...(query.search
        ? {
            OR: [
              { product: { title: { contains: query.search, mode: 'insensitive' as const } } },
              {
                sessionProduct: { title: { contains: query.search, mode: 'insensitive' as const } },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podListingJobItem.findMany({
        where,
        include: {
          product: { select: { id: true, title: true, tiktokProductId: true } },
          shop: { select: { id: true, name: true } },
          listingTemplate: { select: { id: true, name: true } },
          payload: {
            select: {
              id: true,
              title: true,
              variantCount: true,
              status: true,
              tiktokDraftId: true,
              tiktokProductId: true,
              reviewStatus: true,
              reviewReason: true,
              publishedAt: true,
              publishResponse: true,
            },
          },
          sessionProduct: { select: { id: true, title: true, status: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podListingJobItem.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async listLogs(
    organizationId: string,
    jobId: string,
    query: PodListingLogQueryDto,
    scope: PodAccessScope,
  ) {
    await this.get(organizationId, jobId, scope);

    const page = query.page ?? 1;
    const limit = query.limit ?? 100;
    const where: Prisma.PodListingLogWhereInput = {
      jobId,
      organizationId,
      ...(query.itemId ? { listingItemId: query.itemId } : {}),
      ...(query.level ? { level: query.level } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podListingLog.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podListingLog.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  // ---------------------------------------------------------------------------
  // Hành động trên job
  // ---------------------------------------------------------------------------

  /** Chạy lại các item hỏng (mặc định: toàn bộ FAILED + SKIPPED). */
  async retry(
    organizationId: string,
    userId: string,
    jobId: string,
    dto: RetryListingJobDto,
    scope: PodAccessScope,
  ) {
    const job = await this.get(organizationId, jobId, scope);
    if (this.running.has(jobId)) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_RUNNING',
        message: 'Lượt chạy đang chạy — chờ xong rồi thử lại.',
      });
    }

    const where: Prisma.PodListingJobItemWhereInput = {
      jobId,
      organizationId,
      ...(dto?.itemIds?.length
        ? { id: { in: dto.itemIds } }
        : {
            status: {
              in: [
                PodListingJobItemStatus.FAILED,
                PodListingJobItemStatus.SKIPPED,
                PodListingJobItemStatus.CANCELLED,
              ],
            },
          }),
    };

    const reset = await this.prisma.podListingJobItem.updateMany({
      where,
      data: {
        status: PodListingJobItemStatus.PENDING,
        // Đặt lại bộ đếm: người dùng đã sửa dữ liệu, đây là một lượt thử mới chứ không
        // phải phần đuôi của lượt cũ.
        retryCount: 0,
        nextAttemptAt: null,
        error: null,
        errorCode: null,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
      },
    });

    if (reset.count === 0) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_NOTHING_TO_RETRY',
        message: 'Không có item nào cần chạy lại.',
      });
    }

    await this.prisma.podListingJob.update({
      where: { id: jobId },
      data: {
        // Số thất bại được trừ đi đúng bằng số item vừa mở lại — không đếm lại toàn bảng.
        failedItems: Math.max(0, job.failedItems - reset.count),
        status: PodListingJobStatus.PENDING,
        lastError: null,
        updatedBy: userId,
      },
    });

    // Lượt PUBLISH: khoá lại đúng những Draft sắp gửi. Không khoá thì một lượt publish khác
    // vẫn thấy chúng "đủ điều kiện" và cùng gửi một Draft hai lần.
    if (job.type === PodListingJobType.PUBLISH) {
      await this.prisma.podListingPayload.updateMany({
        where: {
          jobItems: { some: { jobId, status: PodListingJobItemStatus.PENDING } },
          status: { in: [...POD_PUBLISHABLE_PAYLOAD_STATUSES] },
        },
        data: { status: PodListingPayloadStatus.PUBLISHING, publishError: null },
      });
    }

    await this.prisma.podListingLog.create({
      data: {
        organizationId,
        jobId,
        level: PodListingLogLevel.INFO,
        step: PodListingStep.RETRY,
        message: `Chạy lại ${reset.count} item`,
      },
    });

    this.runInBackground(organizationId, jobId);
    return this.get(organizationId, jobId, scope);
  }

  /** Huỷ: item chưa chạy chuyển CANCELLED; item đang chạy vẫn chạy nốt (đã gửi TikTok rồi). */
  async cancel(organizationId: string, userId: string, jobId: string, scope: PodAccessScope) {
    const current = await this.get(organizationId, jobId, scope);

    const cancelled = await this.prisma.podListingJobItem.updateMany({
      where: {
        jobId,
        organizationId,
        status: { in: [PodListingJobItemStatus.PENDING, PodListingJobItemStatus.RETRYING] },
      },
      data: { status: PodListingJobItemStatus.CANCELLED, nextAttemptAt: null },
    });

    await this.prisma.podListingJob.update({
      where: { id: jobId },
      data: {
        status: PodListingJobStatus.CANCELLED,
        finishedAt: new Date(),
        updatedBy: userId,
      },
    });

    await this.prisma.podListingLog.create({
      data: {
        organizationId,
        jobId,
        level: PodListingLogLevel.WARN,
        step: PodListingStep.CANCEL,
        message: `Người dùng huỷ lượt chạy — ${cancelled.count} item chưa chạy bị bỏ`,
      },
    });

    // 🔴 Huỷ lượt PUBLISH phải MỞ KHOÁ những Draft chưa kịp gửi: chúng đang bị giữ ở
    // PUBLISHING, mà PUBLISHING không nằm trong danh sách được phép publish. Quên bước này
    // là Draft kẹt vĩnh viễn — nút Publish bấm bao nhiêu lần cũng bảo "không đủ điều kiện".
    if (current.type === PodListingJobType.PUBLISH) {
      const stuck = await this.prisma.podListingPayload.findMany({
        where: {
          organizationId,
          status: PodListingPayloadStatus.PUBLISHING,
          jobItems: { some: { jobId, status: PodListingJobItemStatus.CANCELLED } },
        },
        select: { id: true, tiktokDraftId: true },
      });
      for (const draft of stuck) {
        await this.prisma.podListingPayload.update({
          where: { id: draft.id },
          data: {
            status: draft.tiktokDraftId
              ? PodListingPayloadStatus.TIKTOK_DRAFT
              : PodListingPayloadStatus.READY,
          },
        });
      }
    }

    // Session phải theo kịp: vòng chạy có thể đã kết thúc từ trước nên `finalize()` sẽ không
    // chạy nữa, và một session kẹt ở LISTING vĩnh viễn thì không Start Listing lại được.
    if (current.sessionId) {
      await this.finalizeSession(
        current.sessionId,
        jobId,
        PodListingJobStatus.CANCELLED,
        new Date(),
      );
    }

    return this.get(organizationId, jobId, scope);
  }

  /** Xoá mềm một lượt chạy (không đụng tới sản phẩm đã tạo trên TikTok). */
  async remove(
    organizationId: string,
    userId: string,
    jobId: string,
    scope: PodAccessScope,
  ): Promise<void> {
    const job = await this.get(organizationId, jobId, scope);
    if (job.status === PodListingJobStatus.PROCESSING) {
      throw new BadRequestException({
        code: 'POD_LISTING_JOB_RUNNING',
        message: 'Lượt chạy đang chạy — huỷ trước khi xoá.',
      });
    }

    await this.prisma.podListingJob.update({
      where: { id: jobId },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
  }

  /**
   * Publish History — lịch sử từng listing đã đẩy lên TikTok.
   *
   * Đọc thẳng từ `pod_listing_job_items`: mỗi dòng là một lần thử thật, có thời lượng, có
   * mã lỗi, có `remote_product_id`. Đây mới là "lịch sử", khác với danh sách draft (trạng
   * thái HIỆN TẠI của từng listing).
   */
  async history(
    organizationId: string,
    query: {
      page?: number;
      limit?: number;
      status?: PodListingJobItemStatus;
      shopId?: string;
      type?: PodListingJobType;
    },
    scope: PodAccessScope,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PodListingJobItemWhereInput = {
      organizationId,
      job: { deletedAt: null, ...(query.type ? { type: query.type } : {}) },
      finishedAt: { not: null },
      ...(query.status ? { status: query.status } : {}),
      // 🔴 GIAO của phạm vi và bộ lọc màn hình — không phải phép gán rồi ghi đè.
      shopId: shopScopeFilter(this.accessScope.shopFilter(scope)?.in, query.shopId),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podListingJobItem.findMany({
        where,
        include: {
          job: { select: { id: true, name: true, market: true, sessionId: true, type: true } },
          product: { select: { id: true, title: true } },
          shop: { select: { id: true, name: true } },
          sessionProduct: { select: { id: true, title: true } },
          // Publish History phải mở được "đã gửi gì / TikTok trả gì" mà không cần một
          // endpoint thứ hai: cả hai nằm sẵn trên payload của chính item.
          payload: {
            select: {
              id: true,
              title: true,
              status: true,
              tiktokDraftId: true,
              tiktokProductId: true,
              reviewStatus: true,
              reviewReason: true,
              publishedAt: true,
              publishRequest: true,
              publishResponse: true,
            },
          },
        },
        orderBy: { finishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podListingJobItem.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /**
   * Một lượt chạy chỉ được xem khi MỌI item của nó thuộc shop trong phạm vi.
   *
   * 🔴 Không dùng "có ít nhất một item hợp lệ": một lượt chạy trộn shop của nhiều người thì
   * mở nó ra là đọc được cả tên sản phẩm, mã lỗi và remote id của shop người khác. Danh sách
   * (`list`) dùng `some` vì ở đó chỉ hiện tên lượt chạy; chi tiết thì phải chặt hơn.
   */
  private async assertJobInScope(
    organizationId: string,
    jobId: string,
    scope: PodAccessScope,
  ): Promise<void> {
    if (scope.allShops) return;
    const outside = await this.prisma.podListingJobItem.findFirst({
      where: { organizationId, jobId, shopId: { notIn: scope.shopIds } },
      select: { id: true },
    });
    if (outside) throw new PodShopForbiddenException();
  }

  // ---------------------------------------------------------------------------
  // Private — vận hành hàng đợi
  // ---------------------------------------------------------------------------

  /**
   * Nhận một lô item tới lượt chạy và đánh dấu PROCESSING **trong cùng một transaction**.
   *
   * Đánh dấu ngay thay vì để PENDING là điều kiện để bộ quét không nhặt trùng item mà vòng
   * chạy hiện tại đang xử lý.
   */
  private async claimReadyItems(jobId: string, batchSize: number): Promise<RunnableItem[]> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const candidates = await tx.podListingJobItem.findMany({
        where: {
          jobId,
          OR: [
            { status: PodListingJobItemStatus.PENDING },
            {
              status: PodListingJobItemStatus.RETRYING,
              nextAttemptAt: { lte: now },
            },
          ],
        },
        select: {
          id: true,
          productId: true,
          sessionProductId: true,
          shopId: true,
          retryCount: true,
          payloadId: true,
        },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });

      if (candidates.length === 0) return [];

      await tx.podListingJobItem.updateMany({
        where: { id: { in: candidates.map((item) => item.id) } },
        data: { status: PodListingJobItemStatus.PROCESSING, startedAt: now },
      });

      return candidates;
    });
  }

  /** Còn bao nhiêu ms tới item chờ backoff gần nhất; `null` khi không còn gì để chạy. */
  private async msUntilNextAttempt(jobId: string): Promise<number | null> {
    const next = await this.prisma.podListingJobItem.findFirst({
      where: { jobId, status: PodListingJobItemStatus.RETRYING, nextAttemptAt: { not: null } },
      orderBy: { nextAttemptAt: 'asc' },
      select: { nextAttemptAt: true },
    });
    if (!next?.nextAttemptAt) return null;
    return Math.max(0, next.nextAttemptAt.getTime() - Date.now());
  }

  /** Đóng sổ một item + cập nhật bộ đếm của job trong cùng một transaction. */
  private async settleItem(params: {
    organizationId: string;
    jobId: string;
    itemId: string;
    status: PodListingJobItemStatus;
    error: string | null;
    errorCode: string | null;
    remoteProductId?: string;
    retryCount?: number;
    durationMs: number;
  }): Promise<void> {
    const success = params.status === PodListingJobItemStatus.SUCCESS;

    await this.prisma.$transaction([
      this.prisma.podListingJobItem.update({
        where: { id: params.itemId },
        data: {
          status: params.status,
          error: params.error?.slice(0, 2000) ?? null,
          errorCode: params.errorCode,
          remoteProductId: params.remoteProductId,
          ...(params.retryCount !== undefined ? { retryCount: params.retryCount } : {}),
          nextAttemptAt: null,
          finishedAt: new Date(),
          durationMs: params.durationMs,
        },
      }),
      this.prisma.podListingJob.update({
        where: { id: params.jobId },
        data: success ? { successItems: { increment: 1 } } : { failedItems: { increment: 1 } },
      }),
    ]);
  }

  /** Chốt trạng thái cuối của job dựa trên kết quả thật của item. */
  private async finalize(organizationId: string, jobId: string): Promise<void> {
    const grouped = await this.prisma.podListingJobItem.groupBy({
      by: ['status'],
      where: { jobId },
      _count: { _all: true },
    });
    const count = (status: PodListingJobItemStatus): number =>
      grouped.find((row) => row.status === status)?._count._all ?? 0;

    const success = count(PodListingJobItemStatus.SUCCESS);
    const failed = count(PodListingJobItemStatus.FAILED) + count(PodListingJobItemStatus.SKIPPED);
    const cancelled = count(PodListingJobItemStatus.CANCELLED);

    const status =
      failed === 0 && cancelled === 0
        ? PodListingJobStatus.COMPLETED
        : success > 0
          ? PodListingJobStatus.COMPLETED_WITH_ERRORS
          : cancelled > 0 && failed === 0
            ? PodListingJobStatus.CANCELLED
            : PodListingJobStatus.FAILED;

    const job = await this.prisma.podListingJob.findUnique({
      where: { id: jobId },
      select: { startedAt: true, sessionId: true, type: true },
    });
    const finishedAt = new Date();

    await this.prisma.podListingJob.updateMany({
      where: { id: jobId },
      data: {
        status,
        successItems: success,
        failedItems: failed,
        finishedAt,
        durationMs: job?.startedAt ? finishedAt.getTime() - job.startedAt.getTime() : null,
      },
    });

    if (job?.type === PodListingJobType.PUBLISH) {
      await this.finalizePublishedProducts(jobId, finishedAt);
    } else if (job?.sessionId) {
      await this.finalizeSession(job.sessionId, jobId, status, finishedAt, job.type === PodListingJobType.LIVE_LISTING);
    }

    this.logger.log({
      module: 'pod-listing',
      operation: 'job.finish',
      organizationId,
      jobId,
      status,
      success,
      failed,
      msg: 'Kết thúc lượt Bulk Listing',
    });
  }

  /**
   * Chốt sổ Draft Product sau một lượt **PUBLISH**.
   *
   * 🔴 Chỉ NÂNG trạng thái, không bao giờ hạ: một Draft Product lên nhiều shop, publish
   * thành công ở shop A và trượt ở shop B thì nó vẫn ĐÃ có hàng đang chờ duyệt. Hạ nó về
   * FAILED là xoá mất sự thật đó — và đẩy người vận hành đi Start Listing lại, tức là tạo
   * thêm Draft trùng trên shop A. Lỗi của shop B nằm ở chính Draft Listing của shop đó.
   *
   * Cũng KHÔNG đụng tới `PodListingSession.status`: một lượt đăng đã COMPLETED thì việc
   * publish sau đó không làm nó quay lại LISTING.
   */
  private async finalizePublishedProducts(jobId: string, finishedAt: Date): Promise<void> {
    const succeeded = await this.prisma.podListingJobItem.findMany({
      where: {
        jobId,
        status: PodListingJobItemStatus.SUCCESS,
        sessionProductId: { not: null },
      },
      select: { sessionProductId: true },
    });
    const ids = [...new Set(succeeded.map((item) => item.sessionProductId as string))];
    if (ids.length === 0) return;

    await this.prisma.podListingSessionProduct.updateMany({
      where: { id: { in: ids } },
      data: {
        status: PodListingSessionProductStatus.PUBLISHED,
        publishedAt: finishedAt,
        uploadError: null,
      },
    });
  }

  /**
   * Chốt sổ cho Listing Session sau khi lượt chạy kết thúc.
   *
   * 🔴 Trạng thái của từng Draft Product được TÍNH LẠI từ kết quả thật của các item, không
   * dựa vào những lần cập nhật rải rác lúc chạy: một sản phẩm hỏng ở lượt đầu rồi thành công
   * sau khi retry phải xanh trở lại, còn cách cập nhật tại chỗ thì để lại vết đỏ vĩnh viễn.
   *
   * Luật: có item FAILED ⇒ FAILED · không lỗi mà có SUCCESS ⇒ UPLOADED · còn lại (bị cổng
   * validate chặn) ⇒ SKIPPED.
   */
  private async finalizeSession(
    sessionId: string,
    jobId: string,
    jobStatus: PodListingJobStatus,
    finishedAt: Date,
    /** Lượt Publish Live: item SUCCESS ⇒ Draft Product PUBLISHED (không phải UPLOADED). */
    live = false,
  ): Promise<void> {
    const items = await this.prisma.podListingJobItem.findMany({
      where: { jobId, sessionProductId: { not: null } },
      select: { sessionProductId: true, status: true },
    });

    const byProduct = new Map<string, PodListingJobItemStatus[]>();
    for (const item of items) {
      const key = item.sessionProductId as string;
      byProduct.set(key, [...(byProduct.get(key) ?? []), item.status]);
    }

    for (const [productId, statuses] of byProduct) {
      const status = statuses.includes(PodListingJobItemStatus.FAILED)
        ? PodListingSessionProductStatus.FAILED
        : statuses.includes(PodListingJobItemStatus.SUCCESS)
          ? live
            ? PodListingSessionProductStatus.PUBLISHED
            : PodListingSessionProductStatus.UPLOADED
          : PodListingSessionProductStatus.SKIPPED;

      await this.prisma.podListingSessionProduct.updateMany({
        where: { id: productId },
        data: {
          status,
          ...(status === PodListingSessionProductStatus.UPLOADED
            ? { uploadError: null, uploadedAt: finishedAt }
            : status === PodListingSessionProductStatus.PUBLISHED
              ? { uploadError: null, uploadedAt: finishedAt, publishedAt: finishedAt }
              : {}),
        },
      });
    }

    await this.prisma.podListingSession.updateMany({
      where: { id: sessionId },
      data: { status: SESSION_STATUS_BY_JOB[jobStatus], finishedAt },
    });
  }

  /**
   * Bộ quét định kỳ.
   *
   * Hai việc: (1) xử lý item "mồ côi" (PROCESSING quá `POD_LISTING_STALE_ITEM_MS` vì tiến trình
   * chết giữa chừng); (2) khởi động lại job chưa xong mà không có vòng chạy nào trong tiến trình này.
   *
   * 🔴 Item treo được **trả về hàng đợi có đếm**: mỗi lần khôi phục tính là một lần thử
   * (`retryCount + 1`); hết `maxRetries` của job thì FAILED với mã `JOB_TIMEOUT` và lý do rõ —
   * không được treo PROCESSING vĩnh viễn (khoá cặp sản phẩm/shop của lượt clone khác), cũng
   * không được tự coi là SUCCESS: TikTok có thể đã hoặc chưa nhận request, chỉ payload
   * (Product Mapping) mới biết — pipeline kiểm lại khi chạy lại.
   */
  private async sweep(): Promise<void> {
    if (this.stopping) return;

    try {
      const staleBefore = new Date(Date.now() - POD_LISTING_STALE_ITEM_MS);
      const stale = await this.prisma.podListingJobItem.findMany({
        where: {
          status: PodListingJobItemStatus.PROCESSING,
          startedAt: { lt: staleBefore },
          job: { deletedAt: null, status: { not: PodListingJobStatus.CANCELLED } },
        },
        select: {
          id: true,
          jobId: true,
          organizationId: true,
          retryCount: true,
          startedAt: true,
          job: { select: { maxRetries: true } },
        },
        take: 200,
      });
      for (const item of stale) {
        const staleMinutes = Math.round(POD_LISTING_STALE_ITEM_MS / 60_000);
        const message =
          `Quá thời gian xử lý: item treo ở PROCESSING hơn ${staleMinutes} phút ` +
          `(bắt đầu ${item.startedAt?.toISOString() ?? '?'}) — tiến trình trước đã dừng giữa chừng.`;
        const log = this.itemLogger(item.organizationId, item.jobId, item.id);
        if (item.retryCount >= item.job.maxRetries) {
          await log(PodListingLogLevel.ERROR, PodListingStep.RETRY, `Thất bại: ${message} Đã hết số lần khôi phục.`, {
            code: 'JOB_TIMEOUT',
            retryCount: item.retryCount,
          });
          await this.settleItem({
            organizationId: item.organizationId,
            jobId: item.jobId,
            itemId: item.id,
            status: PodListingJobItemStatus.FAILED,
            error: `${message} Đã hết số lần khôi phục — bấm Chạy lại để thử lại.`,
            errorCode: 'JOB_TIMEOUT',
            durationMs: item.startedAt ? Date.now() - item.startedAt.getTime() : 0,
          });
          continue;
        }
        await log(PodListingLogLevel.WARN, PodListingStep.RETRY, `${message} Trả về hàng đợi (lần ${item.retryCount + 1}/${item.job.maxRetries}).`, {
          code: 'JOB_TIMEOUT',
        });
        await this.prisma.podListingJobItem.update({
          where: { id: item.id },
          data: {
            status: PodListingJobItemStatus.PENDING,
            startedAt: null,
            retryCount: item.retryCount + 1,
            error: message,
            errorCode: 'JOB_TIMEOUT',
          },
        });
      }
      if (stale.length > 0) {
        this.logger.warn({
          module: 'pod-listing',
          operation: 'job.sweep.revive',
          items: stale.length,
          msg: 'Xử lý item đang treo (tiến trình trước đã chết giữa chừng): trả về hàng đợi hoặc FAILED nếu hết lượt',
        });
      }

      const pending = await this.prisma.podListingJob.findMany({
        where: {
          deletedAt: null,
          status: { in: [PodListingJobStatus.PENDING, PodListingJobStatus.PROCESSING] },
        },
        select: { id: true, organizationId: true },
        take: 20,
      });

      for (const job of pending) {
        if (this.running.has(job.id)) continue;
        this.runInBackground(job.organizationId, job.id);
      }
    } catch (error) {
      this.logger.error({
        module: 'pod-listing',
        operation: 'job.sweep.fail',
        msg: error instanceof Error ? error.message : 'Lỗi không xác định',
      });
    }
  }

  /** Ghi log gắn với một item — dùng chung cho publisher để log liền mạch một dòng thời gian. */
  private itemLogger(organizationId: string, jobId: string, itemId: string): ListingLogger {
    return async (level, step, message, payload) => {
      await this.prisma.podListingLog.create({
        data: {
          organizationId,
          jobId,
          listingItemId: itemId,
          level,
          step,
          message: message.slice(0, 2000),
          payload: payload ? toJson(payload) : undefined,
        },
      });
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
