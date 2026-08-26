import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PodImageAssetType, Prisma, StorageModuleName, StorageReferenceType } from '@prisma/client';
import { imageSize } from 'image-size';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  POD_IMAGE_TEMPLATE_ALLOWED_MIME_TYPES,
  POD_IMAGE_TEMPLATE_MAX_ITEMS,
  type PodTemplateSortField,
} from '../constants/pod-listing.constants';
import type {
  CreateImageTemplateDto,
  PodTemplateQueryDto,
  SortImageItemsDto,
  UpdateImageItemDto,
  UpdateImageTemplateDto,
  UploadImageItemsDto,
} from '../dto/pod-template.dto';

export class PodImageTemplateNotFoundException extends NotFoundException {
  constructor(kind = 'Image Template') {
    super({ code: 'POD_TEMPLATE_NOT_FOUND', message: `Không tìm thấy ${kind}` });
  }
}

/** Include đầy đủ — gallery cần ảnh theo đúng thứ tự hiển thị. */
export const IMAGE_TEMPLATE_INCLUDE = {
  items: { orderBy: { displayOrder: 'asc' } },
} satisfies Prisma.PodImageTemplateInclude;

type PrismaReader = PrismaService | Prisma.TransactionClient;

/**
 * PodImageTemplateService — **thư viện ảnh mẫu (mockup) của phôi**.
 *
 * ```
 *   Comfort Colors
 *     ├── Front Mockup      MAIN_FRONT
 *     ├── Back Mockup       MAIN_BACK
 *     ├── Lifestyle 1..3    LIFESTYLE
 *     ├── Size Chart        SIZE_CHART
 *     └── Care Instruction  CUSTOM
 * ```
 *
 * 🔴 Đây là ảnh CỐ ĐỊNH của phôi, upload một lần rồi dùng cho hàng nghìn listing. Không
 * phải ảnh sản phẩm, không lấy từ ảnh sản phẩm, không render gì ở bước này.
 *
 * File nằm trên Cloudflare R2 và **luôn đi qua `StorageService`** — module này không tự
 * gọi R2, không tự ghi đĩa. Bảng `pod_image_template_items` chép sẵn `imageUrl`/`imageKey`
 * để lúc sinh listing hàng loạt khỏi phải join sang `storage_files`.
 */
