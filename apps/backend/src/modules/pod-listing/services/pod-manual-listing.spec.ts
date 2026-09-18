import { POD_DRAFT_ISSUE_CODES } from '../constants/pod-listing.constants';
import {
  MANUAL_SKU_MAX,
  applyManualOverride,
  parseManualOverride,
} from './pod-manual-listing';
import type { ResolveIssue, ResolvedListing } from './pod-listing-resolver.service';

/**
 * Luật **"nhập tay thắng template"**.
 *
 * 🔴 Vì sao bộ test này tồn tại: đây là hàm quyết định nội dung THẬT SỰ được gửi lên TikTok
 * cho từng shop. Sai ở đây không hiện ra màn hình đỏ nào — nó hiện ra thành hàng trăm sản
 * phẩm lên sàn với giá của template trong khi người vận hành tưởng mình đã sửa giá.
 *
 * Ba bất biến được canh:
 *   1. Trường KHÔNG nhập tay phải rơi về template (ghi đè theo từng trường, không thay cụm).
 *   2. Bảng SKU nhập tay thay TOÀN BỘ biến thể — và gỡ luôn lỗi cũ của template, nếu không
 *      màn hình hiện lỗi về dữ liệu đã bị thay thế.
 *   3. Lỗi được GỘP: 600 SKU thiếu giá là MỘT dòng, không phải 600 dòng (§10).
 */

/** Listing đã giải từ template — chỉ những trường mà override đụng tới. */
function templateListing(overrides: Partial<ResolvedListing> = {}): ResolvedListing {
  return {
    market: 'US',
    title: 'Tee từ template',
    description: '<p>Mô tả của template</p>',
    category: { tiktokCategoryId: '1167376', name: "Men's Sweatshirts", path: null },
    brand: { tiktokBrandId: null, name: null },
    attributes: [],
    images: [],
    // Resolver thật LUÔN đặt hai trường này (null khi không có) — fixture phải giống, nếu
    // không bài test sẽ xanh với `undefined` trong khi mã thật nhận `null`.
    sizeChart: null,
    video: null,
    package: {
      weight: '300',
      weightUnit: 'GRAM',
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
    },
    warehouse: { id: null, tiktokWarehouseId: null, name: null },
    shipping: { shippingTemplateId: null, handlingDays: null },
    pricing: {
      strategyId: null,
      strategyName: null,
      currency: 'USD',
      salePrice: '19.99',
      retailPrice: '29.99',
      finalPrice: '19.99',
    },
    variants: [
      {
        variantName: 'Black / S',
        sellerSku: 'TPL-BLACK-S',
        barcode: null,
        optionValues: [{ name: 'Color', value: 'Black' }],
        salePrice: '19.99',
        retailPrice: '29.99',
        currency: 'USD',
        quantity: 10,
        imageFileId: null,
        sortOrder: 0,
      },
    ],
    source: {
      productId: null,
      sessionProductId: 'sp-1',
      tiktokProductId: null,
      shopId: 'shop-1',
      listingTemplateId: 'tpl-1',
      imageTemplateId: null,
    },
    ...overrides,
  };
}

const sku = (sellerSku: string, salePrice: string | null = '25.00') => ({
  sellerSku,
  optionValues: [{ name: 'Color', value: 'Black' }],
  salePrice,
});

