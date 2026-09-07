import { Injectable, Logger } from '@nestjs/common';
import type { AuthEvent } from '../constants/auth-events';

/** Định danh AN TOÀN được phép đi vào log auth. Không có trường nào chứa bí mật. */
export interface AuthEventContext {
  userId?: string | null;
  organizationId?: string | null;
  /** `id` của bản ghi `refresh_tokens` — định danh phiên, KHÔNG phải token. */
  sessionId?: string | null;
  /** Lý do thất bại (xem `AUTH_REFRESH_FAILURE`). */
  reason?: string | null;
  ipAddress?: string | null;
  /** Số phiên bị thu hồi (dùng cho SESSION_REVOKED). */
  revokedCount?: number;
}

/**
 * AuthEventLogger — log auth có cấu trúc, một chỗ duy nhất.
 *
 * 🔴 Vì sao là service riêng chứ không phải `this.logger.log(...)` rải rác: đây là nơi
 * DUY NHẤT quyết định trường nào được phép ghi ra. Access token, refresh token, hash của
 * chúng và mật khẩu KHÔNG có đường nào lọt vào log vì interface `AuthEventContext` không
 * có chỗ cho chúng — sai sót phải hiện ra lúc biên dịch chứ không phải lúc đọc log sự cố.
 */
@Injectable()
export class AuthEventLogger {
  private readonly logger = new Logger('Auth');

  /** Sự kiện bình thường (login, refresh thành công, logout). */
  info(event: AuthEvent, context: AuthEventContext = {}): void {
    this.logger.log(this.payload(event, context));
  }

  /** Sự kiện bất thường nhưng không phải lỗi hệ thống (refresh hỏng, phiên bị thu hồi). */
  warn(event: AuthEvent, context: AuthEventContext = {}): void {
    this.logger.warn(this.payload(event, context));
  }

  private payload(event: AuthEvent, context: AuthEventContext): Record<string, unknown> {
    return {
      module: 'auth',
      event,
      userId: context.userId ?? undefined,
      organizationId: context.organizationId ?? undefined,
      sessionId: context.sessionId ?? undefined,
      reason: context.reason ?? undefined,
      ipAddress: context.ipAddress ?? undefined,
      revokedCount: context.revokedCount,
      timestamp: new Date().toISOString(),
    };
  }
}
