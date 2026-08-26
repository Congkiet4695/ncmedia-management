import {
  findAutoMapCandidates,
  normalizeName,
  normalizeSku,
  type AutoMapVariantRow,
} from './auto-map-match';

/**
 * Luật ánh xạ tự động quyết định SKU nào được gửi sang xưởng in. Sai ở đây nghĩa là hàng
 * thật in nhầm sản phẩm, nên bộ test này khoá cả hai chiều: tìm ĐÚNG khi có đủ căn cứ, và
 * TỪ CHỐI tự chọn khi không đủ.
 */
describe('auto-map-match', () => {
  const variant = (over: Partial<AutoMapVariantRow> = {}): AutoMapVariantRow => ({
    id: 'v1',
    externalVariantId: 'EV1',
    sku: 'MANGO-TEE-BLK-L',
    name: 'Black / L',
    color: 'Black',
    size: 'L',
    price: '9.50',
    product: {
      id: 'p1',
      externalProductId: 'EP1',
      name: 'Unisex T-Shirt',
      sku: 'TEE',
      catalogueId: 'c1',
      catalogue: { id: 'c1', name: 'Apparel' },
    },
    ...over,
  });

  const query = (over: Partial<Parameters<typeof findAutoMapCandidates>[0]> = {}) => ({
    sellerSku: 'MANGO-TEE-BLK-L',
    productName: null,
    skuName: null,
    productCategory: null,
    ...over,
  });

  describe('chuẩn hoá', () => {
    it('normalizeName bỏ dấu, hạ chữ thường và gom ký tự lạ về khoảng trắng', () => {
      expect(normalizeName('Áo Thun  Unisex (Đen)')).toBe('ao thun unisex den');
      // Dấu gạch nối và khoảng trắng thừa được coi như nhau.
      expect(normalizeName('Unisex T-Shirt')).toBe(normalizeName('unisex   t   shirt'));
    });

    /**
     * `T-Shirt` thành `t shirt` chứ KHÔNG thành `tshirt`. Đây là lựa chọn có chủ ý theo
     * hướng an toàn: xoá hẳn dấu phân cách sẽ khiến `re-do` khớp `redo` và `co-op` khớp
     * `coop` — gộp nhầm hai sản phẩm khác nhau. Không khớp được thì luật chỉ rơi xuống tầng
     * dưới, còn khớp nhầm thì đơn ra xưởng in sai sản phẩm.
     */
    it('🔴 gạch nối thành khoảng trắng, KHÔNG bị xoá hẳn', () => {
      expect(normalizeName('T-Shirt')).toBe('t shirt');
      expect(normalizeName('T-Shirt')).not.toBe(normalizeName('TShirt'));
    });

    it('normalizeName chịu được null/rỗng', () => {
      expect(normalizeName(null)).toBe('');
      expect(normalizeName(undefined)).toBe('');
    });

    // 🔴 SKU là mã định danh: hạ chữ thường sẽ gộp hai SKU khác nhau làm một.
    it('normalizeSku chỉ cắt khoảng trắng, GIỮ NGUYÊN hoa/thường', () => {
      expect(normalizeSku('  POSTER_24x36 ')).toBe('POSTER_24x36');
      expect(normalizeSku('POSTER_24x36')).not.toBe(normalizeSku('poster_24x36'));
    });
  });

  describe('tầng 1 — Seller SKU', () => {
    it('khớp CHÍNH XÁC SKU biến thể ⇒ một ứng viên, tier SELLER_SKU', () => {
      const result = findAutoMapCandidates(query(), [variant()]);
      expect(result.tier).toBe('SELLER_SKU');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].sku).toBe('MANGO-TEE-BLK-L');
    });

    it('khớp SKU của SẢN PHẨM cũng được tính', () => {
      const result = findAutoMapCandidates(query({ sellerSku: 'TEE' }), [variant()]);
      expect(result.tier).toBe('SELLER_SKU');
    });

    it('🔴 KHÔNG khớp gần đúng: lệch hoa/thường là sản phẩm khác', () => {
      const result = findAutoMapCandidates(query({ sellerSku: 'mango-tee-blk-l' }), [variant()]);
      expect(result.candidates).toHaveLength(0);
    });

    it('Seller SKU rỗng ⇒ không tra gì cả', () => {
      const result = findAutoMapCandidates(query({ sellerSku: '   ' }), [variant()]);
      expect(result.tier).toBeNull();
      expect(result.candidates).toHaveLength(0);
    });

    it('nhiều biến thể cùng SKU ⇒ trả HẾT, không tự chọn', () => {
      const result = findAutoMapCandidates(query(), [
        variant({ id: 'v1' }),
        variant({ id: 'v2', externalVariantId: 'EV2' }),
      ]);
      expect(result.candidates).toHaveLength(2);
    });
  });

  describe('tầng 2 — Product Title', () => {
    const rows = [
      variant({ id: 'v1', sku: 'X-BLK-L', name: 'Black / L', color: 'Black', size: 'L' }),
      variant({ id: 'v2', sku: 'X-BLK-M', name: 'Black / M', color: 'Black', size: 'M' }),
    ];

    it('khớp tên sản phẩm sau chuẩn hoá, thu hẹp tiếp bằng tên biến thể', () => {
      const result = findAutoMapCandidates(
        query({ sellerSku: 'KHONG-CO', productName: 'unisex  t-shirt', skuName: 'Black, L' }),
        rows,
      );
      expect(result.tier).toBe('PRODUCT_TITLE');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].sku).toBe('X-BLK-L');
    });

    it('không thu hẹp được ⇒ trả cả nhóm để người dùng chọn, KHÔNG tự chọn', () => {
      const result = findAutoMapCandidates(
        query({ sellerSku: 'KHONG-CO', productName: 'Unisex T-Shirt' }),
        rows,
      );
      expect(result.tier).toBe('PRODUCT_TITLE');
      expect(result.candidates).toHaveLength(2);
    });

    // 🔴 Nếu dùng "chứa" thay vì khớp tuyệt đối, "T-Shirt" sẽ trúng hàng trăm sản phẩm.
    it('🔴 KHÔNG khớp kiểu "chứa": tên chỉ trùng một phần thì bỏ qua', () => {
      const result = findAutoMapCandidates(
        query({ sellerSku: 'KHONG-CO', productName: 'T-Shirt' }),
        rows,
      );
      expect(result.tier).not.toBe('PRODUCT_TITLE');
    });
  });

  describe('tầng 3 — Variant', () => {
    it('khớp theo màu + size khi tên sản phẩm không khớp', () => {
      const result = findAutoMapCandidates(
        query({ sellerSku: 'KHONG-CO', productName: 'Tên hoàn toàn khác', skuName: 'Black / L' }),
        [variant()],
      );
      expect(result.tier).toBe('VARIANT');
      expect(result.candidates).toHaveLength(1);
    });

    // 🔴 `includes` trên chuỗi sẽ coi "XL" khớp với "2XL" và gộp hai size làm một.
    it('🔴 so theo TỪ trọn vẹn: size XL không khớp biến thể 2XL', () => {
      const result = findAutoMapCandidates(query({ sellerSku: 'KHONG-CO', skuName: 'Black XL' }), [
        variant({ name: 'Black / 2XL', color: 'Black', size: '2XL' }),
      ]);
      expect(result.candidates).toHaveLength(0);
    });

    it('🔴 khớp mỗi màu là chưa đủ — phải khớp CẢ màu và size', () => {
      const result = findAutoMapCandidates(query({ sellerSku: 'KHONG-CO', skuName: 'Black' }), [
        variant(),
      ]);
      expect(result.candidates).toHaveLength(0);
    });
  });

  describe('tầng 4 — Catalogue', () => {
    it('khớp danh mục khi mọi tầng trên đều trượt', () => {
      const result = findAutoMapCandidates(
        query({ sellerSku: 'KHONG-CO', productCategory: 'apparel' }),
        [variant()],
      );
      expect(result.tier).toBe('CATALOGUE');
      expect(result.candidates).toHaveLength(1);
    });
  });

  describe('thứ tự ưu tiên', () => {
    /**
     * Tầng sau CHỈ chạy khi tầng trước không có kết quả. Gộp kết quả nhiều tầng sẽ làm loãng
     * một ánh xạ chắc chắn của tầng SKU thành "cần chọn tay".
     */
    it('🔴 Seller SKU thắng, không bị pha thêm ứng viên của tầng dưới', () => {
      const exact = variant({ id: 'v-sku', sku: 'MANGO-TEE-BLK-L' });
      const sameTitle = variant({
        id: 'v-title',
        externalVariantId: 'EV9',
        sku: 'KHAC',
        name: 'Black / M',
        size: 'M',
      });

      const result = findAutoMapCandidates(
        query({ productName: 'Unisex T-Shirt', productCategory: 'Apparel' }),
        [exact, sameTitle],
      );

      expect(result.tier).toBe('SELLER_SKU');
      expect(result.candidates.map((c) => c.variantId)).toEqual(['v-sku']);
    });

    it('không tầng nào khớp ⇒ tier null, danh sách rỗng', () => {
      const result = findAutoMapCandidates(
        query({
          sellerSku: 'KHONG-CO',
          productName: 'Khác',
          skuName: 'Khác',
          productCategory: 'Khác',
        }),
        [variant()],
      );
      expect(result.tier).toBeNull();
      expect(result.candidates).toHaveLength(0);
    });

    it('danh mục rỗng ⇒ không nổ, trả rỗng', () => {
      expect(findAutoMapCandidates(query(), []).candidates).toHaveLength(0);
    });
  });

  it('ứng viên mang đủ dữ liệu để tạo Product Mapping mà không phải tra lại', () => {
    const [candidate] = findAutoMapCandidates(query(), [variant()]).candidates;
    expect(candidate).toEqual({
      productId: 'p1',
      externalProductId: 'EP1',
      productName: 'Unisex T-Shirt',
      variantId: 'v1',
      externalVariantId: 'EV1',
      sku: 'MANGO-TEE-BLK-L',
      variantName: 'Black / L',
      catalogueId: 'c1',
      catalogueName: 'Apparel',
    });
  });
});
