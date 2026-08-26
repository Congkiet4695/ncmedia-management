import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PodResourceSyncStatus, PodResourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { PodProductCatalogService } from '../../pod-product/services/pod-product-catalog.service';
import { PodProductSyncRepository } from '../../pod-product/repositories/pod-product-sync.repository';
import { PodWarehouseService } from '../../pod-listing/services/pod-warehouse.service';
import {
  POD_RESOURCE_DEPENDS_ON,
  POD_RESOURCE_LOG_MAX_ITEMS,
  POD_RESOURCE_ORDER,
} from '../constants/pod-resource.constants';
import type {
  ResourceLogQueryDto,
  ResourceSyncResultDto,
  SyncAttributesDto,
  SyncResourceDto,
} from '../dto/pod-resource.dto';

/** Kết quả đồng bộ của MỘT shop. */
interface ShopOutcome {
  shopId: string;
  shopName: string;
  records: number;
  error?: string;
}

/** Trạng thái một tài nguyên trên màn hình Resources. */
export interface ResourceStatus {
  resource: PodResourceType;
  /** Số bản ghi ĐANG CÓ trong database (đếm thật, không phải số của lượt sync cuối). */
  totalRecords: number;
  status: PodResourceSyncStatus;
  lastSyncAt: Date | null;
  durationMs: number | null;
  lastError: string | null;
  jobId: string | null;
  /** Phải sync tài nguyên này trước thì tài nguyên kia mới có dữ liệu. */
  dependsOn: PodResourceType | null;
  /** `false` khi phụ thuộc chưa được sync — UI khoá nút Sync và nói rõ lý do. */
  ready: boolean;
}

/**
 * PodResourceSyncService — nạp **dữ liệu dùng chung** của TikTok về cache và ghi lại
 * trạng thái từng lượt.
 *
 * 🔴 Vì sao module này tồn tại: trước đó cách duy nhất để có danh mục/thương hiệu là bật
 * cờ `includeCatalog` khi đồng bộ **sản phẩm**. Màn hình Categories/Brands vì thế luôn
 * trống mà không có nút nào để sửa, kéo theo Category Template không chọn được danh mục —
 * hệ thống đứng hình đúng ở bước đầu tiên.
 *
 * Ba nguyên tắc:
 *
 * 1. **Template chỉ đọc cache.** Không màn hình nào gọi TikTok khi mở dropdown.
 * 2. **Cache chỉ đổi qua Sync.** Một cửa duy nhất, có nhật ký, biết ai bấm và lúc nào.
 * 3. **Lỗi phải hiện ra.** Fail-soft theo shop, nhưng lỗi được ghi vào log và trả về —
 *    không có chuyện báo "đồng bộ xong" trong khi chẳng kéo được gì.
 */
