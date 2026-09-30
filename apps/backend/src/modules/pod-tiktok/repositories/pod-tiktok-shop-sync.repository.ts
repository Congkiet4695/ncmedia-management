import { Injectable } from '@nestjs/common';
import { PodTiktokShopStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { accountScopeFilter } from '../shared/shop-scope';

/** Kết nối + shop cần đối chiếu — đầu vào của MỘT lượt Shop Sync theo kết nối. */
const SHOP_SYNC_ACCOUNT_SELECT = {
  id: true,
  organizationId: true,
  accountName: true,
  status: true,
  accessTokenEnc: true,
  accessTokenExpiresAt: true,
  refreshTokenEnc: true,
  refreshTokenExpiresAt: true,
  shops: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, tiktokShopId: true, name: true, status: true },
  },
} satisfies Prisma.PodTiktokAccountSelect;

export type ShopSyncAccount = Prisma.PodTiktokAccountGetPayload<{
  select: typeof SHOP_SYNC_ACCOUNT_SELECT;
}>;

/** Dữ liệu TikTok trả về cho MỘT shop (cipher đã mã hoá ở tầng service). */
export interface ShopSyncWriteData {
  name: string;
  region: string;
  shopCode: string | null;
  sellerType: string;
  shopCipherEnc: string;
  status: PodTiktokShopStatus;
}

/**
 * PodTiktokShopSyncRepository — dữ liệu của lượt **Shop Sync** (đối chiếu shop với TikTok).
 *
 * Tách khỏi `PodTiktokAccountRepository` (vòng đời kết nối/OAuth/token): Shop Sync chỉ GHI ĐÈ
 * đúng những trường TikTok trả về cho shop + trạng thái shop. Kho mặc định, cờ đồng bộ,
 * watermark đơn/sản phẩm… là dữ liệu CỤC BỘ và không bao giờ bị đụng tới ở đây.
 *
 * Ràng buộc tenant (ADR-004): mọi truy vấn đọc nhận `organizationId`; mọi lệnh ghi khoá theo
 * CẢ `organizationId` lẫn `accountId` của kết nối đang xử lý.
 */
@Injectable()
export class PodTiktokShopSyncRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Kết nối (kèm shop) thuộc phạm vi người dùng.
   *
   * @param accountScope `undefined` = không giới hạn (`pod.shop.all`); mảng RỖNG = chưa được
   *                     gán kết nối nào ⇒ trả rỗng, KHÔNG phải trả tất cả.
   * @param accountId    Bộ lọc người dùng chọn — GIAO với phạm vi, không bao giờ nới ra.
   */
  findAccounts(
    organizationId: string,
    params: { accountScope?: string[]; accountId?: string },
  ): Promise<ShopSyncAccount[]> {
    const idFilter = accountScopeFilter(params.accountScope, params.accountId);
    return this.prisma.podTiktokAccount.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(idFilter === undefined ? {} : { id: idFilter }),
      },
      select: SHOP_SYNC_ACCOUNT_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Ghi dữ liệu TikTok vừa trả về cho một shop + xoá lỗi của lượt trước. */
  async applyTiktokShop(
    scope: { organizationId: string; accountId: string; shopId: string },
    data: ShopSyncWriteData,
    checkedAt: Date,
    actorUserId: string,
  ): Promise<void> {
    await this.prisma.podTiktokShop.updateMany({
      where: {
        id: scope.shopId,
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        deletedAt: null,
      },
      data: {
        ...data,
        statusCheckedAt: checkedAt,
        lastStatusErrorCode: null,
        lastStatusErrorMessage: null,
        updatedBy: actorUserId,
      },
    });
  }

  /**
   * Shop KHÔNG còn trong Get Authorized Shops ⇒ `DEAUTHORIZED`.
   *
   * 🔴 KHÔNG xoá mềm: đơn hàng, sản phẩm, listing, payout còn trỏ vào shop này. Chỉ ghi trạng
   * thái để Product Sync bỏ qua nó; seller uỷ quyền lại là OAuth callback khôi phục như cũ.
   */
  async markDeauthorized(
    scope: { organizationId: string; accountId: string; shopId: string },
    checkedAt: Date,
    actorUserId: string,
  ): Promise<void> {
    await this.prisma.podTiktokShop.updateMany({
      where: {
        id: scope.shopId,
        organizationId: scope.organizationId,
        accountId: scope.accountId,
        deletedAt: null,
      },
      data: {
        status: PodTiktokShopStatus.DEAUTHORIZED,
        statusCheckedAt: checkedAt,
        lastStatusErrorCode: null,
        lastStatusErrorMessage: null,
        updatedBy: actorUserId,
      },
    });
  }

  /**
   * Ghi lỗi của lượt Shop Sync cho các shop của một kết nối.
   *
   * 🔴 KHÔNG đổi `status`: không đọc được TikTok ≠ shop ngừng hoạt động. Giữ trạng thái đã
   * biết gần nhất và chỉ ghi lỗi để người vận hành thấy.
   */
  async recordError(
    scope: { organizationId: string; accountId: string },
    error: { code: string | null; message: string },
    actorUserId: string,
  ): Promise<void> {
    await this.prisma.podTiktokShop.updateMany({
      where: { organizationId: scope.organizationId, accountId: scope.accountId, deletedAt: null },
      data: {
        lastStatusErrorCode: error.code?.slice(0, 20) ?? null,
        lastStatusErrorMessage: error.message.slice(0, 500),
        updatedBy: actorUserId,
      },
    });
  }
}
