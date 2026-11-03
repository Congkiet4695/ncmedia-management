import {
  createMappingIndex,
  findMappingForItem,
  findMappingInIndex,
  itemHasProductKey,
  itemKeysOf,
  lookupForItem,
  mappingKeyOf,
  normalizeProductKey,
  productIdsOf,
  productKeyFilter,
  rowKeyOf,
  skuIdKeyOf,
  type MappingMatchKey,
} from './mapping-match';

/**
 * Luật ghép là hợp đồng dùng chung giữa hai module (Fulfillment quyết định gửi đơn,
 * PodTiktok quyết định hiển thị design). Kiểm ở đây — nơi luật thực sự sống — để một thay
 * đổi làm nới lỏng nó không thể lọt qua chỉ vì hai bộ test kia đang mock quanh nó.
 */
describe('mapping-match — danh tính ánh xạ là (Product ID + Seller SKU)', () => {
  const mapping = (over: Record<string, unknown> = {}) => ({
    id: 'map-1',
    tiktokProductId: 'PROD-1',
    sellerSku: 'SELLER-1',
    isActive: true,
    ...over,
  });

  const item = (over: Record<string, unknown> = {}) => ({
    productId: 'PROD-1',
    sellerSku: 'SELLER-1',
    ...over,
  });

  describe('mappingKeyOf', () => {
    it('dựng khoá từ đủ hai nửa, cắt khoảng trắng thừa', () => {
      expect(mappingKeyOf(' PROD-1 ', ' SELLER-1 ')).toBe(mappingKeyOf('PROD-1', 'SELLER-1'));
    });

    it('thiếu một nửa ⇒ không có khoá (null), không phải chuỗi rỗng', () => {
      expect(mappingKeyOf(null, 'SELLER-1')).toBeNull();
      expect(mappingKeyOf('PROD-1', null)).toBeNull();
      expect(mappingKeyOf('PROD-1', '   ')).toBeNull();
      expect(mappingKeyOf(undefined, undefined)).toBeNull();
    });

    it('🔴 GIỮ NGUYÊN hoa/thường — TikTok coi POSTER và poster là hai Seller SKU khác nhau', () => {
      expect(mappingKeyOf('P', 'POSTER_24x36')).not.toBe(mappingKeyOf('P', 'poster_24x36'));
    });

    /**
     * Nếu khoá được nối bằng một ký tự có thể xuất hiện trong chính dữ liệu, hai cặp khác
     * nhau có thể sinh cùng một chuỗi khoá và ghép nhầm sang sản phẩm khác.
     */
    it('🔴 không có hai cặp khoá khác nhau nào sinh cùng một chuỗi khoá', () => {
      expect(mappingKeyOf('A', 'B C')).not.toBe(mappingKeyOf('A B', 'C'));
    });
  });

  describe('findMappingForItem', () => {
    it('khớp đủ cặp ⇒ trả về ánh xạ', () => {
      expect(findMappingForItem(item(), [mapping()])?.id).toBe('map-1');
    });

    it.each([
      ['chỉ khớp Seller SKU', { productId: 'PROD-KHAC' }],
      ['chỉ khớp Product ID', { sellerSku: 'SKU-KHAC' }],
      ['line item thiếu Product ID', { productId: null }],
      ['line item thiếu Seller SKU', { sellerSku: null }],
    ])('KHÔNG ghép khi %s', (_label, over) => {
      expect(findMappingForItem(item(over), [mapping()])).toBeNull();
    });

    it('bỏ qua ánh xạ đã tắt', () => {
      expect(findMappingForItem(item(), [mapping({ isActive: false })])).toBeNull();
    });

    it('bỏ qua ánh xạ thiếu khoá (dữ liệu cũ) thay vì ghép bừa', () => {
      expect(findMappingForItem(item(), [mapping({ sellerSku: null })])).toBeNull();
    });

    it('danh sách rỗng ⇒ null, không ném lỗi', () => {
      expect(findMappingForItem(item(), [])).toBeNull();
    });
  });

  describe('createMappingIndex', () => {
    it('chỉ nạp ánh xạ đang bật và đủ khoá', () => {
      const index = createMappingIndex([
        mapping(),
        mapping({ id: 'off', tiktokProductId: 'PROD-2', isActive: false }),
        mapping({ id: 'no-key', tiktokProductId: 'PROD-3', sellerSku: null }),
      ]);
      expect(index.size).toBe(1);
    });

    /**
     * DB đã có UNIQUE index nên trùng khoá không xảy ra trong thực tế; hành vi vẫn phải xác
     * định để không phụ thuộc thứ tự trả về của một truy vấn.
     */
    it('trùng khoá ⇒ bản ĐẦU TIÊN thắng, xác định và ổn định', () => {
      const index = createMappingIndex([mapping({ id: 'dau-tien' }), mapping({ id: 'thu-hai' })]);
      expect(index.get(mappingKeyOf('PROD-1', 'SELLER-1')!)?.id).toBe('dau-tien');
    });
  });
});

