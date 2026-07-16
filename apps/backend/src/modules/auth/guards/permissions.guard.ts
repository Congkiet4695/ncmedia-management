import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { TokenInvalidException } from '../exceptions/token-invalid.exception';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

/**
 * PermissionsGuard — RBAC theo Permission (ADR-010). Chạy SAU JwtAuthGuard.
 *
 * Nạp danh sách permission `resource.action` của Role người dùng (từ role_permissions)
 * và so với @RequirePermissions. Thiếu quyền → 403 AUTH_FORBIDDEN.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new TokenInvalidException();

    const codes = await this.loadPermissionCodes(user.organizationId, user.role);
    const ok = required.every((p) => codes.has(p));
    if (!ok) {
      throw new ForbiddenException({
        code: 'AUTH_FORBIDDEN',
        message: 'Bạn không có quyền thực hiện thao tác này',
      });
    }
    return true;
  }

  private async loadPermissionCodes(
    organizationId: string,
    roleCode: string,
  ): Promise<Set<string>> {
    const rows = await this.prisma.rolePermission.findMany({
      where: {
        deletedAt: null,
        role: { organizationId, code: roleCode, deletedAt: null },
      },
      select: { permission: { select: { code: true } } },
    });
    return new Set(rows.map((r) => r.permission.code));
  }
}
