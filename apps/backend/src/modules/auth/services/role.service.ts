import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { DEFAULT_ROLES } from '../constants/default-roles';

/**
 * RoleService — seed Role mặc định cho Organization và gán Permission cho Role.
 */
@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Danh sách Role của một Organization (tenant-scoped) — phục vụ chọn Role khi tạo Employee. */
  findManyByOrganization(organizationId: string): Promise<Role[]> {
    return this.prisma.role.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Seed 3 Role hệ thống (ADMIN/EMPLOYEE/FULFILLMENT) trong transaction.
   * Trả về map theo code để tra cứu (VD roles.ADMIN).
   */
  async seedDefaultRolesInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<Record<string, Role>> {
    const map: Record<string, Role> = {};
    for (const role of DEFAULT_ROLES) {
      map[role.code] = await tx.role.create({
        data: {
          organizationId,
          code: role.code,
          displayName: role.displayName,
          description: role.description,
          isSystem: true,
        },
      });
    }
    return map;
  }

  /** Gán danh sách Permission cho một Role trong transaction (Permission chỉ gán qua Role — BR-15). */
  async assignPermissionsInTransaction(
    tx: Prisma.TransactionClient,
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    await tx.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    });
  }
}
