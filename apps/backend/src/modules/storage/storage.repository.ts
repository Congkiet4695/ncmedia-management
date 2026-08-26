import { Injectable } from '@nestjs/common';
import {
  Prisma,
  StorageModuleName,
  StorageProviderName,
  StorageReferenceType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** Dữ liệu ghi metadata một file. */
export interface StorageFileWriteData {
  module: StorageModuleName;
  referenceType: StorageReferenceType;
  referenceId: string | null;
  folder: string;
  objectKey: string;
  originalName: string;
  storedName: string;
  extension: string;
  mimeType: string;
  fileSize: number;
  publicUrl: string | null;
  provider: StorageProviderName;
  bucket: string | null;
  checksum: string;
}

export interface StorageFileQueryParams {
  page: number;
  limit: number;
  module?: StorageModuleName;
  referenceType?: StorageReferenceType;
  referenceId?: string;
}

/** Include chuẩn khi đọc file (kèm tên người upload để hiển thị). */
export const STORAGE_FILE_INCLUDE = {
  uploader: { select: { id: true, fullName: true } },
} as const satisfies Prisma.StorageFileInclude;

export type StorageFileWithUploader = Prisma.StorageFileGetPayload<{
  include: typeof STORAGE_FILE_INCLUDE;
}>;

/**
 * StorageRepository — data access cho metadata file.
 *
 * Tenant isolation (ADR-004): mọi method nghiệp vụ nhận `organizationId`.
 * Repository KHÔNG chạm tới nhà cung cấp lưu trữ — đó là việc của provider.
 */
@Injectable()
export class StorageRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actorUserId: string,
    data: StorageFileWriteData,
  ): Promise<StorageFileWithUploader> {
    return tx.storageFile.create({
      data: {
        organizationId,
        ...data,
        uploadedBy: actorUserId,
        uploadedAt: new Date(),
        createdBy: actorUserId,
      },
      include: STORAGE_FILE_INCLUDE,
    });
  }

  findById(organizationId: string, id: string): Promise<StorageFileWithUploader | null> {
    return this.prisma.storageFile.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: STORAGE_FILE_INCLUDE,
    });
  }

  /** Tìm theo cặp tham chiếu — dùng cho `GET /storage/reference`. */
  findByReference(
    organizationId: string,
    referenceType: StorageReferenceType,
    referenceId: string,
  ): Promise<StorageFileWithUploader[]> {
    return this.prisma.storageFile.findMany({
      where: { organizationId, referenceType, referenceId, deletedAt: null },
      include: STORAGE_FILE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMany(
    organizationId: string,
    params: StorageFileQueryParams,
  ): Promise<{ items: StorageFileWithUploader[]; total: number }> {
    const where: Prisma.StorageFileWhereInput = {
      organizationId,
      deletedAt: null,
      ...(params.module ? { module: params.module } : {}),
      ...(params.referenceType ? { referenceType: params.referenceType } : {}),
      ...(params.referenceId ? { referenceId: params.referenceId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.storageFile.findMany({
        where,
        include: STORAGE_FILE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.storageFile.count({ where }),
    ]);
    return { items, total };
  }

  /** Xoá mềm metadata (giữ vết để đối soát). */
  async softDelete(
    tx: Prisma.TransactionClient,
    id: string,
    actorUserId: string,
  ): Promise<void> {
    await tx.storageFile.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorUserId },
    });
  }

  /**
   * Số bản ghi nghiệp vụ đang tham chiếu file này.
   * Dùng để chặn xoá trực tiếp file vẫn đang được dùng (FK là `Restrict`).
   * Thêm quan hệ mới ⇒ cộng thêm phép đếm tại đây.
   */
  /**
   * Đếm số thực thể nghiệp vụ đang dùng file.
   *
   * 🔴 Phải liệt kê ĐỦ mọi bảng có khoá ngoại tới `storage_files`. Thiếu một bảng thì
   * người dùng xoá file ở màn hình Storage sẽ nhận lỗi ràng buộc thô của Postgres thay vì
   * thông điệp "file đang được sử dụng" — hoặc tệ hơn, ảnh của template khác bị vỡ.
   */
  async countReferences(id: string): Promise<number> {
    const [productDesigns, legacyItemDesigns, imageTemplateItems, skuTemplateItems] =
      await Promise.all([
        // Design đang dùng — gắn theo SẢN PHẨM (Product ID + Seller SKU).
        this.prisma.fulfillmentProductDesign.count({
          where: { storageFileId: id, deletedAt: null },
        }),
        // ⛔ Bảng lưu trữ lịch sử (design theo line item). Không còn được ghi, nhưng VẪN
        // phải đếm: file mà một dòng lịch sử còn trỏ tới không được xoá, nếu không bản ghi
        // audit "đơn này in file gì" trỏ vào hư không.
        this.prisma.podOrderItemDesign.count({ where: { storageFileId: id, deletedAt: null } }),
        this.prisma.podImageTemplateItem.count({ where: { fileId: id } }),
        this.prisma.podSkuTemplateItem.count({ where: { imageFileId: id } }),
      ]);
    return productDesigns + legacyItemDesigns + imageTemplateItems + skuTemplateItems;
  }

}
