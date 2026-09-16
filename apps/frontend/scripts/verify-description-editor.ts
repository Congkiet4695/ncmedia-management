/**
 * Kiểm chứng phần logic KHÔNG cần DOM của trình soạn thảo Description Template —
 * `npm run test:editor`.
 *
 * 🔴 Điều quan trọng nhất được kiểm ở đây: **nội dung cũ là VĂN BẢN THUẦN không được mất
 * xuống dòng khi mở bằng trình soạn thảo mới.** Cột `content_html` mang tên là HTML nhưng
 * template soạn trước khi có editor là văn bản thuần ngắt dòng bằng `\n` (đúng như bản
 * "Poster" đang nằm trong database). Đổ thẳng chuỗi đó vào `contentEditable` sẽ nuốt sạch
 * mọi lần xuống dòng, và người dùng bấm Lưu sau đó là mất bản gốc — hỏng âm thầm, không
 * có thông báo lỗi nào.
 *
 * ⚠️ `sanitizeHtml` KHÔNG kiểm được ở đây: nó dựa vào `DOMParser`, mà Node không có DOM và
 * dự án không có môi trường test DOM. Xem phần "Còn lại" của báo cáo.
 *
 * Cùng khuôn với `verify-selection.ts`: Node 22 chạy thẳng TypeScript nên file này kiểm
 * ĐÚNG mã nguồn đang chạy trong app.
 */

import { looksLikeHtml, toEditableHtml } from '../lib/sanitize-html.ts';

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

// ---------------------------------------------------------------------------
console.log('nhận diện HTML vs văn bản thuần');

check('có thẻ ⇒ là HTML', looksLikeHtml('<p>xin chào</p>'), true);
check('thẻ tự đóng ⇒ là HTML', looksLikeHtml('dòng một<br>dòng hai'), true);
check('văn bản thuần ⇒ KHÔNG phải HTML', looksLikeHtml('Xin chào\n\nĐây là mô tả'), false);
check('dấu nhỏ hơn trong số học ⇒ KHÔNG phải HTML', looksLikeHtml('giá < 20 USD'), false);
check('emoji + xuống dòng ⇒ KHÔNG phải HTML', looksLikeHtml('⭐️ Poster\n\nCao cấp'), false);

// ---------------------------------------------------------------------------
console.log('văn bản thuần → HTML (chống mất xuống dòng)');

check('rỗng ⇒ rỗng', toEditableHtml(''), '');
check('chỉ khoảng trắng ⇒ rỗng', toEditableHtml('   \n  '), '');

check(
  'một đoạn',
  toEditableHtml('Xin chào'),
  '<p>Xin chào</p>',
);
check(
  'dòng trống ngăn đoạn',
  toEditableHtml('Đoạn một\n\nĐoạn hai'),
  '<p>Đoạn một</p><p>Đoạn hai</p>',
);
check(
  'xuống dòng đơn thành <br>, KHÔNG bị nuốt',
  toEditableHtml('Dòng một\nDòng hai'),
  '<p>Dòng một<br>Dòng hai</p>',
);
check(
  'nhiều dòng trống liên tiếp vẫn chỉ ngắt một lần',
  toEditableHtml('A\n\n\n\nB'),
  '<p>A</p><p>B</p>',
);

// 🔴 Đúng hình dạng bản ghi "Poster" đang có thật trong database.
check(
  'template thật: emoji + tiêu đề + đoạn văn',
  toEditableHtml('⭐️ Premium Poster\n\nElevate your space\nwith vibrant color'),
  '<p>⭐️ Premium Poster</p><p>Elevate your space<br>with vibrant color</p>',
);

// ---------------------------------------------------------------------------
console.log('thoát ký tự (văn bản thuần không được biến thành thẻ)');

check(
  'dấu ngoặc nhọn bị thoát',
  toEditableHtml('giá < 20 & > 10'),
  '<p>giá &lt; 20 &amp; &gt; 10</p>',
);
check(
  'chuỗi trông như thẻ nhưng nằm trong văn bản thuần vẫn bị thoát',
  toEditableHtml('dùng dấu <> để ghi chú'),
  '<p>dùng dấu &lt;&gt; để ghi chú</p>',
);

// ---------------------------------------------------------------------------
console.log('token phải đi qua nguyên vẹn');

check(
  'token hệ thống giữ nguyên trong văn bản thuần',
  toEditableHtml('{{PRODUCT.TITLE}}\n\n{{MATERIAL}}'),
  '<p>{{PRODUCT.TITLE}}</p><p>{{MATERIAL}}</p>',
);

// ---------------------------------------------------------------------------
console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} case sai / ${passed + failed} case`);
  process.exit(1);
}
console.log(`✓ ${passed}/${passed} case trình soạn thảo đúng`);
