import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrganizationStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AUTH_REFRESH_FAILURE } from '../constants/auth-events';
import { RefreshTokenInvalidException } from '../exceptions/refresh-token-invalid.exception';
import { AuthEventLogger } from './auth-event.logger';
import { RefreshService } from './refresh.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

/**
 * Unit test — RefreshService.
 *
 * 🔴 Bộ test này canh gác đúng một câu: **access token hết hạn KHÔNG được làm người dùng
 * đăng xuất**. Mọi nhánh dưới đây tồn tại vì nó từng là (hoặc dễ trở thành) một nguyên nhân
 * đăng xuất sai:
 *
 *   - refresh hợp lệ  → phải phát cặp token mới, không ném lỗi;
 *   - refresh song song → phải phát token mới, KHÔNG bị coi là token đánh cắp;
 *   - refresh dùng lại thật → phải cắt TOÀN BỘ phiên của user;
 *   - user/organization bị vô hiệu hoá → mới được cắt phiên.
 */

const GRACE_SECONDS = 30;

const PAYLOAD = {
  sub: 'user-1',
  organizationId: 'org-1',
  role: 'ADMIN',
  jti: 'jti-1',
};

const ACTIVE_USER = {
  id: 'user-1',
  organizationId: 'org-1',
  status: UserStatus.ACTIVE,
  role: { code: 'ADMIN' },
  organization: { status: OrganizationStatus.ACTIVE },
};

function buildSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    tokenHash: 'hash-1',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    revokedAt: null,
    replacedById: null,
    ...overrides,
  };
}

