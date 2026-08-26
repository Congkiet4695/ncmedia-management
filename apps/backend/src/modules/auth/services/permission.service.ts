import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PLATFORM_PERMISSION_PREFIX } from '../constants/default-roles';

/**
 * PermissionService — đọc Permission catalog (global). Catalog được seed
 * riêng bằng prisma/seed.ts; ở Register ta chỉ lấy id để gán cho Role ADMIN.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Permission id cấp cho Role ADMIN của MỘT Organization (BR-18) — **trừ nhóm nền tảng**.
   *
   * 🔴 Tên vẫn là `findAllIds…` nhưng "all" ở đây là "toàn bộ quyền TRONG PHẠM VI một
   * Organization". Quyền `platform.*` (duyệt/từ chối Organization) thuộc phạm vi NỀN TẢNG và
   * chỉ Role SUPER_ADMIN được giữ. Bỏ bộ lọc này thì mỗi lần có người đăng ký mới, hệ thống
   * lại tự cấp cho họ quyền duyệt hồ sơ của mọi tổ chức khác.
   */
  async findAllIdsInTransaction(tx: Prisma.TransactionClient): Promise<string[]> {
    const rows = await tx.permission.findMany({
      where: { NOT: { code: { startsWith: PLATFORM_PERMISSION_PREFIX } } },
      select: { id: true },
    });
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
