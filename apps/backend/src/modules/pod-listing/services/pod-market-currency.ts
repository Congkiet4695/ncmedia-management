import { PodListingMarket } from '@prisma/client';

/**
 * Tiền tệ của một listing — quyết ở SERVER theo shop / thị trường.
 *
 * 🔴 Vì sao tồn tại: TikTok bắt buộc `skus[].price.currency` (lỗi `36009004 — Currency of Price
 * is a required field`). Trước đây currency chỉ có hai nguồn: Pricing Template hoặc SKU
 * Template. Sản phẩm nhập tay (Custom Listing) không đi qua hai mẫu đó ⇒ giá có mà tiền tệ
 * `null` ⇒ TikTok từ chối cả sản phẩm sau khi đã upload xong ảnh.
 *
 * Tiền tệ là thuộc tính của **shop** (TikTok Shop US bán bằng USD, không có cách nào khác), nên
 * nguồn đáng tin nhất là `region` của shop đích, rồi tới `market` của lượt đăng. Mã tiền tệ mẫu
 * khai chỉ là phương án dự phòng cho vùng chưa có trong bảng — và bảng này là NƠI DUY NHẤT biết
 * "thị trường nào dùng tiền gì"; frontend chỉ giữ bản sao để hiển thị.
 */
export const POD_MARKET_CURRENCY: Record<PodListingMarket, string> = {
  US: 'USD',
  UK: 'GBP',
  EU: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  IE: 'EUR',
  AU: 'AUD',
  JP: 'JPY',
  SG: 'SGD',
  MY: 'MYR',
  TH: 'THB',
  VN: 'VND',
  PH: 'PHP',
  ID: 'IDR',
  BR: 'BRL',
  MX: 'MXN',
};

/**
 * `region` của shop do TikTok trả về (Get Authorized Shops) dùng mã ISO — Vương quốc Anh là
 * `GB`, còn thị trường trong hệ thống gọi là `UK`. Các mã khác trùng với thị trường.
 */
const SHOP_REGION_ALIAS: Record<string, PodListingMarket> = {
  GB: PodListingMarket.UK,
};

export function currencyForMarket(market: string | null | undefined): string | null {
  if (!market) return null;
  const code = market.trim().toUpperCase();
  return code in POD_MARKET_CURRENCY ? POD_MARKET_CURRENCY[code as PodListingMarket] : null;
}

export function currencyForShopRegion(region: string | null | undefined): string | null {
  if (!region) return null;
  const code = region.trim().toUpperCase();
  return currencyForMarket(SHOP_REGION_ALIAS[code] ?? code);
}

export type ListingCurrencySource = 'SHOP' | 'MARKET' | 'TEMPLATE';

/**
 * Chốt tiền tệ cho một listing: **shop → market → mẫu**.
 *
 * `fallback` là currency của SKU/Pricing Template (dữ liệu server, nhưng do người dựng mẫu chọn
 * tay và có thể lệch thị trường). Nó chỉ được dùng khi cả shop lẫn market đều không tra được —
 * tức vùng chưa có trong bảng, không phải trường hợp bình thường.
 */
export function resolveListingCurrency(input: {
  shopRegion?: string | null;
  market?: string | null;
  fallback?: string | null;
}): { currency: string | null; source: ListingCurrencySource | null } {
  const fromShop = currencyForShopRegion(input.shopRegion);
  if (fromShop) return { currency: fromShop, source: 'SHOP' };
  const fromMarket = currencyForMarket(input.market);
  if (fromMarket) return { currency: fromMarket, source: 'MARKET' };
  const fallback = input.fallback?.trim().toUpperCase() || null;
  return fallback ? { currency: fallback, source: 'TEMPLATE' } : { currency: null, source: null };
}
