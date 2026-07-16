import { ConflictException, Injectable } from '@nestjs/common';
import { Organization, Prisma, User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ADMIN_ROLE_CODE,
  EMPLOYEE_DEFAULT_PERMISSIONS,
  EMPLOYEE_ROLE_CODE,
} from '../constants/default-roles';
import { RegisterOrganizationDto } from '../dto/register-organization.dto';
import { RegisterResponseDto } from '../dto/register-response.dto';
import { EmailAlreadyExistsException } from '../exceptions/email-already-exists.exception';
import { OrganizationService } from './organization.service';
import { PermissionService } from './permission.service';
import { RoleService } from './role.service';
import { TokenMeta, TokenService } from './token.service';
import { UserService } from './user.service';

interface RegistrationResult {
  organization: Organization;
  admin: User;
}

/**
 * RegisterService — điều phối luồng Register Organization (auth.md Mục 6).
 *
 * Flow:
 *   1. Validate input (DTO) + kiểm tra email chưa tồn tại (global unique).
 *   2. Transaction: Organization -> Roles -> RolePermission -> Admin User.
 *   3. Phát hành Access + Refresh Token.
 */
@Injectable()
export class RegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly roleService: RoleService,
    private readonly permissionService: PermissionService,
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
  ) {}

  async register(dto: RegisterOrganizationDto, meta: TokenMeta = {}): Promise<RegisterResponseDto> {
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

    // 3) Phát hành token (sau commit)
    const tokens = await this.tokenService.issueTokens(
      {
        userId: created.admin.id,
        organizationId: created.organization.id,
        roleCode: ADMIN_ROLE_CODE,
      },
      meta,
    );

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
      tokens,
    };
  }

  private async runRegistrationTx(
    tx: Prisma.TransactionClient,
    dto: RegisterOrganizationDto,
    slug: string,
    passwordHash: string,
  ): Promise<RegistrationResult> {
    // Create Organization
    const organization = await this.organizationService.createInTransaction(tx, {
      name: dto.organizationName,
      slug,
    });

    // Seed Roles
    const roles = await this.roleService.seedDefaultRolesInTransaction(tx, organization.id);

    // Seed RolePermission (gán toàn bộ catalog cho ADMIN — BR-18)
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

    // Create Admin User
    const admin = await this.userService.createAdminInTransaction(tx, {
      organizationId: organization.id,
      roleId: roles[ADMIN_ROLE_CODE].id,
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
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
