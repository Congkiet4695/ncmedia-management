import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { MeResponseDto } from '../dto/me-response.dto';
import { TokenInvalidException } from '../exceptions/token-invalid.exception';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

/**
 * MeService — lấy hồ sơ người dùng hiện tại từ Access Token.
 *
 * Tenant isolation (ADR-004): query theo **userId + organizationId** (cả hai lấy từ token),
 * KHÔNG query theo email. Loại bản ghi soft-deleted.
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
}
