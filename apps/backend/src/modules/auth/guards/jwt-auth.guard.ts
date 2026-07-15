import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request.headers.authorization);
    if (!token) throw new TokenInvalidException();

    try {
      const secret = this.config.getOrThrow<string>('jwt.accessSecret');
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret,
        algorithms: ['HS256'],
      });
      request.user = {
        userId: payload.sub,
        organizationId: payload.organizationId,
        role: payload.role,
        jti: payload.jti,
      };
      return true;
    } catch {
      throw new TokenInvalidException();
    }
  }

  private extractBearerToken(authorization?: string): string | null {
    if (!authorization) return null;
    const [type, token] = authorization.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
