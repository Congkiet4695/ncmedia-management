import { Injectable } from '@nestjs/common';
import { countConnectedShops, isOrganizationExpiredAt } from '../../../common/organization/organization-plan';
import { PrismaService } from '../../../database/prisma.service';
import { MeOrganizationPlanDto, MeResponseDto } from '../dto/me-response.dto';
import { TokenInvalidException } from '../exceptions/token-invalid.exception';
import { assertOrganizationAccess } from '../shared/organization-access';
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

    // Organization rời khỏi ACTIVE / HẾT HẠN sau khi token đã phát → cắt phiên ngay (cùng luật với login).
    assertOrganizationAccess(user.organization);

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
        plan: user.organization.isPlatform ? null : await this.planOf(user.organization),
      },
      role: {
        id: user.role.id,
        code: user.role.code,
        name: user.role.displayName,
      },
      permissions,
    };
  }

  /**
   * Gói của tổ chức cho header Admin / Employee — gộp vào `/me` (request đầu tiên của mỗi lần tải trang) thay
   * vì thêm endpoint: không thêm lượt gọi nào, và cùng phép đếm với chặn kết nối Shop (`organization-plan.ts`).
   */
  private async planOf(organization: {
    id: string;
    status: string;
    shopLimit: number | null;
    expiresAt: Date | null;
  }): Promise<MeOrganizationPlanDto> {
    return {
      status: organization.status,
      connectedShopCount: await countConnectedShops(this.prisma, organization.id),
      shopLimit: organization.shopLimit,
      expiresAt: organization.expiresAt?.toISOString() ?? null,
      expired: isOrganizationExpiredAt(organization.expiresAt),
    };
  }
}
