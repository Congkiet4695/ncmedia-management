import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OrderNoteType } from '@prisma/client';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Tạo Note cho Order. */
export class CreateOrderNoteDto {
  @ApiProperty({ enum: OrderNoteType, description: 'Loại note: SELLER | WAREHOUSE' })
  @IsEnum(OrderNoteType)
  type!: OrderNoteType;

  @ApiProperty({ minLength: 1, maxLength: 4000, description: 'Nội dung note' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}

/** Cập nhật Note (nội dung, và tuỳ chọn đổi loại). */
export class UpdateOrderNoteDto {
  @ApiPropertyOptional({ enum: OrderNoteType })
  @IsOptional()
  @IsEnum(OrderNoteType)
  type?: OrderNoteType;

  @ApiPropertyOptional({ minLength: 1, maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content?: string;
}

/** Response một Note. */
export class OrderNoteDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ enum: OrderNoteType }) type!: OrderNoteType;
  @ApiProperty() content!: string;
  @ApiProperty({ nullable: true, type: String }) createdBy!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