describe('parseManualOverride — cột JSON không bảo đảm kiểu', () => {
  it('null / không phải object ⇒ null (rơi về template như chưa từng có override)', () => {
    expect(parseManualOverride(null)).toBeNull();
    expect(parseManualOverride('rác')).toBeNull();
    expect(parseManualOverride(42)).toBeNull();
    expect(parseManualOverride([] as never)).toBeNull();
  });

  it('object rỗng ⇒ null', () => {
    expect(parseManualOverride({})).toBeNull();
  });

  it('🔴 phần tử sai hình dạng bị BỎ QUA, phần đúng vẫn dùng được', () => {
    const parsed = parseManualOverride({
      skus: [
        { sellerSku: 'OK-1', optionValues: [{ name: 'Color', value: 'Black' }], salePrice: '10' },
        'chuỗi lạc',
        null,
        { optionValues: [] }, // thiếu sellerSku ⇒ loại
        { sellerSku: 'OK-2' },
      ],
    });

    expect(parsed?.skus?.map((item) => item.sellerSku)).toEqual(['OK-1', 'OK-2']);
  });

  it('cắt khoảng trắng và loại giá trị trục rỗng', () => {
    const parsed = parseManualOverride({
      variations: [
        { name: '  Color ', values: ['Black', '  ', 'White'] },
        { name: '', values: ['X'] }, // thiếu tên trục ⇒ loại
        { name: 'Size', values: [] }, // không có giá trị ⇒ loại
      ],
    });

    expect(parsed?.variations).toEqual([{ name: 'Color', values: ['Black', 'White'] }]);
  });

  it('🔴 `skus: []` được GIỮ (mảng rỗng), không biến thành undefined', () => {
    // Phân biệt này quan trọng: `[]` = "tôi nhập tay và chưa có dòng nào" ⇒ phải báo lỗi.
    // `undefined` = "dùng bảng SKU của template". Nhập nhèm hai thứ là đăng lên sàn một bảng
    // giá mà người dùng tin rằng mình đã thay.
    expect(parseManualOverride({ skus: [] })?.skus).toEqual([]);
  });
});

describe('applyManualOverride — ghi đè theo từng trường', () => {
  it('không có override ⇒ trả NGUYÊN payload của template', () => {
    const payload = templateListing();
    const issues: ResolveIssue[] = [];

    expect(applyManualOverride(payload, null, issues)).toBe(payload);
    expect(issues).toHaveLength(0);
  });

  it('🔴 chỉ nhập mô tả ⇒ SKU vẫn của template (không thay cả cụm)', () => {
    const issues: ResolveIssue[] = [];
    const result = applyManualOverride(
      templateListing(),
      { description: '<p>Mô tả nhập tay</p>' },
      issues,
    );

    expect(result.description).toBe('<p>Mô tả nhập tay</p>');
    expect(result.variants.map((v) => v.sellerSku)).toEqual(['TPL-BLACK-S']);
    expect(result.category.tiktokCategoryId).toBe('1167376');
    expect(result.package.weight).toBe('300');
  });

  it('không sửa payload gốc tại chỗ', () => {
    const payload = templateListing();
    applyManualOverride(payload, { description: 'x', skus: [sku('A')] }, []);

    expect(payload.description).toBe('<p>Mô tả của template</p>');
    expect(payload.variants).toHaveLength(1);
  });

  it('mô tả rỗng là CÓ Ý xoá ⇒ báo thiếu mô tả', () => {
    const issues: ResolveIssue[] = [];
    applyManualOverride(templateListing(), { description: '   ' }, issues);

    expect(issues.filter((i) => i.code === POD_DRAFT_ISSUE_CODES.MISSING_DESCRIPTION)).toHaveLength(1);
  });

  it('🔴 mô tả chỉ gồm thẻ rỗng vẫn là rỗng với người mua', () => {
    const issues: ResolveIssue[] = [];
    applyManualOverride(templateListing(), { description: '<p></p><br>&nbsp;' }, issues);

    expect(issues.some((i) => i.code === POD_DRAFT_ISSUE_CODES.MISSING_DESCRIPTION)).toBe(true);
  });

  it('🔴 nhập tay mô tả HỢP LỆ ⇒ gỡ lỗi thiếu mô tả của template', () => {
    // Template không có mô tả ⇒ resolver đã đẩy lỗi vào. Người dùng gõ tay mô tả thì lỗi đó
    // không còn nói về dữ liệu đang dùng nữa; để lại là chặn một listing thực ra đã đủ.
    const issues: ResolveIssue[] = [
      {
        level: 'ERROR',
        field: 'description',
        code: POD_DRAFT_ISSUE_CODES.MISSING_DESCRIPTION,
        message: 'Listing chưa có mô tả',
      },
    ];

    applyManualOverride(templateListing(), { description: '<p>Đã gõ tay</p>' }, issues);

    expect(issues).toHaveLength(0);
  });
});

