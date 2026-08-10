import { ApiProperty } from '@nestjs/swagger';
import { PodDesignDto } from './pod-design.dto';

/** Sản phẩm trong đơn (1 line item = 1 đơn vị sản phẩm theo cách TikTok trả về). */
export class PodOrderItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'line_items[].id của TikTok' }) tiktokLineItemId!: string;
  @ApiProperty({ nullable: true, type: String }) productId!: string | null;
  @ApiProperty({ nullable: true, type: String }) productName!: string | null;
  @ApiProperty({ nullable: true, type: String }) skuId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Biến thể (màu/size)' })
  skuName!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerSku!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Ảnh sản phẩm' })
  skuImage!: string | null;
  @ApiProperty({
    description:
      'Số lượng của dòng này. TikTok trả 1 line item = 1 ĐƠN VỊ sản phẩm nên giá trị luôn là 1; ' +
      'mua 5 áo sẽ có 5 dòng riêng để mỗi chiếc có thể có design khác nhau.',
    example: 1,
  })
  quantity!: number;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Danh mục sản phẩm — chưa có nguồn từ Get Order List (sẽ điền ở Sprint Product)',
  })
  productCategory!: string | null;
  @ApiProperty({
    type: () => PodDesignDto,
    isArray: true,
    description: 'Design in đã upload cho sản phẩm này (theo từng vị trí)',
  })
  designs!: PodDesignDto[];
  @ApiProperty({ nullable: true, type: Number }) salePrice!: number | null;
  @ApiProperty({ nullable: true, type: Number }) originalPrice!: number | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ nullable: true, type: String }) displayStatus!: string | null;
  @ApiProperty({ nullable: true, type: String }) packageStatus!: string | null;
  @ApiProperty({ nullable: true, type: String }) packageId!: string | null;
  @ApiProperty({ nullable: true, type: String }) trackingNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) shippingProviderName!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason!: string | null;
  @ApiProperty({ description: 'Sản phẩm có tuỳ biến Print-on-Demand' })
  isPodCustomized!: boolean;
  @ApiProperty({ nullable: true, type: String, description: 'ID dữ liệu POD (dùng ở Sprint sau)' })
  podInfoId!: string | null;
  @ApiProperty() isGift!: boolean;
}

export class PodOrderPackageDto {
  @ApiProperty() id!: string;
  @ApiProperty() tiktokPackageId!: string;
}

export class PodOrderShopDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() tiktokShopId!: string;
  @ApiProperty() region!: string;
}

/** Chi tiết đơn TikTok. Thông tin người nhận KHÔNG trả về (PII đã mã hoá). */
export class PodOrderResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'TikTok Shop order ID' }) tiktokOrderId!: string;
  @ApiProperty({ example: 'AWAITING_SHIPMENT' }) status!: string;

  @ApiProperty({ type: PodOrderShopDto }) shop!: PodOrderShopDto;
  @ApiProperty({ description: 'Tên kết nối (account) đã link' }) accountName!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ID Employee phụ trách — lấy từ Account sở hữu đơn, KHÔNG lưu trên đơn',
  })
  sellerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerFullName!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerEmail!: string | null;


  @ApiProperty({ nullable: true, type: String }) buyerEmail!: string | null;
  @ApiProperty({ nullable: true, type: String }) buyerNickname!: string | null;
  @ApiProperty({ nullable: true, type: String }) buyerMessage!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerNote!: string | null;

  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Tổng tiền người mua trả' })
  totalAmount!: number | null;
  @ApiProperty({ nullable: true, type: Number }) subTotal!: number | null;
  @ApiProperty({ nullable: true, type: Number }) shippingFee!: number | null;
  @ApiProperty({ nullable: true, type: Number }) tax!: number | null;
  @ApiProperty({ nullable: true, type: Number }) sellerDiscount!: number | null;
  @ApiProperty({ nullable: true, type: Number }) platformDiscount!: number | null;

  @ApiProperty({ nullable: true, type: String }) fulfillmentType!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'TIKTOK (4PL) | SELLER (3PL)' })
  shippingType!: string | null;
  @ApiProperty({ nullable: true, type: String }) trackingNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) shippingProvider!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancellationInitiator!: string | null;
  @ApiProperty() isBuyerRequestCancel!: boolean;

  @ApiProperty({ nullable: true, type: String, description: 'MADE_TO_ORDER = đơn POD' })
  orderType!: string | null;
  @ApiProperty({ description: 'Đơn đi theo luồng On Hold mới của TikTok' })
  isOnHoldOrder!: boolean;
  @ApiProperty({ description: 'Có sản phẩm tuỳ biến POD' }) hasPodItem!: boolean;

  @ApiProperty({
    description: 'Địa chỉ người nhận đã bị TikTok che (đơn 4PL/FBT hoặc đơn cũ)',
  })
  recipientMasked!: boolean;
  @ApiProperty({ nullable: true, type: String }) recipientRegionCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) recipientPostalCode!: string | null;

  @ApiProperty({ description: 'Thời điểm đặt đơn (create_time)' }) orderedAt!: string;
  @ApiProperty({ description: 'Thời điểm TikTok cập nhật đơn (update_time)' })
  tiktokUpdatedAt!: string;
  @ApiProperty({ nullable: true, type: String }) paidTime!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Hạn phải ship (rts_sla_time)' })
  rtsSlaTime!: string | null;
  @ApiProperty({ description: 'Lần đồng bộ gần nhất' }) lastSyncedAt!: string;
  @ApiProperty({ description: 'Số lần đơn được cập nhật từ TikTok' }) syncVersion!: number;

  @ApiProperty({ type: PodOrderItemDto, isArray: true }) items!: PodOrderItemDto[];
  @ApiProperty({ type: PodOrderPackageDto, isArray: true }) packages!: PodOrderPackageDto[];

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

