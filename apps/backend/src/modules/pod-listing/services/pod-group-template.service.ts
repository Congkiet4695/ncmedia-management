import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type {
  CreateGroupTemplateDto,
  PodTemplateQueryDto,
  UpdateGroupTemplateDto,
} from '../dto/pod-template.dto';
import { PodImageTemplateService } from './pod-image-template.service';
import { PodTemplateService } from './pod-template.service';

export class PodGroupTemplateNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_GROUP_TEMPLATE_NOT_FOUND', message: 'Không tìm thấy Group Template' });
  }
}

/** Tên đã có group khác dùng (so không phân biệt hoa thường). */
export class PodGroupTemplateNameTakenException extends ConflictException {
  constructor(name: string) {
    super({
      code: 'POD_GROUP_TEMPLATE_NAME_TAKEN',
      message: `Đã có Group Template tên "${name}" — hãy đặt tên khác.`,
    });
  }
}

/** Bốn mảnh mà một Group Template ghép lại — thứ tự đúng thứ tự áp vào listing. */
export const GROUP_TEMPLATE_PARTS = [
  'categoryTemplateId',
  'skuTemplateId',
  'descriptionTemplateId',
  'imageTemplateId',
] as const;
type GroupPart = (typeof GROUP_TEMPLATE_PARTS)[number];
type GroupParts = Record<GroupPart, string | null>;

/**
 * `deletedAt`: quan hệ KHÔNG lọc bản đã xoá mềm ⇒ form sửa group nhận ra mảnh đã bị xoá và báo người dùng
 * chọn lại (lưu với mảnh đã xoá bị `assertReferencesValid` chặn).
 *
 * Phần tóm tắt của từng mảnh — đủ để bảng danh sách và bộ chọn hiển thị "group này gồm
 * những gì" (đường dẫn danh mục, số SKU, số ảnh) mà không kéo cả bảng SKU 500 dòng về.
 */
export const GROUP_TEMPLATE_SUMMARY_INCLUDE = {
  categoryTemplate: {
    select: {
      id: true,
      name: true,
      market: true,
      tiktokCategoryId: true,
      categoryName: true,
      categoryPath: true,
      isActive: true,
      deletedAt: true,
    },
  },
  skuTemplate: {
    select: {
      id: true,
      name: true,
      currency: true,
      isActive: true,
      deletedAt: true,
      variants: { select: { name: true }, orderBy: { sortOrder: 'asc' } },
      _count: { select: { items: true } },
    },
  },
  descriptionTemplate: { select: { id: true, name: true, isActive: true, deletedAt: true } },
  imageTemplate: {
    select: { id: true, name: true, isActive: true, deletedAt: true, _count: { select: { items: true } } },
  },
  // Số lượt đăng (chưa xoá) đang ghi nhận group này — để hộp thoại xoá nói rõ hệ quả.
  _count: { select: { listingSessions: { where: { deletedAt: null } } } },
} satisfies Prisma.PodGroupTemplateInclude;

export type GroupTemplateSummary = Prisma.PodGroupTemplateGetPayload<{
  include: typeof GROUP_TEMPLATE_SUMMARY_INCLUDE;
}>;

/**
 * PodGroupTemplateService — **Group Template**: bộ 4 mảnh Category · SKU · Description ·
 * Image có tên, áp vào Auto Listing / Custom Listing bằng một lần chọn.
 *
 * Quy tắc được thực thi ở đây:
 *  - Mọi mảnh phải THUỘC CÙNG Organization và chưa bị xoá (chống tham chiếu chéo tenant).
 *  - Có ít nhất một mảnh — group rỗng không áp được gì.
 *  - Tên duy nhất trong Organization (không phân biệt hoa thường) để bộ chọn không có hai
 *    dòng trông y hệt nhau.
 *  - Xoá = xoá MỀM. Lượt đăng chỉ giữ group làm nhãn "đã áp từ đâu" (kèm ảnh chụp tên);
 *    dữ liệu thật của lượt nằm ở template con riêng của nó nên không hỏng khi group mất.
 *
 * 🔴 Group CHỈ lưu tham chiếu, không chép nội dung template con: áp group là đọc bản MỚI
 * NHẤT của template con lúc đó (`getResolved`). Sửa group không lan sang listing đã lưu.
 */
