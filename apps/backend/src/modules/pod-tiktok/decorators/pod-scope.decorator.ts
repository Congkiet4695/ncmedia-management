import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { POD_SCOPE_REQUEST_KEY, type RequestWithPodScope } from '../guards/pod-scope.guard';
import type { PodAccessScope } from '../services/pod-access-scope.service';

/**
 * `@PodScope()` — phạm vi shop của người dùng, do `PodScopeGuard` nạp sẵn.
 *
 * 🔴 Ném lỗi khi thiếu thay vì trả `{ allShops: true }`. Quên gắn `PodScopeGuard` là một lỗi
 * lập trình; "mặc định thấy hết" sẽ biến lỗi đó thành rò rỉ dữ liệu chạy im lặng trên
 * production, còn ném lỗi thì lộ ra ngay ở lần gọi đầu tiên.
 */
export const PodScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PodAccessScope => {
    const request = ctx.switchToHttp().getRequest<RequestWithPodScope>();
    const scope = request[POD_SCOPE_REQUEST_KEY];
    if (!scope) {
      throw new InternalServerErrorException({
        code: 'POD_SCOPE_NOT_RESOLVED',
        message:
          'Thiếu PodScopeGuard trên controller này. Không thể xác định phạm vi shop nên từ ' +
          'chối phục vụ — xem `PodScopeGuard`.',
      });
    }
    return scope;
  },
);
