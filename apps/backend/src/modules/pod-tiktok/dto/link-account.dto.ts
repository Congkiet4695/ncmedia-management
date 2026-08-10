import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TIKTOK_REGIONS, type TiktokRegion } from '../constants/tiktok.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Link TikTok Shop Account — Seller tự mở link uỷ quyền, copy Authorization Code
 * từ URL callback rồi dán vào hệ thống (luồng do Product Owner chốt cho Sprint 1).
 */
export class LinkTiktokAccountDto {
  @ApiProperty({
    description: 'Tên gợi nhớ cho kết nối (do người dùng đặt)',
    example: 'NCMedia US Store',
    maxLength: 255,
  })
  @Transform(trim)
  @IsString({ message: 'Account Name là bắt buộc' })
  @IsNotEmpty({ message: 'Account Name là bắt buộc' })
  @MaxLength(255, { message: 'Account Name tối đa 255 ký tự' })
  accountName!: string;

  @ApiProperty({
    description:
      'Authorization Code lấy từ URL callback sau khi Seller Approve (tham số `code`). ' +
      'Chỉ dùng được MỘT LẦN và hết hạn sau 30 phút.',
    example: 'TTP_FeBoANmHP3yqdoUI9fZOCw',
    maxLength: 512,
  })
  @Transform(trim)
  @IsString({ message: 'Authorization Code là bắt buộc' })
  @IsNotEmpty({ message: 'Authorization Code là bắt buộc' })
  @MinLength(4, { message: 'Authorization Code không hợp lệ (quá ngắn)' })
  @MaxLength(512, { message: 'Authorization Code tối đa 512 ký tự' })
  authorizationCode!: string;
}

/** Query sinh authorization link để Seller mở (hỗ trợ người dùng lấy code). */
export class AuthorizeUrlQueryDto {
  @ApiPropertyOptional({
    enum: TIKTOK_REGIONS,
    description: 'Thị trường của Seller. Mặc định lấy từ cấu hình TIKTOK_DEFAULT_REGION (US).',
  })
  @IsOptional()
  @IsIn(TIKTOK_REGIONS, { message: 'region phải là US hoặc ROW' })
  region?: TiktokRegion;
}
