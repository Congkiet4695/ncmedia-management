import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Trạng thái TỔNG của một lượt nhân bản — **đếm từ item** (từng shop đích), không phải từ
 * trạng thái Listing Job (job gộp SKIPPED vào "có lỗi", còn ở đây SKIPPED = đã có sản phẩm).
 *
 * ```
 *   PENDING     job chưa bắt đầu           — chưa shop nào được xử lý
 *   PROCESSING  còn shop đang chạy         — PENDING / PROCESSING / RETRYING
 *   SUCCESS     mọi shop SUCCESS
 *   PARTIAL     có SUCCESS và có shop không SUCCESS (FAILED / SKIPPED / CANCELLED)
 *   FAILED      không shop nào SUCCESS, có ít nhất một FAILED / CANCELLED
 *   SKIPPED     mọi shop đều bị bỏ qua (đã có sản phẩm ở mọi shop đích) — không phải lỗi
 * ```
 * Trạng thái từng shop nằm ở item, KHÔNG suy ngược từ trạng thái tổng.
 */
export const POD_PRODUCT_CLONE_STATUSES = ['PENDING', 'PROCESSING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED'] as const;
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
