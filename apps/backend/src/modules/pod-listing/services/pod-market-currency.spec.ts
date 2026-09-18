import {
  currencyForMarket,
  currencyForShopRegion,
  resolveListingCurrency,
} from './pod-market-currency';
import { humanizeTiktokListingError } from './pod-tiktok-error-message';

/**
 * Tiền tệ quyết ở server theo shop/thị trường — nguồn của `skus[].price.currency` gửi TikTok.
 *
 * 🔴 Lỗi đã gặp: `36009004 Currency of Price is a required field` — giá nhập tay không đi qua
 * Pricing/SKU Template nên không mang tiền tệ. Bảng tra này là NƠI DUY NHẤT quyết định.
 */
describe('pod-market-currency', () => {
  it('thị trường ⇒ tiền tệ: US/UK/EU và vùng EUR', () => {
    expect(currencyForMarket('US')).toBe('USD');
    expect(currencyForMarket('UK')).toBe('GBP');
    expect(currencyForMarket('EU')).toBe('EUR');
    expect(currencyForMarket('DE')).toBe('EUR');
    expect(currencyForMarket('IE')).toBe('EUR');
    expect(currencyForMarket('VN')).toBe('VND');
    expect(currencyForMarket('XX')).toBeNull();
    expect(currencyForMarket(null)).toBeNull();
  });

  it('region của shop (mã ISO của TikTok): GB ⇒ GBP, không phân biệt hoa thường', () => {
    expect(currencyForShopRegion('GB')).toBe('GBP');
    expect(currencyForShopRegion('us')).toBe('USD');
    expect(currencyForShopRegion('DE')).toBe('EUR');
    expect(currencyForShopRegion('')).toBeNull();
  });

  it('🔴 thứ tự: shop → market → mẫu; mẫu chỉ khi hai nguồn trên không tra được', () => {
    expect(resolveListingCurrency({ shopRegion: 'GB', market: 'US', fallback: 'USD' })).toEqual({
      currency: 'GBP',
      source: 'SHOP',
    });
    expect(resolveListingCurrency({ shopRegion: 'ZZ', market: 'US', fallback: 'GBP' })).toEqual({
      currency: 'USD',
      source: 'MARKET',
    });
    expect(resolveListingCurrency({ shopRegion: 'ZZ', market: 'ZZ', fallback: 'usd' })).toEqual({
      currency: 'USD',
      source: 'TEMPLATE',
    });
    expect(resolveListingCurrency({ shopRegion: null, market: null, fallback: null })).toEqual({
      currency: null,
      source: null,
    });
  });
});

describe('humanizeTiktokListingError', () => {
  it('36009004 + "Currency … required" ⇒ câu chỉ rõ phải kiểm tra Market/Shop', () => {
    const friendly = humanizeTiktokListingError(
      36009004,
      'Currency of Price is a required field and has not been provided.',
    );
    expect(friendly).toContain('Currency của giá sản phẩm đang bị thiếu');
    expect(friendly).toContain('36009004');
  });

  it('36009004 là mã dùng chung ⇒ thông điệp khác KHÔNG bị dịch nhầm', () => {
    expect(humanizeTiktokListingError(36009004, 'category_id is invalid')).toBeNull();
    expect(humanizeTiktokListingError(105002, 'Currency of Price is a required field')).toBeNull();
  });
});

describe('humanizeTiktokListingError — 12052340 ảnh mô tả', () => {
  it('dịch lỗi src ảnh mô tả không hợp lệ sang câu chỉ rõ DESCRIPTION_IMAGE', () => {
    const friendly = humanizeTiktokListingError(
      12052340,
      "Invalid Parameter. Parameter 'description <img>' src is invalid because src must use the url returned by Upload Image with use_case=DESCRIPTION_IMAGE.",
    );
    expect(friendly).toContain('DESCRIPTION_IMAGE');
    expect(humanizeTiktokListingError(12052340, 'product description image uri illegal')).toContain('DESCRIPTION_IMAGE');
    expect(humanizeTiktokListingError(12052340, 'title too long')).toBeNull();
  });
});
