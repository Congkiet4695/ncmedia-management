import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { resolveStorageMaxBytes } from '../../storage/storage.constants';

/** Định dạng ảnh chấp nhận cho file design. */
export const POD_DESIGN_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Giới hạn dung lượng file design.
 *
 * Dùng CHUNG một nguồn với Storage Module (`STORAGE_MAX_FILE_BYTES`) — trước đây module này
 * có con số riêng 50 MB, thấp hơn cấu hình chung, nên file hợp lệ vẫn bị chặn ở tầng multer
 * trước khi tới được tầng nghiệp vụ. Front Design và Back Design đi qua đúng hàm này.
 */

/**
 * Options cho `FileInterceptor`: memory storage (giống luồng import Excel đang có),
 * chỉ nhận ảnh. Service sẽ ghi buffer xuống storage.
 */
export const designUploadOptions: MulterOptions = {
  limits: { fileSize: resolveStorageMaxBytes(), files: 1 },
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
