import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationStatus, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';
import { LoginRequestDto } from '../dto/login-request.dto';
import { InvalidCredentialsException } from '../exceptions/invalid-credentials.exception';
import { OrganizationInactiveException } from '../exceptions/organization-inactive.exception';
import { OrganizationDeactivatedException } from '../exceptions/organization-deactivated.exception';
import { OrganizationExpiredException } from '../exceptions/organization-expired.exception';
import { OrganizationPendingApprovalException } from '../exceptions/organization-pending-approval.exception';
import { OrganizationRejectedException } from '../exceptions/organization-rejected.exception';
import { AuthEventLogger } from './auth-event.logger';
import { LoginService } from './login.service';
import { RateLimitService } from './rate-limit.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';
import { UserService } from './user.service';

/**
 * **Cổng duyệt đăng ký ở Login** (§4, §14) — chốt chặn DUY NHẤT của cả tính năng.
 *
 * 🔴 Không có token nào được phát ra trước cửa này. Vì thế Organization PENDING/REJECTED
 * không lấy được JWT, và do đó không gọi được bất kỳ API nào. Một hồi quy ở đây làm toàn bộ
 * luồng duyệt trở thành trang trí.
 */
describe('LoginService — cổng trạng thái Organization', () => {
  let service: LoginService;

  const userService = {
    findByEmail: jest.fn(),
    resetFailedLogin: jest.fn(),
    updateLastLogin: jest.fn(),
    increaseFailedLogin: jest.fn(),
  };
  const tokenService = { createAccessToken: jest.fn() };
  const refreshTokenService = { createRefreshToken: jest.fn(), cacheRefreshToken: jest.fn() };
  const rateLimit = {
    hit: jest.fn().mockResolvedValue({ limited: false, count: 1 }),
    reset: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) };

  const dto: LoginRequestDto = { email: 'owner@acme.com', password: 'P@ssw0rd123' };
  const passwordHash = bcrypt.hashSync('P@ssw0rd123', 4);

  const userWithOrgStatus = (
    status: OrganizationStatus,
    userStatus: UserStatus = UserStatus.PENDING,
  ) => ({
    id: 'user-1',
    organizationId: 'org-1',
    email: 'owner@acme.com',
    passwordHash,
    fullName: 'Owner',
    status: userStatus,
    deletedAt: null,
    lockedUntil: null,
    role: { code: 'ADMIN' },
    organization: { id: 'org-1', status },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    rateLimit.hit.mockResolvedValue({ limited: false, count: 1 });
    tokenService.createAccessToken.mockResolvedValue({ token: 'access', expiresIn: 900 });
    refreshTokenService.createRefreshToken.mockResolvedValue({ id: 'session-1', token: 'refresh' });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: userService },
        { provide: TokenService, useValue: tokenService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: RateLimitService, useValue: rateLimit },
        AuthEventLogger,
      ],
    }).compile();
    service = moduleRef.get(LoginService);
  });

  it('🔴 Organization PENDING ⇒ chặn login, KHÔNG phát token', async () => {
    userService.findByEmail.mockResolvedValue(userWithOrgStatus(OrganizationStatus.PENDING));

    await expect(service.login(dto)).rejects.toBeInstanceOf(OrganizationPendingApprovalException);
    expect(tokenService.createAccessToken).not.toHaveBeenCalled();
    expect(refreshTokenService.createRefreshToken).not.toHaveBeenCalled();
  });

  it('thông điệp PENDING đúng theo yêu cầu §4', async () => {
    userService.findByEmail.mockResolvedValue(userWithOrgStatus(OrganizationStatus.PENDING));

    await expect(service.login(dto)).rejects.toMatchObject({
      response: {
        code: 'AUTH_ORGANIZATION_PENDING',
        message:
          'Your organization is waiting for approval. ' +
          'Please wait until the administrator reviews your registration.',
      },
    });
  });

  it('🔴 Organization REJECTED ⇒ chặn login, KHÔNG phát token', async () => {
    userService.findByEmail.mockResolvedValue(userWithOrgStatus(OrganizationStatus.REJECTED));

    await expect(service.login(dto)).rejects.toBeInstanceOf(OrganizationRejectedException);
    expect(tokenService.createAccessToken).not.toHaveBeenCalled();
  });

  it('Organization SUSPENDED ⇒ thông điệp VÔ HIỆU HOÁ riêng; DELETED ⇒ không hoạt động', async () => {
    userService.findByEmail.mockResolvedValue(userWithOrgStatus(OrganizationStatus.SUSPENDED));
    await expect(service.login(dto)).rejects.toBeInstanceOf(OrganizationDeactivatedException);

    userService.findByEmail.mockResolvedValue(userWithOrgStatus(OrganizationStatus.DELETED));
    await expect(service.login(dto)).rejects.toBeInstanceOf(OrganizationInactiveException);
  });

  describe('gói hết hạn / vô hiệu hoá (Admin lẫn Employee)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const userIn = (
      roleCode: string,
      organization: { status: OrganizationStatus; expiresAt: Date | null; isPlatform?: boolean },
    ) => ({
      ...userWithOrgStatus(organization.status, UserStatus.ACTIVE),
      role: { code: roleCode },
      organization: { id: 'org-1', isPlatform: false, ...organization },
    });

    it.each(['ADMIN', 'SELLER'])('%s: expires_at đã qua ⇒ AUTH_ORGANIZATION_EXPIRED, KHÔNG phát token', async (role) => {
      userService.findByEmail.mockResolvedValue(
        userIn(role, { status: OrganizationStatus.ACTIVE, expiresAt: new Date(Date.now() - DAY) }),
      );
      await expect(service.login(dto)).rejects.toMatchObject({
        response: { code: 'AUTH_ORGANIZATION_EXPIRED', message: 'Gói của tổ chức đã hết hạn, vui lòng liên hệ admin.' },
      });
      expect(tokenService.createAccessToken).not.toHaveBeenCalled();
    });

    it('expires_at ĐÚNG bằng bây giờ ⇒ đã hết hạn (now >= expires_at)', async () => {
      userService.findByEmail.mockResolvedValue(
        userIn('ADMIN', { status: OrganizationStatus.ACTIVE, expiresAt: new Date(Date.now() - 1) }),
      );
      await expect(service.login(dto)).rejects.toBeInstanceOf(OrganizationExpiredException);
    });

    it.each(['ADMIN', 'SELLER'])('%s: SUSPENDED ⇒ AUTH_ORGANIZATION_DEACTIVATED', async (role) => {
      userService.findByEmail.mockResolvedValue(
        userIn(role, { status: OrganizationStatus.SUSPENDED, expiresAt: new Date(Date.now() + DAY) }),
      );
      await expect(service.login(dto)).rejects.toMatchObject({ response: { code: 'AUTH_ORGANIZATION_DEACTIVATED' } });
    });

    it('🔴 SUSPENDED + đã gia hạn (expires_at tương lai) ⇒ VẪN bị chặn — gia hạn không tự kích hoạt', async () => {
      userService.findByEmail.mockResolvedValue(
        userIn('ADMIN', { status: OrganizationStatus.SUSPENDED, expiresAt: new Date(Date.now() + 30 * DAY) }),
      );
      await expect(service.login(dto)).rejects.toBeInstanceOf(OrganizationDeactivatedException);
    });

    it.each(['ADMIN', 'SELLER'])('%s: ACTIVE + còn hạn ⇒ login thành công', async (role) => {
      userService.findByEmail.mockResolvedValue(
        userIn(role, { status: OrganizationStatus.ACTIVE, expiresAt: new Date(Date.now() + DAY) }),
      );
      await expect(service.login(dto)).resolves.toBeDefined();
      expect(tokenService.createAccessToken).toHaveBeenCalled();
    });

    it('Super Admin (tổ chức hệ thống) không bị giới hạn bởi hạn', async () => {
      userService.findByEmail.mockResolvedValue(
        userIn('SUPER_ADMIN', {
          status: OrganizationStatus.ACTIVE,
          expiresAt: new Date(Date.now() - DAY),
          isPlatform: true,
        }),
      );
      await expect(service.login(dto)).resolves.toBeDefined();
    });
  });

  it('🔴 Organization ACTIVE ⇒ login bình thường (không ảnh hưởng tổ chức đang hoạt động)', async () => {
    userService.findByEmail.mockResolvedValue(
      userWithOrgStatus(OrganizationStatus.ACTIVE, UserStatus.ACTIVE),
    );

    const result = await service.login(dto);

    expect(result.tokens.accessToken).toBe('access');
    expect(tokenService.createAccessToken).toHaveBeenCalledTimes(1);
  });

  it('TRIAL vẫn được login — luồng duyệt không đụng tới gói dùng thử', async () => {
    userService.findByEmail.mockResolvedValue(
      userWithOrgStatus(OrganizationStatus.TRIAL, UserStatus.ACTIVE),
    );

    await expect(service.login(dto)).resolves.toBeDefined();
  });

  it('🔴 Sai mật khẩu ⇒ "sai thông tin đăng nhập", KHÔNG tiết lộ tổ chức đang chờ duyệt', async () => {
    // Trả lời "tổ chức đang chờ duyệt" cho một người nhập sai mật khẩu là xác nhận rằng email
    // đó có tồn tại trong hệ thống — cổng trạng thái phải nằm SAU bcrypt.compare.
    userService.findByEmail.mockResolvedValue(userWithOrgStatus(OrganizationStatus.PENDING));

    await expect(
      service.login({ email: dto.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });
});
