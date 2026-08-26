import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { FulfillmentProvider, FulfillmentStatus } from '@prisma/client';
import { PodDesignDto } from '../../pod-tiktok/dto/pod-design.dto';
import { MANGO_SHIPPING_METHODS } from '../mango/constants/mango.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBool = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

// ---------------------------------------------------------------------------
// Tài khoản nhà cung cấp
// ---------------------------------------------------------------------------

export class CreateFulfillmentAccountDto {
  @ApiProperty({ enum: FulfillmentProvider, example: FulfillmentProvider.MANGO })
  @IsEnum(FulfillmentProvider, { message: 'Nhà cung cấp không hợp lệ' })
  provider!: FulfillmentProvider;

  @ApiProperty({ example: 'MangoTeePrints — tài khoản chính' })
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiProperty({
    description:
      'API key của nhà cung cấp. Được MÃ HOÁ AES-256-GCM trước khi lưu và KHÔNG BAO GIỜ ' +
      'trả lại qua API — response chỉ có `apiKeyHint` (4 ký tự cuối).',
  })
  @Transform(trim)
  @IsString()
  @MinLength(8, { message: 'API key quá ngắn — kiểm tra lại khoá đã sao chép' })
  @MaxLength(500)
  apiKey!: string;

  @ApiPropertyOptional({ description: 'Ghi đè base URL (môi trường thử nghiệm).' })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'baseUrl phải là URL hợp lệ' })
  baseUrl?: string;

  @ApiPropertyOptional({ description: '`production_line_id` mặc định khi tạo đơn.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  defaultProductionLine?: string;

  @ApiPropertyOptional({
    enum: MANGO_SHIPPING_METHODS,
    default: 'standard',
    description: 'Phương thức vận chuyển mặc định (giá trị theo enum của nhà cung cấp).',
  })
  @IsOptional()
  @IsIn(MANGO_SHIPPING_METHODS, { message: 'Phương thức vận chuyển không hợp lệ' })
  defaultShippingMethod?: string;

  @ApiPropertyOptional({ description: '`facility` mặc định (chỉ production line TIKTOK).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  defaultFacility?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateFulfillmentAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Chỉ gửi khi muốn ĐỔI API key.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  defaultProductionLine?: string;

  @ApiPropertyOptional({ enum: MANGO_SHIPPING_METHODS })
  @IsOptional()
  @IsIn(MANGO_SHIPPING_METHODS)
  defaultShippingMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  defaultFacility?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDefault?: boolean;
}

export class FulfillmentAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: FulfillmentProvider }) provider!: FulfillmentProvider;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Chỉ 4 ký tự cuối của API key — không bao giờ trả khoá đầy đủ.' })
  apiKeyHint!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty({ nullable: true, type: String }) defaultProductionLine!: string | null;
  @ApiProperty() defaultShippingMethod!: string;
  @ApiProperty({ nullable: true, type: String }) defaultFacility!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'URL webhook đã đăng ký (kèm secret)' })
  webhookUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerWebhookId!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastUsedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastErrorMsg!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({
    enum: ['ACTIVE', 'INACTIVE'],
    description: 'Dạng đọc được của `isActive` — dùng cho bảng quản trị.',
  })
  status!: 'ACTIVE' | 'INACTIVE';
  @ApiProperty({ nullable: true, type: String, description: 'Base URL đang dùng để gọi API.' })
  baseUrl!: string | null;
  @ApiProperty({ description: 'Số kết nối TikTok đang dùng nhà cung cấp này.' })
  linkedTiktokAccounts!: number;
}

/** Nhà cung cấp gán cho đơn — hiển thị ở Order Detail. KHÔNG chứa API key. */
export class FulfillmentStateProviderDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: FulfillmentProvider }) type!: FulfillmentProvider;
  @ApiProperty() isActive!: boolean;
}

/** Mục trong dropdown "Fulfillment Provider" ở màn hình TikTok Account. */
export class FulfillmentProviderOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: FulfillmentProvider }) provider!: FulfillmentProvider;
}

