import { Prisma } from '@prisma/client';

/**
 * Include chuẩn khi đọc kết nối TikTok: kèm danh sách shop (chưa bị xoá mềm),
 * sắp xếp ổn định để "shop đầu tiên" hiển thị nhất quán giữa các lần gọi.
 */
export const POD_TIKTOK_ACCOUNT_INCLUDE = {
  shops: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    // Kho mặc định của shop (Warehouse Mapping) — màn hình cần TÊN, không chỉ id.
    include: { defaultWarehouse: { select: { id: true, name: true, tiktokWarehouseId: true } } },
  },
  // Seller phụ trách (Employee) — kèm User để lấy họ tên + email hiển thị.
  // Nạp bằng include ⇒ danh sách account chỉ tốn MỘT truy vấn, không N+1.
  seller: { select: { id: true, status: true, user: { select: { fullName: true, email: true } } } },
  // Nhà cung cấp fulfillment đang gán — nạp kèm để bảng hiển thị tên/trạng thái mà không N+1.
  fulfillmentAccount: { select: { id: true, name: true, provider: true, isActive: true } },
} as const satisfies Prisma.PodTiktokAccountInclude;

export type PodTiktokAccountWithShops = Prisma.PodTiktokAccountGetPayload<{
  include: typeof POD_TIKTOK_ACCOUNT_INCLUDE;
}>;
