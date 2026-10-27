/**
 * Kiểm chứng hàm thuần của Dashboard — chạy bằng `npm run test:dashboard`.
 * Cùng khuôn với `verify-pagination.ts`: Node chạy thẳng TypeScript, kiểm ĐÚNG mã nguồn của app.
 * Thoát mã 1 khi có case sai.
 */

import { DASHBOARD_DATE_PRESETS } from '../features/dashboard/types.ts';
import { businessToday, currentMonthRange, formatChange, fullDay, isReversedRange, presetRange, shortDay } from '../features/dashboard/utils.ts';

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

// Múi giờ nghiệp vụ: America/Los_Angeles (PDT UTC−7 / PST UTC−8). KHÔNG phải giờ máy chạy script.
const LA = 'America/Los_Angeles';

// 01/10/2026 04:30 UTC = 30/09/2026 21:30 PDT — UTC đã sang tháng 10, LA vẫn tháng 9.
const LATE_SEPT = new Date('2026-10-01T04:30:00.000Z');
check('Tháng hiện tại theo giờ LA (vẫn tháng 9)', currentMonthRange(LA, LATE_SEPT), { from: '2026-09-01', to: '2026-09-30' });
check('Tháng hiện tại theo UTC (đã tháng 10)', currentMonthRange('UTC', LATE_SEPT), { from: '2026-10-01', to: '2026-10-01' });
check('businessToday LA ≠ UTC gần nửa đêm', [businessToday(LA, LATE_SEPT), businessToday('UTC', LATE_SEPT)], ['2026-09-30', '2026-10-01']);

// 14/10/2026 19:00 UTC = 12:00 PDT.
const MID = new Date('2026-10-14T19:00:00.000Z');
check('Hôm nay', presetRange('TODAY', LA, MID), { from: '2026-10-14', to: '2026-10-14' });
check('Hôm qua', presetRange('YESTERDAY', LA, MID), { from: '2026-10-13', to: '2026-10-13' });
check('Tháng này = đầu tháng → hôm nay', presetRange('THIS_MONTH', LA, MID), { from: '2026-10-01', to: '2026-10-14' });
check('Tháng trước = TRỌN tháng 9 (30 ngày)', presetRange('LAST_MONTH', LA, MID), { from: '2026-09-01', to: '2026-09-30' });

// Sát nửa đêm ở LA.
check('23:59:59 PDT vẫn là hôm nay', presetRange('TODAY', LA, new Date('2026-10-15T06:59:59.999Z')), { from: '2026-10-14', to: '2026-10-14' });
check('00:00 PDT đã sang ngày mới', presetRange('TODAY', LA, new Date('2026-10-15T07:00:00.000Z')), { from: '2026-10-15', to: '2026-10-15' });

// Ngày đổi giờ mùa hè — ngày LỊCH không bị lệch dù ngày dài 23 / 25 giờ.
check('08/03 (23 giờ): sáng hôm sau, Hôm qua = 08/03', presetRange('YESTERDAY', LA, new Date('2026-03-09T16:00:00.000Z')), { from: '2026-03-08', to: '2026-03-08' });
check('01/11 23:30 PST (25 giờ) vẫn là 01/11', presetRange('TODAY', LA, new Date('2026-11-02T07:30:00.000Z')), { from: '2026-11-01', to: '2026-11-01' });
check('02/11 00:30 PST ⇒ Hôm qua = 01/11', presetRange('YESTERDAY', LA, new Date('2026-11-02T08:30:00.000Z')), { from: '2026-11-01', to: '2026-11-01' });

// Ranh giới tháng / năm.
const FIRST_MARCH = new Date('2026-03-01T20:00:00.000Z');
check('Ngày đầu tháng: Hôm qua = cuối tháng trước', presetRange('YESTERDAY', LA, FIRST_MARCH), { from: '2026-02-28', to: '2026-02-28' });
check('Ngày đầu tháng: Tháng này = đúng một ngày', presetRange('THIS_MONTH', LA, FIRST_MARCH), { from: '2026-03-01', to: '2026-03-01' });
check('Tháng trước = tháng 2 (28 ngày)', presetRange('LAST_MONTH', LA, FIRST_MARCH), { from: '2026-02-01', to: '2026-02-28' });
check('Tháng trước = tháng 2 năm nhuận (29 ngày)', presetRange('LAST_MONTH', LA, new Date('2028-03-10T20:00:00.000Z')), { from: '2028-02-01', to: '2028-02-29' });
check('Tháng trước qua năm (tháng 1 ⇒ tháng 12 năm trước)', presetRange('LAST_MONTH', LA, new Date('2027-01-05T20:00:00.000Z')), { from: '2026-12-01', to: '2026-12-31' });
check('31/12 22:00 PST: hôm nay vẫn 31/12 (UTC đã 2027)', presetRange('TODAY', LA, new Date('2027-01-01T06:00:00.000Z')), { from: '2026-12-31', to: '2026-12-31' });

// Múi giờ cấu hình được (không DST): cùng thời điểm, Việt Nam đã sang ngày mới.
check('Asia/Ho_Chi_Minh: hôm nay đã là 01/10', presetRange('TODAY', 'Asia/Ho_Chi_Minh', LATE_SEPT), { from: '2026-10-01', to: '2026-10-01' });

// Khoảng tự chọn — kiểm ở giao diện TRƯỚC khi gọi API.
check('từ < đến ⇒ hợp lệ', isReversedRange({ from: '2026-10-01', to: '2026-10-15' }), false);
check('hai ngày bằng nhau ⇒ hợp lệ', isReversedRange({ from: '2026-10-15', to: '2026-10-15' }), false);
check('từ > đến ⇒ KHÔNG hợp lệ', isReversedRange({ from: '2026-10-16', to: '2026-10-15' }), true);
check('qua năm: 2027-01-01 > 2026-12-31', isReversedRange({ from: '2027-01-01', to: '2026-12-31' }), true);
check('thiếu một ngày ⇒ không phải lỗi khoảng', isReversedRange({ from: '2026-10-16', to: '' }), false);
check('Tất cả thời gian ⇒ không kiểm', isReversedRange({ from: '', to: '', allTime: true }), false);

check('shortDay', shortDay('2026-09-07'), '07/09');
check('fullDay', fullDay('2026-09-07'), '07/09/2026');

check('% tăng', formatChange(60.43), '+60.43%');
check('% giảm', formatChange(-75), '-75.00%');
check('0%', formatChange(0), '+0.00%');
check('kỳ trước = 0 ⇒ —', formatChange(null), '—');
check('NaN ⇒ —', formatChange(Number.NaN), '—');

console.log(`${failed === 0 ? '✔' : '✗'} dashboard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
