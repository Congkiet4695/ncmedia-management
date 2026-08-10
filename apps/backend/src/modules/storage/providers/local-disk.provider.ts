import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { StorageProviderName } from '@prisma/client';
import {
  StorageProviderErrorKind,
  StorageProviderException,
} from '../exceptions/storage.exceptions';
import {
  GetObjectResult,
  PutObjectParams,
  PutObjectResult,
  StorageProvider,
} from '../interfaces/storage-provider.interface';

/**
 * LocalDiskProvider — lưu file trên đĩa máy chủ.
 *
 * Mục đích: chạy dev/test và CI **không cần credential R2**, đồng thời chứng minh
 * kiến trúc provider có thể thay thế được. Production dùng `CloudflareR2Provider`
 * (đặt `STORAGE_PROVIDER=CLOUDFLARE_R2`).
 *
 * File được phục vụ tĩnh ở `UPLOAD_URL_PREFIX` (cấu hình trong `main.ts`).
 */
@Injectable()
export class LocalDiskProvider extends StorageProvider {
  readonly name = StorageProviderName.LOCAL_DISK;

  private readonly logger = new Logger(LocalDiskProvider.name);
  private readonly root: string;
  private readonly urlPrefix: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    super();
    this.root = resolve(config.get<string>('storage.local.root', './uploads'));
    this.urlPrefix = config.get<string>('storage.local.urlPrefix', '/uploads');
    this.publicBaseUrl = (config.get<string>('storage.local.publicBaseUrl') ?? '').replace(
      /\/+$/,
      '',
    );

    this.logger.warn({
      module: 'storage',
      provider: this.name,
      root: this.root,
      msg: 'Đang dùng lưu trữ ĐĨA CỤC BỘ — chỉ phù hợp dev/test. Production hãy đặt STORAGE_PROVIDER=CLOUDFLARE_R2',
    });
  }

  async put(params: PutObjectParams): Promise<PutObjectResult> {
    try {
      const absolutePath = this.toAbsolutePath(params.objectKey);
      await mkdir(join(absolutePath, '..'), { recursive: true });
      await writeFile(absolutePath, params.body);
      return {
        objectKey: params.objectKey,
        publicUrl: this.resolvePublicUrl(params.objectKey),
        bucket: null,
      };
    } catch (error) {
      throw new StorageProviderException(
        StorageProviderErrorKind.UNKNOWN,
        'put',
        (error as Error).message,
        params.objectKey,
        error,
      );
    }
  }

  async get(objectKey: string): Promise<GetObjectResult> {
    try {
      const body = await readFile(this.toAbsolutePath(objectKey));
      return { body, mimeType: 'application/octet-stream', size: body.length };
    } catch (error) {
      throw new StorageProviderException(
        this.isNotFound(error)
          ? StorageProviderErrorKind.OBJECT_NOT_FOUND
          : StorageProviderErrorKind.UNKNOWN,
        'get',
        (error as Error).message,
        objectKey,
        error,
      );
    }
  }

  async delete(objectKey: string): Promise<void> {
    try {
      await unlink(this.toAbsolutePath(objectKey));
    } catch (error) {
      // Xoá file không tồn tại là kết quả mong muốn (idempotent).
      if (this.isNotFound(error)) return;
      throw new StorageProviderException(
        StorageProviderErrorKind.UNKNOWN,
        'delete',
        (error as Error).message,
        objectKey,
        error,
      );
    }
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await stat(this.toAbsolutePath(objectKey));
      return true;
    } catch (error) {
      if (this.isNotFound(error)) return false;
      throw new StorageProviderException(
        StorageProviderErrorKind.UNKNOWN,
        'exists',
        (error as Error).message,
        objectKey,
        error,
      );
    }
  }

  resolvePublicUrl(objectKey: string): string {
    return `${this.publicBaseUrl}${this.urlPrefix}/${objectKey}`;
  }

  private isNotFound(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }

  /** Ghép khoá vào thư mục gốc, đảm bảo không thoát ra ngoài `root` (path traversal). */
  private toAbsolutePath(objectKey: string): string {
    const absolute = resolve(this.root, normalize(objectKey));
    if (!absolute.startsWith(this.root + sep) && absolute !== this.root) {
      throw new Error('Đường dẫn file nằm ngoài thư mục lưu trữ');
    }
    return absolute;
  }
}
