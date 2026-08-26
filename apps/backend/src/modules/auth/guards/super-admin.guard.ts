import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service';
import { SUPER_ADMIN_ROLE_CODE } from '../constants/default-roles';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

/**
 * SuperAdminGuard — chỉ cho phép Super Admin của **Organization hệ thống**.
 *
 * Chạy SAU `JwtAuthGuard`. Hai điều kiện phải đúng CẢ HAI:
 *   1. Role trong token là `SUPER_ADMIN`.
 *   2. Organization của người đó có `is_platform = true`.
 *
 * 🔴 Vì sao cần điều kiện (2): Role là **động** — ADR-009 cho phép mỗi Admin tự tạo role
 * trong Organization của mình, và không gì ngăn họ đặt tên role là `SUPER_ADMIN`. Nếu chỉ
 * kiểm tra tên role thì bất kỳ ai cũng tự phong mình làm quản trị nền tảng bằng một lần tạo
 * role. Cột `is_platform` không nằm trong tầm với của họ, nên nó mới là ranh giới thật.
 *
 * 🔴 Guard này KHÔNG thay thế `PermissionsGuard`. Endpoint quản trị nền tảng dùng cả hai:
 * guard này chốt "đúng người", `@RequirePermissions('platform.*')` chốt "đúng việc" — và
 * quyền `platform.*` bị loại khỏi catalog cấp cho org admin (xem `PermissionService`).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user || user.role !== SUPER_ADMIN_ROLE_CODE) throw this.forbidden();

    const organization = await this.prisma.organization.findFirst({
      where: { id: user.organizationId, isPlatform: true, deletedAt: null },
      select: { id: true },
    });
    if (!organization) throw this.forbidden();

    return true;
  }

  /** Thông điệp giống hệt mọi lỗi 403 khác — không xác nhận sự tồn tại của khu vực quản trị. */
  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'AUTH_FORBIDDEN',
      message: 'Bạn không có quyền truy cập tài nguyên này',
    });
  }
}
