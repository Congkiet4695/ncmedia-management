import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  POD_PRODUCT_FLASH_SALE_FILTERS,
  POD_PRODUCT_SORT_FIELDS,
  type PodProductFlashSaleFilter,
  type PodProductSortField,
} from '../constants/pod-product.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Bộ lọc màn hình Products. */
export class PodProductQueryDto {
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

  @ApiPropertyOptional({
    description: 'Tìm theo Tên sản phẩm · TikTok Product ID · Seller SKU (khớp một trong ba)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ description: 'Lọc theo kết nối TikTok (TikTok Account)' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Lọc theo shop' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({
    description:
      'Trạng thái sản phẩm phía TikTok (ACTIVATE, DRAFT, …) — chuỗi tự do vì TikTok mở rộng giá trị',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  status?: string;

  /**
   * Lấy CẢ sản phẩm đã ngừng bán.
   *
   * 🔴 Mặc định `false`: hệ thống chỉ quản lý sản phẩm ACTIVATE. Cờ này dành cho đối soát
   * / tra cứu lịch sử, không phải cho màn hình quản lý hằng ngày.
   */
  @ApiPropertyOptional({ default: false, description: 'Lấy cả sản phẩm đã ngừng bán' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({ description: 'Lọc theo danh mục (ID nội bộ)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Lọc theo thương hiệu (ID nội bộ)' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  /**
   * Lọc theo Flash Sale trong một KHOẢNG THỜI GIAN (màn hình chọn sản phẩm cho đợt sale).
   *
   * `RUNNING` / `NOT_RUNNING` bắt buộc kèm `flashSaleFrom` + `flashSaleTo` (mốc ISO/UTC —
   * frontend đã quy đổi từ giờ treo tường theo múi giờ của đợt sale, backend KHÔNG đổi múi giờ).
   */
  @ApiPropertyOptional({ enum: POD_PRODUCT_FLASH_SALE_FILTERS, default: 'ALL' })
  @IsOptional()
  @IsIn(POD_PRODUCT_FLASH_SALE_FILTERS)
  flashSale?: PodProductFlashSaleFilter;

  @ApiPropertyOptional({ description: 'Đầu khoảng thời gian (ISO 8601) — bắt buộc khi flashSale ≠ ALL' })
  @ValidateIf((dto: PodProductQueryDto) => dto.flashSale !== undefined && dto.flashSale !== 'ALL')
  @IsDateString()
  flashSaleFrom?: string;

  @ApiPropertyOptional({ description: 'Cuối khoảng thời gian (ISO 8601) — bắt buộc khi flashSale ≠ ALL' })
  @ValidateIf((dto: PodProductQueryDto) => dto.flashSale !== undefined && dto.flashSale !== 'ALL')
  @IsDateString()
  flashSaleTo?: string;

  @ApiPropertyOptional({
    description: 'Đợt sale đang mở — KHÔNG tính chính nó khi xét "đang chạy Flash Sale khác"',
  })
  @IsOptional()
  @IsUUID()
  excludeFlashSaleId?: string;

  @ApiPropertyOptional({ enum: POD_PRODUCT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(POD_PRODUCT_SORT_FIELDS)
  sortBy?: PodProductSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/** Query cho danh sách lịch sử đồng bộ. */
export class PodProductSyncHistoryQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  shopId?: string;
}

/**
 * Yêu cầu đồng bộ thủ công ("Sync Now").
 *
 * Không truyền gì = đồng bộ tăng dần TẤT CẢ shop của tổ chức. Truyền `shopId` để giới hạn,
 * `full = true` để bỏ qua watermark và quét lại toàn bộ.
 */
export class TriggerProductSyncDto {
  @ApiPropertyOptional({ description: 'Chỉ đồng bộ một shop' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ description: 'Chỉ đồng bộ một kết nối TikTok' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({
    description: 'Quét TOÀN BỘ, bỏ qua watermark. Tốn quota TikTok — chỉ dùng khi cần đối soát.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  full?: boolean;

}
