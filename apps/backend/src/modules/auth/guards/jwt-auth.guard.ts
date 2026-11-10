import { CanActivate, ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { getOrganizationAccessState } from '../shared/organization-access-cache';
import { organizationAccessDenial, organizationAccessException } from '../shared/organization-access';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { TokenInvalidException } from '../exceptions/token-invalid.exception';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

/** Payload kỳ vọng của Access Token (ADR-021, login.md Mục 9). */
interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  role: string;
  jti: string;
}

type RequestWithUser = Request & { user?: AuthenticatedUser };

/**
 * JwtAuthGuard — xác thực Access Token (Bearer, HS256) cho các route cần đăng nhập.
 *
 * - Verify chữ ký HS256 bằng `jwt.accessSecret` (ENV, không hardcode — ADR-020/021).
 * - Gắn `request.user` (AuthenticatedUser) để controller/service dùng.
 * - Thất bại → 401 AUTH_TOKEN_INVALID.
 *
 * KHÔNG kiểm tra permission/RBAC (ngoài phạm vi — chưa implement).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    /** Kiểm trạng thái / hạn tổ chức mỗi request. Thiếu (kiểm thử dựng tay) ⇒ chỉ xác thực chữ ký như trước. */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request.headers.authorization);
    if (!token) throw new TokenInvalidException();

    let payload: AccessTokenPayload;
    try {
      const secret = this.config.getOrThrow<string>('jwt.accessSecret');
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret,
        algorithms: ['HS256'],
      });
    } catch {
      throw new TokenInvalidException();
    }

    await this.assertOrganizationStillAllowed(payload.organizationId);

    request.user = {
      userId: payload.sub,
      organizationId: payload.organizationId,
      role: payload.role,
      jti: payload.jti,
    };
    return true;
  }

  /**
   * 🔴 Token còn hạn KHÔNG có nghĩa tổ chức còn được dùng hệ thống: tổ chức có thể vừa bị Super Admin VÔ HIỆU
   * HOÁ hoặc vừa HẾT HẠN sau khi token được phát. Kiểm ở đây (mọi route có `JwtAuthGuard`) bằng CÙNG luật với
   * login / `/me` / refresh (`organizationAccessDenial`); đọc qua bộ đệm 30 giây nên không thêm truy vấn mỗi request.
   * Tổ chức hệ thống (Super Admin) luôn đi qua. Tổ chức không còn tồn tại ⇒ 401 như token không hợp lệ.
   */
  private async assertOrganizationStillAllowed(organizationId: string): Promise<void> {
    if (!this.prisma) return;
    const state = await getOrganizationAccessState(this.prisma, organizationId);
    if (!state) throw new TokenInvalidException();
    const denial = organizationAccessDenial(state);
    if (denial) throw organizationAccessException(denial);
  }

  private extractBearerToken(authorization?: string): string | null {
    if (!authorization) return null;
    const [type, token] = authorization.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
