import { Injectable } from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';
import { EMPLOYEE_ROLE_CODE } from '../../auth/constants/default-roles';
import {
  EMPLOYEE_BCRYPT_COST,
  mapEmployeeStatusToUserStatus,
} from '../constants/employee.constants';
import { CreateEmployeeDto } from '../dto/create-employee.dto';
import {
  CreateEmployeeResponseDto,
  EmployeeResponseDto,
  PaginatedEmployeeResponseDto,
  ResetPasswordResponseDto,
} from '../dto/employee-response.dto';
import { EmployeeQueryDto } from '../dto/employee-query.dto';
import { UpdateEmployeeDto } from '../dto/update-employee.dto';
import { EmployeeCccdExistsException } from '../exceptions/employee-cccd-exists.exception';
import { EmployeeEmailExistsException } from '../exceptions/employee-email-exists.exception';
import { EmployeeNotFoundException } from '../exceptions/employee-not-found.exception';
import { EmployeeRoleInvalidException } from '../exceptions/employee-role-invalid.exception';
import { EmployeeMapper } from '../mappers/employee.mapper';
import { EmployeeRepository } from '../repositories/employee.repository';
import { generateTemporaryPassword } from '../utils/password-generator';

/** Trường hồ sơ nhân sự lấy từ DTO (create/update). Date đã convert. */
interface EmployeeProfileInput {
  larkAccount?: string;
  startDate?: Date;
  resignedAt?: Date;
  cccd?: string;
  cccdImageUrl?: string;
  phone?: string;
  dateOfBirth?: Date;
  address?: string;
  department?: string;
  bankAccount?: string;
  bankQrUrl?: string;
  salary?: number;
  avatar?: string;
}

/**
 * EmployeeService — nghiệp vụ quản lý Employee (sheet "Nhân viên").
 * Tenant isolation: mọi thao tác nhận `organizationId` từ token (ADR-004).
 */
@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: EmployeeRepository,
    private readonly mapper: EmployeeMapper,
  ) {}

  async create(
    organizationId: string,
    actorUserId: string,
    dto: CreateEmployeeDto,
  ): Promise<CreateEmployeeResponseDto> {
    const email = dto.email.trim().toLowerCase();
    if (await this.repo.emailExists(email)) throw new EmployeeEmailExistsException();
    if (dto.cccd && (await this.repo.cccdExists(dto.cccd))) throw new EmployeeCccdExistsException();

    const role = await this.resolveRole(organizationId, dto.roleId);
    const employeeStatus = dto.status ?? EmployeeStatus.ACTIVE;

    const initialPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(initialPassword, EMPLOYEE_BCRYPT_COST);

    try {
      const employee = await this.prisma.$transaction((tx) =>
        this.repo.createWithUser(tx, {
          organizationId,
          actorUserId,
          roleId: role.id,
          email,
          passwordHash,
          fullName: dto.fullName,
          employeeStatus,
          userStatus: mapEmployeeStatusToUserStatus(employeeStatus),
          ...this.profileFromDto(dto),
        }),
      );
      // credentials hiển thị MỘT LẦN (email + initialPassword) — không lưu plaintext.
      return { ...this.mapper.toResponse(employee), credentials: { email, initialPassword } };
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  /**
   * Reset mật khẩu Employee: sinh mật khẩu mới → hash bcrypt → cập nhật DB → trả về **một lần**.
   * Tenant-scoped (findById theo organizationId). Không lưu plaintext, không thêm cột.
   */
  async resetPassword(
    organizationId: string,
    actorUserId: string,
    id: string,
  ): Promise<ResetPasswordResponseDto> {
    const existing = await this.repo.findById(organizationId, id);
    if (!existing) throw new EmployeeNotFoundException();

    const newPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(newPassword, EMPLOYEE_BCRYPT_COST);
    await this.repo.updateUserPassword(existing.userId, passwordHash, actorUserId);

    return { newPassword };
  }

  async findAll(
    organizationId: string,
    query: EmployeeQueryDto,
  ): Promise<PaginatedEmployeeResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { items, total } = await this.repo.findMany(organizationId, {
      page,
      limit,
      fullname: query.fullname,
      email: query.email,
      status: query.status,
      department: query.department,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      roleId: query.roleId,
      search: query.search,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'desc',
    });

    return {
      items: items.map((e) => this.mapper.toListItem(e)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async findOne(organizationId: string, id: string): Promise<EmployeeResponseDto> {
    const employee = await this.repo.findById(organizationId, id);
    if (!employee) throw new EmployeeNotFoundException();
    return this.mapper.toResponse(employee);
  }

  async update(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const existing = await this.repo.findById(organizationId, id);
    if (!existing) throw new EmployeeNotFoundException();

    if (dto.roleId) {
      const role = await this.repo.findRoleInOrg(organizationId, dto.roleId);
      if (!role) throw new EmployeeRoleInvalidException();
    }
    if (dto.cccd && (await this.repo.cccdExists(dto.cccd, existing.id))) {
      throw new EmployeeCccdExistsException();
    }

    const employeeStatus = dto.status;

    try {
      const updated = await this.prisma.$transaction((tx) =>
        this.repo.updateWithUser(tx, existing.id, existing.userId, {
          actorUserId,
          fullName: dto.fullName,
          roleId: dto.roleId,
          employeeStatus,
          userStatus:
            employeeStatus !== undefined ? mapEmployeeStatusToUserStatus(employeeStatus) : undefined,
          ...this.profileFromDto(dto),
        }),
      );
      return this.mapper.toResponse(updated);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  /** Soft delete (BR: không hard delete). Vô hiệu hóa cả tài khoản đăng nhập. */
  async remove(organizationId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.repo.findById(organizationId, id);
    if (!existing) throw new EmployeeNotFoundException();

    await this.prisma.$transaction((tx) =>
      this.repo.softDelete(tx, existing.id, existing.userId, actorUserId),
    );
  }

  /** Chuyển các field hồ sơ từ DTO (ISO date → Date). undefined = không đổi (update). */
  private profileFromDto(dto: CreateEmployeeDto | UpdateEmployeeDto): EmployeeProfileInput {
    return {
      larkAccount: dto.larkAccount,
      startDate: this.toDate(dto.startDate),
      resignedAt: this.toDate(dto.resignedAt),
      cccd: dto.cccd,
      cccdImageUrl: dto.cccdImageUrl,
      phone: dto.phone,
      dateOfBirth: this.toDate(dto.dateOfBirth),
      address: dto.address,
      department: dto.department,
      bankAccount: dto.bankAccount,
      bankQrUrl: dto.bankQrUrl,
      salary: dto.salary,
      avatar: dto.avatar,
    };
  }

  private toDate(value?: string): Date | undefined {
    return value ? new Date(value) : undefined;
  }

  private async resolveRole(organizationId: string, roleId?: string) {
    const role = roleId
      ? await this.repo.findRoleInOrg(organizationId, roleId)
      : await this.repo.findRoleByCode(organizationId, EMPLOYEE_ROLE_CODE);
    if (!role) throw new EmployeeRoleInvalidException();
    return role;
  }

  /** P2002 (email/cccd) → exception nghiệp vụ tương ứng. */
  private mapWriteError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
      if (fields.includes('email')) return new EmployeeEmailExistsException();
      if (fields.includes('cccd')) return new EmployeeCccdExistsException();
    }
    return err instanceof Error ? err : new Error('Unknown error');
  }
}
