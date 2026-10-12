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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import { PodScope } from '../pod-tiktok/decorators/pod-scope.decorator';
import { PodShopSyncStatusListDto, PodShopSyncStatusQueryDto } from '../pod-tiktok/dto/pod-shop-sync-status.dto';
import { PodScopeGuard } from '../pod-tiktok/guards/pod-scope.guard';
import type { PodAccessScope } from '../pod-tiktok/services/pod-access-scope.service';
import { POD_RETURN_PERMISSIONS } from './constants/pod-return.constants';
import { PodReturnFilterDto, PodReturnQueryDto, TriggerReturnSyncDto } from './dto/pod-return-query.dto';
import {
  PaginatedPodReturnResponseDto,
  PodReturnDetailDto,
  PodReturnFilterOptionsDto,
  PodReturnHistoryDto,
  PodReturnSummaryDto,
  PodReturnSyncResultDto,
} from './dto/pod-return-response.dto';
import { PodReturnService } from './services/pod-return.service';

/**
 * PodReturnController — Return Orders (TikTok Return & Refund) đã đồng bộ.
 *
 * Tenant-scoped (organizationId từ JWT — ADR-004) + RBAC `pod.tiktok.return.*` + phạm vi shop
 * (`PodScopeGuard`). Không route nào trả raw payload TikTok hay thông tin xác thực.
 */
@ApiTags('POD - TikTok Return Orders')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN) hoặc shop ngoài phạm vi (POD_SHOP_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@Controller('pod/tiktok/returns')
export class PodReturnController {
  constructor(private readonly service: PodReturnService) {}

  @Get()
  @RequirePermissions(POD_RETURN_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Danh sách yêu cầu Return/Refund đã đồng bộ (lọc, tìm kiếm, phân trang)' })
  @ApiOkResponse({ type: PaginatedPodReturnResponseDto })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodReturnQueryDto,
  ): Promise<PaginatedPodReturnResponseDto> {
    return this.service.findAll(user.organizationId, query, scope);
  }

  @Get('summary')
  @RequirePermissions(POD_RETURN_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Thẻ tổng quan — CÙNG bộ lọc với danh sách',
    description:
      'Số yêu cầu theo nhóm trạng thái, số đơn, và tiền theo từng đơn vị tiền tệ: yêu cầu (TikTok báo), ' +
      'đã hoàn theo trạng thái yêu cầu, và doanh thu bị trừ trong statement đã quyết toán (mỗi đơn một lần).',
  })
  @ApiOkResponse({ type: PodReturnSummaryDto })
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodReturnFilterDto,
  ): Promise<PodReturnSummaryDto> {
    return this.service.summary(user.organizationId, query, scope);
  }

  @Get('filter-options')
  @RequirePermissions(POD_RETURN_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Loại yêu cầu / trạng thái / lý do đang có trong phạm vi (cho ô lọc)' })
  @ApiOkResponse({ type: PodReturnFilterOptionsDto })
  filterOptions(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
  ): Promise<PodReturnFilterOptionsDto> {
    return this.service.filterOptions(user.organizationId, scope);
  }

  @Get('sync-status')
  @RequirePermissions(POD_RETURN_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Trạng thái đồng bộ Return/Refund gần nhất theo shop (gồm lỗi thiếu scope)' })
  @ApiOkResponse({ type: PodShopSyncStatusListDto })
  syncStatus(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodShopSyncStatusQueryDto,
  ): Promise<PodShopSyncStatusListDto> {
    return this.service.syncStatuses(user.organizationId, scope, query.shopId);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(POD_RETURN_PERMISSIONS.SYNC)
  @ApiOperation({
    summary: 'Đồng bộ Return/Refund thủ công',
    description:
      'Một shop (shopId) hoặc mọi shop trong phạm vi. Kết quả theo từng shop — một shop lỗi (vd thiếu scope ' +
      '`seller.return_refund.basic` ⇒ RETURN_SCOPE_MISSING) không làm mất kết quả của shop khác.',
  })
  @ApiOkResponse({ type: PodReturnSyncResultDto })
  triggerSync(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Body() dto: TriggerReturnSyncDto,
  ): Promise<PodReturnSyncResultDto> {
    return this.service.triggerSync(user.organizationId, user.userId, scope, dto.shopId);
  }

  @Get(':id/history')
  @RequirePermissions(POD_RETURN_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Lịch sử xử lý yêu cầu (TikTok GetReturnRecords) — đúng dữ liệu TikTok trả' })
  @ApiOkResponse({ type: PodReturnHistoryDto })
  @ApiNotFoundResponse({ description: 'POD_RETURN_NOT_FOUND' })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodReturnHistoryDto> {
    return this.service.history(user.organizationId, id, scope);
  }

  @Get(':id')
  @RequirePermissions(POD_RETURN_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Chi tiết một yêu cầu Return/Refund' })
  @ApiOkResponse({ type: PodReturnDetailDto })
  @ApiNotFoundResponse({ description: 'POD_RETURN_NOT_FOUND' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PodReturnDetailDto> {
    return this.service.findOne(user.organizationId, id, scope);
  }
}
