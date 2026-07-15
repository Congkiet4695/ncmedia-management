import { ForbiddenException } from '@nestjs/common';

/**
 * Tài khoản INACTIVE / SUSPENDED — không được login (BR-L04, BR-13).
 * Code: AUTH_ACCOUNT_DISABLED (login.md Mục 12).
 */
export class AccountDisabledException extends ForbiddenException {
  constructor() {
    super({ code: 'AUTH_ACCOUNT_DISABLED', message: 'Tài khoản đã bị vô hiệu hóa' });
  }
}
