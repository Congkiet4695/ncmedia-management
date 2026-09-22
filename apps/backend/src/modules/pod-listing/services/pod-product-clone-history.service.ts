import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PodListingJobItemStatus,
  PodListingJobStatus,
  PodListingJobType,
  PodListingLogLevel,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  PodShopForbiddenException,
  type PodAccessScope,
} from '../../pod-tiktok/services/pod-access-scope.service';
import {
  SHOP_CONNECTION_SELECT,
  connectionNameOf,
  type ShopWithConnection,
} from '../../pod-tiktok/shared/shop-identity';
import type { PodProductCloneQueryDto, PodProductCloneStatus } from '../dto/pod-product-clone-history.dto';
import { PodListingJobService } from './pod-listing-job.service';

/** Trạng thái job đã đóng sổ — mọi item đều ở trạng thái cuối. */
const FINAL_JOB_STATUSES: PodListingJobStatus[] = [
  PodListingJobStatus.COMPLETED,
  PodListingJobStatus.COMPLETED_WITH_ERRORS,
  PodListingJobStatus.FAILED,
  PodListingJobStatus.CANCELLED,
];

/**
 * Lọc theo trạng thái tổng ⇒ điều kiện Prisma tương đương với `cloneStatusOf` (đếm từ item).
 *
 * 🔴 Không lọc bằng trạng thái job cho các trạng thái cuối: job gộp SKIPPED vào "có lỗi"
 * (COMPLETED_WITH_ERRORS / FAILED), còn màn hình này phân biệt "đã có sản phẩm" với "hỏng".
 */
const WHERE_BY_CLONE_STATUS: Record<PodProductCloneStatus, Prisma.PodListingJobWhereInput> = {
  PENDING: { status: PodListingJobStatus.PENDING },
  PROCESSING: { status: PodListingJobStatus.PROCESSING },
  SUCCESS: {
    status: { in: FINAL_JOB_STATUSES },
    items: { none: { status: { not: PodListingJobItemStatus.SUCCESS } } },
  },
  SKIPPED: {
    status: { in: FINAL_JOB_STATUSES },
    items: { none: { status: { not: PodListingJobItemStatus.SKIPPED } } },
  },
  FAILED: {
    status: { in: FINAL_JOB_STATUSES },
    AND: [
      { items: { none: { status: PodListingJobItemStatus.SUCCESS } } },
      { items: { some: { status: { in: [PodListingJobItemStatus.FAILED, PodListingJobItemStatus.CANCELLED] } } } },
    ],
  },
  PARTIAL: {
    status: { in: FINAL_JOB_STATUSES },
    AND: [
      { items: { some: { status: PodListingJobItemStatus.SUCCESS } } },
      { items: { some: { status: { not: PodListingJobItemStatus.SUCCESS } } } },
    ],
  },
};

export interface CloneCounts {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  processing: number;
  pending: number;
  cancelled: number;
}

/**
 * Trạng thái tổng của lượt — **đếm từ item**, xem DTO.
 *
 * SKIPPED chỉ xuất hiện khi shop đích ĐÃ CÓ sản phẩm (chống trùng — lý do cuối cùng), không
 * phải lỗi ⇒ lượt toàn SKIPPED là `SKIPPED`, không phải `FAILED`. Lượt có SUCCESS lẫn SKIPPED
 * là `PARTIAL`: không phải shop nào cũng được lượt này tạo.
 */
export function cloneStatusOf(jobStatus: PodListingJobStatus, counts: CloneCounts): PodProductCloneStatus {
  if (jobStatus === PodListingJobStatus.PENDING) return 'PENDING';
  if (jobStatus === PodListingJobStatus.PROCESSING || counts.pending + counts.processing > 0) return 'PROCESSING';
  if (counts.total > 0 && counts.success === counts.total) return 'SUCCESS';
  if (counts.success > 0) return 'PARTIAL';
  if (counts.failed + counts.cancelled > 0) return 'FAILED';
  return counts.skipped > 0 ? 'SKIPPED' : 'FAILED';
}

