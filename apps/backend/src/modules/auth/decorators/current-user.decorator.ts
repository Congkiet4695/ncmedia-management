import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

/**
 * @CurrentUser() — trích `AuthenticatedUser` mà JwtAuthGuard đã gắn vào request.
 * Chỉ dùng sau khi route được bảo vệ bởi JwtAuthGuard.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    return request.user;
  },
);
