import type { NotificationOrderItem } from '../types/notification-payload.types';

/** Một line item của đơn TikTok — đúng các cột đang có trong `pod_order_items`. */
export interface OrderLineForNotification {
  skuId?: string | null;
  sellerSku?: string | null;
  productName?: string | null;
  skuName?: string | null;
}

/**
 * Gộp line item thành dòng sản phẩm có số lượng.
 *
 * TikTok trả MỖI ĐƠN VỊ hàng là một line item (không có cột quantity) — 2 áo cùng SKU là 2 line
 * item. Gộp theo `sku_id` (thiếu thì theo SKU + tên + biến thể) để tin nhắn ghi "Quantity: 2" thay
 * vì lặp lại cùng một sản phẩm hai lần. Giữ thứ tự xuất hiện đầu tiên.
 */
export function groupOrderLines(lines: OrderLineForNotification[]): NotificationOrderItem[] {
  const groups = new Map<string, NotificationOrderItem>();
  for (const line of lines) {
    const key =
      line.skuId?.trim() || `${line.sellerSku ?? ''}|${line.productName ?? ''}|${line.skuName ?? ''}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    groups.set(key, {
      productName: line.productName?.trim() || null,
      sku: line.sellerSku?.trim() || null,
      variant: line.skuName?.trim() || null,
      quantity: 1,
    });
  }
  return [...groups.values()];
}
