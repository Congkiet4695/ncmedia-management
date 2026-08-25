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
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PodImageAssetType,
  PodListingMarket,
  PodListingScopeMatch,
  PodPriceAdjustmentType,
  PodPricingMarkupType,
} from '@prisma/client';
import {
  POD_ATTRIBUTE_MAX_CUSTOM_VALUES,
  POD_DESCRIPTION_TEMPLATE_MAX_TOKENS,
  POD_IMAGE_TEMPLATE_MAX_ITEMS,
  POD_IMAGE_TEMPLATE_MAX_UPLOAD,
  POD_LISTING_TEMPLATE_MAX_SCOPES,
  POD_PRICING_FORMULA_MAX_LENGTH,
  POD_SKU_TEMPLATE_MAX_VALUES_PER_VARIANT,
  POD_SKU_TEMPLATE_MAX_VARIANTS,
  POD_TEMPLATE_DRY_RUN_MAX_PRODUCTS,
  POD_TEMPLATE_SORT_FIELDS,
  POD_TEMPLATE_TOKEN_CODE_PATTERN,
  type PodTemplateSortField,
} from '../constants/pod-listing.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const toBool = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;
/** Mã token luôn viết HOA — người dùng gõ `material` vẫn khớp `{{MATERIAL}}` trong HTML. */
const upperTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
/**
 * `multipart/form-data` gửi một phần tử thì trình duyệt cho ra CHUỖI, nhiều phần tử mới
 * cho ra mảng. Không chuẩn hoá thì upload đúng một ảnh sẽ trượt validate `IsArray`.
 */
const toArray = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null || Array.isArray(value) ? value : [value];

