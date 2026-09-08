import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { PodOrderWithRelations } from '../types/pod-order-with-relations.type';

/** Ảnh CHÍNH của một sản phẩm — hai cỡ cho hai chỗ dùng khác nhau. */
export interface ResolvedProductImage {
  /** Cỡ nhỏ — dùng cho thumbnail trong danh sách đơn. */
  thumbUrl: string;
  /** Cỡ đầy đủ — dùng khi mở bộ xem ảnh. */
  url: string;
}

/**
 * Khoá tra cứu: một sản phẩm được định danh bằng cặp (shop, mã sản phẩm TikTok).
 *
 * 🔴 Phải là CẶP, không chỉ mã sản phẩm: `pod_products` có unique `(shop_id,
 * tiktok_product_id)`, nên về mặt lược đồ hai shop hoàn toàn có thể cùng mang một mã. Tra
 * bằng mã trần là mở đường cho ảnh của shop này hiện trên đơn của shop khác.
 */
function keyOf(shopId: string, tiktokProductId: string): string {
  return `${shopId}::${tiktokProductId}`;
}

/**
 * PodOrderProductImageResolver — lấy **ảnh CHÍNH của sản phẩm** cho danh sách đơn.
 *
 * 🔴 Vì sao cần resolver riêng thay vì dùng thẳng `pod_order_items.sku_image`: trường đó là
 * `line_items[].sku_image` của TikTok — **ảnh của BIẾN THỂ** (đúng màu/size khách đặt), không
 * phải ảnh đại diện của sản phẩm. Đo trên dữ liệu thật: **161/161** dòng đơn đang hiển thị
 * ảnh khác với ảnh chính của sản phẩm.
 *
 * 🔴 Vì sao không đi qua khoá ngoại: `pod_order_items` KHÔNG có FK tới `pod_products` —
 * `product_id` chỉ là chuỗi mã TikTok. Đơn được lưu độc lập với việc sản phẩm đã đồng bộ hay
 * chưa (đơn về trước, sản phẩm đồng bộ sau là chuyện bình thường). Nên phải ghép bằng
 * (shop, mã sản phẩm) ở tầng ứng dụng.
 *
 * 🔴 Ảnh chính = `pod_product_images` có `variant_id IS NULL` (định nghĩa sẵn trong lược đồ),
 * lấy `sort_order` nhỏ nhất. KHÔNG lấy ảnh biến thể, ảnh design, ảnh mockup hay ảnh nhà cung
 * cấp làm phương án dự phòng: sản phẩm chưa đồng bộ thì trả `null` và giao diện hiện ô trống
 * — một ô trống nói đúng sự thật, còn một ảnh sai thì không.
 *
 * Gom theo LÔ giống `PodOrderDesignResolver`: một truy vấn cho cả trang đơn, không N+1.
 */
@Injectable()
export class PodOrderProductImageResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ảnh chính theo `orderItemId` cho một tập đơn.
   *
   * Trả `Map` rỗng khi không có đơn nào hoặc không dòng nào có mã sản phẩm — màn hình hiển
   * thị đúng sự thật thay vì lỗi.
   */
  async resolveForOrders(
    organizationId: string,
    orders: PodOrderWithRelations[],
  ): Promise<Map<string, ResolvedProductImage>> {
    const result = new Map<string, ResolvedProductImage>();
    if (orders.length === 0) return result;

    const tiktokProductIds = [
      ...new Set(
        orders.flatMap((order) =>
          order.items
            .map((item) => item.productId)
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    if (tiktokProductIds.length === 0) return result;

    const products = await this.prisma.podProduct.findMany({
      where: {
        organizationId,
        tiktokProductId: { in: tiktokProductIds },
        deletedAt: null,
      },
      select: {
        shopId: true,
        tiktokProductId: true,
        images: {
          // `variant_id IS NULL` chính là định nghĩa "ảnh của sản phẩm" trong lược đồ —
          // xem chú thích ở `PodProductImage.variantId`.
          where: { variantId: null },
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { url: true, thumbUrl: true },
        },
      },
    });

    const imageByProduct = new Map<string, ResolvedProductImage>();
    for (const product of products) {
      const image = product.images[0];
      if (!image) continue;
      // Sản phẩm có bản ghi ảnh nhưng thiếu cả hai link ⇒ coi như không có ảnh, không dựng
      // một `<img src="">` hỏng.
      const url = image.url ?? image.thumbUrl;
      if (!url) continue;
      imageByProduct.set(keyOf(product.shopId, product.tiktokProductId), {
        url,
        thumbUrl: image.thumbUrl ?? url,
      });
    }

    for (const order of orders) {
      for (const item of order.items) {
        if (!item.productId) continue;
        const image = imageByProduct.get(keyOf(order.shopId, item.productId));
        if (image) result.set(item.id, image);
      }
    }

    return result;
  }
}
