import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Trần của TikTok (Create/Edit Product). Chặn ở cổng API, không đợi sàn từ chối. */
const TITLE_MAX = 255;
const DESCRIPTION_MAX = 10_000;
/** ST words: tối đa 15 từ, tổng 250 ký tự (tài liệu Create Product). */
const SEARCH_TERMS_MAX = 15;

/** Trần ảnh sản phẩm của TikTok. */
const MAIN_IMAGE_MAX = 9;

/**
 * Một tấm ảnh trong bộ ảnh sản phẩm.
 *
 * 🔴 `uri` = ảnh TikTok ĐÃ có (giữ nguyên hoặc chỉ đổi chỗ); `fileId` = file trong Storage
 * cần đẩy lên sàn. Phải có ít nhất một trong hai — backend không tự đi tải ảnh từ URL người
 * dùng gửi, đó là đường vào SSRF.
 */
export class UpdatePodProductImageDto {
  @ApiPropertyOptional({ description: '`uri` TikTok đã cấp cho ảnh đang nằm trên sản phẩm' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(512)
  uri?: string;

  @ApiPropertyOptional({ description: 'File trong Storage Module — sẽ được upload lên TikTok' })
  @IsOptional()
  @IsUUID()
  fileId?: string;
}

/**
 * Bảng size — ảnh tải lên HOẶC bảng size mẫu của TikTok, không cả hai.
 *
 * `templateId` có mặt thì `uri`/`fileId` bị bỏ qua (xem `PodProductEditService.resolveMedia`).
 */
export class UpdatePodProductSizeChartDto extends UpdatePodProductImageDto {
  @ApiPropertyOptional({ description: 'ID bảng size mẫu của TikTok' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  templateId?: string;
}

/** Video sản phẩm — chỉ nhận file đã nằm trong Storage Module. */
export class UpdatePodProductVideoDto {
  @ApiProperty({ description: 'File video trong Storage Module' })
  @IsUUID()
  fileId!: string;
}

/**
 * Một dòng SKU cần sửa.
 *
 * 🔴 `tiktokSkuId` bắt buộc: đó là cách TikTok biết sửa biến thể nào. Không có nó thì sàn
 * có thể hiểu là thêm SKU mới — một biến thể ma trên sản phẩm đang bán.
 */
export class UpdatePodProductSkuDto {
  @ApiProperty({ example: '1729592969712207008' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tiktokSkuId!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(255) sellerSku?: string;

  @ApiPropertyOptional({ description: 'Giá bán (TikTok `price.amount`)', example: '15.00' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  salePrice?: string;

  @ApiPropertyOptional({ description: 'Giá gạch ngang (TikTok `list_price.amount`)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  listPrice?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Tồn kho — cần kèm `warehouseId`' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({
    description:
      'Kho nhận tồn kho mới (`tiktok_warehouse_id`). Thiếu ⇒ phần tồn kho bị BỎ QUA, không đoán.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  warehouseId?: string;
}

/** Kiện hàng — ghi đè từng trường. */
export class UpdatePodProductPackageDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(32) weight?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(16) weightUnit?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(32) length?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(32) width?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(32) height?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(16) dimensionUnit?: string;
}

/**
 * Sửa một sản phẩm ĐANG BÁN trên shop — ánh xạ sang **Partial Edit Product** của TikTok.
 *
 * 🔴 **Trường vắng mặt = KHÔNG đụng tới.** Chuỗi rỗng mới là "xoá". Nhập nhèm hai thứ này là
 * xoá mô tả của một sản phẩm đang bán chỉ vì form không gửi trường đó lên.
 *
 * 🔴 **KHÔNG có `categoryId`**: TikTok không cho đổi danh mục sản phẩm đã tạo qua API này.
 * Nhận trường đó rồi lặng lẽ bỏ qua sẽ khiến người dùng tin là đã đổi được.
 */
export class UpdatePodProductDto {
  @ApiPropertyOptional({ maxLength: TITLE_MAX })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(TITLE_MAX)
  title?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX, description: 'HTML từ rich text editor' })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional({ type: [String], maxItems: SEARCH_TERMS_MAX })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SEARCH_TERMS_MAX)
  @IsString({ each: true })
  searchTerms?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Product Highlights — mỗi dòng một ý' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  highlights?: string[];

  @ApiPropertyOptional({ description: '`brand_id` của TikTok' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  brandId?: string;

  @ApiPropertyOptional({ type: UpdatePodProductPackageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePodProductPackageDto)
  package?: UpdatePodProductPackageDto;

  @ApiPropertyOptional({
    type: UpdatePodProductImageDto,
    isArray: true,
    description:
      'Bộ ảnh sản phẩm SAU khi sửa — đầy đủ và đúng thứ tự (tấm đầu là ảnh đại diện). ' +
      'TikTok THAY cả bộ bằng danh sách này, nên đây không phải danh sách ảnh thêm vào.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAIN_IMAGE_MAX)
  @ValidateNested({ each: true })
  @Type(() => UpdatePodProductImageDto)
  mainImages?: UpdatePodProductImageDto[];

  @ApiPropertyOptional({ type: UpdatePodProductSizeChartDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePodProductSizeChartDto)
  sizeChart?: UpdatePodProductSizeChartDto;

  @ApiPropertyOptional({ type: UpdatePodProductVideoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePodProductVideoDto)
  video?: UpdatePodProductVideoDto;

  @ApiPropertyOptional({
    type: UpdatePodProductSkuDto,
    isArray: true,
    description: 'Chỉ gửi SKU cần sửa — SKU không đổi thì không cần có mặt.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3000)
  @ValidateNested({ each: true })
  @Type(() => UpdatePodProductSkuDto)
  skus?: UpdatePodProductSkuDto[];
}
