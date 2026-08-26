import { ApiProperty } from '@nestjs/swagger';

export class OrganizationSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
}

export class UserSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
}

export class AuthTokensDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: string;
  @ApiProperty({ example: 900, description: 'Access token TTL (giây)' }) expiresIn!: number;
}

/**
 * Response của POST /auth/register.
 *
 * 🔴 KHÔNG còn `tokens`. Organization vừa tạo ở trạng thái PENDING nên chưa được phép vào hệ
 * thống — phát token ở đây là tự mâu thuẫn với chính luồng duyệt. Frontend nhận response này
 * thì hiển thị màn "chờ duyệt", không đăng nhập.
 */
export class RegisterResponseDto {
  @ApiProperty({ type: OrganizationSummaryDto }) organization!: OrganizationSummaryDto;
  @ApiProperty({ type: UserSummaryDto }) user!: UserSummaryDto;

  @ApiProperty({
    example: true,
    description: 'Email xác nhận đã gửi được hay chưa. `false` ⇒ đăng ký VẪN thành công.',
  })
  emailSent!: boolean;
}
