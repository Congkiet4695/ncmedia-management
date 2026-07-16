import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformResponseDto } from './dto/platform-response.dto';
import { PlatformService } from './platform.service';

/**
 * PlatformController — danh mục Platform (Global) cho selector Account.
 * Guard: JwtAuthGuard (mọi user đăng nhập) — danh mục dùng chung, không nhạy cảm.
 */
@ApiTags('Platforms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('platforms')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách Platform đang hoạt động' })
  @ApiOkResponse({ type: PlatformResponseDto, isArray: true })
  findAll(): Promise<PlatformResponseDto[]> {
    return this.platformService.findAllActive();
  }
}
