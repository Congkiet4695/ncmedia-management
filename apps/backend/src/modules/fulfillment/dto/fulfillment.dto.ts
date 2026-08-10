import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FulfillmentProvider, FulfillmentStatus } from '@prisma/client';
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
  @ApiProperty({ enum: FulfillmentProvider, example: FulfillmentProvider.MANGOTEE })
  @IsEnum(FulfillmentProvider, { message: 'Nhà cung cấp không hợp lệ' })
  provider!: FulfillmentProvider;

  @ApiProperty({ example: 'MangoTeePrints — tài khoản chính' })
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ description: 'API key của nhà cung cấp. Được mã hoá trước khi lưu.' })
  @Transform(trim)
  @IsString()
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
}

// ---------------------------------------------------------------------------
// Ánh xạ sản phẩm
// ---------------------------------------------------------------------------

export class UpsertProductMappingDto {
  @ApiPropertyOptional({ description: 'TikTok product_id — áp cho mọi biến thể.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  tiktokProductId?: string;

  @ApiPropertyOptional({ description: 'TikTok sku_id — khớp chính xác nhất.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  tiktokSkuId?: string;

  @ApiPropertyOptional({ description: 'Seller SKU do người bán đặt.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  sellerSku?: string;

  @ApiProperty({ description: 'SKU biến thể phía nhà cung cấp (gửi vào `items[].sku`).' })
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  providerSku!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(64)
  providerProductId?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(64)
  providerVariantId?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  providerProductName?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
  providerColor?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
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

  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  note?: string;
}

export class ProductMappingQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Tìm theo SKU hoặc tên sản phẩm.' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255)
  search?: string;
}

export class ProductMappingDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) tiktokProductId!: string | null;
  @ApiProperty({ nullable: true, type: String }) tiktokSkuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerSku!: string | null;
  @ApiProperty() providerSku!: string;
  @ApiProperty({ nullable: true, type: String }) providerProductName!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerSize!: string | null;
  @ApiProperty({ nullable: true, type: String }) productionConfig!: string | null;
  @ApiProperty({ nullable: true, type: Object }) placementMap!: unknown;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() createdAt!: string;
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