describe('applyManualOverride — bảng SKU nhập tay', () => {
  it('thay TOÀN BỘ biến thể của template', () => {
    const issues: ResolveIssue[] = [];
    const result = applyManualOverride(
      templateListing(),
      { skus: [sku('MAN-1'), sku('MAN-2')] },
      issues,
    );

    expect(result.variants.map((v) => v.sellerSku)).toEqual(['MAN-1', 'MAN-2']);
    expect(issues).toHaveLength(0);
  });

  it('dựng tên biến thể từ giá trị trục, giữ thứ tự dòng', () => {
    const result = applyManualOverride(
      templateListing(),
      {
        skus: [
          {
            sellerSku: 'BS',
            optionValues: [
              { name: 'Color', value: 'Black' },
              { name: 'Size', value: 'S' },
            ],
            salePrice: '25.00',
          },
        ],
      },
      [],
    );

    expect(result.variants[0].variantName).toBe('Black / S');
    expect(result.variants[0].sortOrder).toBe(0);
  });

  it('kế thừa currency từ chiến lược giá của template', () => {
    const result = applyManualOverride(templateListing(), { skus: [sku('A')] }, []);
    expect(result.variants[0].currency).toBe('USD');
  });

  it('🔴 `skus: []` ⇒ báo thiếu biến thể, KHÔNG lặng lẽ rơi về template', () => {
    const issues: ResolveIssue[] = [];
    const result = applyManualOverride(templateListing(), { skus: [] }, issues);

    expect(result.variants).toEqual([]);
    expect(issues.some((i) => i.code === POD_DRAFT_ISSUE_CODES.MISSING_VARIANT)).toBe(true);
  });

  it('bảng SKU nhập tay gỡ lỗi biến thể/giá của template', () => {
    const issues: ResolveIssue[] = [
      { level: 'ERROR', field: 'variants', code: POD_DRAFT_ISSUE_CODES.MISSING_VARIANT, message: 'cũ' },
      { level: 'ERROR', field: 'variants', code: POD_DRAFT_ISSUE_CODES.MISSING_PRICE, message: 'cũ' },
    ];

    applyManualOverride(templateListing(), { skus: [sku('A')] }, issues);

    expect(issues).toHaveLength(0);
  });
});

describe('applyManualOverride — kiểm tra giá (gộp lỗi theo §10)', () => {
  it('giá 0 / âm / chữ / rỗng đều là CHƯA ĐẶT', () => {
    for (const bad of ['0', '-5', 'abc', '', '   ']) {
      const issues: ResolveIssue[] = [];
      const result = applyManualOverride(templateListing(), { skus: [sku('A', bad)] }, issues);

      expect(result.variants[0].salePrice).toBeNull();
      expect(issues.some((i) => i.code === POD_DRAFT_ISSUE_CODES.MISSING_PRICE)).toBe(true);
    }
  });

  it('🔴 600 SKU thiếu giá ⇒ ĐÚNG MỘT dòng lỗi, có tổng số', () => {
    const issues: ResolveIssue[] = [];
    const many = Array.from({ length: 600 }, (_, i) => sku(`SKU-${i}`, null));

    applyManualOverride(templateListing(), { skus: many }, issues);

    const priceIssues = issues.filter((i) => i.code === POD_DRAFT_ISSUE_CODES.MISSING_PRICE);
    expect(priceIssues).toHaveLength(1);
    expect(priceIssues[0].message).toContain('600 SKU');
  });

  it('ít SKU lỗi ⇒ liệt kê thẳng mã, không cần "tổng"', () => {
    const issues: ResolveIssue[] = [];
    applyManualOverride(templateListing(), { skus: [sku('A', null), sku('B', null)] }, issues);

    const message = issues.find((i) => i.code === POD_DRAFT_ISSUE_CODES.MISSING_PRICE)?.message;
    expect(message).toContain('A, B');
    expect(message).not.toContain('tổng');
  });

  it('🔴 Seller SKU trùng bị chặn — đơn về sẽ không biết gói món nào', () => {
    const issues: ResolveIssue[] = [];
    applyManualOverride(templateListing(), { skus: [sku('DUP'), sku('DUP'), sku('OK')] }, issues);

    const duplicate = issues.filter((i) => i.field === 'variants.sellerSku');
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0].message).toContain('DUP');
  });

  it('vượt trần số SKU ⇒ chặn, không dựng lưới khổng lồ', () => {
    const issues: ResolveIssue[] = [];
    const tooMany = Array.from({ length: MANUAL_SKU_MAX + 1 }, (_, i) => sku(`S-${i}`));

    const result = applyManualOverride(templateListing(), { skus: tooMany }, issues);

    expect(result.variants).toEqual([]);
    expect(issues[0].message).toContain(String(MANUAL_SKU_MAX));
  });

  it('số lượng bỏ trống ⇒ 0 (hàng hết), KHÔNG phải lỗi chặn', () => {
    const issues: ResolveIssue[] = [];
    const result = applyManualOverride(templateListing(), { skus: [sku('A')] }, issues);

    expect(result.variants[0].quantity).toBe(0);
    expect(issues).toHaveLength(0);
  });
});