@Injectable()
export class PodGroupTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: PodTemplateService,
    private readonly images: PodImageTemplateService,
  ) {}

  async list(organizationId: string, query: PodTemplateQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PodGroupTemplateWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.activeOnly ? { isActive: true } : {}),
      // Thị trường của group = thị trường của Category Template của nó.
      ...(query.market ? { categoryTemplate: { market: query.market } } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const sortBy = query.sortBy ?? 'displayOrder';
    const sortOrder = query.sortOrder ?? 'asc';
    // Luôn kèm `name` làm tiêu chí phụ — cùng lý do với các loại template khác.
    const orderBy: Prisma.PodGroupTemplateOrderByWithRelationInput[] =
      sortBy === 'name' ? [{ name: sortOrder }] : [{ [sortBy]: sortOrder }, { name: 'asc' }];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podGroupTemplate.findMany({
        where,
        include: GROUP_TEMPLATE_SUMMARY_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podGroupTemplate.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async get(
    organizationId: string,
    id: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<GroupTemplateSummary> {
    const group = await client.podGroupTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: GROUP_TEMPLATE_SUMMARY_INCLUDE,
    });
    if (!group) throw new PodGroupTemplateNotFoundException();
    return group;
  }

  /**
   * Group + BẢN ĐẦY ĐỦ của từng mảnh — đúng thứ màn hình listing cần để áp, trong MỘT
   * request thay vì 4 lời gọi rời.
   *
   * 🔴 Đọc qua CHÍNH các hàm `get*` của từng loại template (không tự viết include riêng):
   * hình dạng dữ liệu trùng khít với `GET /pod/templates/{categories|skus|…}/:id`, nên
   * frontend áp group bằng đúng hàm đang dùng để áp từng template lẻ — kể cả giá hiệu lực
   * của SKU do server tính (`effectiveSalePrice`).
   */
  async getResolved(organizationId: string, id: string) {
    const group = await this.get(organizationId, id);
    const [categoryTemplate, skuTemplate, descriptionTemplate, imageTemplate] = await Promise.all([
      group.categoryTemplateId
        ? this.templates.getCategoryTemplate(organizationId, group.categoryTemplateId)
        : null,
      group.skuTemplateId ? this.templates.getSkuTemplate(organizationId, group.skuTemplateId) : null,
      group.descriptionTemplateId
        ? this.templates.getDescriptionTemplate(organizationId, group.descriptionTemplateId)
        : null,
      group.imageTemplateId ? this.images.get(organizationId, group.imageTemplateId) : null,
    ]);

    return {
      id: group.id,
      name: group.name,
      market: group.categoryTemplate?.market ?? null,
      updatedAt: group.updatedAt,
      categoryTemplate,
      skuTemplate,
      descriptionTemplate,
      imageTemplate,
    };
  }

  async create(organizationId: string, userId: string, dto: CreateGroupTemplateDto) {
    const parts = this.partsOf(dto);
    this.assertHasPart(parts);
    await this.assertReferencesValid(organizationId, parts);
    await this.assertNameAvailable(organizationId, dto.name);

    const created = await this.withNameConflict(dto.name, () =>
      this.prisma.podGroupTemplate.create({
        data: {
          organizationId,
          name: dto.name,
          ...parts,
          displayOrder: dto.displayOrder ?? 0,
          note: dto.note || null,
          createdBy: userId,
          updatedBy: userId,
        },
        select: { id: true },
      }),
    );
    return this.get(organizationId, created.id);
  }

  async update(organizationId: string, userId: string, id: string, dto: UpdateGroupTemplateDto) {
    const current = await this.get(organizationId, id);

    // `undefined` = giữ nguyên mảnh hiện có; `null` = gỡ ra. Kiểm "còn ít nhất một mảnh" trên
    // KẾT QUẢ sau khi gộp — không phải trên riêng payload.
    const parts: GroupParts = {
      categoryTemplateId: current.categoryTemplateId,
      skuTemplateId: current.skuTemplateId,
      descriptionTemplateId: current.descriptionTemplateId,
      imageTemplateId: current.imageTemplateId,
    };
    for (const key of GROUP_TEMPLATE_PARTS) {
      if (dto[key] !== undefined) parts[key] = dto[key] ?? null;
    }
    this.assertHasPart(parts);
    await this.assertReferencesValid(organizationId, parts);
    if (dto.name.toLowerCase() !== current.name.toLowerCase()) {
      await this.assertNameAvailable(organizationId, dto.name, id);
    }

    await this.withNameConflict(dto.name, () =>
      this.prisma.podGroupTemplate.update({
        where: { id },
        data: {
          name: dto.name,
          ...parts,
          ...(dto.displayOrder === undefined ? {} : { displayOrder: dto.displayOrder }),
          ...(dto.note === undefined ? {} : { note: dto.note || null }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
          updatedBy: userId,
        },
      }),
    );
    return this.get(organizationId, id);
  }

  /**
   * Nhân bản — cùng 4 mảnh, tên mới. Không đặt tên thì lấy "<tên> (copy)", trùng nữa thì
   * "(copy 2)", "(copy 3)"… (tên group là duy nhất). Tên người dùng tự đặt mà trùng ⇒ 409.
   */
  async clone(organizationId: string, userId: string, id: string, name?: string) {
    const source = await this.get(organizationId, id);
    const parts = {
      categoryTemplateId: source.categoryTemplateId,
      skuTemplateId: source.skuTemplateId,
      descriptionTemplateId: source.descriptionTemplateId,
      imageTemplateId: source.imageTemplateId,
    };
    return this.create(organizationId, userId, {
      name: name?.trim() || (await this.freeCopyName(organizationId, source.name)),
      ...parts,
      displayOrder: source.displayOrder,
      note: source.note,
    });
  }

  /**
   * Xoá MỀM. Không chặn khi đang có lượt đăng ghi nhận group: lượt đăng chỉ dùng group làm
   * nhãn (có ảnh chụp tên), dữ liệu đăng nằm ở template con riêng của nó — xoá group không
   * làm hỏng hay đổi listing nào. Trả về số lượt đăng đang ghi nhận để màn hình báo lại.
   */
  async remove(organizationId: string, userId: string, id: string) {
    const group = await this.get(organizationId, id);
    await this.prisma.podGroupTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
    return { id, referencedSessions: group._count.listingSessions };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private partsOf(dto: CreateGroupTemplateDto): GroupParts {
    return {
      categoryTemplateId: dto.categoryTemplateId ?? null,
      skuTemplateId: dto.skuTemplateId ?? null,
      descriptionTemplateId: dto.descriptionTemplateId ?? null,
      imageTemplateId: dto.imageTemplateId ?? null,
    };
  }

  private assertHasPart(parts: GroupParts): void {
    if (GROUP_TEMPLATE_PARTS.some((key) => parts[key])) return;
    throw new BadRequestException({
      code: 'POD_GROUP_TEMPLATE_EMPTY',
      message: 'Group Template phải có ít nhất một trong: Category, SKU, Description, Image.',
    });
  }

  /** Mỗi mảnh phải tồn tại, chưa xoá và thuộc ĐÚNG Organization. */
  private async assertReferencesValid(organizationId: string, parts: GroupParts): Promise<void> {
    const where = (id: string) => ({ id, organizationId, deletedAt: null });
    const checks: Array<[string | null, (id: string) => Promise<number>, string]> = [
      [
        parts.categoryTemplateId,
        (id) => this.prisma.podCategoryTemplate.count({ where: where(id) }),
        'Category Template',
      ],
      [
        parts.skuTemplateId,
        (id) => this.prisma.podSkuTemplate.count({ where: where(id) }),
        'SKU Template',
      ],
      [
        parts.descriptionTemplateId,
        (id) => this.prisma.podDescriptionTemplate.count({ where: where(id) }),
        'Description Template',
      ],
      [
        parts.imageTemplateId,
        (id) => this.prisma.podImageTemplate.count({ where: where(id) }),
        'Image Template',
      ],
    ];

    for (const [id, count, label] of checks) {
      if (!id) continue;
      if ((await count(id)) === 0) {
        throw new BadRequestException({
          code: 'POD_GROUP_TEMPLATE_INVALID_REF',
          message: `${label} không tồn tại hoặc không thuộc tổ chức này.`,
        });
      }
    }
  }

  private async assertNameAvailable(
    organizationId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await this.prisma.podGroupTemplate.count({
      where: {
        organizationId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (taken > 0) throw new PodGroupTemplateNameTakenException(name);
  }

  /** Tên bản sao chưa ai dùng: "<tên> (copy)", rồi "(copy 2)", "(copy 3)"… */
  private async freeCopyName(organizationId: string, sourceName: string): Promise<string> {
    const MAX_ATTEMPTS = 50;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const suffix = attempt === 1 ? ' (copy)' : ` (copy ${attempt})`;
      // Cắt tên gốc để tên mới vẫn trong giới hạn 255 ký tự của cột.
      const candidate = `${sourceName.slice(0, 255 - suffix.length)}${suffix}`;
      const taken = await this.prisma.podGroupTemplate.count({
        where: {
          organizationId,
          deletedAt: null,
          name: { equals: candidate, mode: 'insensitive' },
        },
      });
      if (taken === 0) return candidate;
    }
    throw new PodGroupTemplateNameTakenException(`${sourceName} (copy)`);
  }

  /**
   * Hai request tạo cùng tên chạy song song đều qua được `assertNameAvailable`; index duy
   * nhất từng phần ở DB chặn bản thứ hai (P2002) — báo đúng lỗi trùng tên thay vì 500.
   */
  private async withNameConflict<T>(name: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PodGroupTemplateNameTakenException(name);
      }
      throw error;
    }
  }
}
