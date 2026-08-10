import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
 * CloudflareR2Provider — lưu trữ trên Cloudflare R2 qua API tương thích S3.
 *
 * Ghi chú kỹ thuật:
 *  - R2 dùng endpoint `https://{accountId}.r2.cloudflarestorage.com` và region `auto`.
 *  - R2 KHÔNG hỗ trợ ACL của S3 (`ACL: 'public-read'`) — quyền đọc công khai được bật
 *    ở cấp bucket (R2 Public Bucket / custom domain), nên ta chỉ dựng URL từ
 *    `R2_PUBLIC_URL`. Không có `R2_PUBLIC_URL` ⇒ coi bucket là private, file phải
 *    tải qua API (`GET /storage/:id/download`).
 *  - Mọi lỗi SDK được chuyển thành `StorageProviderException` đã phân loại để
 *    tầng service không phụ thuộc vào kiểu lỗi của AWS SDK.
 *
 * Đây là lớp DUY NHẤT trong hệ thống được phép gọi tới R2.
 */
@Injectable()
export class CloudflareR2Provider extends StorageProvider {
  readonly name = StorageProviderName.CLOUDFLARE_R2;

  private readonly logger = new Logger(CloudflareR2Provider.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    super();
    const accountId = config.getOrThrow<string>('storage.r2.accountId');
    this.bucket = config.getOrThrow<string>('storage.r2.bucket');
    this.publicBaseUrl = (config.get<string>('storage.r2.publicUrl') ?? '').replace(/\/+$/, '');

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.getOrThrow<string>('storage.r2.accessKey'),
        secretAccessKey: config.getOrThrow<string>('storage.r2.secretKey'),
      },
      requestHandler: {
        requestTimeout: config.get<number>('storage.timeoutMs', 30_000),
        connectionTimeout: config.get<number>('storage.timeoutMs', 30_000),
      },
    });

    this.logger.log({
      module: 'storage',
      provider: this.name,
      bucket: this.bucket,
      publicUrlConfigured: Boolean(this.publicBaseUrl),
      msg: 'Khởi tạo Cloudflare R2 provider',
    });
  }

  async put(params: PutObjectParams): Promise<PutObjectResult> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.objectKey,
          Body: params.body,
          ContentType: params.mimeType,
          ContentLength: params.body.length,
          // Giữ tên gốc để khi tải về trình duyệt đặt đúng tên (tên trên bucket là UUID).
          ContentDisposition: `inline; filename="${this.sanitizeHeaderValue(params.originalName)}"`,
        }),
      );
      return {
        objectKey: params.objectKey,
        publicUrl: this.resolvePublicUrl(params.objectKey),
        bucket: this.bucket,
      };
    } catch (error) {
      throw this.toProviderException(error, 'put', params.objectKey);
    }
  }

  async get(objectKey: string): Promise<GetObjectResult> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      const body = Buffer.from(await result.Body!.transformToByteArray());
      return {
        body,
        mimeType: result.ContentType ?? 'application/octet-stream',
        size: body.length,
      };
    } catch (error) {
      throw this.toProviderException(error, 'get', objectKey);
    }
  }

  async delete(objectKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (error) {
      const mapped = this.toProviderException(error, 'delete', objectKey);
      // Xoá file không tồn tại là kết quả mong muốn (idempotent).
      if (mapped.kind === StorageProviderErrorKind.OBJECT_NOT_FOUND) return;
      throw mapped;
    }
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return true;
    } catch (error) {
      const mapped = this.toProviderException(error, 'exists', objectKey);
      if (mapped.kind === StorageProviderErrorKind.OBJECT_NOT_FOUND) return false;
      throw mapped;
    }
  }

  resolvePublicUrl(objectKey: string): string | null {
    // Không cấu hình public URL ⇒ bucket private, phải tải qua API.
    return this.publicBaseUrl ? `${this.publicBaseUrl}/${objectKey}` : null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Chuyển lỗi SDK thành lỗi đã phân loại của Storage Module. */
  private toProviderException(
    error: unknown,
    operation: 'put' | 'get' | 'delete' | 'exists',
    objectKey: string,
  ): StorageProviderException {
    const err = error as {
      name?: string;
      Code?: string;
      $metadata?: { httpStatusCode?: number };
      message?: string;
    };
    const code = err.Code ?? err.name ?? '';
    const status = err.$metadata?.httpStatusCode;
    const message = err.message ?? 'Lỗi không xác định từ kho lưu trữ';

    let kind = StorageProviderErrorKind.UNKNOWN;
    // Xét mã lỗi cụ thể TRƯỚC status 404: `NoSuchBucket` cũng trả 404 nhưng là lỗi cấu hình.
    // Nếu nhận nhầm thành OBJECT_NOT_FOUND thì `delete`/`exists` sẽ nuốt lỗi và bucket sai
    // cấu hình trông như "đã xoá thành công".
    if (code === 'NoSuchBucket') {
      kind = StorageProviderErrorKind.BUCKET_NOT_FOUND;
    } else if (code === 'NoSuchKey' || code === 'NotFound' || status === 404) {
      kind = StorageProviderErrorKind.OBJECT_NOT_FOUND;
    } else if (
      code === 'InvalidAccessKeyId' ||
      code === 'SignatureDoesNotMatch' ||
      code === 'AccessDenied' ||
      status === 401 ||
      status === 403
    ) {
      kind = StorageProviderErrorKind.UNAUTHORIZED;
    } else if (
      code === 'TimeoutError' ||
      code === 'RequestTimeout' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ENOTFOUND' ||
      code === 'AbortError'
    ) {
      kind = StorageProviderErrorKind.TIMEOUT;
    }

    // OBJECT_NOT_FOUND là kết quả nghiệp vụ bình thường (delete/exists) ⇒ không log lỗi.
    if (kind !== StorageProviderErrorKind.OBJECT_NOT_FOUND) {
      this.logger.error({
        module: 'storage',
        provider: this.name,
        operation,
        objectKey,
        providerCode: code,
        httpStatus: status,
        kind,
        msg: message,
      });
    }

    return new StorageProviderException(kind, operation, message, objectKey, error);
  }

  /** Loại ký tự xuống dòng/ngoặc kép để không phá header HTTP. */
  private sanitizeHeaderValue(value: string): string {
    return value.replace(/[\r\n"]/g, '').slice(0, 200);
  }
}
