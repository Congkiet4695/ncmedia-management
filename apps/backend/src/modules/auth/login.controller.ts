import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LoginRequestDto } from './dto/login-request.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginService } from './services/login.service';

@ApiTags('Auth')
@Controller('auth')
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bằng email + mật khẩu' })
  @ApiOkResponse({ type: LoginResponseDto, description: 'Đăng nhập thành công (Access + Refresh Token)' })
  @ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ (VALIDATION_ERROR)' })
  @ApiUnauthorizedResponse({ description: 'Sai email hoặc mật khẩu (AUTH_INVALID_CREDENTIALS)' })
  @ApiForbiddenResponse({ description: 'Tài khoản bị vô hiệu hóa (AUTH_ACCOUNT_DISABLED)' })
  @ApiResponse({ status: 423, description: 'Tài khoản bị khóa (AUTH_ACCOUNT_LOCKED)' })
  @ApiTooManyRequestsResponse({ description: 'Vượt rate limit (RATE_LIMITED)' })
  login(
    @Body() dto: LoginRequestDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<LoginResponseDto> {
    // Controller chỉ điều hướng — không chứa business logic (CLAUDE.md Mục 8).
    return this.loginService.login(dto, { ipAddress: ip, userAgent });
  }
}
