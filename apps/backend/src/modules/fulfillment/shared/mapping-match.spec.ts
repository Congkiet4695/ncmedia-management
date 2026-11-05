import {
  createMappingIndex,
  findMappingForItem,
  findMappingInIndex,
  itemHasProductKey,
  itemKeysOf,
  lookupForItem,
  lookupLegacyForItem,
  mappingKeyOf,
  normalizeProductKey,
  productIdsOf,
  productKeyFilter,
  rowKeyOf,
  skuIdKeyOf,
} from './mapping-match';

const mapping = (over: Record<string, unknown> = {}) => ({
  id: 'map-1',
  isActive: true,
  tiktokProductId: 'P1',
  tiktokSkuId: 'V1',
  sellerSku: 'SKU-1',
  legacySharedKey: false,
  ...over,
});
const item = (over: Record<string, unknown> = {}) => ({
  productId: 'P1',
  skuId: 'V1',
  sellerSku: 'SKU-1',
  ...over,
});

describe('mapping-match — danh tính là BIẾN THỂ (Product ID + TikTok SKU ID)', () => {
  describe('khoá', () => {
    it('skuIdKeyOf: đủ hai nửa, cắt khoảng trắng; thiếu một nửa ⇒ null', () => {
      expect(skuIdKeyOf(' P1 ', ' V1 ')).toBe(skuIdKeyOf('P1', 'V1'));
      for (const [product, sku] of [
        [null, 'V1'],
        ['P1', null],
        ['', 'V1'],
        ['P1', '   '],
      ]) {
        expect(skuIdKeyOf(product, sku)).toBeNull();
      }
    });

    it('🔴 hai biến thể cùng Seller SKU có HAI khoá khác nhau', () => {
      expect(rowKeyOf(mapping({ tiktokSkuId: 'V1' }))).not.toBe(rowKeyOf(mapping({ tiktokSkuId: 'V2' })));
    });

    it('🔴 cùng SKU ID nhưng khác Product ID là hai khoá khác nhau', () => {
      expect(skuIdKeyOf('P1', 'V1')).not.toBe(skuIdKeyOf('P2', 'V1'));
    });

    it('khoá biến thể, khoá Seller SKU và khoá legacy không bao giờ trùng nhau, kể cả giá trị giống hệt', () => {
      const keys = [
        skuIdKeyOf('P1', 'X'),
        mappingKeyOf('P1', 'X'),
        rowKeyOf(mapping({ sellerSku: 'X', tiktokSkuId: 'X', legacySharedKey: true })),
      ];
      expect(new Set(keys).size).toBe(3);
    });

    it('bản ghi thiếu SKU ID không phải legacy (dữ liệu cũ) ⇒ không có khoá, kể cả có Seller SKU', () => {
      expect(rowKeyOf(mapping({ tiktokSkuId: null }))).toBeNull();
    });

    it('line item: chỉ có khoá biến thể; có Seller SKU mà thiếu SKU ID ⇒ không có khoá', () => {
      expect(itemKeysOf(item())).toEqual([skuIdKeyOf('P1', 'V1')]);
      expect(itemKeysOf(item({ skuId: null }))).toEqual([]);
      expect(itemHasProductKey(item({ skuId: '  ' }))).toBe(false);
      expect(itemHasProductKey(item({ sellerSku: null }))).toBe(true);
    });

    it('mappingKeyOf (dữ liệu gợi ý theo Seller SKU) giữ nguyên hoa/thường và không va chạm', () => {
      expect(mappingKeyOf('P', 'POSTER')).not.toBe(mappingKeyOf('P', 'poster'));
      expect(mappingKeyOf('A', 'BC')).not.toBe(mappingKeyOf('AB', 'C'));
      expect(mappingKeyOf('P', '  ')).toBeNull();
    });
  });

  describe('findMappingForItem', () => {
    it('đúng biến thể ⇒ ghép, kể cả Seller SKU đã đổi', () => {
      expect(findMappingForItem(item({ sellerSku: 'RENAMED' }), [mapping()])?.id).toBe('map-1');
    });

    it('🔴 khác biến thể cùng Seller SKU ⇒ không ghép', () => {
      expect(findMappingForItem(item({ skuId: 'V2' }), [mapping()])).toBeNull();
    });

    it('🔴 khác sản phẩm cùng Seller SKU ⇒ không ghép', () => {
      expect(findMappingForItem(item({ productId: 'P2' }), [mapping()])).toBeNull();
    });

    it('bỏ qua ánh xạ đã tắt, ánh xạ thiếu khoá; danh sách rỗng ⇒ null', () => {
      expect(findMappingForItem(item(), [mapping({ isActive: false })])).toBeNull();
      expect(findMappingForItem(item(), [mapping({ tiktokSkuId: null })])).toBeNull();
      expect(findMappingForItem(item(), [])).toBeNull();
    });

    it('nhiều dòng trong một đơn: mỗi dòng nhận đúng ánh xạ của biến thể nó', () => {
      const index = createMappingIndex([
        mapping({ id: 'm1', tiktokSkuId: 'V1' }),
        mapping({ id: 'm2', tiktokSkuId: 'V2' }),
      ]);
      expect(findMappingInIndex(item({ skuId: 'V1' }), index)?.id).toBe('m1');
      expect(findMappingInIndex(item({ skuId: 'V2' }), index)?.id).toBe('m2');
    });

    it('trùng khoá ⇒ bản ĐẦU TIÊN thắng, xác định và ổn định', () => {
      const index = createMappingIndex([mapping({ id: 'first' }), mapping({ id: 'second' })]);
      expect(findMappingInIndex(item(), index)?.id).toBe('first');
    });
  });

  describe('🔴 bản ghi legacy', () => {
    const legacy = mapping({ id: 'legacy', legacySharedKey: true, tiktokSkuId: 'V1' });

    it('KHÔNG bao giờ được lookupForItem trả về, dù tham chiếu SKU trùng biến thể', () => {
      expect(findMappingForItem(item(), [legacy])).toBeNull();
    });

    it('lookupLegacyForItem đề xuất theo cùng Product ID + Seller SKU', () => {
      const index = createMappingIndex([legacy]);
      expect(lookupLegacyForItem(item({ skuId: 'V9' }), index)?.id).toBe('legacy');
    });

    it('không đề xuất khi khác Seller SKU, khác sản phẩm, hoặc dòng không có Seller SKU', () => {
      const index = createMappingIndex([legacy]);
      expect(lookupLegacyForItem(item({ sellerSku: 'OTHER' }), index)).toBeNull();
      expect(lookupLegacyForItem(item({ productId: 'P2' }), index)).toBeNull();
      expect(lookupLegacyForItem(item({ sellerSku: null }), index)).toBeNull();
    });

    it('legacy đã tắt không được đề xuất', () => {
      const index = createMappingIndex([mapping({ legacySharedKey: true, isActive: false })]);
      expect(lookupLegacyForItem(item(), index)).toBeNull();
    });

    it('bản ghi biến thể và bản legacy cùng tồn tại ⇒ tra biến thể ra bản riêng', () => {
      const index = createMappingIndex([legacy, mapping({ id: 'own' })]);
      expect(lookupForItem(item(), index)?.id).toBe('own');
    });
  });

  describe('normalizeProductKey / productKeyFilter', () => {
    it('chuẩn hoá khoảng trắng; Seller SKU rỗng ⇒ null, vẫn hợp lệ', () => {
      expect(normalizeProductKey({ tiktokProductId: ' P ', tiktokSkuId: ' V ', sellerSku: '  ' })).toEqual({
        tiktokProductId: 'P',
        tiktokSkuId: 'V',
        sellerSku: null,
      });
    });

    it('🔴 có Seller SKU nhưng thiếu SKU ID ⇒ khoá không hợp lệ', () => {
      expect(normalizeProductKey({ tiktokProductId: 'P', sellerSku: 'S' })).toBeNull();
      expect(normalizeProductKey({ tiktokSkuId: 'V', sellerSku: 'S' })).toBeNull();
    });

    it('bộ lọc theo biến thể, không chứa Seller SKU, loại bản legacy', () => {
      expect(productKeyFilter({ tiktokProductId: 'P', tiktokSkuId: 'V', sellerSku: 'S' })).toEqual({
        tiktokProductId: 'P',
        tiktokSkuId: 'V',
        legacySharedKey: false,
      });
    });
  });
});

describe('productIdsOf — bộ lọc thô theo Product ID', () => {
  it('giữ cả bản gốc lẫn bản đã trim, bỏ trùng và bỏ giá trị rỗng', () => {
    const ids = productIdsOf([
      { productId: 'P1' },
      { productId: ' P2 ' },
      { productId: 'P1' },
      { productId: null },
      { productId: '  ' },
    ]);
    expect(ids.sort()).toEqual([' P2 ', 'P1', 'P2']);
  });

  it('không có line item ⇒ mảng rỗng', () => {
    expect(productIdsOf([])).toEqual([]);
  });
});
