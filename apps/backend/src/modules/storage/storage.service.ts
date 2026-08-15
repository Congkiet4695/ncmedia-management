import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  Prisma,
  StorageFile,
  StorageModuleName,
  StorageProviderName,
  StorageReferenceType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  StorageDeleteFailedException,
  StorageDownloadFailedException,
  StorageExtensionBlockedException,
  StorageFileEmptyException,
  StorageFileInUseException,
  StorageFileMissingException,
  StorageFileNotFoundException,
  StorageFileTooLargeException,
  StorageMimeExtensionMismatchException,
  StorageObjectNotFoundException,
  StorageProviderErrorKind,
  StorageProviderException,
  StorageProviderMisconfiguredException,
  StorageProviderTimeoutException,
  StorageUnsupportedTypeException,
  StorageUploadFailedException,
} from './exceptions/storage.exceptions';
import { StorageProvider } from './interfaces/storage-provider.interface';
import {
  STORAGE_DEFAULT_MAX_BYTES,
  STORAGE_ALLOWED_EXTENSIONS,
  STORAGE_ALLOWED_TYPES,
  STORAGE_BLOCKED_EXTENSIONS,
} from './storage.constants';
import { StorageFileWithUploader, StorageRepository } from './storage.repository';

/** Ngữ cảnh nghiệp vụ của một lần upload. */
export interface UploadContext {
  organizationId: string;
  actorUserId: string;
  module: StorageModuleName;
  referenceType: StorageReferenceType;
  /** ID thực thể nghiệp vụ (nullable với file không gắn thực thể). */
  referenceId?: string | null;
  /**
   * Các đoạn tạo thành thư mục logic, vd `['designs', orgId, orderId, itemId]`.
   * Service sẽ chuẩn hoá và ghép thành object key an toàn.
   */
  folderSegments: string[];
  /** Ghi trong transaction của caller (để upload + ghi nghiệp vụ là nguyên tử). */
  tx?: Prisma.TransactionClient;
}

