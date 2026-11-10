/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service';
import { TokenInvalidException } from '../exceptions/token-invalid.exception';
import { AuthenticatedUser } from '../types/authenticated-user.interface';
import { MeService } from './me.service';

/** Unit test — MeService (GET /auth/me). */
describe('MeService', () => {
  let service: MeService;
  // `$queryRaw`: đếm Shop đang kết nối cho phần gói (`plan`) của header.
  const prisma = { user: { findFirst: jest.fn() }, $queryRaw: jest.fn().mockResolvedValue([{ n: 3n }]) };
  const EXPIRES = new Date('2027-01-01T00:00:00.000Z');

  const current: AuthenticatedUser = {
    userId: 'user-1',
    organizationId: 'org-1',
    role: 'ADMIN',
    jti: 'jti-1',
  };

  const dbUser = {
    id: 'user-1',
    email: 'admin@ncmedia.com',
    fullName: 'Nguyen Van A',
    passwordHash: '$2b$12$secret',
    failedLoginCount: 3,
    lockedUntil: new Date(),
    deletedAt: null,
    // `status` cần cho cổng duyệt đăng ký (§14) — /me chặn Organization rời khỏi ACTIVE.
    organization: {
      id: 'org-1',
      name: 'NCMedia Co.',
      slug: 'ncmedia-co',
      status: 'ACTIVE',
      isPlatform: false,
      shopLimit: 10,
      expiresAt: EXPIRES,
    },
    role: {
      id: 'role-1',
      code: 'ADMIN',
      displayName: 'Administrator',
      rolePermissions: [
        { permission: { code: 'employee.read' } },
        { permission: { code: 'account.read' } },
      ],
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [MeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(MeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('trả hồ sơ đã map (organization + role), KHÔNG lộ trường nhạy cảm', async () => {
    prisma.user.findFirst.mockResolvedValue(dbUser);

    const res = await service.getMe(current);

    expect(res).toEqual({
      id: 'user-1',
      email: 'admin@ncmedia.com',
      fullName: 'Nguyen Van A',
      avatar: null,
      dateOfBirth: null,
      organization: {
        id: 'org-1',
        name: 'NCMedia Co.',
        slug: 'ncmedia-co',
        plan: {
          status: 'ACTIVE',
          connectedShopCount: 3,
          shopLimit: 10,
          expiresAt: EXPIRES.toISOString(),
          expired: false,
        },
      },
      role: { id: 'role-1', code: 'ADMIN', name: 'Administrator' },
      permissions: ['account.read', 'employee.read'],
    });
    // Không rò rỉ dữ liệu nhạy cảm
    const raw = res as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty('passwordHash');
    expect(raw).not.toHaveProperty('failedLoginCount');
    expect(raw).not.toHaveProperty('lockedUntil');
    expect(raw).not.toHaveProperty('deletedAt');
  });

  it('tenant isolation: query theo userId + organizationId + deletedAt=null (không theo email)', async () => {
    prisma.user.findFirst.mockResolvedValue(dbUser);

    await service.getMe(current);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1', organizationId: 'org-1', deletedAt: null },
        include: expect.objectContaining({ organization: true }),
      }),
    );
  });

  it('tổ chức hệ thống (Super Admin) ⇒ plan = null, không đếm Shop', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...dbUser,
      organization: { ...dbUser.organization, isPlatform: true, shopLimit: null, expiresAt: null },
    });
    const res = await service.getMe(current);
    expect(res.organization.plan).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('gói HẾT HẠN sau khi token đã phát ⇒ /me chặn (AUTH_ORGANIZATION_EXPIRED)', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...dbUser,
      organization: { ...dbUser.organization, expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(service.getMe(current)).rejects.toMatchObject({ response: { code: 'AUTH_ORGANIZATION_EXPIRED' } });
  });

  it('không tìm thấy user (đã xóa / khác tenant) → ném AUTH_TOKEN_INVALID', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.getMe(current)).rejects.toBeInstanceOf(TokenInvalidException);
  });
});
