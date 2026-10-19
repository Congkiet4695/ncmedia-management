/**
 * Kiểm chứng hai hàm thuần của TikTok Accounts / Orders — `npm run test:login-info`.
 *
 * 1. `buildLoginInfoPayload`: chỉ gửi trường THẬT SỰ đổi; ô Password / 2FA để trống KHÔNG BAO GIỜ xoá giá trị đã
 *    lưu (chỉ xoá khi tick "Xoá"); sửa Ngày về tiền không kéo theo credential.
 * 2. `parseDesignAmount`: số ≥ 0, tối đa 2 chữ số thập phân.
 */

import { buildLoginInfoPayload } from '../features/pod-tiktok/schemas/pod-tiktok.schema.ts';
import { parseDesignAmount } from '../features/pod-tiktok/design-amount.ts';

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
  console.error(`✗ ${label}\n    expected ${e}\n    actual   ${a}`);
}

const stored = {
  tiktokMail: 'shop@gmail.com',
  hasTiktokPassword: true,
  hasTiktokTwoFactorCode: true,
  moneyReturnDate: '2026-11-05',
};
const untouched = {
  tiktokMail: 'shop@gmail.com',
  tiktokPassword: '',
  clearPassword: false,
  tiktokTwoFactorCode: '',
  clearTwoFactorCode: false,
  moneyReturnDate: '2026-11-05',
};

check('không đổi gì ⇒ payload rỗng (không gửi request)', buildLoginInfoPayload(untouched, stored), {});
check(
  'chỉ đổi Ngày về tiền ⇒ KHÔNG gửi password / 2FA',
  buildLoginInfoPayload({ ...untouched, moneyReturnDate: '2026-12-01' }, stored),
  { moneyReturnDate: '2026-12-01' },
);
check('xoá ngày ⇒ null', buildLoginInfoPayload({ ...untouched, moneyReturnDate: '' }, stored), { moneyReturnDate: null });
check(
  'email chuẩn hoá chữ thường; rỗng ⇒ null',
  [
    buildLoginInfoPayload({ ...untouched, tiktokMail: ' New@Mail.com ' }, stored),
    buildLoginInfoPayload({ ...untouched, tiktokMail: '' }, stored),
  ],
  [{ tiktokMail: 'new@mail.com' }, { tiktokMail: null }],
);
check(
  'nhập password mới ⇒ gửi nguyên văn (không trim)',
  buildLoginInfoPayload({ ...untouched, tiktokPassword: ' p@ss ' }, stored),
  { tiktokPassword: ' p@ss ' },
);
check(
  'ô password chỉ có khoảng trắng ⇒ coi là để trống, không gửi',
  buildLoginInfoPayload({ ...untouched, tiktokPassword: '   ' }, stored),
  {},
);
check(
  'tick Xoá ⇒ null (ưu tiên hơn giá trị gõ)',
  buildLoginInfoPayload({ ...untouched, clearPassword: true, tiktokPassword: 'x', clearTwoFactorCode: true }, stored),
  { tiktokPassword: null, tiktokTwoFactorCode: null },
);
check(
  'tick Xoá khi CHƯA lưu gì ⇒ không gửi',
  buildLoginInfoPayload(
    { ...untouched, clearPassword: true },
    { ...stored, hasTiktokPassword: false },
  ),
  {},
);
check(
  '2FA mới được trim',
  buildLoginInfoPayload({ ...untouched, tiktokTwoFactorCode: ' JBSW Y3DP ' }, stored),
  { tiktokTwoFactorCode: 'JBSW Y3DP' },
);

check('Design Amount hợp lệ', ['0', '2.5', '2,50', ' 10 ', '1000000'].map(parseDesignAmount), [0, 2.5, 2.5, 10, 1_000_000]);
check(
  'Design Amount không hợp lệ ⇒ null',
  ['-1', '1.234', 'abc', '', '1e3', '1000000.01'].map(parseDesignAmount),
  [null, null, null, null, null, null],
);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
