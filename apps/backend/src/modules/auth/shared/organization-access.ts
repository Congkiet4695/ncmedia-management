import type { HttpException } from '@nestjs/common';
import { OrganizationStatus } from '@prisma/client';
import { isOrganizationExpiredAt } from '../../../common/organization/organization-plan';
import { OrganizationDeactivatedException } from '../exceptions/organization-deactivated.exception';
import { OrganizationExpiredException } from '../exceptions/organization-expired.exception';
import { OrganizationInactiveException } from '../exceptions/organization-inactive.exception';
import { OrganizationPendingApprovalException } from '../exceptions/organization-pending-approval.exception';
import { OrganizationRejectedException } from '../exceptions/organization-rejected.exception';

/** Những gì cần biết về một Organization để quyết định người dùng của nó có được vào hệ thống không. */
export interface OrganizationAccessState {
  status: OrganizationStatus;
  expiresAt: Date | null;
  isPlatform: boolean;
}

/** Vì sao bị chặn — dùng cho log / lý do refresh thất bại. */
export type OrganizationAccessDenial =
  'PENDING' | 'REJECTED' | 'DEACTIVATED' | 'EXPIRED' | 'INACTIVE';

/**
 * LUẬT DUY NHẤT "người dùng của Organization này có được dùng hệ thống không" — login, `/me`, refresh và
 * `JwtAuthGuard` (mỗi request) cùng gọi hàm này, để bốn cửa không thể lệch nhau.
 *
 * ```
 *   tổ chức hệ thống (Super Admin)        → luôn được (không bị trạng thái / hạn của tenant giới hạn)
 *   PENDING                               → chặn: chờ duyệt
 *   REJECTED                              → chặn: bị từ chối
 *   SUSPENDED                             → chặn: VÔ HIỆU HOÁ (kể cả khi còn hạn)
 *   DELETED                               → chặn: không hoạt động
 *   ACTIVE / TRIAL + now >= expires_at    → chặn: HẾT HẠN
 *   ACTIVE / TRIAL + (còn hạn | NULL)     → được
 * ```
 *
 * 🔴 Trạng thái được xét TRƯỚC hạn: tổ chức vừa bị vô hiệu hoá vừa hết hạn nhận thông điệp "vô hiệu hoá" —
 * gia hạn không tự mở khoá (Super Admin phải Kích hoạt lại).
 *
 * Thời gian so bằng `Date` (epoch, không múi giờ) với cột `timestamptz` — cùng quy ước với toàn backend.
 */
export function organizationAccessDenial(
  organization: OrganizationAccessState,
  now: Date = new Date(),
): OrganizationAccessDenial | null {
  if (organization.isPlatform) return null;
  switch (organization.status) {
    case OrganizationStatus.PENDING:
      return 'PENDING';
    case OrganizationStatus.REJECTED:
      return 'REJECTED';
    case OrganizationStatus.SUSPENDED:
      return 'DEACTIVATED';
    case OrganizationStatus.ACTIVE:
    case OrganizationStatus.TRIAL:
      return isOrganizationExpiredAt(organization.expiresAt, now) ? 'EXPIRED' : null;
    default:
      return 'INACTIVE';
  }
}

/** Exception tương ứng — ném ra ở login / `/me` / guard. */
export function organizationAccessException(denial: OrganizationAccessDenial): HttpException {
  switch (denial) {
    case 'PENDING':
      return new OrganizationPendingApprovalException();
    case 'REJECTED':
      return new OrganizationRejectedException();
    case 'DEACTIVATED':
      return new OrganizationDeactivatedException();
    case 'EXPIRED':
      return new OrganizationExpiredException();
    default:
      return new OrganizationInactiveException();
  }
}

/** Ném nếu bị chặn — tiện cho nơi gọi chỉ cần "được hay không". */
export function assertOrganizationAccess(organization: OrganizationAccessState, now?: Date): void {
  const denial = organizationAccessDenial(organization, now);
  if (denial) throw organizationAccessException(denial);
}
