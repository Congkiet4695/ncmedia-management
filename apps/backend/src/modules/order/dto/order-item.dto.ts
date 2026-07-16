import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Một dòng sản phẩm trong đơn (OrderItem). Đơn có 1..N item. */
export class OrderItemInputDto {
  @ApiProperty({ example: 'Garvee Dog Kennel 6.6ft', minLength: 1, maxLength: 1024 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  productName!: string;

  @ApiPropertyOptional({ maxLength: 2048, description: 'Link sản phẩm' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2048)
  productLink?: string;

  @ApiPropertyOptional({ maxLength: 255, description: 'Nhà cung cấp (Supplier)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  supplier?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  sku?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  variant?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  color?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  size?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number = 1;

  @ApiPropertyOptional({ minimum: 0, default: 0, description: 'Giá đơn vị' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999_999)
  unitPrice?: number = 0;

  @ApiPropertyOptional({ maxLength: 2048, description: 'Ảnh sản phẩm (URL)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2048)
  image?: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Ghi chú dòng sản phẩm' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remark?: string;
}