/** Kết quả xoá — nêu rõ hệ quả thay vì chỉ báo "đã xoá". */
export class DeleteFulfillmentAccountResultDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'Số kết nối TikTok bị gỡ liên kết do xoá nhà cung cấp.' })
  unlinkedTiktokAccounts!: number;
  @ApiProperty({ description: 'Số đơn đã từng gửi qua nhà cung cấp này (lịch sử giữ nguyên).' })
  submittedOrders!: number;
}

/** Kết quả Test Connection — không bao giờ chứa API key. */
export class TestConnectionResultDto {
  @ApiProperty() connected!: boolean;
  @ApiProperty({ description: 'Thông báo hiển thị cho người dùng (lấy từ nhà cung cấp khi lỗi).' })
  message!: string;
  @ApiProperty({ nullable: true, type: Number, description: 'Thời gian gọi (ms).' })
  durationMs!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Số production line đọc được — bằng chứng key thực sự dùng được.',
  })
  productionLineCount!: number | null;
}

// ---------------------------------------------------------------------------
// Ánh xạ sản phẩm
// ---------------------------------------------------------------------------

/** Một sản phẩm TikTok đã đồng bộ — nguồn để chọn ở bước 2 của luồng tạo ánh xạ. */
export class TiktokProductOptionDto {
  @ApiProperty({ nullable: true, type: String }) tiktokProductId!: string | null;
  @ApiProperty({ nullable: true, type: String }) tiktokSkuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerSku!: string | null;
  @ApiProperty({ nullable: true, type: String }) productName!: string | null;
  @ApiProperty({ nullable: true, type: String }) skuName!: string | null;
  @ApiProperty({ nullable: true, type: String }) productCategory!: string | null;
  @ApiProperty({ nullable: true, type: String }) skuImage!: string | null;
  @ApiProperty({ description: 'Đã có ánh xạ cho SKU này chưa.' }) mapped!: boolean;
}

/** Meta phân trang chuẩn (ADR-023). */
export class FulfillmentPaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

// ---------------------------------------------------------------------------
// Danh mục nhà cung cấp — ĐỌC TỪ DATABASE
//
// 🔴 Mọi DTO dưới đây được phục vụ từ bảng `fulfillment_catalogues` /
// `fulfillment_products` / `fulfillment_variants`, KHÔNG gọi API nhà cung cấp lúc người dùng
// bấm. Vì thế `id` là khoá nội bộ (uuid) và `externalXxxId` mới là khoá phía nhà cung cấp —
// hai thứ khác nhau, đừng gửi nhầm cái nọ thay cái kia.
// ---------------------------------------------------------------------------

/** Một danh mục (nhóm sản phẩm) phía nhà cung cấp. */
export class CatalogueDto {
  @ApiProperty({ description: 'Khoá nội bộ (uuid) — dùng để lọc sản phẩm.' }) id!: string;
  @ApiProperty({ description: 'ID danh mục phía nhà cung cấp.' }) externalCatalogueId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Lần đồng bộ danh mục gần nhất. NULL = chưa đồng bộ lần nào.',
  })
  lastSyncedAt!: string | null;
}

/** Sản phẩm trong danh mục nhà cung cấp. */
export class ProviderCatalogProductDto {
  @ApiProperty({ description: 'Khoá nội bộ (uuid) — dùng để lấy biến thể.' }) id!: string;
  @ApiProperty({ description: 'ID sản phẩm phía nhà cung cấp.' }) externalProductId!: string;
  @ApiProperty({ nullable: true, type: String }) sku!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) catalogueId!: string | null;
  @ApiProperty({ nullable: true, type: String }) catalogName!: string | null;
  @ApiProperty({ nullable: true, type: String }) basePrice!: string | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ nullable: true, type: String }) imageUrl!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Số biến thể ĐÃ ĐỒNG BỘ (không phải con số nhà cung cấp báo).',
  })
  variationsCount!: number | null;
}

