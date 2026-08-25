import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PodListingMarket,
  PodListingSessionImageType,
  PodListingSessionProductStatus,
  PodListingSessionStatus,
} from '@prisma/client';
import {
  POD_SESSION_IMPORT_MAX_IMAGES,
  POD_SESSION_MAX_PRODUCTS,
  POD_SESSION_PRODUCT_SORT_FIELDS,
  POD_SESSION_SORT_FIELDS,
  type PodSessionProductSortField,
  type PodSessionSortField,
} from '../constants/pod-listing-session.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Bộ template của một lượt đăng.
 *
 * Cả năm đều tuỳ chọn ở bước tạo — người dùng dựng session trước rồi bổ sung dần. Cổng
 * Validate mới là nơi bắt buộc phải đủ, và nó nói rõ thiếu cái gì.
 */
export class SessionTemplatesDto {
  @ApiPropertyOptional({ description: 'Category Template — quyết định danh mục + thuộc tính' })
  @IsOptional()
  @IsUUID()
  categoryTemplateId?: string | null;

  @ApiPropertyOptional({ description: 'SKU Template — bộ biến thể dựng sẵn' })
  @IsOptional()
  @IsUUID()
  skuTemplateId?: string | null;

  @ApiPropertyOptional({ description: 'Description Template — mô tả HTML + token' })
  @IsOptional()
  @IsUUID()
  descriptionTemplateId?: string | null;

  @ApiPropertyOptional({ description: 'Image Template — bộ ảnh mockup của phôi' })
  @IsOptional()
  @IsUUID()
  imageTemplateId?: string | null;

  @ApiPropertyOptional({ description: 'Pricing Template — công thức giá' })
  @IsOptional()
  @IsUUID()
  pricingStrategyId?: string | null;
}

/** Tạo một Listing Session (bước "New Listing"). */
export class CreateListingSessionDto {
  @ApiProperty({ example: 'Lô Halloween — tuần 43' })
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: PodListingMarket, description: 'Thị trường của cả lượt đăng' })
  @IsEnum(PodListingMarket)
  market!: PodListingMarket;

  @ApiPropertyOptional({ type: [String], description: 'Shop đích — có thể bổ sung sau' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  shopIds?: string[];

  @ApiPropertyOptional({ type: SessionTemplatesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SessionTemplatesDto)
  templates?: SessionTemplatesDto;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
}

/** Sửa cấu hình session. Trường nào không gửi thì giữ nguyên. */
export class UpdateListingSessionDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(255) name?: string;

  @ApiPropertyOptional({ enum: PodListingMarket })
  @IsOptional()
  @IsEnum(PodListingMarket)
  market?: PodListingMarket;

  @ApiPropertyOptional({ type: [String], description: 'Gửi mảng là THAY TOÀN BỘ danh sách shop' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  shopIds?: string[];

  @ApiPropertyOptional({
    type: SessionTemplatesDto,
    description: 'Gửi object là THAY TOÀN BỘ bộ template (trường bỏ trống = gỡ template đó ra)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SessionTemplatesDto)
  templates?: SessionTemplatesDto;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
}

/** Bộ lọc danh sách session. */
export class PodListingSessionQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo tên lượt đăng' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: PodListingSessionStatus })
  @IsOptional()
  @IsEnum(PodListingSessionStatus)
  status?: PodListingSessionStatus;

  @ApiPropertyOptional({ enum: PodListingMarket })
  @IsOptional()
  @IsEnum(PodListingMarket)
  market?: PodListingMarket;

  @ApiPropertyOptional({ description: 'Lọc theo shop đích' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ enum: POD_SESSION_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(POD_SESSION_SORT_FIELDS)
  sortBy?: PodSessionSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/** Cách xử lý dữ liệu đang có khi import lần nữa vào cùng một session. */
export enum PodSessionImportMode {
  /** Thêm vào danh sách hiện có. */
  APPEND = 'APPEND',
  /** 🔴 Re-import: xoá sạch Draft Product cũ rồi nạp lại từ file mới. */
  REPLACE = 'REPLACE',
}

/** Tham số của một lần import file vào session. */
export class ImportSessionProductsDto {
  @ApiPropertyOptional({
    enum: PodSessionImportMode,
    default: PodSessionImportMode.APPEND,
    description: 'REPLACE = xoá hết Draft Product cũ của session rồi nạp lại (Re-import).',
  })
  @IsOptional()
  @IsEnum(PodSessionImportMode)
  mode?: PodSessionImportMode;
}

/** Ảnh của một Draft Product — sửa tay trên màn hình Edit. */
export class SessionProductImageDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(2048)
  imageUrl!: string;

  @ApiPropertyOptional({ enum: PodListingSessionImageType, default: 'MAIN' })
  @IsOptional()
  @IsEnum(PodListingSessionImageType)
  imageType?: PodListingSessionImageType;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'File trong Storage Module (ảnh do người dùng tải lên)' })
  @IsOptional()
  @IsUUID()
  fileId?: string;
}

/**
 * Sửa một Draft Product trong session.
 *
 * 🔴 Chỉ có tiêu đề và danh sách ảnh gốc — đó là toàn bộ những gì một Draft Product mang.
 * Mô tả, biến thể, giá, tồn, danh mục đến từ bộ template của lượt đăng.
 */
export class UpdateSessionProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1024)
  title?: string;

  @ApiPropertyOptional({
    type: SessionProductImageDto,
    isArray: true,
    maxItems: POD_SESSION_IMPORT_MAX_IMAGES,
    description: 'Ảnh gốc — gửi mảng là THAY TOÀN BỘ',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POD_SESSION_IMPORT_MAX_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => SessionProductImageDto)
  images?: SessionProductImageDto[];
}

/** Bộ lọc danh sách Draft Product trong một session. */
export class PodSessionProductQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Tìm theo tiêu đề' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: PodListingSessionProductStatus })
  @IsOptional()
  @IsEnum(PodListingSessionProductStatus)
  status?: PodListingSessionProductStatus;

  @ApiPropertyOptional({ enum: POD_SESSION_PRODUCT_SORT_FIELDS, default: 'importOrder' })
  @IsOptional()
  @IsIn(POD_SESSION_PRODUCT_SORT_FIELDS)
  sortBy?: PodSessionProductSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/** Xoá nhiều Draft Product. */
export class DeleteSessionProductsDto {
  @ApiProperty({ type: [String], maxItems: POD_SESSION_MAX_PRODUCTS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_SESSION_MAX_PRODUCTS)
  @IsUUID('4', { each: true })
  ids!: string[];
}

/** Xem trước payload của một Draft Product — KHÔNG gửi gì lên sàn. */
export class PreviewSessionProductDto {
  @ApiPropertyOptional({
    description: 'Shop dùng để xem trước. Bỏ trống = shop đầu tiên của session.',
  })
  @IsOptional()
  @IsUUID()
  shopId?: string;
}

/** Start Listing — đưa toàn bộ Draft Product của session lên sàn dưới dạng Draft. */
export class StartSessionListingDto {
  @ApiPropertyOptional({ description: 'Tên lượt chạy. Bỏ trống = lấy tên session.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name?: string;
}
