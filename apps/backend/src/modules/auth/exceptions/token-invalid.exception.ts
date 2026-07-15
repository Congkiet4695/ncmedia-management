import { UnauthorizedException } from '@nestjs/common';

/**
 * Access Token sai/hết hạn/không xác thực được, hoặc subject của token không còn hợp lệ
 * (user đã xóa / khác tenant). Code: AUTH_TOKEN_INVALID (auth.md Mục 18 / login.md Mục 12), HTTP 401.
 */
export class TokenInvalidException extends UnauthorizedException {
  constructor() {
    super({ code: 'AUTH_TOKEN_INVALID', message: 'Access token không hợp lệ hoặc đã hết hạn' });
  }
}
