import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TokenInvalidException } from '../../auth/exceptions/token-invalid.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import { PodAccessScopeService, type PodAccessScope } from '../services/pod-access-scope.service';

/** Khoá gắn phạm vi vào request — dùng chung với `@PodScope()`. */
export const POD_SCOPE_REQUEST_KEY = 'podScope';

export interface RequestWithPodScope extends Request {
  user?: AuthenticatedUser;
  [POD_SCOPE_REQUEST_KEY]?: PodAccessScope;
}

/**
 * PodScopeGuard — nạp phạm vi shop của người dùng MỘT lần cho mỗi request.
 *
 * Chạy SAU `JwtAuthGuard` (cần `request.user`) và thường đi kèm `PermissionsGuard`.
 * Kết quả gắn vào request để `@PodScope()` đọc ra mà không phải truy vấn lại.
 *
 * 🔴 **Vì sao là Guard chứ không phải param decorator.** Param decorator của Nest chạy đồng
 * bộ, trong khi phạm vi phải đọc từ database. Nhét `await` vào từng controller thì mỗi
 * endpoint mới là một cơ hội quên — và quên ở đây nghĩa là endpoint đó trả dữ liệu của mọi
 * shop. Guard đặt ở cấp controller thì mọi route bên trong đều có phạm vi, kể cả route thêm
 * sau này.
 */
@Injectable()
export class PodScopeGuard implements CanActivate {
  constructor(private readonly accessScope: PodAccessScopeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPodScope>();
    const user = request.user;
    if (!user) throw new TokenInvalidException();

    request[POD_SCOPE_REQUEST_KEY] = await this.accessScope.resolve(user);
    return true;
  }
}
