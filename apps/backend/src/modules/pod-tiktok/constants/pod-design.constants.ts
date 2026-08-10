import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/** Định dạng ảnh chấp nhận cho file design. */
export const POD_DESIGN_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Giới hạn "cứng" ở tầng multer (chặn sớm, tránh nạp file khổng lồ vào RAM).
 * Giới hạn nghiệp vụ thực tế lấy từ `UPLOAD_MAX_IMAGE_BYTES` và được kiểm tra lại
 * ở `PodOrderDesignService` để thông báo lỗi thân thiện theo cấu hình.
 */
export const POD_DESIGN_HARD_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Options cho `FileInterceptor`: memory storage (giống luồng import Excel đang có),
 * chỉ nhận ảnh. Service sẽ ghi buffer xuống storage.
 */
export const designUploadOptions: MulterOptions = {
  limits: { fileSize: POD_DESIGN_HARD_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(POD_DESIGN_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(
        new BadRequestException({
          code: 'POD_DESIGN_FORMAT_INVALID',
          message: 'Chỉ chấp nhận ảnh PNG, JPEG hoặc WEBP',
        }),
        false,
      );
      return;
    }
    cb(null, true);
  },
};
