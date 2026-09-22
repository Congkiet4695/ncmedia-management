import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Trạng thái TỔNG của một lượt nhân bản — suy từ trạng thái Listing Job (`type = CLONE`).
 *
 * ```
 *   PENDING     job PENDING                — chưa shop nào được xử lý
 *   PROCESSING  job PROCESSING             — ít nhất một shop đang chạy
 *   SUCCESS     job COMPLETED              — mọi shop SUCCESS
 *   PARTIAL     job COMPLETED_WITH_ERRORS  — có SUCCESS và có FAILED/SKIPPED
 *   FAILED      job FAILED / CANCELLED     — không shop nào SUCCESS
 * ```
 * Trạng thái từng shop nằm ở item, KHÔNG suy ngược từ trạng thái tổng.
 */
export const POD_PRODUCT_CLONE_STATUSES = ['PENDING', 'PROCESSING', 'SUCCESS', 'PARTIAL', 'FAILED'] as const;
export type PodProductCloneStatus = (typeof POD_PRODUCT_CLONE_STATUSES)[number];

/** Bộ lọc màn hình **Clone Products**. */
export class PodProductCloneQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Tên sản phẩm nguồn hoặc TikTok Product ID nguồn' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ description: 'Shop NGUỒN của sản phẩm' })
  @IsOptional()
  @IsUUID()
  sourceShopId?: string;

  @ApiPropertyOptional({ description: 'Có shop ĐÍCH này trong lượt' })
  @IsOptional()
  @IsUUID()
  targetShopId?: string;

  @ApiPropertyOptional({ enum: POD_PRODUCT_CLONE_STATUSES })
  @IsOptional()
  @IsIn(POD_PRODUCT_CLONE_STATUSES)
  status?: PodProductCloneStatus;

  @ApiPropertyOptional({ description: 'Người tạo lượt (Admin lọc theo Seller). Seller luôn chỉ thấy của mình.' })
  @IsOptional()
  @IsUUID()
  createdBy?: string;

  @ApiPropertyOptional({ description: 'Tạo từ (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Tạo đến (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
