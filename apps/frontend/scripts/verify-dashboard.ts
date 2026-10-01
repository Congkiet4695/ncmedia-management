/**
 * Kiểm chứng hàm thuần của Dashboard — chạy bằng `npm run test:dashboard`.
 * Cùng khuôn với `verify-pagination.ts`: Node chạy thẳng TypeScript, kiểm ĐÚNG mã nguồn của app.
 * Thoát mã 1 khi có case sai.
 */

import { currentMonthRange, formatChange, fullDay, shortDay } from '../features/dashboard/utils.ts';

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
  console.error(`✗ ${label}\n   expected ${e}\n   actual   ${a}`);
}

// 30/09/2026 18:30 UTC = 01/10/2026 01:30 giờ VN.
const NOW = new Date('2026-09-30T18:30:00.000Z');
check('Tháng hiện tại theo giờ VN (đã sang tháng 10)', currentMonthRange(420, NOW), { from: '2026-10-01', to: '2026-10-01' });
check('Tháng hiện tại theo UTC (vẫn tháng 9)', currentMonthRange(0, NOW), { from: '2026-09-01', to: '2026-09-30' });
check('Múi giờ âm (UTC-5)', currentMonthRange(-300, new Date('2026-10-01T03:00:00.000Z')), { from: '2026-09-01', to: '2026-09-30' });

check('shortDay', shortDay('2026-09-07'), '07/09');
check('fullDay', fullDay('2026-09-07'), '07/09/2026');

check('% tăng', formatChange(60.43), '+60.43%');
check('% giảm', formatChange(-75), '-75.00%');
check('0%', formatChange(0), '+0.00%');
check('kỳ trước = 0 ⇒ —', formatChange(null), '—');
check('NaN ⇒ —', formatChange(Number.NaN), '—');

console.log(`${failed === 0 ? '✔' : '✗'} dashboard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
