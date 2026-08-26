import { Injectable } from '@nestjs/common';
import { OrganizationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/**
 * OrganizationService — tạo Organization + sinh slug hợp lệ (^[a-z0-9-]+$).
 * Chỉ phục vụ Register ở giai đoạn này (không CRUD đầy đủ).
 */
@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sinh slug duy nhất từ tên tổ chức (khớp regex ^[a-z0-9-]+$). */
  async generateUniqueSlug(name: string): Promise<string> {
    const base = this.slugify(name) || 'org';
    let slug = base;
    let counter = 1;
    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      counter += 1;
      slug = `${base}-${counter}`;
    }
    return slug;
  }

  /**
   * Tạo Organization trong transaction.
   *
   * 🔴 `status` mặc định là **PENDING**: mọi Organization đăng ký qua form đều phải chờ Super
   * Admin duyệt. Giá trị mặc định của cột trong database vẫn là ACTIVE — cố ý, để migration
   * không đụng tới Organization đang chạy; ranh giới nằm ở đúng dòng này.
   */
  createInTransaction(
    tx: Prisma.TransactionClient,
    data: { name: string; slug: string; status?: OrganizationStatus },
  ) {
    return tx.organization.create({
      data: {
        name: data.name,
        slug: data.slug,
        status: data.status ?? OrganizationStatus.PENDING,
      },
    });
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/đ/g, 'd') // đ -> d
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // bỏ dấu tổ hợp (diacritics)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
  }
}