describe('applyManualOverride — danh mục · thương hiệu · thuộc tính · kiện hàng', () => {
  it('🔴 chọn danh mục tay ⇒ gỡ lỗi "chưa chọn danh mục" của template', () => {
    const issues: ResolveIssue[] = [
      { level: 'ERROR', field: 'category', code: POD_DRAFT_ISSUE_CODES.MISSING_CATEGORY, message: 'cũ' },
    ];

    const result = applyManualOverride(
      templateListing({ category: { tiktokCategoryId: null, name: null, path: null } }),
      { category: { tiktokCategoryId: '601226', name: 'Posters', path: 'Home > Posters' } },
      issues,
    );

    expect(result.category.tiktokCategoryId).toBe('601226');
    expect(result.category.path).toBe('Home > Posters');
    expect(issues).toHaveLength(0);
  });

  it('🔴 thương hiệu chọn tay QUYẾT `mode`: có id ⇒ SPECIFIC, kể cả khi template nói No brand', () => {
    // `mode` là thứ validator và publisher đọc. Brand chọn tay là câu trả lời của người dùng
    // cho chính sản phẩm này, nên template NONE không được giữ quyền chặn brand đó.
    const payload = templateListing({
      brand: { mode: 'NONE', tiktokBrandId: null, name: 'No brand' } as never,
    });

    const result = applyManualOverride(payload, { brand: { tiktokBrandId: 'new', name: 'Mới' } }, []);

    expect(result.brand).toEqual({ mode: 'SPECIFIC', tiktokBrandId: 'new', name: 'Mới' });
  });

  it('🔴 thương hiệu bỏ trống = No brand (mode NONE) — không template cũng không bị chặn "chưa chọn thương hiệu"', () => {
    const result = applyManualOverride(templateListing(), { brand: {} }, []);
    expect(result.brand.tiktokBrandId).toBeNull();
    expect((result.brand as { mode?: string }).mode).toBe('NONE');
  });

  it('bộ thuộc tính nhập tay THAY TOÀN BỘ bộ của template', () => {
    const payload = templateListing({
      attributes: [
        { tiktokAttributeId: 'TPL', name: 'Của template', type: null, isRequired: false, values: [], customValues: [] },
      ],
    });

    const result = applyManualOverride(
      payload,
      {
        attributes: [
          {
            tiktokAttributeId: '100398',
            name: 'Style',
            type: 'PRODUCT_PROPERTY',
            isRequired: false,
            values: [{ id: '1', name: 'Vintage' }],
            customValues: [],
          },
        ],
      },
      [],
    );

    expect(result.attributes.map((a) => a.tiktokAttributeId)).toEqual(['100398']);
    expect(result.attributes[0].values).toEqual([{ id: '1', name: 'Vintage' }]);
  });

  it('🔴 thuộc tính BẮT BUỘC thiếu giá trị ⇒ MỘT dòng lỗi gộp, không phải mỗi cái một dòng', () => {
    // Một danh mục TikTok có tới 47 thuộc tính. Liệt kê từng cái là đẩy mọi lỗi khác ra
    // khỏi màn hình (§10).
    const issues: ResolveIssue[] = [];
    const attributes = Array.from({ length: 5 }, (_, i) => ({
      tiktokAttributeId: `A${i}`,
      name: `Thuộc tính ${i}`,
      isRequired: true,
      values: [],
      customValues: [],
    }));

    applyManualOverride(templateListing(), { attributes }, issues);

    const missing = issues.filter((i) => i.code === POD_DRAFT_ISSUE_CODES.MISSING_REQUIRED_ATTRIBUTE);
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('tổng 5 thuộc tính');
  });

  it('thuộc tính bắt buộc có giá trị TỰ NHẬP vẫn hợp lệ', () => {
    const issues: ResolveIssue[] = [];
    applyManualOverride(
      templateListing(),
      {
        attributes: [
          { tiktokAttributeId: 'A', name: 'Size', isRequired: true, values: [], customValues: ['30x40'] },
        ],
      },
      issues,
    );

    expect(issues).toHaveLength(0);
  });

  it('🔴 kiện hàng ghi đè TỪNG trường — sửa khối lượng không xoá kích thước của template', () => {
    const payload = templateListing({
      package: {
        weight: '300',
        weightUnit: 'GRAM',
        length: '20',
        width: '15',
        height: '5',
        dimensionUnit: 'CENTIMETER',
      },
    });

    const result = applyManualOverride(payload, { package: { weight: '450' } }, []);

    expect(result.package.weight).toBe('450');
    expect(result.package.length).toBe('20');
    expect(result.package.dimensionUnit).toBe('CENTIMETER');
  });

  it('khối lượng 0 hoặc âm bị chặn', () => {
    for (const bad of ['0', '-1', 'abc']) {
      const issues: ResolveIssue[] = [];
      applyManualOverride(templateListing(), { package: { weight: bad } }, issues);
      expect(issues.some((i) => i.code === POD_DRAFT_ISSUE_CODES.MISSING_PACKAGE)).toBe(true);
    }
  });

  it('parse bỏ danh mục thiếu mã ⇒ rơi về template', () => {
    expect(parseManualOverride({ category: { name: 'Không có mã' } })).toBeNull();
  });

  it('parse giữ thuộc tính có id HOẶC name, bỏ phần tử rỗng', () => {
    const parsed = parseManualOverride({
      attributes: [
        { tiktokAttributeId: 'A', values: [{ id: '1' }, { name: 'Tự nhập' }, {}], customValues: ['x', ''] },
        { name: 'thiếu id' },
      ],
    });

    expect(parsed?.attributes).toHaveLength(1);
    expect(parsed?.attributes?.[0].values).toHaveLength(2);
    expect(parsed?.attributes?.[0].customValues).toEqual(['x']);
  });
});

