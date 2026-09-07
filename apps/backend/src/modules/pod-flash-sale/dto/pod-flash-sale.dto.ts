import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PodFlashSaleProductLevel, PodFlashSaleStatus } from '@prisma/client';
import {
  FLASH_SALE_MAX_ADD_PER_CALL,
  FLASH_SALE_MAX_BATCH_ITEMS,
  FLASH_SALE_MAX_ITEMS,
  FLASH_SALE_MAX_QUANTITY,
  FLASH_SALE_SORT_FIELDS,
  FLASH_SALE_TEMPLATE_SORT_FIELDS,
  FLASH_SALE_UNLIMITED,
  type PodFlashSaleSortField,
  type PodFlashSaleTemplateSortField,
} from '../constants/pod-flash-sale.constants';
import { TIKTOK_ACTIVITY_MAX_TITLE_LENGTH } from '../../tiktok-sdk/tiktok-sdk.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Giới hạn mua: `[1, 99]` hoặc `-1`.
 *
 * 🔴 Không dùng được `@Min(1)` vì `-1` là giá trị hợp lệ và `@Min(-1)` thì lọt cả `0`.
 * Ràng buộc thật nằm ở `validateQuantityLimit` (dùng chung với validator nghiệp vụ và
 * CHECK constraint của database) — ở DTO chỉ chặn dải thô để không nhận số vô nghĩa.
 */
const QUANTITY_LIMIT_DESCRIPTION =
  `Số nguyên trong [1, ${FLASH_SALE_MAX_QUANTITY}], hoặc ${FLASH_SALE_UNLIMITED} = không giới hạn.`;

// ---------------------------------------------------------------------------
// Flash Sale — CRUD
// ---------------------------------------------------------------------------

export class CreateFlashSaleDto {
  @ApiProperty({
    description: 'Shop đích. Một Flash Sale chỉ chạy trên đúng MỘT shop (API TikTok là Shop-tag).',
  })
  @IsUUID()
  shopId!: string;

  @ApiProperty({
    example: 'Flash Sale 12.12',
    maxLength: TIKTOK_ACTIVITY_MAX_TITLE_LENGTH,
    description: `Tên hoạt động — TikTok giới hạn ${TIKTOK_ACTIVITY_MAX_TITLE_LENGTH} ký tự và yêu cầu duy nhất trong shop.`,
  })
  @Transform(trim)
  @IsString()
  @MaxLength(TIKTOK_ACTIVITY_MAX_TITLE_LENGTH)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z', description: 'ISO-8601. Lưu ở UTC.' })
  @IsDateString()
  startAt!: string;

  @ApiProperty({ example: '2026-09-01T12:00:00.000Z', description: 'ISO-8601. Phải sau `startAt`.' })
  @IsDateString()
  endAt!: string;

  @ApiPropertyOptional({
    example: 'Asia/Ho_Chi_Minh',
    description: 'Múi giờ người dùng đã nhập — chỉ để hiển thị lại, không đổi giá trị đã lưu.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({
    enum: PodFlashSaleProductLevel,
    default: PodFlashSaleProductLevel.VARIATION,
    description:
      'PRODUCT = một giá cho cả sản phẩm; VARIATION = giá riêng từng SKU (mặc định, giống TikCRM).',
  })
  @IsOptional()
  @IsEnum(PodFlashSaleProductLevel)
  productLevel?: PodFlashSaleProductLevel;

