import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

/**
 * Một ảnh trong dải thumbnail của màn hình DANH SÁCH.
 *
 * Hẹp có chủ đích (không dùng `PodProductImageDto`): dòng danh sách chỉ cần link hiển thị,
 * mang thêm `uri`/`variantId`/`sortOrder` cho 20 dòng × 5 ảnh là băng thông thật.
 */
export class PodProductListImageDto {
  @ApiProperty({ nullable: true, type: String }) url!: string | null;
  @ApiProperty({ nullable: true, type: String }) thumbUrl!: string | null;
}

/** Hàng trong danh sách sản phẩm. */
export class PodProductListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '1729592969712207008' }) tiktokProductId!: string;
  @ApiProperty({ nullable: true, type: String }) title!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'ACTIVATE' }) status!: string | null;
  @ApiProperty({ nullable: true, type: String }) auditStatus!: string | null;
  @ApiProperty({ nullable: true, type: String }) thumbnailUrl!: string | null;

  /**
   * Vài ảnh CHÍNH đầu tiên để dựng dải thumbnail (tối đa `POD_PRODUCT_LIST_IMAGE_TAKE`).
   *
   * 🔴 Tên khác `images` của `PodProductDetailDto` một cách CÓ CHỦ Ý: chi tiết trả về mọi
   * ảnh (kể cả ảnh biến thể) với đầy đủ trường, còn đây là danh sách RÚT GỌN và đã CẮT.
   * Trùng tên thì một trong hai hợp đồng sẽ âm thầm nói dối về nội dung của mình.
   * `imageCount` là TỔNG số ảnh chính — giao diện hiện `+N` cho phần không tải về.
   */
  @ApiProperty({ type: PodProductListImageDto, isArray: true })
  mainImages!: PodProductListImageDto[];
  @ApiProperty({ description: 'Tổng số ảnh CHÍNH của sản phẩm' }) imageCount!: number;

  @ApiProperty({ nullable: true, type: String }) categoryName!: string | null;
  @ApiProperty({ nullable: true, type: String }) brandName!: string | null;
  @ApiProperty() skuCount!: number;
  @ApiProperty() totalInventory!: number;
  @ApiProperty({ nullable: true, type: String }) minPrice!: string | null;
  @ApiProperty({ nullable: true, type: String }) maxPrice!: string | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Seller SKU của biến thể đầu tiên — mã đại diện để đối soát nhanh',
  })
  sellerSku!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'GOOD',
    description: 'Hạng chất lượng listing của TikTok (POOR | FAIR | GOOD). Chỉ có ở thị trường US.',
  })
  listingQualityTier!: string | null;

  @ApiProperty({ format: 'uuid', description: 'Shop sở hữu sản phẩm (UUID nội bộ)' }) shopId!: string;
  @ApiProperty({ nullable: true, type: String }) shopName!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Mã shop hiển thị ở Seller Center',
  })
  shopCode!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Tên kết nối do người vận hành đặt' })
  accountName!: string | null;
  @ApiProperty({ nullable: true, type: String }) tiktokUpdatedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastSyncedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

/** Chi tiết sản phẩm. */
/**
 * Bảng size của sản phẩm.
 *
 * 🔴 `uri` mới là thứ gửi lại được cho TikTok; `url` là link xem có hạn dùng. Một sản phẩm
 * dùng bảng size MẪU của TikTok thì chỉ có `templateId`, không có ảnh.
 */
export class PodProductSizeChartDto {
  @ApiProperty({ nullable: true, type: String }) uri!: string | null;
  @ApiProperty({ nullable: true, type: String }) url!: string | null;
  @ApiProperty({ nullable: true, type: String }) templateId!: string | null;
}

export class PodProductDetailDto extends PodProductListItemDto {
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) categoryPath!: string | null;
  @ApiProperty({ nullable: true, type: String, description: '`category_id` phía TikTok' })
  tiktokCategoryId!: string | null;
  @ApiProperty({ nullable: true, type: String }) tiktokBrandId!: string | null;
  @ApiProperty({ nullable: true, type: String }) packageWeight!: string | null;
  @ApiProperty({ nullable: true, type: String }) weightUnit!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'D x R x C (kèm đơn vị)' })
  packageDimensions!: string | null;
  @ApiProperty({ type: [String] }) productTags!: string[];
  @ApiProperty({ type: [String] }) salesRegions!: string[];
  @ApiProperty({ type: [String], description: 'Từ khoá tìm kiếm (ST words)' })
  searchTerms!: string[];
  @ApiProperty({ type: [String], description: 'Product Highlights' })
  highlights!: string[];
  @ApiProperty({
    type: PodProductSizeChartDto,
    nullable: true,
    description: 'Bảng size hiện tại — ảnh tải lên hoặc bảng size mẫu của TikTok.',
  })
  sizeChart!: PodProductSizeChartDto | null;
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
  @ApiProperty({ description: 'Số sản phẩm bị đánh dấu ngừng bán trong lượt (chỉ FULL)' })
  productsDeactivated!: number;
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
/** Một shop chạy hỏng trong lượt đồng bộ — giữ NGUYÊN VĂN lỗi TikTok trả về. */
export class PodProductSyncShopErrorDto {
  @ApiProperty() shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Mã lỗi TikTok hoặc mã nội bộ' })
  errorCode!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Thông điệp lỗi nguyên văn' })
  errorMessage!: string | null;
}

export class PodProductSyncResultDto {
  @ApiProperty({ description: 'Số shop đã chạy trong lượt này' }) shopsProcessed!: number;
  @ApiProperty({ description: 'Số shop chạy HỎNG — xem `errors` để biết lý do' })
  shopsFailed!: number;
  @ApiProperty({
    description:
      'Số shop bị BỎ QUA vì đang có lượt đồng bộ khác chạy (khoá theo shop). Không phải lỗi, ' +
      'nhưng cũng không phải thành công — người dùng cần biết để bấm lại sau.',
  })
  shopsBusy!: number;
  @ApiProperty({ description: 'Số sản phẩm ĐANG BÁN (ACTIVATE) TikTok trả về' })
  productsFetched!: number;
  @ApiProperty() productsCreated!: number;
  @ApiProperty() productsUpdated!: number;
  @ApiProperty() productsSkipped!: number;
  @ApiProperty() productsFailed!: number;
  @ApiProperty({ description: 'Số sản phẩm bị đánh dấu ngừng bán (chỉ ở lượt quét toàn bộ)' })
  productsDeactivated!: number;

  /**
   * 🔴 Danh sách lỗi theo shop. Trước đây trường này KHÔNG tồn tại: một shop hỏng vì token
   * hết hạn hay TikTok trả 400 vẫn cho ra HTTP 200 kèm "0 sản phẩm", và người dùng thấy
   * một thông báo THÀNH CÔNG. Lỗi phải đi được tới màn hình thì mới sửa được.
   */
  @ApiProperty({ type: [PodProductSyncShopErrorDto] })
  errors!: PodProductSyncShopErrorDto[];

  @ApiProperty({
    type: [String],
    description: 'ID các lượt đồng bộ vừa tạo — mở Sync History để xem chi tiết',
  })
  historyIds!: string[];
}
