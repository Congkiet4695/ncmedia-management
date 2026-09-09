/**
 * Kiểm chứng phép gom nhóm lỗi Flash Sale — chạy bằng `npm run test:issues`.
 *
 * 🔴 Vì sao là script chứ không phải jest: cùng lý do đã ghi ở `verify-pagination.ts` —
 * frontend chưa có test runner, và Node 22 chạy thẳng TypeScript qua
 * `--experimental-strip-types`, nên file này kiểm ĐÚNG mã nguồn đang chạy trong app.
 *
 * Thoát mã 1 khi có case sai (dùng được trong CI).
 */

import {
  countIssueGroups,
  groupIssues,
  normalizeIssueMessage,
} from '../features/pod-flash-sale/issue-grouping.ts';
import type { PodFlashSaleIssue } from '../features/pod-flash-sale/types.ts';

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

const issue = (over: Partial<PodFlashSaleIssue> = {}): PodFlashSaleIssue => ({
  level: 'ERROR',
  code: 'FLASH_SALE_DISCOUNT_OUT_OF_RANGE',
  field: 'discountPercent',
  message: '% giảm phải nằm trong khoảng (0, 100)',
  ...over,
});

/** `count` lỗi GIỐNG HỆT nhau, mỗi lỗi gắn một dòng khác nhau. */
const repeat = (count: number, over: Partial<PodFlashSaleIssue> = {}): PodFlashSaleIssue[] =>
  Array.from({ length: count }, (_, index) => issue({ itemId: `item-${index}`, ...over }));

// ---------------------------------------------------------------------------
// Đúng vấn đề của yêu cầu: 600 lỗi giống hệt ⇒ MỘT nhóm
// ---------------------------------------------------------------------------
console.log('gom lỗi trùng lặp');

check('600 lỗi giống hệt ⇒ 1 nhóm', groupIssues(repeat(600)).length, 1);
check('600 lỗi giống hệt ⇒ đếm tiêu đề = 1', countIssueGroups(repeat(600)), 1);
check('nhóm giữ tổng số lỗi gốc', groupIssues(repeat(600))[0].count, 600);
check('nhóm đếm đúng số dòng bị ảnh hưởng', groupIssues(repeat(600))[0].affectedItems, 600);
check(
  'thông điệp đại diện giữ nguyên văn',
  groupIssues(repeat(600))[0].message,
  '% giảm phải nằm trong khoảng (0, 100)',
);

// Trường hợp trong ảnh chụp màn hình: 602 lỗi ⇒ 3 nhóm.
const mixed: PodFlashSaleIssue[] = [
  issue({ code: 'FLASH_SALE_TIME_RANGE_INVALID', message: 'Giờ kết thúc phải sau giờ bắt đầu' }),
  ...repeat(600),
  ...repeat(2, {
    code: 'FLASH_SALE_PRICE_ABOVE_RETAIL',
    message: 'Giá deal phải thấp hơn giá niêm yết',
  }),
];
check('602 lỗi ⇒ 3 nhóm', countIssueGroups(mixed), 3);
check('602 lỗi ⇒ đủ ba mã', groupIssues(mixed).map((group) => group.code), [
  'FLASH_SALE_TIME_RANGE_INVALID',
  'FLASH_SALE_DISCOUNT_OUT_OF_RANGE',
  'FLASH_SALE_PRICE_ABOVE_RETAIL',
]);
check('602 lỗi ⇒ đúng số dòng mỗi nhóm', groupIssues(mixed).map((group) => group.affectedItems), [
  0, 600, 2,
]);
// Lỗi phần đầu (không gắn dòng) vẫn đứng ĐẦU, không bị nhóm 600 dòng đẩy xuống.
check('giữ thứ tự xuất hiện đầu tiên', groupIssues(mixed)[0].code, 'FLASH_SALE_TIME_RANGE_INVALID');

