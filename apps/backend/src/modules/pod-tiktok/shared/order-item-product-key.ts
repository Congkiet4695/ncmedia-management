/**
 * **Khoá sản phẩm của một dòng đơn** = (TikTok Product ID + Seller SKU) — khoá của Product Mapping (ánh xạ nhà
 * cung cấp) và của design in (`mapping-match.ts`).
 *
 * 🔴 Vấn đề thật (đối chiếu dữ liệu 2026-10-21): TikTok trả `line_items[].seller_sku = ""` khi biến thể CHƯA có
 * Seller SKU tại thời điểm đặt đơn — ~23% dòng đơn. Đơn là ẢNH CHỤP: seller đặt Seller SKU sau đó thì đơn cũ vẫn
 * mang chuỗi rỗng, trong khi danh mục Products (đồng bộ lại) đã có. Không có Seller SKU ⇒ không có khoá ⇒ không
 * khai được ánh xạ, không tra được design ("Dòng hàng thiếu Product ID hoặc Seller SKU…").
 *
 * Luật khôi phục (CHỈ khi chắc chắn):
 *  - Đơn có Seller SKU ⇒ dùng nguyên văn (`ORDER`), không bao giờ ghi đè.
 *  - Đơn rỗng ⇒ tra biến thể trong danh mục Products đã đồng bộ khớp ĐÚNG cả ba: cùng shop của đơn, cùng TikTok
 *    Product ID, cùng TikTok SKU ID. Đúng MỘT Seller SKU khác rỗng ⇒ dùng nó (`CATALOG`).
 *  - Nhiều Seller SKU khác nhau ⇒ KHÔNG chọn (`SELLER_SKU_AMBIGUOUS`). Không có biến thể ⇒ `VARIANT_NOT_SYNCED`.
 *    Có biến thể nhưng cũng rỗng ⇒ `SELLER_SKU_EMPTY_ON_TIKTOK`. Không bao giờ đoán theo tên / SKU gần giống, và
 *    không ghi đè dữ liệu đơn đã lưu — khôi phục ở lúc ĐỌC, nên Seller SKU đặt bổ sung trên TikTok có hiệu lực
 *    ngay khi danh mục đồng bộ lại.
 */

export type SellerSkuSource = 'ORDER' | 'CATALOG';

export type ProductKeyIssue =
  /** Dòng đơn không có TikTok Product ID. */
  | 'NO_PRODUCT_ID'
  /** Đơn không có Seller SKU và cũng không có TikTok SKU ID để tra danh mục. */
  | 'NO_SKU_ID'
  /** Biến thể chưa có trong danh mục Products đã đồng bộ (sản phẩm ngừng bán / chưa đồng bộ). */
  | 'VARIANT_NOT_SYNCED'
  /** Biến thể có trong danh mục nhưng trên TikTok cũng KHÔNG có Seller SKU. */
  | 'SELLER_SKU_EMPTY_ON_TIKTOK'
  /** Danh mục có nhiều Seller SKU khác nhau cho cùng biến thể — không tự chọn. */
  | 'SELLER_SKU_AMBIGUOUS';

export interface ItemKeyInput {
  id: string;
  productId: string | null;
  skuId: string | null;
  sellerSku: string | null;
}

/** Một biến thể trong danh mục Products đã đồng bộ. */
export interface CatalogVariantRow {
  shopId: string;
  tiktokProductId: string;
  tiktokSkuId: string;
  sellerSku: string | null;
}

export interface ItemKeyResolution {
  /** Seller SKU dùng làm khoá (đơn hoặc danh mục) — `null` khi không xác định được. */
  sellerSku: string | null;
  sellerSkuSource: SellerSkuSource | null;
  productKeyIssue: ProductKeyIssue | null;
}

const blank = (value: string | null | undefined): boolean => !value || value.trim() === '';

/** Dòng nào cần tra danh mục (đơn có Product ID + SKU ID nhưng không có Seller SKU). */
export function needsCatalogLookup(item: ItemKeyInput): boolean {
  return !blank(item.productId) && blank(item.sellerSku) && !blank(item.skuId);
}

const catalogKey = (shopId: string, productId: string, skuId: string) => `${shopId}|${productId}|${skuId}`;

