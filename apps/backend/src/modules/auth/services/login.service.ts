import { Injectable, Logger } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';
import { maskEmail } from '../../../common/utils/mask-email.util';
import { LoginRequestDto } from '../dto/login-request.dto';
import { LoginResponseDto } from '../dto/login-response.dto';
import { AccountDisabledException } from '../exceptions/account-disabled.exception';
import { AccountLockedException } from '../exceptions/account-locked.exception';
import { InvalidCredentialsException } from '../exceptions/invalid-credentials.exception';
import { RateLimitedException } from '../exceptions/rate-limited.exception';
import { RateLimitService } from './rate-limit.service';
import { IssuedRefreshToken, RefreshTokenService } from './refresh-token.service';
import { TokenMeta, TokenService, TokenSubject } from './token.service';
import { UserService, UserWithRole } from './user.service';

/**
 * LoginService — điều phối luồng Login (login.md Mục 5).
 *
 * Flow bắt buộc:
 *   1. Validate input (DTO + ValidationPipe, ở tầng controller/pipe).
 *   2. Rate limit (5/phút/IP — Decision-005).
 *   3. Normalize email.
 *   4. Find user (kèm role).
 *   5. Check deleted (soft delete → coi như không tồn tại).
 *   6. Check locked_until / status LOCKED.
 *   7. bcrypt.compare (luôn chạy — chống timing attack kể cả khi email không tồn tại).
 *   8. Check status (ACTIVE / INACTIVE / SUSPENDED / LOCKED).
 *   9. Reset failed_login_count.
 *   10. Update last_login_at.
 *   11. Generate Access Token.
 *   12. Generate Refresh Token.
 *   13. Save Refresh Token (DB — Source of Truth).
 *   14. Save Redis Cache.
 *   15. Return Response.
 *
 * Bước 9,10,13,14 nằm trong 1 transaction (Section 9).
 */
@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);

  private readonly MAX_FAILED = 5; // Decision-004: 5 lần sai → khóa
  private readonly FAIL_WINDOW_SEC = 15 * 60; // 15 phút (bộ đếm email+ip)
  private readonly RL_LIMIT = 5; // Decision-005: 5 request/phút/IP
  private readonly RL_WINDOW_SEC = 60;

  /** Hash bcrypt "giả" để chống timing attack khi email không tồn tại (BR-L06). */
  private readonly dummyHash = bcrypt.hashSync('__timing_guard_not_a_real_password__', 12);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async login(dto: LoginRequestDto, meta: TokenMeta = {}): Promise<LoginResponseDto> {
    const ip = meta.ipAddress ?? 'unknown';

    // (2) Rate limit 5/phút/IP
    const rl = await this.rateLimit.hit(`login_rl:${ip}`, this.RL_LIMIT, this.RL_WINDOW_SEC);
    if (rl.limited) {
      this.logger.warn(`Login rate limited (ip masked)`);
      throw new RateLimitedException();
    }

    // (3) Normalize email (DTO đã transform; chuẩn hóa lại phòng thủ)
    const email = dto.email.trim().toLowerCase();

    // (4) Find user + (5) check deleted
    const found = await this.userService.findByEmail(email);
    const user = found && !found.deletedAt ? found : null;

    // (6) Check khóa (chỉ khi có user) — locked_until tạm thời hoặc status LOCKED bền vững
    if (user && this.isLocked(user)) {
      this.logger.warn(`Login blocked - locked account email=${maskEmail(email)}`);
      throw new AccountLockedException();
    }

    // (7) bcrypt.compare — LUÔN chạy để chống timing attack
    const passwordOk = await bcrypt.compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !passwordOk) {
      await this.registerFailure(user?.id, email, ip);
      this.logger.warn(`Login failed - invalid credentials email=${maskEmail(email)}`);
      throw new InvalidCredentialsException();
    }

    // (8) Check status
    this.assertStatusAllowsLogin(user.status);

    // (11) Access token (không cần transaction — không ghi DB)
    const access = await this.tokenService.createAccessToken(this.toSubject(user));

    // (9,10,12,13) Transaction: reset counter + last_login + tạo/lưu refresh token (DB — Source of Truth)
    let issued: IssuedRefreshToken;
    try {
      issued = await this.prisma.$transaction(async (tx) => {
        await this.userService.resetFailedLogin(tx, user.id); // (9)
        await this.userService.updateLastLogin(tx, user.id); // (10)
        // (12) generate + (13) save DB (chưa cache Redis — tránh I/O ngoài trong transaction)
        return this.refreshTokenService.createRefreshToken(tx, this.toSubject(user), meta);
      });
    } catch (err) {
      this.logger.error(`Login transaction failed email=${maskEmail(email)}`);
      throw err;
    }

    // (14) Save Redis Cache — SAU commit, best-effort (Redis chỉ là Cache; miss thì fallback DB)
    try {
      await this.refreshTokenService.cacheRefreshToken(issued);
    } catch {
      this.logger.warn(`Refresh token cache set failed email=${maskEmail(email)}`);
    }

    // Login thành công → xóa bộ đếm sai (email+ip)
    await this.rateLimit.reset(`login_fail:${email}:${ip}`).catch(() => undefined);

    this.logger.log(`Login success email=${maskEmail(email)}`);

    // (15) Response
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        organizationId: user.organizationId,
        status: user.status,
        role: user.role.code,
      },
      tokens: {
        accessToken: access.token,
        refreshToken: issued.token,
        tokenType: 'Bearer',
        expiresIn: access.expiresIn,
      },
    };
  }

  /** Ghi nhận đăng nhập sai: đếm theo (email+ip), khóa khi đạt ngưỡng (BR-L07). */
  private async registerFailure(
    userId: string | undefined,
    email: string,
    ip: string,
  ): Promise<void> {
    const { count } = await this.rateLimit.hit(
      `login_fail:${email}:${ip}`,
      this.MAX_FAILED,
      this.FAIL_WINDOW_SEC,
    );
    const shouldLock = count >= this.MAX_FAILED;
    if (userId) {
      await this.userService.increaseFailedLogin(userId, shouldLock);
      if (shouldLock) {
        this.logger.warn(`Account locked - too many attempts email=${maskEmail(email)}`);
      }
    }
  }

  /** Khóa tạm thời (locked_until > now) hoặc khóa bền vững (status = LOCKED) — BR-L05. */
  private isLocked(user: UserWithRole): boolean {
    if (user.status === UserStatus.LOCKED) return true;
    return user.lockedUntil != null && user.lockedUntil.getTime() > Date.now();
  }

  /** Chỉ ACTIVE được login; LOCKED → 423; INACTIVE/SUSPENDED → 403 (BR-L04/L05). */
  private assertStatusAllowsLogin(status: UserStatus): void {
    if (status === UserStatus.ACTIVE) return;
    if (status === UserStatus.LOCKED) throw new AccountLockedException();
    throw new AccountDisabledException(); // INACTIVE, SUSPENDED
  }

  private toSubject(user: UserWithRole): TokenSubject {
    return {
      userId: user.id,
      organizationId: user.organizationId,
      roleCode: user.role.code,
    };
  }
}
