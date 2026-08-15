import { env } from './env';

/**
 * Tiện ích dung lượng file dùng CHUNG cho mọi màn hình upload.
 *
 * Có một chỗ duy nhất quyết định giới hạn và cách hiển thị, nên Front Design, Back Design
 * và các luồng upload khác không thể mỗi nơi một con số như trước.
 */

/** Giới hạn dung lượng một file (byte) — lấy từ cấu hình, không viết cứng trong component. */
export const MAX_UPLOAD_BYTES = env.maxUploadBytes;

/** Giới hạn quy đổi sang MB để hiển thị (vd 100). */
export const MAX_UPLOAD_MB = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));

/** File có vượt giới hạn không. */
export function exceedsMaxUploadSize(file: File): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}

/** Dung lượng dễ đọc: 1.2 KB · 3.4 MB. Dùng để nêu rõ file người dùng vừa chọn nặng bao nhiêu. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
