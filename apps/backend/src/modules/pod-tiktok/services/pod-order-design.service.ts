import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  PodDesignPlacement,
  StorageModuleName,
  StorageReferenceType,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { StorageMapper } from '../../storage/storage.mapper';
import { StorageService } from '../../storage/storage.service';
import { PodDesignDto } from '../dto/pod-design.dto';
import { POD_DESIGN_MIME_TYPES } from '../constants/pod-design.constants';
import {
  PodDesignNotFoundException,
  PodOrderItemNotFoundException,
} from '../exceptions/pod-tiktok.exceptions';
import {
  PodDesignWithFile,
  PodOrderDesignRepository,
} from '../repositories/pod-order-design.repository';

/**
 * PodOrderDesignService — quản lý file design in cho từng sản phẩm của đơn POD.
 *
 * Nguyên tắc:
 *  - Mỗi (sản phẩm × vị trí in) độc lập: upload FRONT không ảnh hưởng BACK,
 *    và không ảnh hưởng sản phẩm khác trong cùng đơn.
 *  - Thay design: ghi đè bản ghi, tăng `version`, xoá file cũ khỏi kho lưu trữ
 *    để không tích tụ file rác.
 *  - Module này KHÔNG tự ghi file: mọi thao tác lưu trữ đi qua `StorageService`
 *    (đổi Cloudflare R2 → S3 → MinIO không phải sửa dòng nào ở đây).
 *  - Ghi DB trong transaction; đẩy file lên kho lưu trữ TRƯỚC transaction
 *    (không giữ kết nối DB trong lúc chờ I/O mạng).
 */
@Injectable()
export class PodOrderDesignService {
  private readonly logger = new Logger(PodOrderDesignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PodOrderDesignRepository,
    private readonly storage: StorageService,
    private readonly storageMapper: StorageMapper,
  ) {}

  /** Toàn bộ design đang hiệu lực của một sản phẩm. */
  async findByItem(organizationId: string, orderItemId: string): Promise<PodDesignDto[]> {
    const item = await this.repo.findItemInOrg(organizationId, orderItemId);
    if (!item) throw new PodOrderItemNotFoundException();

    const designs = await this.repo.findByItem(organizationId, orderItemId);
    return designs.map((design) => this.toDto(design));
  }

  /**
   * Upload (hoặc thay thế) design tại một vị trí in.
   *
   * Trả về bản ghi sau khi ghi — FE dùng để hiển thị preview + URL readonly.
   */
  async upload(
    organizationId: string,
    actorUserId: string,
    orderItemId: string,
    placement: PodDesignPlacement,
    file: Express.Multer.File | undefined,
  ): Promise<PodDesignDto> {
    this.validateFormat(file);
    const item = await this.repo.findItemInOrg(organizationId, orderItemId);
    if (!item) throw new PodOrderItemNotFoundException();

    // File cũ (nếu thay design) — xoá SAU khi ghi DB thành công.
    const previous = await this.repo.findByPlacement(organizationId, orderItemId, placement);

    // Kiểm tra dung lượng/định dạng đầy đủ + sinh tên UUID nằm ở StorageService.
    const stored = await this.storage.upload(file, {
      organizationId,
      actorUserId,
      module: StorageModuleName.POD_TIKTOK,
      referenceType: StorageReferenceType.POD_ORDER_ITEM_DESIGN,
      referenceId: orderItemId,
      folderSegments: ['pod', 'designs', organizationId, orderItemId],
    });

    let saved: PodDesignWithFile;
    try {
      saved = await this.prisma.$transaction((tx) =>
        this.repo.upsert(tx, {
          organizationId,
          orderId: item.orderId,
          orderItemId,
          placement,
          storageFileId: stored.id,
          actorUserId,
        }),
      );
    } catch (error) {
      // Ghi DB thất bại ⇒ dọn file vừa lưu để không để lại rác.
      await this.storage.removeInternal(organizationId, actorUserId, stored.id);
      throw error;
    }

    // Ghi DB xong mới xoá file cũ — tránh mất file khi transaction rollback.
    if (previous && previous.storageFileId !== stored.id) {
      await this.storage.removeInternal(organizationId, actorUserId, previous.storageFileId);
    }

    this.logger.log({
      module: 'pod-tiktok',
      operation: 'design.upload',
      organizationId,
      orderItemId,
      placement,
      version: saved.version,
      storageFileId: stored.id,
      sizeBytes: stored.fileSize,
      msg: previous ? 'Đã thay design' : 'Đã upload design',
    });

    return this.toDto(saved);
  }

  /** Xoá design tại một vị trí in (xoá mềm bản ghi + xoá file trên kho lưu trữ). */
  async remove(
    organizationId: string,
    actorUserId: string,
    orderItemId: string,
    placement: PodDesignPlacement,
  ): Promise<void> {
    const item = await this.repo.findItemInOrg(organizationId, orderItemId);
    if (!item) throw new PodOrderItemNotFoundException();

    // Gỡ liên kết TRƯỚC khi xoá file: khoá ngoại là `Restrict`, còn liên kết thì
    // không xoá được `storage_files`.
    const storageFileId = await this.prisma.$transaction((tx) =>
      this.repo.softDelete(tx, organizationId, orderItemId, placement, actorUserId),
    );
    if (!storageFileId) throw new PodDesignNotFoundException();

    await this.storage.removeInternal(organizationId, actorUserId, storageFileId);

    this.logger.log({
      module: 'pod-tiktok',
      operation: 'design.delete',
      organizationId,
      orderItemId,
      placement,
      storageFileId,
      msg: 'Đã xoá design',
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Ràng buộc riêng của nghiệp vụ POD: design chỉ nhận ảnh PNG/JPEG/WEBP,
   * hẹp hơn danh sách cho phép chung của Storage Module (còn có pdf/psd).
   * Các kiểm tra chung (rỗng, dung lượng, đuôi nguy hiểm, mime ≠ đuôi) do
   * `StorageService` đảm nhiệm — không lặp lại ở đây.
   */
  private validateFormat(file?: Express.Multer.File): asserts file is Express.Multer.File {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException({
        code: 'POD_DESIGN_FILE_MISSING',
        message: 'Chưa chọn file design (field "file")',
      });
    }
    if (!(POD_DESIGN_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'POD_DESIGN_FORMAT_INVALID',
        message: 'Chỉ chấp nhận ảnh PNG, JPEG hoặc WEBP',
      });
    }
  }

  /**
   * Metadata file lấy từ `storage_files` (không nhân bản sang bảng design).
   * `fileUrl`: URL công khai nếu bucket cho phép đọc công khai, ngược lại là
   * đường dẫn tải qua API — hợp đồng với FE giữ nguyên như trước.
   */
  private toDto(design: PodDesignWithFile): PodDesignDto {
    const file = design.storageFile;
    return {
      id: design.id,
      placement: design.placement,
      fileUrl: file.publicUrl ?? this.storageMapper.buildDownloadUrl(file.id),
      fileName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      version: design.version,
      uploadedAt: file.uploadedAt.toISOString(),
      uploadedByName: file.uploader?.fullName ?? null,
    };
  }
}
