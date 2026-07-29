import type { AccountFormInput } from '../schemas/account.schema';
import type { CreateAccountPayload } from '../types';

/** Field tiền — form giữ dạng chuỗi, API nhận number. */
const AMOUNT_KEYS = ['holdAmount', 'netAmount', 'paidAmount'] as const;

/**
 * Chuyển giá trị form → payload API. Bỏ field rỗng (''), giữ `status` (enum) & `name`.
 * Riêng field tiền: chuỗi → number; để trống = 0 (khớp default của DB).
 */
export function toAccountPayload(values: AccountFormInput): CreateAccountPayload {
  const optionalKeys = [
    'platformId',
    'loginTool',
    'sellerUserId',
    'issuedAt',
    'activatedAt',
    'diedBlankAt',
    'diedAt',
    'moneyReturnedAt',
    'dieReason',
    'proxy',
    'docsUrl',
    'note',
    'note2',
  ] as const;

  const optional: Record<string, string> = {};
  for (const key of optionalKeys) {
    const value = values[key];
    if (value) optional[key] = value;
  }

  const amounts: Record<string, number> = {};
  for (const key of AMOUNT_KEYS) {
    amounts[key] = values[key] === '' ? 0 : Number(values[key]);
  }

  return {
    name: values.name,
    status: values.status,
    ...optional,
    ...amounts,
  };
}
