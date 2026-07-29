import { AccountStatus } from '@prisma/client';

/**
 * Hằng số Import/Export Excel cho Account.
 *
 * ⚠️ Backward compatibility: tên các cột đã tồn tại (`Account Name`, `Platform`, `Username`,
 * `Password`, `Email`, `Proxy`, `Note`, `Status`, `ID`, `Created At`, `Updated At`) **giữ nguyên**
 * để file Import/Export cũ vẫn dùng được. Các cột mới chỉ được **thêm vào**.
 */

export const ACCOUNT_SHEET = 'Accounts';
export const INSTRUCTIONS_SHEET = 'Instructions';

/** Định dạng số/ngày trong file xuất ra. */
export const EXCEL_DATE_FORMAT = 'yyyy-mm-dd';
export const EXCEL_DATETIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';
export const EXCEL_MONEY_FORMAT = '#,##0.00';

/** Định dạng ngày chấp nhận khi import (mô tả cho người dùng). */
export const IMPORT_DATE_FORMAT_HINT = 'YYYY-MM-DD';

/** Giới hạn số dòng mỗi lần import. */
export const ACCOUNT_IMPORT_MAX_ROWS = 5000;

/** Timeout/maxWait cho transaction import (ms). */
export const ACCOUNT_IMPORT_TX_TIMEOUT_MS = 120_000;
export const ACCOUNT_IMPORT_TX_MAX_WAIT_MS = 15_000;

/** Một cột của file Import/Template. `aliases` giúp nhận file cũ / file export. */
export interface AccountExcelColumn {
  header: string;
  aliases: readonly string[];
  required: boolean;
}

/**
 * Toàn bộ cột nghiệp vụ của Account có mặt trong Import/Template.
 * Thứ tự khai báo = thứ tự cột trong file.
 */
export const IMPORT_COLUMNS = {
  name: { header: 'Account Name', aliases: ['Name', 'Tên acc'], required: true },
  platform: { header: 'Platform', aliases: ['Nền tảng'], required: true },
  loginTool: { header: 'Login Tool', aliases: ['Login'], required: false },
  sellerEmail: { header: 'Seller Email', aliases: ['Seller'], required: false },
  status: { header: 'Status', aliases: ['Tình trạng'], required: false },
  issuedAt: { header: 'Issued At', aliases: ['Ngày cấp'], required: false },
  activatedAt: { header: 'Activated At', aliases: ['Ngày hoạt động'], required: false },
  diedBlankAt: { header: 'Died Blank At', aliases: ['Ngày die trắng'], required: false },
  diedAt: { header: 'Died At', aliases: ['Ngày die'], required: false },
  moneyReturnedAt: { header: 'Money Returned At', aliases: ['Ngày về tiền'], required: false },
  dieReason: { header: 'Die Reason', aliases: ['Lỗi die'], required: false },
  holdAmount: { header: 'Hold Amount', aliases: ['Hold'], required: false },
  netAmount: { header: 'Net Amount', aliases: ['Net'], required: false },
  paidAmount: { header: 'Paid Amount', aliases: ['Paid'], required: false },
  username: { header: 'Username', aliases: ['Gmail'], required: false },
  password: { header: 'Password', aliases: ['Pass nền tảng'], required: false },
  email: { header: 'Email', aliases: ['Mail khôi phục'], required: false },
  proxy: { header: 'Proxy', aliases: [], required: false },
  docsUrl: { header: 'Docs URL', aliases: ['Docs'], required: false },
  note: { header: 'Note', aliases: ['Ghi chú'], required: false },
  note2: { header: 'Note 2', aliases: ['Ghi chú 2'], required: false },
} as const satisfies Record<string, AccountExcelColumn>;

export type AccountImportColumnKey = keyof typeof IMPORT_COLUMNS;

/** Thứ tự cột trong Template/Import. */
export const IMPORT_COLUMN_ORDER = Object.keys(IMPORT_COLUMNS) as AccountImportColumnKey[];

/** Header của Template (theo đúng thứ tự). */
export const TEMPLATE_HEADERS: readonly string[] = IMPORT_COLUMN_ORDER.map(
  (key) => IMPORT_COLUMNS[key].header,
);

/** Cột chỉ có ở file Export (read-only, không nhận khi import create). */
export const EXPORT_ONLY_COLUMN = {
  id: 'ID',
  createdAt: 'Created At',
  updatedAt: 'Updated At',
} as const;

/** Header file Export: ID + toàn bộ cột nghiệp vụ + audit time. */
export const EXPORT_HEADERS: readonly string[] = [
  EXPORT_ONLY_COLUMN.id,
  ...TEMPLATE_HEADERS,
  EXPORT_ONLY_COLUMN.createdAt,
  EXPORT_ONLY_COLUMN.updatedAt,
];

/** Cột kiểu ngày (áp numFmt khi export/template). */
export const DATE_COLUMN_KEYS: readonly AccountImportColumnKey[] = [
  'issuedAt',
  'activatedAt',
  'diedBlankAt',
  'diedAt',
  'moneyReturnedAt',
];

/** Cột kiểu tiền (áp numFmt + validate >= 0). */
export const MONEY_COLUMN_KEYS: readonly AccountImportColumnKey[] = [
  'holdAmount',
  'netAmount',
  'paidAmount',
];

/**
 * Cột credential (mã hoá at-rest) → field trong bảng account_credentials.
 * Username → gmail (login) · Password → platformPassword · Email → recoveryMail.
 * Giữ nguyên ánh xạ cũ để không phá file import hiện có.
 */
export const CREDENTIAL_COLUMN_MAP = {
  username: 'gmail',
  password: 'platformPassword',
  email: 'recoveryMail',
} as const satisfies Partial<Record<AccountImportColumnKey, string>>;

/** Giới hạn độ dài (đồng bộ CreateAccountDto). */
export const FIELD_MAX_LENGTH = {
  name: 255,
  loginTool: 100,
  dieReason: 2000,
  proxy: 255,
  docsUrl: 1024,
  note: 2000,
  note2: 2000,
} as const;

/** Danh sách Status hợp lệ (từ Prisma enum — không hardcode chuỗi). */
export const ACCOUNT_STATUS_CODES: readonly string[] = Object.values(AccountStatus);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