/** Trạng thái item còn "đang chạy" — thanh tiến độ và polling dựa vào đây. */
const RUNNING_ITEM_STATUSES: ReadonlySet<PodListingJobItemStatus> = new Set([
  PodListingJobItemStatus.PENDING,
  PodListingJobItemStatus.PROCESSING,
  PodListingJobItemStatus.RETRYING,
]);

const CLONE_BATCH_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      shop: { select: { id: true, name: true, region: true, ...SHOP_CONNECTION_SELECT } },
      product: {
        select: {
          id: true,
          title: true,
          tiktokProductId: true,
          shop: { select: { id: true, name: true, region: true, ...SHOP_CONNECTION_SELECT } },
          images: {
            where: { variantId: null },
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { url: true, thumbUrl: true },
          },
        },
      },
      // 🔴 Product Mapping: `pod_listing_payloads` là nguồn chính "sản phẩm nguồn đã lên shop
      // đích thành sản phẩm nào" (`tiktok_product_id` / `tiktok_draft_id`, review status).
      payload: {
        select: { id: true, status: true, tiktokProductId: true, tiktokDraftId: true, reviewStatus: true, publishedAt: true },
      },
    },
  },
} satisfies Prisma.PodListingJobInclude;

type CloneJobRow = Prisma.PodListingJobGetPayload<{ include: typeof CLONE_BATCH_INCLUDE }>;

export class PodProductCloneNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_PRODUCT_CLONE_NOT_FOUND', message: 'Không tìm thấy lượt nhân bản' });
  }
}

/**
 * PodProductCloneHistoryService — màn hình **Clone Products / Clone History**.
 *
 * Không có bảng riêng: một lượt nhân bản = một `PodListingJob` (`type = CLONE`), mỗi shop đích =
 * một `PodListingJobItem` (trạng thái, lỗi, remote id độc lập), nội dung đã gửi + id sản phẩm
 * đích = `PodListingPayload` (Product Mapping). Service này chỉ ĐỌC và uỷ quyền retry cho
 * `PodListingJobService` — không có đường xử lý thứ hai.
 *
 * 🔴 Phạm vi: Seller (không có `pod.shop.all`) chỉ thấy lượt do CHÍNH MÌNH tạo; Admin thấy toàn
 * bộ tổ chức. Cả hai vẫn bị chặn theo shop bởi `assertJobInScope` khi mở chi tiết / retry.
 */
