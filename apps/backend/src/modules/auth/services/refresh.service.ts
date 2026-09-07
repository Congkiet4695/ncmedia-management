import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrganizationStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AUTH_EVENT, AUTH_REFRESH_FAILURE, type AuthRefreshFailure } from '../constants/auth-events';
import { RefreshTokenInvalidException } from '../exceptions/refresh-token-invalid.exception';
import { AuthEventLogger } from './auth-event.logger';
import { IssuedRefreshToken, RefreshTokenService } from './refresh-token.service';
import { TokenMeta, TokenService, TokenSubject } from './token.service';
import { UserWithRole } from './user.service';

/** Payload kỳ vọng của Refresh Token (đối xứng với Access Token — ADR-021). */
interface RefreshTokenPayload {
  sub: string;
  organizationId: string;
  role: string;
  jti: string;
}

/** Cặp token mới sau một lần refresh thành công. */
export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/**
 * RefreshService — vòng đời phiên SAU khi Access Token hết hạn.
 *
 * 🔴 Vì sao service này tồn tại: trước đây hệ thống PHÁT refresh token khi login, lưu nó
 * vào `refresh_tokens` và Redis… rồi không có endpoint nào tiêu thụ nó. Access token sống
 * 15 phút, nên cứ 15 phút một lần người dùng bị đá về màn hình đăng nhập giữa lúc đang làm
 * việc. Đây là nguyên nhân gốc của "tự nhiên bị đăng xuất" — không phải TTL quá ngắn.
 *
 * Ba quy tắc:
 *
 * 1. **Access token hết hạn KHÔNG phải lý do đăng xuất.** Nó chỉ là tín hiệu để refresh.
 *    Chỉ refresh token hỏng/hết hạn/bị thu hồi, user bị vô hiệu hoá, hoặc Organization rời
 *    khỏi trạng thái cho phép mới cắt phiên.
 * 2. **Xoay vòng (rotation) có cửa sổ ân hạn.** Xoay vòng không ân hạn biến mọi request
 *    refresh song song thành một lần "phát hiện token dùng lại" giả và đăng xuất người
 *    dùng — chữa một lỗi bằng cách tạo ra đúng lỗi đó.
 * 3. **Dùng lại token THẬT thì cắt toàn bộ phiên của user.** Sau cửa sổ ân hạn, một token
 *    đã xoay vòng xuất hiện lại nghĩa là có hai bên đang cầm cùng một chuỗi token.
 */
