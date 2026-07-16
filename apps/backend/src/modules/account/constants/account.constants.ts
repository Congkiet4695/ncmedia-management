/** Trường sort cho danh sách Account. */
export const ACCOUNT_SORT_FIELDS = ['createdAt', 'name', 'status', 'issuedAt', 'diedAt'] as const;
export type AccountSortField = (typeof ACCOUNT_SORT_FIELDS)[number];

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
