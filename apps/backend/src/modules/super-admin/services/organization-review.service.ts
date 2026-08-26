import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  OrganizationApprovalAction,
  OrganizationStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ADMIN_ROLE_CODE } from '../../auth/constants/default-roles';
import { MailService } from '../../mail/services/mail.service';
import { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import {
  DASHBOARD_STATUS_GROUPS,
  REVIEWABLE_STATUSES,
} from '../constants/super-admin.constants';
import type {
  RejectOrganizationDto,
  SuperAdminOrganizationQueryDto,
} from '../dto/super-admin-organization.dto';

export class OrganizationNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'PLATFORM_ORGANIZATION_NOT_FOUND', message: 'Không tìm thấy Organization' });
  }
}

/** Chủ Organization — người nhận email duyệt/từ chối. */
const OWNER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

/**
 * OrganizationReviewService — Super Admin duyệt / từ chối Organization đăng ký mới.
 *
 * ```
 *   Organization PENDING
 *        ↓ approve()  → ACTIVE  + user ACTIVE  + email "Organization Approved"
 *        ↓ reject()   → REJECTED + email kèm lý do
 *        ↓ (cả hai)   → organization_approval_logs (append-only)
 * ```
 *
 * 🔴 **Organization hệ thống (`is_platform`) bị loại khỏi MỌI truy vấn ở đây.** Nó không phải
 * một tenant đăng ký, không đi qua luồng duyệt, và để nó lọt vào danh sách thì Super Admin có
 * thể tự từ chối chính tổ chức chứa tài khoản của mình — một cú bấm là khoá cửa vĩnh viễn.
 *
 * 🔴 Đổi trạng thái và ghi nhật ký nằm trong CÙNG một transaction. Tách ra thì một lỗi giữa
 * chừng để lại Organization đã đổi trạng thái mà không ai biết ai đã đổi — đúng thứ nhật ký
 * sinh ra để trả lời.
 */
@Injectable()
export class OrganizationReviewService {
  private readonly logger = new Logger(OrganizationReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------

  /** §6 — danh sách Organization: lọc theo trạng thái, tìm theo tên tổ chức / owner / email. */
  async list(query: SuperAdminOrganizationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.OrganizationWhereInput = {
      // Loại Organization hệ thống khỏi sổ đăng ký tenant.
      isPlatform: false,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              // Tìm theo Owner: chủ Organization là user mang role ADMIN được tạo lúc đăng ký.
              { users: { some: { fullName: { contains: search, mode: 'insensitive' as const } } } },
              { users: { some: { email: { contains: search, mode: 'insensitive' as const } } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where,
        include: {
          users: {
            where: { role: { code: ADMIN_ROLE_CODE }, deletedAt: null },
            select: OWNER_SELECT,
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.organization.count({ where }),
    ]);

    return {
      items: items.map((organization) => this.toRow(organization)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /** §7 — chi tiết Organization kèm Owner và lịch sử duyệt. */
  async get(id: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { id, isPlatform: false, deletedAt: null },
      include: {
        users: {
          where: { role: { code: ADMIN_ROLE_CODE }, deletedAt: null },
          select: OWNER_SELECT,
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        approvalLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { users: true } },
      },
    });
    if (!organization) throw new OrganizationNotFoundException();

    return {
      ...this.toRow(organization),
      userCount: organization._count.users,
      approvedBy: organization.approvedBy,
      approvedAt: organization.approvedAt,
      rejectedBy: organization.rejectedBy,
      rejectedAt: organization.rejectedAt,
      rejectedReason: organization.rejectedReason,
      updatedAt: organization.updatedAt,
      approvalLogs: organization.approvalLogs,
    };
  }

  /** §10 — bốn con số của Super Admin Dashboard. */
  async dashboard() {
    const grouped = await this.prisma.organization.groupBy({
      by: ['status'],
      where: { isPlatform: false, deletedAt: null },
      _count: { _all: true },
    });

    const count = (status: OrganizationStatus): number =>
      grouped.find((row) => row.status === status)?._count._all ?? 0;

    return {
      pending: count(DASHBOARD_STATUS_GROUPS.PENDING),
      approved: count(DASHBOARD_STATUS_GROUPS.APPROVED),
      rejected: count(DASHBOARD_STATUS_GROUPS.REJECTED),
      // Tổng đếm MỌI trạng thái, kể cả TRIAL/SUSPENDED — "Total Organizations" là tổng thật
      // của sổ đăng ký, không phải tổng của ba ô phía trên.
      total: grouped.reduce((sum, row) => sum + row._count._all, 0),
    };
  }

  // ---------------------------------------------------------------------------
  // Ghi — Approve / Reject
  // ---------------------------------------------------------------------------

  /**
   * §8 — Duyệt: Organization → ACTIVE, chủ Organization → ACTIVE, gửi email.
   *
   * 🔴 Chủ Organization phải được mở khoá CÙNG LÚC. Đăng ký tạo user ở trạng thái PENDING;
   * chỉ đổi Organization mà quên user thì họ vẫn không đăng nhập được, và thông điệp lỗi lại
   * nói về tài khoản chứ không nói về tổ chức — một lỗi rất khó lần ra.
   */
  async approve(operator: AuthenticatedUser, id: string) {
    const organization = await this.loadReviewable(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.organization.update({
        where: { id },
        data: {
          status: OrganizationStatus.ACTIVE,
          approvedBy: operator.userId,
          approvedAt: new Date(),
          // Xoá dấu vết từ chối cũ (nếu Organization từng bị từ chối rồi mở lại).
          rejectedBy: null,
          rejectedAt: null,
          rejectedReason: null,
          updatedBy: operator.userId,
        },
      });

      await tx.user.updateMany({
        where: { organizationId: id, status: UserStatus.PENDING, deletedAt: null },
        data: { status: UserStatus.ACTIVE },
      });

      await this.writeLog(tx, {
        organizationId: id,
        operator,
        action: OrganizationApprovalAction.APPROVE,
        oldStatus: organization.status,
        newStatus: OrganizationStatus.ACTIVE,
        reason: null,
      });

      return result;
    });

    const owner = organization.users[0];
    const mail = owner
      ? await this.mail.sendOrganizationApproved({
          to: owner.email,
          fullName: owner.fullName,
          organizationName: updated.name,
        })
      : { sent: false };

    this.logger.log({
      module: 'super-admin',
      operation: 'organization.approve',
      organizationId: id,
      operatorId: operator.userId,
      emailSent: mail.sent,
      msg: 'Đã duyệt Organization',
    });

    return { ...(await this.get(id)), emailSent: mail.sent };
  }

  /** §9 — Từ chối: Organization → REJECTED, lưu lý do, gửi email kèm lý do. */
  async reject(operator: AuthenticatedUser, id: string, dto: RejectOrganizationDto) {
    const organization = await this.loadReviewable(id);
    const reason = dto.reason.trim();

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id },
        data: {
          status: OrganizationStatus.REJECTED,
          rejectedBy: operator.userId,
          rejectedAt: new Date(),
          rejectedReason: reason,
          updatedBy: operator.userId,
        },
      });

      await this.writeLog(tx, {
        organizationId: id,
        operator,
        action: OrganizationApprovalAction.REJECT,
        oldStatus: organization.status,
        newStatus: OrganizationStatus.REJECTED,
        reason,
      });
    });