/** Query chung cho mọi danh sách template — Search · Filter · Sort · Pagination. */
export class PodTemplateQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo tên template' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: PodListingMarket })
  @IsOptional()
  @IsEnum(PodListingMarket)
  market?: PodListingMarket;

  @ApiPropertyOptional({ description: 'Chỉ lấy template đang bật' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeOnly?: boolean;

  @ApiPropertyOptional({ description: 'Chỉ lấy template đang được đặt làm mặc định' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  defaultOnly?: boolean;

  @ApiPropertyOptional({ enum: POD_TEMPLATE_SORT_FIELDS, default: 'displayOrder' })
  @IsOptional()
  @IsIn(POD_TEMPLATE_SORT_FIELDS)
  sortBy?: PodTemplateSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/** Nhân bản template — bỏ trống `name` thì hệ thống tự đặt "… (copy)". */
export class ClonePodTemplateDto {
  @ApiPropertyOptional({ description: 'Tên cho bản sao' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;
}

// ---------------------------------------------------------------------------
// Category Template
// ---------------------------------------------------------------------------

/** MỘT giá trị thuộc tính đã chọn (lấy từ danh sách hợp lệ TikTok đã đồng bộ). */
export class CategoryTemplateAttributeValueDto {
  @ApiProperty({ description: 'ID giá trị phía TikTok' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tiktokValueId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) valueName?: string;
}

/** Giá trị người dùng nhập cho MỘT thuộc tính. Danh sách thuộc tính do TikTok quy định. */
export class CategoryTemplateAttributeDto {
  @ApiProperty({ description: 'ID thuộc tính phía TikTok' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tiktokAttributeId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) attributeName?: string;

  @ApiPropertyOptional({ description: 'PRODUCT_PROPERTY | SALES_PROPERTY — ảnh chụp từ TikTok' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  attributeType?: string;

  @ApiPropertyOptional({ description: 'Thuộc tính này có bắt buộc tại thời điểm nhập không' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isMultipleSelection?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isCustomizable?: boolean;

  @ApiPropertyOptional({ type: CategoryTemplateAttributeValueDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryTemplateAttributeValueDto)
  values?: CategoryTemplateAttributeValueDto[];

  /**
   * Giá trị NGƯỜI DÙNG tự nhập ("30x40", "Oversized").
   *
   * 🔴 Chỉ được gửi khi định nghĩa thuộc tính phía TikTok có `is_customizable = true`.
   * Backend kiểm tra lại với bảng `pod_category_attributes` — cờ `isCustomizable` trong DTO
   * chỉ là ảnh chụp để hiển thị, không phải thứ quyết định quyền.
   */
  @ApiPropertyOptional({
    description: 'Giá trị tự nhập (chỉ với thuộc tính TikTok cho phép custom value)',
    type: [String],
    maxItems: POD_ATTRIBUTE_MAX_CUSTOM_VALUES,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POD_ATTRIBUTE_MAX_CUSTOM_VALUES)
  @Transform(({ value }: { value: unknown }): unknown =>
    Array.isArray(value)
      ? (value as unknown[])
          .map((item) => (typeof item === 'string' ? item.trim() : item))
          .filter(Boolean)
      : value,
  )
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(500, { each: true })
  customValues?: string[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateCategoryTemplateDto {
  @ApiProperty({ example: 'US Men T-Shirt' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: PodListingMarket, description: 'Sales Market' })
  @IsEnum(PodListingMarket)
  market!: PodListingMarket;

  @ApiProperty({ description: 'ID danh mục TikTok (lấy từ cây danh mục đã đồng bộ)' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tiktokCategoryId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) categoryName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) categoryPath?: string;

  @ApiPropertyOptional({ description: 'ID thương hiệu TikTok đã đồng bộ' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tiktokBrandId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) brandName?: string;

  @ApiPropertyOptional({ description: 'Kho mặc định (kho đã đồng bộ từ TikTok)' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Khối lượng kiện — chuỗi, đúng như TikTok yêu cầu' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  packageWeight?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) weightUnit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) packageLength?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) packageWidth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) packageHeight?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) dimensionUnit?: string;

  @ApiPropertyOptional({ description: 'File size chart trong Storage Module' })
  @IsOptional()
  @IsUUID()
  sizeChartFileId?: string;

  @ApiPropertyOptional({ description: 'File Product Video trong Storage Module' })
  @IsOptional()
  @IsUUID()
  videoFileId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: 0, description: 'Display Order' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;

  @ApiPropertyOptional({ type: CategoryTemplateAttributeDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryTemplateAttributeDto)
  attributes?: CategoryTemplateAttributeDto[];
}

export class UpdateCategoryTemplateDto extends CreateCategoryTemplateDto {
  @ApiPropertyOptional({ description: 'Status — tắt là không dùng để ghép Listing Template nữa' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// SKU Template
// ---------------------------------------------------------------------------

/** MỘT giá trị của trục biến thể (Black, White, S, M…). */
export class SkuTemplateVariantValueDto {
  @ApiProperty({ example: 'Black' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  value!: string;

  @ApiPropertyOptional({ description: 'Mã rút gọn dùng khi ghép SKU Code (Black → BLK)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** MỘT trục biến thể. Số trục KHÔNG giới hạn ở Color/Size — người dùng tự đặt tên. */
export class SkuTemplateVariantDto {
  @ApiProperty({ example: 'Color' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;

  @ApiProperty({ type: SkuTemplateVariantValueDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_SKU_TEMPLATE_MAX_VALUES_PER_VARIANT)
  @ValidateNested({ each: true })
  @Type(() => SkuTemplateVariantValueDto)
  values!: SkuTemplateVariantValueDto[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateSkuTemplateDto {
  @ApiProperty({ example: 'Comfort Colors — Color x Size' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({
    type: SkuTemplateVariantDto,
    isArray: true,
    description: 'Các trục biến thể. Hệ thống sinh TOÀN BỘ tổ hợp từ đây.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_SKU_TEMPLATE_MAX_VARIANTS)
  @ValidateNested({ each: true })
  @Type(() => SkuTemplateVariantDto)
  variants!: SkuTemplateVariantDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) skuPrefix?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) skuSuffix?: string;

  @ApiPropertyOptional({ description: 'Giá gốc (gạch ngang) mặc định cho mọi tổ hợp' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  defaultRetailPrice?: number;

  @ApiPropertyOptional({ description: 'Giá bán mặc định cho mọi tổ hợp' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  defaultSalePrice?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  defaultQuantity?: number;

  @ApiPropertyOptional({ description: 'Khuyến mãi mặc định (%)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultDiscount?: number;

  @ApiPropertyOptional({ default: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateSkuTemplateDto extends CreateSkuTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

/** Sửa MỘT tổ hợp SKU đã sinh. */
export class UpdateSkuItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) skuCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) barcode?: string;

  @ApiPropertyOptional({
    enum: PodPriceAdjustmentType,
    description:
      'Cách biến thể này lệch giá so với Pricing Template (vd XXL cộng thêm 2.00 hoặc +10%).',
  })
  @IsOptional()
  @IsEnum(PodPriceAdjustmentType)
  priceAdjustmentType?: PodPriceAdjustmentType;

  @ApiPropertyOptional({ description: 'Số tiền hoặc phần trăm cộng thêm (có thể âm)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-100000)
  @Max(100000)
  priceAdjustmentValue?: number;

  @ApiPropertyOptional({ description: 'Giá gốc (gạch ngang)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  retailPrice?: number;

  @ApiPropertyOptional({ description: 'Giá bán' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salePrice?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discount?: number;

  @ApiPropertyOptional() @IsOptional() @IsUUID() imageFileId?: string;

  @ApiPropertyOptional({ description: 'Enable / Disable tổ hợp này' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
}

/**
 * Sinh bảng SKU từ trục biến thể — hành động do NGƯỜI DÙNG chủ động gọi.
 *
 * 🔴 Lưu template KHÔNG sinh SKU. Chỉ endpoint này mới đụng tới `pod_sku_template_items`.
 */
export class GenerateSkuItemsDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'true = dựng lại từ đầu theo giá trị mặc định (mất chỉnh sửa tay). ' +
      'false (mặc định) = giữ giá/tồn/barcode/ảnh của tổ hợp trùng tên.',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  resetEdits?: boolean;
}

/**
 * Điều kiện lọc theo TRỤC cho Bulk Update: "chỉ cập nhật Color = Black".
 *
 * Cùng một trục ⇒ **HOẶC** (Black hoặc White); khác trục ⇒ **VÀ** (Black VÀ size XL) —
 * cùng quy ước với phạm vi của Listing Template, để người dùng không phải học hai luật.
 */
export class SkuItemFilterDto {
  @ApiProperty({ description: 'Tên trục, vd "Color"' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  variantName!: string;

  @ApiProperty({ description: 'Giá trị của trục, vd "Black"' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  value!: string;
}

/**
 * Cập nhật HÀNG LOẠT tổ hợp SKU (yêu cầu "Bulk Update" của đề bài).
 * Bỏ trống trường nào thì trường đó giữ nguyên.
 */
export class BulkUpdateSkuItemsDto {
  @ApiPropertyOptional({
    description: 'Chỉ áp cho các tổ hợp này. Bỏ trống = áp cho TẤT CẢ tổ hợp của template.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  itemIds?: string[];

  @ApiPropertyOptional({
    type: SkuItemFilterDto,
    isArray: true,
    description: 'Lọc theo giá trị trục — dùng khi muốn "chỉ sửa mọi SKU màu Đen".',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkuItemFilterDto)
  filters?: SkuItemFilterDto[];

  /**
   * Đặt lại mã SKU theo tiền tố: `{prefix}-{mã tổ hợp}`.
   *
   * Mã tổ hợp được dựng lại từ chính giá trị trục của dòng đó, nên bấm Apply nhiều lần vẫn
   * ra cùng một kết quả — không cộng dồn tiền tố.
   */
  @ApiPropertyOptional({ description: 'Tiền tố mã SKU, vd "POSTER"' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  skuPrefix?: string;

  /** Đặt lại barcode theo tiền tố + số thứ tự (`ABC0001`, `ABC0002`…). Cũng idempotent. */
  @ApiPropertyOptional({ description: 'Tiền tố barcode, vd "ABC"' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  barcodePrefix?: string;

  @ApiPropertyOptional({ enum: PodPriceAdjustmentType })
  @IsOptional()
  @IsEnum(PodPriceAdjustmentType)
  priceAdjustmentType?: PodPriceAdjustmentType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-100000)
  @Max(100000)
  priceAdjustmentValue?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) retailPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) salePrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Description Template
// ---------------------------------------------------------------------------

/** Token do người dùng tự đặt — đây là phần "mở rộng được" của Token Engine. */
export class DescriptionTemplateTokenDto {
  @ApiProperty({ example: 'MATERIAL', description: 'Viết trong HTML là {{MATERIAL}}' })
  @Transform(upperTrim)
  @IsString()
  @Matches(POD_TEMPLATE_TOKEN_CODE_PATTERN, {
    message: 'Mã token chỉ gồm CHỮ IN, số và gạch dưới, bắt đầu bằng chữ (vd MATERIAL, SIZE_CHART)',
  })
  code!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) label?: string;

  @ApiProperty({ example: '100% ring-spun cotton' })
  @IsString()
  value!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateDescriptionTemplateDto {
  @ApiProperty({ example: 'Tee — mô tả chuẩn' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({
    description:
      'HTML từ rich text editor. Có thể dùng token hệ thống `{{PRODUCT.TITLE}}`, `{{SHOP.NAME}}`… ' +
      'và token tự đặt ở `tokens` (`{{MATERIAL}}`…). Token lạ được giữ nguyên, KHÔNG eval.',
  })
  @IsString()
  @IsNotEmpty()
  contentHtml!: string;

  @ApiPropertyOptional({ type: DescriptionTemplateTokenDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POD_DESCRIPTION_TEMPLATE_MAX_TOKENS)
  @ValidateNested({ each: true })
  @Type(() => DescriptionTemplateTokenDto)
  tokens?: DescriptionTemplateTokenDto[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateDescriptionTemplateDto extends CreateDescriptionTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

/** Xem trước mô tả đã thay token — không ghi gì vào database. */
export class PreviewDescriptionDto {
  @ApiProperty()
  @IsString()
  contentHtml!: string;

  @ApiPropertyOptional({ type: DescriptionTemplateTokenDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POD_DESCRIPTION_TEMPLATE_MAX_TOKENS)
  @ValidateNested({ each: true })
  @Type(() => DescriptionTemplateTokenDto)
  tokens?: DescriptionTemplateTokenDto[];

  @ApiPropertyOptional({ description: 'Sản phẩm dùng để lấy giá trị token hệ thống' })
  @IsOptional()
  @IsUUID()
  productId?: string;
}

// ---------------------------------------------------------------------------
// Image Template
// ---------------------------------------------------------------------------

export class CreateImageTemplateDto {
  @ApiProperty({ example: 'Comfort Colors' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Mô tả bộ ảnh: phôi nào, dùng cho dòng sản phẩm nào' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

/**
 * Bulk upload ảnh vào bộ.
 *
 * `assetTypes` / `titles` đi **theo đúng thứ tự file** trong request. Thiếu phần tử nào
 * thì phần tử đó dùng `assetType` chung, còn tiêu đề lấy từ tên file.
 */
export class UploadImageItemsDto {
  @ApiPropertyOptional({
    enum: PodImageAssetType,
    description: 'Loại áp cho mọi ảnh trong lần upload này',
  })
  @IsOptional()
  @IsEnum(PodImageAssetType)
  assetType?: PodImageAssetType;

  @ApiPropertyOptional({ enum: PodImageAssetType, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(POD_IMAGE_TEMPLATE_MAX_UPLOAD)
  @IsEnum(PodImageAssetType, { each: true })
  assetTypes?: PodImageAssetType[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(POD_IMAGE_TEMPLATE_MAX_UPLOAD)
  @IsString({ each: true })
  titles?: string[];
}

/** Sửa thông tin một ảnh — không đụng tới file. */
export class UpdateImageItemDto {
  @ApiPropertyOptional({ example: 'Front Mockup' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ enum: PodImageAssetType })
  @IsOptional()
  @IsEnum(PodImageAssetType)
  assetType?: PodImageAssetType;

  @ApiPropertyOptional({ description: 'Ảnh bắt buộc phải có trong listing' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isRequired?: boolean;
}

/** Thứ tự mới sau khi kéo thả — gửi TRỌN danh sách id. */
export class SortImageItemsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_IMAGE_TEMPLATE_MAX_ITEMS)
  @IsUUID('4', { each: true })
  itemIds!: string[];
}

export class UpdateImageTemplateDto extends CreateImageTemplateDto {
  @ApiPropertyOptional({ description: 'Status — tắt là không dùng để ghép Listing Template nữa' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Pricing Strategy
// ---------------------------------------------------------------------------

export class CreatePricingStrategyDto {
  @ApiProperty({ example: 'Tee US — markup 180%' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ description: 'Giá vốn' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost!: number;

  @ApiPropertyOptional({ default: 0, description: 'Phí vận chuyển cộng vào giá vốn' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @ApiPropertyOptional({ enum: PodPricingMarkupType, default: PodPricingMarkupType.PERCENT })
  @IsOptional()
  @IsEnum(PodPricingMarkupType)
  markupType?: PodPricingMarkupType;

  @ApiPropertyOptional({ default: 0, description: '% khi PERCENT, số tiền khi FIXED' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markupValue?: number;

  @ApiPropertyOptional({
    description:
      'Biểu thức khi markupType = FORMULA, vd `(cost + shipping) * 1.8 + 2`. ' +
      'Chỉ dùng biến cost / shipping / base / markup và bốn phép tính.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(POD_PRICING_FORMULA_MAX_LENGTH)
  formula?: string;

  @ApiPropertyOptional({ default: 1, description: 'Giá gốc (gạch ngang) = giá bán × hệ số này' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  retailPriceMultiplier?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({ default: 0, description: 'Làm tròn LÊN tới bội số này. 0 = không tròn.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  roundingIncrement?: number;

  @ApiPropertyOptional({ default: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdatePricingStrategyDto extends CreatePricingStrategyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Listing Template
// ---------------------------------------------------------------------------

/**
 * MỘT dòng quy tắc chọn sản phẩm cho Listing Template.
 *
 * 🔴 Đây là chiều **Template → Product**. Nhiều dòng cùng loại = hợp (OR); khác loại =
 * giao (AND); `isExclude` loại trừ sau cùng.
 */
export class ListingTemplateScopeDto {
  @ApiProperty({ enum: PodListingScopeMatch })
  @IsEnum(PodListingScopeMatch)
  matchType!: PodListingScopeMatch;

  @ApiPropertyOptional({
    description: 'Giá trị so khớp (id danh mục / id brand / id shop / từ khoá / tiền tố SKU)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  value?: string;

  @ApiPropertyOptional({ description: 'Nhãn hiển thị của giá trị (tên danh mục, tên brand…)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  valueLabel?: string;

  @ApiPropertyOptional({ default: false, description: 'LOẠI TRỪ sản phẩm khớp dòng này' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isExclude?: boolean;
}

export class CreateListingTemplateDto {
  @ApiProperty({ example: 'MEN TSHIRT — US' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: PodListingMarket })
  @IsEnum(PodListingMarket)
  market!: PodListingMarket;

  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryTemplateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() skuTemplateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() descriptionTemplateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() imageTemplateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() pricingStrategyId?: string;

  @ApiPropertyOptional({ description: 'Kho đã đồng bộ từ TikTok' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Brand ghi đè brand của Category Template' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tiktokBrandId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) brandName?: string;

  @ApiPropertyOptional({ description: 'Default Shipping — `shipping_template_id` phía TikTok' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  shippingTemplateId?: string;

  @ApiPropertyOptional({ description: 'Số ngày xử lý đơn' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  handlingDays?: number;

  @ApiPropertyOptional({ description: 'Kiện hàng — ghi đè kiện hàng của Category Template' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  packageWeight?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) weightUnit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) packageLength?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) packageWidth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) packageHeight?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) dimensionUnit?: string;

  @ApiPropertyOptional({
    type: ListingTemplateScopeDto,
    isArray: true,
    description: 'Quy tắc chọn tập sản phẩm mà template này áp dụng.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POD_LISTING_TEMPLATE_MAX_SCOPES)
  @ValidateNested({ each: true })
  @Type(() => ListingTemplateScopeDto)
  scopes?: ListingTemplateScopeDto[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateListingTemplateDto extends CreateListingTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

/** Danh sách sản phẩm mà một Listing Template đang bao phủ. */
export class ListingTemplateProductQueryDto {
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

  @ApiPropertyOptional({ description: 'Lọc thêm trong phạm vi đã khớp (tên / mã sản phẩm)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;
}

/**
 * Chạy thử template trên vài sản phẩm THẬT — **không ghi gì vào database**.
 *
 * Đây là cách chứng minh "template này áp được cho tập sản phẩm kia" trước khi sprint sau
 * sinh draft hàng loạt: cùng một hàm resolve, chỉ khác là không lưu.
 */
export class ListingTemplateDryRunDto {
  @ApiPropertyOptional({
    default: 5,
    maximum: POD_TEMPLATE_DRY_RUN_MAX_PRODUCTS,
    description: 'Số sản phẩm lấy từ đầu danh sách khớp để chạy thử',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POD_TEMPLATE_DRY_RUN_MAX_PRODUCTS)
  limit?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Chạy thử đúng những sản phẩm này thay vì lấy theo phạm vi.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POD_TEMPLATE_DRY_RUN_MAX_PRODUCTS)
  @IsUUID('4', { each: true })
  productIds?: string[];
}
