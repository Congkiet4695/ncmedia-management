import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  OrganizationApprovalAction,
  OrganizationStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import {
  countConnectedShops,
  countConnectedShopsByOrganization,
  defaultExpiresAt,
  isOrganizationExpiredAt,
  ORGANIZATION_DEFAULT_SHOP_LIMIT,
} from '../../../common/organization/organization-plan';
import { PrismaService } from '../../../database/prisma.service';
import { ADMIN_ROLE_CODE } from '../../auth/constants/default-roles';
import { invalidateOrganizationAccess } from '../../auth/shared/organization-access-cache';
import { MailService } from '../../mail/services/mail.service';
import { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import {
  ACTIVATABLE_STATUSES,
  APPROVABLE_STATUSES,
  DASHBOARD_STATUS_GROUPS,
  DEACTIVATABLE_STATUSES,
  PLAN_EDITABLE_STATUSES,
  REJECTABLE_STATUSES,
} from '../constants/super-admin.constants';
import type {
  RejectOrganizationDto,
  SuperAdminOrganizationQueryDto,
  UpdateOrganizationExpirationDto,
  UpdateOrganizationShopLimitDto,
} from '../dto/super-admin-organization.dto';

export class OrganizationNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'PLATFORM_ORGANIZATION_NOT_FOUND', message: 'Không tìm thấy Organization' });
  }
}

