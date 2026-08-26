import { Injectable } from '@nestjs/common';
import { OrganizationStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MeResponseDto } from '../dto/me-response.dto';
import { OrganizationInactiveException } from '../exceptions/organization-inactive.exception';
import { OrganizationPendingApprovalException } from '../exceptions/organization-pending-approval.exception';
import { OrganizationRejectedException } from '../exceptions/organization-rejected.exception';
import { TokenInvalidException } from '../exceptions/token-invalid.exception';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

/**
 * MeService — lấy hồ sơ người dùng hiện tại từ Access Token.
 *
 * Tenant isolation (ADR-004): query theo **userId + organizationId** (cả hai lấy từ token),
 * KHÔNG query theo email. Loại bản ghi soft-deleted.
 *
 * 🔴 Cũng là chốt chặn thứ hai của luồng duyệt (§14). Access token sống 15 phút, nên một
 * Organization bị đình chỉ NGAY SAU khi chủ nó đăng nhập vẫn còn một token hợp lệ trong tay.
 * `/me` là request đầu tiên frontend gọi ở mỗi lần tải trang: chặn tại đây thì phiên đó chết
 * ngay lập tức thay vì sống hết vòng đời token.
 */
@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(current: AuthenticatedUser): Promise<MeResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: current.userId,
        organizationId: current.organizationId, // tenant isolation
        deletedAt: null,
      },
      include: {
        organization: true,
        role: {
          include: {
            rolePermissions: {
              where: { deletedAt: null },
              include: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });

    // Token hợp lệ nhưng subject không còn (bị xóa / khác tenant) → 401.
    if (!user) throw new TokenInvalidException();

    // Organization rời khỏi ACTIVE sau khi token đã phát → cắt phiên ngay.
    this.assertOrganizationActive(user.organization.status);

    // Permissions của Role → Frontend render sidebar/UI theo quyền (không hardcode role).
    const permissions = user.role.rolePermissions.map((rp) => rp.permission.code).sort();

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      // avatar/dateOfBirth thuộc Employee (ADR-007) — chưa có ở Sprint 1.
      avatar: null,
      dateOfBirth: null,
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
      },
      role: {
        id: user.role.id,
        code: user.role.code,
        name: user.role.displayName,
      },
      permissions,
    };
  }

  /** Cùng bộ luật với `LoginService` — một nơi đổi thì nơi kia phải đổi theo. */
  private assertOrganizationActive(status: OrganizationStatus): void {
    if (status === OrganizationStatus.ACTIVE || status === OrganizationStatus.TRIAL) return;
    if (status === OrganizationStatus.PENDING) throw new OrganizationPendingApprovalException();
    if (status === OrganizationStatus.REJECTED) throw new OrganizationRejectedException();
    throw new OrganizationInactiveException();
  }
}
