/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service';
import { TokenInvalidException } from '../exceptions/token-invalid.exception';
import { AuthenticatedUser } from '../types/authenticated-user.interface';
import { MeService } from './me.service';

/** Unit test — MeService (GET /auth/me). */
describe('MeService', () => {
  let service: MeService;
  const prisma = { user: { findFirst: jest.fn() } };

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
    organization: { id: 'org-1', name: 'NCMedia Co.', slug: 'ncmedia-co', status: 'ACTIVE' },
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
      organization: { id: 'org-1', name: 'NCMedia Co.', slug: 'ncmedia-co' },
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

  it('không tìm thấy user (đã xóa / khác tenant) → ném AUTH_TOKEN_INVALID', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.getMe(current)).rejects.toBeInstanceOf(TokenInvalidException);
  });
});