export class PaginatedCatalogProductDto {
  @ApiProperty({ type: ProviderCatalogProductDto, isArray: true })
  items!: ProviderCatalogProductDto[];
  @ApiProperty({ type: FulfillmentPaginationMetaDto }) meta!: FulfillmentPaginationMetaDto;
  @ApiProperty({ nullable: true, type: String }) lastSyncedAt!: string | null;
}

/** Biến thể trong danh mục nhà cung cấp. `sku` là giá trị gửi khi tạo đơn. */
export class ProviderCatalogVariationDto {
  @ApiProperty({ description: 'Khoá nội bộ (uuid).' }) id!: string;
  @ApiProperty({ description: 'ID biến thể phía nhà cung cấp.' }) externalVariantId!: string;
  @ApiProperty({ description: '🔴 Giá trị gửi trong `items[].sku` khi tạo đơn.' }) sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) color!: string | null;
  @ApiProperty({ nullable: true, type: String }) size!: string | null;
  @ApiProperty({ nullable: true, type: String }) price!: string | null;
  @ApiProperty() isAvailable!: boolean;
}

export class CatalogProductQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ description: 'Tìm trong tên, SKU và ID sản phẩm phía nhà cung cấp.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Lọc theo danh mục (khoá nội bộ).' })
  @IsOptional()
  @IsUUID('4')
  catalogueId?: string;
}

/** Kết quả một lượt đồng bộ danh mục. */
export class CatalogSyncResultDto {
  @ApiProperty() accountId!: string;
  @ApiProperty({ enum: FulfillmentProvider }) provider!: FulfillmentProvider;
  @ApiProperty() catalogues!: number;
  @ApiProperty() products!: number;
  @ApiProperty() variants!: number;
  @ApiProperty() archivedCatalogues!: number;
  @ApiProperty() archivedProducts!: number;
  @ApiProperty() archivedVariants!: number;
  @ApiProperty() apiCalls!: number;
  @ApiProperty() durationMs!: number;
  @ApiProperty({
    description:
      'false = có ít nhất một lượt đọc bị cụt; xem `warnings`. Khi đó bước đánh dấu ngừng bán bị bỏ qua.',
  })
  complete!: boolean;
  @ApiProperty({ type: String, isArray: true }) warnings!: string[];
}

/** Kết quả một lượt rà ánh xạ tự động. */
export class AutoMapResultDto {
  @ApiProperty({ description: 'Số cặp (Product ID + Seller SKU) chưa ánh xạ đã đem đi rà.' })
  scanned!: number;
  @ApiProperty({ description: 'Tìm được DUY NHẤT một ứng viên ⇒ đã tạo Product Mapping.' })
  autoMapped!: number;
  @ApiProperty({ description: 'Nhiều ứng viên ⇒ KHÔNG tạo, chờ người dùng chọn.' })
  needManual!: number;
  @ApiProperty({ description: 'Không có ứng viên nào trong danh mục đã đồng bộ.' })
  notFound!: number;
  @ApiProperty({
    description:
      'Chưa rà được: kết nối TikTok chưa gán nhà cung cấp, hoặc danh mục chưa đồng bộ lần nào.',
  })
  skipped!: number;
}

/** Tình trạng bản sao danh mục của một tài khoản. */
export class CatalogStatusDto {
  @ApiProperty() catalogues!: number;
  @ApiProperty() products!: number;
  @ApiProperty() variants!: number;
  @ApiProperty({ nullable: true, type: String }) lastSyncedAt!: string | null;
}

/**
 * Khoá nghiệp vụ của một sản phẩm POD — dùng cho mọi endpoint design.
 *
 * 🔴 Truyền qua query string (không phải path param) vì Seller SKU do người bán tự đặt và có
 * thể chứa dấu `/`, khoảng trắng, ký tự unicode — nhét vào đường dẫn là mời lỗi 404 khó hiểu.
 */
