import { StorageProviderName } from '@prisma/client';

/** Tham số ghi một object lên storage. */
export interface PutObjectParams {
  /** Khoá đối tượng đầy đủ trong bucket, vd `designs/{org}/{order}/{item}/{uuid}.png`. */
  objectKey: string;
  body: Buffer;
  mimeType: string;
  /** Tên file gốc — đặt vào Content-Disposition để tải về đúng tên. */
  originalName: string;
}

/** Kết quả ghi object. */
export interface PutObjectResult {
  objectKey: string;
  /** URL công khai nếu bucket cho phép đọc công khai; null khi bucket private. */
  publicUrl: string | null;
  /** Tên bucket đã ghi (lưu lại để đổi bucket vẫn truy xuất được file cũ). */
  bucket: string | null;
}

/** Object đã tải về. */
export interface GetObjectResult {
  body: Buffer;
  mimeType: string;
  size: number;
}

/**
 * StorageProvider — hợp đồng với một nhà cung cấp lưu trữ đối tượng.
 *
 * Đây là RANH GIỚI DUY NHẤT chạm tới hạ tầng lưu trữ (Cloudflare R2, AWS S3, MinIO, GCS...).
 * `StorageService` chỉ làm việc với interface này; đổi nhà cung cấp = viết một
 * implementation mới và đổi provider trong `StorageModule`, KHÔNG sửa nghiệp vụ.
 *
 * Mọi implementation phải:
 *  - Ném `StorageProviderException` (đã phân loại) thay vì lỗi thô của SDK.
 *  - Là idempotent với `delete` (xoá file không tồn tại không được coi là lỗi).
 */
export abstract class StorageProvider {
  /** Tên provider — ghi vào `storage_files.provider` để truy xuất về sau. */
  abstract readonly name: StorageProviderName;

  abstract put(params: PutObjectParams): Promise<PutObjectResult>;

  abstract get(objectKey: string): Promise<GetObjectResult>;

  /** Xoá object. KHÔNG ném lỗi nếu object không tồn tại. */
  abstract delete(objectKey: string): Promise<void>;

  abstract exists(objectKey: string): Promise<boolean>;

  /** URL công khai của object; null nếu bucket private (phải tải qua API). */
  abstract resolvePublicUrl(objectKey: string): string | null;
}
