import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { FLASH_SALE_PERMISSIONS } from './constants/pod-flash-sale.constants';
import {
  PodFlashSaleAutoConfigDto,
  PodFlashSaleAutoRunResultDto,
  UpdateFlashSaleAutoConfigDto,
} from './dto/pod-flash-sale-auto.dto';
import { PodFlashSaleAutoService } from './services/pod-flash-sale-auto.service';

/**
 * Cấu hình lịch chạy Auto Flash Sale của TỔ CHỨC — **POD → Flash Sales → Auto Scheduler**.
 *
 * Chỉ quyền \`pod.flashsale.auto.config\` (mặc định: role Admin). Cấu hình ở mức tổ chức, không
 * theo shop ⇒ không đi qua \`PodScopeGuard\`; mọi truy vấn vẫn mang \`organizationId\` từ JWT.
 */
@ApiTags('POD - Flash Sales')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission pod.flashsale.auto.config' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/flash-sale-auto')
export class PodFlashSaleAutoController {
  constructor(private readonly autoService: PodFlashSaleAutoService) {}

  @Get('config')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.AUTO_CONFIG)
  @ApiOperation({ summary: 'Xem cấu hình Auto Flash Sale (giờ chạy, múi giờ, lần chạy gần nhất / kế tiếp)' })
  @ApiOkResponse({ type: PodFlashSaleAutoConfigDto })
  getConfig(@CurrentUser() user: AuthenticatedUser): Promise<PodFlashSaleAutoConfigDto> {
    return this.autoService.getConfig(user.organizationId);
  }

  @Put('config')
  @RequirePermissions(FLASH_SALE_PERMISSIONS.AUTO_CONFIG)
  @ApiOperation({
    summary: 'Lưu cấu hình Auto Flash Sale',
    description:
      'Mỗi ngày chạy đúng MỘT lần vào `runTime` theo `timezone` (IANA). Đổi lịch/vừa bật ⇒ lần ' +
      'chạy đầu tiên là mốc KẾ TIẾP (dùng Run Now để chạy ngay).',
  })
  @ApiOkResponse({ type: PodFlashSaleAutoConfigDto })
  updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateFlashSaleAutoConfigDto,
  ): Promise<PodFlashSaleAutoConfigDto> {
    return this.autoService.updateConfig(user.organizationId, user.userId, dto);
  }

  @Post('run-now')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(FLASH_SALE_PERMISSIONS.AUTO_CONFIG)
  @ApiOperation({
    summary: '🔴 Chạy Auto Flash Sale ngay',
    description:
      'Gọi ĐÚNG service mà cron dùng — cùng luật, cùng khoá, cùng chống trùng. Có thể tạo đợt ' +
      'sale thật trên TikTok cho những đợt đã tới hạn.',
  })
  @ApiOkResponse({ type: PodFlashSaleAutoRunResultDto })
  @ApiConflictResponse({ description: 'Đang có lượt Auto khác chạy (POD_FLASH_SALE_AUTO_BUSY)' })
  runNow(@CurrentUser() user: AuthenticatedUser): Promise<PodFlashSaleAutoRunResultDto> {
    return this.autoService.runNow(user.organizationId);
  }
}
