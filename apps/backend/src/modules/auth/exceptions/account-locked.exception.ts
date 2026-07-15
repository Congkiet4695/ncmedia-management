import { HttpException } from '@nestjs/common';

/**
 * Tài khoản bị khóa: `locked_until > now` (khóa tạm 15' do sai nhiều lần)
 * hoặc `status = LOCKED` (khóa bền vững) — BR-L05, Decision-004.
 * HTTP 423 Locked (không có hằng trong HttpStatus của Nest) → dùng literal 423.
 * Code: AUTH_ACCOUNT_LOCKED (login.md Mục 12).
 */
export class AccountLockedException extends HttpException {
  constructor() {
    super({ code: 'AUTH_ACCOUNT_LOCKED', message: 'Tài khoản đang bị khóa, vui lòng thử lại sau' }, 423);
  }
}
