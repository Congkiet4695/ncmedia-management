import { ForbiddenException } from '@nestjs/common';

/**
 * Organization đã bị Super Admin từ chối — không được đăng nhập (§9, §14).
 *
 * KHÔNG kèm lý do từ chối vào response: lý do đã được gửi qua email cho đúng người đăng ký.
 * Trả nó ở endpoint đăng nhập công khai là để bất kỳ ai đoán đúng email cũng đọc được.
 */
export class OrganizationRejectedException extends ForbiddenException {
  constructor() {
    super({
      code: 'AUTH_ORGANIZATION_REJECTED',
      message:
        'Your organization registration was not approved. ' +
        'Please check the email we sent you for details.',
    });
  }
}
