import type { AccountFormInput } from '../schemas/account.schema';
import type { CreateAccountPayload } from '../types';

/**
 * Chuyển giá trị form → payload API. Bỏ field rỗng (''), giữ `status` (enum) & `name`.
 */
export function toAccountPayload(values: AccountFormInput): CreateAccountPayload {
  const optionalKeys = [
    'idNormalize',
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

  return {
    name: values.name,
    status: values.status,
    ...optional,
  };
}