/**
 * StorageService — cửa DUY NHẤT để mọi module làm việc với file.
 *
 * Trách nhiệm:
 *  - Validate (rỗng / dung lượng / mime / phần mở rộng / đuôi nguy hiểm).
 *  - Sinh object key có cấu trúc, tên file UUID (không dùng tên người dùng).
 *  - Đẩy bytes qua `StorageProvider` (R2 / đĩa cục bộ / S3...).
 *  - Ghi metadata vào `storage_files`.
 *  - Dịch lỗi provider sang exception nghiệp vụ.
 *
 * KHÔNG module nào được gọi thẳng Cloudflare R2 — chỉ đi qua service này.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  private readonly maxFileBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly repo: StorageRepository,
    private readonly provider: StorageProvider,
  ) {
    this.maxFileBytes = this.config.get<number>('storage.maxFileBytes', STORAGE_DEFAULT_MAX_BYTES);
  }

  /** Nhà cung cấp đang hoạt động — dùng cho health check / hiển thị cấu hình. */
  get providerName(): StorageProviderName {
    return this.provider.name;
  }


  /**
   * Dựng thư mục logic mặc định cho một lần upload qua API chung.
   *
   * Luôn bắt đầu bằng `{module}/{organizationId}` để dữ liệu các tổ chức nằm tách biệt
   * ngay trên bucket — thuận tiện khi rà soát, gỡ bỏ hoặc phân quyền ở mức tiền tố.
   * Module nghiệp vụ tự gọi `upload()` có thể truyền `folderSegments` riêng.
   */
  defaultFolderSegments(
    organizationId: string,
    module: StorageModuleName,
    referenceType: StorageReferenceType,
    referenceId?: string | null,
    folder?: string | null,
  ): string[] {
    const middle = folder ? folder.split('/') : [referenceType.toLowerCase()];
    return [
      module.toLowerCase(),
      organizationId,
      ...middle,
      ...(referenceId ? [referenceId] : []),
    ];
  }

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  /** Upload MỘT file: validate → đẩy lên provider → ghi metadata. */
  async upload(
    file: Express.Multer.File | undefined,
    ctx: UploadContext,
  ): Promise<StorageFileWithUploader> {
    this.validateFile(file);

    const extension = this.resolveExtension(file.originalname, file.mimetype);
    const storedName = `${randomUUID()}.${extension}`;
    const folder = this.buildFolder(ctx.folderSegments);
    const objectKey = `${folder}/${storedName}`;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    // Đẩy bytes TRƯỚC, ghi DB sau: nếu ghi DB hỏng thì dọn object vừa tạo.
    const stored = await this.putObject({
      objectKey,
      body: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });

    try {
      const write = () =>
        this.repo.create(
          ctx.tx ?? this.prisma,
          ctx.organizationId,
          ctx.actorUserId,
          {
            module: ctx.module,
            referenceType: ctx.referenceType,
            referenceId: ctx.referenceId ?? null,
            folder,
            objectKey: stored.objectKey,
            originalName: file.originalname.slice(0, 255),
            storedName,
            extension,
            mimeType: file.mimetype,
            fileSize: file.buffer.length,
            publicUrl: stored.publicUrl,
            provider: this.provider.name,
            bucket: stored.bucket,
            checksum,
          },
        );

      // Caller đã mở transaction thì dùng lại; chưa thì tự mở.
      const record = ctx.tx ? await write() : await this.prisma.$transaction(() => write());

      this.logger.log({
        module: 'storage',
        operation: 'upload',
        organizationId: ctx.organizationId,
        provider: this.provider.name,
        objectKey: stored.objectKey,
        sizeBytes: file.buffer.length,
        mimeType: file.mimetype,
        msg: 'Đã tải file lên kho lưu trữ',
      });

      return record;
    } catch (error) {
      // Ghi metadata thất bại ⇒ object trên storage thành rác, phải dọn.
      await this.provider.delete(stored.objectKey).catch(() => undefined);
      this.logger.error({
        module: 'storage',
        operation: 'upload',
        organizationId: ctx.organizationId,
        objectKey: stored.objectKey,
        msg: `Ghi metadata thất bại, đã dọn object: ${(error as Error).message}`,
      });
      throw error;
    }
  }

  /**
   * Upload NHIỀU file trong một lần gọi.
   * Xử lý tuần tự để lỗi ở file thứ n không để lại object rác của các file trước
   * (mỗi file đã tự dọn khi lỗi), đồng thời không tạo burst request lên provider.
   */
  async uploadMany(
    files: Express.Multer.File[] | undefined,
    ctx: UploadContext,
  ): Promise<StorageFileWithUploader[]> {
    if (!files || files.length === 0) throw new StorageFileMissingException();

    const uploaded: StorageFileWithUploader[] = [];
    try {
      for (const file of files) {
        uploaded.push(await this.upload(file, ctx));
      }
      return uploaded;
    } catch (error) {
      // Rollback thủ công: gỡ các file đã lên trước đó để không còn file mồ côi.
      for (const record of uploaded) {
        await this.hardRemove(record, ctx.actorUserId).catch(() => undefined);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Đọc / xoá
  // ---------------------------------------------------------------------------

  async findById(organizationId: string, id: string): Promise<StorageFileWithUploader> {
    const file = await this.repo.findById(organizationId, id);
    if (!file) throw new StorageFileNotFoundException();
    return file;
  }

  findByReference(
    organizationId: string,
    referenceType: StorageReferenceType,
    referenceId: string,
  ): Promise<StorageFileWithUploader[]> {
    return this.repo.findByReference(organizationId, referenceType, referenceId);
  }

  findMany(
    organizationId: string,
    params: Parameters<StorageRepository['findMany']>[1],
  ): ReturnType<StorageRepository['findMany']> {
    return this.repo.findMany(organizationId, params);
  }

  /** Tải nội dung file (dùng khi bucket private hoặc cần proxy có kiểm soát quyền). */
  async download(
    organizationId: string,
    id: string,
  ): Promise<{ file: StorageFileWithUploader; body: Buffer }> {
    const file = await this.findById(organizationId, id);
    try {
      const object = await this.provider.get(file.objectKey);
      return { file, body: object.body };
    } catch (error) {
      throw this.translateProviderError(error, 'download');
    }
  }

  /** File còn tồn tại trên kho lưu trữ hay không (đối soát metadata ↔ storage). */
  async exists(organizationId: string, id: string): Promise<boolean> {
    const file = await this.findById(organizationId, id);
    try {
      return await this.provider.exists(file.objectKey);
    } catch (error) {
      throw this.translateProviderError(error, 'exists');
    }
  }

  /**
   * Xoá file qua API công khai.
   * Chặn khi file vẫn đang được bản ghi nghiệp vụ tham chiếu — phải xoá ở màn hình
   * nghiệp vụ để giữ toàn vẹn dữ liệu (FK `Restrict` là hàng rào cuối cùng).
   */
  async remove(organizationId: string, actorUserId: string, id: string): Promise<void> {
    const file = await this.findById(organizationId, id);
    if ((await this.repo.countReferences(id)) > 0) throw new StorageFileInUseException();
    await this.hardRemove(file, actorUserId);
  }

  /**
   * Xoá file bỏ qua kiểm tra tham chiếu — CHỈ dành cho module nghiệp vụ gọi sau khi
   * đã tự gỡ liên kết (vd thay/xoá design). Không expose qua API.
   */
  async removeInternal(
    organizationId: string,
    actorUserId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const file = await this.repo.findById(organizationId, id);
    if (!file) return;
    await this.hardRemove(file, actorUserId, tx);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Xoá mềm metadata rồi xoá object trên provider (best-effort). */
  private async hardRemove(
    file: StorageFile,
    actorUserId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = (client: Prisma.TransactionClient) =>
      this.repo.softDelete(client, file.id, actorUserId);
    if (tx) await run(tx);
    else await this.prisma.$transaction((client) => run(client));

    try {
      await this.provider.delete(file.objectKey);
    } catch (error) {
      // Metadata đã xoá; object còn sót sẽ được job dọn rác xử lý — không chặn nghiệp vụ.
      this.logger.warn({
        module: 'storage',
        operation: 'delete',
        objectKey: file.objectKey,
        msg: `Không xoá được object trên kho lưu trữ: ${(error as Error).message}`,
      });
      throw this.translateProviderError(error, 'delete');
    }

    this.logger.log({
      module: 'storage',
      operation: 'delete',
      organizationId: file.organizationId,
      objectKey: file.objectKey,
      msg: 'Đã xoá file khỏi kho lưu trữ',
    });
  }

  private async putObject(params: {
    objectKey: string;
    body: Buffer;
    mimeType: string;
    originalName: string;
  }) {
    try {
      return await this.provider.put(params);
    } catch (error) {
      throw this.translateProviderError(error, 'upload');
    }
  }

  /**
   * Kiểm tra file: có mặt, không rỗng, trong giới hạn dung lượng.
   * (Mime/extension kiểm ở `resolveExtension` vì cần cả hai để đối chiếu.)
   */
  private validateFile(
    file?: Express.Multer.File,
  ): asserts file is Express.Multer.File {
    if (!file) throw new StorageFileMissingException();
    if (!file.buffer || file.buffer.length === 0) {
      throw new StorageFileEmptyException(file.originalname);
    }
    if (file.buffer.length > this.maxFileBytes) {
      throw new StorageFileTooLargeException(this.maxFileBytes, file.originalname);
    }
  }

  /**
   * Xác định phần mở rộng an toàn và đối chiếu với mime type.
   *
   * Ba lớp kiểm tra:
   *  1. Đuôi nằm trong danh sách CẤM (exe/sh/php...) → từ chối ngay.
   *  2. Đuôi phải nằm trong danh sách CHO PHÉP.
   *  3. Mime type phải khớp với đuôi (chặn file đổi đuôi để lách bộ lọc).
   */
  private resolveExtension(originalName: string, mimeType: string): string {
    const extension = extname(originalName).replace('.', '').toLowerCase();

    if (!extension) {
      throw new StorageUnsupportedTypeException(STORAGE_ALLOWED_EXTENSIONS, originalName);
    }
    if (STORAGE_BLOCKED_EXTENSIONS.includes(extension)) {
      throw new StorageExtensionBlockedException(extension);
    }
    if (!STORAGE_ALLOWED_EXTENSIONS.includes(extension)) {
      throw new StorageUnsupportedTypeException(STORAGE_ALLOWED_EXTENSIONS, originalName);
    }

    const matched = STORAGE_ALLOWED_TYPES.find((type) => type.extensions.includes(extension));
    if (!matched || !matched.mimeTypes.includes(mimeType)) {
      throw new StorageMimeExtensionMismatchException(mimeType, extension);
    }
    return extension;
  }

  /**
   * Chuẩn hoá thư mục logic thành đường dẫn an toàn.
   * Loại ký tự lạ và mọi thành phần `.`/`..` để không thể thoát khỏi thư mục gốc.
   */
  private buildFolder(segments: string[]): string {
    const cleaned = segments
      .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, ''))
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
    if (cleaned.length === 0) throw new Error('Thư mục lưu trữ không hợp lệ');
    return cleaned.join('/');
  }

  /** Dịch lỗi provider sang exception nghiệp vụ (không lộ chi tiết hạ tầng ra API). */
  private translateProviderError(
    error: unknown,
    operation: 'upload' | 'download' | 'delete' | 'exists',
  ): Error {
    if (!(error instanceof StorageProviderException)) {
      return error instanceof Error ? error : new StorageUploadFailedException();
    }

    switch (error.kind) {
      case StorageProviderErrorKind.TIMEOUT:
        return new StorageProviderTimeoutException();
      case StorageProviderErrorKind.UNAUTHORIZED:
      case StorageProviderErrorKind.BUCKET_NOT_FOUND:
        return new StorageProviderMisconfiguredException(error.kind);
      case StorageProviderErrorKind.OBJECT_NOT_FOUND:
        return new StorageObjectNotFoundException();
      default:
        if (operation === 'delete') return new StorageDeleteFailedException();
        if (operation === 'download' || operation === 'exists') {
          return new StorageDownloadFailedException();
        }
        return new StorageUploadFailedException();
    }
  }
}
