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
} from 'class-validator';
import {
  PodListingJobItemStatus,
  PodListingJobStatus,
  PodListingJobType,
  PodListingLogLevel,
  PodListingMarket,
  PodListingPayloadStatus,
} from '@prisma/client';
import {
  POD_LISTING_JOB_MAX_ITEMS,
  POD_LISTING_JOB_SORT_FIELDS,
  type PodListingJobSortField,
} from '../constants/pod-listing.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Tạo một lượt Bulk Listing.
 *
 * Đúng năm bước của màn hình Auto Listing: Market → Shops → Listing Template → Products →
 * (Preview) → Generate. Số item sinh ra là `productIds × shopIds`.
 */
export class CreateListingJobDto {
  @ApiPropertyOptional({ description: 'Tên lượt chạy. Để trống ⇒ lấy theo tên template.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ enum: PodListingMarket, description: 'Thị trường (Step 1)' })
  @IsEnum(PodListingMarket)
  market!: PodListingMarket;

  @ApiProperty({ description: 'Các shop đích (Step 2 — chọn nhiều)', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  shopIds!: string[];

  @ApiProperty({ description: 'Listing Template áp cho cả lượt (Step 3)', format: 'uuid' })
  @IsUUID()
  listingTemplateId!: string;

  @ApiProperty({
    description: 'Các sản phẩm được chọn (Step 4)',
    type: [String],
    maxItems: POD_LISTING_JOB_MAX_ITEMS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_LISTING_JOB_MAX_ITEMS)
  @IsUUID('4', { each: true })
  productIds!: string[];

  @ApiPropertyOptional({ description: 'Bộ ảnh ghi đè cho cả lượt' })
  @IsOptional()
  @IsUUID()
  imageTemplateId?: string;
}

/** Bộ lọc danh sách Listing Job. */
export class PodListingJobQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo tên lượt chạy' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: PodListingJobStatus })
  @IsOptional()
  @IsEnum(PodListingJobStatus)
  status?: PodListingJobStatus;

  @ApiPropertyOptional({ enum: PodListingMarket })
  @IsOptional()
  @IsEnum(PodListingMarket)
  market?: PodListingMarket;

  @ApiPropertyOptional({
    enum: PodListingJobType,
    description: 'CREATE_DRAFT (tạo Draft) hay PUBLISH (gửi duyệt). Để trống ⇒ cả hai.',
  })
  @IsOptional()
  @IsEnum(PodListingJobType)
  type?: PodListingJobType;

  @ApiPropertyOptional({ enum: POD_LISTING_JOB_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(POD_LISTING_JOB_SORT_FIELDS)
  sortBy?: PodListingJobSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/** Bộ lọc danh sách item trong một Job (màn hình Job Detail). */
export class PodListingJobItemQueryDto {
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

  @ApiPropertyOptional({ enum: PodListingJobItemStatus })
  @IsOptional()
  @IsEnum(PodListingJobItemStatus)
  status?: PodListingJobItemStatus;

  @ApiPropertyOptional({ description: 'Lọc theo shop' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ description: 'Tìm theo tiêu đề sản phẩm' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;
}

/** Bộ lọc nhật ký. */
export class PodListingLogQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ description: 'Chỉ log của MỘT item' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ enum: PodListingLogLevel })
  @IsOptional()
  @IsEnum(PodListingLogLevel)
  level?: PodListingLogLevel;
}

/**
 * Chạy lại phần thất bại của một lượt.
 *
 * Mặc định chạy lại mọi item FAILED/SKIPPED — người dùng vừa sửa template hoặc vừa đồng bộ
 * kho xong thì cả lô hỏng vì một lý do chung.
 */
export class RetryListingJobDto {
  @ApiPropertyOptional({
    description: 'Chỉ chạy lại các item này. Để trống ⇒ toàn bộ item FAILED và SKIPPED.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  itemIds?: string[];
}

/**
 * Tạo một lượt **PUBLISH** — đưa Draft đã có vào hàng chờ duyệt của TikTok.
 *
 * Hai cách gọi, đúng hai nút trên màn hình Draft Listing:
 *  - **Publish Selected** ⇒ truyền `draftIds`.
 *  - **Publish All**      ⇒ bỏ trống `draftIds`, truyền bộ lọc đang hiển thị (`sessionId`,
 *    `shopId`, `market`). Server tự chọn đúng những Draft ĐỦ ĐIỀU KIỆN, thay vì bắt trình
 *    duyệt tải về 2.000 id rồi gửi ngược lên.
 *
 * 🔴 Không có tham số nào bật/tắt `save_mode`: mọi item của lượt này đều đi đường publish.
 */
export class CreatePublishJobDto {
  @ApiPropertyOptional({ description: 'Tên lượt chạy. Để trống ⇒ sinh theo số lượng.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Publish Selected — id các Draft Listing (pod_listing_payloads.id).',
    type: [String],
    maxItems: POD_LISTING_JOB_MAX_ITEMS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POD_LISTING_JOB_MAX_ITEMS)
  @IsUUID('4', { each: true })
  draftIds?: string[];

  @ApiPropertyOptional({ description: 'Publish All — chỉ trong một lượt đăng (Listing Session)' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Publish All — chỉ một shop' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ enum: PodListingMarket, description: 'Publish All — chỉ một thị trường' })
  @IsOptional()
  @IsEnum(PodListingMarket)
  market?: PodListingMarket;

  @ApiPropertyOptional({
    enum: PodListingPayloadStatus,
    description: 'Publish All — chỉ Draft ở trạng thái này (phải nằm trong nhóm được phép publish)',
  })
  @IsOptional()
  @IsEnum(PodListingPayloadStatus)
  status?: PodListingPayloadStatus;

  @ApiPropertyOptional({ description: 'Publish All — chỉ Draft có tiêu đề khớp từ khoá' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;
}
