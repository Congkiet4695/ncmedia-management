import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
  DateRangeQueryDto,
  MetricQueryDto,
  SellerPerformanceQueryDto,
  SellerTimeSeriesQueryDto,
  TimeSeriesQueryDto,
} from './dto/report-query.dto';
import {
  DashboardSummaryDto,
  OverviewSeriesDto,
  SellerChartDto,
  SellerPerformanceDto,
  SellerRankingDto,
  SellerReportDto,
  WarehousePerformanceDto,
} from './dto/report-response.dto';
import { ReportService } from './services/report.service';

/**
 * ReportController — Báo cáo thống kê (Dashboard + Reports). Tenant-scoped + RBAC (`report.read`).
 * Toàn bộ số liệu aggregate tại DB (không xử lý ở JS). Doanh thu = SUM(qty × unitPrice) (ADR-014).
 * Bộ lọc thời gian dùng chung: startDate / endDate (+ metric, groupBy, sellerId tùy endpoint).
 */
@ApiTags('Reports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission report.read (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.read')
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('dashboard-summary')
  @ApiOperation({ summary: 'Tổng quan Dashboard: tổng đơn + tổng doanh thu (theo bộ lọc thời gian)' })
  @ApiOkResponse({ type: DashboardSummaryDto })
  dashboardSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DateRangeQueryDto,
  ): Promise<DashboardSummaryDto> {
    return this.reportService.dashboardSummary(user.organizationId, query);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Tổng quan: time-series doanh thu/đơn theo ngày/tháng/năm' })
  @ApiOkResponse({ type: OverviewSeriesDto })
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TimeSeriesQueryDto,
  ): Promise<OverviewSeriesDto> {
    return this.reportService.overview(user.organizationId, query);
  }

  @Get('seller')
  @ApiOperation({ summary: 'Doanh thu/Đơn theo Seller (time-series, có thể lọc 1 Seller)' })
  @ApiOkResponse({ type: SellerReportDto })
  seller(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SellerTimeSeriesQueryDto,
  ): Promise<SellerReportDto> {
    return this.reportService.sellerReport(user.organizationId, query);
  }

  @Get('seller-chart')
  @ApiOperation({ summary: 'Biểu đồ Doanh thu/Đơn theo Seller (1 cột/Seller, tổng trong kỳ)' })
  @ApiOkResponse({ type: SellerChartDto })
  sellerChart(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MetricQueryDto,
  ): Promise<SellerChartDto> {
    return this.reportService.sellerChart(user.organizationId, query);
  }

  @Get('seller-performance')
  @ApiOperation({ summary: 'Hiệu suất Seller: KPI vs Thực đạt vs Dự báo cuối tháng (theo tháng/năm)' })
  @ApiOkResponse({ type: SellerPerformanceDto })
  sellerPerformance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SellerPerformanceQueryDto,
  ): Promise<SellerPerformanceDto> {
    return this.reportService.sellerPerformance(user.organizationId, query);
  }

  @Get('warehouse-performance')
  @ApiOperation({ summary: 'Hiệu suất Kho: thống kê theo từng nhân viên Fulfillment' })
  @ApiOkResponse({ type: WarehousePerformanceDto })
  warehousePerformance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DateRangeQueryDto,
  ): Promise<WarehousePerformanceDto> {
    return this.reportService.warehousePerformance(user.organizationId, query);
  }

  @Get('seller-ranking')
  @ApiOperation({ summary: 'Xếp hạng Seller theo doanh thu hoặc số đơn' })
  @ApiOkResponse({ type: SellerRankingDto })
  sellerRanking(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MetricQueryDto,
  ): Promise<SellerRankingDto> {
    return this.reportService.sellerRanking(user.organizationId, query);
  }
}
