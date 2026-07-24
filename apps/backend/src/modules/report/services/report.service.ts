import { Injectable } from '@nestjs/common';
import { type ReportGroupBy, type ReportMetric } from '../constants/report.constants';
import {
  DateRangeQueryDto,
  MetricQueryDto,
  SellerPerformanceQueryDto,
  SellerTimeSeriesQueryDto,
  TimeSeriesQueryDto,
} from '../dto/report-query.dto';
import {
  DashboardSummaryDto,
  OverviewSeriesDto,
  SellerChartDto,
  SellerPerformanceDto,
  SellerRankingDto,
  SellerReportDto,
  TimeSeriesPointDto,
  WarehousePerformanceDto,
} from '../dto/report-response.dto';
import {
  DateRange,
  ReportRepository,
  SellerTotalRow,
} from '../repositories/report.repository';

const CURRENCY = 'USD';
const UNASSIGNED_SELLER = 'Chưa gán';
/** Trần số bucket sinh ra khi fill khoảng trống (chống mảng khổng lồ khi range quá rộng). */
const MAX_FILL_BUCKETS = 732;

@Injectable()
export class ReportService {
  constructor(private readonly repo: ReportRepository) {}

  /** Tổng quan Dashboard (theo bộ lọc thời gian). */
  async dashboardSummary(organizationId: string, dto: DateRangeQueryDto): Promise<DashboardSummaryDto> {
    const range = this.resolveRange(dto);
    const s = await this.repo.summary(organizationId, range);
    return { totalOrders: s.orders, totalRevenue: round2(s.revenue), currency: CURRENCY };
  }

  /** Overview: time-series tổng theo metric + groupBy. */
  async overview(organizationId: string, dto: TimeSeriesQueryDto): Promise<OverviewSeriesDto> {
    const range = this.resolveRange(dto);
    const metric = dto.metric ?? 'revenue';
    const groupBy = dto.groupBy ?? 'day';
    const rows = await this.repo.overviewSeries(organizationId, range, groupBy);
    const present = rows.map((r) => ({ bucket: r.bucket, value: this.pick(metric, r.orders, r.revenue) }));
    return { metric, groupBy, points: this.fill(present, groupBy, range) };
  }

  /** Báo cáo Seller: time-series theo từng Seller (hoặc 1 Seller). */
  async sellerReport(organizationId: string, dto: SellerTimeSeriesQueryDto): Promise<SellerReportDto> {
    const range = this.resolveRange(dto);
    const metric = dto.metric ?? 'revenue';
    const groupBy = dto.groupBy ?? 'day';
    const rows = await this.repo.sellerSeries(organizationId, range, groupBy, dto.sellerId);

    // Pivot: gom theo seller → points (sparse) → fill khoảng trống.
    const bySeller = new Map<string, { sellerId: string | null; sellerName: string; points: TimeSeriesPointDto[] }>();
    for (const r of rows) {
      const key = r.sellerId ?? '__none__';
      let entry = bySeller.get(key);
      if (!entry) {
        entry = { sellerId: r.sellerId, sellerName: r.sellerName ?? UNASSIGNED_SELLER, points: [] };
        bySeller.set(key, entry);
      }
      entry.points.push({ bucket: r.bucket, value: this.pick(metric, r.orders, r.revenue) });
    }

    const sellers = [...bySeller.values()].map((e) => {
      const points = this.fill(e.points, groupBy, range);
      const total = round2(e.points.reduce((sum, p) => sum + p.value, 0));
      return { sellerId: e.sellerId, sellerName: e.sellerName, points, total };
    });
    sellers.sort((a, b) => b.total - a.total);
    return { metric, groupBy, sellers };
  }

  /** Biểu đồ Doanh thu/Đơn Seller: 1 cột / Seller (tổng metric trong kỳ). */
  async sellerChart(organizationId: string, dto: MetricQueryDto): Promise<SellerChartDto> {
    const range = this.resolveRange(dto);
    const metric = dto.metric ?? 'revenue';
    const totals = await this.repo.sellerTotals(organizationId, range);
    const rows = totals
      .map((t: SellerTotalRow) => ({
        sellerId: t.sellerId,
        sellerName: t.sellerName ?? UNASSIGNED_SELLER,
        value: metric === 'revenue' ? round2(t.revenue) : t.orders,
      }))
      .sort((a, b) => a.value - b.value); // tăng dần theo mockup (doanh thu 3)
    return { metric, rows };
  }

