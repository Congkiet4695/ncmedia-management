/**
 * Kiểm chứng việc ÁP TEMPLATE vào form Custom Listing — `npm run test:template-apply`.
 *
 * 🔴 Điều quan trọng nhất: **template chỉ điền những gì nó THỰC SỰ có.** Trả `null` hay chuỗi
 * rỗng cho một trường template không khai sẽ XOÁ giá trị người dùng vừa gõ — họ bấm "Áp dụng
 * Category Template" rồi mất luôn kho hàng đã chọn, không có thông báo nào.
 *
 * Thứ hai: bảng giá của SKU Template phải được giữ nguyên, không bị sinh lại từ trục.
 */

import {
  applyCategoryTemplate,
  applyImageTemplate,
  applySkuTemplate,
  isTemplateMarketMismatch,
} from '../features/pod-listing-session/template-apply.ts';

let failed = 0;
let passed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}\n      nhận:  ${a}\n      mong:  ${e}`);
}

const categoryTemplate = (over: Record<string, unknown> = {}) =>
  ({
    id: 'ct-1',
    name: 'Tee US',
    market: 'US',
    tiktokCategoryId: '601226',
    categoryName: 'T-Shirts',
    categoryPath: 'Womenswear > T-Shirts',
    brandMode: 'SPECIFIC',
    tiktokBrandId: 'brand-1',
    brandName: 'Gildan',
    warehouseId: 'wh-1',
    packageWeight: '300',
    weightUnit: 'GRAM',
    packageLength: null,
    packageWidth: null,
    packageHeight: null,
    dimensionUnit: null,
    sizeChartFileId: 'file-chart',
    videoFileId: null,
    ...over,
  }) as never;

// ---------------------------------------------------------------------------
console.log('Category Template');

{
  const patch = applyCategoryTemplate(categoryTemplate());
  check('điền market + danh mục', [patch.market, patch.categoryTiktokId], ['US', '601226']);
  check('điền đường dẫn danh mục', patch.categoryPath, 'Womenswear > T-Shirts');
  check('điền thương hiệu', patch.brandId, 'brand-1');
  check('điền kho', patch.warehouseId, 'wh-1');
  check('điền đóng gói phần CÓ khai', patch.package, { weight: '300', weightUnit: 'GRAM' });
  check('điền bảng size từ template', patch.sizeChartFileId, 'file-chart');
  check('template không có video ⇒ KHÔNG đụng tới video', patch.videoFileId, undefined);
}

check(
  '🔴 brandMode NONE = CỐ Ý "No brand", không phải chưa khai',
  applyCategoryTemplate(categoryTemplate({ brandMode: 'NONE', tiktokBrandId: null })).brandId,
  '',
);

{
  // Template không khai kho / đóng gói ⇒ các trường đó phải VẮNG MẶT, không phải null.
  const patch = applyCategoryTemplate(
    categoryTemplate({
      warehouseId: null,
      packageWeight: null,
      weightUnit: null,
      sizeChartFileId: null,
    }),
  );
  check(
    '🔴 không khai kho ⇒ vắng mặt (không xoá lựa chọn của người dùng)',
    'warehouseId' in patch,
    false,
  );
  check('🔴 không khai đóng gói ⇒ vắng mặt', 'package' in patch, false);
  check('không khai bảng size ⇒ vắng mặt', 'sizeChartFileId' in patch, false);
}

check('cảnh báo khi template khác market', isTemplateMarketMismatch('US', 'UK'), true);
check('cùng market ⇒ không cảnh báo', isTemplateMarketMismatch('US', 'US'), false);

// ---------------------------------------------------------------------------
console.log('SKU Template');

const skuTemplate = (over: Record<string, unknown> = {}) =>
  ({
    id: 'st-1',
    name: 'Tee sizes',
    variants: [
      {
        name: 'Color',
        sortOrder: 0,
        values: [
          { value: 'Black', sortOrder: 0 },
          { value: 'White', sortOrder: 1 },
        ],
      },
      {
        name: 'Size',
        sortOrder: 1,
        values: [
          { value: 'S', sortOrder: 0 },
          { value: 'M', sortOrder: 1 },
        ],
      },
    ],
    items: [],
    ...over,
  }) as never;

{
  const { variations, skus } = applySkuTemplate(skuTemplate());
  check('lấy đúng trục và giá trị', variations, [
    { name: 'Color', values: ['Black', 'White'] },
    { name: 'Size', values: ['S', 'M'] },
  ]);
  check('template chưa sinh tổ hợp ⇒ để form tự sinh', skus, []);
}

{
  const { variations, skus } = applySkuTemplate(
    skuTemplate({
      items: [
        {
          id: 'i1',
          variantName: 'Black / S',
          skuCode: 'TEE-BK-S',
          barcode: null,
          retailPrice: '29.99',
          salePrice: '19.99',
          effectiveSalePrice: '17.99',
          quantity: 25,
        },
        {
          id: 'i2',
          variantName: 'White / M',
          skuCode: null,
          barcode: '123',
          retailPrice: null,
          salePrice: null,
          effectiveSalePrice: '18.50',
          quantity: 5,
        },
      ],
    }),
  );

  check('vẫn trả trục để người dùng sửa tiếp', variations.length, 2);
  check('🔴 GIỮ bảng giá của template, không sinh lại', skus.length, 2);
  check('🔴 dùng giá HIỆU LỰC (đã tính quy tắc lệch giá)', skus[0].salePrice, '17.99');
  check('tách "Black / S" về đúng tên trục', skus[0].optionValues, [
    { name: 'Color', value: 'Black' },
    { name: 'Size', value: 'S' },
  ]);
  check('giữ Seller SKU của template', skus[0].sellerSku, 'TEE-BK-S');
  check('thiếu skuCode ⇒ sinh từ tên tổ hợp', skus[1].sellerSku, 'WHITE-M');
  check('giữ số lượng', skus[1].quantity, 5);
  check('giữ barcode khi có', skus[1].barcode, '123');
}

// ---------------------------------------------------------------------------
console.log('Image Template');

const imageTemplate = (items: Array<Record<string, unknown>>) =>
  ({ id: 'it-1', name: 'Tee mockup', items }) as never;

{
  const { images, skipped } = applyImageTemplate(
    imageTemplate([
      { id: 'b', title: 'Back', fileId: 'f2', imageUrl: 'https://cdn/b.png', displayOrder: 1 },
      { id: 'a', title: 'Front', fileId: 'f1', imageUrl: 'https://cdn/a.png', displayOrder: 0 },
    ]),
  );

  check(
    '🔴 giữ ĐÚNG thứ tự của bộ mẫu — tấm đầu là ảnh chính',
    images.map((image) => image.fileName),
    ['Front', 'Back'],
  );
  check('mang theo fileId để khỏi upload lại', images[0].fileId, 'f1');
  check('tất cả là ảnh sản phẩm', images.every((image) => image.imageType === 'MAIN'), true);
  check('không có mục hỏng', skipped, 0);
}

{
  const { images, skipped } = applyImageTemplate(
    imageTemplate([
      { id: 'a', title: 'Front', fileId: 'f1', imageUrl: 'https://cdn/a.png', displayOrder: 0 },
      { id: 'b', title: 'Hỏng', fileId: 'f2', imageUrl: '', displayOrder: 1 },
    ]),
  );

  check('🔴 mục thiếu URL bị bỏ, KHÔNG render thẻ ảnh hỏng', images.length, 1);
  check('báo số mục đã bỏ để form cảnh báo được', skipped, 1);
}

check('bộ ảnh rỗng ⇒ không lỗi', applyImageTemplate(imageTemplate([])).images, []);

{
  const { images, skipped } = applyImageTemplate(
    imageTemplate([
      { id: 'a', title: 'Front', fileId: 'f1', imageUrl: 'https://cdn/a.png', displayOrder: 0, assetType: 'MAIN_FRONT' },
      { id: 'c', title: 'Size Chart', fileId: 'f3', imageUrl: 'https://cdn/chart.png', displayOrder: 1, assetType: 'SIZE_CHART' },
    ]),
  );

  check('🔴 tấm SIZE_CHART của bộ mẫu KHÔNG vào bộ ảnh sản phẩm (backend lấy làm bảng size)', images.map((image) => image.fileId), ['f1']);
  check('bỏ SIZE_CHART không tính là "mục hỏng"', skipped, 0);
}

// ---------------------------------------------------------------------------
console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} case sai / ${passed + failed} case`);
  process.exit(1);
}
console.log(`✓ ${passed}/${passed} case áp template đúng`);
