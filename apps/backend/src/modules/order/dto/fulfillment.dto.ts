import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Cập nhật Tracking Number (Fulfillment). Có thể để trống khi Order còn WAITING. */
export class UpdateTrackingDto {
  @ApiProperty({ maxLength: 255, description: 'Mã tracking (có thể rỗng khi chưa SHIPPED)' })
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  tracking!: string;
}

/** Cập nhật Warehouse Note / Warehouse Note 2 (Fulfillment). */
export class UpdateWarehouseNoteDto {
  @ApiPropertyOptional({ maxLength: 2000, description: 'Note Kho' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  warehouseNote?: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Note Kho 2' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  warehouseNote2?: string;
}
