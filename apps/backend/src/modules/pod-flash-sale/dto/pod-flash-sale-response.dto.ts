import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PodFlashSaleItemStatus,
  PodFlashSaleLogAction,
  PodFlashSaleLogLevel,
  PodFlashSaleProductLevel,
  PodFlashSaleStatus,
} from '@prisma/client';

/**
 * Hình dạng response của module Flash Sale.
 *
 * 🔴 Mọi giá tiền trả về dạng **CHUỖI**, không phải `number`. `Decimal` của Prisma vượt độ
 * chính xác của `number` trong JS; serialize thành số là đánh mất chữ số ở đúng chỗ không
 * được phép mất. Frontend hiển thị nguyên chuỗi và chỉ parse khi cần tính toán.
 */

/** Số đếm theo trạng thái dòng — màn hình danh sách và chi tiết đều dùng. */
export class PodFlashSaleItemCountsDto {
  @ApiProperty() TOTAL!: number;
  @ApiProperty() PENDING!: number;
  @ApiProperty() READY!: number;
  @ApiProperty() PUBLISHED!: number;
  @ApiProperty() FAILED!: number;
  @ApiProperty() REMOVED!: number;
}

/** Shop rút gọn — đủ để vẽ cột "Shop" mà không phải gọi thêm API. */
export class PodFlashSaleShopRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() region!: string;
}

export class PodFlashSaleUserRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
}

/** Hàng trong danh sách Flash Sale. */
export class PodFlashSaleListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: PodFlashSaleStatus }) status!: PodFlashSaleStatus;
  @ApiProperty({ enum: PodFlashSaleProductLevel }) productLevel!: PodFlashSaleProductLevel;
  @ApiProperty({ example: 'TIKTOK' }) provider!: string;

  @ApiProperty({ nullable: true, type: String, description: '`activity_id` phía TikTok' })
  providerFlashSaleId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerStatus!: string | null;

  @ApiProperty() startAt!: string;
  @ApiProperty() endAt!: string;
  @ApiProperty() timezone!: string;

  @ApiProperty({ description: 'Số dòng sản phẩm/biến thể' }) itemCount!: number;
  @ApiProperty({ type: PodFlashSaleShopRefDto }) shop!: PodFlashSaleShopRefDto;
  @ApiProperty() accountId!: string;
  @ApiProperty({ nullable: true, type: String }) accountName!: string | null;

  @ApiProperty({ nullable: true, type: PodFlashSaleUserRefDto })
  createdByUser!: PodFlashSaleUserRefDto | null;

  @ApiProperty({ nullable: true, type: String }) lastErrorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastErrorMessage!: string | null;
  @ApiProperty() retryCount!: number;

  @ApiProperty({ nullable: true, type: String }) publishedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastSyncedAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  @ApiProperty({
    description:
      'Giao diện có phải tự làm mới đợt này không (PUBLISHING / RUNNING). Quyết định ở ' +
      'backend để frontend không tự đoán danh sách trạng thái.',
  })
  live!: boolean;
}

/** Một dòng sản phẩm trong đợt sale. */
export class PodFlashSaleItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() productId!: string;
  @ApiProperty({ nullable: true, type: String }) variantId!: string | null;

  @ApiProperty({ nullable: true, type: String }) productTitle!: string | null;
  @ApiProperty({ nullable: true, type: String }) variantName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Ảnh biến thể, không có thì ảnh sản phẩm' })
  imageUrl!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'seller_sku' }) skuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerProductId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerVariantId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'SKU đã được TikTok xác nhận trong hoạt động' })
  providerSkuId!: string | null;

  @ApiProperty({ example: '29.99' }) originalPrice!: string;
  @ApiProperty({ example: '20.99' }) flashSalePrice!: string;
  @ApiProperty({ example: '30.0000' }) discountPercent!: string;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;

  @ApiProperty({ description: '-1 = không giới hạn' }) totalPurchaseLimit!: number;
  @ApiProperty({ description: '-1 = không giới hạn' }) customerPurchaseLimit!: number;

  @ApiProperty({ enum: PodFlashSaleItemStatus }) status!: PodFlashSaleItemStatus;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) error!: string | null;
  @ApiProperty() sortOrder!: number;
}

/** Một lý do khiến đợt sale chưa publish được. */
export class PodFlashSaleIssueDto {
  @ApiProperty({ enum: ['ERROR', 'WARNING'] }) level!: 'ERROR' | 'WARNING';
  @ApiProperty() code!: string;
  @ApiProperty() field!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Dòng gây lỗi (nếu có)' })
  itemId?: string | null;
}

