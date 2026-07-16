import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';
import { InvalidCredentialsException } from '../../auth/exceptions/invalid-credentials.exception';
import { TokenInvalidException } from '../../auth/exceptions/token-invalid.exception';
import { UserService } from '../../auth/services/user.service';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ProfileResponseDto } from '../dto/profile-response.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';

const PROFILE_INCLUDE = {
  role: true,
  organization: true,
  employee: true,
} as const satisfies Prisma.UserInclude;

type UserWithProfile = Prisma.UserGetPayload<{ include: typeof PROFILE_INCLUDE }>;

function toDateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * ProfileService — self-service cho người dùng đăng nhập (đặc biệt role EMPLOYEE).
 *
 * Chỉ thao tác trên CHÍNH user (theo userId từ token) → không đụng employee khác,
 * không sửa role/status/organization/permission. Tái sử dụng UserService.hashPassword;
 * không lặp lại logic Employee Management.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

  async getMe(userId: string): Promise<ProfileResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: PROFILE_INCLUDE,
    });
    if (!user) throw new TokenInvalidException();
    return this.toResponse(user);
  }

  /** Cập nhật thông tin cá nhân: User.fullName + các field cá nhân của Employee (nếu có hồ sơ). */
  async updateMe(userId: string, dto: UpdateProfileDto): Promise<ProfileResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { employee: true },
    });
    if (!user) throw new TokenInvalidException();

    await this.prisma.$transaction(async (tx) => {
      if (dto.fullName !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { fullName: dto.fullName, updatedBy: userId },
        });
      }

      if (user.employee) {
        await tx.employee.update({
          where: { id: user.employee.id },
          data: {
            updatedBy: userId,
            ...(dto.avatar !== undefined ? { avatar: dto.avatar } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            ...(dto.dateOfBirth !== undefined ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}),
            ...(dto.address !== undefined ? { address: dto.address } : {}),
            ...(dto.larkAccount !== undefined ? { larkAccount: dto.larkAccount } : {}),
            ...(dto.bankAccount !== undefined ? { bankAccount: dto.bankAccount } : {}),
            ...(dto.bankQrUrl !== undefined ? { bankQrUrl: dto.bankQrUrl } : {}),
          },
        });
      }
    });

    return this.getMe(userId);
  }

  /** Đổi mật khẩu của chính mình: verify current → hash new (UserService) → update. */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Xác nhận mật khẩu không khớp',
        errors: [{ field: 'confirmPassword', message: 'Xác nhận mật khẩu không khớp' }],
      });
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
        errors: [{ field: 'newPassword', message: 'Mật khẩu mới phải khác mật khẩu hiện tại' }],
      });
    }

    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new TokenInvalidException();

    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) throw new InvalidCredentialsException();

    const passwordHash = await this.userService.hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date(), updatedBy: userId },
    });
  }

  private toResponse(user: UserWithProfile): ProfileResponseDto {
    const emp = user.employee;
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      role: { id: user.role.id, code: user.role.code, name: user.role.displayName },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
      },
      avatar: emp?.avatar ?? null,
      phone: emp?.phone ?? null,
      dateOfBirth: toDateString(emp?.dateOfBirth),
      address: emp?.address ?? null,
      larkAccount: emp?.larkAccount ?? null,
      bankAccount: emp?.bankAccount ?? null,
      bankQrUrl: emp?.bankQrUrl ?? null,
      department: emp?.department ?? null,
      cccd: emp?.cccd ?? null,
      startDate: toDateString(emp?.startDate),
      salary: emp ? Number(emp.salary) : null,
    };
  }
}
