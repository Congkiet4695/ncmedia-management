/**
 * Kiểm chứng hiển thị giờ nghiệp vụ US (`utils/business-time.ts`) — `npm run test:business-time`.
 *
 * 🔴 Chạy script này với NHIỀU múi giờ máy khác nhau (`TZ=Asia/Ho_Chi_Minh`, `TZ=America/Los_Angeles`, `TZ=UTC`):
 * mọi kết quả phải GIỐNG HỆT — cùng một timestamp hiển thị như nhau trên mọi máy. Dòng đầu in múi giờ máy đang
 * dùng để biết lượt chạy thật sự đổi được TZ.
 *
 * Thoát mã 1 khi có case sai.
 */

import {
  businessToday,
  formatBusinessDateTimeFixed,
  formatUsClock,
  timeZoneAbbreviation,
  toInstant,
} from '../utils/business-time.ts';
import { formatOrderDateTime } from '../features/pod-tiktok/order-view-model.ts';

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

console.log(
  `Máy đang ở: ${Intl.DateTimeFormat().resolvedOptions().timeZone} (getTimezoneOffset ${new Date('2026-10-27T12:00:00Z').getTimezoneOffset()} phút)`,
);

const LA = 'America/Los_Angeles';

// --- Nửa đêm ở LA: UTC đã sang ngày hôm sau --------------------------------------------------
check(
  '23:59 PDT (UTC đã 28/10) vẫn là 27/10',
  formatBusinessDateTimeFixed('2026-10-28T06:59:00.000Z'),
  '2026-10-27 23:59',
);
check(
  '00:00 PDT ⇒ sang 28/10',
  formatBusinessDateTimeFixed('2026-10-28T07:00:00.000Z'),
  '2026-10-28 00:00',
);
check(
  'businessToday ngay trước nửa đêm LA',
  businessToday(LA, new Date('2026-10-28T06:59:59.999Z')),
  '2026-10-27',
);
check(
  'businessToday đúng nửa đêm LA',
  businessToday(LA, new Date('2026-10-28T07:00:00.000Z')),
  '2026-10-28',
);
check(
  'sáng sớm ở Việt Nam vẫn là "hôm qua" ở LA',
  businessToday(LA, new Date('2026-10-27T01:00:00.000Z')),
  '2026-10-26',
);

// --- PST / PDT --------------------------------------------------------------------------------
check(
  'mùa đông PST (UTC−8)',
  formatBusinessDateTimeFixed('2026-12-15T08:30:00.000Z'),
  '2026-12-15 00:30',
);
check(
  'mùa hè PDT (UTC−7)',
  formatBusinessDateTimeFixed('2026-07-15T07:30:00.000Z'),
  '2026-07-15 00:30',
);
check('nhãn PDT mùa hè', timeZoneAbbreviation(new Date('2026-07-15T12:00:00Z'), LA), 'PDT');
check('nhãn PST mùa đông', timeZoneAbbreviation(new Date('2026-12-15T12:00:00Z'), LA), 'PST');

// Bắt đầu PDT 08/03/2026 02:00 PST → 03:00 PDT (giờ 02:xx không tồn tại).
check(
  '08/03 01:59 PST',
  formatBusinessDateTimeFixed('2026-03-08T09:59:00.000Z'),
  '2026-03-08 01:59',
);
check(
  '08/03 03:00 PDT (một phút sau, nhảy 1 giờ)',
  formatBusinessDateTimeFixed('2026-03-08T10:00:00.000Z'),
  '2026-03-08 03:00',
);
check(
  'nhãn đổi ngay tại mốc',
  [
    timeZoneAbbreviation(new Date('2026-03-08T09:59:00Z'), LA),
    timeZoneAbbreviation(new Date('2026-03-08T10:00:00Z'), LA),
  ],
  ['PST', 'PDT'],
);
// Kết thúc PDT 01/11/2026 02:00 PDT → 01:00 PST (giờ 01:xx lặp hai lần).
check(
  '01/11 01:30 lần 1 (PDT)',
  formatBusinessDateTimeFixed('2026-11-01T08:30:00.000Z'),
  '2026-11-01 01:30',
);
check(
  '01/11 01:30 lần 2 (PST)',
  formatBusinessDateTimeFixed('2026-11-01T09:30:00.000Z'),
  '2026-11-01 01:30',
);
check(
  'nhãn phân biệt hai lần 01:30',
  [
    timeZoneAbbreviation(new Date('2026-11-01T08:30:00Z'), LA),
    timeZoneAbbreviation(new Date('2026-11-01T09:30:00Z'), LA),
  ],
  ['PDT', 'PST'],
);

// --- Đầu vào ----------------------------------------------------------------------------------
check(
  'ISO có offset khác (-04:00) đổi đúng MỘT lần',
  formatBusinessDateTimeFixed('2026-10-27T20:00:00-04:00'),
  '2026-10-27 17:00',
);
check(
  'epoch milli giây',
  formatBusinessDateTimeFixed(Date.parse('2026-10-27T19:00:00Z')),
  '2026-10-27 12:00',
);
check('null ⇒ —', formatBusinessDateTimeFixed(null), '—');
check('chuỗi rỗng ⇒ —', formatBusinessDateTimeFixed(''), '—');
check('chuỗi hỏng ⇒ —', formatBusinessDateTimeFixed('not-a-date'), '—');
check('toInstant(hỏng) ⇒ null', toInstant('abc'), null);

// --- Màn Orders dùng CHUNG hàm --------------------------------------------------------------
check(
  'formatOrderDateTime (Orders) = giờ LA',
  formatOrderDateTime('2026-10-28T06:59:00.000Z'),
  '2026-10-27 23:59',
);
check('formatOrderDateTime rỗng ⇒ —', formatOrderDateTime(undefined), '—');

// --- Đồng hồ Header ---------------------------------------------------------------------------
const clockEn = formatUsClock(new Date('2026-10-27T22:55:00.000Z'), 'en-US', LA);
check('đồng hồ (en-US): ngày MM/DD/YYYY ở LA', clockEn.date, '10/27/2026');
check('đồng hồ (en-US): 03:55 PM', clockEn.time.replace(/ /g, ' '), '03:55 PM');
check('đồng hồ: nhãn PDT', clockEn.zone, 'PDT');
const clockVi = formatUsClock(new Date('2026-10-27T22:55:00.000Z'), 'vi-VN', LA);
check(
  'đồng hồ (vi-VN): đổi CÁCH VIẾT, không đổi giờ',
  [clockVi.date, clockVi.time],
  ['27/10/2026', '15:55'],
);
check(
  'đồng hồ mùa đông: PST',
  formatUsClock(new Date('2026-12-01T20:00:00Z'), 'en-US', LA).zone,
  'PST',
);

console.log(`${passed} pass · ${failed} fail`);
if (failed > 0) process.exit(1);
