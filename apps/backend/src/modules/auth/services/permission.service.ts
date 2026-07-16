import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/**
 * PermissionService — đọc Permission catalog (global). Catalog được seed
 * riêng bằng prisma/seed.ts; ở Register ta chỉ lấy id để gán cho Role ADMIN.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lấy toàn bộ permission id trong transaction (để gán cho ADMIN). */
  async findAllIdsInTransaction(tx: Prisma.TransactionClient): Promise<string[]> {
    const rows = await tx.permission.findMany({ select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Lấy permission id theo danh sách code (để gán subset cho Role EMPLOYEE). */
  async findIdsByCodesInTransaction(
    tx: Prisma.TransactionClient,
    codes: readonly string[],
  ): Promise<string[]> {
    if (codes.length === 0) return [];
    const rows = await tx.permission.findMany({
      where: { code: { in: [...codes] } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  findAll() {
    return this.prisma.permission.findMany();
  }
}