/** Tổ chức không ở trạng thái cho phép thao tác này (vd Kích hoạt một tổ chức đang ACTIVE). */
export class OrganizationInvalidStateException extends BadRequestException {
  constructor(code: string, message: string) {
    super({ code, message });
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

const OWNER_INCLUDE = {
  users: {
    where: { role: { code: ADMIN_ROLE_CODE }, deletedAt: null },
    select: OWNER_SELECT,
    orderBy: { createdAt: 'asc' as const },
    take: 1,
  },
} satisfies Prisma.OrganizationInclude;

type OrganizationWithOwner = Prisma.OrganizationGetPayload<{ include: typeof OWNER_INCLUDE }>;

/**
 * OrganizationReviewService — Super Admin quản lý VÒNG ĐỜI Organization (docs/organization-lifecycle.md).
 *
 * ```
 *   PENDING ──approve()──▶ ACTIVE  (+ user ACTIVE, email; gói mặc định: 10 Shop, hết hạn = ngày ĐĂNG KÝ + 30 ngày)
 *   PENDING ──reject()───▶ REJECTED (email kèm lý do)
 *   REJECTED ─approve()──▶ ACTIVE  (DUYỆT LẠI — gói đã có thì GIỮ, chưa có thì đặt mặc định như trên)
 *   ACTIVE/TRIAL ─deactivate()─▶ SUSPENDED  (đảo ngược được, KHÔNG xoá dữ liệu)
 *   SUSPENDED ─activate()──▶ ACTIVE
 *   updateShopLimit() / updateExpiration() — đổi gói; KHÔNG đổi trạng thái (gia hạn không tự mở khoá SUSPENDED)
 *   mọi thao tác ─▶ organization_approval_logs (append-only, CÙNG transaction)
 * ```
 *
 * "Hết hạn" không phải một trạng thái lưu trữ: là ACTIVE/TRIAL với `now() >= expires_at` — gia hạn là dùng lại
 * được ngay, không cần thao tác nào khác. Sau mỗi thay đổi, bộ đệm truy cập của `JwtAuthGuard` được xoá ngay.
 *
 * 🔴 Organization hệ thống (`is_platform`) bị loại khỏi MỌI truy vấn ở đây: để nó lọt vào thì Super Admin có thể
 * tự vô hiệu hoá chính tổ chức chứa tài khoản của mình — một cú bấm là khoá cửa vĩnh viễn.
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

  /** Danh sách Organization: lọc theo trạng thái, tìm theo tên tổ chức / owner / email, kèm gói + số Shop. */
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
        include: OWNER_INCLUDE,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.organization.count({ where }),
    ]);

    // Số Shop đang kết nối của CẢ TRANG trong MỘT truy vấn (GROUP BY) — không một truy vấn mỗi dòng.
    const shopCounts = await countConnectedShopsByOrganization(
      this.prisma,
      items.map((organization) => organization.id),
    );

    return {
      items: items.map((organization) => this.toRow(organization, shopCounts.get(organization.id) ?? 0)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  /** Chi tiết Organization kèm Owner, gói và lịch sử thao tác. */
  async get(id: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { id, isPlatform: false, deletedAt: null },
      include: {
        ...OWNER_INCLUDE,
        approvalLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { users: true } },
      },
    });
    if (!organization) throw new OrganizationNotFoundException();

    return {
      ...this.toRow(organization, await countConnectedShops(this.prisma, id)),
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

  /** Bốn con số của Super Admin Dashboard. */
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
  // Ghi — Approve / Re-approve / Reject
  // ---------------------------------------------------------------------------

  /**
   * Duyệt (PENDING) hoặc DUYỆT LẠI (REJECTED): Organization → ACTIVE, chủ Organization → ACTIVE, gửi email.
   *
   * Gói: chỉ đặt mặc định cho phần CHƯA có — `shop_limit = 10`, `expires_at = created_at (ngày ĐĂNG KÝ) + 30 ngày`.
   * Hồ sơ đã có gói (vd được Super Admin đặt tay, hoặc tổ chức tạo trước khi có tính năng — backfill 500 Shop /
   * 365 ngày) giữ nguyên khi duyệt lại. Hệ quả có chủ đích của luật "tính từ ngày đăng ký": hồ sơ đăng ký đã hơn
   * 30 ngày thì duyệt xong là HẾT HẠN ngay — response trả `expired = true` để giao diện nhắc gia hạn.
   *
   * 🔴 Chủ Organization phải được mở khoá CÙNG LÚC: đăng ký tạo user ở trạng thái PENDING.
   */
  async approve(operator: AuthenticatedUser, id: string) {
    const organization = await this.loadInState(
      id,
      APPROVABLE_STATUSES,
      'PLATFORM_ORGANIZATION_NOT_APPROVABLE',
      'chỉ duyệt được hồ sơ đang PENDING hoặc đã bị REJECTED',
    );
    const reApproval = organization.status === OrganizationStatus.REJECTED;
    const shopLimit = organization.shopLimit ?? ORGANIZATION_DEFAULT_SHOP_LIMIT;
    const expiresAt = organization.expiresAt ?? defaultExpiresAt(organization.createdAt);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.organization.update({
        where: { id },
        data: {
          status: OrganizationStatus.ACTIVE,
          approvedBy: operator.userId,
          approvedAt: new Date(),
          shopLimit,
          expiresAt,
          // Xoá dấu vết từ chối cũ (duyệt lại một hồ sơ từng bị từ chối).
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
        reason: reApproval ? 'Duyệt lại hồ sơ đã bị từ chối' : null,
      });

      return result;
    });
    invalidateOrganizationAccess(id);

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
      operation: reApproval ? 'organization.reapprove' : 'organization.approve',
      organizationId: id,
      operatorId: operator.userId,
      shopLimit,
      expiresAt: expiresAt.toISOString(),
      planDefaulted: organization.shopLimit === null || organization.expiresAt === null,
      emailSent: mail.sent,
      msg: reApproval ? 'Đã duyệt lại Organization' : 'Đã duyệt Organization',
    });

    return { ...(await this.get(id)), emailSent: mail.sent };
  }

  /** Từ chối hồ sơ đang chờ duyệt: Organization → REJECTED, lưu lý do, gửi email kèm lý do. */
  async reject(operator: AuthenticatedUser, id: string, dto: RejectOrganizationDto) {
    const organization = await this.loadInState(
      id,
      REJECTABLE_STATUSES,
      'PLATFORM_ORGANIZATION_NOT_PENDING',
      'chỉ từ chối được hồ sơ đang PENDING',
    );
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
    invalidateOrganizationAccess(id);

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
  // Ghi — Active / Deactive
  // ---------------------------------------------------------------------------

  /**
   * VÔ HIỆU HOÁ: ACTIVE/TRIAL → SUSPENDED. Admin / Employee bị chặn ở login và ở MỌI API (JwtAuthGuard). KHÔNG
   * xoá Shop / đơn / sản phẩm / design / fulfillment — chỉ đổi trạng thái, Kích hoạt lại là dùng tiếp.
   */
  async deactivate(operator: AuthenticatedUser, id: string) {
    return this.transition(operator, id, {
      from: DEACTIVATABLE_STATUSES,
      to: OrganizationStatus.SUSPENDED,
      action: OrganizationApprovalAction.DEACTIVATE,
      errorCode: 'PLATFORM_ORGANIZATION_NOT_ACTIVE',
      errorMessage: 'chỉ vô hiệu hoá được tổ chức đang hoạt động (ACTIVE / TRIAL)',
      operation: 'organization.deactivate',
      msg: 'Đã vô hiệu hoá Organization',
    });
  }

  /**
   * KÍCH HOẠT lại: SUSPENDED → ACTIVE. Không đổi gói — nếu đã quá `expires_at` thì tổ chức vẫn HẾT HẠN cho tới
   * khi được gia hạn (hai nguyên nhân chặn độc lập nhau).
   */
  async activate(operator: AuthenticatedUser, id: string) {
    return this.transition(operator, id, {
      from: ACTIVATABLE_STATUSES,
      to: OrganizationStatus.ACTIVE,
      action: OrganizationApprovalAction.ACTIVATE,
      errorCode: 'PLATFORM_ORGANIZATION_NOT_SUSPENDED',
      errorMessage: 'chỉ kích hoạt được tổ chức đang bị vô hiệu hoá (SUSPENDED)',
      operation: 'organization.activate',
      msg: 'Đã kích hoạt Organization',
    });
  }

  // ---------------------------------------------------------------------------
  // Ghi — Gói (giới hạn Shop / ngày hết hạn)
  // ---------------------------------------------------------------------------

  /**
   * Đổi số Shop tối đa. Chỉ đổi `shop_limit` (không đổi hạn, trạng thái, ngày đăng ký, chủ sở hữu). Hạ thấp hơn số
   * Shop đang kết nối là hợp lệ: shop đang có giữ nguyên, chỉ chặn kết nối THÊM (`exceedsShopLimit`).
   */
  async updateShopLimit(operator: AuthenticatedUser, id: string, dto: UpdateOrganizationShopLimitDto) {
    const organization = await this.loadInState(
      id,
      PLAN_EDITABLE_STATUSES,
      'PLATFORM_ORGANIZATION_PLAN_NOT_EDITABLE',
      'chỉ đổi được gói của tổ chức đã được duyệt — hồ sơ PENDING / REJECTED nhận gói khi được duyệt',
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id },
        data: { shopLimit: dto.shopLimit, updatedBy: operator.userId },
      });
      await this.writeLog(tx, {
        organizationId: id,
        operator,
        action: OrganizationApprovalAction.UPDATE_SHOP_LIMIT,
        oldStatus: organization.status,
        newStatus: organization.status,
        reason: `Giới hạn Shop: ${organization.shopLimit ?? 'không giới hạn'} → ${dto.shopLimit}`,
      });
    });
    invalidateOrganizationAccess(id);
    this.logger.log({
      module: 'super-admin',
      operation: 'organization.shop-limit.update',
      organizationId: id,
      operatorId: operator.userId,
      from: organization.shopLimit,
      to: dto.shopLimit,
      msg: 'Đã đổi giới hạn Shop của Organization',
    });
    return this.get(id);
  }

  /**
   * Đổi ngày hết hạn. Chỉ đổi `expires_at`. Gia hạn tổ chức đang HẾT HẠN là dùng lại được ngay; tổ chức đang
   * SUSPENDED thì VẪN bị vô hiệu hoá (không tự kích hoạt). Không được đặt trước ngày đăng ký.
   */
  async updateExpiration(operator: AuthenticatedUser, id: string, dto: UpdateOrganizationExpirationDto) {
    const organization = await this.loadInState(
      id,
      PLAN_EDITABLE_STATUSES,
      'PLATFORM_ORGANIZATION_PLAN_NOT_EDITABLE',
      'chỉ đổi được gói của tổ chức đã được duyệt — hồ sơ PENDING / REJECTED nhận gói khi được duyệt',
    );
    const expiresAt = new Date(dto.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new OrganizationInvalidStateException(
        'PLATFORM_ORGANIZATION_EXPIRATION_INVALID',
        'Ngày hết hạn không hợp lệ.',
      );
    }
    if (expiresAt.getTime() < organization.createdAt.getTime()) {
      throw new OrganizationInvalidStateException(
        'PLATFORM_ORGANIZATION_EXPIRATION_INVALID',
        'Ngày hết hạn không được trước ngày đăng ký của tổ chức.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id },
        data: { expiresAt, updatedBy: operator.userId },
      });
      await this.writeLog(tx, {
        organizationId: id,
        operator,
        action: OrganizationApprovalAction.UPDATE_EXPIRATION,
        oldStatus: organization.status,
        newStatus: organization.status,
        reason: `Ngày hết hạn: ${organization.expiresAt?.toISOString() ?? 'không hết hạn'} → ${expiresAt.toISOString()}`,
      });
    });
    invalidateOrganizationAccess(id);
    this.logger.log({
      module: 'super-admin',
      operation: 'organization.expiration.update',
      organizationId: id,
      operatorId: operator.userId,
      from: organization.expiresAt?.toISOString() ?? null,
      to: expiresAt.toISOString(),
      status: organization.status,
      msg: 'Đã đổi ngày hết hạn của Organization',
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Đổi trạng thái đơn thuần (Kích hoạt / Vô hiệu hoá) + nhật ký trong CÙNG transaction. */
  private async transition(
    operator: AuthenticatedUser,
    id: string,
    spec: {
      from: readonly OrganizationStatus[];
      to: OrganizationStatus;
      action: OrganizationApprovalAction;
      errorCode: string;
      errorMessage: string;
      operation: string;
      msg: string;
    },
  ) {
    const organization = await this.loadInState(id, spec.from, spec.errorCode, spec.errorMessage);
    await this.prisma.$transaction(async (tx) => {
      // `status` trong điều kiện ⇒ hai Super Admin bấm cùng lúc không ghi đè trạng thái của nhau.
      const { count } = await tx.organization.updateMany({
        where: { id, status: organization.status },
        data: { status: spec.to, updatedBy: operator.userId },
      });
      if (count === 0) {
        throw new OrganizationInvalidStateException(spec.errorCode, `Organization vừa đổi trạng thái — ${spec.errorMessage}.`);
      }
      await this.writeLog(tx, {
        organizationId: id,
        operator,
        action: spec.action,
        oldStatus: organization.status,
        newStatus: spec.to,
        reason: null,
      });
    });
    invalidateOrganizationAccess(id);
    this.logger.log({
      module: 'super-admin',
      operation: spec.operation,
      organizationId: id,
      operatorId: operator.userId,
      oldStatus: organization.status,
      newStatus: spec.to,
      msg: spec.msg,
    });
    return this.get(id);
  }

  /** Nạp Organization (không phải tổ chức hệ thống) và khẳng định nó đang ở một trong các trạng thái cho phép. */
  private async loadInState(
    id: string,
    allowed: readonly OrganizationStatus[],
    errorCode: string,
    errorMessage: string,
  ): Promise<OrganizationWithOwner> {
    const organization = await this.prisma.organization.findFirst({
      where: { id, isPlatform: false, deletedAt: null },
      include: OWNER_INCLUDE,
    });
    if (!organization) throw new OrganizationNotFoundException();

    if (!allowed.includes(organization.status)) {
      throw new OrganizationInvalidStateException(
        errorCode,
        `Organization đang ở trạng thái ${organization.status} — ${errorMessage}.`,
      );
    }
    return organization;
  }

  /**
   * Ghi một dòng nhật ký thao tác.
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

  /** Organization + Owner + gói ⇒ một dòng cho màn hình. */
  private toRow(organization: OrganizationWithOwner, connectedShopCount: number) {
    const owner = organization.users[0] ?? null;
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      /** Thời điểm đăng ký = thời điểm tạo Organization. */
      registeredAt: organization.createdAt,
      createdAt: organization.createdAt,
      shopLimit: organization.shopLimit,
      connectedShopCount,
      expiresAt: organization.expiresAt,
      expired: isOrganizationExpiredAt(organization.expiresAt),
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
