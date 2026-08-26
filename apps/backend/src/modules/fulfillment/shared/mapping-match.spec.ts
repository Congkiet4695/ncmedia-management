import { createMappingIndex, findMappingForItem, mappingKeyOf } from './mapping-match';

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
