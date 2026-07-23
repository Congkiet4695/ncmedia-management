import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderItemStatus } from '@prisma/client';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Cập nhật fulfillment cho TỪNG OrderItem (Tracking Number + Fulfillment Status).
 * Dùng cho Fulfillment (đã claim đơn) hoặc Admin.
 */
export class UpdateOrderItemFulfillmentDto {
  @ApiPropertyOptional({ maxLength: 255, description: 'Tracking Number của Item' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  trackingNumber?: string;

  @ApiPropertyOptional({ enum: OrderItemStatus, description: 'Trạng thái fulfillment của Item' })
  @IsOptional()
  @IsEnum(OrderItemStatus)
  fulfillmentStatus?: OrderItemStatus;
}
