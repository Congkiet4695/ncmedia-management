import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { PodListingPayloadStatus, PodListingMarket, PodListingReviewStatus } from '@prisma/client';
import {
  POD_DRAFT_GENERATE_MAX_ITEMS,
  POD_DRAFT_SORT_FIELDS,
  type PodDraftSortField,
} from '../constants/pod-listing.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Ghi đè template cho MỘT sản phẩm cụ thể (màn hình Auto Listing).
 *
 * Đúng nhu cầu thực tế: cả lô dùng chung một Listing Template, nhưng vài sản phẩm cần
 * bộ ảnh riêng — không phải vì thế mà tạo thêm một Listing Template gần giống hệt.
 */
export class PayloadProductOverrideDto {
  @ApiProperty({ description: 'Sản phẩm đã đồng bộ (pod_products.id)' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ description: 'Dùng Listing Template khác cho riêng sản phẩm này' })
  @IsOptional()
  @IsUUID()
  listingTemplateId?: string;

  @ApiPropertyOptional({ description: 'Dùng Image Template khác cho riêng sản phẩm này' })
  @IsOptional()
  @IsUUID()
  imageTemplateId?: string;
}

/**
 * Sinh Draft Listing hàng loạt: N sản phẩm × M shop.
 *
 * 🔴 CHỈ ghi vào database. Không gọi Create Product, không Publish, không upload gì
 * lên TikTok — đó là phạm vi Sprint 4.
 */
export class GenerateListingPayloadDto {
  @ApiProperty({ description: 'Listing Template áp cho cả lô', format: 'uuid' })
  @IsUUID()
  listingTemplateId!: string;

  @ApiProperty({
    description: 'Các sản phẩm cần sinh draft',
    type: [String],
    maxItems: POD_DRAFT_GENERATE_MAX_ITEMS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_DRAFT_GENERATE_MAX_ITEMS)
  @IsUUID('4', { each: true })
  productIds!: string[];

  @ApiProperty({ description: 'Các shop đích', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  shopIds!: string[];

  @ApiPropertyOptional({ description: 'Image Template áp cho cả lô (ghi đè template gốc)' })
  @IsOptional()
  @IsUUID()
  imageTemplateId?: string;

  @ApiPropertyOptional({ type: PayloadProductOverrideDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayloadProductOverrideDto)
  overrides?: PayloadProductOverrideDto[];
}

/** Xem trước kết quả áp template lên MỘT sản phẩm — không ghi gì vào DB. */
export class PreviewListingPayloadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listingTemplateId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Shop đích — quyết định kho và cây danh mục dùng để kiểm tra' })
  @IsUUID()
  shopId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  imageTemplateId?: string;
}

/** Bộ lọc danh sách Draft Listing. */
export class PodListingPayloadQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo tiêu đề listing' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: PodListingPayloadStatus })
  @IsOptional()
  @IsEnum(PodListingPayloadStatus)
  status?: PodListingPayloadStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() shopId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() listingTemplateId?: string;

  @ApiPropertyOptional({ enum: PodListingMarket, description: 'Lọc theo thị trường' })
  @IsOptional()
  @IsEnum(PodListingMarket)
  market?: PodListingMarket;

  @ApiPropertyOptional({
    enum: PodListingReviewStatus,
    description: 'Trạng thái DUYỆT phía TikTok (khác `status` — trạng thái gửi của hệ thống)',
  })
  @IsOptional()
  @IsEnum(PodListingReviewStatus)
  reviewStatus?: PodListingReviewStatus;

  @ApiPropertyOptional({ description: 'Chỉ lượt đăng này (Listing Session)' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'true ⇒ chỉ Draft ĐỦ ĐIỀU KIỆN publish (chưa publish, không lỗi validate).',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  publishable?: boolean;

  @ApiPropertyOptional({ description: 'Tra đúng một sản phẩm theo id phía TikTok' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  tiktokProductId?: string;

  @ApiPropertyOptional({ enum: POD_DRAFT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(POD_DRAFT_SORT_FIELDS)
  sortBy?: PodDraftSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/** Giới hạn mỗi lần xoá hàng loạt — đủ cho một trang lớn nhất, đủ nhỏ để request không treo. */
export const POD_DRAFT_BULK_DELETE_MAX = 100;

/** Xoá NHIỀU Draft Listing đã chọn. */
export class BulkDeleteDraftListingsDto {
  @ApiProperty({ type: [String], description: `Id Draft Listing (1–${POD_DRAFT_BULK_DELETE_MAX}, không trùng)` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_DRAFT_BULK_DELETE_MAX)
  @IsUUID('4', { each: true })
  @Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? [...new Set(value)] : value))
  ids!: string[];

  @ApiPropertyOptional({
    description:
      'true ⇒ draft nào đã có Draft Product trên TikTok thì xoá luôn bên TikTok (giống xoá từng cái) — ' +
      'không để lại bản mồ côi trong Seller Center.',
  })
  @IsOptional()
  @IsBoolean()
  remote?: boolean;
}

export class BulkDeleteDraftFailureDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'POD_PAYLOAD_ALREADY_PUBLISHED' }) code!: string;
  @ApiProperty() message!: string;
}

/** Kết quả TỪNG dòng — không bao giờ báo "thành công" chung khi có dòng hỏng. */
export class BulkDeleteDraftListingsResultDto {
  @ApiProperty() requested!: number;
  @ApiProperty({ type: [String] }) deleted!: string[];
  @ApiProperty({ type: [String], description: 'Đã xoá kèm Draft Product trên TikTok' }) removedRemote!: string[];
  @ApiProperty({ type: [BulkDeleteDraftFailureDto] }) failed!: BulkDeleteDraftFailureDto[];
}
