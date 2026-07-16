import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';

/** Đổi trạng thái đơn — ghi vào order_status_histories (timeline) + order_logs. */
export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Ghi chú khi đổi trạng thái' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
