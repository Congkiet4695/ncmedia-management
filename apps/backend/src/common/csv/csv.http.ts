import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { extname } from 'node:path';

export const CSV_MIME = 'text/csv; charset=utf-8';

/**
 * Options cho FileInterceptor: memory storage, chỉ nhận `.csv`.
 *
 * Lọc theo ĐUÔI file chứ không theo mime: trình duyệt gửi `.csv` với đủ kiểu mime (`text/csv`,
 * `application/vnd.ms-excel`, `application/octet-stream` trên Windows) — cùng lý do với
 * `POD_SESSION_IMPORT_OPTIONS`.
 */
export function createCsvUploadOptions(maxBytes: number): MulterOptions {
  return {
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (extname(file.originalname).toLowerCase() !== '.csv') {
        cb(new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message: 'Chỉ chấp nhận file .csv' }), false);
        return;
      }
      cb(null, true);
    },
  };
}

/** Kiểm tra file upload hợp lệ + trả nội dung UTF-8. */
export function requireCsv(file?: Express.Multer.File): string {
  if (!file || !file.buffer?.length) {
    throw new BadRequestException({ code: 'IMPORT_FILE_MISSING', message: 'Chưa có file upload (field "file")' });
  }
  if (extname(file.originalname).toLowerCase() !== '.csv') {
    throw new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message: 'Chỉ chấp nhận file .csv' });
  }
  return file.buffer.toString('utf8');
}

/** Đóng gói nội dung CSV thành file tải xuống — TransformInterceptor bỏ qua StreamableFile. */
export function csvFile(content: string, filename: string): StreamableFile {
  return new StreamableFile(Buffer.from(content, 'utf8'), {
    type: CSV_MIME,
    disposition: `attachment; filename="${filename}"`,
  });
}
