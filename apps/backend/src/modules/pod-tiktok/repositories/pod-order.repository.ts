import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { accountScopeFilter, shopScopeFilter } from '../shared/shop-scope';
import { POD_ORDER_INCLUDE, PodOrderWithRelations } from '../types/pod-order-with-relations.type';

/** Ảnh chụp tối thiểu của đơn đã có trong DB — dùng để so sánh, KHÔNG tải nguyên bản ghi. */
export interface ExistingOrderSnapshot {
  id: string;
  tiktokOrderId: string;
  tiktokUpdateTime: bigint;
  payloadHash: string;
  recipientMasked: boolean;
  syncVersion: number;
}

/**
 * Bộ lọc đơn — phần dùng CHUNG giữa danh sách và thống kê.
 *
 * 🔴 Tách riêng khỏi phân trang/sắp xếp có chủ đích: thống kê cần đúng bộ lọc này và KHÔNG
 * cần `page`/`sortBy`. Tách ra khiến việc "thẻ thống kê phải lọc giống danh sách" trở thành
 * điều kiểu dữ liệu tự bảo đảm, thay vì một quy ước dễ quên.
 */
export interface PodOrderFilterParams {
  search?: string;
  status?: string;
  shopId?: string;
  accountId?: string;
  /**
   * 🔴 Phạm vi shop của người dùng. `undefined` = không giới hạn (`pod.shop.all`);
   * mảng RỖNG = chưa được gán shop nào ⇒ không thấy đơn nào.
   *
   * Đặt trong `PodOrderFilterParams` (chứ không ở `FindManyParams`) là có chủ đích: danh
   * sách VÀ thẻ thống kê dùng chung kiểu này, nên không thể lọc một bên mà quên bên kia.
   */
  shopScope?: string[];
  accountScope?: string[];
  orderType?: string;
  hasPodItem?: boolean;
  orderedFrom?: Date;
  orderedTo?: Date;
}

export interface PodOrderFindManyParams extends PodOrderFilterParams {
  page: number;
  limit: number;
  sortBy: 'orderedAt' | 'tiktokUpdatedAt' | 'totalAmount' | 'status' | 'lastSyncedAt';
  sortOrder: 'asc' | 'desc';
}

/**
 * PodOrderRepository — data access cho aggregate đơn TikTok.
 *
 * Tenant isolation (ADR-004): mọi method nghiệp vụ nhận `organizationId`.
 * Tối ưu hiệu năng: đọc snapshot theo LÔ (tránh N+1), ghi theo transaction.
 */
