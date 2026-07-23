import { ApiProperty } from '@nestjs/swagger';
import { OrderNoteDto } from './order-note.dto';

export class OrderPlatformDto {
  @ApiProperty({ nullable: true, type: String }) id!: string | null;
  @ApiProperty({ nullable: true, type: String }) code!: string | null;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
}

export class OrderAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: OrderPlatformDto }) platform!: OrderPlatformDto | null;
  @ApiProperty({ nullable: true, type: String }) sellerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerName!: string | null;
}

export class OrderItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ nullable: true, type: String }) productLink!: string | null;
  @ApiProperty({ nullable: true, type: String }) color!: string | null;
  @ApiProperty({ nullable: true, type: String }) size!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: number;
  @ApiProperty({ nullable: true, type: String, description: 'Tracking Number (theo Item)' })
  trackingNumber!: string | null;
  @ApiProperty({ description: 'Trạng thái fulfillment của Item' }) fulfillmentStatus!: string;
  @ApiProperty({ nullable: true, type: String }) image!: string | null;
  @ApiProperty({ nullable: true, type: String }) remark!: string | null;
}

export class OrderStatusHistoryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) oldStatus!: string | null;
  @ApiProperty() newStatus!: string;
  @ApiProperty() changedBy!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() createdAt!: string;
}

/** Chi tiết Order (kèm items + timeline). */
export class OrderResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Nền tảng (code)' }) platform!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) orderedAt!: string | null;

  @ApiProperty({ type: OrderAccountDto }) account!: OrderAccountDto;

  @ApiProperty({ nullable: true, type: String }) shippingAddress!: string | null;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;

  // Fulfillment
  @ApiProperty({ nullable: true, type: String }) fulfilledById!: string | null;
  @ApiProperty({ nullable: true, type: String }) fulfilledByName!: string | null;
  @ApiProperty({ nullable: true, type: String }) claimedAt!: string | null;
  @ApiProperty({ description: 'Đã có Fulfillment nhận xử lý hay chưa' }) isClaimed!: boolean;

  @ApiProperty({ type: OrderItemDto, isArray: true }) items!: OrderItemDto[];
  @ApiProperty({ type: OrderNoteDto, isArray: true, description: 'Ghi chú Seller/Warehouse (1..N)' })
  notes!: OrderNoteDto[];
  @ApiProperty({ type: OrderStatusHistoryDto, isArray: true })
  statusHistories!: OrderStatusHistoryDto[];

  @ApiProperty({ description: 'Tổng số lượng sản phẩm (derived)' }) totalQuantity!: number;
  @ApiProperty({ description: 'Tổng tiền hàng (derived, ADR-014)' }) totalAmount!: number;

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

/** Dòng sản phẩm rút gọn kèm theo Order List (phục vụ Expandable Order Item Grid — không N+1). */
export class OrderListPreviewItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ nullable: true, type: String }) color!: string | null;
  @ApiProperty({ nullable: true, type: String }) size!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: number;
  @ApiProperty({ nullable: true, type: String }) trackingNumber!: string | null;
  @ApiProperty() fulfillmentStatus!: string;
}

/** Hàng danh sách Order. Kèm `items` (preview) + `totalAmount` cho Expandable Grid. */
export class OrderListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ nullable: true, type: String }) platformName!: string | null;
  @ApiProperty() accountName!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerName!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Sản phẩm đầu tiên' }) productName!: string | null;
  @ApiProperty() itemsCount!: number;
  @ApiProperty() totalQuantity!: number;
  @ApiProperty({ description: 'Tổng tiền hàng = SUM(quantity × unitPrice) — derived (ADR-014)' })
  totalAmount!: number;
  // Fulfillment (cột Fulfillment + trạng thái claim trong Order List)
  @ApiProperty({ nullable: true, type: String }) fulfilledById!: string | null;
  @ApiProperty({ nullable: true, type: String }) fulfilledByName!: string | null;
  @ApiProperty() isClaimed!: boolean;
  @ApiProperty({ type: OrderListPreviewItemDto, isArray: true }) items!: OrderListPreviewItemDto[];
  @ApiProperty({ type: OrderNoteDto, isArray: true, description: 'Ghi chú Seller/Warehouse (1..N)' })
  notes!: OrderNoteDto[];
  @ApiProperty({ nullable: true, type: String }) orderedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class OrderPaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedOrderResponseDto {
  @ApiProperty({ type: OrderListItemDto, isArray: true }) items!: OrderListItemDto[];
  @ApiProperty({ type: OrderPaginationMetaDto }) meta!: OrderPaginationMetaDto;
}

/** Người dùng có thể là Seller (quản lý Account) — selector filter (ADMIN). */
export class OrderSellerOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty() email!: string;
}