export class ProductDesignKeyDto {
  @ApiProperty({ description: 'TikTok product_id.', example: '17325515559393628715' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Product ID là bắt buộc — design lưu theo cặp khoá này.' })
  @MaxLength(64)
  tiktokProductId!: string;

  @ApiProperty({ description: 'Seller SKU do người bán đặt.', example: 'POSTER_24x36' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Seller SKU là bắt buộc — design lưu theo cặp khoá này.' })
  @MaxLength(255)
  sellerSku!: string;
}

export class UpsertProductMappingDto {
  /**
   * 🔴 KHOÁ NGHIỆP VỤ — bắt buộc. Cặp (Product ID + Seller SKU) là DANH TÍNH của ánh xạ:
   * nó quyết định đơn nào dùng bộ Design nào. Thiếu một nửa thì bản ghi không ghép được với
   * đơn nào, nên nhận vào chỉ để tạo ra dữ liệu chết — từ chối ngay tại cổng.
   */
  @ApiProperty({
    description: 'TikTok product_id. Nửa đầu của khoá nghiệp vụ.',
    example: '17325515559393628715',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Product ID là bắt buộc — đây là một nửa khoá của ánh xạ.' })
  @MaxLength(64)
  tiktokProductId!: string;

  @ApiProperty({
    description: 'Seller SKU do người bán đặt. Nửa sau của khoá nghiệp vụ.',
    example: 'POSTER_24x36',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Seller SKU là bắt buộc — đây là một nửa khoá của ánh xạ.' })
  @MaxLength(255)
  sellerSku!: string;

  @ApiPropertyOptional({
    description:
      'TikTok sku_id — CHỈ để tham chiếu/đối soát. KHÔNG tham gia ghép đơn (xem mapping-match.ts).',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  tiktokSkuId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Tài khoản nhà cung cấp sẽ sản xuất sản phẩm này. ' +
      '🔴 BẮT BUỘC khi tổ chức có nhiều tài khoản cùng một nhà cung cấp: bỏ trống thì hệ ' +
      'thống lấy tài khoản mặc định, và ánh xạ có thể gắn nhầm tài khoản so với tài khoản ' +
      'mà kết nối TikTok của đơn đang dùng.',
  })
  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @ApiProperty({
    description: 'Fulfillment SKU — SKU biến thể phía nhà cung cấp (gửi vào `items[].sku`).',
  })
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  providerSku!: string;

  @ApiPropertyOptional({
    description:
      'Giá vốn nhà cung cấp cho SKU này. Được chép làm ảnh chụp vào đơn lúc gửi sản xuất.',
    example: 12.5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  baseCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  providerProductId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  providerVariantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  providerProductName?: string;

  @ApiPropertyOptional({ description: 'Tên biến thể nguyên văn từ nhà cung cấp (vd "Black / L").' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  providerVariantName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  providerColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  providerSize?: string;

  @ApiPropertyOptional({ description: '`production_config`: default | large' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  productionConfig?: string;

  @ApiPropertyOptional({
    description:
      'Ánh xạ vị trí in riêng cho sản phẩm này. VD: { "FRONT": "front", "BACK": "back" }. ' +
      'Bỏ trống ⇒ dùng ánh xạ mặc định của hệ thống.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  placementMap?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * Tình trạng design của một sản phẩm.
 *
 * Mặt trước là mức tối thiểu để sản xuất; mặt sau là tuỳ chọn (bán áo in một mặt vẫn phải
 * làm việc được). Giá trị này do BACKEND tính để giao diện không tự suy luận một luật khác
 * với luật chặn nút Fulfill.
 */
export type ProductMappingDesignStatus = 'READY' | 'MISSING_FRONT' | 'MISSING_ALL';

export class ProductMappingQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Tìm đồng thời trong tên sản phẩm nhà cung cấp, Seller SKU và Provider SKU.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: FulfillmentProvider, description: 'Lọc theo loại nhà cung cấp.' })
  @IsOptional()
  @IsEnum(FulfillmentProvider)
  provider?: FulfillmentProvider;

  @ApiPropertyOptional({ format: 'uuid', description: 'Lọc theo MỘT nhà cung cấp cụ thể.' })
  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({
    enum: ['READY', 'MISSING'],
    description:
      'Lọc theo tình trạng design. MISSING = chưa có mặt trước ⇒ mọi đơn của sản phẩm này ' +
      'đang bị chặn gửi sản xuất.',
  })
  @IsOptional()
  @IsIn(['READY', 'MISSING'])
  designStatus?: 'READY' | 'MISSING';
}

export class ProductMappingDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Nửa đầu khoá nghiệp vụ. NULL = bản ghi cũ chưa đủ khoá, không ghép được đơn.',
  })
  tiktokProductId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Nửa sau khoá nghiệp vụ.' })
  sellerSku!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Tham chiếu, KHÔNG tham gia ghép đơn.',
  })
  tiktokSkuId!: string | null;
  @ApiProperty({ description: 'Fulfillment SKU gửi sang nhà cung cấp.' }) providerSku!: string;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Giá vốn nhà cung cấp. NULL = chưa khai.',
  })
  baseCost!: number | null;
  @ApiProperty({ nullable: true, type: String }) providerProductId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerVariantId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerProductName!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerVariantName!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerSize!: string | null;
  @ApiProperty({ nullable: true, type: String }) productionConfig!: string | null;
  @ApiProperty({ nullable: true, type: Object }) placementMap!: unknown;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: 'ACTIVE' | 'INACTIVE';
  @ApiProperty({ nullable: true, type: String, description: 'Tên nhà cung cấp (hiển thị).' })
  providerName!: string | null;

  /**
   * 🔴 Design của SẢN PHẨM này — nguồn sự thật duy nhất. Mọi đơn cùng (Product ID + Seller
   * SKU) đọc chính danh sách này; không đơn nào giữ bản sao.
   */
  @ApiProperty({
    type: PodDesignDto,
    isArray: true,
    description: 'File in đang hiệu lực theo vị trí. Rỗng = sản phẩm chưa có design.',
  })
  designs!: PodDesignDto[];

  @ApiProperty({
    enum: ['READY', 'MISSING_FRONT', 'MISSING_ALL'],
    description:
      'READY = có ít nhất mặt trước (mặt sau là tuỳ chọn) · MISSING_FRONT = chỉ có mặt sau · ' +
      'MISSING_ALL = chưa có file nào. Tính ở backend để giao diện và luồng gửi đơn không lệch nhau.',
  })
  designStatus!: ProductMappingDesignStatus;

  @ApiProperty({ nullable: true, type: String, description: 'Người sửa gần nhất.' })
  updatedByName!: string | null;

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class PaginatedProductMappingDto {
  @ApiProperty({ type: ProductMappingDto, isArray: true }) items!: ProductMappingDto[];
  @ApiProperty({ type: FulfillmentPaginationMetaDto }) meta!: FulfillmentPaginationMetaDto;
}

// ---------------------------------------------------------------------------
// Fulfillment
// ---------------------------------------------------------------------------

export class CancelFulfillmentDto {
  @ApiPropertyOptional({ description: 'Lý do huỷ gửi kèm cho nhà cung cấp.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class TriggerFulfillmentSyncDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Chỉ đồng bộ một đơn POD.' })
  @IsOptional()
  @IsUUID()
  podOrderId?: string;
}

export class FulfillmentIssueDto {
  @ApiProperty({ nullable: true, type: String }) tiktokProductId?: string | null;
  @ApiProperty({ nullable: true, type: String }) tiktokSkuId?: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerSku?: string | null;
  @ApiProperty({ nullable: true, type: String }) productName?: string | null;
  @ApiProperty({ nullable: true, type: String }) skuName?: string | null;
  @ApiProperty({ nullable: true, type: String }) productCategory?: string | null;
  @ApiProperty({ example: 'MAPPING_MISSING' }) code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ nullable: true, type: String }) podOrderItemId!: string | null;
}

export class FulfillmentItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) podOrderItemId!: string | null;
  @ApiProperty() providerSku!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ nullable: true, type: Object }) printFiles!: unknown;
  @ApiProperty({ nullable: true, type: String }) color!: string | null;
  @ApiProperty({ nullable: true, type: String }) size!: string | null;
}

export class FulfillmentOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() podOrderId!: string;
  @ApiProperty({ enum: FulfillmentProvider }) provider!: FulfillmentProvider;
  @ApiProperty({ enum: FulfillmentStatus }) status!: FulfillmentStatus;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Trạng thái NGUYÊN VĂN của nhà cung cấp (không dịch).',
  })
  providerStatus!: string | null;
  @ApiProperty({ description: 'Mã đơn NCMedia gửi sang nhà cung cấp' }) externalOrderId!: string;
  @ApiProperty({ nullable: true, type: String }) providerOrderId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerFulfillId!: string | null;
  @ApiProperty({ nullable: true, type: String }) trackingNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) trackingStatus!: string | null;
  @ApiProperty({ nullable: true, type: String }) trackingUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) carrier!: string | null;
  @ApiProperty({ nullable: true, type: String }) labelUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) shippingMethod!: string | null;
  @ApiProperty({ nullable: true, type: String }) productionLine!: string | null;
  @ApiProperty({ nullable: true, type: Number }) total!: number | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty() attemptCount!: number;
  @ApiProperty({ nullable: true, type: String }) lastErrorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastErrorMessage!: string | null;
  @ApiProperty({ nullable: true, type: String }) submittedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastSyncedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelledAt!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Thời điểm đơn hoàn tất tại nhà cung cấp (DELIVERED). Ghi một lần.',
  })
  completedAt!: string | null;
  @ApiProperty({ type: FulfillmentItemDto, isArray: true }) items!: FulfillmentItemDto[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

/** Trạng thái fulfillment kèm đánh giá "gửi được chưa" — dùng cho màn hình đơn. */
export class FulfillmentStateDto {
  @ApiProperty({ nullable: true, type: FulfillmentOrderDto })
  fulfillment!: FulfillmentOrderDto | null;
  @ApiProperty({ description: 'Đủ điều kiện gửi sang xưởng in hay chưa' })
  ready!: boolean;
  @ApiProperty({ type: FulfillmentIssueDto, isArray: true, description: 'Lý do chưa gửi được' })
  issues!: FulfillmentIssueDto[];
  @ApiProperty({ description: 'Có thể bấm Fulfill lúc này không' }) canFulfill!: boolean;
  @ApiProperty({ description: 'Có thể huỷ ở xưởng in không' }) canCancel!: boolean;
  @ApiProperty({
    nullable: true,
    type: FulfillmentStateProviderDto,
    description: 'Nhà cung cấp gán cho kết nối TikTok của đơn. NULL = chưa cấu hình.',
  })
  provider!: FulfillmentStateProviderDto | null;
}

export class FulfillmentHistoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty() trigger!: string;
  @ApiProperty({ nullable: true, type: String }) fromStatus!: string | null;
  @ApiProperty({ nullable: true, type: String }) toStatus!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerStatus!: string | null;
  @ApiProperty() success!: boolean;
  @ApiProperty({ nullable: true, type: String }) message!: string | null;
  @ApiProperty({ nullable: true, type: Object }) payload!: unknown;
  @ApiProperty({ nullable: true, type: Number }) durationMs!: number | null;
  @ApiProperty({ nullable: true, type: String }) requestId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class FulfillmentErrorDto {
  @ApiProperty() id!: string;
  @ApiProperty() operation!: string;
  @ApiProperty() errorClass!: string;
  @ApiProperty({ nullable: true, type: Number }) httpStatus!: number | null;
  @ApiProperty({ nullable: true, type: String }) providerCode!: string | null;
  @ApiProperty() message!: string;
  @ApiProperty({ nullable: true, type: Object }) validationErrors!: unknown;
  @ApiProperty() retryable!: boolean;
  @ApiProperty({ nullable: true, type: String }) requestId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class FulfillmentSyncResultDto {
  @ApiProperty() ordersChecked!: number;
  @ApiProperty() ordersUpdated!: number;
  @ApiProperty() ordersFailed!: number;
  @ApiProperty() apiCalls!: number;
  @ApiProperty() durationMs!: number;
  @ApiProperty() skippedByLock!: boolean;
}