  @ApiPropertyOptional({
    description:
      'Áp Flash Sale Template ngay khi tạo — sản phẩm, giá deal và giới hạn được nạp sẵn.',
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;
}

export class UpdateFlashSaleDto {
  @ApiPropertyOptional({ maxLength: TIKTOK_ACTIVITY_MAX_TITLE_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(TIKTOK_ACTIVITY_MAX_TITLE_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString() startAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endAt?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(64) timezone?: string;

  @ApiPropertyOptional({
    enum: PodFlashSaleProductLevel,
    description:
      'Đổi mức áp dụng. 🔴 Đổi sang PRODUCT sẽ GỘP các dòng SKU của cùng một sản phẩm — ' +
      'hệ thống giữ dòng có giá deal thấp nhất và bỏ phần còn lại.',
  })
  @IsOptional()
  @IsEnum(PodFlashSaleProductLevel)
  productLevel?: PodFlashSaleProductLevel;
}

/** Nhân bản một đợt sale — đúng nghiệp vụ "mỗi ngày tạo mới trong 10 giây". */
export class DuplicateFlashSaleDto {
  @ApiPropertyOptional({
    description: 'Tên đợt mới. Bỏ trống ⇒ hệ thống thêm hậu tố "Copy" (và số thứ tự nếu trùng).',
    maxLength: TIKTOK_ACTIVITY_MAX_TITLE_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(TIKTOK_ACTIVITY_MAX_TITLE_LENGTH)
  name?: string;

  @ApiPropertyOptional({ description: 'Giờ bắt đầu mới. Bỏ trống ⇒ giữ nguyên giờ của đợt gốc.' })
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional({ description: 'Giờ kết thúc mới. Bỏ trống ⇒ giữ nguyên độ dài đợt gốc.' })
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiPropertyOptional({
    description: 'Nhân bản sang shop khác. Bỏ trống ⇒ cùng shop. Sản phẩm phải tồn tại ở shop đích.',
  })
  @IsOptional()
  @IsUUID()
  shopId?: string;
}

export class PodFlashSaleQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo tên Flash Sale hoặc activity_id của TikTok.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: PodFlashSaleStatus })
  @IsOptional()
  @IsEnum(PodFlashSaleStatus)
  status?: PodFlashSaleStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() shopId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;

  @ApiPropertyOptional({ description: 'Lọc đợt sale BẮT ĐẦU từ mốc này (ISO-8601).' })
  @IsOptional()
  @IsDateString()
  startFrom?: string;

  @ApiPropertyOptional({ description: 'Lọc đợt sale BẮT ĐẦU trước mốc này (ISO-8601).' })
  @IsOptional()
  @IsDateString()
  startTo?: string;

  @ApiPropertyOptional({ enum: FLASH_SALE_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(FLASH_SALE_SORT_FIELDS)
  sortBy?: PodFlashSaleSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Item — thêm / sửa / batch
// ---------------------------------------------------------------------------

/**
 * Một dòng được thêm vào Flash Sale.
 *
 * `variantId` bỏ trống ⇒ thêm ở mức SẢN PHẨM. Ở chế độ `VARIATION`, bỏ trống `variantId`
 * nghĩa là "thêm MỌI biến thể của sản phẩm" — đúng thao tác người dùng mong đợi khi tick
 * ô chọn ở cấp sản phẩm trong dialog.
 */
export class AddFlashSaleItemDto {
  @ApiProperty({ description: 'Sản phẩm đã đồng bộ (`pod_products.id`).' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    description:
      'Biến thể cụ thể. Bỏ trống ở chế độ VARIATION = thêm mọi biến thể đang bán của sản phẩm.',
  })
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @ApiPropertyOptional({ description: 'Giá deal. Gửi cùng `discountPercent` thì giá này thắng.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  flashSalePrice?: number;

  @ApiPropertyOptional({ description: '% giảm — dùng khi không gửi `flashSalePrice`.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  discountPercent?: number;

  @ApiPropertyOptional({ description: QUANTITY_LIMIT_DESCRIPTION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FLASH_SALE_UNLIMITED)
  @Max(FLASH_SALE_MAX_QUANTITY)
  totalPurchaseLimit?: number;

  @ApiPropertyOptional({ description: QUANTITY_LIMIT_DESCRIPTION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FLASH_SALE_UNLIMITED)
  @Max(FLASH_SALE_MAX_QUANTITY)
  customerPurchaseLimit?: number;
}

export class AddFlashSaleItemsDto {
  @ApiProperty({ type: [AddFlashSaleItemDto], maxItems: FLASH_SALE_MAX_ADD_PER_CALL })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FLASH_SALE_MAX_ADD_PER_CALL)
  @ValidateNested({ each: true })
  @Type(() => AddFlashSaleItemDto)
  items!: AddFlashSaleItemDto[];
}

/** Sửa MỘT dòng (nút Edit trên bảng sản phẩm). */
export class UpdateFlashSaleItemDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) flashSalePrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) discountPercent?: number;

  @ApiPropertyOptional({ description: QUANTITY_LIMIT_DESCRIPTION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FLASH_SALE_UNLIMITED)
  @Max(FLASH_SALE_MAX_QUANTITY)
  totalPurchaseLimit?: number;

  @ApiPropertyOptional({ description: QUANTITY_LIMIT_DESCRIPTION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FLASH_SALE_UNLIMITED)
  @Max(FLASH_SALE_MAX_QUANTITY)
  customerPurchaseLimit?: number;
}

/**
 * Batch Action — áp một thay đổi cho MỌI dòng được chọn.
 *
 * 🔴 Gửi `discountPercent` thì giá deal của TỪNG dòng được tính lại theo giá gốc RIÊNG của
 * dòng đó — đó là điểm khác biệt giữa "giảm 30% cho 50 sản phẩm" và "đặt tất cả về 20.99".
 * Gửi `flashSalePrice` là đặt cùng MỘT con số cho mọi dòng; hai trường loại trừ nhau.
 */
export class BatchUpdateFlashSaleItemsDto {
  @ApiProperty({ type: [String], maxItems: FLASH_SALE_MAX_BATCH_ITEMS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FLASH_SALE_MAX_BATCH_ITEMS)
  @IsUUID('4', { each: true })
  itemIds!: string[];

  @ApiPropertyOptional({ description: 'Đặt CÙNG một giá deal cho mọi dòng được chọn.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  flashSalePrice?: number;

  @ApiPropertyOptional({ description: 'Giảm theo % — tính lại trên giá gốc của TỪNG dòng.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  discountPercent?: number;

  @ApiPropertyOptional({ description: QUANTITY_LIMIT_DESCRIPTION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FLASH_SALE_UNLIMITED)
  @Max(FLASH_SALE_MAX_QUANTITY)
  totalPurchaseLimit?: number;

  @ApiPropertyOptional({ description: QUANTITY_LIMIT_DESCRIPTION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FLASH_SALE_UNLIMITED)
  @Max(FLASH_SALE_MAX_QUANTITY)
  customerPurchaseLimit?: number;
}

export class DeleteFlashSaleItemsDto {
  @ApiProperty({ type: [String], maxItems: FLASH_SALE_MAX_BATCH_ITEMS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FLASH_SALE_MAX_BATCH_ITEMS)
  @IsUUID('4', { each: true })
  itemIds!: string[];
}

export class PodFlashSaleItemQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: FLASH_SALE_MAX_ITEMS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FLASH_SALE_MAX_ITEMS)
  limit?: number;

  @ApiPropertyOptional({ description: 'Tìm theo tên sản phẩm · SKU · TikTok Product ID.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;
}

// ---------------------------------------------------------------------------
// Publish / Cancel
// ---------------------------------------------------------------------------

export class PublishFlashSaleDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Bỏ qua các dòng KHÔNG hợp lệ và vẫn đẩy phần còn lại. Mặc định `false` — sai một ' +
      'dòng thì dừng cả lượt, để không ai vô tình bán thiếu hàng mà không biết.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipInvalidItems?: boolean;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export class SaveFlashSaleTemplateDto {
  @ApiProperty({ maxLength: 255 })
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateFlashSaleTemplateDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;
}

/** Tạo một Flash Sale MỚI từ template — chỉ còn phải nhập ngày giờ. */
export class ApplyFlashSaleTemplateDto {
  @ApiProperty({ maxLength: TIKTOK_ACTIVITY_MAX_TITLE_LENGTH })
  @Transform(trim)
  @IsString()
  @MaxLength(TIKTOK_ACTIVITY_MAX_TITLE_LENGTH)
  name!: string;

  @ApiProperty() @IsDateString() startAt!: string;
  @ApiProperty() @IsDateString() endAt!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(64) timezone?: string;

  @ApiPropertyOptional({ description: 'Áp sang shop khác shop gốc của template.' })
  @IsOptional()
  @IsUUID()
  shopId?: string;
}

export class PodFlashSaleTemplateQueryDto {
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

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(255) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() shopId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;

  @ApiPropertyOptional({ enum: FLASH_SALE_TEMPLATE_SORT_FIELDS, default: 'updatedAt' })
  @IsOptional()
  @IsIn(FLASH_SALE_TEMPLATE_SORT_FIELDS)
  sortBy?: PodFlashSaleTemplateSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

export class PodFlashSaleLogQueryDto {
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
}
