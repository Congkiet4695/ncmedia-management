import { Injectable } from '@nestjs/common';
import { PodDesignPlacement, Prisma } from '@prisma/client';
import { StorageMapper } from '../../storage/storage.mapper';
import { PodDesignDto } from '../../pod-tiktok/dto/pod-design.dto';
import type { ProductMappingDesignStatus } from '../dto/fulfillment.dto';

/**
 * Hình dạng tối thiểu để dựng `PodDesignDto`.
 *
 * Khai bằng structural type thay vì buộc phải `include` cả bản ghi: nơi gọi chỉ cần `select`
 * đúng những cột này là dùng được, không phải kéo về cả `storage_files`.
 */
export interface DesignForDto {
  id: string;
  placement: PodDesignPlacement;
  version: number;
  storageFile: {
    id: string;
    publicUrl: string | null;
    originalName: string;
    mimeType: string;
    fileSize: number;
    uploadedAt: Date;
    uploader?: { fullName: string } | null;
  };
}

/** Bản ghi design kèm file, đúng include mà service dùng. */
export type ProductDesignWithFile = Prisma.FulfillmentProductDesignGetPayload<{
  include: { storageFile: { include: { uploader: true } } };
}>;

/**
 * ProductDesignMapper — Design (DB) → `PodDesignDto`.
 *
 * 🔴 Tồn tại để chỉ có MỘT định nghĩa "design trông như thế nào khi ra API". Trước đây cùng
 * một phép chuyển được viết lại ở ba nơi (service upload, resolver của màn hình đơn, danh
 * sách ánh xạ); ba bản sao thì `fileUrl` chỉ cần lệch một chỗ là giao diện hiện ảnh vỡ đúng
 * ở một màn hình mà không ai để ý.
 *
 * Metadata file (tên, mime, dung lượng, người upload) KHÔNG được lặp lại trong bảng design —
 * chúng thuộc Storage Module và được đọc qua quan hệ `storageFile`.
 */
@Injectable()
export class ProductDesignMapper {
  constructor(private readonly storage: StorageMapper) {}

  toDto(design: DesignForDto): PodDesignDto {
    const file = design.storageFile;
    return {
      id: design.id,
      placement: design.placement,
      // Bucket private ⇒ không có URL công khai ⇒ dùng đường tải qua API (có kiểm quyền).
      fileUrl: file.publicUrl ?? this.storage.buildDownloadUrl(file.id),
      fileName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      version: design.version,
      uploadedAt: file.uploadedAt.toISOString(),
      uploadedByName: file.uploader?.fullName ?? null,
    };
  }

  toDtoList(designs: DesignForDto[]): PodDesignDto[] {
    // Thứ tự ổn định theo vị trí in: bảng và dialog luôn hiện Front rồi Back, không nhảy chỗ.
    return [...designs]
      .sort((a, b) => a.placement.localeCompare(b.placement))
      .map((design) => this.toDto(design));
  }

  /**
   * Tình trạng design của một sản phẩm.
   *
   * 🔴 **Mặt trước là mức tối thiểu, mặt sau là tuỳ chọn** — giống hệt luật mà
   * `FulfillmentReadinessService` dùng để quyết định đơn có gửi được không. Bán poster hay
   * áo in một mặt vẫn phải sản xuất được; bắt đủ hai mặt sẽ chặn oan.
   */
  statusOf(designs: Array<{ placement: PodDesignPlacement }>): ProductMappingDesignStatus {
    if (designs.length === 0) return 'MISSING_ALL';
    const hasFront = designs.some((design) => design.placement === PodDesignPlacement.FRONT);
    return hasFront ? 'READY' : 'MISSING_FRONT';
  }
}
