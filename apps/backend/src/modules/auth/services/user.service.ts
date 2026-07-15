import { Injectable } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';

/** User kèm Role (dùng cho Login — cần role.code để nhúng vào JWT). */
export type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

/**
 * UserService — thao tác User phục vụ Register và Login.
 *  - Register: tìm theo email, hash password, tạo admin.
 *  - Login: tìm theo email (kèm role), đếm/khóa đăng nhập sai, reset, cập nhật last_login.
 */
@Injectable()
export class UserService {
  private readonly BCRYPT_COST = 12; // Decision-003
  private readonly LOCK_DURATION_MS = 15 * 60 * 1000; // 15 phút (Decision-004)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tìm User theo email (UNIQUE GLOBAL) kèm Role.
   * Trả cả bản ghi soft-deleted — việc loại `deleted_at` do tầng gọi xử lý
   * (Login coi soft-deleted như không tồn tại — BR-L03).
   */
  findByEmail(email: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { email }, include: { role: true } });
  }

  hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.BCRYPT_COST);
  }

  /** Tạo User (admin đầu tiên) trong transaction. Nhận passwordHash đã băm sẵn. */
  createAdminInTransaction(
    tx: Prisma.TransactionClient,
    data: { organizationId: string; roleId: string; email: string; passwordHash: string; fullName: string },
  ): Promise<User> {
    return tx.user.create({
      data: {
        organizationId: data.organizationId,
        roleId: data.roleId,
        email: data.email,
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        status: UserStatus.ACTIVE, // Decision-017
      },
    });
  }

  /**
   * Ghi nhận một lần đăng nhập sai (BR-L07). Tăng `failed_login_count`.
   * Nếu `lock=true` (chuỗi sai đã đạt ngưỡng) → set `locked_until = now + 15'`.
   * Chạy ngoài transaction (failure path).
   */
  async increaseFailedLogin(userId: string, lock: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: { increment: 1 },
        ...(lock ? { lockedUntil: new Date(Date.now() + this.LOCK_DURATION_MS) } : {}),
      },
    });
  }

  /** Login thành công → reset `failed_login_count` và xóa `locked_until` (BR-L08). Trong transaction. */
  resetFailedLogin(tx: Prisma.TransactionClient, userId: string): Promise<User> {
    return tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  /** Login thành công → cập nhật `last_login_at = now` (BR-L08). Trong transaction. */
  updateLastLogin(tx: Prisma.TransactionClient, userId: string): Promise<User> {
    return tx.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }
}