// ---------------------------------------------------------------------------
// Lỗi KHÁC nhau không được gom mất
// ---------------------------------------------------------------------------
console.log('giữ lỗi khác nhau');

const distinct: PodFlashSaleIssue[] = [
  issue({ code: 'A', message: 'lỗi A' }),
  issue({ code: 'B', message: 'lỗi B' }),
  issue({ code: 'C', message: 'lỗi C', level: 'WARNING' }),
];
check('3 mã khác nhau ⇒ 3 nhóm', countIssueGroups(distinct), 3);
check('giữ nguyên level của từng nhóm', groupIssues(distinct).map((group) => group.level), [
  'ERROR',
  'ERROR',
  'WARNING',
]);

check('danh sách rỗng ⇒ 0 nhóm', groupIssues([]), []);
check('một lỗi duy nhất ⇒ 1 nhóm, count 1', groupIssues([issue()])[0].count, 1);

// ---------------------------------------------------------------------------
// Mẫu chi tiết — dữ liệu gốc KHÔNG bị mất
// ---------------------------------------------------------------------------
console.log('mẫu chi tiết');

const withNumbers: PodFlashSaleIssue[] = [
  issue({ code: 'P', message: 'Giá deal 25.00 cao hơn giá niêm yết 20.00', itemId: 'i-1' }),
  issue({ code: 'P', message: 'Giá deal 12.50 cao hơn giá niêm yết 10.00', itemId: 'i-2' }),
  issue({ code: 'P', message: 'Giá deal 99.00 cao hơn giá niêm yết 50.00', itemId: 'i-3' }),
  issue({ code: 'P', message: 'Giá deal 11.00 cao hơn giá niêm yết 10.00', itemId: 'i-4' }),
];
check('gom theo MÃ dù câu chữ khác nhau', groupIssues(withNumbers).length, 1);
check('giữ tối đa 3 mẫu', groupIssues(withNumbers)[0].samples.length, 3);
check('không mất tổng số', groupIssues(withNumbers)[0].count, 4);

// Câu chữ lặp lại không được tính là "mẫu" thứ hai.
check('mẫu trùng nhau chỉ giữ một', groupIssues(repeat(5))[0].samples.length, 1);

// ---------------------------------------------------------------------------
// Lùi về so khớp chuỗi khi thiếu mã
// ---------------------------------------------------------------------------
console.log('thiếu mã ⇒ chuẩn hoá chuỗi');

check(
  'chuẩn hoá bỏ số và khoảng trắng thừa',
  normalizeIssueMessage('  Giá deal 25.00 cao hơn   giá niêm yết 20.00 '),
  'giá deal # cao hơn giá niêm yết #',
);

const noCode = [
  { level: 'ERROR', code: '', field: 'f', message: 'Giá 25.00 sai', itemId: 'a' },
  { level: 'ERROR', code: '', field: 'f', message: 'Giá 30.00 sai', itemId: 'b' },
] as unknown as PodFlashSaleIssue[];
// `code: ''` là giá trị rỗng ⇒ rơi vào nhánh so khớp chuỗi đã chuẩn hoá.
check('không có mã ⇒ gom theo chuỗi chuẩn hoá', groupIssues(noCode).length, 1);
check('không có mã ⇒ vẫn đếm đủ', groupIssues(noCode)[0].count, 2);

// ---------------------------------------------------------------------------
// Quy mô lớn
// ---------------------------------------------------------------------------
console.log('quy mô 10.000 dòng');

check('10.000 lỗi giống hệt ⇒ 1 nhóm', countIssueGroups(repeat(10_000)), 1);
check('10.000 lỗi ⇒ vẫn đếm đủ', groupIssues(repeat(10_000))[0].count, 10_000);

// ---------------------------------------------------------------------------
console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} case sai / ${passed + failed} case`);
  process.exit(1);
}
console.log(`✓ ${passed}/${passed} case gom nhóm lỗi đúng`);
