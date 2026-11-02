/**
 * Kiểm chứng luật **ảnh dòng đơn** (danh sách Order + Product Configuration) — chạy bằng `npm run test:item-image`.
 *
 * Kiểm ĐÚNG mã nguồn đang chạy trong app (`features/pod-tiktok/item-image.ts`). `ItemThumbnail` hiện
 * `candidates[số ứng viên đã lỗi]`, nên "ảnh biến thể tải lỗi ⇒ ảnh sản phẩm" là ứng viên thứ hai của danh sách.
 *
 * Thoát mã 1 khi có case sai (dùng được trong CI).
 */

import {
  isUsableImageUrl,
  itemFullImageCandidates,
  itemThumbnailCandidates,
} from '../features/pod-tiktok/item-image.ts';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const VARIANT = 'https://p16-oec-va.ibyteimg.com/variant-blue-m.jpeg';
const PRODUCT = 'https://p16-oec-va.ibyteimg.com/product-thumb.jpeg';
const PRODUCT_FULL = 'https://p16-oec-va.ibyteimg.com/product-full.jpeg';

console.log('thứ tự ưu tiên thumbnail');
check(
  'có ảnh biến thể + ảnh sản phẩm ⇒ biến thể trước',
  itemThumbnailCandidates({ skuImage: VARIANT, productImage: PRODUCT }),
  [VARIANT, PRODUCT],
);
check(
  'không có ảnh biến thể ⇒ ảnh sản phẩm',
  itemThumbnailCandidates({ skuImage: null, productImage: PRODUCT }),
  [PRODUCT],
);
check(
  'ảnh biến thể tải lỗi ⇒ ứng viên kế tiếp là ảnh sản phẩm',
  itemThumbnailCandidates({ skuImage: VARIANT, productImage: PRODUCT })[1],
  PRODUCT,
);
check(
  'ảnh biến thể lỗi, không có ảnh sản phẩm ⇒ hết ứng viên (placeholder)',
  itemThumbnailCandidates({ skuImage: VARIANT, productImage: null })[1],
  undefined,
);
check(
  'không có cả hai ⇒ rỗng (placeholder hiện có)',
  itemThumbnailCandidates({ skuImage: null, productImage: null }),
  [],
);
check(
  'hai nguồn trùng URL ⇒ không thử lại cùng một ảnh hỏng',
  itemThumbnailCandidates({ skuImage: PRODUCT, productImage: ` ${PRODUCT} ` }),
  [PRODUCT],
);

console.log('URL không hợp lệ');
check('rỗng', isUsableImageUrl(''), false);
check('chỉ khoảng trắng', isUsableImageUrl('   '), false);
check('null', isUsableImageUrl(null), false);
check('đường dẫn tương đối', isUsableImageUrl('/img/a.png'), false);
check('javascript:', isUsableImageUrl('javascript:alert(1)'), false);
check('https có khoảng trắng hai đầu', isUsableImageUrl(`  ${VARIANT}  `), true);
check(
  'ảnh biến thể rác ⇒ bỏ qua, dùng ảnh sản phẩm',
  itemThumbnailCandidates({ skuImage: '  not a url ', productImage: PRODUCT }),
  [PRODUCT],
);

console.log('nhiều dòng trong một đơn');
const items = [
  { id: 'a', skuImage: 'https://cdn.example/variant-red-s.jpg', productImage: PRODUCT },
  { id: 'b', skuImage: 'https://cdn.example/variant-blue-l.jpg', productImage: PRODUCT },
  { id: 'c', skuImage: null, productImage: 'https://cdn.example/other-product.jpg' },
];
check(
  'mỗi dòng hiện ảnh biến thể CỦA CHÍNH NÓ',
  items.map((item) => itemThumbnailCandidates(item)[0]),
  ['https://cdn.example/variant-red-s.jpg', 'https://cdn.example/variant-blue-l.jpg', 'https://cdn.example/other-product.jpg'],
);

console.log('bộ xem ảnh cỡ lớn');
check(
  'biến thể → ảnh sản phẩm cỡ đầy đủ → thumbnail sản phẩm',
  itemFullImageCandidates({ skuImage: VARIANT, productImage: PRODUCT, productImageFull: PRODUCT_FULL }),
  [VARIANT, PRODUCT_FULL, PRODUCT],
);
check(
  'không có ảnh biến thể ⇒ ảnh sản phẩm cỡ đầy đủ (như trước)',
  itemFullImageCandidates({ skuImage: null, productImage: PRODUCT, productImageFull: PRODUCT_FULL })[0],
  PRODUCT_FULL,
);

console.log('');
console.log(`${passed} pass · ${failed} fail`);
if (failed > 0) process.exit(1);
