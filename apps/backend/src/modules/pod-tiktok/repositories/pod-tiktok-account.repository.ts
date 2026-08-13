import { Injectable } from '@nestjs/common';
import { EmployeeStatus, PodTiktokAccountStatus, PodTiktokTokenAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodTiktokSortField } from '../constants/tiktok.constants';
import {
  POD_TIKTOK_ACCOUNT_INCLUDE,
  PodTiktokAccountWithShops,
} from '../types/pod-tiktok-with-relations.type';

/**
 * Role được phép làm Seller phụ trách TikTok Account.
 * 🔴 Admin và Fulfillment KHÔNG phải seller — họ không nhận doanh số/payout.
 */
export const SELLER_ROLE_CODE = 'EMPLOYEE';

/** Một Employee đủ điều kiện làm Seller (đổ vào dropdown chọn người phụ trách). */
export interface EligibleSellerRow {
  id: string;
  user: { id: string; fullName: string; email: string };
}

/** Dữ liệu ghi cho một kết nối (đã mã hoá token ở tầng service). */
export interface PodTiktokAccountWriteData {
  accountName: string;
  openId: string;
  sellerName: string | null;
  sellerBaseRegion: string | null;
  userType: number;
  accessTokenEnc: string;
  accessTokenExpiresAt: Date;
  refreshTokenEnc: string;
  refreshTokenExpiresAt: Date;
  grantedScopes: string[];
  status: PodTiktokAccountStatus;
}

/** Dữ liệu ghi cho một shop (shopCipherEnc đã mã hoá ở tầng service). */
export interface PodTiktokShopWriteData {
  tiktokShopId: string;
  shopCipherEnc: string;
  shopCode: string | null;
  name: string;
  region: string;
  sellerType: string;
}

export interface PodTiktokFindManyParams {
  page: number;
  limit: number;
  search?: string;
  status?: PodTiktokAccountStatus;
  sortBy: PodTiktokSortField;
  sortOrder: 'asc' | 'desc';
}

/**
 * PodTiktokAccountRepository — data access cho aggregate kết nối TikTok Shop.
 *
 * Ràng buộc tenant (ADR-004): MỌI method nghiệp vụ nhận `organizationId`.
 * Repository KHÔNG mã hoá/giải mã — chỉ lưu/đọc ciphertext (service chịu trách nhiệm).
 */