@Injectable()
export class PodResourceSyncService {
  private readonly logger = new Logger(PodResourceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PodProductCatalogService,
    private readonly warehouses: PodWarehouseService,
    private readonly syncRepo: PodProductSyncRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  syncCategories(organizationId: string, userId: string, dto: SyncResourceDto) {
    return this.run(organizationId, userId, PodResourceType.CATEGORY, dto, (target) =>
      this.catalog.syncShopCategories(target),
    );
  }

  syncBrands(organizationId: string, userId: string, dto: SyncResourceDto) {
    return this.run(organizationId, userId, PodResourceType.BRAND, dto, (target) =>
      this.catalog.syncShopBrands(target),
    );
  }

  async syncAttributes(organizationId: string, userId: string, dto: SyncAttributesDto) {
    // Không có danh mục thì không có gì để lấy thuộc tính — nói thẳng thay vì chạy rỗng
    // rồi báo "0 bản ghi" khiến người dùng tưởng TikTok không trả về gì.
    const categories = await this.prisma.podProductCategory.count({
      where: { organizationId, deletedAt: null },
    });
    if (categories === 0) {
      throw new BadRequestException({
        code: 'POD_RESOURCE_DEPENDENCY_MISSING',
        message: 'Chưa có danh mục nào trong cache. Hãy Sync Categories trước.',
      });
    }

    return this.run(organizationId, userId, PodResourceType.CATEGORY_ATTRIBUTE, dto, (target) =>
      this.catalog.syncShopCategoryAttributes(target, { categoryIds: dto.categoryIds }),
    );
  }

  /**
   * Kho hàng đi qua `PodWarehouseService` (nó tự duyệt shop) nên không dùng chung khung
   * `run()` — nhưng vẫn ghi trạng thái và nhật ký y hệt để màn hình Resources đồng nhất.
   */
  async syncWarehouses(
    organizationId: string,
    userId: string,
    dto: SyncResourceDto,
  ): Promise<ResourceSyncResultDto> {
    const jobId = randomUUID();
    const startedAt = new Date();
    await this.markRunning(organizationId, PodResourceType.WAREHOUSE, jobId, userId);

    let outcomes: ShopOutcome[] = [];
    let fatal: string | null = null;

    try {
      const results = await this.warehouses.sync({ organizationId, shopId: dto.shopId });
      outcomes = results.map((result) => ({
        shopId: result.shopId,
        shopName: result.shopName,
        records: result.warehouses,
        error: result.error,
      }));
    } catch (error) {
      fatal = this.message(error);
    }

    return this.finish(
      organizationId,
      userId,
      PodResourceType.WAREHOUSE,
      jobId,
      startedAt,
      outcomes,
      fatal,
    );
  }

  // ---------------------------------------------------------------------------
  // Trạng thái & nhật ký
  // ---------------------------------------------------------------------------

  /**
   * Trạng thái mọi tài nguyên.
   *
   * `totalRecords` **đếm trực tiếp trong database**, không đọc con số của lượt sync cuối:
   * hai giá trị đó lệch nhau ngay khi có bản ghi bị xoá, và người dùng cần biết cache
   * đang thực sự có gì.
   */
  async status(organizationId: string): Promise<ResourceStatus[]> {
    const [rows, categories, brands, attributes, warehouses] = await Promise.all([
      this.prisma.podResourceSync.findMany({ where: { organizationId } }),
      this.prisma.podProductCategory.count({ where: { organizationId, deletedAt: null } }),
      this.prisma.podProductBrand.count({ where: { organizationId, deletedAt: null } }),
      this.prisma.podCategoryAttribute.count({ where: { organizationId } }),
      this.prisma.podTiktokWarehouse.count({ where: { organizationId, deletedAt: null } }),
    ]);

    const counts: Record<PodResourceType, number> = {
      [PodResourceType.CATEGORY]: categories,
      [PodResourceType.BRAND]: brands,
      [PodResourceType.CATEGORY_ATTRIBUTE]: attributes,
      [PodResourceType.WAREHOUSE]: warehouses,
    };
    const byResource = new Map(rows.map((row) => [row.resource, row]));

    return POD_RESOURCE_ORDER.map((resource) => {
      const row = byResource.get(resource);
      const dependsOn = POD_RESOURCE_DEPENDS_ON[resource] ?? null;

      return {
        resource,
        totalRecords: counts[resource],
        status: row?.status ?? PodResourceSyncStatus.IDLE,
        lastSyncAt: row?.lastSyncAt ?? null,
        durationMs: row?.durationMs ?? null,
        lastError: row?.lastError ?? null,
        jobId: row?.jobId ?? null,
        dependsOn,
        ready: dependsOn === null || counts[dependsOn] > 0,
      };
    });
  }

  async logs(organizationId: string, query: ResourceLogQueryDto) {
    return this.prisma.podResourceSyncLog.findMany({
      where: {
        organizationId,
        ...(query.resource ? { resource: query.resource } : {}),
        ...(query.jobId ? { jobId: query.jobId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(query.limit ?? 50, POD_RESOURCE_LOG_MAX_ITEMS),
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Khung chung: chọn shop → chạy từng shop (fail-soft) → ghi trạng thái + nhật ký.
   *
   * Không có shop nào hợp lệ là **lỗi**, không phải "thành công 0 bản ghi": nguyên nhân
   * gần như luôn là chưa kết nối TikTok hoặc token chết, và người dùng cần thấy điều đó.
   */
  private async run(
    organizationId: string,
    userId: string,
    resource: PodResourceType,
    dto: SyncResourceDto,
    handler: (
      target: Awaited<ReturnType<PodProductSyncRepository['findSyncTargets']>>[number],
    ) => Promise<number>,
  ): Promise<ResourceSyncResultDto> {
    const jobId = randomUUID();
    const startedAt = new Date();
    await this.markRunning(organizationId, resource, jobId, userId);

    const targets = await this.syncRepo.findSyncTargets({
      organizationId,
      shopId: dto.shopId,
    });

    if (targets.length === 0) {
      return this.finish(
        organizationId,
        userId,
        resource,
        jobId,
        startedAt,
        [],
        'Không có shop TikTok nào đủ điều kiện đồng bộ (chưa kết nối hoặc token đã hết hạn).',
      );
    }

    const outcomes: ShopOutcome[] = [];
    for (const target of targets) {
      const shopStartedAt = new Date();
      try {
        const records = await handler(target);
        outcomes.push({ shopId: target.id, shopName: target.name, records });
      } catch (error) {
        // Fail-soft: shop hỏng không chặn shop còn lại, nhưng lỗi được giữ lại nguyên văn.
        const message = this.message(error);
        outcomes.push({ shopId: target.id, shopName: target.name, records: 0, error: message });
        this.logger.error({
          module: 'pod-resource',
          operation: 'resource.sync.shop.fail',
          organizationId,
          resource,
          shopId: target.id,
          durationMs: Date.now() - shopStartedAt.getTime(),
          msg: message,
        });
      }
    }

    return this.finish(organizationId, userId, resource, jobId, startedAt, outcomes, null);
  }

  private async markRunning(
    organizationId: string,
    resource: PodResourceType,
    jobId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.podResourceSync.upsert({
      where: { organizationId_resource: { organizationId, resource } },
      create: {
        organizationId,
        resource,
        status: PodResourceSyncStatus.RUNNING,
        jobId,
        lastRunBy: userId,
      },
      update: { status: PodResourceSyncStatus.RUNNING, jobId, lastRunBy: userId },
    });
  }

  /** Chốt trạng thái + ghi một dòng nhật ký cho mỗi shop và một dòng tổng kết. */
  private async finish(
    organizationId: string,
    userId: string,
    resource: PodResourceType,
    jobId: string,
    startedAt: Date,
    outcomes: ShopOutcome[],
    fatal: string | null,
  ): Promise<ResourceSyncResultDto> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const totalRecords = outcomes.reduce((sum, outcome) => sum + outcome.records, 0);
    const failed = outcomes.filter((outcome) => outcome.error);

    const status = fatal
      ? PodResourceSyncStatus.FAILED
      : failed.length === 0
        ? PodResourceSyncStatus.SUCCESS
        : failed.length === outcomes.length
          ? PodResourceSyncStatus.FAILED
          : PodResourceSyncStatus.PARTIAL;

    const error =
      fatal ??
      (failed.length > 0
        ? failed
            .map((outcome) => `${outcome.shopName}: ${outcome.error}`)
            .join(' · ')
            .slice(0, 2000)
        : null);

    await this.prisma.$transaction([
      this.prisma.podResourceSync.update({
        where: { organizationId_resource: { organizationId, resource } },
        data: { status, lastSyncAt: finishedAt, totalRecords, durationMs, lastError: error, jobId },
      }),
      this.prisma.podResourceSyncLog.createMany({
        data: [
          // Một dòng cho mỗi shop…
          ...outcomes.map((outcome) => ({
            organizationId,
            resource,
            jobId,
            status: outcome.error ? PodResourceSyncStatus.FAILED : PodResourceSyncStatus.SUCCESS,
            shopId: outcome.shopId,
            shopName: outcome.shopName,
            totalRecords: outcome.records,
            durationMs,
            errorMessage: outcome.error?.slice(0, 2000) ?? null,
            startedAt,
            finishedAt,
            triggeredBy: userId,
          })),
          // …và một dòng tổng kết của cả lượt (shopId = NULL).
          {
            organizationId,
            resource,
            jobId,
            status,
            shopId: null,
            shopName: null,
            totalRecords,
            durationMs,
            errorMessage: error?.slice(0, 2000) ?? null,
            startedAt,
            finishedAt,
            triggeredBy: userId,
          },
        ],
      }),
    ]);

    this.logger.log({
      module: 'pod-resource',
      operation: 'resource.sync',
      organizationId,
      resource,
      jobId,
      status,
      totalRecords,
      durationMs,
      shops: outcomes.length,
      failedShops: failed.length,
      msg: 'Đã đồng bộ tài nguyên TikTok',
    });

    return {
      resource,
      jobId,
      status,
      totalRecords,
      durationMs,
      shops: outcomes.length,
      failedShops: failed.length,
      error,
      details: outcomes,
    };
  }

  private message(error: unknown): string {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { message?: string } }).response;
      if (response?.message) return response.message;
    }
    return error instanceof Error ? error.message : 'Lỗi không xác định';
  }
}
