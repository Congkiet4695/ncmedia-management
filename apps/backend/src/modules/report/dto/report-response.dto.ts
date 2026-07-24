import { ApiProperty } from '@nestjs/swagger';

/** Tổng quan Dashboard (theo bộ lọc thời gian). */
export class DashboardSummaryDto {
  @ApiProperty({ description: 'Tổng số Order trong khoảng thời gian' }) totalOrders!: number;
  @ApiProperty({ description: 'Tổng doanh thu (USD) = SUM(quantity × unitPrice)' }) totalRevenue!: number;
  @ApiProperty({ description: 'Đơn vị tiền tệ hiển thị', example: 'USD' }) currency!: string;
}

/** Một điểm dữ liệu time-series. */
export class TimeSeriesPointDto {
  @ApiProperty({ description: 'Mốc thời gian (ISO date)', example: '2026-07-01' }) bucket!: string;
  @ApiProperty({ description: 'Giá trị metric tại mốc này' }) value!: number;
}

/** Time-series tổng (Overview). */
export class OverviewSeriesDto {
  @ApiProperty({ enum: ['revenue', 'order'] }) metric!: string;
  @ApiProperty({ enum: ['day', 'month', 'year'] }) groupBy!: string;
  @ApiProperty({ type: TimeSeriesPointDto, isArray: true }) points!: TimeSeriesPointDto[];
}

/** Time-series của 1 Seller. */
export class SellerSeriesDto {
  @ApiProperty({ nullable: true, type: String }) sellerId!: string | null;
  @ApiProperty() sellerName!: string;
  @ApiProperty({ type: TimeSeriesPointDto, isArray: true }) points!: TimeSeriesPointDto[];
  @ApiProperty({ description: 'Tổng metric của Seller trong kỳ (SUM các điểm)' }) total!: number;
}

/** Báo cáo Seller time-series (nhiều Seller). */
export class SellerReportDto {
  @ApiProperty({ enum: ['revenue', 'order'] }) metric!: string;
  @ApiProperty({ enum: ['day', 'month', 'year'] }) groupBy!: string;
  @ApiProperty({ type: SellerSeriesDto, isArray: true }) sellers!: SellerSeriesDto[];
}

/** Một cột (giá trị theo Seller) cho biểu đồ Doanh thu/Đơn Seller. */
export class SellerChartRowDto {
  @ApiProperty({ nullable: true, type: String }) sellerId!: string | null;
  @ApiProperty() sellerName!: string;
  @ApiProperty({ description: 'Giá trị metric: revenue = USD, order = số đơn' }) value!: number;
}

export class SellerChartDto {
  @ApiProperty({ enum: ['revenue', 'order'] }) metric!: string;
  @ApiProperty({ type: SellerChartRowDto, isArray: true }) rows!: SellerChartRowDto[];
}

/**
 * Một dòng hiệu suất Seller (KPI vs Thực đạt vs Dự báo) trong 1 tháng.
 * Cung cấp cả 2 metric để frontend đổi metric không cần refetch; forecast tính an toàn (không /0).
 */
export class SellerPerformanceRowDto {
  @ApiProperty({ nullable: true, type: String }) sellerId!: string | null;
  @ApiProperty() sellerName!: string;
  // Đơn hàng
  @ApiProperty({ description: 'KPI Đơn hàng (cần đạt)' }) targetOrders!: number;
  @ApiProperty({ description: 'Đơn hàng thực đạt (đầu tháng → hiện tại)' }) actualOrders!: number;
  @ApiProperty({ description: 'Dự báo đơn hàng cuối tháng' }) forecastOrders!: number;
  // Doanh thu
  @ApiProperty({ description: 'KPI Doanh thu (cần đạt, USD)' }) targetRevenue!: number;
  @ApiProperty({ description: 'Doanh thu thực đạt (USD)' }) actualRevenue!: number;
  @ApiProperty({ description: 'Dự báo doanh thu cuối tháng (USD)' }) forecastRevenue!: number;
}

export class SellerPerformanceDto {
  @ApiProperty({ enum: ['revenue', 'order'] }) metric!: string;
  @ApiProperty({ description: 'Tháng (1-12) của báo cáo' }) month!: number;
  @ApiProperty({ description: 'Năm của báo cáo' }) year!: number;
  @ApiProperty({ description: 'Số ngày đã trôi qua trong tháng (dùng cho forecast)' }) daysElapsed!: number;
  @ApiProperty({ description: 'Tổng số ngày của tháng' }) daysInMonth!: number;
  @ApiProperty({ type: SellerPerformanceRowDto, isArray: true }) rows!: SellerPerformanceRowDto[];
}

/** Một dòng hiệu suất Kho (Fulfillment). */
export class WarehousePerformanceRowDto {
  @ApiProperty() userId!: string;
  @ApiProperty() userName!: string;
  @ApiProperty({ description: 'Tổng đơn hàng phụ trách' }) totalOrders!: number;
  @ApiProperty({ description: 'Đơn chưa xử lí (WAITING)' }) notProcessed!: number;
  @ApiProperty({ description: 'Đơn đang xử lí' }) processing!: number;
  @ApiProperty({ description: 'Đơn hủy (CANCELLED/REFUND)' }) cancelled!: number;
  @ApiProperty({ description: 'Đơn hoàn tất (COMPLETED/SHIPPED)' }) completed!: number;
  @ApiProperty({ description: 'Balance làm được (doanh thu các đơn phụ trách)' }) revenue!: number;
}

export class WarehousePerformanceDto {
  @ApiProperty({ type: WarehousePerformanceRowDto, isArray: true }) rows!: WarehousePerformanceRowDto[];
}

/** Một dòng xếp hạng Seller. */
export class SellerRankingRowDto {
  @ApiProperty() rank!: number;
  @ApiProperty({ nullable: true, type: String }) sellerId!: string | null;
  @ApiProperty() sellerName!: string;
  @ApiProperty({ description: 'Giá trị metric (revenue = USD, order = số đơn)' }) value!: number;
}

export class SellerRankingDto {
  @ApiProperty({ enum: ['revenue', 'order'] }) metric!: string;
  @ApiProperty({ type: SellerRankingRowDto, isArray: true }) rows!: SellerRankingRowDto[];
}
