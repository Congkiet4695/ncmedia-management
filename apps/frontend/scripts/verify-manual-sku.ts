/**
 * Kiểm chứng sinh bảng SKU của form nhập tay — `npm run test:manual-sku`.
 *
 * 🔴 Điều quan trọng nhất: **bấm "Tạo SKU" lần hai không được xoá giá đã gõ.** Người vận
 * hành điền giá cho 12 dòng, thêm một màu rồi bấm lại — nếu hàm dựng lại từ đầu thì 12 dòng
 * giá biến mất, và không có thông báo nào. Đó là kiểu mất dữ liệu chỉ phát hiện ra sau khi
 * sản phẩm đã lên sàn sai giá.
 *
 * Thứ hai: tổ hợp phải ĐỦ và KHÔNG TRÙNG (§9.3).
 *
 * Cùng khuôn với `verify-selection.ts`: Node 22 chạy thẳng TypeScript nên file này kiểm
 * ĐÚNG mã nguồn đang chạy trong app.
 */

import {
  buildSkuCombinations,
  countCombinations,
} from '../features/pod-listing-session/manual-sku.ts';

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

const color = { name: 'Color', values: ['Black', 'White', 'Navy'] };
const size = { name: 'Size', values: ['S', 'M', 'L', 'XL'] };
const names = (skus: Array<{ optionValues: Array<{ value: string }> }>) =>
  skus.map((sku) => sku.optionValues.map((o) => o.value).join('/'));

// ---------------------------------------------------------------------------
console.log('sinh tổ hợp (§9.3)');

check('không có trục ⇒ rỗng', buildSkuCombinations([]), []);
check('trục không có giá trị ⇒ rỗng', buildSkuCombinations([{ name: 'Color', values: [] }]), []);
check('trục không có tên ⇒ rỗng', buildSkuCombinations([{ name: '  ', values: ['Black'] }]), []);

check('một trục ⇒ đúng số dòng', buildSkuCombinations([color]).length, 3);

// Đúng ví dụ trong yêu cầu: Color(3) × Size(4) = 12 tổ hợp.
{
  const skus = buildSkuCombinations([color, size]);
  check('3 màu × 4 size ⇒ 12 tổ hợp', skus.length, 12);
  check(
    'đủ và đúng thứ tự',
    names(skus),
    [
      'Black/S', 'Black/M', 'Black/L', 'Black/XL',
      'White/S', 'White/M', 'White/L', 'White/XL',
      'Navy/S', 'Navy/M', 'Navy/L', 'Navy/XL',
    ],
  );
  check('không có tổ hợp trùng', new Set(names(skus)).size, 12);
  check('đếm trước khớp với số dòng sinh ra', countCombinations([color, size]), 12);
}

check('ba trục nhân đúng', countCombinations([color, size, { name: 'Style', values: ['A', 'B'] }]), 24);

// ---------------------------------------------------------------------------
console.log('loại trùng và khoảng trắng');

check(
  'giá trị trùng trong cùng trục bị loại',
  buildSkuCombinations([{ name: 'Color', values: ['Black', 'Black', 'White'] }]).length,
  2,
);
check(
  'giá trị rỗng/khoảng trắng bị loại',
  buildSkuCombinations([{ name: 'Color', values: ['Black', '  ', ''] }]).length,
  1,
);

// ---------------------------------------------------------------------------
console.log('gợi ý Seller SKU');

check(
  'ghép từ giá trị trục, bỏ ký tự lạ',
  buildSkuCombinations([{ name: 'Color', values: ['Sport Grey'] }])[0].sellerSku,
  'SPORTGREY',
);
check(
  'có tiền tố thì ghép vào đầu',
  buildSkuCombinations([color, size], [], { skuPrefix: 'tee' })[0].sellerSku,
  'TEE-BLACK-S',
);

// ---------------------------------------------------------------------------
console.log('🔴 GIỮ dữ liệu đã gõ khi sinh lại');

{
  const first = buildSkuCombinations([color, size]);
  // Người dùng điền giá cho toàn bộ 12 dòng.
  const edited = first.map((sku, index) => ({
    ...sku,
    salePrice: `${20 + index}.99`,
    quantity: 50,
    sellerSku: `MY-${index}`,
  }));

  // …rồi thêm một màu và bấm "Tạo SKU" lần nữa.
  const again = buildSkuCombinations([{ ...color, values: [...color.values, 'Sand'] }, size], edited);

  check('thêm một màu ⇒ 16 tổ hợp', again.length, 16);

  const black = again.find((sku) => sku.optionValues.map((o) => o.value).join('/') === 'Black/S');
  check('giá đã gõ CÒN NGUYÊN', black?.salePrice, '20.99');
  check('Seller SKU người dùng sửa CÒN NGUYÊN', black?.sellerSku, 'MY-0');
  check('số lượng đã gõ còn nguyên', black?.quantity, 50);

  const sand = again.find((sku) => sku.optionValues.map((o) => o.value).join('/') === 'Sand/S');
  check('dòng MỚI để trống giá', sand?.salePrice, '');
  check('dòng mới có Seller SKU gợi ý', sand?.sellerSku, 'SAND-S');
}

{
  // Đổi THỨ TỰ trục không được làm mất dữ liệu — khoá tổ hợp độc lập với thứ tự.
  const first = buildSkuCombinations([color, size]);
  const edited = first.map((sku) => ({ ...sku, salePrice: '19.99' }));
  const swapped = buildSkuCombinations([size, color], edited);

  check('đổi thứ tự trục vẫn 12 tổ hợp', swapped.length, 12);
  check('giá vẫn còn sau khi đổi thứ tự trục', swapped.every((sku) => sku.salePrice === '19.99'), true);
}

{
  // Bỏ bớt một giá trị ⇒ dòng đó biến mất, các dòng còn lại giữ nguyên dữ liệu.
  const first = buildSkuCombinations([color, size]);
  const edited = first.map((sku, index) => ({ ...sku, salePrice: `${index}` }));
  const fewer = buildSkuCombinations([{ name: 'Color', values: ['Black', 'White'] }, size], edited);

  check('bỏ một màu ⇒ 8 tổ hợp', fewer.length, 8);
  check('dòng còn lại giữ đúng giá của chính nó', fewer[0].salePrice, '0');
  check('không còn dòng của màu đã bỏ', names(fewer).some((n) => n.startsWith('Navy')), false);
}

// ---------------------------------------------------------------------------
console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} case sai / ${passed + failed} case`);
  process.exit(1);
}
console.log(`✓ ${passed}/${passed} case sinh SKU đúng`);
