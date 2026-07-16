import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { OrderItemInputDto } from './order-item.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Input tạo Order. Flow: Platform → Account → Order Number → Khách → Items (1..N) → status WAITING.
 * `platform` KHÔNG nhận từ client — suy ra từ Account (nền tảng của Account).
 * Seller chỉ được tạo Order cho Account mình quản lý (enforce ở service).
 */
export class CreateOrderDto {
  @ApiProperty({ format: 'uuid', description: 'Account (thuộc Organization) — Order gắn vào Account này' })
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: '577478252884431871', minLength: 1, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  orderNumber!: string;

  @ApiPropertyOptional({ maxLength: 255, description: 'Tên khách hàng' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  customerName?: string;

  @ApiPropertyOptional({ maxLength: 50, description: 'SĐT khách hàng' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  customerPhone?: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Địa chỉ giao hàng' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  shippingAddress?: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Note của Seller' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sellerNote?: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Note Kho' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  warehouseNote?: string;

  @ApiPropertyOptional({ maxLength: 255, description: 'Mã tracking' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  tracking?: string;

  @ApiPropertyOptional({ enum: OrderStatus, default: OrderStatus.WAITING })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'Ngày order (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  orderedAt?: string;

  @ApiProperty({ type: OrderItemInputDto, isArray: true, description: 'Danh sách sản phẩm (>=1)' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
}
