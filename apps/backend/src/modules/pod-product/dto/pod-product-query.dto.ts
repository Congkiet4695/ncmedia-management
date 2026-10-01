import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
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
  POD_PRODUCT_LOCAL_STATUSES,
  POD_PRODUCT_SORT_FIELDS,
  POD_PRODUCT_STATUS_FILTER_ALL,
  type PodProductFlashSaleFilter,
  type PodProductLocalStatus,
  type PodProductSortField,
} from '../constants/pod-product.constants';

/** Giá trị hợp lệ của `?status=` — nhóm trạng thái hệ thống hoặc `ALL`. */
const POD_PRODUCT_STATUS_FILTER_VALUES = [
  ...POD_PRODUCT_LOCAL_STATUSES,
  POD_PRODUCT_STATUS_FILTER_ALL,
] as const;

/**
 * `?status=ACTIVE,REVIEWING` / `?status=ACTIVE&status=REVIEWING` ⇒ `['ACTIVE','REVIEWING']`.
 * Chuẩn hoá chữ hoa + bỏ trùng; validator bên dưới mới quyết định hợp lệ hay không.
 */
const toStatusList = ({ value }: { value: unknown }): unknown => {
  const raw: unknown = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(raw)) return raw;
  const list = (raw as unknown[])
    .flatMap((item): unknown[] => (typeof item === 'string' ? item.split(',') : [item]))
    .map((item): unknown => (typeof item === 'string' ? item.trim().toUpperCase() : item))
    .filter((item) => item !== '');
  return [...new Set(list)];
};

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

  /**
   * Nhóm trạng thái của hệ thống — xem `POD_PRODUCT_STATUS_MAP`.
   *
   * 🔴 Không truyền ⇒ chỉ `ACTIVE` (giữ nguyên hợp đồng của các màn hình CHỌN sản phẩm như Flash
   * Sale). Màn hình Products gửi tường minh `ALL` để thấy mọi nhóm thuộc phạm vi người dùng.
   */
  @ApiPropertyOptional({
    description:
      'Lọc theo trạng thái hệ thống: ACTIVE · REVIEWING · DEACTIVATED · NEEDS_ATTENTION · ALL. ' +
      'Nhiều giá trị: `status=ACTIVE,REVIEWING`. Bỏ trống = ACTIVE.',
    type: String,
    example: 'ACTIVE,REVIEWING',
  })
  @IsOptional()
  @Transform(toStatusList)
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(POD_PRODUCT_STATUS_FILTER_VALUES, {
    each: true,
    message: `status chỉ nhận: ${POD_PRODUCT_STATUS_FILTER_VALUES.join(', ')}`,
  })
  status?: Array<PodProductLocalStatus | typeof POD_PRODUCT_STATUS_FILTER_ALL>;

  /**
   * Lấy MỌI bản ghi, kể cả DRAFT / DELETED / đã rời tập quản lý.
   *
   * 🔴 Mặc định `false`. Dành cho đối soát / tra cứu lịch sử, không phải cho màn hình quản lý
   * hằng ngày. Bị bỏ qua khi có `status` (bộ lọc nhóm luôn thắng).
   */
  @ApiPropertyOptional({
    default: false,
    description: 'Lấy mọi bản ghi kể cả DRAFT/DELETED (bỏ qua khi có status)',
  })
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
