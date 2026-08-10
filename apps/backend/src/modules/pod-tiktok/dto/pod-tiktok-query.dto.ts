import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PodTiktokAccountStatus } from '@prisma/client';
import { POD_TIKTOK_SORT_FIELDS, type PodTiktokSortField } from '../constants/tiktok.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Query danh sách kết nối TikTok Shop — pagination page/limit (ADR-023). */
export class PodTiktokAccountQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo tên kết nối / tên seller / tên shop' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: PodTiktokAccountStatus })
  @IsOptional()
  @IsEnum(PodTiktokAccountStatus)
  status?: PodTiktokAccountStatus;

  @ApiPropertyOptional({ enum: POD_TIKTOK_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(POD_TIKTOK_SORT_FIELDS)
  sortBy?: PodTiktokSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

/**
 * Phân công Seller phụ trách cho một kết nối TikTok.
 *
 * `sellerId` là ID **Employee** (không phải User): seller là vai trò nghiệp vụ nên
 * gắn với hồ sơ nhân sự. Chỉ Employee ACTIVE + Role `EMPLOYEE` được chấp nhận.
 */
export class AssignPodSellerDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'ID Employee phụ trách. Truyền null (hoặc bỏ trống) để BỎ PHÂN CÔNG.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'sellerId phải là UUID hợp lệ' })
  sellerId?: string | null;
}

/** Tìm kiếm trong danh sách Seller có thể chọn. */
export class PodSellerOptionQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo họ tên hoặc email.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;
}
