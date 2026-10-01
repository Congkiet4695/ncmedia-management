import { Injectable } from '@nestjs/common';
import {
  PodTiktokAccountStatus,
  PodTiktokShopStatus,
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
 * Shop TRONG PHẠM VI một lượt đồng bộ, kèm đủ trạng thái để PHÂN LOẠI trước khi gọi TikTok.
 *
 * Khác `ProductSyncTarget` ở chỗ nó gồm cả shop KHÔNG đủ điều kiện (kết nối hết hạn, shop
 * ngừng hoạt động, tắt đồng bộ) — để lượt "Sync Products" báo được shop nào bị bỏ qua và vì
 * sao, thay vì chúng lặng lẽ biến mất khỏi kết quả.
 */
export interface ProductSyncCandidate extends ProductSyncTarget {
  status: PodTiktokShopStatus;
  productSyncEnabled: boolean;
  account: ProductSyncTarget['account'] & { status: PodTiktokAccountStatus };
}

/** Bộ lọc phạm vi chung của `findSyncTargets` / `findSyncCandidates`. */
export interface ProductSyncScopeParams {
  organizationId?: string;
  accountId?: string;
  shopId?: string;
  /**
   * 🔴 Giới hạn theo phạm vi shop của NGƯỜI DÙNG (`PodAccessScopeService`).
   *
   * Khác hẳn `shopId`: `shopId` là bộ lọc do người dùng CHỌN, còn đây là hàng rào người
   * dùng KHÔNG chọn được. Không có nó, một Seller bấm "Sync Now" mà bỏ trống bộ lọc sẽ
   * quét toàn bộ shop của tổ chức — kể cả những shop chưa từng được gán cho họ.
   *
   * `undefined` = không giới hạn (Admin, hoặc tiến trình nền). Mảng RỖNG là hợp lệ và có
   * nghĩa "không được phép chạm shop nào" — không phải "không lọc".
   */
  shopIds?: string[];
}

/**
 * PodProductSyncRepository — dữ liệu phục vụ VẬN HÀNH đồng bộ: chọn shop, watermark,
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
  findSyncTargets(params: ProductSyncScopeParams): Promise<ProductSyncTarget[]> {
    return this.prisma.podTiktokShop.findMany({
      where: {
        ...this.scopeWhere(params),
        productSyncEnabled: true,
        // 🔴 Shop ngừng hoạt động / không còn uỷ quyền (ghi bởi Shop Sync) bị loại NGAY tại
        // truy vấn — không gọi Product API cho shop mà TikTok đã báo là không hoạt động.
        status: PodTiktokShopStatus.ACTIVE,
        account: { deletedAt: null, status: PodTiktokAccountStatus.ACTIVE },
      },
      select: SYNC_TARGET_SELECT,
      orderBy: { productSyncedAt: 'asc' },
    });
  }

  /**
   * MỌI shop trong phạm vi (kể cả không đủ điều kiện) — để lượt "Sync Products" phân loại
   * ĐỒNG BỘ / BỎ QUA kèm lý do. Chỉ loại shop & kết nối đã xoá mềm.
   */
  findSyncCandidates(params: ProductSyncScopeParams): Promise<ProductSyncCandidate[]> {
    return this.prisma.podTiktokShop.findMany({
      where: { ...this.scopeWhere(params), account: { deletedAt: null } },
      select: {
        ...SYNC_TARGET_SELECT,
        status: true,
        productSyncEnabled: true,
        account: { select: { ...SYNC_TARGET_SELECT.account.select, status: true } },
      },
      orderBy: { productSyncedAt: 'asc' },
    });
  }

  /**
   * Điều kiện phạm vi dùng chung.
   *
   * 🔴 `shopId` và `shopIds` là phép GIAO (`AND`), không phải gán đè lên cùng một khoá `id` —
   * gán đè để `shopIds` (hàng rào) thắng thì đúng, nhưng để `shopId` thắng là lỗ hổng. `AND`
   * loại bỏ hẳn câu hỏi "khoá nào thắng".
   */
  private scopeWhere(params: ProductSyncScopeParams): Prisma.PodTiktokShopWhereInput {
    return {
      deletedAt: null,
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      ...(params.accountId ? { accountId: params.accountId } : {}),
      AND: [
        ...(params.shopId ? [{ id: params.shopId }] : []),
        ...(params.shopIds ? [{ id: { in: params.shopIds } }] : []),
      ],
    };
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
}
