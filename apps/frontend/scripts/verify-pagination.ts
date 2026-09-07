/**
 * Kiểm chứng thuật toán phân trang — chạy bằng `npm run test:pagination`.
 *
 * 🔴 Vì sao là script chứ không phải jest: frontend chưa có test runner, và thêm cả một bộ
 * khung test chỉ để kiểm ba hàm thuần là đổi cấu hình build lấy một thứ script 100 dòng làm
 * được. Node 22 chạy thẳng TypeScript qua `--experimental-strip-types`, nên file này kiểm
 * ĐÚNG mã nguồn đang chạy trong app, không phải một bản chép lại.
 *
 * Chạy được trong CI: thoát mã 1 khi có case sai.
 */

import {
  ELLIPSIS,
  buildPageRange,
  clampPage,
  getShowingRange,
  type PageRangeItem,
} from '../lib/pagination.ts';

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

const E = ELLIPSIS;

// ---------------------------------------------------------------------------
// buildPageRange — dải nút trang
// ---------------------------------------------------------------------------
console.log('buildPageRange');

// Không có trang nào (danh sách rỗng) ⇒ không render nút nào.
check('0 trang', buildPageRange(1, 0), []);
check('1 trang', buildPageRange(1, 1), [1]);
check('2 trang', buildPageRange(1, 2), [1, 2]);

// ≤ 7 trang (maxSlots với siblingCount=1) ⇒ hiện hết, không ellipsis.
check('7 trang, current 4', buildPageRange(4, 7), [1, 2, 3, 4, 5, 6, 7]);

// 8 trang trở lên ⇒ bắt đầu rút gọn.
check('20 trang, đầu dải', buildPageRange(1, 20), [1, 2, 3, 4, 5, E, 20]);
check('20 trang, current 3', buildPageRange(3, 20), [1, 2, 3, 4, 5, E, 20]);
check('20 trang, current 5', buildPageRange(5, 20), [1, E, 4, 5, 6, E, 20]);
check('20 trang, current 10', buildPageRange(10, 20), [1, E, 9, 10, 11, E, 20]);
check('20 trang, cuối dải', buildPageRange(20, 20), [1, E, 16, 17, 18, 19, 20]);
check('20 trang, current 18', buildPageRange(18, 20), [1, E, 16, 17, 18, 19, 20]);

// Ranh giới chuyển từ "không ellipsis trái" sang "có".
check('20 trang, current 4', buildPageRange(4, 20), [1, 2, 3, 4, 5, E, 20]);
check('20 trang, current 17', buildPageRange(17, 20), [1, E, 16, 17, 18, 19, 20]);

// Cách đúng 1 trang thì hiện trang đó, không thay bằng ellipsis (không lợi gì mà mất nút).
check('8 trang, current 4', buildPageRange(4, 8), [1, 2, 3, 4, 5, E, 8]);

// Trang hiện tại ngoài khoảng ⇒ kẹp lại, không vỡ dải.
check('current vượt trần', buildPageRange(999, 20), [1, E, 16, 17, 18, 19, 20]);
check('current âm', buildPageRange(-5, 20), [1, 2, 3, 4, 5, E, 20]);

// siblingCount = 0 ⇒ dải hẹp nhất (dùng cho màn hình nhỏ nếu cần).
check('siblingCount 0', buildPageRange(10, 20, 0), [1, E, 10, E, 20]);

// 🔴 Bất biến quan trọng: với totalPages lớn, số ô KHÔNG đổi khi bấm sang trang khác —
// nếu đổi thì các nút nhảy ngang và người dùng bấm trượt.
const widths = new Set<number>();
for (let page = 1; page <= 50; page += 1) widths.add(buildPageRange(page, 50).length);
check('bề rộng dải cố định (50 trang)', [...widths], [7]);

// Dải luôn tăng dần và không lặp số.
let monotonic = true;
for (let page = 1; page <= 50; page += 1) {
  const nums = buildPageRange(page, 50).filter((x): x is number => x !== ELLIPSIS);
  for (let i = 1; i < nums.length; i += 1) if (nums[i] <= nums[i - 1]) monotonic = false;
}
check('dải tăng dần, không lặp', monotonic, true);

// Trang hiện tại LUÔN có mặt trong dải — không thì không highlight được.
let currentAlwaysPresent = true;
for (const total of [1, 5, 8, 20, 137]) {
  for (let page = 1; page <= total; page += 1) {
    if (!buildPageRange(page, total).includes(page as PageRangeItem)) currentAlwaysPresent = false;
  }
}
check('trang hiện tại luôn nằm trong dải', currentAlwaysPresent, true);

// ---------------------------------------------------------------------------
// getShowingRange — "Showing x–y of z"
// ---------------------------------------------------------------------------
console.log('getShowingRange');

check('rỗng', getShowingRange(1, 20, 0), { from: 0, to: 0 });
check('1 record', getShowingRange(1, 20, 1), { from: 1, to: 1 });
check('10 record, pageSize 10', getShowingRange(1, 10, 10), { from: 1, to: 10 });
check('11 record / 10 — trang 1', getShowingRange(1, 10, 11), { from: 1, to: 10 });
check('11 record / 10 — trang 2', getShowingRange(2, 10, 11), { from: 11, to: 11 });
check('42 record / 20 — trang 1', getShowingRange(1, 20, 42), { from: 1, to: 20 });
check('42 record / 20 — trang 2', getShowingRange(2, 20, 42), { from: 21, to: 40 });
check('42 record / 20 — trang 3', getShowingRange(3, 20, 42), { from: 41, to: 42 });
check('trang đã biến mất (vừa xoá)', getShowingRange(9, 20, 42), { from: 42, to: 42 });
check('limit = 0 (phòng thủ)', getShowingRange(1, 0, 42), { from: 0, to: 0 });

// ---------------------------------------------------------------------------
// clampPage
// ---------------------------------------------------------------------------
console.log('clampPage');

check('trong khoảng', clampPage(3, 10), 3);
check('vượt trần ⇒ trang cuối', clampPage(99, 10), 10);
check('dưới sàn ⇒ trang 1', clampPage(0, 10), 1);
check('âm ⇒ trang 1', clampPage(-3, 10), 1);
check('không còn trang nào ⇒ 1', clampPage(5, 0), 1);
check('NaN ⇒ 1', clampPage(Number.NaN, 10), 1);

// ---------------------------------------------------------------------------
console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} case sai / ${passed + failed} case`);
  process.exit(1);
}
console.log(`✓ ${passed}/${passed} case pagination đúng`);
