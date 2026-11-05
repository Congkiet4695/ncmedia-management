/**
 * Ghép một line item của đơn TikTok với **Product Mapping** / **Design** tương ứng.
 *
 * 🔴 KHOÁ SẢN PHẨM = **BIẾN THỂ**: `TikTok Product ID + TikTok SKU ID` (`pod_order_items.product_id` + `sku_id`).
 *   - SKU ID có trên mọi dòng đơn, do TikTok cấp, và chỉ thuộc đúng một sản phẩm.
 *   - Seller SKU KHÔNG phải khoá: nhiều biến thể của một sản phẩm có thể chung một Seller SKU, và ghép theo nó khiến
 *     chúng dùng chung SKU nhà cung cấp và file in. Cột `seller_sku` được giữ để hiển thị và đối chiếu.
 *   - KHÔNG có đường dự phòng theo Seller SKU / Title / Variant Name / Image. Thiếu khoá ⇒ không ghép (`null`): một
 *     quy tắc dự phòng mơ hồ chính là cách hệ thống lặng lẽ gán design của biến thể này sang biến thể khác.
 *
 * 🔴 BẢN GHI LEGACY (`legacy_shared_key = true`, migration `20261105090000`): cấu hình cũ khai theo Seller SKU mà khoá đó
 * ứng với nhiều biến thể, nên không biết nó thuộc biến thể nào. Bản ghi này có khoá riêng (`legacyKeyOf`) trong cùng chỉ
 * mục và KHÔNG BAO GIỜ được `lookupForItem` trả về. Chỉ `lookupLegacyForItem` đọc nó, để màn Fulfill đề xuất cho người
 * vận hành xác nhận áp dụng cho một biến thể (`FulfillmentService.adoptLegacyConfig`).
 *
 * 🔴 Hàm THUẦN, không phụ thuộc Nest/Prisma client — cố ý. Nhiều module cần đúng luật này:
 *   - `FulfillmentReadinessService` (quyết định đơn có gửi được không)
 *   - `PodOrderDesignResolver`      (đọc design để hiển thị trên màn hình đơn)
 *
 * Nếu mỗi bên tự viết một bản, chúng sẽ trôi khỏi nhau và màn hình sẽ báo "đã có design"
 * cho một đơn mà lúc gửi backend lại bảo "thiếu ánh xạ". Một luật, một nơi.
 *
 * Đặt ở `shared/` và không import gì của Nest để `pod-tiktok` dùng được mà KHÔNG phải import
 * `FulfillmentModule` — tránh vòng phụ thuộc module (fulfillment vốn đã phụ thuộc pod-tiktok).
 */

/** Phần khoá TikTok của một Product Mapping / Design — chỉ những trường dùng để ghép. */
export interface ProductKeyRow {
  tiktokProductId: string | null;
  sellerSku: string | null;
  tiktokSkuId?: string | null;
  legacySharedKey?: boolean;
}

export interface MappingMatchKey extends ProductKeyRow {
  isActive: boolean;
}

/** Phần khoá TikTok của một line item. */
export interface OrderItemMatchKey {
  productId: string | null;
  skuId?: string | null;
  sellerSku: string | null;
}

/** Ký tự phân tách khoá — không xuất hiện trong product_id (số) hay seller_sku của TikTok. */
const KEY_SEPARATOR = '\u0000';

/**
 * Cặp (Product ID, Seller SKU) đã chuẩn hoá. KHÔNG định danh biến thể — chỉ dùng cho dữ liệu vốn theo Seller SKU: kết quả
 * rà gợi ý ánh xạ (`fulfillment_mapping_candidates`) và phần dưới của `legacyKeyOf`.
 *
 * `trim` vì dữ liệu nhập tay hay dính khoảng trắng đầu/cuối; KHÔNG đổi hoa/thường vì SKU của
 * người bán phân biệt hoa thường (`POSTER_24x36` khác `poster_24x36` trên TikTok).
 */
export function mappingKeyOf(
  productId: string | null | undefined,
  sellerSku: string | null | undefined,
): string | null {
  const product = productId?.trim();
  const sku = sellerSku?.trim();
  if (!product || !sku) return null;
  return `${product}${KEY_SEPARATOR}${sku}`;
}

/** Khoá BIẾN THỂ (Product ID, TikTok SKU ID) — danh tính của mapping / design. `null` khi thiếu một trong hai. */
export function skuIdKeyOf(
  productId: string | null | undefined,
  tiktokSkuId: string | null | undefined,
): string | null {
  const product = productId?.trim();
  const skuId = tiktokSkuId?.trim();
  if (!product || !skuId) return null;
  return `${product}${KEY_SEPARATOR}${KEY_SEPARATOR}${skuId}`;
}

/** Khoá của bản ghi legacy. Ba ký tự phân tách ⇒ không bao giờ trùng khoá biến thể. */
function legacyKeyOf(
  productId: string | null | undefined,
  sellerSku: string | null | undefined,
): string | null {
  const pair = mappingKeyOf(productId, sellerSku);
  return pair ? `${KEY_SEPARATOR}${KEY_SEPARATOR}${KEY_SEPARATOR}${pair}` : null;
}

/** Danh tính của MỘT bản ghi mapping / design trong chỉ mục. */
export function rowKeyOf(row: ProductKeyRow): string | null {
  return row.legacySharedKey
    ? legacyKeyOf(row.tiktokProductId, row.sellerSku)
    : skuIdKeyOf(row.tiktokProductId, row.tiktokSkuId);
}

