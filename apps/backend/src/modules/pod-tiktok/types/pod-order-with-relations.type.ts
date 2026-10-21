import { Prisma } from '@prisma/client';
import type { ProductKeyIssue, SellerSkuSource } from '../shared/order-item-product-key';

/**
 * Include chuẩn khi đọc đơn TikTok: kèm items, packages và thông tin shop
 * (để hiển thị tên shop mà không phải query thêm — chống N+1).
 */
export const POD_ORDER_INCLUDE = {
  // 🔴 KHÔNG nạp `designs` của line item nữa: design đã chuyển sang **Product Mapping**
  // (`fulfillment_mapping_designs`) và được `PodOrderDesignResolver` nạp bằng MỘT truy vấn
  // cho cả trang. Quan hệ cũ `pod_order_item_designs` vẫn còn trong schema để giữ dữ liệu
  // lịch sử, nhưng join nó ở đây chỉ tốn thêm hai bảng trên mỗi lần đọc đơn.
  items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
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

type PodOrderPayload = Prisma.PodOrderGetPayload<{ include: typeof POD_ORDER_INCLUDE }>;

/**
 * Khoá sản phẩm ĐÃ GIẢI của dòng đơn (`PodOrderRepository` gắn lúc đọc — xem `order-item-product-key.ts`).
 * `sellerSku` của item là Seller SKU HIỆU LỰC (đơn, hoặc danh mục Products khi đơn rỗng). Tuỳ chọn: bản ghi dựng
 * tay (test, luồng nội bộ) không có thì coi như Seller SKU lấy từ đơn.
 */
export interface PodOrderItemKeyAnnotation {
  sellerSkuSource?: SellerSkuSource | null;
  productKeyIssue?: ProductKeyIssue | null;
}

export type PodOrderItemWithKey = PodOrderPayload['items'][number] & PodOrderItemKeyAnnotation;

export type PodOrderWithRelations = Omit<PodOrderPayload, 'items'> & { items: PodOrderItemWithKey[] };
