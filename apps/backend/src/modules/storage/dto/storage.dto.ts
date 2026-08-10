import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { StorageModuleName, StorageProviderName, StorageReferenceType } from '@prisma/client';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Body upload (multipart/form-data). File đi kèm ở field `file` (hoặc `files`). */
export class UploadFileDto {
  @ApiProperty({
    enum: StorageModuleName,
    description: 'Module nghiệp vụ sở hữu file',
    example: StorageModuleName.POD_TIKTOK,
  })
  @IsEnum(StorageModuleName, { message: 'module không hợp lệ' })
  module!: StorageModuleName;

  @ApiProperty({
    enum: StorageReferenceType,
    description: 'Loại thực thể mà file gắn vào',
    example: StorageReferenceType.POD_ORDER_ITEM_DESIGN,
  })
  @IsEnum(StorageReferenceType, { message: 'referenceType không hợp lệ' })
  referenceType!: StorageReferenceType;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'ID thực thể nghiệp vụ. Bỏ trống với file không gắn thực thể (vd file export).',
  })
  @IsOptional()
  @IsUUID('4', { message: 'referenceId phải là UUID' })
  referenceId?: string;

  @ApiPropertyOptional({
    description:
      'Các đoạn thư mục logic, phân tách bởi "/". Chỉ chấp nhận chữ, số, dấu chấm, gạch ngang, gạch dưới. ' +
      'Object key cuối cùng = {folder}/{uuid}.{ext}. Bỏ trống thì hệ thống tự dựng theo module.',
    example: 'designs/orders',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(400)
  @Matches(/^[a-zA-Z0-9._\-/]+$/, {
    message: 'folder chỉ được chứa chữ, số, dấu chấm, gạch ngang, gạch dưới và "/"',
  })
  folder?: string;
}

/** Query danh sách file. */
export class StorageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: StorageModuleName })
  @IsOptional()
  @IsEnum(StorageModuleName)
  module?: StorageModuleName;

  @ApiPropertyOptional({ enum: StorageReferenceType })
  @IsOptional()
  @IsEnum(StorageReferenceType)
  referenceType?: StorageReferenceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  referenceId?: string;
}

/** Query tra file theo cặp tham chiếu — `GET /storage/reference`. */
export class StorageReferenceQueryDto {
  @ApiProperty({ enum: StorageReferenceType })
  @IsEnum(StorageReferenceType, { message: 'referenceType không hợp lệ' })
  referenceType!: StorageReferenceType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'referenceId phải là UUID' })
  referenceId!: string;
}

/** Metadata file trả về cho client. KHÔNG chứa bucket/credential. */
export class StorageFileDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: StorageModuleName }) module!: StorageModuleName;
  @ApiProperty({ enum: StorageReferenceType }) referenceType!: StorageReferenceType;
  @ApiProperty({ nullable: true, type: String }) referenceId!: string | null;
  @ApiProperty({ description: 'Tên file gốc người dùng đã chọn' }) originalName!: string;
  @ApiProperty({ description: 'Phần mở rộng đã chuẩn hoá', example: 'png' }) extension!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ description: 'Kích thước (byte)' }) fileSize!: number;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'URL công khai; null khi bucket private — dùng endpoint download thay thế.',
  })
  publicUrl!: string | null;
  @ApiProperty({
    description: 'Đường dẫn tải file qua API (luôn dùng được, kể cả bucket private)',
    example: '/api/v1/storage/{id}/download',
  })
  downloadUrl!: string;
  @ApiProperty({ enum: StorageProviderName }) provider!: StorageProviderName;
  @ApiProperty({ nullable: true, type: String, description: 'sha256 nội dung file' })
  checksum!: string | null;
  @ApiProperty() uploadedAt!: string;
  @ApiProperty({ nullable: true, type: String }) uploadedByName!: string | null;
  @ApiProperty() createdAt!: string;
}

export class StoragePaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedStorageFileDto {
  @ApiProperty({ type: StorageFileDto, isArray: true }) items!: StorageFileDto[];
  @ApiProperty({ type: StoragePaginationMetaDto }) meta!: StoragePaginationMetaDto;
}

/** Kết quả upload — luôn trả mảng để một endpoint phục vụ cả 1 file lẫn nhiều file. */
export class UploadResultDto {
  @ApiProperty({ type: StorageFileDto, isArray: true })
  files!: StorageFileDto[];

  @ApiProperty({ description: 'Số file đã tải lên' }) count!: number;
}
