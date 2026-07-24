import { Injectable } from '@nestjs/common';
import { EmployeeStatus, Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { EmployeeSortField } from '../constants/employee.constants';
import { EMPLOYEE_INCLUDE, EmployeeWithRelations } from '../types/employee-with-relations.type';

/** Trường hồ sơ nhân sự (dùng chung create/update). Date-only đã convert sang Date. */
interface EmployeeProfileData {
  larkAccount?: string | null;
  startDate?: Date | null;
  resignedAt?: Date | null;
  cccd?: string | null;
  cccdImageUrl?: string | null;
  phone?: string | null;
  dateOfBirth?: Date | null;
  address?: string | null;
  department?: string | null;
  bankAccount?: string | null;
  bankQrUrl?: string | null;
  salary?: number;
  orderKpi?: number;
  revenueKpi?: number;
  avatar?: string | null;
}

/** Tham số tạo Employee + User (trong transaction). */
export interface CreateEmployeeData extends EmployeeProfileData {
  organizationId: string;
  actorUserId: string;
  roleId: string;
  email: string;
  passwordHash: string;
  fullName: string;
  employeeStatus: EmployeeStatus;
  userStatus: UserStatus;
}

/** Tham số cập nhật Employee + User (chỉ field được cung cấp). */
export interface UpdateEmployeeData extends EmployeeProfileData {
  actorUserId: string;
  fullName?: string;
  roleId?: string;
  employeeStatus?: EmployeeStatus;
  userStatus?: UserStatus;
}

/** Tham số lọc/sắp xếp/phân trang danh sách. */
export interface FindManyParams {
  page: number;
  limit: number;
  fullname?: string;
  email?: string;
  status?: EmployeeStatus;
  department?: string;
  startDate?: Date;
  roleId?: string;
  search?: string;
  sortBy: EmployeeSortField;
  sortOrder: 'asc' | 'desc';
}

/**
 * EmployeeRepository — data-access cho aggregate Employee (Employee + tài khoản User).
 * Mọi truy vấn nhận `organizationId` (ADR-004 — tenant isolation).
 */
@Injectable()
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** email UNIQUE GLOBAL — kiểm tra trên toàn bảng users (kể cả soft-deleted — Decision-001). */
  async emailExists(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { email } });
    return count > 0;
  }

  /** CCCD UNIQUE (global). Bỏ qua bản ghi `excludeEmployeeId` (khi update chính nó). */
  async cccdExists(cccd: string, excludeEmployeeId?: string): Promise<boolean> {
    const count = await this.prisma.employee.count({
      where: { cccd, ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}) },
    });
    return count > 0;
  }

  findRoleInOrg(organizationId: string, roleId: string): Promise<Role | null> {
    return this.prisma.role.findFirst({ where: { id: roleId, organizationId, deletedAt: null } });
  }

  findRoleByCode(organizationId: string, code: string): Promise<Role | null> {
    return this.prisma.role.findFirst({ where: { organizationId, code, deletedAt: null } });
  }

  findById(organizationId: string, id: string): Promise<EmployeeWithRelations | null> {
    return this.prisma.employee.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: EMPLOYEE_INCLUDE,
    });
  }

  /** Tạo User rồi Employee trong cùng transaction (BR: Create User → Assign Role → Create Employee). */
  async createWithUser(
    tx: Prisma.TransactionClient,
    data: CreateEmployeeData,
  ): Promise<EmployeeWithRelations> {
    const user = await tx.user.create({
      data: {
        organizationId: data.organizationId,
        roleId: data.roleId,
        email: data.email,
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        status: data.userStatus,
        createdBy: data.actorUserId,
      },
    });

    return tx.employee.create({
      data: {
        organizationId: data.organizationId,
        userId: user.id,
        status: data.employeeStatus,
        larkAccount: data.larkAccount ?? null,
        startDate: data.startDate ?? null,
        resignedAt: data.resignedAt ?? null,
        cccd: data.cccd ?? null,
        cccdImageUrl: data.cccdImageUrl ?? null,
        phone: data.phone ?? null,
        dateOfBirth: data.dateOfBirth ?? null,
        address: data.address ?? null,
        department: data.department ?? null,
        bankAccount: data.bankAccount ?? null,
        bankQrUrl: data.bankQrUrl ?? null,
        salary: data.salary ?? 0,
        orderKpi: data.orderKpi ?? 0,
        revenueKpi: data.revenueKpi ?? 0,
        avatar: data.avatar ?? null,
        createdBy: data.actorUserId,
      },
      include: EMPLOYEE_INCLUDE,
    });
  }

  /** Cập nhật User (fullName/status/role) và Employee (các field hồ sơ) trong transaction. */
  async updateWithUser(
    tx: Prisma.TransactionClient,
    employeeId: string,
    userId: string,
    data: UpdateEmployeeData,
  ): Promise<EmployeeWithRelations> {
    const userData: Prisma.UserUpdateInput = {};
    if (data.fullName !== undefined) userData.fullName = data.fullName;
    if (data.userStatus !== undefined) userData.status = data.userStatus;
    if (data.roleId !== undefined) userData.role = { connect: { id: data.roleId } };
    if (Object.keys(userData).length > 0) {
      userData.updatedBy = data.actorUserId;
      await tx.user.update({ where: { id: userId }, data: userData });
    }

    const employeeData: Prisma.EmployeeUpdateInput = {
      updatedBy: data.actorUserId,
      ...(data.employeeStatus !== undefined ? { status: data.employeeStatus } : {}),
      ...(data.larkAccount !== undefined ? { larkAccount: data.larkAccount } : {}),
      ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
      ...(data.resignedAt !== undefined ? { resignedAt: data.resignedAt } : {}),
      ...(data.cccd !== undefined ? { cccd: data.cccd } : {}),
      ...(data.cccdImageUrl !== undefined ? { cccdImageUrl: data.cccdImageUrl } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth } : {}),
      ...(data.address !== undefined ? { address: data.address } : {}),
      ...(data.department !== undefined ? { department: data.department } : {}),
      ...(data.bankAccount !== undefined ? { bankAccount: data.bankAccount } : {}),
      ...(data.bankQrUrl !== undefined ? { bankQrUrl: data.bankQrUrl } : {}),
      ...(data.salary !== undefined ? { salary: data.salary } : {}),
      ...(data.orderKpi !== undefined ? { orderKpi: data.orderKpi } : {}),
      ...(data.revenueKpi !== undefined ? { revenueKpi: data.revenueKpi } : {}),
      ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
    };

    return tx.employee.update({
      where: { id: employeeId },
      data: employeeData,
      include: EMPLOYEE_INCLUDE,
    });
  }

  /** Cập nhật mật khẩu (hash) của tài khoản User gắn với Employee. Không lưu plaintext. */
  async updateUserPassword(
    userId: string,
    passwordHash: string,
    actorUserId: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date(), updatedBy: actorUserId },
    });
  }

  /** Soft delete: đánh dấu deleted_at cho cả Employee và User (chặn login). */
  async softDelete(
    tx: Prisma.TransactionClient,
    employeeId: string,
    userId: string,
    actorUserId: string,
  ): Promise<void> {
    const now = new Date();
    await tx.employee.update({
      where: { id: employeeId },
      data: { deletedAt: now, updatedBy: actorUserId },
    });
    await tx.user.update({
      where: { id: userId },
      data: { deletedAt: now, updatedBy: actorUserId },
    });
  }

  async findMany(
    organizationId: string,
    params: FindManyParams,
  ): Promise<{ items: EmployeeWithRelations[]; total: number }> {
    const userFilter = this.buildUserFilter(params);
    const where: Prisma.EmployeeWhereInput = {
      organizationId,
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(params.department ? { department: { contains: params.department, mode: 'insensitive' } } : {}),
      ...(params.startDate ? { startDate: { gte: params.startDate } } : {}),
      ...(Object.keys(userFilter).length > 0 ? { user: userFilter } : {}),
      ...(params.search
        ? {
            OR: [
              { user: { fullName: { contains: params.search, mode: 'insensitive' } } },
              { user: { email: { contains: params.search } } },
              { phone: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include: EMPLOYEE_INCLUDE,
        orderBy: this.buildOrderBy(params.sortBy, params.sortOrder),
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, total };
  }

  private buildUserFilter(params: FindManyParams): Prisma.UserWhereInput {
    const user: Prisma.UserWhereInput = {};
    if (params.roleId) user.roleId = params.roleId;
    if (params.fullname) user.fullName = { contains: params.fullname, mode: 'insensitive' };
    if (params.email) user.email = { contains: params.email };
    return user;
  }

  private buildOrderBy(
    sortBy: EmployeeSortField,
    sortOrder: 'asc' | 'desc',
  ): Prisma.EmployeeOrderByWithRelationInput {
    switch (sortBy) {
      case 'fullName':
        return { user: { fullName: sortOrder } };
      case 'email':
        return { user: { email: sortOrder } };
      case 'status':
        return { status: sortOrder };
      case 'salary':
        return { salary: sortOrder };
      case 'startDate':
        return { startDate: sortOrder };
      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }
}
