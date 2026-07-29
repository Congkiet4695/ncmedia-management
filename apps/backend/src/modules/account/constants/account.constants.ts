/** Trường sort cho danh sách Account. */
export const ACCOUNT_SORT_FIELDS = ['createdAt', 'name', 'status', 'issuedAt', 'diedAt'] as const;
export type AccountSortField = (typeof ACCOUNT_SORT_FIELDS)[number];

/**
 * Các chỉ số tiền (USD) lưu trên Account: Hold / Net / Paid.
 * Dùng chung cho DTO, Excel import/export — không lặp lại tên field rải rác.
 */
export const ACCOUNT_AMOUNT_FIELDS = ['holdAmount', 'netAmount', 'paidAmount'] as const;
export type AccountAmountField = (typeof ACCOUNT_AMOUNT_FIELDS)[number];

/** Giới hạn theo DECIMAL(15,2) của DB (đồng nhất với employees.salary). */
export const ACCOUNT_AMOUNT_MAX = 9_999_999_999_999;

/** Số chữ số thập phân tối đa của tiền tệ. */
export const ACCOUNT_AMOUNT_DECIMALS = 2;

/** Các field credential (mã hoá at-rest). Dùng để iterate encrypt/decrypt. */
export const ACCOUNT_CREDENTIAL_FIELDS = [
  'inf',
  'ssn',
  'phoneReg',
  'gmail',
  'gmailPassword',
  'recoveryMail',
  'recoveryMail2fa',
  'platformPassword',
  'platform2faSecret',
] as const;
export type AccountCredentialField = (typeof ACCOUNT_CREDENTIAL_FIELDS)[number];
