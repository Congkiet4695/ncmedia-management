import { ForbiddenException } from '@nestjs/common';

/**
 * Organization còn chờ Super Admin duyệt — chưa được đăng nhập (§4, §14).
 *
 * 🔴 Thông điệp cố ý nói rõ "đang chờ duyệt" thay vì gộp vào lỗi đăng nhập chung: người vừa
 * đăng ký nhập đúng email/mật khẩu, và bảo họ "sai thông tin đăng nhập" là đẩy họ đi thử lại
 * mãi một việc không bao giờ thành công.
 */
export class OrganizationPendingApprovalException extends ForbiddenException {
  constructor() {
    super({
      code: 'AUTH_ORGANIZATION_PENDING',
      message:
        'Your organization is waiting for approval. ' +
        'Please wait until the administrator reviews your registration.',
    });
  }
}
