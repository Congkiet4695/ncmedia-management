import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  OrganizationApprovalAction,
  OrganizationStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MailService } from '../../mail/services/mail.service';
import { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import {
  OrganizationNotFoundException,
  OrganizationReviewService,
} from './organization-review.service';

/**
 * OrganizationReviewService — Approve / Reject của Super Admin.
 *
 * 🔴 Bốn luật được khoá:
 *   1. Approve mở khoá CẢ Organization LẪN tài khoản chủ Organization.
 *   2. Chỉ hồ sơ PENDING mới duyệt/từ chối được.
 *   3. Mọi quyết định đều sinh một dòng nhật ký (§13).
 *   4. Organization hệ thống KHÔNG BAO GIỜ lọt vào danh sách.
 */
describe('OrganizationReviewService', () => {
  let service: OrganizationReviewService;

  const tx = {
    organization: { update: jest.fn() },
    user: { updateMany: jest.fn(), findUnique: jest.fn() },
    organizationApprovalLog: { create: jest.fn() },
  };

  const prisma = {
    organization: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mail = {
    sendOrganizationApproved: jest.fn().mockResolvedValue({ sent: true }),
    sendOrganizationRejected: jest.fn().mockResolvedValue({ sent: true }),
  };

  const operator: AuthenticatedUser = {
    userId: 'super-1',
    organizationId: 'platform-org',
    role: 'SUPER_ADMIN',
    jti: 'jti-1',
  };

  const owner = {
    id: 'user-1',
    email: 'owner@acme.com',
    fullName: 'Owner Acme',
    phone: '0912345678',
    status: UserStatus.PENDING,
    createdAt: new Date('2026-08-01'),
    lastLoginAt: null,
  };

  const pendingOrg = {
    id: 'org-1',
    name: 'Acme Co.',
    slug: 'acme-co',
    status: OrganizationStatus.PENDING,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectedReason: null,
    users: [owner],
    approvalLogs: [],
    _count: { users: 1 },
  };

  /** Đối số của lời gọi mock — `jest.fn()` trả `any`, ép kiểu một chỗ thay vì rải khắp test. */
  const dataOf = (mock: { mock: { calls: unknown[][] } }): Record<string, unknown> =>
    (mock.mock.calls[0]?.[0] as { data?: Record<string, unknown> })?.data ?? {};

  const whereOf = (mock: { mock: { calls: unknown[][] } }): Record<string, unknown> =>
    (mock.mock.calls[0]?.[0] as { where?: Record<string, unknown> })?.where ?? {};

  beforeEach(async () => {
    jest.clearAllMocks();
    mail.sendOrganizationApproved.mockResolvedValue({ sent: true });
    mail.sendOrganizationRejected.mockResolvedValue({ sent: true });
    tx.user.findUnique.mockResolvedValue({ email: 'super@ncmedia.local', fullName: 'Super' });
    tx.organization.update.mockResolvedValue({ ...pendingOrg, status: OrganizationStatus.ACTIVE });
    prisma.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      typeof cb === 'function' ? cb(tx) : Promise.resolve([]),
    );
    prisma.organization.findFirst.mockResolvedValue(pendingOrg);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationReviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    service = moduleRef.get(OrganizationReviewService);
  });

  // ------------------------------------------------------------------ Approve

  it('🔴 Approve mở khoá CẢ Organization LẪN tài khoản chủ Organization', async () => {
    await service.approve(operator, 'org-1');

    expect(dataOf(tx.organization.update)).toMatchObject({
      status: OrganizationStatus.ACTIVE,
      approvedBy: 'super-1',
    });
    // Quên bước này thì chủ Organization vẫn PENDING và vẫn không đăng nhập được — lỗi rất
    // khó lần ra vì thông điệp trả về nói về tài khoản chứ không nói về tổ chức.
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', status: UserStatus.PENDING, deletedAt: null },
      data: { status: UserStatus.ACTIVE },
    });
  });

  it('Approve ghi nhật ký kèm trạng thái CŨ và người thao tác (§13)', async () => {
    await service.approve(operator, 'org-1');

    expect(dataOf(tx.organizationApprovalLog.create)).toMatchObject({
      organizationId: 'org-1',
      operatorId: 'super-1',
      operatorEmail: 'super@ncmedia.local',
      action: OrganizationApprovalAction.APPROVE,
      oldStatus: OrganizationStatus.PENDING,
      newStatus: OrganizationStatus.ACTIVE,
      reason: null,
    });
  });

  it('Approve gửi email "Organization Approved" tới chủ Organization', async () => {
    await service.approve(operator, 'org-1');

    expect(mail.sendOrganizationApproved).toHaveBeenCalledWith({
      to: 'owner@acme.com',
      fullName: 'Owner Acme',
      organizationName: 'Acme Co.',
    });
  });

  // ------------------------------------------------------------------ Reject

  it('Reject lưu lý do và gửi email kèm lý do', async () => {
    await service.reject(operator, 'org-1', { reason: 'Thiếu giấy phép kinh doanh' });

    expect(dataOf(tx.organization.update)).toMatchObject({
      status: OrganizationStatus.REJECTED,
      rejectedBy: 'super-1',
      rejectedReason: 'Thiếu giấy phép kinh doanh',
    });
    expect(mail.sendOrganizationRejected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Thiếu giấy phép kinh doanh' }),
    );
  });

  it('🔴 Reject KHÔNG đụng tới users.status — cổng chặn nằm ở trạng thái TỔ CHỨC', async () => {
    await service.reject(operator, 'org-1', { reason: 'Thông tin chưa xác minh được' });

    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ Ràng buộc trạng thái

  it.each([
    OrganizationStatus.ACTIVE,
    OrganizationStatus.REJECTED,
    OrganizationStatus.SUSPENDED,
  ])('🔴 Không duyệt được hồ sơ đang %s — chỉ PENDING', async (status) => {
    prisma.organization.findFirst.mockResolvedValue({ ...pendingOrg, status });

    await expect(service.approve(operator, 'org-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.organization.update).not.toHaveBeenCalled();
  });

  it('Organization không tồn tại (hoặc là Organization hệ thống) ⇒ 404', async () => {
    prisma.organization.findFirst.mockResolvedValue(null);

    await expect(service.approve(operator, 'org-x')).rejects.toBeInstanceOf(
      OrganizationNotFoundException,
    );
  });

  // ------------------------------------------------------------------ Đọc

  it('🔴 Danh sách LOẠI Organization hệ thống — Super Admin không tự từ chối được chính mình', async () => {
    prisma.$transaction.mockResolvedValue([[], 0]);

    await service.list({});

    expect(whereOf(prisma.organization.findMany)).toMatchObject({
      isPlatform: false,
      deletedAt: null,
    });
  });

  it('Dashboard đếm theo trạng thái, KHÔNG tính Organization hệ thống (§10)', async () => {
    prisma.organization.groupBy.mockResolvedValue([
      { status: OrganizationStatus.PENDING, _count: { _all: 3 } },
      { status: OrganizationStatus.ACTIVE, _count: { _all: 7 } },
      { status: OrganizationStatus.REJECTED, _count: { _all: 2 } },
      { status: OrganizationStatus.TRIAL, _count: { _all: 1 } },
    ]);

    const result = await service.dashboard();

    expect(whereOf(prisma.organization.groupBy)).toEqual({
      isPlatform: false,
      deletedAt: null,
    });
    expect(result).toEqual({ pending: 3, approved: 7, rejected: 2, total: 13 });
  });
});
