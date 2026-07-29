import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Giới hạn kích thước upload mặc định (15MB). */
export const XLSX_DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Options cho FileInterceptor: memory storage, chỉ nhận .xlsx.
 * `maxBytes` cho phép từng module đặt giới hạn riêng theo yêu cầu nghiệp vụ.
 */
export function createXlsxUploadOptions(maxBytes: number = XLSX_DEFAULT_MAX_BYTES): MulterOptions {
  return {
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      const ok =
        file.mimetype === XLSX_MIME ||
        file.mimetype === 'application/octet-stream' ||
        /\.xlsx$/i.test(file.originalname);
      if (!ok) {
        cb(new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message: 'Chỉ chấp nhận file .xlsx' }), false);
        return;
      }
      cb(null, true);
    },
  };
}

/** Options mặc định (giữ nguyên hành vi cũ cho Account/Order). */
export const xlsxUploadOptions: MulterOptions = createXlsxUploadOptions();

/** Kiểm tra file upload hợp lệ + trả buffer. */
export function requireXlsx(file?: Express.Multer.File): Buffer {
  if (!file || !file.buffer?.length) {
    throw new BadRequestException({ code: 'IMPORT_FILE_MISSING', message: 'Chưa có file upload (field "file")' });
  }
  if (!/\.xlsx$/i.test(file.originalname)) {
    throw new BadRequestException({ code: 'IMPORT_FORMAT_ERROR', message: 'Chỉ chấp nhận file .xlsx' });
  }
  return file.buffer;
}

/** Đóng gói buffer thành file tải xuống (.xlsx) — TransformInterceptor bỏ qua StreamableFile. */
export function xlsxFile(buffer: Buffer, filename: string): StreamableFile {
  return new StreamableFile(buffer, {
    type: XLSX_MIME,
    disposition: `attachment; filename="${filename}"`,
  });
}