  /**
   * Hiệu suất Seller (KPI vs Thực đạt vs Dự báo) trong 1 tháng.
   * Thực đạt = từ đầu tháng đến hiện tại (nếu là tháng hiện tại) / cả tháng (nếu tháng đã qua).
   * Forecast = (thực đạt / số ngày đã trôi qua) × số ngày của tháng — an toàn khi chia 0.
   */
  async sellerPerformance(
    organizationId: string,
    dto: SellerPerformanceQueryDto,
    now = new Date(),
  ): Promise<SellerPerformanceDto> {
    const metric = dto.metric ?? 'revenue';
    const year = dto.year ?? now.getUTCFullYear();
    const month = dto.month ?? now.getUTCMonth() + 1; // 1-12

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1)); // đầu tháng kế (exclusive)
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    // Xác định cửa sổ "thực đạt" + số ngày đã trôi qua (an toàn, không chia 0).
    const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
    const isFutureMonth = monthStart.getTime() > now.getTime();
    let actualEnd = monthEnd;
    let daysElapsed = daysInMonth;
    if (isFutureMonth) {
      actualEnd = monthStart; // chưa tới → không có thực đạt
      daysElapsed = 0;
    } else if (isCurrentMonth) {
      // đến hết ngày hôm nay (exclusive = 00:00 ngày mai UTC)
      const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      actualEnd = tomorrow < monthEnd ? tomorrow : monthEnd;
      daysElapsed = now.getUTCDate(); // ngày trong tháng (>=1)
    }

    const raw =
      daysElapsed > 0
        ? await this.repo.sellerKpiActual(organizationId, monthStart, actualEnd)
        : await this.repo.sellerKpiActual(organizationId, monthStart, monthStart); // future → actual 0

    const factor = daysElapsed > 0 ? daysInMonth / daysElapsed : 0;
    const rows = raw
      .map((r) => ({
        sellerId: r.sellerId,
        sellerName: r.sellerName ?? UNASSIGNED_SELLER,
        targetOrders: r.orderKpi,
        actualOrders: r.actualOrders,
        forecastOrders: Math.round(r.actualOrders * factor),
        targetRevenue: round2(r.revenueKpi),
        actualRevenue: round2(r.actualRevenue),
        forecastRevenue: round2(r.actualRevenue * factor),
      }))
      .sort((x, y) =>
        metric === 'revenue' ? y.actualRevenue - x.actualRevenue : y.actualOrders - x.actualOrders,
      );

    return { metric, month, year, daysElapsed, daysInMonth, rows };
  }

  /** Hiệu suất Kho: thống kê theo từng nhân viên Fulfillment. */
  async warehousePerformance(organizationId: string, dto: DateRangeQueryDto): Promise<WarehousePerformanceDto> {
    const range = this.resolveRange(dto);
    const rows = await this.repo.warehousePerformance(organizationId, range);
    return {
      rows: rows.map((r) => ({
        userId: r.userId,
        userName: r.userName ?? '—',
        totalOrders: r.totalOrders,
        notProcessed: r.notProcessed,
        processing: r.processing,
        cancelled: r.cancelled,
        completed: r.completed,
        revenue: round2(r.revenue),
      })),
    };
  }

  /** Xếp hạng Seller theo metric (revenue|order). */
  async sellerRanking(organizationId: string, dto: MetricQueryDto): Promise<SellerRankingDto> {
    const range = this.resolveRange(dto);
    const metric = dto.metric ?? 'revenue';
    const totals = await this.repo.sellerTotals(organizationId, range);
    const ranked = totals
      .map((t: SellerTotalRow) => ({
        sellerId: t.sellerId,
        sellerName: t.sellerName ?? UNASSIGNED_SELLER,
        value: metric === 'revenue' ? round2(t.revenue) : t.orders,
      }))
      .sort((a, b) => b.value - a.value)
      .map((r, i) => ({ rank: i + 1, ...r }));
    return { metric, rows: ranked };
  }

  // --- helpers ---

  private pick(metric: ReportMetric, orders: number, revenue: number): number {
    return metric === 'revenue' ? round2(revenue) : orders;
  }

  /** Chuẩn hoá bộ lọc thời gian → [start, endExclusive). endDate là inclusive (cộng 1 ngày). */
  private resolveRange(dto: DateRangeQueryDto): DateRange {
    const start = dto.startDate ? new Date(`${dto.startDate.slice(0, 10)}T00:00:00.000Z`) : undefined;
    let endExclusive: Date | undefined;
    if (dto.endDate) {
      const d = new Date(`${dto.endDate.slice(0, 10)}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      endExclusive = d;
    }
    return { start, endExclusive };
  }

  /**
   * Fill khoảng trống buckets (chỉ khi có đủ start+end) để đường/cột liên tục.
   * "Tất cả thời gian" (không range) → giữ sparse (tránh sinh mảng khổng lồ).
   */
  private fill(
    present: TimeSeriesPointDto[],
    groupBy: ReportGroupBy,
    range: DateRange,
  ): TimeSeriesPointDto[] {
    if (!range.start || !range.endExclusive) {
      return [...present].sort((a, b) => a.bucket.localeCompare(b.bucket));
    }
    const buckets = enumerateBuckets(range.start, range.endExclusive, groupBy);
    if (buckets.length === 0 || buckets.length > MAX_FILL_BUCKETS) {
      return [...present].sort((a, b) => a.bucket.localeCompare(b.bucket));
    }
    const valueByBucket = new Map(present.map((p) => [p.bucket, p.value]));
    return buckets.map((bucket) => ({ bucket, value: valueByBucket.get(bucket) ?? 0 }));
  }
}

/** Làm tròn 2 chữ số (tránh nhiễu float). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Sinh danh sách bucket key ('YYYY-MM-DD') liên tục phủ [start, endExclusive) theo groupBy (UTC). */
function enumerateBuckets(start: Date, endExclusive: Date, groupBy: ReportGroupBy): string[] {
  const keys: string[] = [];
  const cursor = truncateUTC(start, groupBy);
  while (cursor < endExclusive && keys.length <= MAX_FILL_BUCKETS) {
    keys.push(cursor.toISOString().slice(0, 10));
    stepUTC(cursor, groupBy);
  }
  return keys;
}

function truncateUTC(date: Date, groupBy: ReportGroupBy): Date {
  const d = new Date(date.getTime());
  d.setUTCHours(0, 0, 0, 0);
  if (groupBy === 'month') d.setUTCDate(1);
  if (groupBy === 'year') {
    d.setUTCMonth(0, 1);
  }
  return d;
}

function stepUTC(cursor: Date, groupBy: ReportGroupBy): void {
  if (groupBy === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
  else if (groupBy === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
}
