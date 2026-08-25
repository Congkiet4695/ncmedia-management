import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import {
  POD_IMAGE_TEMPLATE_ALLOWED_MIME_TYPES,
  POD_IMAGE_TEMPLATE_MAX_UPLOAD,
} from './constants/pod-listing.constants';
import { resolveStorageMaxBytes } from '../storage/storage.constants';

/**
 * Cấu hình nhận file cho bộ ảnh mẫu: giữ trong RAM, chỉ nhận ảnh.
 *
 * Chặn ngay ở tầng multer thay vì đợi vào service: file sai loại thì không có lý do gì để
 * đọc hết vào bộ nhớ trước. Giới hạn dung lượng dùng chung với Storage Module để không có
 * hai con số khác nhau cho cùng một việc.
 */
export const imageUploadOptions: MulterOptions = {
  limits: { fileSize: resolveStorageMaxBytes(), files: POD_IMAGE_TEMPLATE_MAX_UPLOAD },
  fileFilter: (_req, file, cb) => {
    if (!POD_IMAGE_TEMPLATE_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(
        new BadRequestException({
          code: 'POD_IMAGE_TEMPLATE_INVALID_TYPE',
          message: `"${file.originalname}" không phải ảnh hợp lệ. Chấp nhận: ${POD_IMAGE_TEMPLATE_ALLOWED_MIME_TYPES.join(', ')}.`,
        }),
        false,
      );
      return;
    }
    cb(null, true);
  },
};
