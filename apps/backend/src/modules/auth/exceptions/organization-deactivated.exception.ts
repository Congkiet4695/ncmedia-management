import { ForbiddenException } from '@nestjs/common';

/**
 * Organization bị Super Admin VÔ HIỆU HOÁ (trạng thái `SUSPENDED`) — Admin / Employee không đăng nhập và
 * không gọi được API. Đảo ngược được: Super Admin "Kích hoạt" lại là dùng được, dữ liệu không mất.
 */
export class OrganizationDeactivatedException extends ForbiddenException {
  constructor() {
    super({
      code: 'AUTH_ORGANIZATION_DEACTIVATED',
      message: 'Tổ chức của bạn hiện đang bị vô hiệu hóa. Vui lòng liên hệ Super Admin.',
    });
  }
}
