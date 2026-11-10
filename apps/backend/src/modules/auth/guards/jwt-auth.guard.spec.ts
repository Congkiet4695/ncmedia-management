import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { OrganizationStatus } from '@prisma/client';
import type { PrismaService } from '../../../database/prisma.service';
import { TokenInvalidException } from '../exceptions/token-invalid.exception';
import {
  clearOrganizationAccessCache,
  invalidateOrganizationAccess,
} from '../shared/organization-access-cache';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * 🔴 Token còn hạn KHÔNG có nghĩa tổ chức còn được dùng: tổ chức có thể hết hạn / bị vô hiệu hoá SAU khi token được
 * phát. JwtAuthGuard phải chặn ở MỌI request — không chỉ ở login / `/me`.
 */
describe('JwtAuthGuard — trạng thái tổ chức ở mỗi request', () => {
  const payload = { sub: 'user-1', organizationId: 'org-1', role: 'ADMIN', jti: 'jti-1' };
  const jwt = { verifyAsync: jest.fn() };
  const config = { getOrThrow: jest.fn().mockReturnValue('secret') };
  const findUnique = jest.fn();
  const prisma = { organization: { findUnique } };

  const context = (): ExecutionContext => {
    const request = { headers: { authorization: 'Bearer token' } } as Record<string, unknown>;
    return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  };
  const guard = (withPrisma = true) =>
    new JwtAuthGuard(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      withPrisma ? (prisma as unknown as PrismaService) : undefined,
    );
  const state = (status: OrganizationStatus, expiresAt: Date | null, isPlatform = false) => ({
    status,
    expiresAt,
    isPlatform,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearOrganizationAccessCache();
    jwt.verifyAsync.mockResolvedValue(payload);
  });

  it('tổ chức ACTIVE còn hạn ⇒ cho qua', async () => {
    findUnique.mockResolvedValue(
      state(OrganizationStatus.ACTIVE, new Date(Date.now() + 86_400_000)),
    );
    await expect(guard().canActivate(context())).resolves.toBe(true);
  });

  it('🔴 token còn hạn nhưng tổ chức đã HẾT HẠN ⇒ 403 AUTH_ORGANIZATION_EXPIRED', async () => {
    findUnique.mockResolvedValue(state(OrganizationStatus.ACTIVE, new Date(Date.now() - 1000)));
    await expect(guard().canActivate(context())).rejects.toMatchObject({
      status: 403,
      response: { code: 'AUTH_ORGANIZATION_EXPIRED' },
    });
  });

  it('🔴 token còn hạn nhưng tổ chức bị VÔ HIỆU HOÁ ⇒ 403 AUTH_ORGANIZATION_DEACTIVATED', async () => {
    findUnique.mockResolvedValue(state(OrganizationStatus.SUSPENDED, null));
    await expect(guard().canActivate(context())).rejects.toMatchObject({
      response: { code: 'AUTH_ORGANIZATION_DEACTIVATED' },
    });
  });

  it('tổ chức hệ thống (Super Admin) luôn qua', async () => {
    findUnique.mockResolvedValue(state(OrganizationStatus.ACTIVE, new Date(0), true));
    await expect(guard().canActivate(context())).resolves.toBe(true);
  });

  it('tổ chức không còn tồn tại (đã xoá cứng) ⇒ 401 như token không hợp lệ', async () => {
    findUnique.mockResolvedValue(null);
    await expect(guard().canActivate(context())).rejects.toBeInstanceOf(TokenInvalidException);
  });

  it('chữ ký sai ⇒ 401, không đọc DB', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('bad signature'));
    await expect(guard().canActivate(context())).rejects.toBeInstanceOf(TokenInvalidException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('đọc qua bộ đệm: nhiều request liên tiếp ⇒ MỘT truy vấn; Super Admin đổi trạng thái ⇒ bỏ đệm, chặn ngay', async () => {
    findUnique.mockResolvedValue(state(OrganizationStatus.ACTIVE, null));
    const g = guard();
    await g.canActivate(context());
    await g.canActivate(context());
    await g.canActivate(context());
    expect(findUnique).toHaveBeenCalledTimes(1);

    findUnique.mockResolvedValue(state(OrganizationStatus.SUSPENDED, null));
    invalidateOrganizationAccess('org-1');
    await expect(g.canActivate(context())).rejects.toMatchObject({
      response: { code: 'AUTH_ORGANIZATION_DEACTIVATED' },
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('🔴 hết hạn theo THỜI GIAN không cần bỏ đệm: hạn được so với now ở mỗi request', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-30T23:59:59.000Z') });
    try {
      findUnique.mockResolvedValue(
        state(OrganizationStatus.ACTIVE, new Date('2026-12-01T00:00:00.000Z')),
      );
      const g = guard();
      await expect(g.canActivate(context())).resolves.toBe(true);
      jest.setSystemTime(new Date('2026-12-01T00:00:00.500Z'));
      await expect(g.canActivate(context())).rejects.toMatchObject({
        response: { code: 'AUTH_ORGANIZATION_EXPIRED' },
      });
      expect(findUnique).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('không có PrismaService (dựng tay ở test cũ) ⇒ chỉ xác thực chữ ký như trước', async () => {
    await expect(guard(false).canActivate(context())).resolves.toBe(true);
  });
});
