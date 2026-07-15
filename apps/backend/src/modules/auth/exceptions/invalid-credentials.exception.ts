import { UnauthorizedException } from '@nestjs/common';

/**
 * Sai email hoặc mật khẩu (thông báo trung tính, chống enumeration — BR-21).
 * Code: AUTH_INVALID_CREDENTIALS (login.md Mục 12).
 */
export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng' });
  }
}
