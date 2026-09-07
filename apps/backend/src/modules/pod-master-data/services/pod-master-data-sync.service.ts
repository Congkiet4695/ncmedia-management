import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PodMasterDataProvider, PodResourceSyncStatus, PodResourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodProductCatalogService } from '../../pod-product/services/pod-product-catalog.service';
import { PodProductSyncRepository } from '../../pod-product/repositories/pod-product-sync.repository';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import {
  POD_MASTER_DATA_LOG_MAX_ITEMS,
  POD_MASTER_DATA_RESOURCES,
  POD_MASTER_DATA_SYNC_LOCK,
  POD_MASTER_DATA_SYNC_LOCK_TTL_MS,
} from '../constants/pod-master-data.constants';
import type {
  MasterDataLogQueryDto,
  MasterDataResourceStatusDto,
  MasterDataStatusDto,
  MasterDataSyncResultDto,
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
 * Ba bảo đảm:
 *
 * 1. **Idempotent.** Mọi thao tác ghi là `upsert` theo khoá tự nhiên (provider, providerId).
 *    Chạy hai lần không sinh bản ghi trùng.
 * 2. **Một lượt tại một thời điểm.** Khoá Redis (`SET NX PX`) — cột `status` trong database
 *    không đủ vì API chạy nhiều instance.
 * 3. **Lượt hỏng KHÔNG phá dữ liệu đang có.** Không có bước xoá-rồi-ghi-lại ở đâu cả:
 *    TikTok chết giữa chừng thì 12.000 danh mục cũ vẫn nguyên, lượt được đánh dấu FAILED
 *    kèm lỗi nguyên văn, và Super Admin bấm lại được.
 */
@Injectable()
export class PodMasterDataSyncService {
  private readonly logger = new Logger(PodMasterDataSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PodProductCatalogService,
    private readonly syncRepo: PodProductSyncRepository,
    private readonly lock: DistributedLockService,
  ) {}

  // ---------------------------------------------------------------------------
  // Trạng thái & nhật ký — ĐỌC, mọi Organization đều xem được
  // ---------------------------------------------------------------------------

  /**
   * Toàn cảnh Master Data.
   *
   * `totalRecords` **đếm trực tiếp trong database**, không đọc con số của lượt sync cuối:
   * hai giá trị lệch nhau ngay khi có bản ghi bị xoá, và người xem cần biết hệ thống đang
   * thực sự có gì.
   */
  async status(canSync: boolean): Promise<MasterDataStatusDto> {
    const [rows, categories, brands, attributes] = await Promise.all([
      this.prisma.podMasterDataSync.findMany({
        where: { provider: PodMasterDataProvider.TIKTOK },
      }),
      this.prisma.podProductCategory.count({ where: { deletedAt: null } }),
      this.prisma.podProductBrand.count({ where: { deletedAt: null } }),
      this.prisma.podCategoryAttribute.count(),
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
   * Chạy một lượt đồng bộ toàn cục.
   *
   * Khoá Redis bọc TOÀN BỘ lượt. Không giành được khoá ⇒ 409 với thông điệp rõ ràng, KHÔNG
   * xếp hàng chờ: hai lượt đồng bộ chồng nhau chỉ tiêu gấp đôi quota TikTok để ghi ra cùng
   * một kết quả.
   */
  async sync(userId: string, dto: SyncMasterDataDto): Promise<MasterDataSyncResultDto> {
    const result = await this.lock.withLock(
      POD_MASTER_DATA_SYNC_LOCK,
      POD_MASTER_DATA_SYNC_LOCK_TTL_MS,
      () => this.run(userId, dto),
    );

    if (result === null) {
      throw new ConflictException({
        code: 'POD_MASTER_DATA_SYNC_IN_PROGRESS',
        message: 'Một lượt đồng bộ TikTok Master Data đang chạy. Vui lòng đợi lượt hiện tại kết thúc.',
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async run(userId: string, dto: SyncMasterDataDto): Promise<MasterDataSyncResultDto> {
    const jobId = randomUUID();
    const startedAt = new Date();
    const resources = this.resolveResources(dto);

    const source = await this.resolveSourceShop(dto.sourceShopId);
    const ctx = await this.catalog.buildContext(source);

    const outcomes: ResourceOutcome[] = [];

    for (const resource of resources) {
      await this.markRunning(resource, jobId, userId, source.id, startedAt);
      const resourceStartedAt = new Date();

      try {
        const records = await this.runResource(resource, ctx, dto);
        outcomes.push({
          resource,
          status: PodResourceSyncStatus.SUCCESS,
          records,
          durationMs: Date.now() - resourceStartedAt.getTime(),
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
          jobId,
          sourceShopId: source.id,
          msg: message,
        });
      }

      await this.finishResource(resource, jobId, userId, source.id, startedAt, outcomes.at(-1)!);
    }

    return this.summarize(jobId, startedAt, source.id, outcomes);
  }

  private runResource(
    resource: PodResourceType,
    ctx: TiktokShopContext,
    dto: SyncMasterDataDto,
  ): Promise<number> {
    switch (resource) {
      case PodResourceType.CATEGORY:
        return this.catalog.syncGlobalCategories(ctx);
      case PodResourceType.BRAND:
        return this.catalog.syncGlobalBrands(ctx);
      case PodResourceType.CATEGORY_ATTRIBUTE:
        return this.catalog.syncGlobalCategoryAttributes(ctx, { categoryIds: dto.categoryIds });
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
  private async resolveSourceShop(sourceShopId?: string) {
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
    jobId: string,
    userId: string,
    sourceShopId: string,
    startedAt: Date,
    outcome: ResourceOutcome,
  ): Promise<void> {
    const finishedAt = new Date();
    const success = outcome.status === PodResourceSyncStatus.SUCCESS;

    await this.prisma.$transaction([
      this.prisma.podMasterDataSync.update({
        where: { provider_resource: { provider: PodMasterDataProvider.TIKTOK, resource } },
        data: {
          status: outcome.status,
          // `lastSyncAt` chỉ nhích khi THÀNH CÔNG: nó là câu trả lời cho "dữ liệu này mới
          // tới đâu", và một lượt hỏng không làm dữ liệu mới hơn.
          ...(success ? { lastSyncAt: finishedAt, completedAt: finishedAt, failedAt: null } : {}),
          ...(success ? {} : { failedAt: finishedAt }),
          totalRecords: outcome.records,
          durationMs: outcome.durationMs,
          lastError: outcome.error?.slice(0, 2000) ?? null,
          jobId,
        },
      }),
      this.prisma.podMasterDataSyncLog.create({
        data: {
          provider: PodMasterDataProvider.TIKTOK,
          resource,
          jobId,
          status: outcome.status,
          totalRecords: outcome.records,
          durationMs: outcome.durationMs,
          errorMessage: outcome.error?.slice(0, 2000) ?? null,
          sourceShopId,
          startedAt,
          finishedAt,
          triggeredBy: userId,
        },
      }),
    ]);
  }

  private summarize(
    jobId: string,
    startedAt: Date,
    sourceShopId: string,
    outcomes: ResourceOutcome[],
  ): MasterDataSyncResultDto {
    const durationMs = Date.now() - startedAt.getTime();
    const totalRecords = outcomes.reduce((sum, outcome) => sum + outcome.records, 0);
    const failed = outcomes.filter((outcome) => outcome.error);

    const status =
      failed.length === 0
        ? PodResourceSyncStatus.SUCCESS
        : failed.length === outcomes.length
          ? PodResourceSyncStatus.FAILED
          : PodResourceSyncStatus.PARTIAL;

    const error =
      failed.length > 0
        ? failed
            .map((outcome) => `${outcome.resource}: ${outcome.error}`)
            .join(' · ')
            .slice(0, 2000)
        : null;

    this.logger.log({
      module: 'pod-master-data',
      operation: 'master-data.sync',
      jobId,
      sourceShopId,
      status,
      totalRecords,
      durationMs,
      resources: outcomes.length,
      failedResources: failed.length,
      msg: 'Đã đồng bộ TikTok Master Data toàn cục',
    });

    return { jobId, status, totalRecords, durationMs, sourceShopId, error, details: outcomes };
  }

  private message(error: unknown): string {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { message?: string } }).response;
      if (response?.message) return response.message;
    }
    return error instanceof Error ? error.message : 'Lỗi không xác định';
  }
}
