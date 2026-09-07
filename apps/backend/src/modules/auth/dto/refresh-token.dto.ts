import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Body của POST /auth/refresh.
 *
 * 🔴 Refresh token đi trong BODY chứ không phải header `Authorization`: header đó đang mang
 * access token đã hết hạn — chính lý do người gọi đến đây. Trộn hai loại token vào một chỗ
 * khiến guard không phân biệt được và là cách nhanh nhất để refresh bị chặn bởi chính
 * `JwtAuthGuard`.
 */
export class RefreshTokenRequestDto {
  @ApiProperty({ description: 'Refresh Token đã cấp khi Login hoặc ở lần refresh trước' })
  @IsString({ message: 'refreshToken phải là chuỗi' })
  @IsNotEmpty({ message: 'refreshToken không được để trống' })
  refreshToken!: string;
}

/** Body của POST /auth/logout — thu hồi đúng phiên đang dùng. */
export class LogoutRequestDto {
  @ApiPropertyOptional({
    description:
      'Refresh Token của phiên cần thu hồi. Bỏ trống ⇒ chỉ xoá phiên phía client (server không có gì để thu hồi).',
  })
  @IsOptional()
  @IsString({ message: 'refreshToken phải là chuỗi' })
  refreshToken?: string;
}

/** Response của POST /auth/refresh — cùng hình dạng với `tokens` của Login. */
export class RefreshTokenResponseDto {
  @ApiProperty({ description: 'Access Token mới (JWT HS256)' }) accessToken!: string;
  @ApiProperty({ description: 'Refresh Token mới — token cũ đã bị thu hồi (rotation)' })
  refreshToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: string;
  @ApiProperty({ example: 900, description: 'Access token TTL (giây)' }) expiresIn!: number;
}
