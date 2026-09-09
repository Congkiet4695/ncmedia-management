/**
 * Kiểm chứng trạng thái lựa chọn của bộ chọn SẢN PHẨM — `npm run test:selection`.
 *
 * 🔴 Điều quan trọng nhất được kiểm ở đây: **lựa chọn phải sống qua việc lật trang**. Đó là
 * chỗ hỏng kinh điển của một bảng có phân trang, và nó hỏng ÂM THẦM — người dùng chỉ phát
 * hiện sau khi bấm Thêm và thấy thiếu hàng.
 *
 * Cùng khuôn với `verify-pagination.ts`: Node 22 chạy thẳng TypeScript, nên file này kiểm
 * ĐÚNG mã nguồn đang chạy trong app.
 */

import {
  isPageFullySelected,
  togglePage,
  toggleRow,
  toPayload,
  type SelectableRow,
  type SelectionState,
} from '../features/pod-flash-sale/selection.ts';

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

/**
 * Một trang sản phẩm. Khoá lựa chọn LUÔN là `productId` — bộ chọn chọn sản phẩm ở cả hai
 * mức áp dụng, backend mới là nơi bung sản phẩm ra thành SKU.
 */
const productPage = (start: number, count: number): SelectableRow[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `p-${start + index}`,
    productId: `p-${start + index}`,
  }));

const empty: SelectionState = new Map();

// ---------------------------------------------------------------------------
// Giữ lựa chọn khi lật trang — yêu cầu quan trọng nhất
// ---------------------------------------------------------------------------
console.log('giữ lựa chọn qua các trang');

const page1 = productPage(1, 20);
const page2 = productPage(21, 20);

// Trang 1: tick Product A, B, C.
let state = empty;
state = toggleRow(state, page1[0]);
state = toggleRow(state, page1[1]);
state = toggleRow(state, page1[2]);
check('tick 3 sản phẩm ở trang 1', state.size, 3);

// Sang trang 2 — dữ liệu dòng đổi hoàn toàn, lựa chọn KHÔNG được mất.
check('sang trang 2: vẫn còn 3 lựa chọn', state.size, 3);
check('trang 2 chưa tick gì', isPageFullySelected(state, page2), false);

// Tick thêm ở trang 2.
state = toggleRow(state, page2[0]);
check('tick thêm ở trang 2 ⇒ 4 lựa chọn', state.size, 4);

// Quay lại trang 1 — ba sản phẩm cũ vẫn phải hiện dấu tick.
check('quay lại trang 1: Product A vẫn được chọn', state.has('p-1'), true);
check('quay lại trang 1: Product B vẫn được chọn', state.has('p-2'), true);
check('quay lại trang 1: Product C vẫn được chọn', state.has('p-3'), true);
check('sản phẩm chưa tick vẫn không được chọn', state.has('p-4'), false);
check('lựa chọn ở trang 2 cũng còn', state.has('p-21'), true);

// Payload gửi đi gồm CẢ những dòng không còn trên trang hiện tại.
check('payload đủ 4 dòng dù chỉ 1 dòng còn trên trang', toPayload(state).length, 4);
// 🔴 Payload chỉ mang `productId`. Ở mức VARIATION, backend tự bung ra mọi SKU của nó.
check('payload chỉ mang productId', toPayload(state)[0], { productId: 'p-1' });

// ---------------------------------------------------------------------------
// Đổi từ khoá tìm kiếm cũng không được mất lựa chọn
// ---------------------------------------------------------------------------
console.log('giữ lựa chọn khi đổi từ khoá');

// Kết quả tìm kiếm là một tập dòng hoàn toàn khác — state không phụ thuộc vào nó.
const searchResult = productPage(500, 5);
check('đổi từ khoá: lựa chọn cũ còn nguyên', state.size, 4);
check('kết quả tìm kiếm mới chưa được tick', isPageFullySelected(state, searchResult), false);
state = toggleRow(state, searchResult[0]);
check('tick trong kết quả tìm kiếm ⇒ cộng dồn', state.size, 5);

// ---------------------------------------------------------------------------
// Bỏ tick
// ---------------------------------------------------------------------------
console.log('bỏ tick');

let toggled = toggleRow(empty, page1[0]);
check('tick rồi bỏ tick ⇒ rỗng', toggleRow(toggled, page1[0]).size, 0);
check('không sửa state cũ tại chỗ', toggled.size, 1);

// ---------------------------------------------------------------------------
// Chọn cả trang
// ---------------------------------------------------------------------------
console.log('chọn cả trang');

let pageState = togglePage(empty, page1, true);
check('chọn cả trang 1 ⇒ 20 dòng', pageState.size, 20);
check('trang 1 đã đầy', isPageFullySelected(pageState, page1), true);
check('trang 2 vẫn chưa đầy', isPageFullySelected(pageState, page2), false);

// Chọn cả trang 2 ⇒ cộng dồn, KHÔNG thay thế.
pageState = togglePage(pageState, page2, true);
check('chọn tiếp cả trang 2 ⇒ 40 dòng (cộng dồn)', pageState.size, 40);

// Bỏ chọn cả trang 1 chỉ gỡ đúng 20 dòng của trang đó.
pageState = togglePage(pageState, page1, false);
check('bỏ chọn trang 1 ⇒ còn 20 dòng của trang 2', pageState.size, 20);
check('dòng trang 2 còn nguyên', pageState.has('p-21'), true);
check('dòng trang 1 đã bị gỡ', pageState.has('p-1'), false);

check('trang rỗng không bao giờ "đã đầy"', isPageFullySelected(empty, []), false);

// ---------------------------------------------------------------------------
// Quy mô lớn
// ---------------------------------------------------------------------------
console.log('quy mô lớn');

let big: SelectionState = new Map();
for (let page = 0; page < 500; page += 1) {
  big = togglePage(big, productPage(page * 20 + 1, 20), true);
}
check('500 trang × 20 dòng ⇒ 10.000 lựa chọn', big.size, 10_000);
check('payload đủ 10.000', toPayload(big).length, 10_000);

// ---------------------------------------------------------------------------
console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} case sai / ${passed + failed} case`);
  process.exit(1);
}
console.log(`✓ ${passed}/${passed} case lựa chọn đúng`);
