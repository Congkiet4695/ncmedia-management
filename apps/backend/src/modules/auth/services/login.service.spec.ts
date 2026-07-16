/* eslint-disable @typescript-eslint/no-require-imports */
import { Test, TestingModule } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { LoginRequestDto } from '../dto/login-request.dto';
import { AccountDisabledException } from '../exceptions/account-disabled.exception';
import { AccountLockedException } from '../exceptions/account-locked.exception';
import { InvalidCredentialsException } from '../exceptions/invalid-credentials.exception';
import { RateLimitedException } from '../exceptions/rate-limited.exception';
import { LoginService } from './login.service';
import { RateLimitService } from './rate-limit.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';
import { UserService } from './user.service';

// bcrypt bị mock: hashSync (dummy hash lúc khởi tạo) + compare (điều khiển kết quả).
jest.mock('bcrypt', () => ({
  hashSync: jest.fn(() => '$2b$12$dummydummydummydummydummydummydummydummydummy'),
  compare: jest.fn(),
}));
 
const bcrypt = require('bcrypt') as { compare: jest.Mock };

/**
 * Unit test — LoginService (login.md Mục 5/17).
 * Bao phủ: success, wrong password, email not found, locked, disabled, rate limit.
 */
describe('LoginService', () => {
  let service: LoginService;

  const rateLimit = { hit: jest.fn(), reset: jest.fn() };
  const userService = {
    findByEmail: jest.fn(),
    increaseFailedLogin: jest.fn(),
    resetFailedLogin: jest.fn(),
    updateLastLogin: jest.fn(),
  };
  const tokenService = { createAccessToken: jest.fn() };
  const refreshTokenService = { createRefreshToken: jest.fn(), cacheRefreshToken: jest.fn() };
  // $transaction chạy callback với tx client giả.
  const prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) };

  const dto: LoginRequestDto = { email: 'admin@ncmedia.com', password: 'P@ssw0rd123' };
  const meta = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    organizationId: 'org-1',
    email: 'admin@ncmedia.com',
    passwordHash: '$2b$12$realhash',
    fullName: 'Nguyen Van A',
    status: UserStatus.ACTIVE,
    deletedAt: null,
    lockedUntil: null,
    role: { code: 'ADMIN' },
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Mặc định: không bị rate limit, không bị khóa.
    rateLimit.hit.mockResolvedValue({ count: 1, limited: false });
    rateLimit.reset.mockResolvedValue(undefined);
    tokenService.createAccessToken.mockResolvedValue({ token: 'access-jwt', expiresIn: 900 });
    refreshTokenService.createRefreshToken.mockResolvedValue({
      token: 'refresh-jwt',
      userId: 'user-1',
      jti: 'jti-1',
      tokenHash: 'hash-1',
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    refreshTokenService.cacheRefreshToken.mockResolvedValue(undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: userService },
        { provide: TokenService, useValue: tokenService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: RateLimitService, useValue: rateLimit },
      ],
    }).compile();
    service = moduleRef.get(LoginService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ✓ Login success
  it('login success: trả user + tokens, reset counter + cập nhật last_login', async () => {
    userService.findByEmail.mockResolvedValue(buildUser());
    bcrypt.compare.mockResolvedValue(true);

    const res = await service.login(dto, meta);

    expect(res.user).toMatchObject({ id: 'user-1', organizationId: 'org-1', role: 'ADMIN' });
    expect(res.tokens).toMatchObject({
      accessToken: 'access-jwt',
      refreshToken: 'refresh-jwt',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(userService.resetFailedLogin).toHaveBeenCalled();
    expect(userService.updateLastLogin).toHaveBeenCalled();
    expect(refreshTokenService.createRefreshToken).toHaveBeenCalled();
    expect(refreshTokenService.cacheRefreshToken).toHaveBeenCalled(); // cache Redis SAU commit
    expect(rateLimit.reset).toHaveBeenCalledWith('login_fail:admin@ncmedia.com:127.0.0.1');
  });

  // ✓ Wrong password
  it('wrong password: ném AUTH_INVALID_CREDENTIALS + tăng failed_login_count', async () => {
    userService.findByEmail.mockResolvedValue(buildUser());
    bcrypt.compare.mockResolvedValue(false);

    await expect(service.login(dto, meta)).rejects.toBeInstanceOf(InvalidCredentialsException);
    expect(userService.increaseFailedLogin).toHaveBeenCalledWith('user-1', false);
  });

  // ✓ Email not found
  it('email not found: ném AUTH_INVALID_CREDENTIALS (trung tính), không tăng counter theo user', async () => {
    userService.findByEmail.mockResolvedValue(null);
    bcrypt.compare.mockResolvedValue(false); // vẫn compare với dummy hash (chống timing)

    await expect(service.login(dto, meta)).rejects.toBeInstanceOf(InvalidCredentialsException);
    expect(bcrypt.compare).toHaveBeenCalled(); // đã chạy compare kể cả khi không có user
    expect(userService.increaseFailedLogin).not.toHaveBeenCalled();
  });

  // ✓ Locked account
  it('locked account: locked_until tương lai → ném AUTH_ACCOUNT_LOCKED', async () => {
    userService.findByEmail.mockResolvedValue(
      buildUser({ lockedUntil: new Date(Date.now() + 10 * 60 * 1000) }),
    );

    await expect(service.login(dto, meta)).rejects.toBeInstanceOf(AccountLockedException);
    expect(bcrypt.compare).not.toHaveBeenCalled(); // chặn trước khi so mật khẩu
  });

  // ✓ Disabled account
  it('disabled account: status INACTIVE → ném AUTH_ACCOUNT_DISABLED', async () => {
    userService.findByEmail.mockResolvedValue(buildUser({ status: UserStatus.INACTIVE }));
    bcrypt.compare.mockResolvedValue(true);

    await expect(service.login(dto, meta)).rejects.toBeInstanceOf(AccountDisabledException);
  });

  // ✓ Rate limit
  it('rate limit: vượt 5/phút/IP → ném RATE_LIMITED, không tra user', async () => {
    rateLimit.hit.mockResolvedValueOnce({ count: 6, limited: true });

    await expect(service.login(dto, meta)).rejects.toBeInstanceOf(RateLimitedException);
    expect(userService.findByEmail).not.toHaveBeenCalled();
  });
});