/** Kết quả kiểm tra trước khi publish. */
export class PodFlashSaleValidationDto {
  @ApiProperty() flashSaleId!: string;
  @ApiProperty({ description: 'Không còn lỗi mức ERROR' }) ok!: boolean;
  @ApiProperty({ type: [PodFlashSaleIssueDto] }) issues!: PodFlashSaleIssueDto[];
  @ApiProperty({ description: 'Số dòng đủ điều kiện gửi lên sàn' }) readyItems!: number;
}

/** Một dòng nhật ký (màn hình Detail — tab History). */
export class PodFlashSaleLogDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PodFlashSaleLogAction }) action!: PodFlashSaleLogAction;
  @ApiProperty({ enum: PodFlashSaleLogLevel }) level!: PodFlashSaleLogLevel;
  @ApiProperty() message!: string;
  @ApiProperty({ nullable: true, type: Object, description: 'Thân request đã gửi (đã lược token)' })
  request!: unknown;
  @ApiProperty({ nullable: true, type: Object }) response!: unknown;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '`request_id` của TikTok' })
  requestId!: string | null;
  @ApiProperty() attempt!: number;
  @ApiProperty() createdAt!: string;
}

/** Chi tiết một đợt sale (danh sách + dòng sản phẩm + kiểm tra + số đếm). */
export class PodFlashSaleDetailDto extends PodFlashSaleListItemDto {
  @ApiProperty({ type: [PodFlashSaleItemDto] }) items!: PodFlashSaleItemDto[];
  @ApiProperty({ type: PodFlashSaleItemCountsDto }) counts!: PodFlashSaleItemCountsDto;
  @ApiProperty({ type: PodFlashSaleValidationDto }) validation!: PodFlashSaleValidationDto;
  @ApiProperty({ description: 'Còn được sửa tên / giờ / sản phẩm không' }) editable!: boolean;
  @ApiProperty({ description: 'Nút Publish có bật không' }) publishable!: boolean;
  @ApiProperty({ description: 'Nút Cancel có bật không' }) cancellable!: boolean;
}

export class PaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedPodFlashSaleDto {
  @ApiProperty({ type: [PodFlashSaleListItemDto] }) items!: PodFlashSaleListItemDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

export class PaginatedPodFlashSaleLogDto {
  @ApiProperty({ type: [PodFlashSaleLogDto] }) items!: PodFlashSaleLogDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

/** Một dòng đã lưu trong template. */
export class PodFlashSaleTemplateItemDto {
  @ApiProperty({ nullable: true, type: String }) productId!: string | null;
  @ApiProperty({ nullable: true, type: String }) variantId!: string | null;
  @ApiProperty({ nullable: true, type: String }) skuId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerProductId!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerVariantId!: string | null;
  @ApiProperty({ nullable: true, type: String }) productTitle!: string | null;
  @ApiProperty({ nullable: true, type: String }) variantName!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Giá deal đã chốt (nếu template khoá giá)' })
  flashSalePrice!: string | null;
  @ApiProperty({ example: '30.0000' }) discountPercent!: string;
  @ApiProperty() totalPurchaseLimit!: number;
  @ApiProperty() customerPurchaseLimit!: number;
}

export class PodFlashSaleTemplateDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() accountId!: string;
  @ApiProperty({ type: PodFlashSaleShopRefDto }) shop!: PodFlashSaleShopRefDto;
  @ApiProperty({ enum: PodFlashSaleProductLevel }) productLevel!: PodFlashSaleProductLevel;
  @ApiProperty({ description: 'Số dòng sản phẩm trong template' }) itemCount!: number;
  @ApiProperty({ type: [PodFlashSaleTemplateItemDto] }) items!: PodFlashSaleTemplateItemDto[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class PaginatedPodFlashSaleTemplateDto {
  @ApiProperty({ type: [PodFlashSaleTemplateDto] }) items!: PodFlashSaleTemplateDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

/** Kết quả một lần bấm Publish / Retry. */
export class PodFlashSalePublishResultDto {
  @ApiProperty() flashSaleId!: string;
  @ApiProperty({ enum: PodFlashSaleStatus }) status!: PodFlashSaleStatus;
  @ApiProperty({ nullable: true, type: String }) providerFlashSaleId!: string | null;
  @ApiProperty({ description: 'Số dòng TikTok đã nhận' }) publishedItems!: number;
  @ApiProperty({ description: 'Số dòng bị bỏ qua vì không hợp lệ' }) skippedItems!: number;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
}
