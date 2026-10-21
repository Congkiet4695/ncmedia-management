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