describe('productIdsOf — bộ lọc thô theo Product ID', () => {
  it('giữ cả bản gốc lẫn bản đã trim, bỏ trùng và bỏ giá trị rỗng', () => {
    expect(
      productIdsOf([
        { productId: 'P1' },
        { productId: ' P2 ' },
        { productId: 'P1' },
        { productId: null },
        { productId: '   ' },
      ]),
    ).toEqual(['P1', ' P2 ', 'P2']);
  });

  it('không có line item ⇒ mảng rỗng', () => {
    expect(productIdsOf([])).toEqual([]);
  });
});

describe('mapping-match — khoá dự phòng Product ID + TikTok SKU ID (biến thể không có Seller SKU)', () => {
  const active = (over: Partial<MappingMatchKey> & { id: string }) => ({
    tiktokProductId: 'P1',
    sellerSku: null,
    tiktokSkuId: null,
    isActive: true,
    ...over,
  });

  it('khoá SKU ID không bao giờ trùng khoá Seller SKU (kể cả Seller SKU giống hệt SKU ID)', () => {
    expect(skuIdKeyOf('P1', 'K1')).not.toBe(mappingKeyOf('P1', 'K1'));
    expect(skuIdKeyOf('P1', ' ')).toBeNull();
    expect(skuIdKeyOf(null, 'K1')).toBeNull();
  });

  it('rowKeyOf: có Seller SKU ⇒ khoá Seller SKU (SKU ID chỉ tham chiếu); Seller SKU rỗng ⇒ khoá SKU ID', () => {
    expect(rowKeyOf({ tiktokProductId: 'P1', sellerSku: 'S1', tiktokSkuId: 'K1' })).toBe(mappingKeyOf('P1', 'S1'));
    expect(rowKeyOf({ tiktokProductId: 'P1', sellerSku: '  ', tiktokSkuId: 'K1' })).toBe(skuIdKeyOf('P1', 'K1'));
    expect(rowKeyOf({ tiktokProductId: 'P1', sellerSku: null, tiktokSkuId: null })).toBeNull();
  });

  it('dòng đơn: Seller SKU trước, rồi SKU ID của CHÍNH biến thể; thiếu cả hai ⇒ không có khoá', () => {
    expect(itemKeysOf({ productId: 'P1', sellerSku: 'S1', skuId: 'K1' })).toEqual([mappingKeyOf('P1', 'S1'), skuIdKeyOf('P1', 'K1')]);
    expect(itemKeysOf({ productId: 'P1', sellerSku: '', skuId: 'K1' })).toEqual([skuIdKeyOf('P1', 'K1')]);
    expect(itemHasProductKey({ productId: 'P1', sellerSku: null, skuId: null })).toBe(false);
    expect(itemHasProductKey({ productId: null, sellerSku: 'S1', skuId: 'K1' })).toBe(false);
  });

  it('nhiều dòng trong MỘT đơn: mỗi dòng nhận đúng ánh xạ của biến thể nó, không lẫn', () => {
    const mappings = [
      active({ id: 'by-sku', sellerSku: 'S1', tiktokSkuId: 'K1' }),
      active({ id: 'by-id-2', tiktokSkuId: 'K2' }),
      active({ id: 'by-id-3', tiktokSkuId: 'K3' }),
      active({ id: 'other-product', tiktokProductId: 'P9', tiktokSkuId: 'K2' }),
      active({ id: 'inactive', tiktokSkuId: 'K4', isActive: false }),
    ];
    const index = createMappingIndex(mappings);
    const find = (item: { productId: string | null; sellerSku: string | null; skuId: string | null }) =>
      findMappingInIndex(item, index)?.id ?? null;
    expect(find({ productId: 'P1', sellerSku: 'S1', skuId: 'K1' })).toBe('by-sku');
    expect(find({ productId: 'P1', sellerSku: null, skuId: 'K2' })).toBe('by-id-2');
    expect(find({ productId: 'P1', sellerSku: '', skuId: 'K3' })).toBe('by-id-3');
    expect(find({ productId: 'P9', sellerSku: null, skuId: 'K2' })).toBe('other-product');
    // Ánh xạ Seller SKU có tiktok_sku_id = K1 KHÔNG được dùng cho dòng không Seller SKU của K1.
    expect(find({ productId: 'P1', sellerSku: null, skuId: 'K1' })).toBeNull();
    expect(find({ productId: 'P1', sellerSku: null, skuId: 'K4' })).toBeNull();
    expect(find({ productId: 'P1', sellerSku: null, skuId: null })).toBeNull();
  });

  it('lookupForItem: có cả hai bản ghi ⇒ khoá Seller SKU thắng; chỉ có bản SKU ID ⇒ dự phòng', () => {
    const table = new Map([
      [mappingKeyOf('P1', 'S1') as string, 'seller-sku'],
      [skuIdKeyOf('P1', 'K1') as string, 'sku-id'],
    ]);
    expect(lookupForItem({ productId: 'P1', sellerSku: 'S1', skuId: 'K1' }, table)).toBe('seller-sku');
    expect(lookupForItem({ productId: 'P1', sellerSku: 'NEW', skuId: 'K1' }, table)).toBe('sku-id');
    expect(lookupForItem({ productId: 'P1', sellerSku: null, skuId: 'K2' }, table)).toBeNull();
  });

  it('normalizeProductKey / productKeyFilter: Seller SKU rỗng ⇒ NULL, khoá SKU ID lọc kèm seller_sku IS NULL', () => {
    expect(normalizeProductKey({ tiktokProductId: ' P1 ', sellerSku: ' S1 ', tiktokSkuId: 'K1' })).toEqual({
      tiktokProductId: 'P1',
      sellerSku: 'S1',
      tiktokSkuId: 'K1',
    });
    const skuless = normalizeProductKey({ tiktokProductId: 'P1', sellerSku: '   ', tiktokSkuId: 'K1' });
    expect(skuless).toEqual({ tiktokProductId: 'P1', sellerSku: null, tiktokSkuId: 'K1' });
    expect(productKeyFilter(skuless as NonNullable<typeof skuless>)).toEqual({ tiktokProductId: 'P1', sellerSku: null, tiktokSkuId: 'K1' });
    expect(productKeyFilter({ tiktokProductId: 'P1', sellerSku: 'S1', tiktokSkuId: 'K1' })).toEqual({ tiktokProductId: 'P1', sellerSku: 'S1' });
    expect(normalizeProductKey({ tiktokProductId: 'P1', sellerSku: '' })).toBeNull();
    expect(normalizeProductKey({ tiktokProductId: '', tiktokSkuId: 'K1' })).toBeNull();
  });
});
