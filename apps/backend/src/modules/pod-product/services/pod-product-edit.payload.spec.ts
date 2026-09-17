import {
  buildPartialEditPayload,
  type ProductEditInput,
  type ProductSnapshot,
} from './pod-product-edit.payload';

/**
 * **Partial Edit — chỉ gửi đúng thứ đã đổi.**
 *
 * 🔴 Vì sao bộ test này tồn tại: hàm này quyết định nội dung gửi tới một sản phẩm ĐANG BÁN
 * trên shop thật. Hai kiểu sai đều không tạo ra exception nào:
 *   - Gửi THỪA một trường ⇒ ghi đè dữ liệu người dùng không hề đụng tới.
 *   - Gửi THIẾU ⇒ bấm Lưu, báo thành công, nhưng trên sàn không có gì đổi.
 * Và cả hai chỉ lộ ra khi mở Seller Center lên xem.
 */

function snapshot(over: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    title: 'Vintage Racing Tee',
    description: '<p>Mô tả cũ</p>',
    tiktokBrandId: 'brand-1',
    packageWeight: '300',
    weightUnit: 'GRAM',
    packageLength: '20',
    packageWidth: '15',
    packageHeight: '5',
    dimensionUnit: 'CENTIMETER',
    searchTerms: ['racing tee'],
    keyProductFeatures: ['100% cotton'],
    mainImageUris: ['img-a', 'img-b', 'img-c'],
    sizeChartUri: 'chart-1',
    sizeChartTemplateId: null,
    videoId: 'video-1',
    variants: [
      {
        tiktokSkuId: 'sku-1',
        sellerSku: 'TEE-BK-S',
        salePrice: '19.99',
        listPrice: '29.99',
        inventoryTotal: 10,
        currency: 'USD',
      },
      {
        tiktokSkuId: 'sku-2',
        sellerSku: 'TEE-BK-M',
        salePrice: '19.99',
        listPrice: '29.99',
        inventoryTotal: 5,
        currency: 'USD',
      },
    ],
    ...over,
  };
}

const build = (input: ProductEditInput, over: Partial<ProductSnapshot> = {}) =>
  buildPartialEditPayload(input, snapshot(over));

describe('buildPartialEditPayload — cấp sản phẩm', () => {
  it('🔴 không đổi gì ⇒ payload RỖNG, nơi gọi không được gọi TikTok', () => {
    const plan = build({ title: 'Vintage Racing Tee', description: '<p>Mô tả cũ</p>' });

    expect(plan.isEmpty).toBe(true);
    expect(plan.body).toEqual({});
  });

  it('🔴 chỉ sửa tiêu đề ⇒ payload CHỈ có tiêu đề', () => {
    const plan = build({ title: 'Tiêu đề mới' });

    expect(plan.body).toEqual({ title: 'Tiêu đề mới' });
    expect(plan.changedFields).toEqual(['title']);
    // Không được kèm mô tả / ảnh / SKU — đó là cách xoá dữ liệu người dùng không đụng tới.
    expect(plan.body.description).toBeUndefined();
    expect(plan.body.skus).toBeUndefined();
  });

  it('trường KHÔNG gửi lên (undefined) ⇒ không đụng tới', () => {
    const plan = build({ title: 'Tiêu đề mới' });
    expect('description' in plan.body).toBe(false);
  });

  it('🔴 gửi chuỗi RỖNG = cố ý xoá, khác hẳn không gửi', () => {
    const plan = build({ description: '' });
    expect(plan.body.description).toBe('');
    expect(plan.changedFields).toContain('description');
  });

  it('khoảng trắng thừa không tính là thay đổi', () => {
    expect(build({ title: '  Vintage Racing Tee  ' }).isEmpty).toBe(true);
  });

  it('đổi thương hiệu', () => {
    expect(build({ brandId: 'brand-2' }).body.brandId).toBe('brand-2');
    expect(build({ brandId: 'brand-1' }).isEmpty).toBe(true);
  });

  it('từ khoá & highlights có vế so — sửa thì gửi', () => {
    const plan = build({ searchTerms: ['racing', ' '], highlights: ['100% cotton', ''] });

    expect(plan.body.searchTerms).toEqual(['racing']);
    // `highlights` trùng hệt ảnh chụp ⇒ KHÔNG gửi.
    expect(plan.body.keyProductFeatures).toBeUndefined();
  });

  it('🔴 gửi đúng từ khoá đang có ⇒ không tính là thay đổi', () => {
    expect(build({ searchTerms: ['racing tee'], highlights: ['100% cotton'] }).isEmpty).toBe(true);
  });

  it('thứ tự từ khoá đổi ⇒ vẫn là thay đổi', () => {
    const plan = build({ searchTerms: ['tee', 'racing'] }, { searchTerms: ['racing', 'tee'] });
    expect(plan.body.searchTerms).toEqual(['tee', 'racing']);
  });

  it('🔴 KHÔNG bao giờ gửi categoryId — TikTok không cho đổi danh mục qua API này', () => {
    const plan = build({ title: 'x' });
    expect('categoryId' in plan.body).toBe(false);
  });
});

