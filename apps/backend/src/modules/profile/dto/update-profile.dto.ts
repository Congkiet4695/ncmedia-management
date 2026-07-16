import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Input cập nhật thông tin cá nhân của chính mình.
 * CHỈ chứa field cá nhân — `role`, `status`, `email`, `organization`, `salary`, `department`
 * KHÔNG có ở đây; ValidationPipe (whitelist + forbidNonWhitelisted) sẽ chặn nếu gửi lên.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Nguyen Van A', minLength: 2, maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({ maxLength: 1024, description: 'URL avatar' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  avatar?: string;

  @ApiPropertyOptional({ example: '0901234567', maxLength: 20 })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[0-9+\-\s]{8,20}$/, { message: 'Số điện thoại không hợp lệ' })
  phone?: string;

  @ApiPropertyOptional({ example: '1990-01-15', description: 'Ngày sinh (ISO date)' })
  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  larkAccount?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  bankAccount?: string;

  @ApiPropertyOptional({ maxLength: 1024, description: 'URL QR ngân hàng' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  bankQrUrl?: string;
}
