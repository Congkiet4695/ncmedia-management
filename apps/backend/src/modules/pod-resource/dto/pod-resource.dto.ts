import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PodResourceType } from '@prisma/client';
import { POD_RESOURCE_LOG_MAX_ITEMS } from '../constants/pod-resource.constants';

/** Yêu cầu đồng bộ một tài nguyên. Bỏ trống `shopId` = mọi shop đủ điều kiện của tổ chức. */
export class SyncResourceDto {
  @ApiPropertyOptional({ description: 'Chỉ đồng bộ cho một shop' })
  @IsOptional()
  @IsUUID()
  shopId?: string;
}

/** Lọc nhật ký đồng bộ. */
export class ResourceLogQueryDto {
  @ApiPropertyOptional({ enum: PodResourceType })
  @IsOptional()
  @IsEnum(PodResourceType)
  resource?: PodResourceType;

  @ApiPropertyOptional({ description: 'Chỉ lấy nhật ký của một lượt chạy' })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ default: 50, maximum: POD_RESOURCE_LOG_MAX_ITEMS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POD_RESOURCE_LOG_MAX_ITEMS)
  limit?: number;
}

/** Kết quả một lượt đồng bộ, trả thẳng cho màn hình. */
export class ResourceSyncResultDto {
  @ApiProperty({ enum: PodResourceType })
  resource!: PodResourceType;

  @ApiProperty({ description: 'Mã lượt chạy — dùng để mở đúng nhật ký của lượt này' })
  jobId!: string;

  @ApiProperty({ description: 'SUCCESS · PARTIAL · FAILED' })
  status!: string;

  @ApiProperty({ description: 'Tổng số bản ghi ghi được' })
  totalRecords!: number;

  @ApiProperty({ description: 'Thời gian chạy (ms)' })
  durationMs!: number;

  @ApiProperty({ description: 'Số shop đã chạy' })
  shops!: number;

  @ApiProperty({ description: 'Số shop lỗi' })
  failedShops!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  error!: string | null;

  @ApiProperty({ description: 'Chi tiết từng shop', type: 'array', items: { type: 'object' } })
  details!: Array<{ shopId: string; shopName: string; records: number; error?: string }>;
}