@Injectable()
export class RefreshService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly events: AuthEventLogger,
  ) {}

  /**
   * Đổi Refresh Token lấy cặp token mới.
   *
   * Trình tự (mỗi bước là một lý do từ chối riêng, đi vào log dưới `reason`):
   *   1. Verify JWT (chữ ký + hạn).
   *   2. Tra phiên trong `refresh_tokens` (Source of Truth).
   *   3. Kiểm tra hạn trong database.
   *   4. Phát hiện token dùng lại (ngoài cửa sổ ân hạn) → thu hồi TOÀN BỘ phiên của user.
   *   5. Kiểm tra chủ thể: user còn tồn tại, đúng tenant, đang ACTIVE, Organization hợp lệ.
   *   6. Xoay vòng ATOMIC + phát cặp token mới.
   */
  async refresh(rawToken: string, meta: TokenMeta = {}): Promise<RefreshResult> {
    // (1) Verify JWT
    const payload = await this.verify(rawToken, meta);

    this.events.info(AUTH_EVENT.REFRESH_STARTED, {
      userId: payload.sub,
      organizationId: payload.organizationId,
      ipAddress: meta.ipAddress,
    });

    // (2) Tra phiên
    const session = await this.refreshTokens.findByRawToken(rawToken);
    if (!session) throw this.reject(AUTH_REFRESH_FAILURE.NOT_FOUND, payload, meta);

    // (3) Hạn trong database (độc lập với `exp` của JWT — DB là Source of Truth)
    if (session.expiresAt.getTime() <= Date.now()) {
      throw this.reject(AUTH_REFRESH_FAILURE.DB_EXPIRED, payload, meta, session.id);
    }

    // (4) Token đã thu hồi — phân biệt "race lành tính" với "token bị đánh cắp"
    if (session.revokedAt && !this.withinGrace(session.revokedAt)) {
      const revokedCount = await this.refreshTokens.revokeAllForUser(session.userId);
      this.events.warn(AUTH_EVENT.REFRESH_REUSE_DETECTED, {
        userId: session.userId,
        organizationId: payload.organizationId,
        sessionId: session.id,
        ipAddress: meta.ipAddress,
      });
      this.events.warn(AUTH_EVENT.SESSION_REVOKED, {
        userId: session.userId,
        organizationId: payload.organizationId,
        reason: AUTH_REFRESH_FAILURE.REUSED,
        revokedCount,
      });
      throw this.reject(AUTH_REFRESH_FAILURE.REUSED, payload, meta, session.id);
    }

    // (5) Chủ thể còn hợp lệ không
    const user = await this.loadUser(session.userId, payload, meta, session.id);

    // (6) Xoay vòng atomic + phát cặp token mới.
    //
    // `markRotated` trả `false` khi một request refresh song song vừa xoay vòng đúng bản
    // ghi này. Đó là race LÀNH TÍNH (hai tab, hoặc single-flight phía client bị lỡ) — vẫn
    // phát token mới thay vì cắt phiên, vì token vừa xuất trình do chính hệ thống phát ra
    // và chỉ mới bị thu hồi trong vòng vài giây.
    await this.refreshTokens.markRotated(session.id, null);

    const subject = this.toSubject(user);
    const access = await this.tokenService.createAccessToken(subject);

    // Lỗi ghi database KHÔNG được biến thành 401: 401 bảo frontend đăng xuất, trong khi
    // lần thử lại của một lỗi hạ tầng hoàn toàn có thể thành công.
    const issued: IssuedRefreshToken = await this.prisma.$transaction((tx) =>
      this.refreshTokens.createRefreshToken(tx, subject, meta),
    );

    // Nối chuỗi xoay vòng (reuse detection & truy vết) — ngoài đường quyết định nên
    // best-effort: hỏng thì phiên vẫn đúng, chỉ mất một mắt xích audit.
    await this.prisma.refreshToken
      .update({ where: { id: session.id }, data: { replacedById: issued.id } })
      .catch(() => undefined);

    await this.refreshTokens.cacheRefreshToken(issued).catch(() => undefined);
    await this.refreshTokens.dropCachedSession(session.userId, payload.jti);

    this.events.info(AUTH_EVENT.REFRESH_SUCCESS, {
      userId: user.id,
      organizationId: user.organizationId,
      sessionId: issued.id,
      ipAddress: meta.ipAddress,
    });

    return {
      accessToken: access.token,
      refreshToken: issued.token,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
    };
  }

  /**
   * Đăng xuất — thu hồi ĐÚNG phiên đang dùng.
   *
   * 🔴 Idempotent có chủ ý: token thiếu/sai/đã thu hồi vẫn trả về thành công. Đăng xuất là
   * điều người dùng muốn; trả 401 ở đây chỉ khiến frontend kẹt ở trạng thái "đã bấm đăng
   * xuất nhưng vẫn còn đăng nhập".
   */
  async logout(rawToken: string | undefined, meta: TokenMeta = {}): Promise<void> {
    if (!rawToken) return;

    const session = await this.refreshTokens.findByRawToken(rawToken).catch(() => null);
    if (!session) return;

    const revoked = await this.refreshTokens.revokeSession(session.id);
    const payload = this.decode(rawToken);
    if (payload) await this.refreshTokens.dropCachedSession(session.userId, payload.jti);

    this.events.info(AUTH_EVENT.LOGOUT, {
      userId: session.userId,
      organizationId: payload?.organizationId,
      sessionId: session.id,
      ipAddress: meta.ipAddress,
      reason: revoked ? undefined : 'ALREADY_REVOKED',
    });
  }

  /** Thu hồi MỌI phiên của một user (đổi mật khẩu, vô hiệu hoá tài khoản, sự cố bảo mật). */
  async revokeAllSessions(userId: string, organizationId: string, reason: string): Promise<number> {
    const revokedCount = await this.refreshTokens.revokeAllForUser(userId);
    this.events.warn(AUTH_EVENT.SESSION_REVOKED, {
      userId,
      organizationId,
      reason,
      revokedCount,
    });
    return revokedCount;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async verify(rawToken: string, meta: TokenMeta): Promise<RefreshTokenPayload> {
    const secret = this.config.getOrThrow<string>('jwt.refreshSecret');
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret,
        algorithms: ['HS256'],
      });
    } catch (error) {
      const expired = (error as { name?: string })?.name === 'TokenExpiredError';
      const reason = expired ? AUTH_REFRESH_FAILURE.EXPIRED : AUTH_REFRESH_FAILURE.MALFORMED;
      // Token không giải mã được thì cũng không có định danh nào đáng tin để ghi log.
      this.events.warn(AUTH_EVENT.REFRESH_FAILED, { reason, ipAddress: meta.ipAddress });
      throw new RefreshTokenInvalidException(reason);
    }
  }

  /** Giải mã KHÔNG verify — chỉ để lấy `jti` phục vụ dọn cache khi logout. */
  private decode(rawToken: string): RefreshTokenPayload | null {
    try {
      return this.jwt.decode<RefreshTokenPayload>(rawToken) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Nạp user và áp đúng bộ luật của `LoginService` / `MeService`.
   *
   * Tenant isolation (ADR-004): khớp CẢ `organizationId` trong token — refresh token cũ của
   * một user đã đổi tổ chức không được phép phát ra access token mang tenant sai.
   */
  private async loadUser(
    userId: string,
    payload: RefreshTokenPayload,
    meta: TokenMeta,
    sessionId: string,
  ): Promise<UserWithRole> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: payload.organizationId, deletedAt: null },
      include: { role: true, organization: true },
    });

    if (!user) throw this.reject(AUTH_REFRESH_FAILURE.SUBJECT_GONE, payload, meta, sessionId);

    if (user.status !== UserStatus.ACTIVE) {
      // Tài khoản bị vô hiệu hoá giữa phiên: cắt mọi phiên chứ không chỉ phiên này, nếu
      // không thì thiết bị khác của cùng tài khoản vẫn refresh được thêm 7 ngày nữa.
      await this.refreshTokens.revokeAllForUser(user.id);
      throw this.reject(AUTH_REFRESH_FAILURE.USER_DISABLED, payload, meta, sessionId);
    }

    const orgStatus = user.organization.status;
    if (orgStatus !== OrganizationStatus.ACTIVE && orgStatus !== OrganizationStatus.TRIAL) {
      throw this.reject(AUTH_REFRESH_FAILURE.ORGANIZATION_BLOCKED, payload, meta, sessionId);
    }

    return user;
  }

  /**
   * Cửa sổ ân hạn cho xoay vòng.
   *
   * 🔴 Không có nó thì kiến trúc này TỰ tạo ra bug đăng xuất: người dùng mở hai tab, cả hai
   * cùng refresh, tab thứ hai xuất trình token vừa bị tab thứ nhất xoay vòng — và bị coi là
   * token đánh cắp. Vài giây ân hạn phân biệt "hai request của cùng một người trong cùng
   * một khoảnh khắc" với "token rò rỉ bị dùng lại sau đó".
   */
  private withinGrace(revokedAt: Date): boolean {
    const graceMs = this.config.get<number>('jwt.refreshRotationGraceSeconds', 30) * 1000;
    return Date.now() - revokedAt.getTime() <= graceMs;
  }

  private reject(
    reason: AuthRefreshFailure,
    payload: RefreshTokenPayload,
    meta: TokenMeta,
    sessionId?: string,
  ): RefreshTokenInvalidException {
    this.events.warn(AUTH_EVENT.REFRESH_FAILED, {
      userId: payload.sub,
      organizationId: payload.organizationId,
      sessionId,
      reason,
      ipAddress: meta.ipAddress,
    });
    return new RefreshTokenInvalidException(reason);
  }

  private toSubject(user: UserWithRole): TokenSubject {
    return { userId: user.id, organizationId: user.organizationId, roleCode: user.role.code };
  }
}
