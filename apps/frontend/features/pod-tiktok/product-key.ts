/**
 * Khoá sản phẩm của dòng đơn = BIẾN THỂ (TikTok Product ID + TikTok SKU ID) — khoá của ánh xạ nhà cung cấp và design in.
 * Seller SKU chỉ để hiển thị; backend giải sẵn (`order-item-product-key.ts`): lấy từ đơn, hoặc từ danh mục Products khi đơn rỗng.
 */

export type SellerSkuSource = 'ORDER' | 'CATALOG';

export type ProductKeyIssue =
  | 'NO_PRODUCT_ID'
  | 'NO_SKU_ID'
  | 'VARIANT_NOT_SYNCED'
  | 'SELLER_SKU_EMPTY_ON_TIKTOK'
  | 'SELLER_SKU_AMBIGUOUS';

const KNOWN: ReadonlySet<string> = new Set<ProductKeyIssue>([
  'NO_PRODUCT_ID',
  'NO_SKU_ID',
  'VARIANT_NOT_SYNCED',
  'SELLER_SKU_EMPTY_ON_TIKTOK',
  'SELLER_SKU_AMBIGUOUS',
]);

/**
 * Khoá i18n (namespace `pod`) nói ĐÚNG lý do thiếu khoá và chỗ phải sửa — thay cho câu chung "thiếu Product ID
 * hoặc Seller SKU". Lý do lạ / chưa có (phản hồi cũ) ⇒ câu chung.
 */
export function productKeyMessageKey(issue: string | null | undefined): string {
  return issue && KNOWN.has(issue) ? `pod:productKey.issue.${issue}` : 'pod:productKey.issue.UNKNOWN';
}

/**
 * Khoá lưu ánh xạ / design của MỘT dòng đơn — cùng luật với backend `fulfillment/shared/mapping-match.ts`.
 * `sellerSku` chỉ gửi kèm để lưu hiển thị. `null` = thiếu Product ID hoặc SKU ID ⇒ không lưu được.
 */
export function productKeyOf(item: {
  productId: string | null;
  sellerSku: string | null;
  skuId?: string | null;
}): { tiktokProductId: string; tiktokSkuId: string; sellerSku?: string } | null {
  const tiktokProductId = item.productId?.trim();
  const tiktokSkuId = item.skuId?.trim();
  if (!tiktokProductId || !tiktokSkuId) return null;
  const sellerSku = item.sellerSku?.trim();
  return { tiktokProductId, tiktokSkuId, ...(sellerSku ? { sellerSku } : {}) };
}

/** Dòng đơn không có Seller SKU nhưng vẫn có khoá (SKU ID) ⇒ hiện cảnh báo KHÔNG chặn thao tác. */
export function usesSkuIdKey(item: { productId: string | null; sellerSku: string | null; skuId?: string | null }): boolean {
  const key = productKeyOf(item);
  return Boolean(key && !key.sellerSku);
}
