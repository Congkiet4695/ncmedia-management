import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';
import { MeResponseDto } from './dto/me-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MeService } from './services/me.service';
import { AuthenticatedUser } from './types/authenticated-user.interface';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Thông tin người dùng hiện tại (từ Access Token)' })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    // Controller chỉ điều hướng — không chứa business logic (CLAUDE.md Mục 8).
    return this.meService.getMe(user);
  }
}