/** Khoá để tra cho MỘT line item — chỉ có khoá biến thể. */
export function itemKeysOf(item: OrderItemMatchKey): string[] {
  const key = skuIdKeyOf(item.productId, item.skuId);
  return key ? [key] : [];
}

/** Dòng đơn có khoá biến thể để khai ánh xạ / design không. */
export function itemHasProductKey(item: OrderItemMatchKey): boolean {
  return itemKeysOf(item).length > 0;
}

/** Tra một bảng (đã dựng bằng `rowKeyOf`) cho line item — ĐÚNG biến thể, không bao giờ trả bản ghi legacy. */
export function lookupForItem<T>(item: OrderItemMatchKey, index: Map<string, T>): T | null {
  for (const key of itemKeysOf(item)) {
    const hit = index.get(key);
    if (hit !== undefined) return hit;
  }
  return null;
}

/**
 * Bản ghi legacy cùng Seller SKU với line item — CHỈ để đề xuất xác nhận, không được dùng để gửi đơn. Đề xuất theo Seller
 * SKU là chấp nhận được vì không có gì được áp dụng khi người vận hành chưa xem và bấm xác nhận.
 */
export function lookupLegacyForItem<T>(item: OrderItemMatchKey, index: Map<string, T>): T | null {
  const key = legacyKeyOf(item.productId, item.sellerSku);
  return key ? (index.get(key) ?? null) : null;
}

/**
 * Khoá để LƯU một mapping / design cho line item. `sellerSku` chỉ là thông tin kèm theo, KHÔNG tham gia danh tính.
 * `null` khi thiếu Product ID hoặc SKU ID.
 */
export function storageKeyForItem(item: OrderItemMatchKey): ProductKey | null {
  const tiktokProductId = item.productId?.trim();
  const tiktokSkuId = item.skuId?.trim();
  if (!tiktokProductId || !tiktokSkuId) return null;
  return { tiktokProductId, tiktokSkuId, sellerSku: item.sellerSku?.trim() || null };
}

/**
 * Chỉ mục ánh xạ theo khoá — dựng MỘT lần rồi tra O(1) cho từng line item.
 *
 * Màn hình đơn hàng có 20 đơn × nhiều sản phẩm; quét tuyến tính danh sách ánh xạ cho mỗi
 * dòng là O(đơn × ánh xạ), tăng theo cả hai chiều khi tổ chức lớn dần.
 *
 * Chỉ nhận ánh xạ đang bật. Trùng khoá thì bản ĐẦU TIÊN thắng — trong thực tế không xảy ra
 * vì DB đã có partial UNIQUE theo biến thể; người gọi tự quyết thứ tự nếu muốn ưu tiên khác.
 */
export function createMappingIndex<T extends MappingMatchKey>(mappings: T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const mapping of mappings) {
    if (!mapping.isActive) continue;
    const key = rowKeyOf(mapping);
    if (!key || index.has(key)) continue;
    index.set(key, mapping);
  }
  return index;
}

/** Tra ánh xạ của một line item trong chỉ mục đã dựng. */
export function findMappingInIndex<T>(item: OrderItemMatchKey, index: Map<string, T>): T | null {
  return lookupForItem(item, index);
}

/**
 * Tra ánh xạ của một line item từ danh sách.
 *
 * Tiện cho nơi chỉ ghép vài dòng. Ghép cả trang đơn hàng thì dựng `createMappingIndex` một
 * lần rồi dùng `findMappingInIndex`.
 */
export function findMappingForItem<T extends MappingMatchKey>(
  item: OrderItemMatchKey,
  mappings: T[],
): T | null {
  return findMappingInIndex(item, createMappingIndex(mappings));
}

/**
 * Product ID của các line item — để THU HẸP truy vấn ánh xạ/design về đúng sản phẩm của đơn.
 *
 * Giữ cả bản gốc lẫn bản đã `trim`: ánh xạ khai tay lưu bản đã `trim` (DTO), ánh xạ tự động chép
 * nguyên giá trị của line item. Đây chỉ là bộ lọc thô ở DB — ghép chính xác vẫn là
 * `createMappingIndex` + `findMappingInIndex`.
 */
export function productIdsOf(items: Array<Pick<OrderItemMatchKey, 'productId'>>): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.productId) continue;
    const trimmed = item.productId.trim();
    if (!trimmed) continue;
    ids.add(item.productId);
    ids.add(trimmed);
  }
  return [...ids];
}

/** Danh tính đã chuẩn hoá của một mapping / design. `sellerSku` chỉ là thông tin kèm theo. */
export interface ProductKey {
  tiktokProductId: string;
  tiktokSkuId: string;
  sellerSku: string | null;
}

/** Chuẩn hoá khoá nhận từ client / bản ghi. `null` ⇒ khoá không hợp lệ (thiếu Product ID hoặc SKU ID). */
export function normalizeProductKey(input: {
  tiktokProductId?: string | null;
  sellerSku?: string | null;
  tiktokSkuId?: string | null;
}): ProductKey | null {
  return storageKeyForItem({
    productId: input.tiktokProductId ?? null,
    sellerSku: input.sellerSku ?? null,
    skuId: input.tiktokSkuId ?? null,
  });
}

/** Điều kiện lọc ĐÚNG danh tính (dùng làm `where` Prisma) — không bao giờ khớp bản ghi legacy. */
export function productKeyFilter(
  key: ProductKey,
): { tiktokProductId: string; tiktokSkuId: string; legacySharedKey: false } {
  return { tiktokProductId: key.tiktokProductId, tiktokSkuId: key.tiktokSkuId, legacySharedKey: false };
}
