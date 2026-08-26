import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Organization, OrganizationStatus, Prisma, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MailService } from '../../mail/services/mail.service';
import {
  ADMIN_ROLE_CODE,
  EMPLOYEE_DEFAULT_PERMISSIONS,
  EMPLOYEE_ROLE_CODE,
  FULFILLMENT_DEFAULT_PERMISSIONS,
  FULFILLMENT_ROLE_CODE,
} from '../constants/default-roles';
import { RegisterOrganizationDto } from '../dto/register-organization.dto';
import { RegisterResponseDto } from '../dto/register-response.dto';
import { EmailAlreadyExistsException } from '../exceptions/email-already-exists.exception';
import { OrganizationService } from './organization.service';
import { PermissionService } from './permission.service';
import { RoleService } from './role.service';
import { TokenMeta } from './token.service';
import { UserService } from './user.service';

interface RegistrationResult {
  organization: Organization;
  admin: User;
}

/**
 * RegisterService — điều phối luồng Register Organization (auth.md Mục 6).
 *
 * ```
 *   Register  →  Organization PENDING  →  Email xác nhận  →  chờ Super Admin duyệt
 * ```
 *
 * 🔴 **KHÔNG phát hành token nữa.** Organization vừa tạo ở trạng thái PENDING, mà PENDING thì
 * `LoginService` chặn — phát token ở đây là tự tay mở cửa sau cho đúng thứ luồng duyệt sinh
 * ra để chặn. Đây là thay đổi hợp đồng API duy nhất của tính năng này.
 *
 * 🔴 Email gửi SAU KHI transaction commit và KHÔNG được phép làm hỏng đăng ký: Organization
 * đã tồn tại trong database rồi, ném lỗi vì SMTP hỏng chỉ khiến người dùng bấm "Đăng ký" lần
 * nữa và nhận lỗi trùng email. Kết quả gửi trả về qua cờ `emailSent`.
 */
@Injectable()
export class RegisterService {
  private readonly logger = new Logger(RegisterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly roleService: RoleService,
    private readonly permissionService: PermissionService,
    private readonly userService: UserService,
    private readonly mail: MailService,
  ) {}

   
  async register(dto: RegisterOrganizationDto, _meta: TokenMeta = {}): Promise<RegisterResponseDto> {
    // 1) Business validation: email global unique (Decision-001)
    const existing = await this.userService.findByEmail(dto.email);
    if (existing) throw new EmailAlreadyExistsException();

    // Sinh slug hợp lệ + hash password (CPU-bound) trước khi mở transaction
    const slug = await this.organizationService.generateUniqueSlug(dto.organizationName);
    const passwordHash = await this.userService.hashPassword(dto.password);

    // 2) Transaction nguyên tử (BR-01)
    let created: RegistrationResult;
    try {
      created = await this.prisma.$transaction((tx) =>
        this.runRegistrationTx(tx, dto, slug, passwordHash),
      );
    } catch (err) {
      throw this.mapPrismaError(err);
    }

    // 3) Email xác nhận đã tiếp nhận (§3) — sau commit, không chặn kết quả đăng ký.
    const { sent } = await this.mail.sendOrganizationRegistered({
      to: created.admin.email,
      fullName: created.admin.fullName,
      organizationName: created.organization.name,
    });

    this.logger.log({
      module: 'auth',
      operation: 'register',
      organizationId: created.organization.id,
      status: created.organization.status,
      emailSent: sent,
      msg: 'Đã tiếp nhận đăng ký Organization — chờ Super Admin duyệt',
    });

    return {
      organization: {
        id: created.organization.id,
        name: created.organization.name,
        slug: created.organization.slug,
        status: created.organization.status,
      },
      user: {
        id: created.admin.id,
        email: created.admin.email,
        fullName: created.admin.fullName,
        status: created.admin.status,
      },
      emailSent: sent,
    };
  }

  private async runRegistrationTx(
    tx: Prisma.TransactionClient,
    dto: RegisterOrganizationDto,
    slug: string,
    passwordHash: string,
  ): Promise<RegistrationResult> {
    // Create Organization — PENDING, chờ Super Admin duyệt (§2).
    const organization = await this.organizationService.createInTransaction(tx, {
      name: dto.organizationName,
      slug,
      status: OrganizationStatus.PENDING,
    });

    // Seed Roles
    const roles = await this.roleService.seedDefaultRolesInTransaction(tx, organization.id);

    // Seed RolePermission (gán toàn bộ catalog cho ADMIN — BR-18)
    //
    // 🔴 `findAllIdsInTransaction` LOẠI TRỪ nhóm quyền `platform.*` (quản trị nền tảng).
    // Không loại thì mỗi lần đăng ký mới lại cấp cho một org admin quyền duyệt/từ chối
    // Organization của người khác — leo thang đặc quyền xuyên tenant, không phải một lỗi UI.
    const permissionIds = await this.permissionService.findAllIdsInTransaction(tx);
    await this.roleService.assignPermissionsInTransaction(
      tx,
      roles[ADMIN_ROLE_CODE].id,
      permissionIds,
    );

    // Gán permission mặc định cho EMPLOYEE (Account của mình + Order + Profile) —
    // để user role EMPLOYEE thấy đúng menu/thao tác theo permission ngay khi org được tạo.
    const employeePermissionIds = await this.permissionService.findIdsByCodesInTransaction(
      tx,
      EMPLOYEE_DEFAULT_PERMISSIONS,
    );
    await this.roleService.assignPermissionsInTransaction(
      tx,
      roles[EMPLOYEE_ROLE_CODE].id,
      employeePermissionIds,
    );

    // Gán permission mặc định cho FULFILLMENT (xem tất cả Order + claim + fulfill).
    const fulfillmentPermissionIds = await this.permissionService.findIdsByCodesInTransaction(
      tx,
      FULFILLMENT_DEFAULT_PERMISSIONS,
    );
    await this.roleService.assignPermissionsInTransaction(
      tx,
      roles[FULFILLMENT_ROLE_CODE].id,
      fulfillmentPermissionIds,
    );

    // Create Admin User — PENDING đồng bộ với Organization (§2).
    const admin = await this.userService.createAdminInTransaction(tx, {
      organizationId: organization.id,
      roleId: roles[ADMIN_ROLE_CODE].id,
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      phone: dto.phone ?? null,
      status: UserStatus.PENDING,
    });

    return { organization, admin };
  }

  /** Chuyển lỗi Prisma unique (P2002) thành exception nghiệp vụ. */
  private mapPrismaError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = err.meta?.target;
      const fields = Array.isArray(target)
        ? target.join(',')
        : typeof target === 'string'
          ? target
          : '';
      if (fields.includes('email')) return new EmailAlreadyExistsException();
      return new ConflictException({
        code: 'RESOURCE_CONFLICT',
        message: 'Dữ liệu bị trùng, vui lòng thử lại',
      });
    }
    return err instanceof Error ? err : new Error('Unknown error');
  }
}
