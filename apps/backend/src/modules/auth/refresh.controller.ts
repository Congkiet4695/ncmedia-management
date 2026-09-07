import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  LogoutRequestDto,
  RefreshTokenRequestDto,
  RefreshTokenResponseDto,
} from './dto/refresh-token.dto';
import { RefreshService } from './services/refresh.service';

/**
 * RefreshController — gia hạn phiên và đăng xuất.
 *
 * 🔴 KHÔNG có `JwtAuthGuard` ở đây, và đó là điểm mấu chốt: người gọi đến `/auth/refresh`
 * đúng là người có access token đã hết hạn. Đặt guard access token trước cửa này thì
 * endpoint không bao giờ dùng được — refresh sẽ trả về 401 đúng vào lúc nó cần hoạt động.
 * Việc xác thực do chính refresh token đảm nhiệm (chữ ký + bản ghi trong `refresh_tokens`).
 */
@ApiTags('Auth')
@Controller('auth')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gia hạn phiên bằng Refresh Token',
    description:
      'Xoay vòng token: trả về cặp Access + Refresh mới và thu hồi Refresh Token vừa dùng. ' +
      'Chỉ trả 401 khi phiên thực sự không còn hợp lệ — access token hết hạn KHÔNG phải lý do đăng xuất.',
  })
  @ApiOkResponse({ type: RefreshTokenResponseDto })
  @ApiBadRequestResponse({ description: 'Thiếu refreshToken (VALIDATION_ERROR)' })
  @ApiUnauthorizedResponse({
    description: 'Refresh Token sai / hết hạn / đã thu hồi (AUTH_REFRESH_TOKEN_INVALID)',
  })
  refresh(
    @Body() dto: RefreshTokenRequestDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<RefreshTokenResponseDto> {
    // Controller chỉ điều hướng — không chứa business logic (CLAUDE.md Mục 8).
    return this.refreshService.refresh(dto.refreshToken, { ipAddress: ip, userAgent });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đăng xuất — thu hồi phiên hiện tại',
    description:
      'Idempotent: token thiếu hoặc đã thu hồi vẫn trả 200. Đăng xuất không được phép thất bại.',
  })
  @ApiOkResponse({ description: 'Phiên đã được thu hồi (envelope chuẩn, `data = null`)' })
  async logout(
    @Body() dto: LogoutRequestDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    await this.refreshService.logout(dto.refreshToken, { ipAddress: ip, userAgent });
  }
}