describe('applyManualOverride — video', () => {
  it('chỉ lưu fileId; `tiktokVideoId` để publisher điền sau khi upload', () => {
    const result = applyManualOverride(templateListing(), { video: { fileId: 'file-1' } }, []);

    expect(result.video).toEqual({ fileId: 'file-1', url: null, tiktokVideoId: null });
  });

  it('không nhập video ⇒ giữ nguyên payload', () => {
    expect(applyManualOverride(templateListing(), { description: 'x' }, []).video).toBeNull();
  });

  it('parse bỏ video thiếu fileId', () => {
    expect(parseManualOverride({ video: { fileName: 'a.mp4' } })).toBeNull();
  });
});

describe('applyManualOverride — từ khoá · highlights · kho (Custom Listing)', () => {
  it('từ khoá và highlights chỉ đến từ nhập tay; không nhập thì payload KHÔNG có trường đó', () => {
    const untouched = applyManualOverride(templateListing(), { description: 'x' }, []);
    // 🔴 Không được thêm `[]` mặc định — payload cũ đã đóng băng không có trường này và
    // `payloadHash` của chúng phải giữ nguyên.
    expect(untouched).not.toHaveProperty('searchTerms');
    expect(untouched).not.toHaveProperty('highlights');

    const result = applyManualOverride(
      templateListing(),
      { searchTerms: ['poster', 'wall art'], highlights: ['Giấy dày 250gsm'] },
      [],
    );
    expect(result.searchTerms).toEqual(['poster', 'wall art']);
    expect(result.highlights).toEqual(['Giấy dày 250gsm']);
  });

  it('parse cắt khoảng trắng, bỏ phần tử rỗng và giữ mảng rỗng là một ý định', () => {
    expect(parseManualOverride({ searchTerms: [' poster ', '', 7, null], highlights: [] })).toEqual({
      searchTerms: ['poster'],
      highlights: [],
    });
  });

  it('kho chọn tay chỉ mang UUID nội bộ — publisher tra lại theo shop đích', () => {
    const result = applyManualOverride(templateListing(), { warehouseId: 'wh-1' }, []);
    expect(result.warehouse).toEqual({ id: 'wh-1', tiktokWarehouseId: null, name: null });
    expect(parseManualOverride({ warehouseId: '  ' })).toBeNull();
    expect(parseManualOverride({ warehouseId: 'wh-2' })).toEqual({ warehouseId: 'wh-2' });
  });
});
