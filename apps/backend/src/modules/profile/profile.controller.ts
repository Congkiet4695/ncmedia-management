import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './services/profile.service';

/**
 * ProfileController — Self Service cho user đăng nhập (mọi role, gồm EMPLOYEE).
 * Guard: chỉ JwtAuthGuard (KHÔNG AdminGuard) → không mở Employee Management, không đổi RBAC.
 * Mọi thao tác gắn với userId từ token → chỉ chính mình.
 */
@ApiTags('Profile')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Xem hồ sơ của chính mình' })
  @ApiOkResponse({ type: ProfileResponseDto })
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponseDto> {
    return this.profileService.getMe(user.userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Cập nhật thông tin cá nhân của chính mình' })
  @ApiOkResponse({ type: ProfileResponseDto })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateMe(user.userId, dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đổi mật khẩu của chính mình' })
  @ApiOkResponse({ description: 'Đổi mật khẩu thành công (data = null)' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.profileService.changePassword(user.userId, dto);
  }
}
