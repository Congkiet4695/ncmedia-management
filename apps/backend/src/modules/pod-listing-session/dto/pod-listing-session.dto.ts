import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsBoolean,
  IsNotEmpty,
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
import { MANUAL_SKU_MAX } from '../../pod-listing/services/pod-manual-listing';
import {
  POD_CUSTOM_LISTING_MAX_SHOPS,
  POD_SESSION_IMPORT_MAX_IMAGES,
  POD_SESSION_MAX_PRODUCTS,
  POD_SESSION_PRODUCT_SORT_FIELDS,
  POD_SESSION_SORT_FIELDS,
  type PodSessionProductSortField,
  type PodSessionSortField,
} from '../constants/pod-listing-session.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Query string gửi `"true"`/`"false"` dạng chuỗi — đổi về boolean trước khi validate. */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

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
/**
 * Trần độ dài mô tả của TikTok (Create Product — "Max length: 10,000 characters").
 * Chặn ngay ở cổng API: vượt trần thì lỗi chỉ lộ ra sau hàng trăm lời gọi TikTok.
 */
const MANUAL_DESCRIPTION_MAX = 10_000;

/** Một giá trị trục biến thể đã chọn cho một SKU (`Color: Black`). */
export class ManualSkuOptionDto {
  @ApiProperty({ example: 'Color' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'Black' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  value!: string;
}

/** Ảnh mặc định của MỘT giá trị trục (Black → black.jpg) — file trong Storage Module. */
export class ManualVariationImageDto {
  @ApiProperty({ example: 'Black' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  value!: string;

  @ApiProperty({ description: 'File ảnh trong Storage Module', format: 'uuid' })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({ description: 'URL xem trước — chỉ để form hiển thị lại, không gửi TikTok' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2048)
  url?: string;
}

/** Một trục biến thể (`Color: Black, White, Navy`). */
export class ManualVariationDto {
  @ApiProperty({ example: 'Color' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: [String], example: ['Black', 'White'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  values!: string[];

  @ApiPropertyOptional({
    type: ManualVariationImageDto,
    isArray: true,
    description:
      'Ảnh mặc định theo giá trị — chỉ có nghĩa ở trục ĐẦU TIÊN (TikTok gắn `sku_img` vào sales ' +
      'attribute đầu). Dòng SKU không có `imageFileId` riêng sẽ kế thừa ảnh của giá trị trục đầu.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ManualVariationImageDto)
  images?: ManualVariationImageDto[];
}

/**
 * Một dòng trong bảng SKU nhập tay.
 *
 * 🔴 Giá để dạng **CHUỖI**, không phải `number`: đây là số tiền, và `0.1 + 0.2` của
 * JavaScript là lý do đủ để không bao giờ cho tiền đi qua kiểu `number`. Cả hệ thống đã
 * dùng chuỗi cho tiền (xem `PodProductResponseMapper`) — giữ nguyên quy ước đó.
 */
export class ManualSkuDto {
  @ApiProperty({ example: 'TEE-BLACK-S' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  sellerSku!: string;

  @ApiPropertyOptional({ type: ManualSkuOptionDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ManualSkuOptionDto)
  optionValues?: ManualSkuOptionDto[];

  @ApiPropertyOptional({ description: 'Giá bán thực tế (TikTok `sale_price`)', example: '19.99' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  salePrice?: string;

  @ApiPropertyOptional({ description: 'Giá gạch ngang (TikTok `original_price`)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  retailPrice?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Ảnh riêng của SKU — file trong Storage Module' })
  @IsOptional()
  @IsUUID()
  imageFileId?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(64) barcode?: string;
}

/**
 * Dữ liệu NHẬP TAY cho riêng một Draft Product — ghi đè template của lượt đăng.
 *
 * 🔴 **Trường vắng mặt = dùng mẫu**, không phải "xoá". Đây là hợp đồng của cả màn hình:
 * mỗi khu vực có một dropdown "Dùng mẫu có sẵn / Nhập tay" riêng, và chỉ khu vực nào người
 * dùng chuyển sang "Nhập tay" mới gửi trường tương ứng lên.
 *
 * Phạm vi hiện tại = lát cắt dọc đã chốt: **Mô tả · Giá/SKU** (tiêu đề vốn đã nằm ở
 * `title`). Thêm section sau chỉ là thêm trường vào đây và thêm nhánh ở `applyManualOverride`.
 */
export class ManualCategoryDto {
  @ApiProperty({ example: '1167376', description: '`category_id` của TikTok' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tiktokCategoryId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) path?: string;
}

export class ManualBrandDto {
  @ApiPropertyOptional({ description: 'Bỏ trống = No brand (mặc định của hàng POD)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  tiktokBrandId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) name?: string;
}

export class ManualAttributeValueDto {
  @ApiPropertyOptional({ description: '`value_id` của TikTok' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) name?: string;
}

export class ManualAttributeDto {
  @ApiProperty({ example: '100398' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tiktokAttributeId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) name?: string;
  @ApiPropertyOptional({ example: 'PRODUCT_PROPERTY' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toBoolean) @IsBoolean() isRequired?: boolean;

  @ApiPropertyOptional({ type: ManualAttributeValueDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ManualAttributeValueDto)
  values?: ManualAttributeValueDto[];

  @ApiPropertyOptional({ type: [String], description: 'Giá trị người dùng tự nhập' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  customValues?: string[];
}

/** Kiện hàng — ghi đè TỪNG trường lên template. */
export class ManualPackageDto {
  @ApiPropertyOptional({ example: '300' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  weight?: string;

  @ApiPropertyOptional({ example: 'GRAM' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(16)
  weightUnit?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(32) length?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(32) width?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(32) height?: string;

  @ApiPropertyOptional({ example: 'CENTIMETER' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(16)
  dimensionUnit?: string;
}

/** Video sản phẩm — file đã nằm trong Storage Module. */
export class ManualVideoDto {
  @ApiProperty({ format: 'uuid', description: 'File trong Storage Module' })
  @IsUUID()
  fileId!: string;

  @ApiPropertyOptional({ description: 'Tên file để hiển thị lại trên form' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  fileName?: string;
}

/** Trần của TikTok cho từ khoá tìm kiếm (Create/Edit Product — `search_terms`). */
export const MANUAL_SEARCH_TERMS_MAX = 15;
/** Số dòng Product Highlights tối đa — mỗi dòng một ý. */
export const MANUAL_HIGHLIGHTS_MAX = 20;

export class ManualListingDataDto {
  @ApiPropertyOptional({
    type: [String],
    maxItems: MANUAL_SEARCH_TERMS_MAX,
    description: 'Từ khoá tìm kiếm (TikTok `search_terms`) — tối đa 15 từ.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MANUAL_SEARCH_TERMS_MAX)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  searchTerms?: string[];

  @ApiPropertyOptional({
    type: [String],
    maxItems: MANUAL_HIGHLIGHTS_MAX,
    description: 'Product Highlights (TikTok `key_product_features`) — mỗi phần tử một ý.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MANUAL_HIGHLIGHTS_MAX)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  highlights?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Kho gợi ý (UUID nội bộ). Publisher vẫn quyết kho theo từng shop lúc đăng — kho không ' +
      'thuộc shop đích thì rơi về cấu hình kho của shop đó.',
  })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({
    type: ManualVideoDto,
    description:
      'Video sản phẩm. Publisher upload file lên TikTok (`/product/202309/files/upload`) rồi ' +
      'gửi kèm `video.id` khi tạo sản phẩm — KHÔNG gửi URL.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ManualVideoDto)
  video?: ManualVideoDto;

  @ApiPropertyOptional({ type: ManualCategoryDto, description: 'Danh mục chọn thẳng trên form' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ManualCategoryDto)
  category?: ManualCategoryDto;

  @ApiPropertyOptional({ type: ManualBrandDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ManualBrandDto)
  brand?: ManualBrandDto;

  @ApiPropertyOptional({
    type: ManualAttributeDto,
    isArray: true,
    description: 'Gửi mảng là THAY TOÀN BỘ bộ thuộc tính của Category Template.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ManualAttributeDto)
  attributes?: ManualAttributeDto[];

  @ApiPropertyOptional({ type: ManualPackageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ManualPackageDto)
  package?: ManualPackageDto;

  @ApiPropertyOptional({
    description:
      'Mô tả HTML. Gửi chuỗi RỖNG = cố ý xoá mô tả (sẽ bị Validate chặn); bỏ trường này = dùng Description Template.',
    maxLength: MANUAL_DESCRIPTION_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MANUAL_DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional({
    type: ManualVariationDto,
    isArray: true,
    description: 'Trục biến thể — lưu để mở lại nháp dựng đúng lưới. Không tự sinh SKU ở server.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ManualVariationDto)
  variations?: ManualVariationDto[];

  @ApiPropertyOptional({
    type: ManualSkuDto,
    isArray: true,
    maxItems: MANUAL_SKU_MAX,
    description: 'Bảng SKU — gửi mảng là THAY TOÀN BỘ biến thể của SKU Template.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MANUAL_SKU_MAX)
  @ValidateNested({ each: true })
  @Type(() => ManualSkuDto)
  skus?: ManualSkuDto[];
}

/** Tạo MỘT Draft Product nhập tay (không qua file import). */
export class CreateSessionProductDto {
  @ApiProperty({ example: 'Comfort Colors Beach Tee' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  title!: string;

  @ApiPropertyOptional({ type: SessionProductImageDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(POD_SESSION_IMPORT_MAX_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => SessionProductImageDto)
  images?: SessionProductImageDto[];

  @ApiPropertyOptional({ type: ManualListingDataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ManualListingDataDto)
  manualData?: ManualListingDataDto;
}

/**
 * **Add Custom Listing** — tạo lượt đăng CHỈ CÓ MỘT sản phẩm nhập tay, trong một lời gọi.
 *
 * 🔴 Vì sao là một endpoint chứ không để frontend gọi ba lần (tạo lượt → thêm sản phẩm →
 * chạy): ba lời gọi là ba cơ hội hỏng giữa chừng, và mỗi lần hỏng để lại một lượt đăng rỗng
 * trong danh sách của người dùng. Ở đây cả hai bước nằm trong một transaction.
 *
 * 🔴 KHÔNG tạo bảng/entity mới: Custom Listing DÙNG LẠI `pod_listing_sessions` — chỉ khác là
 * sản phẩm đến từ form thay vì từ file Excel. Nhờ vậy nó thừa hưởng nguyên vẹn fan-out
 * (sản phẩm × shop), hàng đợi, retry, kết quả theo từng shop và phân quyền theo shop.
 */
export class CreateCustomListingDto {
  @ApiProperty({ description: 'Tên lượt đăng — mặc định lấy theo tiêu đề sản phẩm nếu bỏ trống.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ enum: PodListingMarket })
  @IsEnum(PodListingMarket)
  market!: PodListingMarket;

  @ApiProperty({ type: [String], description: 'Shop đích — có thể chọn nhiều.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_CUSTOM_LISTING_MAX_SHOPS)
  @IsUUID('4', { each: true })
  shopIds!: string[];

  @ApiPropertyOptional({
    type: SessionTemplatesDto,
    description:
      'Mẫu dùng cho những khu vực người dùng KHÔNG nhập tay. Bỏ trống hoàn toàn thì mọi ' +
      'khu vực bắt buộc phải có trong `product.manualData`, nếu không Validate sẽ chặn.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SessionTemplatesDto)
  templates?: SessionTemplatesDto;

  @ApiProperty({ type: CreateSessionProductDto })
  @ValidateNested()
  @Type(() => CreateSessionProductDto)
  product!: CreateSessionProductDto;
}

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

  @ApiPropertyOptional({
    type: ManualListingDataDto,
    description:
      'Dữ liệu nhập tay — gửi object là THAY TOÀN BỘ phần nhập tay. Bỏ trường này = giữ nguyên.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ManualListingDataDto)
  manualData?: ManualListingDataDto;
}

/**
 * **Edit Custom Listing** — sửa lượt đăng một sản phẩm nhập tay, trong MỘT lời gọi.
 *
 * 🔴 Cùng một lượt đăng, cùng một Draft Product: endpoint này CẬP NHẬT tại chỗ, không tạo
 * lượt mới. "Sửa → Lưu → thêm một bản nháp nữa trong danh sách" là đúng lỗi mà endpoint này
 * tồn tại để chặn. Mọi trường đều tuỳ chọn; `product` gửi lên là thay TOÀN BỘ nội dung sản
 * phẩm (tiêu đề + ảnh + dữ liệu nhập tay) — form luôn gửi trạng thái đầy đủ.
 */
export class UpdateCustomListingDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(255) name?: string;

  @ApiPropertyOptional({ enum: PodListingMarket })
  @IsOptional()
  @IsEnum(PodListingMarket)
  market?: PodListingMarket;

  @ApiPropertyOptional({ type: [String], description: 'Gửi mảng là THAY TOÀN BỘ danh sách shop' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_CUSTOM_LISTING_MAX_SHOPS)
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

  @ApiPropertyOptional({ type: UpdateSessionProductDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSessionProductDto)
  product?: UpdateSessionProductDto;
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
