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
    organization: { update: jest.fn(), updateMany: jest.fn() },
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
    // Đếm Shop đang kết nối (GROUP BY theo trang / một tổ chức).
    $queryRaw: jest.fn(),
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
    isPlatform: false,
    // Chưa từng được duyệt ⇒ chưa có gói.
    shopLimit: null as number | null,
    expiresAt: null as Date | null,
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
    prisma.$queryRaw.mockResolvedValue([]);
    tx.organization.updateMany.mockResolvedValue({ count: 1 });

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
    OrganizationStatus.SUSPENDED,
  ])('🔴 Không duyệt được tổ chức đang %s — chỉ PENDING / REJECTED', async (status) => {
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

  // ------------------------------------------------------------------ Gói mặc định khi duyệt

  describe('gói khi duyệt / duyệt lại', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('🔴 Duyệt lần đầu: 10 Shop, hết hạn = NGÀY ĐĂNG KÝ + 30 ngày (không phải ngày duyệt)', async () => {
      // Đăng ký 01/11/2026, duyệt "hôm nay" (bất kỳ ngày nào) ⇒ hết hạn 01/12/2026.
      const registeredAt = new Date('2026-11-01T03:15:00.000Z');
      prisma.organization.findFirst.mockResolvedValue({ ...pendingOrg, createdAt: registeredAt });

      await service.approve(operator, 'org-1');

      const data = dataOf(tx.organization.update);
      expect(data.shopLimit).toBe(10);
      expect((data.expiresAt as Date).toISOString()).toBe('2026-12-01T03:15:00.000Z');
      expect((data.expiresAt as Date).getTime() - registeredAt.getTime()).toBe(30 * DAY);
    });

    it('🔴 Duyệt LẠI hồ sơ REJECTED chưa từng có gói ⇒ đặt mặc định, ghi nhật ký "duyệt lại"', async () => {
      prisma.organization.findFirst.mockResolvedValue({ ...pendingOrg, status: OrganizationStatus.REJECTED });

      await service.approve(operator, 'org-1');

      expect(dataOf(tx.organization.update)).toMatchObject({
        status: OrganizationStatus.ACTIVE,
        shopLimit: 10,
        rejectedReason: null,
      });
      expect(dataOf(tx.organizationApprovalLog.create)).toMatchObject({
        action: OrganizationApprovalAction.APPROVE,
        oldStatus: OrganizationStatus.REJECTED,
        newStatus: OrganizationStatus.ACTIVE,
      });
      // Chủ tổ chức vẫn PENDING từ lần đăng ký ⇒ phải được mở khoá như duyệt lần đầu.
      expect(tx.user.updateMany).toHaveBeenCalled();
    });

    it('🔴 Duyệt LẠI hồ sơ đã có gói tuỳ chỉnh ⇒ GIỮ NGUYÊN, không reset về 10 / 30 ngày', async () => {
      const custom = new Date('2027-09-12T00:00:00.000Z');
      prisma.organization.findFirst.mockResolvedValue({
        ...pendingOrg,
        status: OrganizationStatus.REJECTED,
        shopLimit: 500,
        expiresAt: custom,
      });

      await service.approve(operator, 'org-1');

      expect(dataOf(tx.organization.update)).toMatchObject({ shopLimit: 500, expiresAt: custom });
    });

    it('Từ chối chỉ áp cho PENDING — REJECTED không bị từ chối lại', async () => {
      prisma.organization.findFirst.mockResolvedValue({ ...pendingOrg, status: OrganizationStatus.REJECTED });
      await expect(service.reject(operator, 'org-1', { reason: 'Lý do đủ dài để hợp lệ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ------------------------------------------------------------------ Kích hoạt / vô hiệu hoá

  describe('kích hoạt / vô hiệu hoá', () => {
    const active = { ...pendingOrg, status: OrganizationStatus.ACTIVE, shopLimit: 10, expiresAt: new Date('2027-01-01') };

    it('Vô hiệu hoá ACTIVE ⇒ SUSPENDED (điều kiện theo trạng thái cũ), ghi nhật ký DEACTIVATE, không xoá gì', async () => {
      prisma.organization.findFirst.mockResolvedValue(active);

      await service.deactivate(operator, 'org-1');

      expect(tx.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-1', status: OrganizationStatus.ACTIVE },
        data: { status: OrganizationStatus.SUSPENDED, updatedBy: 'super-1' },
      });
      expect(dataOf(tx.organizationApprovalLog.create)).toMatchObject({
        action: OrganizationApprovalAction.DEACTIVATE,
        oldStatus: OrganizationStatus.ACTIVE,
        newStatus: OrganizationStatus.SUSPENDED,
      });
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it('Kích hoạt SUSPENDED ⇒ ACTIVE, giữ nguyên gói', async () => {
      prisma.organization.findFirst.mockResolvedValue({ ...active, status: OrganizationStatus.SUSPENDED });

      await service.activate(operator, 'org-1');

      expect(tx.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-1', status: OrganizationStatus.SUSPENDED },
        data: { status: OrganizationStatus.ACTIVE, updatedBy: 'super-1' },
      });
    });

    it.each([
      ['deactivate', OrganizationStatus.SUSPENDED],
      ['deactivate', OrganizationStatus.PENDING],
      ['activate', OrganizationStatus.ACTIVE],
      ['activate', OrganizationStatus.REJECTED],
    ] as const)('%s từ %s ⇒ 400, không ghi gì', async (action, status) => {
      prisma.organization.findFirst.mockResolvedValue({ ...active, status });
      await expect(service[action](operator, 'org-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.organization.updateMany).not.toHaveBeenCalled();
    });

    it('Hai Super Admin bấm cùng lúc (trạng thái vừa đổi) ⇒ 400, không ghi nhật ký', async () => {
      prisma.organization.findFirst.mockResolvedValue(active);
      tx.organization.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.deactivate(operator, 'org-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.organizationApprovalLog.create).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ Gói

  describe('đổi giới hạn Shop / ngày hết hạn', () => {
    const active = { ...pendingOrg, status: OrganizationStatus.ACTIVE, shopLimit: 10, expiresAt: new Date('2026-12-01') };

    it('Đổi giới hạn Shop: CHỈ đổi shop_limit, ghi nhật ký giá trị cũ → mới', async () => {
      prisma.organization.findFirst.mockResolvedValue(active);

      await service.updateShopLimit(operator, 'org-1', { shopLimit: 20 });

      expect(dataOf(tx.organization.update)).toEqual({ shopLimit: 20, updatedBy: 'super-1' });
      expect(dataOf(tx.organizationApprovalLog.create)).toMatchObject({
        action: OrganizationApprovalAction.UPDATE_SHOP_LIMIT,
        oldStatus: OrganizationStatus.ACTIVE,
        newStatus: OrganizationStatus.ACTIVE,
        reason: 'Giới hạn Shop: 10 → 20',
      });
    });

    it('🔴 Gia hạn tổ chức SUSPENDED: CHỈ đổi expires_at — VẪN SUSPENDED (không tự kích hoạt)', async () => {
      prisma.organization.findFirst.mockResolvedValue({ ...active, status: OrganizationStatus.SUSPENDED });

      await service.updateExpiration(operator, 'org-1', { expiresAt: '2027-06-30T16:59:59.000Z' });

      const data = dataOf(tx.organization.update);
      expect(data).toEqual({ expiresAt: new Date('2027-06-30T16:59:59.000Z'), updatedBy: 'super-1' });
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('shopLimit');
      expect(data).not.toHaveProperty('createdAt');
    });

    it('Gia hạn tổ chức đã HẾT HẠN (ACTIVE) ⇒ chỉ đổi expires_at — dùng lại được nhờ luật truy cập, không cần đổi trạng thái', async () => {
      prisma.organization.findFirst.mockResolvedValue({ ...active, expiresAt: new Date('2026-01-01') });
      await service.updateExpiration(operator, 'org-1', { expiresAt: '2027-01-01T00:00:00.000Z' });
      expect(dataOf(tx.organization.update)).not.toHaveProperty('status');
    });

    it('Ngày hết hạn trước ngày đăng ký ⇒ 400', async () => {
      prisma.organization.findFirst.mockResolvedValue(active);
      await expect(
        service.updateExpiration(operator, 'org-1', { expiresAt: '2026-07-01T00:00:00.000Z' }),
      ).rejects.toMatchObject({ response: { code: 'PLATFORM_ORGANIZATION_EXPIRATION_INVALID' } });
      expect(tx.organization.update).not.toHaveBeenCalled();
    });

    it.each([OrganizationStatus.PENDING, OrganizationStatus.REJECTED])(
      'Hồ sơ %s chưa có gói ⇒ không đổi gói được (gói đặt ở lần duyệt)',
      async (status) => {
        prisma.organization.findFirst.mockResolvedValue({ ...pendingOrg, status });
        await expect(service.updateShopLimit(operator, 'org-1', { shopLimit: 5 })).rejects.toMatchObject({
          response: { code: 'PLATFORM_ORGANIZATION_PLAN_NOT_EDITABLE' },
        });
      },
    );
  });

  // ------------------------------------------------------------------ Đọc

  it('Danh sách: số Shop đang kết nối của CẢ TRANG trong MỘT truy vấn, kèm gói + hết hạn', async () => {
    const past = new Date(Date.now() - 1000);
    prisma.$transaction.mockResolvedValue([
      [
        { ...pendingOrg, id: 'org-1', status: OrganizationStatus.ACTIVE, shopLimit: 10, expiresAt: past },
        { ...pendingOrg, id: 'org-2', status: OrganizationStatus.ACTIVE, shopLimit: 500, expiresAt: null },
      ],
      2,
    ]);
    prisma.$queryRaw.mockResolvedValue([{ organization_id: 'org-1', n: 3n }]);

    const result = await service.list({});

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({ connectedShopCount: 3, shopLimit: 10, expired: true });
    expect(result.items[1]).toMatchObject({ connectedShopCount: 0, shopLimit: 500, expired: false });
  });

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
