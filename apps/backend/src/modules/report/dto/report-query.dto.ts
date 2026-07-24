import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  REPORT_GROUP_BY,
  REPORT_METRICS,
  type ReportGroupBy,
  type ReportMetric,
} from '../constants/report.constants';

/**
 * Bộ lọc thời gian dùng chung cho Dashboard + Reports (yêu cầu: cùng bộ lọc, cùng cách tính).
 * `startDate`/`endDate` = ISO date (YYYY-MM-DD). Bỏ trống = tất cả thời gian.
 * Lọc theo COALESCE(ordered_at, created_at) của Order.
 */
export class DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Từ ngày (ISO, gồm cả ngày này). Bỏ trống = không giới hạn dưới.' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Đến ngày (ISO, gồm cả ngày này). Bỏ trống = không giới hạn trên.' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;
}

/** Query có thêm metric (revenue|order). */
export class MetricQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: REPORT_METRICS, default: 'revenue' })
  @IsOptional()
  @IsEnum(REPORT_METRICS)
  metric?: ReportMetric = 'revenue';
}

/** Query cho time-series: metric + groupBy (day|month|year). */
export class TimeSeriesQueryDto extends MetricQueryDto {
  @ApiPropertyOptional({ enum: REPORT_GROUP_BY, default: 'day' })
  @IsOptional()
  @IsEnum(REPORT_GROUP_BY)
  groupBy?: ReportGroupBy = 'day';
}

/** Query báo cáo Seller time-series: có thêm sellerId (optional). */
export class SellerTimeSeriesQueryDto extends TimeSeriesQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Lọc theo 1 Seller. Bỏ trống = tất cả Seller.' })
  @IsOptional()
  @IsUUID()
  sellerId?: string;
}

/**
 * Query Hiệu suất Seller (KPI/forecast): metric + tháng/năm. Bỏ trống → tháng hiện tại.
 * Forecast tính theo tháng nên dùng month/year thay vì range tự do.
 */
export class SellerPerformanceQueryDto {
  @ApiPropertyOptional({ enum: REPORT_METRICS, default: 'revenue' })
  @IsOptional()
  @IsEnum(REPORT_METRICS)
  metric?: ReportMetric = 'revenue';

  @ApiPropertyOptional({ minimum: 1, maximum: 12, description: 'Tháng (1-12). Bỏ trống = tháng hiện tại.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({ minimum: 2000, maximum: 2100, description: 'Năm. Bỏ trống = năm hiện tại.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
