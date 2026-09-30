import type { PodDesignPlacement } from '@prisma/client';
import type { PodDesignDto } from '../dto/pod-design.dto';

/**
 * Hình dạng tối thiểu của MỘT design để dựng `PodDesignDto` — structural type, nơi gọi chỉ cần
 * `select` đúng các cột này.
 *
 * Design có ĐÚNG MỘT nguồn (CHECK ở migration `20261002100000_design_public_url`):
 *  - `storageFile` — file đã upload lên Storage Module;
 *  - `sourceUrl`   — URL công khai người vận hành nhập, không tải về/upload lại.
 */
export interface DesignPresentable {
  id: string;
  placement: PodDesignPlacement;
  version: number;
  sourceUrl: string | null;
  updatedAt: Date;
  storageFile: {
    id: string;
    publicUrl: string | null;
    originalName: string;
    mimeType: string;
    fileSize: number;
    uploadedAt: Date;
    uploader?: { fullName: string } | null;
  } | null;
}

/**
 * Design (DB) → `PodDesignDto`.
 *
 * 🔴 MỘT định nghĩa cho cả module Fulfillment (`ProductDesignMapper`) lẫn màn hình POD Orders
 * (`PodOrderDesignResolverService`). Hai bản sao từng tồn tại và chỉ cần lệch `fileUrl` một chỗ
 * là giao diện hiện ảnh vỡ đúng ở một màn hình. Đặt ở `pod-tiktok` vì đó là chiều phụ thuộc
 * hợp lệ (`fulfillment → pod-tiktok`, không có chiều ngược lại).
 *
 * @param buildDownloadUrl Đường tải qua API (có kiểm quyền) cho file upload ở bucket private.
 */
export function toPodDesignDto(
  design: DesignPresentable,
  buildDownloadUrl: (storageFileId: string) => string,
): PodDesignDto {
  const file = design.storageFile;
  if (!file) {
    const url = design.sourceUrl ?? '';
    return {
      id: design.id,
      placement: design.placement,
      source: 'URL',
      fileUrl: url,
      fileName: fileNameOfUrl(url),
      // Không tải file về nên KHÔNG biết mime/dung lượng — để null thay vì bịa số.
      mimeType: null,
      fileSize: null,
      version: design.version,
      uploadedAt: design.updatedAt.toISOString(),
      uploadedByName: null,
    };
  }
  return {
    id: design.id,
    placement: design.placement,
    source: 'UPLOAD',
    // Bucket private ⇒ không có URL công khai ⇒ dùng đường tải qua API (có kiểm quyền).
    fileUrl: file.publicUrl ?? buildDownloadUrl(file.id),
    fileName: file.originalName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    version: design.version,
    uploadedAt: file.uploadedAt.toISOString(),
    uploadedByName: file.uploader?.fullName ?? null,
  };
}

/** Tên hiển thị của design nguồn URL: đoạn cuối của path, rơi về hostname. */
function fileNameOfUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : parsed.hostname;
  } catch {
    return url;
  }
}
