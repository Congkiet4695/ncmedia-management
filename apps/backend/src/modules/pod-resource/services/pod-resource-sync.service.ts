import { Injectable, Logger } from '@nestjs/common';
import { PodResourceSyncStatus, PodResourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { PodWarehouseService } from '../../pod-listing/services/pod-warehouse.service';
import {
  POD_RESOURCE_LOG_MAX_ITEMS,
  POD_RESOURCE_ORDER,
} from '../constants/pod-resource.constants';
import type {
  ResourceLogQueryDto,
  ResourceSyncResultDto,
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
}

/**
 * PodResourceSyncService — nạp tài nguyên TikTok **thuộc về một tổ chức** và ghi lại trạng
 * thái từng lượt.
 *
 * 🔴 Phạm vi module này đã THU HẸP còn **kho hàng**. Danh mục / thương hiệu / thuộc tính
 * danh mục chuyển sang `PodMasterDataModule` vì chúng là dữ liệu master của TikTok, giống
 * nhau với mọi seller: bắt từng tổ chức tự kéo về một bản sao riêng nghĩa là mỗi tổ chức
 * mới đều phải tự dựng hệ thống trước khi dùng được, và cùng một cây 12.000 danh mục bị
 * nhân bản theo số shop. Kho hàng thì ngược lại — nó là thứ từng seller tự khai.
 *
 * Hai nguyên tắc còn nguyên:
 *
 * 1. **Cache chỉ đổi qua Sync.** Một cửa duy nhất, có nhật ký, biết ai bấm và lúc nào.
 * 2. **Lỗi phải hiện ra.** Fail-soft theo shop, nhưng lỗi được ghi vào log và trả về —
 *    không có chuyện báo "đồng bộ xong" trong khi chẳng kéo được gì.
 */
@Injectable()
export class PodResourceSyncService {
  private readonly logger = new Logger(PodResourceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: PodWarehouseService,
  ) {}

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  /**
   * Đồng bộ kho hàng của mọi shop đủ điều kiện trong tổ chức.
   *
   * `PodWarehouseService` tự duyệt shop nên không cần khung `run()` riêng — nhưng vẫn ghi
   * trạng thái và nhật ký y hệt để màn hình Resources đồng nhất.
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
   * Trạng thái tài nguyên của tổ chức.
   *
   * `totalRecords` **đếm trực tiếp trong database**, không đọc con số của lượt sync cuối:
   * hai giá trị đó lệch nhau ngay khi có bản ghi bị xoá, và người dùng cần biết cache đang
   * thực sự có gì.
   */
  async status(organizationId: string): Promise<ResourceStatus[]> {
    const [rows, warehouses] = await Promise.all([
      this.prisma.podResourceSync.findMany({ where: { organizationId } }),
      this.prisma.podTiktokWarehouse.count({ where: { organizationId, deletedAt: null } }),
    ]);

    const counts: Partial<Record<PodResourceType, number>> = {
      [PodResourceType.WAREHOUSE]: warehouses,
    };
    const byResource = new Map(rows.map((row) => [row.resource, row]));

    return POD_RESOURCE_ORDER.map((resource) => {
      const row = byResource.get(resource);

      return {
        resource,
        totalRecords: counts[resource] ?? 0,
        status: row?.status ?? PodResourceSyncStatus.IDLE,
        lastSyncAt: row?.lastSyncAt ?? null,
        durationMs: row?.durationMs ?? null,
        lastError: row?.lastError ?? null,
        jobId: row?.jobId ?? null,
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
      msg: 'Đã đồng bộ tài nguyên TikTok của tổ chức',
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