@Injectable()
export class PodProductCloneHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: PodListingJobService,
  ) {}

  async list(organizationId: string, userId: string, query: PodProductCloneQueryDto, scope: PodAccessScope) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.PodListingJobWhereInput = {
      organizationId,
      deletedAt: null,
      type: PodListingJobType.CLONE,
      ...this.ownershipFilter(userId, scope),
      ...(query.createdBy && scope.allShops ? { createdBy: query.createdBy } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      // Sản phẩm nguồn / shop nguồn / shop đích đều nằm ở item — lọc qua quan hệ. Mỗi bộ lọc
      // là một điều kiện `items.some` RIÊNG (AND): gộp vào một khoá `items` là bộ lọc sau đè
      // bộ lọc trước.
      AND: [
        ...(query.status ? [WHERE_BY_CLONE_STATUS[query.status]] : []),
        ...(query.search
          ? [
              {
                items: {
                  some: {
                    product: {
                      OR: [
                        { title: { contains: query.search, mode: 'insensitive' as const } },
                        { tiktokProductId: { contains: query.search } },
                      ],
                    },
                  },
                },
              },
            ]
          : []),
        ...(query.sourceShopId ? [{ items: { some: { product: { shopId: query.sourceShopId } } } }] : []),
        ...(query.targetShopId ? [{ items: { some: { shopId: query.targetShopId } } }] : []),
      ],
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.podListingJob.findMany({
        where,
        include: CLONE_BATCH_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podListingJob.count({ where }),
    ]);

    const creators = await this.creatorsOf(rows);
    return {
      items: rows.map((row) => this.toBatch(row, creators)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
      // Admin: danh sách người đã tạo lượt trong tổ chức — nguồn cho bộ lọc "Người tạo". Seller
      // không có bộ lọc này (chỉ thấy của mình) ⇒ rỗng.
      creators: scope.allShops ? await this.allCreators(organizationId) : [],
    };
  }

  async get(organizationId: string, userId: string, id: string, scope: PodAccessScope) {
    const row = await this.loadOwned(organizationId, userId, id, scope);
    const creators = await this.creatorsOf([row]);
    const errorDetails = await this.errorDetailsOf(row);
    return this.toBatch(row, creators, errorDetails);
  }

  /**
   * Chạy lại các shop đích **FAILED** — chỉ FAILED. Shop SUCCESS / SKIPPED (đã có sản phẩm)
   * KHÔNG được chạy lại: chạy lại SUCCESS là tạo sản phẩm trùng trên sàn.
   *
   * `itemId` ⇒ chỉ shop đó (phải đang FAILED). Uỷ quyền cho `PodListingJobService.retry` —
   * cùng hàng đợi, cùng pipeline `processCloneItem`, cùng log.
   */
  async retryFailed(organizationId: string, userId: string, id: string, scope: PodAccessScope, itemId?: string) {
    const row = await this.loadOwned(organizationId, userId, id, scope);
    const failed = row.items.filter((item) => item.status === PodListingJobItemStatus.FAILED);
    const targets = itemId ? failed.filter((item) => item.id === itemId) : failed;
    if (targets.length === 0) {
      throw new BadRequestException({
        code: 'POD_PRODUCT_CLONE_NOTHING_TO_RETRY',
        message: itemId
          ? 'Shop này không ở trạng thái thất bại — chỉ chạy lại được shop FAILED.'
          : 'Không có shop nào thất bại để chạy lại.',
      });
    }
    // Shop đích phải còn trong phạm vi người bấm — quyền có thể đã bị thu hẹp sau khi tạo lượt.
    for (const item of targets) {
      if (!scope.allShops && !scope.shopIds.includes(item.shopId)) throw new PodShopForbiddenException();
    }
    await this.jobs.retry(organizationId, userId, id, { itemIds: targets.map((item) => item.id) }, scope);
    return this.get(organizationId, userId, id, scope);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private ownershipFilter(userId: string, scope: PodAccessScope): Prisma.PodListingJobWhereInput {
    return scope.allShops ? {} : { createdBy: userId };
  }

  private async loadOwned(organizationId: string, userId: string, id: string, scope: PodAccessScope): Promise<CloneJobRow> {
    const row = await this.prisma.podListingJob.findFirst({
      where: { id, organizationId, deletedAt: null, type: PodListingJobType.CLONE, ...this.ownershipFilter(userId, scope) },
      include: CLONE_BATCH_INCLUDE,
    });
    if (!row) throw new PodProductCloneNotFoundException();
    // Seller: mọi shop đích của lượt phải trong phạm vi (lượt do mình tạo nhưng shop có thể đã bị gỡ).
    if (!scope.allShops && row.items.some((item) => !scope.shopIds.includes(item.shopId))) {
      throw new PodShopForbiddenException();
    }
    return row;
  }

  /** Mọi người đã tạo lượt nhân bản trong tổ chức (distinct createdBy) — cho bộ lọc của Admin. */
  private async allCreators(organizationId: string): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.prisma.podListingJob.findMany({
      where: { organizationId, deletedAt: null, type: PodListingJobType.CLONE, createdBy: { not: null } },
      distinct: ['createdBy'],
      select: { createdBy: true },
    });
    const ids = rows.map((row) => row.createdBy).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
    return users.map((user) => ({ id: user.id, name: user.fullName }));
  }

  private async creatorsOf(rows: CloneJobRow[]): Promise<Map<string, { id: string; fullName: string; email: string }>> {
    const ids = [...new Set(rows.map((row) => row.createdBy).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  /**
   * Chi tiết lỗi từng shop = dòng log ERROR gần nhất của item (mã TikTok, request id, blockers…).
   * Chỉ lấy ở màn chi tiết — danh sách không cần và không nên kéo log.
   */
  private async errorDetailsOf(row: CloneJobRow): Promise<Map<string, Prisma.JsonValue>> {
    const failedIds = row.items
      .filter((item) => item.status === PodListingJobItemStatus.FAILED || item.status === PodListingJobItemStatus.SKIPPED)
      .map((item) => item.id);
    if (failedIds.length === 0) return new Map();
    const logs = await this.prisma.podListingLog.findMany({
      where: { jobId: row.id, listingItemId: { in: failedIds }, level: PodListingLogLevel.ERROR },
      orderBy: { createdAt: 'desc' },
      select: { listingItemId: true, message: true, payload: true, createdAt: true },
    });
    const result = new Map<string, Prisma.JsonValue>();
    for (const log of logs) {
      if (!log.listingItemId || result.has(log.listingItemId)) continue;
      result.set(log.listingItemId, { message: log.message, at: log.createdAt.toISOString(), ...(isObject(log.payload) ? log.payload : {}) });
    }
    return result;
  }

  private toBatch(
    row: CloneJobRow,
    creators: Map<string, { id: string; fullName: string; email: string }>,
    errorDetails: Map<string, Prisma.JsonValue> = new Map(),
  ) {
    const counts: CloneCounts = { total: row.items.length, success: 0, failed: 0, skipped: 0, processing: 0, pending: 0, cancelled: 0 };
    for (const item of row.items) {
      if (item.status === PodListingJobItemStatus.SUCCESS) counts.success += 1;
      else if (item.status === PodListingJobItemStatus.FAILED) counts.failed += 1;
      else if (item.status === PodListingJobItemStatus.SKIPPED) counts.skipped += 1;
      else if (item.status === PodListingJobItemStatus.CANCELLED) counts.cancelled += 1;
      else if (item.status === PodListingJobItemStatus.PENDING) counts.pending += 1;
      else counts.processing += 1;
    }
    const completed = counts.total - counts.pending - counts.processing;

    // Sản phẩm nguồn: mọi item của lượt CLONE cùng một sản phẩm — lấy từ item đầu.
    const source = row.items[0]?.product ?? null;
    const creator = row.createdBy ? creators.get(row.createdBy) : undefined;

    return {
      id: row.id,
      name: row.name,
      status: cloneStatusOf(row.status, counts),
      jobStatus: row.status,
      market: row.market,
      product: source
        ? {
            id: source.id,
            title: source.title,
            tiktokProductId: source.tiktokProductId,
            thumbnailUrl: source.images[0]?.thumbUrl ?? source.images[0]?.url ?? null,
          }
        : null,
      sourceShop: source?.shop ? this.shopOf(source.shop) : null,
      counts,
      progress: { completed, total: counts.total },
      running: row.items.some((item) => RUNNING_ITEM_STATUSES.has(item.status)),
      createdBy: creator ? { id: creator.id, name: creator.fullName, email: creator.email } : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      lastError: row.lastError,
      targets: row.items.map((item) => ({
        id: item.id,
        shop: this.shopOf(item.shop),
        status: item.status,
        remoteProductId: item.remoteProductId,
        tiktokProductId: item.payload?.tiktokProductId ?? item.remoteProductId,
        tiktokDraftId: item.payload?.tiktokDraftId ?? null,
        reviewStatus: item.payload?.reviewStatus ?? null,
        payloadId: item.payload?.id ?? null,
        error: item.error,
        errorCode: item.errorCode,
        errorDetail: errorDetails.get(item.id) ?? null,
        retryCount: item.retryCount,
        nextAttemptAt: item.nextAttemptAt?.toISOString() ?? null,
        startedAt: item.startedAt?.toISOString() ?? null,
        finishedAt: item.finishedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
  }

  private shopOf(shop: { id: string; name: string; region: string | null } & ShopWithConnection) {
    return { id: shop.id, name: shop.name, region: shop.region ?? null, connectionName: connectionNameOf(shop) };
  }
}

function isObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
