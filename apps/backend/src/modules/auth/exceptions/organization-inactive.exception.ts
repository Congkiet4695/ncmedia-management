import { ForbiddenException } from '@nestjs/common';

/**
 * Organization bị tạm ngưng / đã xoá — không được đăng nhập.
 *
 * Tách khỏi PENDING và REJECTED vì đây là trạng thái của một Organization ĐÃ từng hoạt động,
 * còn hai trạng thái kia thuộc luồng duyệt đăng ký. Gộp chung thì thông điệp gửi tới người
 * dùng sẽ sai với một trong hai tình huống.
 */
export class OrganizationInactiveException extends ForbiddenException {
  constructor() {
    super({
      code: 'AUTH_ORGANIZATION_INACTIVE',
      message: 'Organization của bạn hiện không hoạt động. Vui lòng liên hệ quản trị viên.',
    });
  }
}
