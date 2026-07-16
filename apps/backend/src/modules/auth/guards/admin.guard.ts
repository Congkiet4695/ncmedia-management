import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ADMIN_ROLE_CODE } from '../constants/default-roles';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

/**
 * AdminGuard — chỉ cho phép User mang Role `ADMIN`.
 *
 * Chạy SAU JwtAuthGuard (đã gắn `request.user`). Role khác → 403 AUTH_FORBIDDEN.
 * Đây là kiểm tra role tối thiểu (không phải hệ thống Permission RBAC đầy đủ).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const role = request.user?.role;
    if (role !== ADMIN_ROLE_CODE) {
      throw new ForbiddenException({
        code: 'AUTH_FORBIDDEN',
        message: 'Bạn không có quyền truy cập tài nguyên này',
      });
    }
    return true;
  }
}