describe('RefreshService', () => {
  let service: RefreshService;

  const jwt = { verifyAsync: jest.fn(), decode: jest.fn() };
  const prisma = {
    user: { findFirst: jest.fn() },
    refreshToken: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  const tokenService = { createAccessToken: jest.fn() };
  const refreshTokens = {
    findByRawToken: jest.fn(),
    markRotated: jest.fn(),
    revokeSession: jest.fn(),
    revokeAllForUser: jest.fn(),
    createRefreshToken: jest.fn(),
    cacheRefreshToken: jest.fn(),
    dropCachedSession: jest.fn(),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue('secret'),
    get: jest.fn().mockReturnValue(GRACE_SECONDS),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    jwt.verifyAsync.mockResolvedValue(PAYLOAD);
    jwt.decode.mockReturnValue(PAYLOAD);
    prisma.user.findFirst.mockResolvedValue(ACTIVE_USER);
    prisma.refreshToken.update.mockResolvedValue({});
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({}));
    tokenService.createAccessToken.mockResolvedValue({ token: 'new-access', expiresIn: 900 });
    refreshTokens.markRotated.mockResolvedValue(true);
    refreshTokens.revokeSession.mockResolvedValue(true);
    refreshTokens.revokeAllForUser.mockResolvedValue(2);
    refreshTokens.createRefreshToken.mockResolvedValue({
      id: 'session-2',
      token: 'new-refresh',
      userId: 'user-1',
      jti: 'jti-2',
      tokenHash: 'hash-2',
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    refreshTokens.cacheRefreshToken.mockResolvedValue(undefined);
    refreshTokens.dropCachedSession.mockResolvedValue(undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshService,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokenService },
        { provide: RefreshTokenService, useValue: refreshTokens },
        AuthEventLogger,
      ],
    }).compile();

    service = moduleRef.get(RefreshService);
  });

  // -------------------------------------------------------------------------
  // Đường thành công
  // -------------------------------------------------------------------------

  it('refresh hợp lệ ⇒ trả cặp token MỚI và xoay vòng token cũ', async () => {
    refreshTokens.findByRawToken.mockResolvedValue(buildSession());

    const result = await service.refresh('raw-token', { ipAddress: '1.2.3.4' });

    expect(result).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    // Token cũ bị thu hồi (rotation) và nối vào chuỗi để phát hiện dùng lại về sau.
    expect(refreshTokens.markRotated).toHaveBeenCalledWith('session-1', null);
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { replacedById: 'session-2' },
    });
    // Cache của phiên cũ bị dọn để không còn ai tra ra nó.
    expect(refreshTokens.dropCachedSession).toHaveBeenCalledWith('user-1', 'jti-1');
  });

  // -------------------------------------------------------------------------
  // Race lành tính — nguồn gốc của bug đăng xuất nếu xử lý sai
  // -------------------------------------------------------------------------

  it('🔴 refresh SONG SONG (token vừa bị xoay vòng trong cửa sổ ân hạn) ⇒ VẪN phát token mới', async () => {
    // Tab thứ hai xuất trình token mà tab thứ nhất vừa xoay vòng 5 giây trước.
    refreshTokens.findByRawToken.mockResolvedValue(
      buildSession({ revokedAt: new Date(Date.now() - 5_000) }),
    );

    const result = await service.refresh('raw-token');

    expect(result.accessToken).toBe('new-access');
    // Và tuyệt đối KHÔNG được cắt phiên: đây là hai request của cùng một người.
    expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('🔴 markRotated trả false (một request khác vừa thắng) ⇒ vẫn phát token mới, không đăng xuất', async () => {
    refreshTokens.findByRawToken.mockResolvedValue(buildSession());
    refreshTokens.markRotated.mockResolvedValue(false);

    await expect(service.refresh('raw-token')).resolves.toMatchObject({
      accessToken: 'new-access',
    });
    expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Đường từ chối — chỉ những nhánh này mới được đăng xuất
  // -------------------------------------------------------------------------

  it('refresh token dùng lại NGOÀI cửa sổ ân hạn ⇒ thu hồi TOÀN BỘ phiên của user', async () => {
    refreshTokens.findByRawToken.mockResolvedValue(
      buildSession({ revokedAt: new Date(Date.now() - 10 * 60 * 1000) }),
    );

    await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(
      RefreshTokenInvalidException,
    );
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
  });

  it('refresh token hết hạn (JWT) ⇒ 401 với reason EXPIRED', async () => {
    jwt.verifyAsync.mockRejectedValue(Object.assign(new Error('jwt expired'), {
      name: 'TokenExpiredError',
    }));

    await expect(service.refresh('raw-token')).rejects.toMatchObject({
      reason: AUTH_REFRESH_FAILURE.EXPIRED,
    });
    // Không chạm tới database khi token còn chưa giải mã được.
    expect(refreshTokens.findByRawToken).not.toHaveBeenCalled();
  });

  it('refresh token không có trong database ⇒ 401 với reason NOT_FOUND', async () => {
    refreshTokens.findByRawToken.mockResolvedValue(null);

    await expect(service.refresh('raw-token')).rejects.toMatchObject({
      reason: AUTH_REFRESH_FAILURE.NOT_FOUND,
    });
  });

  it('bản ghi phiên đã hết hạn trong database ⇒ 401 với reason DB_EXPIRED', async () => {
    refreshTokens.findByRawToken.mockResolvedValue(
      buildSession({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.refresh('raw-token')).rejects.toMatchObject({
      reason: AUTH_REFRESH_FAILURE.DB_EXPIRED,
    });
  });

  it('user bị vô hiệu hoá ⇒ 401 và thu hồi MỌI phiên (không chỉ phiên hiện tại)', async () => {
    refreshTokens.findByRawToken.mockResolvedValue(buildSession());
    prisma.user.findFirst.mockResolvedValue({
      ...ACTIVE_USER,
      status: UserStatus.SUSPENDED,
    });

    await expect(service.refresh('raw-token')).rejects.toMatchObject({
      reason: AUTH_REFRESH_FAILURE.USER_DISABLED,
    });
    // Thiết bị khác của cùng tài khoản không được phép refresh tiếp 7 ngày nữa.
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
  });

  it('Organization rời khỏi trạng thái cho phép ⇒ 401 với reason ORGANIZATION_BLOCKED', async () => {
    refreshTokens.findByRawToken.mockResolvedValue(buildSession());
    prisma.user.findFirst.mockResolvedValue({
      ...ACTIVE_USER,
      organization: { status: OrganizationStatus.SUSPENDED },
    });

    await expect(service.refresh('raw-token')).rejects.toMatchObject({
      reason: AUTH_REFRESH_FAILURE.ORGANIZATION_BLOCKED,
    });
  });

  it('user không còn / khác tenant ⇒ 401 với reason SUBJECT_GONE', async () => {
    refreshTokens.findByRawToken.mockResolvedValue(buildSession());
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.refresh('raw-token')).rejects.toMatchObject({
      reason: AUTH_REFRESH_FAILURE.SUBJECT_GONE,
    });
  });

  it('lỗi ghi database KHÔNG bị biến thành 401 (401 sẽ khiến frontend đăng xuất oan)', async () => {
    refreshTokens.findByRawToken.mockResolvedValue(buildSession());
    prisma.$transaction.mockRejectedValue(new Error('deadlock detected'));

    await expect(service.refresh('raw-token')).rejects.not.toBeInstanceOf(
      RefreshTokenInvalidException,
    );
  });

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  describe('logout', () => {
    it('thu hồi đúng phiên đang dùng và dọn cache', async () => {
      refreshTokens.findByRawToken.mockResolvedValue(buildSession());

      await service.logout('raw-token');

      expect(refreshTokens.revokeSession).toHaveBeenCalledWith('session-1');
      expect(refreshTokens.dropCachedSession).toHaveBeenCalledWith('user-1', 'jti-1');
    });

    it('idempotent: không có token ⇒ không lỗi, không chạm database', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(refreshTokens.findByRawToken).not.toHaveBeenCalled();
    });

    it('idempotent: token lạ ⇒ không lỗi (đăng xuất không được phép thất bại)', async () => {
      refreshTokens.findByRawToken.mockResolvedValue(null);

      await expect(service.logout('raw-token')).resolves.toBeUndefined();
      expect(refreshTokens.revokeSession).not.toHaveBeenCalled();
    });
  });
});