    // 🔴 Không đụng tới `users.status`: chủ Organization vẫn PENDING. Cổng đăng nhập đã chặn
    // theo trạng thái TỔ CHỨC, nên đổi thêm trạng thái user chỉ làm thông điệp lỗi sai đi.

    const owner = organization.users[0];
    const mail = owner
      ? await this.mail.sendOrganizationRejected({
          to: owner.email,
          fullName: owner.fullName,
          organizationName: organization.name,
          reason,
        })
      : { sent: false };

    this.logger.log({
      module: 'super-admin',
      operation: 'organization.reject',
      organizationId: id,
      operatorId: operator.userId,
      emailSent: mail.sent,
      msg: 'Đã từ chối Organization',
    });

    return { ...(await this.get(id)), emailSent: mail.sent };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Nạp Organization và khẳng định nó đang ở trạng thái duyệt được. */
  private async loadReviewable(id: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { id, isPlatform: false, deletedAt: null },
      include: {
        users: {
          where: { role: { code: ADMIN_ROLE_CODE }, deletedAt: null },
          select: OWNER_SELECT,
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    if (!organization) throw new OrganizationNotFoundException();

    if (!REVIEWABLE_STATUSES.includes(organization.status)) {
      throw new BadRequestException({
        code: 'PLATFORM_ORGANIZATION_NOT_PENDING',
        message: `Organization đang ở trạng thái ${organization.status} — chỉ duyệt/từ chối được hồ sơ đang PENDING.`,
      });
    }

    return organization;
  }

  /**
   * Ghi một dòng nhật ký duyệt (§13).
   *
   * Chép kèm email + tên người thao tác thay vì chỉ lưu `operator_id`: nhật ký phải đọc được
   * cả sau khi tài khoản người duyệt bị xoá hoặc đổi tên.
   */
  private async writeLog(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      operator: AuthenticatedUser;
      action: OrganizationApprovalAction;
      oldStatus: OrganizationStatus;
      newStatus: OrganizationStatus;
      reason: string | null;
    },
  ): Promise<void> {
    const actor = await tx.user.findUnique({
      where: { id: input.operator.userId },
      select: { email: true, fullName: true },
    });

    await tx.organizationApprovalLog.create({
      data: {
        organizationId: input.organizationId,
        operatorId: input.operator.userId,
        operatorEmail: actor?.email ?? 'unknown',
        operatorFullName: actor?.fullName ?? 'unknown',
        action: input.action,
        oldStatus: input.oldStatus,
        newStatus: input.newStatus,
        reason: input.reason,
      },
    });
  }

  /** Organization + Owner ⇒ một dòng cho màn hình (§6). */
  private toRow(
    organization: Prisma.OrganizationGetPayload<{
      include: { users: { select: typeof OWNER_SELECT } };
    }>,
  ) {
    const owner = organization.users[0] ?? null;
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      /** Thời điểm đăng ký = thời điểm tạo Organization. */
      registeredAt: organization.createdAt,
      createdAt: organization.createdAt,
      owner: owner
        ? {
            id: owner.id,
            fullName: owner.fullName,
            email: owner.email,
            phone: owner.phone,
            status: owner.status,
            lastLoginAt: owner.lastLoginAt,
          }
        : null,
    };
  }
}