@Injectable()
export class PodTiktokAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organizationId: string, id: string): Promise<PodTiktokAccountWithShops | null> {
    return this.prisma.podTiktokAccount.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: POD_TIKTOK_ACCOUNT_INCLUDE,
    });
  }

  /**
   * Tìm kết nối theo `open_id` trong Organization — KỂ CẢ bản ghi đã xoá mềm.
   * Cần bao gồm bản đã xoá vì UNIQUE(organization_id, open_id) vẫn áp dụng ⇒
   * link lại cùng seller phải khôi phục bản ghi cũ thay vì tạo mới.
   */
  findByOpenIdIncludingDeleted(
    tx: Prisma.TransactionClient,
    organizationId: string,
    openId: string,
  ): Promise<{ id: string; deletedAt: Date | null } | null> {
    return tx.podTiktokAccount.findFirst({
      where: { organizationId, openId },
      select: { id: true, deletedAt: true },
    });
  }

  /**
   * Các shop (trong Organization) đã được link bởi một kết nối KHÁC.
   * Dùng để chặn "link trùng Shop" trước khi ghi — bổ sung cho UNIQUE ở DB.
   */
  findConflictingShops(
    tx: Prisma.TransactionClient,
    organizationId: string,
    tiktokShopIds: string[],
    excludeAccountId?: string,
  ): Promise<Array<{ tiktokShopId: string; name: string }>> {
    return tx.podTiktokShop.findMany({
      where: {
        organizationId,
        tiktokShopId: { in: tiktokShopIds },
        deletedAt: null,
        ...(excludeAccountId ? { accountId: { not: excludeAccountId } } : {}),
      },
      select: { tiktokShopId: true, name: true },
    });
  }

  createAccount(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actorUserId: string,
    data: PodTiktokAccountWriteData,
  ): Promise<{ id: string }> {
    return tx.podTiktokAccount.create({
      data: {
        organizationId,
        ...data,
        grantedScopes: data.grantedScopes,
        authorizedBy: actorUserId,
        createdBy: actorUserId,
      },
      select: { id: true },
    });
  }

  /**
   * Cập nhật kết nối đã tồn tại (uỷ quyền lại / khôi phục bản đã xoá mềm).
   * Reset trạng thái lỗi vì token vừa được cấp mới.
   */
  async updateAccountTokens(
    tx: Prisma.TransactionClient,
    id: string,
    actorUserId: string,
    data: PodTiktokAccountWriteData,
  ): Promise<void> {
    await tx.podTiktokAccount.update({
      where: { id },
      data: {
        ...data,
        grantedScopes: data.grantedScopes,
        deletedAt: null,
        refreshFailureCount: 0,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastErrorRequestId: null,
        authorizedBy: actorUserId,
        updatedBy: actorUserId,
      },
    });
  }

  /**
   * Đồng bộ danh sách shop của kết nối: upsert theo (organizationId, tiktokShopId),
   * đồng thời khôi phục bản ghi đã xoá mềm khi seller link lại cùng shop.
   */
  async upsertShop(
    tx: Prisma.TransactionClient,
    organizationId: string,
    accountId: string,
    actorUserId: string,
    data: PodTiktokShopWriteData,
  ): Promise<void> {
    await tx.podTiktokShop.upsert({
      where: {
        organizationId_tiktokShopId: { organizationId, tiktokShopId: data.tiktokShopId },
      },
      create: { organizationId, accountId, ...data, createdBy: actorUserId },
      update: { accountId, ...data, deletedAt: null, updatedBy: actorUserId },
    });
  }

  /** Xoá mềm những shop không còn nằm trong danh sách TikTok trả về. */
  async softDeleteShopsNotIn(
    tx: Prisma.TransactionClient,
    accountId: string,
    keepTiktokShopIds: string[],
    actorUserId: string,
  ): Promise<void> {
    await tx.podTiktokShop.updateMany({
      where: { accountId, deletedAt: null, tiktokShopId: { notIn: keepTiktokShopIds } },
      data: { deletedAt: new Date(), updatedBy: actorUserId },
    });
  }

  /** Xoá mềm kết nối + toàn bộ shop của nó (unlink). */
  async softDeleteAccount(
    tx: Prisma.TransactionClient,
    id: string,
    actorUserId: string,
  ): Promise<void> {
    const now = new Date();
    await tx.podTiktokShop.updateMany({
      where: { accountId: id, deletedAt: null },
      data: { deletedAt: now, updatedBy: actorUserId },
    });
    await tx.podTiktokAccount.update({
      where: { id },
      data: {
        deletedAt: now,
        status: PodTiktokAccountStatus.DISCONNECTED,
        updatedBy: actorUserId,
      },
    });
  }

  /** Ghi vết thao tác token (KHÔNG lưu giá trị token). */
  async insertTokenAudit(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      accountId: string;
      action: PodTiktokTokenAction;
      success: boolean;
      errorCode?: string | null;
      tiktokRequestId?: string | null;
      accessTokenExpiresAt?: Date | null;
      refreshTokenExpiresAt?: Date | null;
      performedBy?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ): Promise<void> {
    await tx.podTiktokTokenAudit.create({
      data: {
        organizationId: data.organizationId,
        accountId: data.accountId,
        action: data.action,
        success: data.success,
        errorCode: data.errorCode ?? null,
        tiktokRequestId: data.tiktokRequestId ?? null,
        accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
        refreshTokenExpiresAt: data.refreshTokenExpiresAt ?? null,
        performedBy: data.performedBy ?? null,
        ipAddress: data.ipAddress?.slice(0, 45) ?? null,
        userAgent: data.userAgent?.slice(0, 512) ?? null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Vòng đời token (Sprint 2)
  // -------------------------------------------------------------------------

  /** Thông tin token tối thiểu — đọc lại sau khi giành khoá refresh. */
  findTokenRefById(organizationId: string, accountId: string) {
    return this.prisma.podTiktokAccount.findFirst({
      where: { id: accountId, organizationId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        accessTokenEnc: true,
        accessTokenExpiresAt: true,
        refreshTokenEnc: true,
        refreshTokenExpiresAt: true,
      },
    });
  }

  /** Ghi token mới sau khi refresh thành công (rotation) + reset trạng thái lỗi. */
  async updateTokensAfterRefresh(
    tx: Prisma.TransactionClient,
    accountId: string,
    data: {
      accessTokenEnc: string;
      accessTokenExpiresAt: Date;
      refreshTokenEnc: string;
      refreshTokenExpiresAt: Date;
      grantedScopes: string[];
    },
  ): Promise<void> {
    await tx.podTiktokAccount.update({
      where: { id: accountId },
      data: {
        ...data,
        status: PodTiktokAccountStatus.ACTIVE,
        lastRefreshedAt: new Date(),
        refreshFailureCount: 0,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastErrorRequestId: null,
      },
    });
  }

  /**
   * Ghi nhận refresh thất bại. Chỉ đổi status khi đã vượt ngưỡng lỗi liên tiếp,
   * hoặc khi lỗi thuộc loại không phục hồi được (REAUTH_REQUIRED).
   */
  async recordRefreshFailure(
    tx: Prisma.TransactionClient,
    accountId: string,
    data: {
      errorCode: string;
      errorMessage: string;
      tiktokRequestId: string | null;
      status: PodTiktokAccountStatus;
      failureThreshold: number;
    },
  ): Promise<void> {
    const current = await tx.podTiktokAccount.findUnique({
      where: { id: accountId },
      select: { refreshFailureCount: true },
    });
    const nextCount = (current?.refreshFailureCount ?? 0) + 1;
    const shouldChangeStatus =
      data.status === PodTiktokAccountStatus.REAUTH_REQUIRED ||
      nextCount >= data.failureThreshold;

    await tx.podTiktokAccount.update({
      where: { id: accountId },
      data: {
        refreshFailureCount: nextCount,
        lastErrorCode: data.errorCode,
        lastErrorMessage: data.errorMessage,
        lastErrorRequestId: data.tiktokRequestId,
        ...(shouldChangeStatus ? { status: data.status } : {}),
      },
    });
  }

  /** Đổi trạng thái kết nối kèm lý do (lưu vào lastErrorMessage để hiển thị). */
  async markStatus(
    tx: Prisma.TransactionClient,
    accountId: string,
    status: PodTiktokAccountStatus,
    reason?: string,
  ): Promise<void> {
    await tx.podTiktokAccount.update({
      where: { id: accountId },
      data: { status, ...(reason ? { lastErrorMessage: reason.slice(0, 500) } : {}) },
    });
  }

  /** Cập nhật mốc đồng bộ gần nhất của account (hiển thị "Last Sync"). */
  async touchLastSyncedAt(accountId: string, at: Date): Promise<void> {
    await this.prisma.podTiktokAccount.update({
      where: { id: accountId },
      data: { lastSyncedAt: at },
    });
  }

  /**
   * Danh sách shop cần đồng bộ.
   *
   * - Scheduler (KHÔNG có JWT) gọi không truyền `organizationId` → lấy toàn hệ thống.
   *   ⚠️ Đây là method hệ thống được phép bỏ qua tenant filter; bù lại nó LUÔN trả về
   *   `organizationId` để mọi thao tác sau đó bị ràng buộc tenant.
   * - Đồng bộ thủ công từ API **BẮT BUỘC** truyền `organizationId`: người dùng của một
   *   tổ chức không được phép kích hoạt đồng bộ (và tiêu thụ quota TikTok) cho tổ chức khác.
   *
   * Chỉ lấy account `ACTIVE`, shop bật sync và không bị circuit breaker tạm ngưng.
   */
  listShopsForSync(now: Date, organizationId?: string) {
    return this.prisma.podTiktokShop.findMany({
      where: {
        deletedAt: null,
        syncEnabled: true,
        ...(organizationId ? { organizationId } : {}),
        OR: [{ syncPausedUntil: null }, { syncPausedUntil: { lte: now } }],
        account: { deletedAt: null, status: PodTiktokAccountStatus.ACTIVE },
      },
      select: {
        id: true,
        organizationId: true,
        accountId: true,
        tiktokShopId: true,
        shopCipherEnc: true,
        name: true,
        region: true,
        lastOrderSyncCursor: true,
        backfillDone: true,
        backfillCursor: true,
        syncFailureCount: true,
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
      },
      orderBy: [{ organizationId: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Một shop cụ thể để sync thủ công (tenant-scoped). */
  findShopForSync(organizationId: string, shopId: string) {
    return this.prisma.podTiktokShop.findFirst({
      where: { id: shopId, organizationId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        accountId: true,
        tiktokShopId: true,
        shopCipherEnc: true,
        name: true,
        region: true,
        lastOrderSyncCursor: true,
        backfillDone: true,
        backfillCursor: true,
        syncFailureCount: true,
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
      },
    });
  }

  /**
   * Watermark `update_time` chỉ ĐƯỢC PHÉP TIẾN — không bao giờ lùi (bất biến hệ thống).
   *
   * 🔴 KHÔNG đặt `backfillDone` ở đây. Trước đây hàm này bật cờ ngay sau lát cửa sổ
   * đầu tiên, khiến shop bị coi là "đã kéo xong lịch sử" trong khi mới quét đúng 24h
   * của 30 ngày trước — đó là nguyên nhân thiếu đơn. Cờ này chỉ do `completeBackfill`
   * đặt, sau khi pha BACKFILL thực sự quét hết.
   */
  async advanceSyncCursor(shopId: string, cursor: bigint, syncedAt: Date): Promise<void> {
    await this.prisma.podTiktokShop.updateMany({
      where: {
        id: shopId,
        OR: [{ lastOrderSyncCursor: null }, { lastOrderSyncCursor: { lt: cursor } }],
      },
      data: {
        lastOrderSyncCursor: cursor,
        lastOrderSyncAt: syncedAt,
        syncFailureCount: 0,
        syncPausedUntil: null,
      },
    });
  }

  /**
   * Đẩy watermark `create_time` của pha BACKFILL (chỉ tiến, không lùi).
   * Cho phép kéo lịch sử qua nhiều lượt mà lượt sau không phải quét lại từ đầu.
   */
  async advanceBackfillCursor(shopId: string, cursor: bigint, syncedAt: Date): Promise<void> {
    await this.prisma.podTiktokShop.updateMany({
      where: {
        id: shopId,
        OR: [{ backfillCursor: null }, { backfillCursor: { lt: cursor } }],
      },
      data: { backfillCursor: cursor, lastOrderSyncAt: syncedAt, syncFailureCount: 0, syncPausedUntil: null },
    });
  }

  /**
   * Kết thúc pha BACKFILL: bật cờ và khởi tạo watermark `update_time` để pha
   * INCREMENTAL chạy tiếp từ đúng mốc đã quét xong (vẫn tôn trọng "chỉ tiến").
   */
  async completeBackfill(shopId: string, incrementalCursor: bigint, syncedAt: Date): Promise<void> {
    await this.prisma.podTiktokShop.update({
      where: { id: shopId },
      data: {
        backfillDone: true,
        lastOrderSyncAt: syncedAt,
        syncFailureCount: 0,
        syncPausedUntil: null,
      },
    });
    await this.advanceSyncCursor(shopId, incrementalCursor, syncedAt);
  }

  /** Đặt lại cờ backfill để kéo lại toàn bộ lịch sử (Manual Sync với `backfill=true`). */
  async resetBackfill(shopId: string): Promise<void> {
    await this.prisma.podTiktokShop.update({
      where: { id: shopId },
      data: { backfillDone: false, backfillCursor: null },
    });
  }

  /**
   * Ghi nhận một lượt sync thất bại. Trả về số lần lỗi LIÊN TIẾP sau khi tăng,
   * để service quyết định có mở circuit breaker hay không (trước đây giá trị này
   * bị hardcode = 1 nên ngưỡng không bao giờ đạt tới).
   */
  async recordShopSyncFailure(shopId: string, pausedUntil: Date | null): Promise<number> {
    const shop = await this.prisma.podTiktokShop.update({
      where: { id: shopId },
      data: {
        syncFailureCount: { increment: 1 },
        ...(pausedUntil ? { syncPausedUntil: pausedUntil } : {}),
      },
      select: { syncFailureCount: true },
    });
    return shop.syncFailureCount;
  }

  /** Gán/gỡ Seller phụ trách kết nối. `null` = bỏ phân công. */
  /** Gán / bỏ gán nhà cung cấp fulfillment cho kết nối. */
  async assignFulfillmentAccount(
    id: string,
    fulfillmentAccountId: string | null,
    actorUserId: string,
  ): Promise<void> {
    await this.prisma.podTiktokAccount.update({
      where: { id },
      data: { fulfillmentAccountId, updatedBy: actorUserId },
    });
  }

  /** Nhà cung cấp hợp lệ để gán: cùng tổ chức, chưa xoá, đang ACTIVE. */
  async isEligibleFulfillmentAccount(organizationId: string, id: string): Promise<boolean> {
    const count = await this.prisma.fulfillmentAccount.count({
      where: { id, organizationId, isActive: true, deletedAt: null },
    });
    return count > 0;
  }

  async assignSeller(id: string, sellerId: string | null, actorUserId: string): Promise<void> {
    await this.prisma.podTiktokAccount.update({
      where: { id },
      data: { sellerId, updatedBy: actorUserId },
    });
  }

  /**
   * Employee có đủ điều kiện làm Seller hay không.
   *
   * Ba điều kiện BẮT BUỘC (kiểm ngay tại DB, một truy vấn):
   *  1. Thuộc ĐÚNG Organization của người gọi (chống gán chéo tenant).
   *  2. Hồ sơ nhân sự đang `ACTIVE` (nghỉ việc/tạm ngưng thì không nhận việc mới).
   *  3. Tài khoản có Role `EMPLOYEE` — Admin và Fulfillment KHÔNG phải seller.
   */
  async isEligibleSeller(organizationId: string, employeeId: string): Promise<boolean> {
    const count = await this.prisma.employee.count({
      where: {
        id: employeeId,
        organizationId,
        deletedAt: null,
        status: EmployeeStatus.ACTIVE,
        user: { deletedAt: null, role: { code: SELLER_ROLE_CODE } },
      },
    });
    return count > 0;
  }

  /**
   * Danh sách Employee được phép chọn làm Seller (đổ vào dropdown).
   * Cùng bộ điều kiện với `isEligibleSeller` để UI và validation không bao giờ lệch nhau.
   */
  findEligibleSellers(organizationId: string, search?: string): Promise<EligibleSellerRow[]> {
    return this.prisma.employee.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: EmployeeStatus.ACTIVE,
        user: {
          deletedAt: null,
          role: { code: SELLER_ROLE_CODE },
          ...(search
            ? {
                OR: [
                  { fullName: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      select: { id: true, user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
  }

  /** Tạm ngưng sync cho shop tới thời điểm chỉ định (circuit breaker). */
  async pauseShopSync(shopId: string, pausedUntil: Date): Promise<void> {
    await this.prisma.podTiktokShop.update({
      where: { id: shopId },
      data: { syncPausedUntil: pausedUntil },
    });
  }

  async findMany(
    organizationId: string,
    params: PodTiktokFindManyParams,
  ): Promise<{ items: PodTiktokAccountWithShops[]; total: number }> {
    const where: Prisma.PodTiktokAccountWhereInput = {
      organizationId,
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? {
            OR: [
              { accountName: { contains: params.search, mode: 'insensitive' } },
              { sellerName: { contains: params.search, mode: 'insensitive' } },
              {
                shops: {
                  some: {
                    deletedAt: null,
                    name: { contains: params.search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podTiktokAccount.findMany({
        where,
        include: POD_TIKTOK_ACCOUNT_INCLUDE,
        orderBy: { [params.sortBy]: params.sortOrder },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.podTiktokAccount.count({ where }),
    ]);
    return { items, total };
  }
}
