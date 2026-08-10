import { Injectable } from '@nestjs/common';
import { PodDesignPlacement, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/** Sản phẩm (line item) kèm ngữ cảnh tenant — dùng để kiểm tra quyền trước khi ghi design. */
export interface OrderItemRef {
  id: string;
  organizationId: string;
  orderId: string;
  productName: string | null;
  skuName: string | null;
  sellerSku: string | null;
  productId: string | null;
}

/**
 * Include chuẩn khi đọc design.
 *
 * Metadata file (tên, dung lượng, URL, người upload) nằm ở `storage_files` — bảng design
 * chỉ giữ khoá ngoại `storage_file_id`, không nhân bản cột file.
 */
export const POD_DESIGN_INCLUDE = {
  storageFile: { include: { uploader: { select: { id: true, fullName: true } } } },
} as const satisfies Prisma.PodOrderItemDesignInclude;

export type PodDesignWithFile = Prisma.PodOrderItemDesignGetPayload<{
  include: typeof POD_DESIGN_INCLUDE;
}>;

/**
 * PodOrderDesignRepository — data access cho file design của sản phẩm POD.
 * Mọi method nhận `organizationId` (tenant isolation — ADR-004).
 */
@Injectable()
export class PodOrderDesignRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Lấy sản phẩm trong phạm vi tổ chức (chặn thao tác chéo tenant). */
  findItemInOrg(organizationId: string, orderItemId: string): Promise<OrderItemRef | null> {
    return this.prisma.podOrderItem.findFirst({
      where: { id: orderItemId, organizationId, order: { deletedAt: null } },
      select: {
        id: true,
        organizationId: true,
        orderId: true,
        productName: true,
        skuName: true,
        sellerSku: true,
        productId: true,
      },
    });
  }

  /** Design hiện có tại một vị trí in (nếu có). */
  findByPlacement(
    organizationId: string,
    orderItemId: string,
    placement: PodDesignPlacement,
  ): Promise<PodDesignWithFile | null> {
    return this.prisma.podOrderItemDesign.findFirst({
      where: { organizationId, orderItemId, placement, deletedAt: null },
      include: POD_DESIGN_INCLUDE,
    });
  }

  /** Toàn bộ design đang hiệu lực của một sản phẩm. */
  findByItem(organizationId: string, orderItemId: string): Promise<PodDesignWithFile[]> {
    return this.prisma.podOrderItemDesign.findMany({
      where: { organizationId, orderItemId, deletedAt: null },
      include: POD_DESIGN_INCLUDE,
      orderBy: { placement: 'asc' },
    });
  }

  /**
   * Tạo mới hoặc thay thế design tại một vị trí.
   *
   * Dùng `upsert` trên UNIQUE (orderItemId, placement) để hai request upload đồng thời
   * không tạo hai bản ghi. Thay design ⇒ trỏ sang file mới và tăng `version`.
   * Bản ghi đã xoá mềm được "hồi sinh" thay vì tạo dòng mới (giữ nguyên UNIQUE).
   * Người/lúc upload lấy từ `storage_files` — không lưu trùng ở đây.
   */
  upsert(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      orderId: string;
      orderItemId: string;
      placement: PodDesignPlacement;
      storageFileId: string;
      actorUserId: string;
    },
  ): Promise<PodDesignWithFile> {
    const { organizationId, orderId, orderItemId, placement, storageFileId, actorUserId } = params;
    return tx.podOrderItemDesign.upsert({
      where: { orderItemId_placement: { orderItemId, placement } },
      create: {
        organizationId,
        orderId,
        orderItemId,
        placement,
        storageFileId,
        version: 1,
        createdBy: actorUserId,
      },
      update: {
        storageFileId,
        version: { increment: 1 },
        deletedAt: null,
        updatedBy: actorUserId,
      },
      include: POD_DESIGN_INCLUDE,
    });
  }

  /**
   * Xoá mềm design tại một vị trí.
   * Trả `storageFileId` để service nhờ `StorageService` dọn file tương ứng.
   */
  async softDelete(
    tx: Prisma.TransactionClient,
    organizationId: string,
    orderItemId: string,
    placement: PodDesignPlacement,
    actorUserId: string,
  ): Promise<string | null> {
    const existing = await tx.podOrderItemDesign.findFirst({
      where: { organizationId, orderItemId, placement, deletedAt: null },
      select: { id: true, storageFileId: true },
    });
    if (!existing) return null;

    await tx.podOrderItemDesign.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), updatedBy: actorUserId },
    });
    return existing.storageFileId;
  }
}
