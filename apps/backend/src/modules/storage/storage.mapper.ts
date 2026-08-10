import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageFileDto } from './dto/storage.dto';
import { StorageFileWithUploader } from './storage.repository';

/**
 * StorageMapper — chuyển bản ghi `storage_files` sang DTO trả ra API.
 *
 * Cố tình KHÔNG lộ `objectKey` / `bucket` ra ngoài: đó là chi tiết hạ tầng, biết được
 * chúng là biết cấu trúc bucket. Client làm việc với `id` + `downloadUrl`.
 */
@Injectable()
export class StorageMapper {
  private readonly apiPrefix: string;

  constructor(config: ConfigService) {
    this.apiPrefix = `/${config.get<string>('apiPrefix', 'api/v1').replace(/^\/+|\/+$/g, '')}`;
  }

  /** Đường dẫn tải file qua API — dùng được cả khi bucket private. */
  buildDownloadUrl(id: string): string {
    return `${this.apiPrefix}/storage/${id}/download`;
  }

  toDto(file: StorageFileWithUploader): StorageFileDto {
    return {
      id: file.id,
      module: file.module,
      referenceType: file.referenceType,
      referenceId: file.referenceId,
      originalName: file.originalName,
      extension: file.extension,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      publicUrl: file.publicUrl,
      downloadUrl: this.buildDownloadUrl(file.id),
      provider: file.provider,
      checksum: file.checksum,
      uploadedAt: file.uploadedAt.toISOString(),
      uploadedByName: file.uploader?.fullName ?? null,
      createdAt: file.createdAt.toISOString(),
    };
  }

  toDtoList(files: StorageFileWithUploader[]): StorageFileDto[] {
    return files.map((file) => this.toDto(file));
  }
}