export function resolveItemProductKeys(
  shopId: string,
  items: readonly ItemKeyInput[],
  catalog: readonly CatalogVariantRow[],
): Map<string, ItemKeyResolution> {
  const skusByVariant = new Map<string, Set<string>>();
  for (const row of catalog) {
    const key = catalogKey(row.shopId, row.tiktokProductId, row.tiktokSkuId);
    const set = skusByVariant.get(key) ?? new Set<string>();
    if (!blank(row.sellerSku)) set.add((row.sellerSku as string).trim());
    skusByVariant.set(key, set);
  }

  const result = new Map<string, ItemKeyResolution>();
  for (const item of items) {
    if (blank(item.productId)) {
      result.set(item.id, { sellerSku: blank(item.sellerSku) ? null : item.sellerSku, sellerSkuSource: blank(item.sellerSku) ? null : 'ORDER', productKeyIssue: 'NO_PRODUCT_ID' });
      continue;
    }
    if (!blank(item.sellerSku)) {
      result.set(item.id, { sellerSku: item.sellerSku, sellerSkuSource: 'ORDER', productKeyIssue: null });
      continue;
    }
    if (blank(item.skuId)) {
      result.set(item.id, { sellerSku: null, sellerSkuSource: null, productKeyIssue: 'NO_SKU_ID' });
      continue;
    }
    const skus = skusByVariant.get(catalogKey(shopId, item.productId as string, item.skuId as string));
    if (!skus) {
      result.set(item.id, { sellerSku: null, sellerSkuSource: null, productKeyIssue: 'VARIANT_NOT_SYNCED' });
    } else if (skus.size === 0) {
      result.set(item.id, { sellerSku: null, sellerSkuSource: null, productKeyIssue: 'SELLER_SKU_EMPTY_ON_TIKTOK' });
    } else if (skus.size > 1) {
      result.set(item.id, { sellerSku: null, sellerSkuSource: null, productKeyIssue: 'SELLER_SKU_AMBIGUOUS' });
    } else {
      result.set(item.id, { sellerSku: [...skus][0], sellerSkuSource: 'CATALOG', productKeyIssue: null });
    }
  }
  return result;
}

/**
 * Số biến thể TikTok (SKU ID khác nhau) trong danh mục Products đã đồng bộ đang mang CÙNG Seller SKU với dòng đơn —
 * cùng shop, cùng TikTok Product ID. Khoá `(Product ID + Seller SKU)` của ánh xạ / design gom tất cả các biến thể đó
 * vào MỘT Product Mapping (một Fulfillment SKU): đúng ý khi người bán đặt chung mã cho mọi size/màu cùng phôi, nhưng
 * sai size/màu nếu phôi khác nhau. Số > 1 ⇒ readiness CẢNH BÁO (không chặn — quyết định PO 2026-11-03 giữ khoá).
 *
 * Chỉ tính dòng có Seller SKU hiệu lực; dòng không có trong danh mục ⇒ không có mục (không đoán).
 */
export function countVariantsSharingSellerSku(
  shopId: string,
  items: ReadonlyArray<{ id: string; productId: string | null; sellerSku: string | null }>,
  catalog: readonly CatalogVariantRow[],
): Map<string, number> {
  const skuIdsByKey = new Map<string, Set<string>>();
  for (const row of catalog) {
    if (blank(row.sellerSku)) continue;
    const key = catalogKey(row.shopId, row.tiktokProductId, (row.sellerSku as string).trim());
    const set = skuIdsByKey.get(key) ?? new Set<string>();
    set.add(row.tiktokSkuId);
    skuIdsByKey.set(key, set);
  }
  const result = new Map<string, number>();
  for (const item of items) {
    if (blank(item.productId) || blank(item.sellerSku)) continue;
    const skuIds = skuIdsByKey.get(catalogKey(shopId, (item.productId as string).trim(), (item.sellerSku as string).trim()));
    if (skuIds) result.set(item.id, skuIds.size);
  }
  return result;
}

/** Câu hướng dẫn cho từng lý do — backend dùng trong readiness, nói rõ phải sửa ở ĐÂU. */
export const PRODUCT_KEY_ISSUE_MESSAGE: Readonly<Record<ProductKeyIssue, string>> = {
  NO_PRODUCT_ID: 'Dòng hàng không có TikTok Product ID — đồng bộ lại đơn từ TikTok.',
  NO_SKU_ID: 'Dòng hàng không có Seller SKU và không có TikTok SKU ID để tra danh mục — đồng bộ lại đơn từ TikTok.',
  // 🔴 Hai lý do dưới KHÔNG chặn fulfill (quyết định PO 2026-11-03): dòng còn TikTok SKU ID ⇒ ánh xạ / design khai theo
  // khoá Product ID + SKU ID (fulfillment/shared/mapping-match.ts). Câu chữ là CẢNH BÁO, nói rõ khoá đang dùng.
  VARIANT_NOT_SYNCED:
    'Dòng hàng không có Seller SKU và biến thể chưa có trong danh mục Products đã đồng bộ — ánh xạ và design khai ' +
    'theo Product ID + TikTok SKU ID của biến thể. Nếu biến thể thật ra CÓ Seller SKU trên TikTok, đồng bộ sản phẩm ' +
    '(Products → Đồng bộ) để dùng chung ánh xạ / design theo Seller SKU.',
  SELLER_SKU_EMPTY_ON_TIKTOK:
    'Biến thể này trên TikTok không có Seller SKU (cả trong đơn lẫn danh mục Products) — ánh xạ và design khai theo ' +
    'Product ID + TikTok SKU ID của biến thể; không cần sửa trên TikTok để fulfill.',
  SELLER_SKU_AMBIGUOUS:
    'Danh mục Products có NHIỀU Seller SKU khác nhau cho cùng biến thể này — hệ thống không tự chọn. Kiểm tra lại ' +
    'Seller SKU của biến thể trên TikTok rồi đồng bộ sản phẩm.',
};
