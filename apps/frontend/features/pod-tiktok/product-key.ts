/**
 * Khoá sản phẩm của dòng đơn (TikTok Product ID + Seller SKU) — khoá của ánh xạ nhà cung cấp và design in.
 * Backend giải sẵn (`order-item-product-key.ts`): Seller SKU lấy từ đơn, hoặc từ danh mục Products khi đơn rỗng.
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
 * Khoá lưu ánh xạ / design của MỘT dòng đơn — cùng luật với backend `fulfillment/shared/mapping-match.ts`:
 * Seller SKU hiệu lực nếu có; biến thể KHÔNG có Seller SKU trên TikTok ⇒ TikTok SKU ID (không gửi `sellerSku`).
 * `null` = thiếu Product ID hoặc thiếu cả hai ⇒ không lưu được.
 *
 * 🔴 Không bao giờ gửi Seller SKU rỗng / chỉ khoảng trắng làm khoá, không tự sinh Seller SKU.
 */
export function productKeyOf(item: {
  productId: string | null;
  sellerSku: string | null;
  skuId?: string | null;
}): { tiktokProductId: string; sellerSku?: string; tiktokSkuId?: string } | null {
  const tiktokProductId = item.productId?.trim();
  if (!tiktokProductId) return null;
  const sellerSku = item.sellerSku?.trim();
  const tiktokSkuId = item.skuId?.trim();
  if (sellerSku) return { tiktokProductId, sellerSku, ...(tiktokSkuId ? { tiktokSkuId } : {}) };
  return tiktokSkuId ? { tiktokProductId, tiktokSkuId } : null;
}

/** Dòng đơn không có Seller SKU nhưng vẫn có khoá (SKU ID) ⇒ hiện cảnh báo KHÔNG chặn thao tác. */
export function usesSkuIdKey(item: { productId: string | null; sellerSku: string | null; skuId?: string | null }): boolean {
  const key = productKeyOf(item);
  return Boolean(key && !key.sellerSku);
}
