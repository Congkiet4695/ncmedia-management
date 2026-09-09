import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  POD_PRODUCT_SORT_FIELDS,
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

/**
 * Lọc danh sách **BIẾN THỂ (SKU)** — dùng cho bộ chọn SKU của Flash Sale.
 *
 * 🔴 Vì sao cần một endpoint riêng thay vì lấy `variants` kèm trong danh sách sản phẩm: một
 * shop POD có hàng chục nghìn SKU. Trả sản phẩm kèm toàn bộ biến thể rồi để giao diện tự cắt
 * là kéo cả kho về trình duyệt — đúng thứ mà phân trang sinh ra để tránh. Ở đây ĐƠN VỊ phân
 * trang chính là SKU, nên "20 dòng" luôn là 20 SKU, không phụ thuộc sản phẩm có mấy biến thể.
 */
export class PodProductVariantQueryDto {
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
    description: 'Tìm theo Tên sản phẩm · Tên biến thể · Seller SKU · TikTok SKU ID',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ description: 'Giới hạn trong MỘT shop — bộ chọn Flash Sale luôn gửi.' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ description: 'Chỉ biến thể của một sản phẩm.' })
  @IsOptional()
  @IsUUID()
  productId?: string;
}
