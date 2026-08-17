import { ApiProperty } from '@nestjs/swagger';

/** Một biến thể (SKU) trong màn hình chi tiết. */
export class PodProductVariantDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '1729592969712207008' }) tiktokSkuId!: string;
  @ApiProperty({ nullable: true, type: String }) sellerSku!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Black / L' })
  variantName!: string | null;
  @ApiProperty({ nullable: true, type: String }) salePrice!: string | null;
  @ApiProperty({ nullable: true, type: String }) listPrice!: string | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ description: 'Tổng tồn kho mọi kho' }) inventoryTotal!: number;
  @ApiProperty({ nullable: true, type: String }) status!: string | null;
  @ApiProperty({ nullable: true, type: String }) imageUrl!: string | null;
}

export class PodProductImageDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) url!: string | null;
  @ApiProperty({ nullable: true, type: String }) thumbUrl!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'ID ảnh phía TikTok' })
  uri!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'NULL = ảnh chính của sản phẩm' })
  variantId!: string | null;
  @ApiProperty() sortOrder!: number;
}

export class PodProductVideoDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) url!: string | null;
  @ApiProperty({ nullable: true, type: String }) coverUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) format!: string | null;
}

export class PodProductAttributeDto {
  @ApiProperty() id!: string;
  @ApiProperty() tiktokAttributeId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ type: [String], description: 'Tên các giá trị đã chọn' })
  values!: string[];
}

/** Hàng trong danh sách sản phẩm. */
export class PodProductListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '1729592969712207008' }) tiktokProductId!: string;
  @ApiProperty({ nullable: true, type: String }) title!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'ACTIVATE' }) status!: string | null;
  @ApiProperty({ nullable: true, type: String }) auditStatus!: string | null;
  @ApiProperty({ nullable: true, type: String }) thumbnailUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) categoryName!: string | null;
  @ApiProperty({ nullable: true, type: String }) brandName!: string | null;
  @ApiProperty() skuCount!: number;
  @ApiProperty() totalInventory!: number;
  @ApiProperty({ nullable: true, type: String }) minPrice!: string | null;
  @ApiProperty({ nullable: true, type: String }) maxPrice!: string | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ nullable: true, type: String }) shopName!: string | null;
  @ApiProperty({ nullable: true, type: String }) accountName!: string | null;
  @ApiProperty({ nullable: true, type: String }) tiktokUpdatedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastSyncedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

/** Chi tiết sản phẩm. */
export class PodProductDetailDto extends PodProductListItemDto {
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) categoryPath!: string | null;
  @ApiProperty({ nullable: true, type: String }) packageWeight!: string | null;
  @ApiProperty({ nullable: true, type: String }) weightUnit!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'D x R x C (kèm đơn vị)' })
  packageDimensions!: string | null;
  @ApiProperty({ type: [String] }) productTags!: string[];
  @ApiProperty({ type: [String] }) salesRegions!: string[];
  @ApiProperty({ type: PodProductVariantDto, isArray: true }) variants!: PodProductVariantDto[];
  @ApiProperty({ type: PodProductImageDto, isArray: true }) images!: PodProductImageDto[];
  @ApiProperty({ type: PodProductVideoDto, isArray: true }) videos!: PodProductVideoDto[];
  @ApiProperty({ type: PodProductAttributeDto, isArray: true })
  attributes!: PodProductAttributeDto[];
}

export class PodProductPaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedPodProductResponseDto {
  @ApiProperty({ type: PodProductListItemDto, isArray: true }) items!: PodProductListItemDto[];
  @ApiProperty({ type: PodProductPaginationMetaDto }) meta!: PodProductPaginationMetaDto;
}

/** Một lượt đồng bộ trong màn hình Sync History. */
export class PodProductSyncHistoryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'INCREMENTAL' }) scope!: string;
  @ApiProperty({ example: 'MANUAL' }) trigger!: string;
  @ApiProperty({ example: 'SUCCESS' }) status!: string;
  @ApiProperty({ nullable: true, type: String }) shopName!: string | null;
  @ApiProperty({ nullable: true, type: String }) accountName!: string | null;
  @ApiProperty() productsFetched!: number;
  @ApiProperty() productsCreated!: number;
  @ApiProperty() productsUpdated!: number;
  @ApiProperty() productsSkipped!: number;
  @ApiProperty() productsFailed!: number;
  @ApiProperty() apiCalls!: number;
  @ApiProperty() startedAt!: string;
  @ApiProperty({ nullable: true, type: String }) finishedAt!: string | null;
  @ApiProperty({ nullable: true, type: Number }) durationMs!: number | null;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
}

export class PaginatedPodProductSyncHistoryDto {
  @ApiProperty({ type: PodProductSyncHistoryDto, isArray: true })
  items!: PodProductSyncHistoryDto[];
  @ApiProperty({ type: PodProductPaginationMetaDto }) meta!: PodProductPaginationMetaDto;
}

/** Kết quả trả về ngay sau khi bấm "Sync Now". */
export class PodProductSyncResultDto {
  @ApiProperty({ description: 'Số shop đã chạy trong lượt này' }) shopsProcessed!: number;
  @ApiProperty() productsFetched!: number;
  @ApiProperty() productsCreated!: number;
  @ApiProperty() productsUpdated!: number;
  @ApiProperty() productsSkipped!: number;
  @ApiProperty() productsFailed!: number;
  @ApiProperty({
    type: [String],
    description: 'ID các lượt đồng bộ vừa tạo — mở Sync History để xem chi tiết',
  })
  historyIds!: string[];
}
