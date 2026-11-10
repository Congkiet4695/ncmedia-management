import { FulfillmentProvider } from '@prisma/client';
import { canonicalRaw, rawScopeOf, VARIANT_TIER_PATH } from './global-catalog-scope';

/**
 * Luật "trường nào là theo tài khoản" quyết định giá có lọt vào dữ liệu DÙNG CHUNG hay không. Sai ở đây
 * là Base Cost của tổ chức này hiện ra như dữ liệu chuẩn cho mọi tổ chức khác.
 */
describe('global-catalog-scope', () => {
  it('Mango variant: bỏ price / tồn kho / còn bán / attributes.tier; GIỮ production_line, print_areas, style', () => {
    const raw = {
      id: 'uuid-1',
      sku: 'EM18000NY0000S',
      price: '28.50',
      stock_quantity: 999,
      is_available: true,
      production_line: 'VNEMB',
      attributes: { tier: 'GOLD', style: 'Unisex', print_areas: ['back'] },
    };
    expect(canonicalRaw('variant', FulfillmentProvider.MANGO, raw)).toEqual({
      id: 'uuid-1',
      sku: 'EM18000NY0000S',
      production_line: 'VNEMB',
      attributes: { style: 'Unisex', print_areas: ['back'] },
    });
    // Không mutate đầu vào — payload nguyên văn còn phải ghi vào lớp theo tài khoản.
    expect(raw.attributes.tier).toBe('GOLD');
    expect(raw.price).toBe('28.50');
  });

  it('Sellerwix variant: bỏ cost / active; GIỮ print_areas (vùng in là metadata chuẩn)', () => {
    const raw = {
      sku: 'SW-MD-MPTG-BL-XL',
      cost: 5.5,
      active: true,
      print_areas: [{ key: 'CF' }],
      is_rush_service: false,
    };
    expect(canonicalRaw('variant', FulfillmentProvider.SELLERWIX, raw)).toEqual({
      sku: 'SW-MD-MPTG-BL-XL',
      print_areas: [{ key: 'CF' }],
      is_rush_service: false,
    });
  });

  it('Sản phẩm: bỏ giá gốc / đơn vị tiền / phụ phí design', () => {
    expect(
      canonicalRaw('product', FulfillmentProvider.MANGO, {
        id: 'p',
        base_price: '20',
        currency: 'USD',
        is_active: true,
        name: 'Hoodie',
      }),
    ).toEqual({ id: 'p', name: 'Hoodie' });
    expect(
      canonicalRaw('product', FulfillmentProvider.SELLERWIX, {
        sku: 'SW',
        additional_design_price: 2,
        active: true,
        title: 'Tee',
      }),
    ).toEqual({ sku: 'SW', title: 'Tee' });
  });

  it('🔴 Nhà cung cấp CHƯA khai phạm vi ⇒ lớp global không nhận payload nào (NULL), không đoán', () => {
    expect(rawScopeOf('variant', FulfillmentProvider.PRINTIFY)).toBeNull();
    expect(
      canonicalRaw('variant', FulfillmentProvider.PRINTIFY, { price: 1, sku: 'x' }),
    ).toBeNull();
  });

  it('payload không phải object được giữ nguyên (giống nhánh CASE của SQL)', () => {
    expect(canonicalRaw('variant', FulfillmentProvider.MANGO, null)).toBeNull();
    expect(canonicalRaw('variant', FulfillmentProvider.MANGO, ['a'])).toEqual(['a']);
  });

  it('tier chỉ có ở Mango', () => {
    expect(VARIANT_TIER_PATH.MANGO).toEqual(['attributes', 'tier']);
    expect(VARIANT_TIER_PATH.SELLERWIX).toBeUndefined();
  });
});
