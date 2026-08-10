import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import {
  PodOrderQueryDto,
  PodSyncLogQueryDto,
  TriggerSyncDto,
} from './dto/pod-order-query.dto';
import {
  PaginatedPodOrderResponseDto,
  PaginatedPodSyncLogResponseDto,
  PodOrderResponseDto,
  PodOrderStatsDto,
  PodSyncTriggerResultDto,
} from './dto/pod-order-response.dto';
import { PodOrderService } from './services/pod-order.service';

/**
 * PodOrderController — đọc đơn TikTok đã đồng bộ + kích hoạt đồng bộ thủ công.
 *
 * Tenant-scoped (organizationId từ JWT — ADR-004) + RBAC `pod.tiktok.order.*`.
 * ⚠️ Không endpoint nào trả về thông tin người nhận (PII đã mã hoá) hay `raw_payload`.
 */
@ApiTags('POD - TikTok Orders')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/tiktok')
export class PodOrderController {
  constructor(private readonly service: PodOrderService) {}

  @Get('orders')
  @RequirePermissions('pod.tiktok.order.read')
  @ApiOperation({
    summary: 'Danh sách đơn TikTok đã đồng bộ',
    description: 'Hỗ trợ filter theo trạng thái/shop/loại đơn/khoảng thời gian và tìm kiếm.',
  })
  @ApiOkResponse({ type: PaginatedPodOrderResponseDto })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodOrderQueryDto,
  ): Promise<PaginatedPodOrderResponseDto> {
    return this.service.findAll(user.organizationId, query);
  }

  /**
   * Endpoint bổ sung ngoài đề bài — lý do: màn hình danh sách cần thẻ đếm theo trạng thái.
   * Nếu tính ở frontend sẽ phải tải toàn bộ đơn (không khả thi với hàng chục nghìn đơn);
   * ở đây chỉ là một truy vấn GROUP BY duy nhất.
   */
  @Get('orders/stats')
  @RequirePermissions('pod.tiktok.order.read')
  @ApiOperation({ summary: 'Thống kê số đơn theo trạng thái' })
  @ApiOkResponse({ type: PodOrderStatsDto })
  stats(@CurrentUser() user: AuthenticatedUser): Promise<PodOrderStatsDto> {
    return this.service.stats(user.organizationId);
  }

  @Post('orders/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.order.sync')
  @ApiOperation({
    summary: 'Đồng bộ đơn thủ công',
    description:
      'Có `shopId` → chỉ đồng bộ shop đó. Không có → đồng bộ toàn bộ shop đang hoạt động. ' +
      '`lookbackMinutes` để quét lùi thêm; `force=true` để ghi đè bỏ qua so sánh.',
  })
  @ApiOkResponse({ type: PodSyncTriggerResultDto })
  @ApiConflictResponse({ description: 'Đang có lượt đồng bộ chạy cho shop này' })
  triggerSync(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TriggerSyncDto,
  ): Promise<PodSyncTriggerResultDto> {
    return this.service.triggerSync(user.organizationId, user.userId, dto);
  }

  @Get('sync-logs')
  @RequirePermissions('pod.tiktok.order.read')
  @ApiOperation({ summary: 'Nhật ký đồng bộ (Sync History)' })
  @ApiOkResponse({ type: PaginatedPodSyncLogResponseDto })
  findSyncLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PodSyncLogQueryDto,
  ): Promise<PaginatedPodSyncLogResponseDto> {
    return this.service.findSyncLogs(user.organizationId, query);
  }

  // Đặt CUỐI để `orders/stats` và `orders/sync` không bị `:id` bắt nhầm.
  @Get('orders/:id')
  @RequirePermissions('pod.tiktok.order.read')
  @ApiOperation({ summary: 'Chi tiết đơn TikTok (kèm sản phẩm và packages)' })
  @ApiOkResponse({ type: PodOrderResponseDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodOrderResponseDto> {
    return this.service.findOne(user.organizationId, id);
  }
}
