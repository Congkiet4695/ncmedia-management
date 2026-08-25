import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { extname } from 'node:path';
import {
  POD_SESSION_IMPORT_EXTENSIONS,
  POD_SESSION_IMPORT_MAX_BYTES,
} from './constants/pod-listing-session.constants';

/**
 * Cấu hình nhận file import: giữ trong RAM, chỉ nhận `.xlsx` / `.csv`.
 *
 * Lọc theo **đuôi file** chứ không theo mime type: trình duyệt gửi `.csv` với đủ kiểu mime
 * (`text/csv`, `application/vnd.ms-excel`, thậm chí `application/octet-stream` trên Windows),
 * lọc theo mime là từ chối nhầm file hợp lệ của chính người dùng.
 */
export const POD_SESSION_IMPORT_OPTIONS: MulterOptions = {
  limits: { fileSize: POD_SESSION_IMPORT_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (
      !POD_SESSION_IMPORT_EXTENSIONS.includes(ext as (typeof POD_SESSION_IMPORT_EXTENSIONS)[number])
    ) {
      cb(
        new BadRequestException({
          code: 'POD_SESSION_IMPORT_INVALID_TYPE',
          message: `"${file.originalname}" không đúng định dạng. Chấp nhận: ${POD_SESSION_IMPORT_EXTENSIONS.join(', ')}.`,
        }),
        false,
      );
      return;
    }
    cb(null, true);
  },
};
