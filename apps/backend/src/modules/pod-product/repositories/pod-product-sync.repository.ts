import { Injectable } from '@nestjs/common';
import {
  PodProductSyncAction,
  PodProductSyncScope,
  PodProductSyncStatus,
  PodProductSyncTrigger,
  PodTiktokAccountStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/** Shop + credential của account — đầu vào của một lượt đồng bộ sản phẩm. */
export interface ProductSyncTarget {
  id: string;
  organizationId: string;
  accountId: string;
  tiktokShopId: string;
  shopCipherEnc: string;
  name: string;
  productSyncCursor: bigint | null;
  account: {
    id: string;
    organizationId: string;
    accountName: string;
    accessTokenEnc: string;
    accessTokenExpiresAt: Date;
    refreshTokenEnc: string;
    refreshTokenExpiresAt: Date;
  };
}

const SYNC_TARGET_SELECT = {
  id: true,
  organizationId: true,
  accountId: true,
  tiktokShopId: true,
  shopCipherEnc: true,
  name: true,
  productSyncCursor: true,
  account: {
    select: {
      id: true,
      organizationId: true,
      accountName: true,
      accessTokenEnc: true,
      accessTokenExpiresAt: true,
      refreshTokenEnc: true,
      refreshTokenExpiresAt: true,
    },
  },
} satisfies Prisma.PodTiktokShopSelect;

/**
 * PodProductSyncRepository — dữ liệu phục vụ VẬN HÀNH đồng bộ: chọn shop, ghi lịch sử,
 * ghi log từng sản phẩm, cập nhật watermark.
 *
 * Tách khỏi `PodProductRepository` (đọc/ghi sản phẩm) vì hai vòng đời khác nhau: bảng
 * lịch sử/log là dữ liệu vận hành, xoá theo retention, không soft delete.
 */
@Injectable()
export class PodProductSyncRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Danh sách shop đủ điều kiện đồng bộ.
   *
   * Điều kiện: shop chưa xoá + bật `productSyncEnabled` + account ACTIVE và chưa xoá.
   * 🔴 Account ở trạng thái `REAUTH_REQUIRED`/`DEAUTHORIZED` bị loại NGAY tại truy vấn —
   * gọi TikTok với token chết chỉ tổ đốt quota chung của app (quota theo App × Shop).
   */
  findSyncTargets(params: {
    organizationId?: string;
    accountId?: string;
    shopId?: string;
  }): Promise<ProductSyncTarget[]> {
    return this.prisma.podTiktokShop.findMany({
      where: {
        deletedAt: null,
        productSyncEnabled: true,
        ...(params.organizationId ? { organizationId: params.organizationId } : {}),
        ...(params.accountId ? { accountId: params.accountId } : {}),
        ...(params.shopId ? { id: params.shopId } : {}),
        account: { deletedAt: null, status: PodTiktokAccountStatus.ACTIVE },
      },
      select: SYNC_TARGET_SELECT,
      orderBy: { productSyncedAt: 'asc' },
    });
  }

  /** Mở một lượt đồng bộ (`RUNNING`) — trả về id để ghi log theo lượt. */
  async startHistory(data: {
    organizationId: string;
    accountId: string;
    shopId: string | null;
    scope: PodProductSyncScope;
    trigger: PodProductSyncTrigger;
    watermarkFrom: bigint | null;
    watermarkTo: bigint | null;
    triggeredBy: string | null;
  }): Promise<string> {
    const history = await this.prisma.podProductSyncHistory.create({
      data: { ...data, status: PodProductSyncStatus.RUNNING, startedAt: new Date() },
      select: { id: true },
    });
    return history.id;
  }

  /** Đóng lượt đồng bộ với số liệu tổng kết. */
  async finishHistory(
    id: string,
    data: {
      status: PodProductSyncStatus;
      productsFetched: number;
      productsCreated: number;
      productsUpdated: number;
      productsSkipped: number;
      productsFailed: number;
      pagesFetched: number;
      apiCalls: number;
      startedAt: Date;
      errorCode?: string | null;
      errorMessage?: string | null;
      tiktokRequestId?: string | null;
    },
  ): Promise<void> {
    const finishedAt = new Date();
    await this.prisma.podProductSyncHistory.update({
      where: { id },
      data: {
        status: data.status,
        productsFetched: data.productsFetched,
        productsCreated: data.productsCreated,
        productsUpdated: data.productsUpdated,
        productsSkipped: data.productsSkipped,
        productsFailed: data.productsFailed,
        pagesFetched: data.pagesFetched,
        apiCalls: data.apiCalls,
        finishedAt,
        durationMs: finishedAt.getTime() - data.startedAt.getTime(),
        errorCode: data.errorCode ?? null,
        errorMessage: data.errorMessage?.slice(0, 2000) ?? null,
        tiktokRequestId: data.tiktokRequestId ?? null,
      },
    });
  }

  /**
   * Ghi log kết quả của từng sản phẩm.
   *
   * Ghi theo LÔ để một shop nghìn sản phẩm không sinh nghìn round-trip.
   */
  async insertLogs(
    rows: Array<{
      organizationId: string;
      historyId: string;
      productId: string | null;
      tiktokProductId: string;
      action: PodProductSyncAction;
      message?: string | null;
      errorCode?: string | null;
      tiktokRequestId?: string | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.podProductSyncLog.createMany({
      data: rows.map((row) => ({
        ...row,
        message: row.message?.slice(0, 1000) ?? null,
      })),
    });
  }

  /**
   * Cập nhật watermark sau lượt đồng bộ THÀNH CÔNG.
   *
   * 🔴 Chỉ đẩy watermark khi lượt chạy không có sản phẩm lỗi: đẩy mốc trong khi còn
   * sản phẩm chưa lấy được nghĩa là vĩnh viễn bỏ qua chúng ở các lượt sau.
   */
  async updateWatermark(shopId: string, cursor: bigint | null): Promise<void> {
    await this.prisma.podTiktokShop.update({
      where: { id: shopId },
      data: {
        ...(cursor === null ? {} : { productSyncCursor: cursor }),
        productSyncedAt: new Date(),
        productSyncFailureCount: 0,
      },
    });
  }

  /** Tăng bộ đếm lỗi liên tiếp (circuit breaker theo shop). */
  async incrementFailure(shopId: string): Promise<number> {
    const shop = await this.prisma.podTiktokShop.update({
      where: { id: shopId },
      data: { productSyncFailureCount: { increment: 1 }, productSyncedAt: new Date() },
      select: { productSyncFailureCount: true },
    });
    return shop.productSyncFailureCount;
  }

  /** Lịch sử đồng bộ (phân trang) cho màn hình Sync History. */
  async findHistories(
    organizationId: string,
    params: { page: number; limit: number; accountId?: string; shopId?: string },
  ) {
    const where: Prisma.PodProductSyncHistoryWhereInput = {
      organizationId,
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.shopId ? { shopId: params.shopId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podProductSyncHistory.findMany({
        where,
        include: {
          account: { select: { id: true, accountName: true } },
          shop: { select: { id: true, name: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.podProductSyncHistory.count({ where }),
    ]);

    return { items, total };
  }

  /** Chi tiết log của một lượt — trả lời "sản phẩm nào lỗi và vì sao". */
  findLogs(organizationId: string, historyId: string, limit: number) {
    return this.prisma.podProductSyncLog.findMany({
      where: { organizationId, historyId },
      orderBy: [{ action: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
  }
}
