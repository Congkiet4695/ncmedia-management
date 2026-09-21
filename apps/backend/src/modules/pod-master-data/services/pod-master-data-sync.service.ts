import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PodMasterDataProvider, PodResourceSyncStatus, PodResourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import {
  type AcquiredLock,
  DistributedLockService,
} from '../../pod-tiktok/infra/distributed-lock.service';
import {
  type BrandSyncProgress,
  PodProductCatalogService,
} from '../../pod-product/services/pod-product-catalog.service';
import {
  PodProductSyncRepository,
  type ProductSyncTarget,
} from '../../pod-product/repositories/pod-product-sync.repository';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  POD_MASTER_DATA_LOG_MAX_ITEMS,
  POD_MASTER_DATA_RESOURCES,
  POD_MASTER_DATA_SYNC_LOCK,
  POD_MASTER_DATA_SYNC_LOCK_RENEW_MS,
  POD_MASTER_DATA_SYNC_LOCK_TTL_MS,
  POD_MASTER_DATA_SYNC_PROGRESS_KEY,
  POD_MASTER_DATA_SYNC_PROGRESS_TTL_MS,
} from '../constants/pod-master-data.constants';
import type {
  MasterDataLogQueryDto,
  MasterDataResourceStatusDto,
  MasterDataStatusDto,
  MasterDataSyncProgressDto,
  MasterDataSyncResultDto,
  MasterDataSyncStartedDto,
  SyncMasterDataDto,
} from '../dto/pod-master-data.dto';

/** Kết quả đồng bộ của MỘT tài nguyên trong lượt. */
interface ResourceOutcome {
  resource: PodResourceType;
  status: PodResourceSyncStatus;
  records: number;
  durationMs: number;
  error?: string;
}

/** Một lượt đã được chuẩn bị xong (khoá, shop nguồn, token) và sẵn sàng chạy nền. */
interface PreparedJob {
  jobId: string;
  userId: string;
  startedAt: Date;
  resources: PodResourceType[];
  source: ProductSyncTarget;
  ctx: TiktokShopContext;
  dto: SyncMasterDataDto;
  lock: AcquiredLock;
}

/** Tài nguyên nào cần tài nguyên nào có dữ liệu trước. */
const DEPENDS_ON: Partial<Record<PodResourceType, PodResourceType>> = {
  [PodResourceType.CATEGORY_ATTRIBUTE]: PodResourceType.CATEGORY,
};

/**
 * PodMasterDataSyncService — đồng bộ **dữ liệu master TOÀN CỤC** của TikTok.
 *
 * 🔴 Vì sao module này thay thế đường đồng bộ cũ: trước đây Categories / Brands /
 * Category Attributes được kéo về **theo từng shop của từng Organization**. Hệ quả:
 *
 *   - Mỗi tổ chức mới phải tự bấm Sync ba lần mới dùng được Template — một bước dựng hệ
 *     thống mà không ai nói cho họ biết, và làm hỏng ngay màn hình đầu tiên họ mở.
 *   - Cùng một cây danh mục 12.000 dòng bị nhân bản cho từng shop.
 *   - Mỗi tổ chức đốt quota TikTok (cấp theo App, dùng chung toàn hệ thống) để lấy về
 *     đúng bộ dữ liệu mà tổ chức bên cạnh vừa lấy xong.
 *
 * Nay: Super Admin chạy MỘT lượt, ghi vào bảng dùng chung, mọi Organization cùng đọc.
 *
 * Bốn bảo đảm:
 *
 * 1. **Idempotent.** Mọi thao tác ghi là `upsert` theo khoá tự nhiên (provider, providerId).
 *    Chạy hai lần không sinh bản ghi trùng.
 * 2. **Một lượt tại một thời điểm.** Khoá Redis (`SET NX PX`) — cột `status` trong database
 *    không đủ vì API chạy nhiều instance. Lượt chạy dài tự gia hạn khoá (watchdog).
 * 3. **Lượt hỏng KHÔNG phá dữ liệu đang có.** Không có bước xoá-rồi-ghi-lại ở đâu cả:
 *    TikTok chết giữa chừng thì 12.000 danh mục cũ vẫn nguyên, lượt được đánh dấu FAILED
 *    kèm lỗi nguyên văn, và Super Admin bấm lại được.
 * 4. **Chạy nền, theo dõi qua status.** Quét thương hiệu là hàng chục nghìn lời gọi TikTok
 *    (xem `TiktokBrandCrawlerService`); `POST /sync` chỉ xác nhận đã nhận (202) và giao diện
 *    polling `GET /status` — không HTTP request nào phải sống hàng giờ.
 */
