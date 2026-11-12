import { FulfillmentProvider } from '@prisma/client';

/**
 * Global Catalog — trường nào của payload nhà cung cấp là THEO TÀI KHOẢN.
 *
 * Lớp global (`provider_catalog_*`) giữ payload ĐÃ BỎ các trường dưới đây; lớp theo tài khoản
 * (`fulfillment_account_*`) giữ payload NGUYÊN VĂN, nên không mất dữ liệu nào.
 *
 * Căn cứ (docs/fulfillment/README.md §Global Catalog):
 *   - Giá / giá vốn / phụ phí: Mango định giá theo `attributes.tier` của API key (ví dụ trong tài liệu:
 *     cùng variation, tier khác ⇒ giá khác); không nhà cung cấp nào nói giá giống nhau giữa các tài khoản.
 *   - Tồn kho / còn bán / đang hoạt động: trạng thái nhìn từ MỘT tài khoản tại MỘT thời điểm đồng bộ.
 *
 * 🔴 Nhà cung cấp KHÔNG có trong bảng ⇒ lớp global KHÔNG nhận payload (`raw_data = NULL`): chưa biết trường
 * nào là theo tài khoản thì không chép gì vào dữ liệu dùng chung.
 */
export interface ProviderRawScope {
  /** Khoá cấp 1 bị bỏ khỏi payload global. */
  dropKeys: string[];
  /** Đường dẫn lồng nhau bị bỏ (một đường, vd `['attributes', 'tier']`). */
  dropPath: string[] | null;
}

type ScopedProvider =
  | typeof FulfillmentProvider.MANGO
  | typeof FulfillmentProvider.SELLERWIX
  | typeof FulfillmentProvider.PRESSIFY;

export const GLOBAL_CATALOG_RAW_SCOPE: {
  product: Record<ScopedProvider, ProviderRawScope>;
  variant: Record<ScopedProvider, ProviderRawScope>;
  catalogue: Record<ScopedProvider, ProviderRawScope>;
} = {
  product: {
    MANGO: {
      dropKeys: ['base_price', 'currency', 'is_active', 'variations_count'],
      dropPath: null,
    },
    SELLERWIX: { dropKeys: ['active', 'additional_design_price'], dropPath: null },
    // Pressify: `accessories[].accessory_items[]` mang PHÍ theo từng bậc (`tier_id`, `fee`) ⇒ là dữ liệu giá;
    // `status` = trạng thái bán nhìn từ một lượt đồng bộ.
    PRESSIFY: { dropKeys: ['accessories', 'status'], dropPath: null },
  },
  variant: {
    MANGO: {
      dropKeys: ['price', 'stock_quantity', 'is_available'],
      dropPath: ['attributes', 'tier'],
    },
    SELLERWIX: { dropKeys: ['cost', 'active'], dropPath: null },
    // Pressify: giá theo bậc (`product_prices`) + các field giá nội bộ (tài liệu: "not what you pay") + tồn
    // kho / còn bán. Lớp global chỉ giữ thông tin mô tả biến thể (màu, size, SKU, cân nặng, ảnh…).
    PRESSIFY: {
      dropKeys: [
        'product_prices',
        'price',
        'basecost',
        'landed_cost',
        'landed_cost_twoside',
        'landed_cost_sleeve',
        'stock',
        'active',
      ],
      dropPath: null,
    },
  },
  catalogue: {
    MANGO: { dropKeys: [], dropPath: null },
    SELLERWIX: { dropKeys: [], dropPath: null },
    PRESSIFY: { dropKeys: [], dropPath: null },
  },
};

/** Đường dẫn của bậc giá trong payload biến thể — NULL với nhà cung cấp không có khái niệm này. */
export const VARIANT_TIER_PATH: Partial<Record<FulfillmentProvider, string[]>> = {
  MANGO: ['attributes', 'tier'],
};

export type CatalogLevel = keyof typeof GLOBAL_CATALOG_RAW_SCOPE;

/** Phạm vi payload của một (cấp, nhà cung cấp). `null` ⇒ nhà cung cấp chưa được khai ⇒ không chép payload. */
export function rawScopeOf(
  level: CatalogLevel,
  provider: FulfillmentProvider,
): ProviderRawScope | null {
  const table = GLOBAL_CATALOG_RAW_SCOPE[level] as Partial<
    Record<FulfillmentProvider, ProviderRawScope>
  >;
  return table[provider] ?? null;
}

/**
 * Payload global từ payload nguyên văn — CÙNG luật với SQL chiếu dữ liệu (`raw - keys #- path`).
 * Dùng cho kiểm thử và đối soát; không mutate đầu vào.
 */
export function canonicalRaw(
  level: CatalogLevel,
  provider: FulfillmentProvider,
  raw: unknown,
): unknown {
  const scope = rawScopeOf(level, provider);
  if (!scope || raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return scope ? raw : null;
  const copy = structuredClone(raw) as Record<string, unknown>;
  for (const key of scope.dropKeys) delete copy[key];
  if (scope.dropPath && scope.dropPath.length > 0) {
    let node: unknown = copy;
    for (const part of scope.dropPath.slice(0, -1)) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
    }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      delete (node as Record<string, unknown>)[scope.dropPath[scope.dropPath.length - 1]];
    }
  }
  return copy;
}
