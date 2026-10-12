import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PodReturnStatusGroup } from '@prisma/client';

/**
 * Response của Return Orders. Tiền là CHUỖI thập phân (giữ nguyên Decimal, không qua số thực).
 *
 * 🔴 Ba khái niệm tiền tách bạch, không bao giờ cộng lẫn:
 *  - `requestedRefund`  : `refund_amount.refund_total` TikTok báo trên yêu cầu.
 *  - `refundCompleted`  : TikTok xác nhận đã hoàn cho người mua (trạng thái yêu cầu).
 *  - `settledRefund`    : phần doanh thu bị TikTok trừ lại trong statement đã quyết toán (cấp ĐƠN).
 */
export class PodReturnItemDto {
  @ApiProperty() returnLineItemId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) orderLineItemId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) productName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) skuId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) skuName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sellerSku!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) productImageUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) currency!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'refund_total của dòng (TikTok)' })
  refundTotal!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'sale_price của order line item' })
  paidAmount!: string | null;
}

/** Dòng hàng đã gộp theo SKU — cột "Item" của bảng. */
export class PodReturnItemGroupDto {
  @ApiPropertyOptional({ nullable: true, type: String }) productName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sellerSku!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) skuName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) productImageUrl!: string | null;
  @ApiProperty() quantity!: number;
}

export class PodReturnResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() tiktokReturnId!: string;
  @ApiProperty() tiktokOrderId!: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Đơn POD tương ứng (nếu đã đồng bộ)' })
  orderId!: string | null;
  @ApiProperty({ format: 'uuid' }) shopId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) shopName!: string | null;
  @ApiProperty({ format: 'uuid' }) accountId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) accountName!: string | null;
  @ApiProperty({ description: '`return_type` nguyên văn' }) returnType!: string;
  @ApiProperty({ description: '`return_status` nguyên văn' }) returnStatus!: string;
  @ApiProperty({ enum: PodReturnStatusGroup }) statusGroup!: PodReturnStatusGroup;
  @ApiProperty({ description: 'TikTok xác nhận đã hoàn tiền cho người mua' }) refundCompleted!: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) reasonCode!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Nhãn lý do của TikTok' })
  reasonText!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) role!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) arbitrationStatus!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sellerProposedReturnType!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) partialRefundAmount!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) currency!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Σ sale_price của các dòng được yêu cầu' })
  paidAmount!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'refund_total trên yêu cầu (TikTok)' })
  requestedRefund!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) refundSubtotal!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) refundShippingFee!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) refundTax!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Doanh thu của ĐƠN bị TikTok trừ lại do hoàn tiền trong statement đã quyết toán ' +
      '= −(refund_subtotal_before_discount_amount + seller_discount_refund_amount). NULL = chưa quyết toán.',
  })
  orderSettledRefund!: string | null;
  @ApiProperty() itemQuantity!: number;
  @ApiProperty({ type: PodReturnItemGroupDto, isArray: true }) itemGroups!: PodReturnItemGroupDto[];
  @ApiPropertyOptional({ nullable: true, type: String }) returnTrackingNumber!: string | null;
  @ApiProperty() requestedAt!: string;
  @ApiProperty() tiktokUpdatedAt!: string;
  @ApiProperty() lastSyncedAt!: string;
}

export class PodReturnDetailDto extends PodReturnResponseDto {
  @ApiProperty({ type: PodReturnItemDto, isArray: true }) items!: PodReturnItemDto[];
  @ApiPropertyOptional({ nullable: true, type: String }) returnProviderName!: string | null;
}

export class PodPaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedPodReturnResponseDto {
  @ApiProperty({ type: PodReturnResponseDto, isArray: true }) items!: PodReturnResponseDto[];
  @ApiProperty({ type: PodPaginationMetaDto }) meta!: PodPaginationMetaDto;
}

/** Tổng tiền của MỘT đơn vị tiền tệ — không bao giờ cộng USD với GBP. */
export class PodReturnMoneyByCurrencyDto {
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'Σ refund_total của yêu cầu chưa bị huỷ / từ chối' }) requestedRefund!: string;
  @ApiProperty({ description: 'Σ refund_total của yêu cầu TikTok xác nhận đã hoàn' }) refundedByRequest!: string;
  @ApiProperty({ description: 'Σ phần doanh thu bị trừ lại trong statement đã quyết toán (mỗi đơn một lần)' })
  settledRefund!: string;
}

export class PodReturnSummaryDto {
  @ApiProperty({ description: 'Số YÊU CẦU (không phải số đơn)' }) totalRequests!: number;
  @ApiProperty({ description: 'Số yêu cầu theo nhóm trạng thái — đủ mọi nhóm, kể cả 0' })
  byGroup!: Record<PodReturnStatusGroup, number>;
  @ApiProperty({ description: 'Số đơn (khác nhau) có yêu cầu' }) orders!: number;
  @ApiProperty({ description: 'Số đơn (khác nhau) TikTok xác nhận đã hoàn tiền' }) refundedOrders!: number;
  @ApiProperty({ description: 'Σ số đơn vị hàng trong các yêu cầu chưa bị huỷ / từ chối' }) itemQuantity!: number;
  @ApiProperty({ type: PodReturnMoneyByCurrencyDto, isArray: true }) amounts!: PodReturnMoneyByCurrencyDto[];
}

/** Một mục lịch sử — đúng những gì GetReturnRecords trả, không dựng thêm. */
export class PodReturnHistoryEntryDto {
  @ApiPropertyOptional({ nullable: true, type: String }) time!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) event!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) role!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) description!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) note!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ description: 'Số ảnh / video đính kèm (không tải nội dung về)' }) attachments!: number;
}

export class PodReturnHistoryDto {
  @ApiProperty({ type: PodReturnHistoryEntryDto, isArray: true }) entries!: PodReturnHistoryEntryDto[];
  @ApiPropertyOptional({ nullable: true, type: String }) syncedAt!: string | null;
  @ApiProperty({ description: 'true = vừa đọc lại từ TikTok; false = bản đã lưu (TikTok lỗi / còn mới)' })
  live!: boolean;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Lỗi khi đọc TikTok (đang hiển thị bản đã lưu)' })
  errorCode!: string | null;
}

export class PodReturnShopSyncResultDto {
  @ApiProperty() shopId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) shopName!: string | null;
  @ApiProperty({ description: 'SUCCESS | PARTIAL | FAILED | SKIPPED' }) status!: string;
  @ApiProperty() fetched!: number;
  @ApiProperty() created!: number;
  @ApiProperty() updated!: number;
  @ApiProperty() unchanged!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() notified!: number;
  @ApiPropertyOptional({ nullable: true, type: String }) errorCode!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) errorMessage!: string | null;
}

export class PodReturnSyncResultDto {
  @ApiProperty({ type: PodReturnShopSyncResultDto, isArray: true }) shops!: PodReturnShopSyncResultDto[];
}

export class PodReturnReasonOptionDto {
  @ApiProperty({ description: '`return_reason` (mã TikTok)' }) value!: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Nhãn TikTok' }) label!: string | null;
}

export class PodReturnFilterOptionsDto {
  @ApiProperty({ type: String, isArray: true }) returnTypes!: string[];
  @ApiProperty({ type: String, isArray: true }) returnStatuses!: string[];
  @ApiProperty({ type: PodReturnReasonOptionDto, isArray: true }) reasons!: PodReturnReasonOptionDto[];
}