@Injectable()
export class PodMasterDataSyncService {
  private readonly logger = new Logger(PodMasterDataSyncService.name);

  /** Lượt đang chạy nền trong instance này — để test và tắt máy có thể đợi nó xong. */
  private inFlight: Promise<MasterDataSyncResultDto> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PodProductCatalogService,
    private readonly syncRepo: PodProductSyncRepository,
    private readonly lock: DistributedLockService,
    private readonly redis: RedisService,
  ) {}

  // ---------------------------------------------------------------------------
  // Trạng thái & nhật ký — ĐỌC, mọi Organization đều xem được
  // ---------------------------------------------------------------------------

  /**
   * Toàn cảnh Master Data.
   *
   * `totalRecords` **đếm trực tiếp trong database**, không đọc con số của lượt sync cuối:
   * hai giá trị lệch nhau ngay khi có bản ghi bị xoá, và người xem cần biết hệ thống đang
   * thực sự có gì. Với lượt đang chạy, con số này nhích lên theo từng lô ghi — chính là
   * tiến độ dễ hiểu nhất.
   */
  async status(canSync: boolean): Promise<MasterDataStatusDto> {
    const [rows, categories, brands, attributes, progress] = await Promise.all([
      this.prisma.podMasterDataSync.findMany({
        where: { provider: PodMasterDataProvider.TIKTOK },
      }),
      this.prisma.podProductCategory.count({ where: { deletedAt: null } }),
      this.prisma.podProductBrand.count({ where: { deletedAt: null } }),
      this.prisma.podCategoryAttribute.count(),
      this.readProgress(),
    ]);

    const counts: Partial<Record<PodResourceType, number>> = {
      [PodResourceType.CATEGORY]: categories,
      [PodResourceType.BRAND]: brands,
      [PodResourceType.CATEGORY_ATTRIBUTE]: attributes,
    };
    const byResource = new Map(rows.map((row) => [row.resource, row]));

    const resources: MasterDataResourceStatusDto[] = POD_MASTER_DATA_RESOURCES.map((resource) => {
      const row = byResource.get(resource);
      const dependsOn = DEPENDS_ON[resource] ?? null;
      const running = row?.status === PodResourceSyncStatus.RUNNING;

      return {
        resource,
        totalRecords: counts[resource] ?? 0,
        status: row?.status ?? PodResourceSyncStatus.IDLE,
        lastSyncAt: row?.lastSyncAt ?? null,
        startedAt: row?.startedAt ?? null,
        completedAt: row?.completedAt ?? null,
        failedAt: row?.failedAt ?? null,
        durationMs: row?.durationMs ?? null,
        lastError: row?.lastError ?? null,
        jobId: row?.jobId ?? null,
        dependsOn,
        ready: dependsOn === null || (counts[dependsOn] ?? 0) > 0,
        // Tiến độ chỉ có nghĩa cho đúng tài nguyên của đúng lượt đang chạy.
        progress:
          running && progress?.resource === resource && progress.jobId === row?.jobId
            ? progress
            : null,
      };
    });

    return { canSync, resources };
  }

  logs(query: MasterDataLogQueryDto) {
    return this.prisma.podMasterDataSyncLog.findMany({
      where: {
        provider: PodMasterDataProvider.TIKTOK,
        ...(query.resource ? { resource: query.resource } : {}),
        ...(query.jobId ? { jobId: query.jobId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(query.limit ?? 50, POD_MASTER_DATA_LOG_MAX_ITEMS),
    });
  }

  // ---------------------------------------------------------------------------
  // Đồng bộ — GHI, chỉ Super Admin (guard ở controller)
  // ---------------------------------------------------------------------------

  /**
   * Nhận một lượt đồng bộ toàn cục và chạy nó ở NỀN.
   *
   * Khoá Redis bọc TOÀN BỘ lượt. Không giành được khoá ⇒ 409 với thông điệp rõ ràng, KHÔNG
   * xếp hàng chờ: hai lượt đồng bộ chồng nhau chỉ tiêu gấp đôi quota TikTok để ghi ra cùng
   * một kết quả.
   *
   * Mọi thứ có thể hỏng NGAY (không có shop nguồn, token không lấy được) được làm trước khi
   * trả về, để người bấm nhận lỗi tức thì thay vì một lượt "RUNNING" rồi FAILED sau vài giây.
   */
  async sync(userId: string, dto: SyncMasterDataDto): Promise<MasterDataSyncStartedDto> {
    const lock = await this.lock.acquire(POD_MASTER_DATA_SYNC_LOCK, POD_MASTER_DATA_SYNC_LOCK_TTL_MS);
    if (!lock) {
      throw new ConflictException({
        code: 'POD_MASTER_DATA_SYNC_IN_PROGRESS',
        message: 'Một lượt đồng bộ TikTok Master Data đang chạy. Vui lòng đợi lượt hiện tại kết thúc.',
      });
    }

    let job: PreparedJob;
    try {
      job = await this.prepare(userId, dto, lock);
    } catch (error) {
      await this.lock.release(lock);
      throw error;
    }

    // Chạy nền. `execute` tự bắt mọi lỗi và luôn giải phóng khoá — không có rejection nào
    // thoát ra ngoài promise này.
    this.inFlight = this.execute(job).finally(() => {
      this.inFlight = null;
    });

    return {
      jobId: job.jobId,
      status: PodResourceSyncStatus.RUNNING,
      resources: job.resources,
      sourceShopId: job.source.id,
      startedAt: job.startedAt,
    };
  }

  /** Đợi lượt đang chạy nền (nếu có) kết thúc — dùng cho test và khi tắt tiến trình. */
  async waitForInFlight(): Promise<MasterDataSyncResultDto | null> {
    return this.inFlight ? this.inFlight : null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async prepare(
    userId: string,
    dto: SyncMasterDataDto,
    lock: AcquiredLock,
  ): Promise<PreparedJob> {
    const jobId = randomUUID();
    const startedAt = new Date();
    const resources = this.resolveResources(dto);
    const source = await this.resolveSourceShop(dto.sourceShopId);
    const ctx = await this.catalog.buildContext(source);

    // Đánh dấu RUNNING cho tài nguyên đầu tiên NGAY tại đây: giao diện polling ngay sau 202
    // phải thấy lượt đang chạy, không có khoảng trống "bấm rồi mà chưa thấy gì".
    await this.markRunning(resources[0], jobId, userId, source.id, startedAt);

    return { jobId, userId, startedAt, resources, source, ctx, dto, lock };
  }

  private async execute(job: PreparedJob): Promise<MasterDataSyncResultDto> {
    const watchdog = this.startLockWatchdog(job.lock);
    const outcomes: ResourceOutcome[] = [];
    /** Tài nguyên đã chốt trạng thái trong database — phần còn lại phải được dọn nếu lượt gãy. */
    const finalized = new Set<PodResourceType>();

    try {
      for (const [index, resource] of job.resources.entries()) {
        if (index > 0) {
          await this.markRunning(resource, job.jobId, job.userId, job.source.id, job.startedAt);
        }
        await this.writeProgress({
          jobId: job.jobId,
          resource,
          apiCalls: 0,
          fetched: 0,
          records: 0,
          detail: null,
          updatedAt: new Date(),
        });
        const resourceStartedAt = new Date();

        try {
          const result = await this.runResource(resource, job);
          outcomes.push({
            resource,
            status: result.warning ? PodResourceSyncStatus.PARTIAL : PodResourceSyncStatus.SUCCESS,
            records: result.records,
            durationMs: Date.now() - resourceStartedAt.getTime(),
            error: result.warning,
          });
        } catch (error) {
          // Fail-soft giữa các tài nguyên: brand hỏng không được kéo theo cây danh mục vừa
          // kéo về thành công. Lỗi giữ nguyên văn để Super Admin đọc được message của TikTok.
          const message = this.message(error);
          outcomes.push({
            resource,
            status: PodResourceSyncStatus.FAILED,
            records: 0,
            durationMs: Date.now() - resourceStartedAt.getTime(),
            error: message,
          });
          this.logger.error({
            module: 'pod-master-data',
            operation: 'master-data.sync.resource.fail',
            resource,
            jobId: job.jobId,
            sourceShopId: job.source.id,
            msg: message,
          });
        }

        await this.finishResource(resource, job, outcomes.at(-1)!);
        finalized.add(resource);
      }

      return this.summarize(job, outcomes);
    } catch (error) {
      // Lỗi ngoài vòng tài nguyên (database, Redis) — không được để lượt kẹt ở RUNNING mãi.
      const message = this.message(error);
      this.logger.error({
        module: 'pod-master-data',
        operation: 'master-data.sync.fail',
        jobId: job.jobId,
        msg: message,
      });
      await this.failUnfinished(job, outcomes, finalized, message);
      return this.summarize(job, outcomes);
    } finally {
      clearInterval(watchdog);
      await this.clearProgress();
      await this.lock.release(job.lock);
    }
  }

  private async runResource(
    resource: PodResourceType,
    job: PreparedJob,
  ): Promise<{ records: number; warning?: string }> {
    switch (resource) {
      case PodResourceType.CATEGORY:
        return { records: await this.catalog.syncGlobalCategories(job.ctx) };
      case PodResourceType.BRAND: {
        const summary = await this.catalog.syncGlobalBrands(job.ctx, {
          onProgress: (progress) => this.writeBrandProgress(job.jobId, progress),
        });
        return { records: summary.records, warning: summary.warning ?? undefined };
      }
      case PodResourceType.CATEGORY_ATTRIBUTE:
        return {
          records: await this.catalog.syncGlobalCategoryAttributes(job.ctx, {
            categoryIds: job.dto.categoryIds,
          }),
        };
      default:
        // WAREHOUSE không phải master data toàn cục — nó thuộc về từng shop (`pod-resource`).
        throw new Error(`Tài nguyên ${resource} không thuộc TikTok Master Data toàn cục`);
    }
  }

  /** Tài nguyên cần chạy, LUÔN theo thứ tự phụ thuộc dù client truyền vào thứ tự nào. */
  private resolveResources(dto: SyncMasterDataDto): PodResourceType[] {
    if (!dto.resources?.length) return POD_MASTER_DATA_RESOURCES;
    const requested = new Set(dto.resources);
    return POD_MASTER_DATA_RESOURCES.filter((resource) => requested.has(resource));
  }

  /**
   * Chọn shop làm NGUỒN gọi TikTok.
   *
   * 🔴 Đây là chỗ duy nhất mà "dữ liệu toàn cục" vẫn phải chạm tới một tổ chức cụ thể: API
   * master data của TikTok đòi `shop_cipher` + access token của một shop đã uỷ quyền, không
   * có endpoint vô danh. Shop nguồn chỉ cho MƯỢN token — dữ liệu ghi ra là dùng chung và
   * không mang dấu vết tổ chức nào. `sourceShopId` được ghi lại để truy vết khi dữ liệu lệch.
   */
  private async resolveSourceShop(sourceShopId?: string): Promise<ProductSyncTarget> {
    const targets = await this.syncRepo.findSyncTargets(
      sourceShopId ? { shopId: sourceShopId } : {},
    );
    const target = targets[0];

    if (!target) {
      throw new NotFoundException({
        code: 'POD_MASTER_DATA_NO_SOURCE_SHOP',
        message: sourceShopId
          ? 'Shop nguồn không tồn tại hoặc chưa kết nối TikTok hợp lệ.'
          : 'Chưa có shop TikTok nào đủ điều kiện để làm nguồn đồng bộ (chưa kết nối hoặc token đã hết hạn).',
      });
    }

    return target;
  }

  /**
   * Watchdog gia hạn khoá trong lúc lượt chạy. Mất khoá (Redis reset, TTL trôi) thì chỉ cảnh
   * báo: lượt vẫn idempotent, một lượt thứ hai chen vào chỉ tốn quota chứ không phá dữ liệu.
   */
  private startLockWatchdog(lock: AcquiredLock): NodeJS.Timeout {
    return setInterval(() => {
      void this.lock.renew(lock, POD_MASTER_DATA_SYNC_LOCK_TTL_MS).then(
        (renewed) => {
          if (!renewed) {
            this.logger.warn({
              module: 'pod-master-data',
              operation: 'master-data.sync.lock.lost',
              msg: 'Không gia hạn được khoá đồng bộ — lượt vẫn chạy tiếp, có thể có lượt khác chen vào',
            });
          }
        },
        (error: unknown) => {
          this.logger.warn({
            module: 'pod-master-data',
            operation: 'master-data.sync.lock.renew.fail',
            msg: this.message(error),
          });
        },
      );
    }, POD_MASTER_DATA_SYNC_LOCK_RENEW_MS);
  }

  private async markRunning(
    resource: PodResourceType,
    jobId: string,
    userId: string,
    sourceShopId: string,
    startedAt: Date,
  ): Promise<void> {
    await this.prisma.podMasterDataSync.upsert({
      where: {
        provider_resource: { provider: PodMasterDataProvider.TIKTOK, resource },
      },
      create: {
        provider: PodMasterDataProvider.TIKTOK,
        resource,
        status: PodResourceSyncStatus.RUNNING,
        startedAt,
        jobId,
        sourceShopId,
        lastRunBy: userId,
      },
      update: {
        status: PodResourceSyncStatus.RUNNING,
        startedAt,
        completedAt: null,
        failedAt: null,
        jobId,
        sourceShopId,
        lastRunBy: userId,
      },
    });
  }

  /** Chốt trạng thái của MỘT tài nguyên + ghi một dòng nhật ký. */
  private async finishResource(
    resource: PodResourceType,
    job: PreparedJob,
    outcome: ResourceOutcome,
  ): Promise<void> {
    const finishedAt = new Date();
    // PARTIAL vẫn là "đã ghi dữ liệu mới" (chỉ thiếu một phần) nên cũng đẩy `lastSyncAt` lên;
    // FAILED thì không — nó là câu trả lời cho "dữ liệu này mới tới đâu".
    const wrote = outcome.status !== PodResourceSyncStatus.FAILED;

    await this.prisma.$transaction([
      this.prisma.podMasterDataSync.update({
        where: { provider_resource: { provider: PodMasterDataProvider.TIKTOK, resource } },
        data: {
          status: outcome.status,
          ...(wrote ? { lastSyncAt: finishedAt, completedAt: finishedAt, failedAt: null } : {}),
          ...(wrote ? {} : { failedAt: finishedAt }),
          totalRecords: outcome.records,
          durationMs: outcome.durationMs,
          lastError: outcome.error?.slice(0, 2000) ?? null,
          jobId: job.jobId,
        },
      }),
      this.prisma.podMasterDataSyncLog.create({
        data: {
          provider: PodMasterDataProvider.TIKTOK,
          resource,
          jobId: job.jobId,
          status: outcome.status,
          totalRecords: outcome.records,
          durationMs: outcome.durationMs,
          errorMessage: outcome.error?.slice(0, 2000) ?? null,
          sourceShopId: job.source.id,
          startedAt: job.startedAt,
          finishedAt,
          triggeredBy: job.userId,
        },
      }),
    ]);
  }

  /**
   * Lỗi hạ tầng giữa chừng: không tài nguyên nào được phép kẹt ở RUNNING trong database.
   *
   * - Tài nguyên đã có kết quả nhưng chưa chốt được (chính bước chốt là chỗ hỏng) ⇒ chốt lại
   *   với kết quả thật của nó.
   * - Tài nguyên chưa kịp chạy ⇒ FAILED kèm lý do.
   */
  private async failUnfinished(
    job: PreparedJob,
    outcomes: ResourceOutcome[],
    finalized: Set<PodResourceType>,
    message: string,
  ): Promise<void> {
    for (const resource of job.resources) {
      if (finalized.has(resource)) continue;

      let outcome = outcomes.find((item) => item.resource === resource);
      if (!outcome) {
        outcome = {
          resource,
          status: PodResourceSyncStatus.FAILED,
          records: 0,
          durationMs: Date.now() - job.startedAt.getTime(),
          error: message,
        };
        outcomes.push(outcome);
      }

      try {
        await this.markRunning(resource, job.jobId, job.userId, job.source.id, job.startedAt);
        await this.finishResource(resource, job, outcome);
        finalized.add(resource);
      } catch (error) {
        this.logger.error({
          module: 'pod-master-data',
          operation: 'master-data.sync.fail.mark',
          resource,
          jobId: job.jobId,
          msg: this.message(error),
        });
      }
    }
  }

  private summarize(job: PreparedJob, outcomes: ResourceOutcome[]): MasterDataSyncResultDto {
    const durationMs = Date.now() - job.startedAt.getTime();
    const totalRecords = outcomes.reduce((sum, outcome) => sum + outcome.records, 0);
    const failed = outcomes.filter((outcome) => outcome.status === PodResourceSyncStatus.FAILED);
    const flawed = outcomes.filter((outcome) => outcome.error);

    const status =
      flawed.length === 0
        ? PodResourceSyncStatus.SUCCESS
        : failed.length === outcomes.length
          ? PodResourceSyncStatus.FAILED
          : PodResourceSyncStatus.PARTIAL;

    const error =
      flawed.length > 0
        ? flawed
            .map((outcome) => `${outcome.resource}: ${outcome.error}`)
            .join(' · ')
            .slice(0, 2000)
        : null;

    this.logger.log({
      module: 'pod-master-data',
      operation: 'master-data.sync',
      jobId: job.jobId,
      sourceShopId: job.source.id,
      status,
      totalRecords,
      durationMs,
      resources: outcomes.length,
      failedResources: failed.length,
      msg: 'Đã đồng bộ TikTok Master Data toàn cục',
    });

    return {
      jobId: job.jobId,
      status,
      totalRecords,
      durationMs,
      sourceShopId: job.source.id,
      error,
      details: outcomes,
    };
  }

  // ---------------------------------------------------------------------------
  // Tiến độ (Redis) — dữ liệu tạm, sống cùng lượt đang chạy
  // ---------------------------------------------------------------------------

  private writeBrandProgress(jobId: string, progress: BrandSyncProgress): Promise<void> {
    const active = progress.activePrefixes.map((prefix) => `"${prefix}"`).join(', ');
    return this.writeProgress({
      jobId,
      resource: PodResourceType.BRAND,
      apiCalls: progress.apiCalls,
      fetched: progress.fetched,
      records: progress.inserted,
      detail: `prefix ${active || '—'} · ${progress.prefixesDone} xong · ${progress.prefixesQueued} chờ`,
      updatedAt: new Date(),
    });
  }

  /** Tiến độ chỉ để hiển thị — Redis chập chờn không được làm gãy lượt đồng bộ. */
  private async writeProgress(progress: MasterDataSyncProgressDto): Promise<void> {
    try {
      await this.redis.client.set(
        POD_MASTER_DATA_SYNC_PROGRESS_KEY,
        JSON.stringify(progress),
        'PX',
        POD_MASTER_DATA_SYNC_PROGRESS_TTL_MS,
      );
    } catch (error) {
      this.logger.warn({
        module: 'pod-master-data',
        operation: 'master-data.sync.progress.write.fail',
        msg: this.message(error),
      });
    }
  }

  private async readProgress(): Promise<MasterDataSyncProgressDto | null> {
    const raw = await this.redis.client.get(POD_MASTER_DATA_SYNC_PROGRESS_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as MasterDataSyncProgressDto;
      return { ...parsed, updatedAt: new Date(parsed.updatedAt) };
    } catch {
      return null;
    }
  }

  private async clearProgress(): Promise<void> {
    try {
      await this.redis.client.del(POD_MASTER_DATA_SYNC_PROGRESS_KEY);
    } catch (error) {
      this.logger.warn({
        module: 'pod-master-data',
        operation: 'master-data.sync.progress.clear.fail',
        msg: this.message(error),
      });
    }
  }

  private message(error: unknown): string {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { message?: string } }).response;
      if (response?.message) return response.message;
    }
    return error instanceof Error ? error.message : 'Lỗi không xác định';
  }
}
