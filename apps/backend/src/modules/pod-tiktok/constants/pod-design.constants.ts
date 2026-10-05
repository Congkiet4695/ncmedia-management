import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { resolveStorageMaxBytes } from '../../storage/storage.constants';

/** Định dạng ảnh chấp nhận cho file design. */
export const POD_DESIGN_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Design nhập bằng URL: server tải về rồi lưu lên kho (R2). Deadline cho TOÀN BỘ lần tải (kể cả
 * chuyển hướng) — đủ cho file vài chục MB từ CDN/Drive, đủ ngắn để request không treo tới timeout
 * của Nginx (300s) hay trình duyệt. Dung lượng tối đa dùng chung `STORAGE_MAX_FILE_BYTES`.
 */
export const POD_DESIGN_URL_FETCH_TIMEOUT_MS = 60_000;

/** Số lần chuyển hướng tối đa khi tải design từ URL (Drive dùng 1–2 bước). */
export const POD_DESIGN_URL_MAX_REDIRECTS = 5;

/**
 * `Content-Type` chấp nhận được trước khi xem chữ ký file. Nhiều CDN / Drive trả ảnh dạng
 * `application/octet-stream` — loại thật do magic bytes quyết định, header chỉ dùng để loại sớm
 * thứ CHẮC CHẮN không phải ảnh (HTML, JSON…).
 */
export const POD_DESIGN_URL_GENERIC_CONTENT_TYPES = [
  '',
  'application/octet-stream',
  'binary/octet-stream',
] as const;

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
