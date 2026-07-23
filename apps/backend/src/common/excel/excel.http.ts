import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Options cho FileInterceptor: memory storage, giới hạn 15MB, chỉ nhận .xlsx. */
export const xlsxUploadOptions: MulterOptions = {
  limits: { fileSize: 15 * 1024 * 1024 },
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