@Injectable()
export class PodOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Đọc snapshot của nhiều đơn trong MỘT query (chống N+1).
   * Trả Map để service tra cứu O(1) khi so sánh.
   */
  async findSnapshotsByTiktokOrderIds(
    organizationId: string,
    tiktokOrderIds: string[],
  ): Promise<Map<string, ExistingOrderSnapshot>> {
    if (tiktokOrderIds.length === 0) return new Map();
    const rows = await this.prisma.podOrder.findMany({
      where: { organizationId, tiktokOrderId: { in: tiktokOrderIds } },
      select: {
        id: true,
        tiktokOrderId: true,
        tiktokUpdateTime: true,
        payloadHash: true,
        recipientMasked: true,
        syncVersion: true,
      },
    });
    return new Map(rows.map((row) => [row.tiktokOrderId, row]));
  }

  /** Hash hiện tại của toàn bộ item thuộc các đơn (chống N+1 khi so sánh item). */
  async findItemHashesByOrderIds(orderIds: string[]): Promise<Map<string, Map<string, string>>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.podOrderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, tiktokLineItemId: true, payloadHash: true },
    });
    const result = new Map<string, Map<string, string>>();
    for (const row of rows) {
      let inner = result.get(row.orderId);
      if (!inner) {
        inner = new Map<string, string>();
        result.set(row.orderId, inner);
      }
      inner.set(row.tiktokLineItemId, row.payloadHash);
    }
    return result;
  }

  createOrder(
    tx: Prisma.TransactionClient,
    data: Prisma.PodOrderUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return tx.podOrder.create({ data, select: { id: true } });
  }

  async updateOrder(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.PodOrderUncheckedUpdateInput,
  ): Promise<void> {
    await tx.podOrder.update({ where: { id }, data });
  }

  /** Chỉ chạm `last_synced_at` khi đơn KHÔNG đổi — không tăng `updated_at` nghiệp vụ. */
  async touchLastSynced(tiktokOrderIds: string[], organizationId: string, at: Date): Promise<void> {
    if (tiktokOrderIds.length === 0) return;
    await this.prisma.podOrder.updateMany({
      where: { organizationId, tiktokOrderId: { in: tiktokOrderIds } },
      data: { lastSyncedAt: at },
    });
  }

  async upsertItem(
    tx: Prisma.TransactionClient,
    organizationId: string,
    orderId: string,
    data: Omit<Prisma.PodOrderItemUncheckedCreateInput, 'orderId' | 'organizationId'>,
  ): Promise<void> {
    await tx.podOrderItem.upsert({
      where: {
        orderId_tiktokLineItemId: { orderId, tiktokLineItemId: data.tiktokLineItemId },
      },
      create: { ...data, orderId, organizationId },
      update: { ...data, organizationId },
    });
  }

  /**
   * Đồng bộ packages của một đơn.
   * KHÔNG xoá package cũ nếu TikTok không còn trả về — chỉ thêm/giữ (nguyên tắc
   * "không xoá dữ liệu khi TikTok không yêu cầu").
   */
  async upsertPackages(
    tx: Prisma.TransactionClient,
    organizationId: string,
    orderId: string,
    tiktokPackageIds: string[],
  ): Promise<void> {
    if (tiktokPackageIds.length === 0) return;
    await tx.podOrderPackage.createMany({
      data: tiktokPackageIds.map((tiktokPackageId) => ({
        organizationId,
        orderId,
        tiktokPackageId,
      })),
      skipDuplicates: true,
    });
  }

  // -------------------------------------------------------------------------
  // Truy vấn phục vụ API
  // -------------------------------------------------------------------------

  findById(organizationId: string, id: string): Promise<PodOrderWithRelations | null> {
    return this.prisma.podOrder.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: POD_ORDER_INCLUDE,
    });
  }

  /**
   * Điều kiện lọc đơn — dùng CHUNG cho danh sách và cho thống kê.
   *
   * 🔴 Một hàm, một nơi. Trước đây danh sách có bộ lọc còn `countByStatus` thì không, nên các
   * thẻ thống kê luôn hiện số liệu TOÀN HỆ THỐNG trong khi bảng bên dưới đã lọc — hai con số
   * mâu thuẫn nhau trên cùng một màn hình. Tách thành hai bản sao là mời lỗi đó quay lại ngay
   * lần thêm bộ lọc tiếp theo.
   */
  private buildWhere(
    organizationId: string,
    params: PodOrderFilterParams,
  ): Prisma.PodOrderWhereInput {
    // 🔴 GIAO phạm vi được gán với bộ lọc người dùng chọn — không bao giờ gán đè. Gán đè là
    // bug bảo mật: chỉ cần gửi `?shopId=<shop người khác>` là đọc được đơn của shop đó.
    const shopFilter = shopScopeFilter(params.shopScope, params.shopId);
    const accountFilter = accountScopeFilter(params.accountScope, params.accountId);

    return {
      organizationId,
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(shopFilter === undefined ? {} : { shopId: shopFilter }),
      ...(accountFilter === undefined ? {} : { accountId: accountFilter }),
      ...(params.orderType ? { orderType: params.orderType } : {}),
      ...(params.hasPodItem !== undefined ? { hasPodItem: params.hasPodItem } : {}),
      ...(params.orderedFrom || params.orderedTo
        ? {
            orderedAt: {
              ...(params.orderedFrom ? { gte: params.orderedFrom } : {}),
              ...(params.orderedTo ? { lte: params.orderedTo } : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { tiktokOrderId: { contains: params.search, mode: 'insensitive' } },
              { trackingNumber: { contains: params.search, mode: 'insensitive' } },
              { buyerEmail: { contains: params.search, mode: 'insensitive' } },
              { buyerNickname: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async findMany(
    organizationId: string,
    params: PodOrderFindManyParams,
  ): Promise<{ items: PodOrderWithRelations[]; total: number }> {
    const where = this.buildWhere(organizationId, params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podOrder.findMany({
        where,
        include: POD_ORDER_INCLUDE,
        orderBy: { [params.sortBy]: params.sortOrder },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.podOrder.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Thống kê cho các thẻ ở đầu màn hình danh sách (một query GROUP BY, không N+1).
   *
   * 🔴 Nhận CÙNG bộ lọc với `findMany` và dựng WHERE bằng CÙNG một hàm. Thẻ "Completed" phải
   * đếm đúng những đơn mà bảng bên dưới đang hiển thị — nếu không, người dùng nhìn thấy
   * "1.240 đơn hoàn thành" ngay phía trên một bảng có 3 dòng.
   */
  countByStatus(organizationId: string, params: PodOrderFilterParams = {}) {
    return this.prisma.podOrder.groupBy({
      by: ['status'],
      where: this.buildWhere(organizationId, params),
      _count: { _all: true },
    });
  }
}
