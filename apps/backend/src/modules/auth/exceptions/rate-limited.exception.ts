import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Vượt rate limit login (5 request/phút/IP — Decision-005).
 * Code: RATE_LIMITED (login.md Mục 12), HTTP 429.
 */
export class RateLimitedException extends HttpException {
  constructor() {
    super(
      { code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhiều lần, vui lòng thử lại sau' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