@Injectable()
export class PodImageTemplateService {
  private readonly logger = new Logger(PodImageTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // =========================================================================
  // Template
  // =========================================================================

  async list(organizationId: string, query: PodTemplateQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy: PodTemplateSortField = query.sortBy ?? 'displayOrder';
    const sortOrder = query.sortOrder ?? 'asc';

    const where: Prisma.PodImageTemplateWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(query.defaultOnly ? { isDefault: true } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.podImageTemplate.findMany({
        where,
        include: { ...IMAGE_TEMPLATE_INCLUDE, _count: { select: { listingTemplates: true } } },
        orderBy:
          sortBy === 'name' ? [{ name: sortOrder }] : [{ [sortBy]: sortOrder }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.podImageTemplate.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async get(organizationId: string, id: string, client: PrismaReader = this.prisma) {
    const template = await client.podImageTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: IMAGE_TEMPLATE_INCLUDE,
    });
    if (!template) throw new PodImageTemplateNotFoundException();
    return template;
  }

  async create(organizationId: string, userId: string, dto: CreateImageTemplateDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, organizationId);

      const created = await tx.podImageTemplate.create({
        data: {
          organizationId,
          name: dto.name,
          description: dto.description,
          isDefault: dto.isDefault ?? false,
          displayOrder: dto.displayOrder ?? 0,
          createdBy: userId,
        },
        select: { id: true },
      });

      return this.get(organizationId, created.id, tx);
    });
  }

  async update(organizationId: string, userId: string, id: string, dto: UpdateImageTemplateDto) {
    await this.get(organizationId, id);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, organizationId, id);

      await tx.podImageTemplate.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          displayOrder: dto.displayOrder ?? 0,
          updatedBy: userId,
        },
      });

      return this.get(organizationId, id, tx);
    });
  }

  /** Đặt làm bộ ảnh mặc định (chỉ MỘT bộ mặc định mỗi tổ chức). */
  async setDefault(organizationId: string, userId: string, id: string) {
    await this.get(organizationId, id);

    return this.prisma.$transaction(async (tx) => {
      await this.clearDefault(tx, organizationId, id);
      await tx.podImageTemplate.update({
        where: { id },
        data: { isDefault: true, updatedBy: userId },
      });
      return this.get(organizationId, id, tx);
    });
  }

  /**
   * Nhân bản bộ ảnh.
   *
   * Ảnh **dùng lại chính file trên R2**, không upload lại: hai bộ trỏ cùng một object là
   * đúng ý nghĩa "cùng tấm mockup", và tiết kiệm cả dung lượng lẫn thời gian. Việc xoá
   * ảnh có đếm tham chiếu nên bản sao không làm hỏng bản gốc.
   */
  async clone(organizationId: string, userId: string, id: string, name?: string) {
    const source = await this.get(organizationId, id);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.podImageTemplate.create({
        data: {
          organizationId,
          name: name?.trim() || `${source.name} (copy)`,
          description: source.description,
          displayOrder: source.displayOrder,
          // Bản sao KHÔNG kế thừa cờ mặc định: hai bộ cùng mặc định thì cái nào thắng?
          isDefault: false,
          createdBy: userId,
        },
        select: { id: true },
      });

      if (source.items.length > 0) {
        await tx.podImageTemplateItem.createMany({
          data: source.items.map((item) => ({
            organizationId,
            imageTemplateId: created.id,
            title: item.title,
            assetType: item.assetType,
            fileId: item.fileId,
            imageUrl: item.imageUrl,
            imageKey: item.imageKey,
            contentType: item.contentType,
            fileSize: item.fileSize,
            width: item.width,
            height: item.height,
            isRequired: item.isRequired,
            displayOrder: item.displayOrder,
          })),
        });
      }

      return this.get(organizationId, created.id, tx);
    });
  }

  async remove(organizationId: string, userId: string, id: string): Promise<void> {
    await this.get(organizationId, id);

    const used = await this.prisma.podListingTemplate.count({
      where: { imageTemplateId: id, organizationId, deletedAt: null },
    });
    if (used > 0) {
      throw new BadRequestException({
        code: 'POD_TEMPLATE_IN_USE',
        message: `Bộ ảnh đang được ${used} Listing Template sử dụng — gỡ khỏi Listing Template trước khi xoá.`,
      });
    }

    // Xoá mềm bộ ảnh; ảnh trên R2 giữ nguyên để còn khôi phục được.
    await this.prisma.podImageTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  // =========================================================================
  // Ảnh trong bộ
  // =========================================================================

  /**
   * Upload NHIỀU ảnh một lần (front.jpg, back.jpg, life-1.jpg…).
   *
   * Mỗi ảnh: đẩy lên R2 qua Storage Module → đọc kích thước → tạo một dòng nối tiếp cuối
   * danh sách. Tiêu đề mặc định lấy từ TÊN FILE (bỏ đuôi) — upload 6 ảnh xong là đã có 6
   * dòng đọc được ngay, không phải gõ lại tên từng cái.
   */
  async uploadItems(
    organizationId: string,
    userId: string,
    templateId: string,
    files: Express.Multer.File[] | undefined,
    dto: UploadImageItemsDto,
  ) {
    const template = await this.get(organizationId, templateId);
    if (!files?.length) {
      throw new BadRequestException({
        code: 'POD_IMAGE_TEMPLATE_NO_FILE',
        message: 'Chưa chọn ảnh nào để tải lên.',
      });
    }
    if (template.items.length + files.length > POD_IMAGE_TEMPLATE_MAX_ITEMS) {
      throw new BadRequestException({
        code: 'POD_IMAGE_TEMPLATE_TOO_MANY_ITEMS',
        message: `Một bộ ảnh tối đa ${POD_IMAGE_TEMPLATE_MAX_ITEMS} ảnh.`,
      });
    }
    for (const file of files) this.assertImage(file);

    // Loại ảnh và tiêu đề gửi kèm theo ĐÚNG THỨ TỰ file; thiếu thì dùng mặc định.
    const assetTypes = dto.assetTypes ?? [];
    const titles = dto.titles ?? [];
    let order = template.items.length;

    for (const [index, file] of files.entries()) {
      const stored = await this.storage.upload(file, {
        organizationId,
        actorUserId: userId,
        module: StorageModuleName.POD_TIKTOK,
        referenceType: StorageReferenceType.POD_LISTING_ASSET,
        referenceId: templateId,
        folderSegments: ['image-templates', templateId],
      });

      const dimensions = this.readDimensions(file);
      await this.prisma.podImageTemplateItem.create({
        data: {
          organizationId,
          imageTemplateId: templateId,
          title: (titles[index]?.trim() || this.titleFromFileName(file.originalname)).slice(0, 255),
          assetType: assetTypes[index] ?? dto.assetType ?? PodImageAssetType.CUSTOM,
          fileId: stored.id,
          imageUrl: stored.publicUrl ?? '',
          imageKey: stored.objectKey,
          contentType: stored.mimeType,
          fileSize: stored.fileSize,
          width: dimensions?.width ?? null,
          height: dimensions?.height ?? null,
          displayOrder: order++,
        },
      });
    }

    this.logger.log({
      module: 'pod-listing',
      operation: 'imageTemplate.upload',
      organizationId,
      imageTemplateId: templateId,
      files: files.length,
      msg: 'Đã tải ảnh vào bộ ảnh mẫu',
    });

    return this.get(organizationId, templateId);
  }

  /** Sửa thông tin một ảnh (tiêu đề, loại, bắt buộc) — không đụng tới file. */
  async updateItem(
    organizationId: string,
    templateId: string,
    itemId: string,
    dto: UpdateImageItemDto,
  ) {
    await this.getItem(organizationId, templateId, itemId);

    await this.prisma.podImageTemplateItem.update({
      where: { id: itemId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.assetType !== undefined ? { assetType: dto.assetType } : {}),
        ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
      },
    });

    return this.get(organizationId, templateId);
  }

  /**
   * Thay ảnh của một dòng — giữ nguyên tiêu đề, loại và vị trí.
   *
   * Chụp lại mockup thì chỉ đổi file, không phải xoá rồi thêm lại rồi kéo về đúng chỗ.
   * File cũ được dọn nếu không còn bộ ảnh nào dùng.
   */
  async replaceItemFile(
    organizationId: string,
    userId: string,
    templateId: string,
    itemId: string,
    file: Express.Multer.File | undefined,
  ) {
    const item = await this.getItem(organizationId, templateId, itemId);
    if (!file) {
      throw new BadRequestException({
        code: 'POD_IMAGE_TEMPLATE_NO_FILE',
        message: 'Chưa chọn ảnh thay thế.',
      });
    }
    this.assertImage(file);

    const stored = await this.storage.upload(file, {
      organizationId,
      actorUserId: userId,
      module: StorageModuleName.POD_TIKTOK,
      referenceType: StorageReferenceType.POD_LISTING_ASSET,
      referenceId: templateId,
      folderSegments: ['image-templates', templateId],
    });

    const dimensions = this.readDimensions(file);
    const previousFileId = item.fileId;

    await this.prisma.podImageTemplateItem.update({
      where: { id: itemId },
      data: {
        fileId: stored.id,
        imageUrl: stored.publicUrl ?? '',
        imageKey: stored.objectKey,
        contentType: stored.mimeType,
        fileSize: stored.fileSize,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        // Ảnh đổi ⇒ `uri` cũ phía TikTok không còn đúng nữa.
        tiktokImageUri: null,
        uploadedAt: null,
      },
    });

    await this.removeFileIfUnused(organizationId, userId, previousFileId);
    return this.get(organizationId, templateId);
  }

  /** Xoá một ảnh khỏi bộ và dọn file nếu không bộ nào khác dùng. */
  async removeItem(organizationId: string, userId: string, templateId: string, itemId: string) {
    const item = await this.getItem(organizationId, templateId, itemId);

    await this.prisma.podImageTemplateItem.delete({ where: { id: itemId } });
    await this.removeFileIfUnused(organizationId, userId, item.fileId);
    await this.compactOrder(templateId);

    return this.get(organizationId, templateId);
  }

  /**
   * Sắp xếp lại (kéo thả trên gallery).
   *
   * Nhận TRỌN danh sách id theo thứ tự mới. Ảnh không có trong danh sách bị đẩy xuống cuối
   * thay vì báo lỗi — người dùng kéo thả không nên bị chặn vì một dòng vừa được thêm ở tab
   * khác.
   */
  async sortItems(organizationId: string, templateId: string, dto: SortImageItemsDto) {
    const template = await this.get(organizationId, templateId);
    const known = new Set(template.items.map((item) => item.id));

    const ordered = dto.itemIds.filter((id) => known.has(id));
    const missing = template.items.map((item) => item.id).filter((id) => !ordered.includes(id));
    const finalOrder = [...ordered, ...missing];

    await this.prisma.$transaction(
      finalOrder.map((id, index) =>
        this.prisma.podImageTemplateItem.update({
          where: { id },
          data: { displayOrder: index },
        }),
      ),
    );

    return this.get(organizationId, templateId);
  }

  /**
   * Nạp lại ảnh từ gói Import — chỉ nhận những file **đang có trong tổ chức này**.
   *
   * Gói mang tham chiếu ảnh chứ không mang bytes: nạp trong cùng tổ chức thì dùng đúng ảnh
   * cũ, mang sang tổ chức khác thì ảnh không thuộc về họ nên bị bỏ (bên gọi báo cảnh báo).
   * Trả về số ảnh đã bỏ để người dùng biết mà tải mockup của mình lên.
   */
  async restoreItems(
    organizationId: string,
    templateId: string,
    rows: Array<{
      title: string;
      assetType: PodImageAssetType;
      fileId: string;
      imageUrl: string;
      imageKey: string;
      contentType: string;
      fileSize: number;
      width: number | null;
      height: number | null;
      isRequired: boolean;
      displayOrder: number;
    }>,
  ): Promise<{ created: number; skipped: number }> {
    if (rows.length === 0) return { created: 0, skipped: 0 };

    const existing = await this.prisma.storageFile.findMany({
      where: {
        id: { in: [...new Set(rows.map((row) => row.fileId))] },
        organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const usable = new Set(existing.map((file) => file.id));
    const kept = rows.filter((row) => usable.has(row.fileId));

    if (kept.length > 0) {
      await this.prisma.podImageTemplateItem.createMany({
        data: kept.map((row, index) => ({
          organizationId,
          imageTemplateId: templateId,
          title: row.title,
          assetType: row.assetType,
          fileId: row.fileId,
          imageUrl: row.imageUrl,
          imageKey: row.imageKey,
          contentType: row.contentType,
          fileSize: row.fileSize,
          width: row.width,
          height: row.height,
          isRequired: row.isRequired,
          displayOrder: index,
        })),
      });
    }

    return { created: kept.length, skipped: rows.length - kept.length };
  }

  // =========================================================================
  // Private
  // =========================================================================

  private async getItem(organizationId: string, templateId: string, itemId: string) {
    const item = await this.prisma.podImageTemplateItem.findFirst({
      where: { id: itemId, imageTemplateId: templateId, organizationId },
    });
    if (!item) throw new PodImageTemplateNotFoundException('ảnh trong bộ ảnh');
    return item;
  }

  /**
   * Chỉ nhận ảnh thật.
   *
   * Storage Module cho phép cả PDF/PSD (dùng cho file thiết kế), nhưng một tấm mockup PDF
   * thì listing không hiển thị được — chặn ngay tại đây thay vì để lỗi lộ ra lúc publish.
   */
  private assertImage(file: Express.Multer.File): void {
    if (!POD_IMAGE_TEMPLATE_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'POD_IMAGE_TEMPLATE_INVALID_TYPE',
        message: `"${file.originalname}" không phải ảnh hợp lệ. Chấp nhận: ${POD_IMAGE_TEMPLATE_ALLOWED_MIME_TYPES.join(', ')}.`,
      });
    }
  }

  /** Đọc kích thước ảnh. Không đọc được thì trả `null` — không vì thế mà chặn upload. */
  private readDimensions(file: Express.Multer.File): { width: number; height: number } | null {
    try {
      const size = imageSize(file.buffer);
      return size.width && size.height ? { width: size.width, height: size.height } : null;
    } catch {
      return null;
    }
  }

  /** "front-mockup.jpg" → "Front Mockup". */
  private titleFromFileName(fileName: string): string {
    const base = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    if (!base) return 'Image';
    return base
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Xoá file trên R2 khi KHÔNG còn bộ ảnh nào trỏ tới.
   *
   * Bắt buộc phải đếm: Clone và Replace đều tạo ra trường hợp nhiều dòng dùng chung một
   * file — xoá vô điều kiện là làm vỡ ảnh của bộ khác.
   */
  private async removeFileIfUnused(
    organizationId: string,
    userId: string,
    fileId: string,
  ): Promise<void> {
    const stillUsed = await this.prisma.podImageTemplateItem.count({ where: { fileId } });
    if (stillUsed > 0) return;

    try {
      await this.storage.remove(organizationId, userId, fileId);
    } catch (error) {
      // Dọn file là việc phụ: hỏng thì ghi log, không làm thất bại thao tác của người dùng.
      this.logger.warn({
        module: 'pod-listing',
        operation: 'imageTemplate.fileCleanup.fail',
        organizationId,
        fileId,
        msg: error instanceof Error ? error.message : 'Lỗi không xác định',
      });
    }
  }

  /** Đánh số lại 0..n sau khi xoá để thứ tự không thủng lỗ. */
  private async compactOrder(templateId: string): Promise<void> {
    const items = await this.prisma.podImageTemplateItem.findMany({
      where: { imageTemplateId: templateId },
      orderBy: { displayOrder: 'asc' },
      select: { id: true },
    });

    await this.prisma.$transaction(
      items.map((item, index) =>
        this.prisma.podImageTemplateItem.update({
          where: { id: item.id },
          data: { displayOrder: index },
        }),
      ),
    );
  }

  private async clearDefault(
    tx: Prisma.TransactionClient,
    organizationId: string,
    exceptId?: string,
  ): Promise<void> {
    await tx.podImageTemplate.updateMany({
      where: {
        organizationId,
        isDefault: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }
}
