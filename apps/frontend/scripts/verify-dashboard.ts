/**
 * Kiểm chứng hàm thuần của Dashboard — chạy bằng `npm run test:dashboard`.
 * Cùng khuôn với `verify-pagination.ts`: Node chạy thẳng TypeScript, kiểm ĐÚNG mã nguồn của app.
 * Thoát mã 1 khi có case sai.
 */

import { DASHBOARD_DATE_PRESETS } from '../features/dashboard/types.ts';
import { currentMonthRange, formatChange, fullDay, presetRange, shortDay } from '../features/dashboard/utils.ts';

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

// Bộ lọc thời gian nhanh — đúng thứ tự yêu cầu.
check('Thứ tự lựa chọn nhanh', DASHBOARD_DATE_PRESETS, ['TODAY', 'YESTERDAY', 'THIS_MONTH', 'LAST_MONTH', 'ALL']);

// Mỗi lựa chọn theo giờ vận hành UTC+7 (offset do backend trả).
const VN = 420;
const MID = new Date('2026-10-14T05:00:00.000Z'); // 14/10 12:00 giờ VN
check('Hôm nay', presetRange('TODAY', VN, MID), { from: '2026-10-14', to: '2026-10-14' });
check('Hôm qua', presetRange('YESTERDAY', VN, MID), { from: '2026-10-13', to: '2026-10-13' });
check('Tháng này = đầu tháng → hôm nay', presetRange('THIS_MONTH', VN, MID), { from: '2026-10-01', to: '2026-10-14' });
check('Tháng trước = TRỌN tháng 9 (30 ngày)', presetRange('LAST_MONTH', VN, MID), { from: '2026-09-01', to: '2026-09-30' });

// Biên đầu / cuối ngày: 16:59:59 UTC = 23:59:59 VN vẫn là hôm nay; 17:00 UTC đã sang ngày mới.
check('Cuối ngày 23:59:59 VN', presetRange('TODAY', VN, new Date('2026-10-14T16:59:59.999Z')), { from: '2026-10-14', to: '2026-10-14' });
check('Đầu ngày 00:00 VN (17:00 UTC hôm trước)', presetRange('TODAY', VN, new Date('2026-10-14T17:00:00.000Z')), { from: '2026-10-15', to: '2026-10-15' });
check('Hôm qua lúc 00:30 VN', presetRange('YESTERDAY', VN, new Date('2026-10-14T17:30:00.000Z')), { from: '2026-10-14', to: '2026-10-14' });

// Biên tháng: ngày đầu tháng, tháng có 28 / 29 / 31 ngày, qua năm.
const FIRST_MARCH = new Date('2026-02-28T17:30:00.000Z'); // 01/03/2026 00:30 VN — UTC vẫn là 28/02
check('Ngày đầu tháng: Hôm qua = cuối tháng trước', presetRange('YESTERDAY', VN, FIRST_MARCH), { from: '2026-02-28', to: '2026-02-28' });
check('Ngày đầu tháng: Tháng này = đúng một ngày', presetRange('THIS_MONTH', VN, FIRST_MARCH), { from: '2026-03-01', to: '2026-03-01' });
check('Tháng trước = tháng 2 (28 ngày)', presetRange('LAST_MONTH', VN, FIRST_MARCH), { from: '2026-02-01', to: '2026-02-28' });
check('Tháng trước = tháng 2 năm nhuận (29 ngày)', presetRange('LAST_MONTH', VN, new Date('2028-03-10T05:00:00.000Z')), { from: '2028-02-01', to: '2028-02-29' });
check('Tháng trước = tháng 8 (31 ngày)', presetRange('LAST_MONTH', VN, new Date('2026-09-15T05:00:00.000Z')), { from: '2026-08-01', to: '2026-08-31' });
check('Tháng trước qua năm (tháng 1 ⇒ tháng 12 năm trước)', presetRange('LAST_MONTH', VN, new Date('2027-01-05T05:00:00.000Z')), { from: '2026-12-01', to: '2026-12-31' });
check('Hôm qua qua năm', presetRange('YESTERDAY', VN, new Date('2026-12-31T17:30:00.000Z')), { from: '2026-12-31', to: '2026-12-31' });

// Múi giờ khác: cùng một thời điểm, UTC vẫn ngày cũ còn UTC+7 đã sang ngày mới.
const LATE = new Date('2026-09-30T18:30:00.000Z');
check('UTC+7: hôm nay đã là 01/10', presetRange('TODAY', VN, LATE), { from: '2026-10-01', to: '2026-10-01' });
check('UTC: hôm nay vẫn 30/09', presetRange('TODAY', 0, LATE), { from: '2026-09-30', to: '2026-09-30' });
check('UTC-5: tháng trước', presetRange('LAST_MONTH', -300, new Date('2026-10-01T03:00:00.000Z')), { from: '2026-08-01', to: '2026-08-31' });

check('shortDay', shortDay('2026-09-07'), '07/09');
check('fullDay', fullDay('2026-09-07'), '07/09/2026');

check('% tăng', formatChange(60.43), '+60.43%');
check('% giảm', formatChange(-75), '-75.00%');
check('0%', formatChange(0), '+0.00%');
check('kỳ trước = 0 ⇒ —', formatChange(null), '—');
check('NaN ⇒ —', formatChange(Number.NaN), '—');

console.log(`${failed === 0 ? '✔' : '✗'} dashboard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