/** Hàng danh sách đơn. */
export class PodOrderListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() tiktokOrderId!: string;
  @ApiProperty({ nullable: true, type: String }) shopName!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ID Employee phụ trách — lấy từ Account sở hữu đơn, KHÔNG lưu trên đơn',
  })
  sellerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerFullName!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerEmail!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Nickname hoặc email người mua' })
  buyer!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: Number }) totalAmount!: number | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ nullable: true, type: String }) orderType!: string | null;
  @ApiProperty() hasPodItem!: boolean;
  @ApiProperty({ description: 'Số sản phẩm trong đơn' }) itemCount!: number;
  @ApiProperty({ nullable: true, type: String }) trackingNumber!: string | null;
  @ApiProperty({ description: 'Thời điểm tạo đơn trên TikTok' }) createdTime!: string;
  @ApiProperty({ description: 'Thời điểm TikTok cập nhật đơn' }) updatedTime!: string;
  @ApiProperty({ description: 'Lần đồng bộ gần nhất' }) lastSync!: string;
  @ApiProperty({
    type: PodOrderItemDto,
    isArray: true,
    description:
      'Danh sách sản phẩm của đơn (kèm design đã upload) — hiển thị trực tiếp ở màn hình danh sách.',
  })
  items!: PodOrderItemDto[];
}

export class PodPaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedPodOrderResponseDto {
  @ApiProperty({ type: PodOrderListItemDto, isArray: true }) items!: PodOrderListItemDto[];
  @ApiProperty({ type: PodPaginationMetaDto }) meta!: PodPaginationMetaDto;
}

/** Một dòng nhật ký đồng bộ. */
export class PodSyncLogDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) shopId!: string | null;
  @ApiProperty({ nullable: true, type: String }) shopName!: string | null;
  @ApiProperty({ nullable: true, type: String }) accountName!: string | null;
  @ApiProperty({ example: 'CRON' }) trigger!: string;
  @ApiProperty({ example: 'SUCCESS' }) status!: string;
  @ApiProperty({
    example: 'INCREMENTAL',
    description:
      'BACKFILL = kéo lịch sử theo create_time; INCREMENTAL = đồng bộ định kỳ theo update_time',
  })
  phase!: string;
  @ApiProperty() startTime!: string;
  @ApiProperty({ nullable: true, type: String }) endTime!: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Thời lượng (ms)' })
  durationMs!: number | null;
  @ApiProperty() totalOrders!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Số đơn TikTok báo có trong cửa sổ — lệch với totalOrders là dấu hiệu thiếu đơn',
  })
  tiktokTotalCount!: number | null;
  @ApiProperty() created!: number;
  @ApiProperty() updated!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() pagesFetched!: number;
  @ApiProperty({ description: 'Số lần gọi TikTok API' }) apiCalls!: number;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'request_id của TikTok' })
  tiktokRequestId!: string | null;
}

export class PaginatedPodSyncLogResponseDto {
  @ApiProperty({ type: PodSyncLogDto, isArray: true }) items!: PodSyncLogDto[];
  @ApiProperty({ type: PodPaginationMetaDto }) meta!: PodPaginationMetaDto;
}

/** Kết quả trigger đồng bộ thủ công. */
export class PodSyncTriggerResultDto {
  @ApiProperty() shopsTotal!: number;
  @ApiProperty() shopsSucceeded!: number;
  @ApiProperty() shopsFailed!: number;
  @ApiProperty() ordersCreated!: number;
  @ApiProperty() ordersUpdated!: number;
  @ApiProperty() ordersSkipped!: number;
  @ApiProperty() ordersFailed!: number;
  @ApiProperty() durationMs!: number;
  @ApiProperty({ description: 'Bỏ qua vì đang có lượt đồng bộ khác chạy' })
  skippedByLock!: boolean;
}

/** Thống kê nhanh theo trạng thái. */
export class PodOrderStatsDto {
  @ApiProperty() total!: number;
  @ApiProperty({
    description: 'Số đơn theo từng trạng thái TikTok',
    example: { AWAITING_SHIPMENT: 12, IN_TRANSIT: 5 },
  })
  byStatus!: Record<string, number>;
}
