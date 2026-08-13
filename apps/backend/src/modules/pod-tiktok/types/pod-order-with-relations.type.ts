import { Prisma } from '@prisma/client';

/**
 * Include chuẩn khi đọc đơn TikTok: kèm items, packages và thông tin shop
 * (để hiển thị tên shop mà không phải query thêm — chống N+1).
 */
export const POD_ORDER_INCLUDE = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    // Design đi kèm item trong CÙNG một truy vấn — tránh N+1 khi màn hình danh sách
    // hiển thị thumbnail design cho mọi sản phẩm của mọi đơn.
    include: {
      designs: {
        where: { deletedAt: null },
        // Metadata file nằm ở `storage_files` (Storage Module) — nạp kèm để không N+1.
        include: {
          storageFile: { include: { uploader: { select: { id: true, fullName: true } } } },
        },
        orderBy: { placement: 'asc' },
      },
    },
  },
  packages: { orderBy: { createdAt: 'asc' } },
  shop: { select: { id: true, name: true, tiktokShopId: true, region: true } },
  // 🔴 Seller của đơn được xác định QUA ACCOUNT, không lưu bản sao trên đơn.
  // Đổi người phụ trách ⇒ mọi đơn cũ lẫn mới đều hiển thị đúng ngay, không cần backfill.
  // Nạp bằng include ⇒ danh sách đơn vẫn chỉ MỘT truy vấn (không N+1).
  account: {
    select: {
      id: true,
      accountName: true,
      sellerId: true,
      seller: { select: { id: true, user: { select: { fullName: true, email: true } } } },
      // Nhà cung cấp fulfillment cũng đi qua ACCOUNT (không lưu trên đơn) — cùng lý do với
      // seller: đổi nhà cung cấp là mọi đơn phản ánh ngay, không cần backfill.
      fulfillmentAccountId: true,
      fulfillmentAccount: {
        select: { id: true, name: true, provider: true, isActive: true },
      },
    },
  },
} as const satisfies Prisma.PodOrderInclude;

export type PodOrderWithRelations = Prisma.PodOrderGetPayload<{
  include: typeof POD_ORDER_INCLUDE;
}>;
