/**
 * Kiểm chứng logic dựng bộ ảnh của màn hình **POD → Products** — `npm run test:images`.
 *
 * 🔴 Điều quan trọng nhất được kiểm ở đây: **bấm thumbnail thứ i phải mở đúng ảnh thứ i.**
 * Lọc ảnh hỏng và loại trùng làm danh sách NGẮN LẠI; nếu bảng render từ mảng gốc mà lightbox
 * mở theo mảng đã lọc thì chỉ số lệch nhau, và không ai phát hiện ra bằng mắt cho tới khi
 * ngồi so từng tấm. `buildProductGallery` trả về MỘT mảng dùng cho cả hai việc, nên bài test
 * này canh chính xác bất biến đó.
 *
 * Thứ hai: **thumbnail dùng URL thu nhỏ, lightbox dùng URL GỐC.** TikTok trả về hai biến thể
 * (`…-origin-jpeg` và `…-resize-jpeg:300:300`); mở lightbox bằng bản 300px là phóng to một
 * tấm nhoè lên gần hết màn hình.
 *
 * Cùng khuôn với `verify-selection.ts`: Node 22 chạy thẳng TypeScript nên file này kiểm ĐÚNG
 * mã nguồn đang chạy trong app.
 */

import { buildProductGallery, countHiddenImages } from '../features/pod-product/product-images.ts';

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

/** Đúng hình dạng URL mà TikTok trả về (đã đối chiếu với dữ liệu thật trong database). */
const origin = (id: string) =>
  `https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-x/${id}~tplv-fhlh96nyum-origin-jpeg.jpeg?dr=12178&t=555f072d`;
const resize = (id: string) =>
  `https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-x/${id}~tplv-fhlh96nyum-resize-jpeg:300:300.jpeg?dr=12186&t=555f072d`;

const img = (id: string) => ({ url: origin(id), thumbUrl: resize(id) });

// ---------------------------------------------------------------------------
console.log('chọn đúng biến thể URL');

check('rỗng ⇒ mảng rỗng', buildProductGallery([]), []);
check('null/undefined ⇒ mảng rỗng', buildProductGallery(null), []);

check(
  '🔴 src = ảnh GỐC, thumb = bản thu nhỏ',
  buildProductGallery([img('a')]),
  [{ src: origin('a'), thumb: resize('a') }],
);

check(
  'chỉ có url ⇒ dùng chung cho cả hai vai',
  buildProductGallery([{ url: origin('a'), thumbUrl: null }]),
  [{ src: origin('a'), thumb: origin('a') }],
);

check(
  'chỉ có thumbUrl ⇒ dùng chung cho cả hai vai',
  buildProductGallery([{ url: null, thumbUrl: resize('a') }]),
  [{ src: resize('a'), thumb: resize('a') }],
);

check('URL giữ NGUYÊN query string, không bị cắt', buildProductGallery([img('a')])[0].src.includes('?dr=12178&t=555f072d'), true);

// ---------------------------------------------------------------------------
console.log('bỏ ảnh không hợp lệ');

check('thiếu cả hai URL ⇒ bỏ hẳn', buildProductGallery([{ url: null, thumbUrl: null }]), []);
check('chuỗi rỗng ⇒ bỏ hẳn', buildProductGallery([{ url: '', thumbUrl: '' }]), []);
check('chỉ khoảng trắng ⇒ bỏ hẳn', buildProductGallery([{ url: '   ', thumbUrl: '  ' }]), []);
check(
  'bỏ ảnh hỏng NHƯNG giữ đủ ảnh hợp lệ còn lại',
  buildProductGallery([img('a'), { url: null, thumbUrl: null }, img('b')]).map((i) => i.src),
  [origin('a'), origin('b')],
);
check('URL dính khoảng trắng đầu/cuối được cắt', buildProductGallery([{ url: `  ${origin('a')} `, thumbUrl: null }])[0].src, origin('a'));

// ---------------------------------------------------------------------------
console.log('loại ảnh trùng');

check(
  'trùng URL ⇒ giữ tấm ĐẦU TIÊN',
  buildProductGallery([img('a'), img('a'), img('b')]).map((i) => i.src),
  [origin('a'), origin('b')],
);
check(
  'ảnh khác nhau KHÔNG bị loại nhầm',
  buildProductGallery([img('a'), img('b'), img('c')]).length,
  3,
);

// ---------------------------------------------------------------------------
console.log('🔴 chỉ số thumbnail ↔ chỉ số ảnh mở ra');

{
  // Sản phẩm 5 ảnh, tấm thứ 2 hỏng, tấm thứ 4 trùng tấm đầu.
  const raw = [img('a'), { url: null, thumbUrl: null }, img('b'), img('a'), img('c')];
  const gallery = buildProductGallery(raw);

  check('còn lại 3 ảnh dùng được', gallery.length, 3);
  // Bảng render TỪ CHÍNH mảng này ⇒ thumbnail thứ i mở ảnh thứ i, không thể lệch.
  check('thumb[0] → ảnh a', gallery[0].src, origin('a'));
  check('thumb[1] → ảnh b', gallery[1].src, origin('b'));
  check('thumb[2] → ảnh c', gallery[2].src, origin('c'));
  check('mọi thumb đều là bản thu nhỏ', gallery.every((i) => i.thumb.includes('resize')), true);
}

// ---------------------------------------------------------------------------
console.log('chỉ báo "+N"');

// Bảng bày ảnh chính + tối đa 3 ảnh phụ = 4 tấm.
check(
  'server có 9 ảnh, gửi về 5, bày 4 ⇒ +5',
  countHiddenImages({ totalOnServer: 9, received: 5, usable: 5, shown: 4 }),
  5,
);
check(
  'server có 5 ảnh, gửi đủ 5, bày 4 ⇒ +1',
  countHiddenImages({ totalOnServer: 5, received: 5, usable: 5, shown: 4 }),
  1,
);
check(
  'một ảnh duy nhất ⇒ không có +N',
  countHiddenImages({ totalOnServer: 1, received: 1, usable: 1, shown: 1 }),
  0,
);
check(
  '🔴 trừ phần bị loại vì trùng — không trỏ tới ảnh không tồn tại',
  countHiddenImages({ totalOnServer: 3, received: 3, usable: 2, shown: 2 }),
  0,
);
check(
  'không bao giờ âm',
  countHiddenImages({ totalOnServer: 1, received: 4, usable: 1, shown: 1 }),
  0,
);
check(
  'sản phẩm không có ảnh nào',
  countHiddenImages({ totalOnServer: 0, received: 0, usable: 0, shown: 0 }),
  0,
);

// ---------------------------------------------------------------------------
console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} case sai / ${passed + failed} case`);
  process.exit(1);
}
console.log(`✓ ${passed}/${passed} case ảnh sản phẩm đúng`);