describe('buildPartialEditPayload — kiện hàng', () => {
  it('đổi khối lượng ⇒ gửi kèm đơn vị hiện tại', () => {
    const plan = build({ package: { weight: '450' } });
    expect(plan.body.packageWeight).toEqual({ value: '450', unit: 'GRAM' });
  });

  it('khối lượng không đổi ⇒ không gửi', () => {
    expect(build({ package: { weight: '300' } }).isEmpty).toBe(true);
  });

  it('`300` và `300.0` là MỘT — so theo giá trị, không so chuỗi', () => {
    expect(build({ package: { weight: '300.0' } }).isEmpty).toBe(true);
  });

  it('🔴 kích thước gửi theo CỤM — đổi một chiều vẫn gửi đủ ba', () => {
    const plan = build({ package: { length: '25' } });

    expect(plan.body.packageDimensions).toEqual({
      length: '25',
      width: '15',
      height: '5',
      unit: 'CENTIMETER',
    });
  });

  it('🔴 thiếu một chiều ⇒ KHÔNG gửi kích thước (TikTok từ chối cụm thiếu)', () => {
    const plan = build({ package: { length: '25' } }, { packageWidth: null });
    expect(plan.body.packageDimensions).toBeUndefined();
  });
});

describe('buildPartialEditPayload — SKU', () => {
  it('🔴 sửa giá 1 SKU trong 2 ⇒ payload CHỈ có 1 dòng', () => {
    const plan = build({
      skus: [
        { tiktokSkuId: 'sku-1', salePrice: '15.00' },
        { tiktokSkuId: 'sku-2', salePrice: '19.99' }, // không đổi
      ],
    });

    expect(plan.body.skus).toHaveLength(1);
    expect(plan.body.skus?.[0]).toEqual({
      id: 'sku-1',
      price: { amount: '15.00', currency: 'USD' },
    });
    expect(plan.changedSkus).toBe(1);
  });

  it('mỗi SKU chỉ kèm trường của CHÍNH NÓ đã đổi', () => {
    const plan = build({
      skus: [{ tiktokSkuId: 'sku-1', salePrice: '15.00', sellerSku: 'TEE-BK-S' }],
    });

    // `sellerSku` giống hệt hiện tại ⇒ không gửi.
    expect(plan.body.skus?.[0]).toEqual({
      id: 'sku-1',
      price: { amount: '15.00', currency: 'USD' },
    });
  });

  it('đổi Seller SKU', () => {
    const plan = build({ skus: [{ tiktokSkuId: 'sku-1', sellerSku: 'NEW-CODE' }] });
    expect(plan.body.skus?.[0].sellerSku).toBe('NEW-CODE');
  });

  it('đổi list price', () => {
    const plan = build({ skus: [{ tiktokSkuId: 'sku-1', listPrice: '39.99' }] });
    expect(plan.body.skus?.[0].listPrice).toEqual({ amount: '39.99', currency: 'USD' });
  });

  it('tồn kho CẦN kho — thiếu `warehouseId` thì bỏ qua, không đoán', () => {
    expect(build({ skus: [{ tiktokSkuId: 'sku-1', quantity: 99 }] }).isEmpty).toBe(true);

    const plan = build({ skus: [{ tiktokSkuId: 'sku-1', quantity: 99, warehouseId: 'wh-1' }] });
    expect(plan.body.skus?.[0].inventory).toEqual([{ warehouseId: 'wh-1', quantity: 99 }]);
  });

  it('tồn kho không đổi ⇒ không gửi', () => {
    expect(
      build({ skus: [{ tiktokSkuId: 'sku-1', quantity: 10, warehouseId: 'wh-1' }] }).isEmpty,
    ).toBe(true);
  });

  it('🔴 SKU ID lạ bị BỎ QUA — gửi lên có thể sinh biến thể ma trên sản phẩm đang bán', () => {
    const plan = build({ skus: [{ tiktokSkuId: 'khong-ton-tai', salePrice: '5.00' }] });

    expect(plan.body.skus).toBeUndefined();
    expect(plan.isEmpty).toBe(true);
  });

  it('SKU luôn kèm `id` — TikTok cần nó để biết sửa dòng nào', () => {
    const plan = build({ skus: [{ tiktokSkuId: 'sku-2', salePrice: '11.11' }] });
    expect(plan.body.skus?.[0].id).toBe('sku-2');
  });

  it('cập nhật hàng loạt 2 SKU ⇒ đúng 2 dòng, đúng giá từng dòng', () => {
    const plan = build({
      skus: [
        { tiktokSkuId: 'sku-1', salePrice: '12.00' },
        { tiktokSkuId: 'sku-2', salePrice: '13.00' },
      ],
    });

    expect(plan.changedSkus).toBe(2);
    expect(plan.body.skus?.map((sku) => sku.price?.amount)).toEqual(['12.00', '13.00']);
  });
});

