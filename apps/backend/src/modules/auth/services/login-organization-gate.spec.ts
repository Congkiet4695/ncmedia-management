import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationStatus, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';
import { LoginRequestDto } from '../dto/login-request.dto';
import { InvalidCredentialsException } from '../exceptions/invalid-credentials.exception';
import { OrganizationInactiveException } from '../exceptions/organization-inactive.exception';
import { OrganizationPendingApprovalException } from '../exceptions/organization-pending-approval.exception';
import { OrganizationRejectedException } from '../exceptions/organization-rejected.exception';
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
    refreshTokenService.createRefreshToken.mockResolvedValue({ token: 'refresh' });

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

  it('Organization SUSPENDED / DELETED ⇒ thông điệp riêng, không nhầm với chờ duyệt', async () => {
    userService.findByEmail.mockResolvedValue(userWithOrgStatus(OrganizationStatus.SUSPENDED));
    await expect(service.login(dto)).rejects.toBeInstanceOf(OrganizationInactiveException);

    userService.findByEmail.mockResolvedValue(userWithOrgStatus(OrganizationStatus.DELETED));
    await expect(service.login(dto)).rejects.toBeInstanceOf(OrganizationInactiveException);
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
