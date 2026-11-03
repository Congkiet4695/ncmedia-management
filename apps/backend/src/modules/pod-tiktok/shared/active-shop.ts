import { PodTiktokAccountStatus, PodTiktokShopStatus, type Prisma } from '@prisma/client';

/**
 * Shop "đang hoạt động" — dùng được để ĐĂNG sản phẩm.
 *
 * Cả hai vế, cùng quy ước với đồng bộ sản phẩm (`pod-product-sync.repository`) và bộ lọc
 * `activeShopsOnly` của Listing Review:
 *
 *   - Shop `ACTIVE`: có trong Get Authorized Shops VÀ Get Active Shops. `INACTIVE` (bị TikTok
 *     tạm ngưng) và `DEAUTHORIZED` (mất uỷ quyền) không nhận sản phẩm mới.
 *   - Kết nối TikTok `ACTIVE`: token còn dùng được. `REAUTH_REQUIRED` / `DEAUTHORIZED` /
 *     `DISCONNECTED` / `ERROR` / `PENDING` ⇒ mọi lệnh gọi API của shop đều thất bại.
 *
 * Không phải điều kiện chung cho mọi màn hình: danh sách / bộ lọc dữ liệu lịch sử (Products,
 * Orders…) vẫn cần thấy shop đã ngưng.
 */
export const ACTIVE_SHOP_WHERE = {
  deletedAt: null,
  status: PodTiktokShopStatus.ACTIVE,
  account: { deletedAt: null, status: PodTiktokAccountStatus.ACTIVE },
} satisfies Prisma.PodTiktokShopWhereInput;

/** Phần `select` đủ để chạy `isShopActive`. */
export const ACTIVE_SHOP_STATUS_SELECT = {
  deletedAt: true,
  status: true,
  account: { select: { deletedAt: true, status: true } },
} satisfies Prisma.PodTiktokShopSelect;

export interface ShopActivity {
  deletedAt: Date | null;
  status: PodTiktokShopStatus;
  account: { deletedAt: Date | null; status: PodTiktokAccountStatus } | null;
}

/** Cùng luật với `ACTIVE_SHOP_WHERE`, cho bản ghi đã đọc lên. */
export function isShopActive(shop: ShopActivity): boolean {
  return (
    shop.deletedAt === null &&
    shop.status === PodTiktokShopStatus.ACTIVE &&
    shop.account !== null &&
    shop.account.deletedAt === null &&
    shop.account.status === PodTiktokAccountStatus.ACTIVE
  );
}
