import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { PodScope } from './decorators/pod-scope.decorator';
import {
  DashboardFilterOptionsDto,
  DashboardOverviewDto,
  DashboardSellerPageDto,
  DashboardSummaryDto,
  DashboardTrendsDto,
  PodDashboardFilterDto,
  PodDashboardRangeDto,
  PodDashboardSellerQueryDto,
} from './dto/pod-dashboard.dto';
import { PodScopeGuard } from './guards/pod-scope.guard';
import type { PodAccessScope } from './services/pod-access-scope.service';
import { PodDashboardService } from './services/pod-dashboard.service';

/**
 * Dashboard quản trị (POD / TikTok Shop).
 *
 * 🔴 Quyền giữ NGUYÊN như Dashboard hiện tại: `report.read` (mặc định chỉ Admin). Phạm vi dữ liệu
 * còn được `PodScopeGuard` giới hạn ở backend: người không có `pod.shop.all` (vd role tuỳ biến được
 * cấp `report.read`) chỉ thấy số liệu của TikTok Account được gán cho chính họ — không lộ Hold,
 * doanh thu, payout, đơn của seller khác. Tổ chức luôn lấy từ JWT.
 */
@ApiTags('POD Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@RequirePermissions('report.read')
@Controller('pod/dashboard')
export class PodDashboardController {
  constructor(private readonly service: PodDashboardService) {}

  @Get('filters')
  @ApiOperation({ summary: 'Lựa chọn cho bộ lọc: đơn vị tiền · shop · seller (trong phạm vi người xem)' })
  @ApiOkResponse({ type: DashboardFilterOptionsDto })
  filters(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
  ): Promise<DashboardFilterOptionsDto> {
    return this.service.filterOptions(user.organizationId, scope);
  }

  @Get('overview')
  @ApiOperation({
    summary: 'Tổng quan: Hold · trạng thái shop · Hold theo seller · đơn Hôm nay / Hôm qua / Tháng này / Tháng trước',
    description:
      'Hold = Σ est_settlement_amount của giao dịch TikTok CHƯA quyết toán (ảnh chụp hiện tại, không theo ngày). ' +
      'Kỳ theo múi giờ vận hành (APP_TIMEZONE_OFFSET_MINUTES).',
  })
  @ApiOkResponse({ type: DashboardOverviewDto })
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodDashboardFilterDto,
  ): Promise<DashboardOverviewDto> {
    return this.service.overview(user.organizationId, scope, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Tài chính (Đã thanh toán / Đang xử lý) + Đơn hàng theo nhóm trạng thái trong khoảng ngày' })
  @ApiOkResponse({ type: DashboardSummaryDto })
  @ApiBadRequestResponse({ description: 'DASHBOARD_RANGE_INVALID' })
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodDashboardRangeDto,
  ): Promise<DashboardSummaryDto> {
    return this.service.summary(user.organizationId, scope, query);
  }

  @Get('sellers')
  @ApiOperation({ summary: 'Thống kê seller (sắp xếp / tìm kiếm / phân trang ở DB)' })
  @ApiOkResponse({ type: DashboardSellerPageDto })
  @ApiBadRequestResponse({ description: 'DASHBOARD_RANGE_INVALID' })
  sellers(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodDashboardSellerQueryDto,
  ): Promise<DashboardSellerPageDto> {
    return this.service.sellers(user.organizationId, scope, query);
  }

  @Get('trends')
  @ApiOperation({ summary: 'Xu hướng tài chính + đơn hàng theo ngày (mọi ngày trong khoảng, ngày trống = 0)' })
  @ApiOkResponse({ type: DashboardTrendsDto })
  @ApiBadRequestResponse({ description: 'DASHBOARD_RANGE_INVALID' })
  trends(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Query() query: PodDashboardRangeDto,
  ): Promise<DashboardTrendsDto> {
    return this.service.trends(user.organizationId, scope, query);
  }
}