describe('buildPartialEditPayload — ảnh sản phẩm', () => {
  it('🔴 bộ ảnh y nguyên ⇒ KHÔNG gửi (mở form rồi đóng không được đụng vào ảnh)', () => {
    expect(build({ mainImageUris: ['img-a', 'img-b', 'img-c'] }).isEmpty).toBe(true);
  });

  it('thêm ảnh ⇒ gửi CẢ BỘ, đúng thứ tự', () => {
    const plan = build({ mainImageUris: ['img-a', 'img-b', 'img-c', 'img-d'] });

    expect(plan.body.mainImages).toEqual([
      { uri: 'img-a' },
      { uri: 'img-b' },
      { uri: 'img-c' },
      { uri: 'img-d' },
    ]);
  });

  it('🔴 xoá một ảnh ⇒ gửi phần CÒN LẠI, không phải "ảnh cần xoá"', () => {
    const plan = build({ mainImageUris: ['img-a', 'img-c'] });
    expect(plan.body.mainImages).toEqual([{ uri: 'img-a' }, { uri: 'img-c' }]);
  });

  it('🔴 đổi thứ tự ⇒ là thay đổi, dù vẫn đủ từng ấy ảnh', () => {
    // A → B → C   trở thành   C → A → B
    const plan = build({ mainImageUris: ['img-c', 'img-a', 'img-b'] });

    expect(plan.body.mainImages).toEqual([{ uri: 'img-c' }, { uri: 'img-a' }, { uri: 'img-b' }]);
    expect(plan.changedFields).toContain('mainImages');
  });

  it('🔴 đổi ảnh đại diện = đưa tấm đó lên đầu (TikTok không có trường riêng)', () => {
    const plan = build({ mainImageUris: ['img-b', 'img-a', 'img-c'] });
    expect(plan.body.mainImages?.[0]).toEqual({ uri: 'img-b' });
  });

  it('🔴 bộ ảnh RỖNG không bao giờ được gửi — sản phẩm TikTok bắt buộc có ảnh', () => {
    const plan = build({ mainImageUris: [] });

    expect(plan.body.mainImages).toBeUndefined();
    expect(plan.isEmpty).toBe(true);
  });

  it('không gửi trường ảnh ⇒ không đụng tới ảnh', () => {
    const plan = build({ title: 'Tiêu đề mới' });
    expect('mainImages' in plan.body).toBe(false);
  });
});

describe('buildPartialEditPayload — bảng size & video', () => {
  it('bảng size mới ⇒ gửi `image.uri`', () => {
    const plan = build({ sizeChart: { uri: 'chart-2' } });
    expect(plan.body.sizeChart).toEqual({ image: { uri: 'chart-2' } });
  });

  it('bảng size không đổi ⇒ không gửi', () => {
    expect(build({ sizeChart: { uri: 'chart-1' } }).isEmpty).toBe(true);
  });

  it('chọn bảng size MẪU của TikTok ⇒ gửi `template.id`, không kèm ảnh', () => {
    const plan = build({ sizeChart: { templateId: 'tpl-9' } });

    expect(plan.body.sizeChart).toEqual({ template: { id: 'tpl-9' } });
    expect(plan.body.sizeChart?.image).toBeUndefined();
  });

  it('🔴 gỡ bảng size (null) ⇒ KHÔNG gửi gì — partial_edit không có cách xoá trường này', () => {
    const plan = build({ sizeChart: null });

    expect(plan.body.sizeChart).toBeUndefined();
    expect(plan.isEmpty).toBe(true);
  });

  it('video mới ⇒ gửi `video.id`', () => {
    expect(build({ videoId: 'video-2' }).body.video).toEqual({ id: 'video-2' });
  });

  it('video không đổi ⇒ không gửi', () => {
    expect(build({ videoId: 'video-1' }).isEmpty).toBe(true);
  });

  it('🔴 gỡ video (chuỗi rỗng) ⇒ KHÔNG gửi gì, cùng lý do với bảng size', () => {
    const plan = build({ videoId: '' });

    expect(plan.body.video).toBeUndefined();
    expect(plan.isEmpty).toBe(true);
  });

  it('sửa ảnh KHÔNG kéo theo bảng size hay video', () => {
    const plan = build({ mainImageUris: ['img-c', 'img-a', 'img-b'] });

    expect(plan.body.sizeChart).toBeUndefined();
    expect(plan.body.video).toBeUndefined();
    expect(plan.body.skus).toBeUndefined();
  });
});
