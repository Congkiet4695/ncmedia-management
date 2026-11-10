import { ForbiddenException } from '@nestjs/common';

/**
 * Gói của Organization đã hết hạn (`now() >= organizations.expires_at`) — Admin / Employee không đăng nhập
 * và không gọi được API. Super Admin gia hạn (`expires_at` ở tương lai) là dùng lại được ngay, KHÔNG cần
 * đổi trạng thái — trừ khi tổ chức đồng thời đang bị vô hiệu hoá (SUSPENDED).
 *
 * Tách khỏi `AUTH_ORGANIZATION_DEACTIVATED`: người dùng cần làm hai việc khác nhau (gia hạn gói vs hỏi lý do
 * bị khoá). Thông điệp hiển thị lấy theo `code` ở frontend (vi/en).
 */
export class OrganizationExpiredException extends ForbiddenException {
  constructor() {
    super({
      code: 'AUTH_ORGANIZATION_EXPIRED',
      message: 'Gói của tổ chức đã hết hạn, vui lòng liên hệ admin.',
    });
  }
}
