import { Injectable } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../database/prisma.service';

/**
 * UserService — thao tác User phục vụ Register (tìm theo email, hash password, tạo admin).
 */
@Injectable()
export class UserService {
  private readonly BCRYPT_COST = 12; // Decision-003

  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
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
}
