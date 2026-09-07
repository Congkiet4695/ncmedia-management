import { UnauthorizedException } from '@nestjs/common';
import type { AuthRefreshFailure } from '../constants/auth-events';

/**
 * Refresh Token không dùng được: sai chữ ký, hết hạn, đã thu hồi, hoặc chủ thể không còn
 * hợp lệ. Code: AUTH_REFRESH_TOKEN_INVALID, HTTP 401.
 *
 * 🔴 Đây là lỗi DUY NHẤT được phép làm frontend đăng xuất. Access token hết hạn KHÔNG
 * ném lỗi này — nó ném `AUTH_TOKEN_INVALID` và frontend phải thử refresh trước.
 *
 * `reason` chỉ nằm trong log phía server, KHÔNG trả về client: nói cho người gọi biết
 * token "đã bị thu hồi" thay vì "không tồn tại" là mách nước cho kẻ đang thử token trộm.
 */
export class RefreshTokenInvalidException extends UnauthorizedException {
  constructor(readonly reason: AuthRefreshFailure) {
    super({
      code: 'AUTH_REFRESH_TOKEN_INVALID',
      message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại',
    });
  }
}
