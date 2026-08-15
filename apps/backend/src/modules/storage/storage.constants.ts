import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Danh mục định dạng file được phép upload toàn hệ thống.
 *
 * Mỗi mục khai báo CẢ mime type LẪN phần mở rộng — phải khớp cả hai mới nhận,
 * để chặn kiểu tấn công đổi đuôi file (vd `payload.exe` gắn mime `image/png`).
 */
export interface AllowedFileType {
  mimeTypes: readonly string[];
  extensions: readonly string[];
}

export const STORAGE_ALLOWED_TYPES: readonly AllowedFileType[] = [
  { mimeTypes: ['image/png'], extensions: ['png'] },
  { mimeTypes: ['image/jpeg'], extensions: ['jpg', 'jpeg'] },
  { mimeTypes: ['image/webp'], extensions: ['webp'] },
  { mimeTypes: ['application/pdf'], extensions: ['pdf'] },
  // PSD: trình duyệt/OS gửi nhiều mime khác nhau, kể cả octet-stream ⇒ chấp nhận theo đuôi.
  {
    mimeTypes: [
      'image/vnd.adobe.photoshop',
      'application/x-photoshop',
      'application/photoshop',
      'application/octet-stream',
    ],
    extensions: ['psd'],
  },
];

/** Tập mime hợp lệ (phẳng) — dùng cho fileFilter của multer. */
export const STORAGE_ALLOWED_MIME_TYPES: readonly string[] = STORAGE_ALLOWED_TYPES.flatMap(
  (type) => type.mimeTypes,
);

/** Tập đuôi file hợp lệ (phẳng). */
export const STORAGE_ALLOWED_EXTENSIONS: readonly string[] = STORAGE_ALLOWED_TYPES.flatMap(
  (type) => type.extensions,
);

/**
 * Đuôi file thực thi / kịch bản — TUYỆT ĐỐI không nhận, kể cả khi mime "trông có vẻ hợp lệ".
 * Đây là lớp chặn thứ hai, độc lập với danh sách cho phép ở trên.
 */
export const STORAGE_BLOCKED_EXTENSIONS: readonly string[] = [
  'exe', 'dll', 'com', 'bat', 'cmd', 'msi', 'scr', 'pif', 'cpl', 'jar',
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'mjs', 'cjs',
  'jse', 'wsf', 'wsh', 'hta', 'reg', 'php', 'phtml', 'asp', 'aspx', 'jsp',
  'py', 'rb', 'pl', 'app', 'deb', 'rpm', 'dmg', 'so', 'dylib',
];

/**
 * Giá trị mặc định của `STORAGE_MAX_FILE_BYTES` khi biến môi trường không được đặt.
 * 100 MB — cùng con số với `client_max_body_size` của Nginx và với thông báo trên giao diện.
 */
export const STORAGE_DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Giới hạn dung lượng một file — NGUỒN DUY NHẤT cho mọi tầng upload.
 *
 * Đọc thẳng `process.env` thay vì `ConfigService` vì hàm này được gọi lúc dựng `MulterOptions`,
 * tức tại thời điểm nạp module — trước khi DI của Nest tồn tại. Đây là chỗ DUY NHẤT trong
 * mã nguồn đọc trực tiếp biến môi trường cho giới hạn upload; các tầng còn lại (StorageService,
 * PodOrderDesignService) đều lấy qua `ConfigService` từ cùng một biến, nên không có hai con số
 * khác nhau tồn tại song song.
 *
 * Giá trị được `env.validation.ts` kiểm tra khi khởi động, nên tới đây luôn hợp lệ.
 */
export function resolveStorageMaxBytes(): number {
  const parsed = Number.parseInt(process.env.STORAGE_MAX_FILE_BYTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : STORAGE_DEFAULT_MAX_BYTES;
}

/** Số file tối đa cho một lần upload nhiều file. */
export const STORAGE_MAX_FILES_PER_REQUEST = 20;

/** Mã lỗi nghiệp vụ của Storage Module (dùng chung BE/FE). */
export const STORAGE_ERROR_CODES = {
  FILE_MISSING: 'STORAGE_FILE_MISSING',
  FILE_EMPTY: 'STORAGE_FILE_EMPTY',
  FILE_TOO_LARGE: 'STORAGE_FILE_TOO_LARGE',
  UNSUPPORTED_TYPE: 'STORAGE_UNSUPPORTED_TYPE',
  EXTENSION_BLOCKED: 'STORAGE_EXTENSION_BLOCKED',
  MIME_EXTENSION_MISMATCH: 'STORAGE_MIME_EXTENSION_MISMATCH',
  NOT_FOUND: 'STORAGE_FILE_NOT_FOUND',
  UPLOAD_FAILED: 'STORAGE_UPLOAD_FAILED',
  DELETE_FAILED: 'STORAGE_DELETE_FAILED',
  DOWNLOAD_FAILED: 'STORAGE_DOWNLOAD_FAILED',
  PROVIDER_TIMEOUT: 'STORAGE_PROVIDER_TIMEOUT',
  PROVIDER_UNAUTHORIZED: 'STORAGE_PROVIDER_UNAUTHORIZED',
  BUCKET_NOT_FOUND: 'STORAGE_BUCKET_NOT_FOUND',
  OBJECT_NOT_FOUND: 'STORAGE_OBJECT_NOT_FOUND',
  IN_USE: 'STORAGE_FILE_IN_USE',
} as const;

/**
 * Options cho `FileInterceptor`/`FilesInterceptor`: memory storage (giống luồng
 * import Excel đang có), lọc sơ bộ theo mime. Kiểm tra đầy đủ nằm ở `StorageService`.
 */
export const storageUploadOptions: MulterOptions = {
  limits: { fileSize: resolveStorageMaxBytes(), files: STORAGE_MAX_FILES_PER_REQUEST },
  fileFilter: (_req, file, cb) => {
    if (!STORAGE_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(
        new BadRequestException({
          code: STORAGE_ERROR_CODES.UNSUPPORTED_TYPE,
          message: `Định dạng không được hỗ trợ. Cho phép: ${STORAGE_ALLOWED_EXTENSIONS.join(', ')}`,
        }),
        false,
      );
      return;
    }
    cb(null, true);
  },
};
