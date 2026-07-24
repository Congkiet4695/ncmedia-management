import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  DATE_TRUNC_UNIT,
  ORDER_STATUS_GROUPS,
  type ReportGroupBy,
} from '../constants/report.constants';

/** Khoảng thời gian đã chuẩn hoá (nửa mở: [start, endExclusive)). */
export interface DateRange {
  start?: Date;
  endExclusive?: Date;
}

export interface SummaryRow {
  orders: number;
  revenue: number;
}
export interface SeriesRow {
  bucket: string;
  orders: number;
  revenue: number;
}
export interface SellerSeriesRow {
  sellerId: string | null;
  sellerName: string | null;
  bucket: string;
  orders: number;
  revenue: number;
}
export interface SellerTotalRow {
  sellerId: string | null;
  sellerName: string | null;
  orders: number;
  revenue: number;
}
export interface SellerKpiActualRow {
  sellerId: string;
  sellerName: string | null;
  orderKpi: number;
  revenueKpi: number;
  actualOrders: number;
  actualRevenue: number;
}
export interface WarehouseRow {
  userId: string;
  userName: string | null;
  totalOrders: number;
  notProcessed: number;
  processing: number;
  cancelled: number;
  completed: number;
  revenue: number;
}

/**
 * ReportRepository — data access cho Báo cáo. TẤT CẢ thống kê được tính bằng
 * SQL aggregate (GROUP BY / SUM / COUNT / FILTER) tại Database — KHÔNG kéo toàn bộ
 * Order về xử lý bằng JavaScript (yêu cầu: mở rộng tới hàng triệu bản ghi).
 * Mọi query tenant-scoped theo organization_id (ADR-004) + bỏ đơn đã xoá mềm.
 * Doanh thu = SUM(order_item.quantity * order_item.unit_price) (ADR-014).
 */
@Injectable()
export class ReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Điều kiện WHERE chung cho bảng orders (tenant + soft-delete + range trên ordered_at). */
  private orderWhere(organizationId: string, range: DateRange, alias = 'o'): Prisma.Sql {
    const a = Prisma.raw(alias);
    const conds: Prisma.Sql[] = [
      Prisma.sql`${a}.organization_id = ${organizationId}::uuid`,
      Prisma.sql`${a}.deleted_at IS NULL`,
    ];
    if (range.start) {
      conds.push(Prisma.sql`COALESCE(${a}.ordered_at, ${a}.created_at) >= ${range.start}`);
    }
    if (range.endExclusive) {
      conds.push(Prisma.sql`COALESCE(${a}.ordered_at, ${a}.created_at) < ${range.endExclusive}`);
    }
    return Prisma.join(conds, ' AND ');
  }

  /** date_trunc theo groupBy (đơn vị đã whitelist — an toàn injection). */
  private bucketExpr(groupBy: ReportGroupBy, alias = 'o'): Prisma.Sql {
    const unit = Prisma.raw(`'${DATE_TRUNC_UNIT[groupBy]}'`);
    const a = Prisma.raw(alias);
    return Prisma.sql`to_char(date_trunc(${unit}, COALESCE(${a}.ordered_at, ${a}.created_at)), 'YYYY-MM-DD')`;
  }

  /** IN-list cho o.status::text (so text ↔ enum an toàn). */
  private statusIn(statuses: readonly string[]): Prisma.Sql {
    return Prisma.join(statuses.map((s) => Prisma.sql`${s}`));
  }

  /** Tổng quan Dashboard: tổng số đơn + tổng doanh thu trong kỳ. */
  async summary(organizationId: string, range: DateRange): Promise<SummaryRow> {
    const rows = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT o.id)::int AS orders,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float8 AS revenue
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${this.orderWhere(organizationId, range)}
    `);
    return rows[0] ?? { orders: 0, revenue: 0 };
  }

  /** Time-series tổng theo bucket (cả 2 metric — service chọn metric để trả). */
  overviewSeries(organizationId: string, range: DateRange, groupBy: ReportGroupBy): Promise<SeriesRow[]> {
    const bucket = this.bucketExpr(groupBy);
    return this.prisma.$queryRaw<SeriesRow[]>(Prisma.sql`
      SELECT
        ${bucket} AS bucket,
        COUNT(DISTINCT o.id)::int AS orders,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float8 AS revenue
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${this.orderWhere(organizationId, range)}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
  }

  /** Time-series theo từng Seller (account.seller_user_id). Có thể lọc 1 seller. */
  sellerSeries(
    organizationId: string,
    range: DateRange,
    groupBy: ReportGroupBy,
    sellerId?: string,
  ): Promise<SellerSeriesRow[]> {
    const bucket = this.bucketExpr(groupBy);
    const sellerFilter = sellerId
      ? Prisma.sql`AND a.seller_user_id = ${sellerId}::uuid`
      : Prisma.empty;
    return this.prisma.$queryRaw<SellerSeriesRow[]>(Prisma.sql`
      SELECT
        a.seller_user_id AS "sellerId",
        u.full_name AS "sellerName",
        ${bucket} AS bucket,
        COUNT(DISTINCT o.id)::int AS orders,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float8 AS revenue
      FROM orders o
      JOIN accounts a ON a.id = o.account_id
      LEFT JOIN users u ON u.id = a.seller_user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${this.orderWhere(organizationId, range)} ${sellerFilter}
      GROUP BY a.seller_user_id, u.full_name, bucket
      ORDER BY bucket ASC
    `);
  }

  /** Tổng theo từng Seller trong kỳ (dùng cho Hiệu suất Seller + Xếp hạng Seller). */
  sellerTotals(organizationId: string, range: DateRange): Promise<SellerTotalRow[]> {
    return this.prisma.$queryRaw<SellerTotalRow[]>(Prisma.sql`
      SELECT
        a.seller_user_id AS "sellerId",
        u.full_name AS "sellerName",
        COUNT(DISTINCT o.id)::int AS orders,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float8 AS revenue
      FROM orders o
      JOIN accounts a ON a.id = o.account_id
      LEFT JOIN users u ON u.id = a.seller_user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${this.orderWhere(organizationId, range)}
      GROUP BY a.seller_user_id, u.full_name
    `);
  }

  /**
   * KPI (từ Employee) + số liệu THỰC ĐẠT trong cửa sổ tháng, theo từng Seller.
   * Seller = User quản lý ≥1 Account. KPI lấy từ Employee (1-1 User); không có Employee → 0.
   * Actual = đơn/doanh thu của các Account seller quản lý, có ordered_at trong [start, endExclusive).
   * Gom hoàn toàn bằng SQL (không N+1). Forecast tính ở service.
   */
  sellerKpiActual(
    organizationId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<SellerKpiActualRow[]> {
    return this.prisma.$queryRaw<SellerKpiActualRow[]>(Prisma.sql`
      SELECT
        u.id AS "sellerId",
        u.full_name AS "sellerName",
        COALESCE(e.order_kpi, 0)::int AS "orderKpi",
        COALESCE(e.revenue_kpi, 0)::float8 AS "revenueKpi",
        COALESCE(COUNT(DISTINCT o.id), 0)::int AS "actualOrders",
        COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float8 AS "actualRevenue"
      FROM (
        SELECT DISTINCT a.seller_user_id AS sid
        FROM accounts a
        WHERE a.organization_id = ${organizationId}::uuid
          AND a.deleted_at IS NULL
          AND a.seller_user_id IS NOT NULL
      ) s
      JOIN users u ON u.id = s.sid AND u.deleted_at IS NULL
      LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
      LEFT JOIN accounts a2 ON a2.seller_user_id = u.id
        AND a2.organization_id = ${organizationId}::uuid AND a2.deleted_at IS NULL
      LEFT JOIN orders o ON o.account_id = a2.id AND o.deleted_at IS NULL
        AND COALESCE(o.ordered_at, o.created_at) >= ${start}
        AND COALESCE(o.ordered_at, o.created_at) < ${endExclusive}
      LEFT JOIN order_items oi ON oi.order_id = o.id
      GROUP BY u.id, u.full_name, e.order_kpi, e.revenue_kpi
      ORDER BY u.full_name ASC
    `);
  }

  /** Hiệu suất Kho: gom theo fulfilled_by_id (Fulfillment đã claim đơn). */
  warehousePerformance(organizationId: string, range: DateRange): Promise<WarehouseRow[]> {
    const where = this.orderWhere(organizationId, range);
    return this.prisma.$queryRaw<WarehouseRow[]>(Prisma.sql`
      SELECT
        o.fulfilled_by_id AS "userId",
        u.full_name AS "userName",
        COUNT(DISTINCT o.id)::int AS "totalOrders",
        COUNT(DISTINCT o.id) FILTER (WHERE o.status::text IN (${this.statusIn(ORDER_STATUS_GROUPS.notProcessed)}))::int AS "notProcessed",
        COUNT(DISTINCT o.id) FILTER (WHERE o.status::text IN (${this.statusIn(ORDER_STATUS_GROUPS.processing)}))::int AS "processing",
        COUNT(DISTINCT o.id) FILTER (WHERE o.status::text IN (${this.statusIn(ORDER_STATUS_GROUPS.cancelled)}))::int AS "cancelled",
        COUNT(DISTINCT o.id) FILTER (WHERE o.status::text IN (${this.statusIn(ORDER_STATUS_GROUPS.completed)}))::int AS "completed",
        COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float8 AS revenue
      FROM orders o
      LEFT JOIN users u ON u.id = o.fulfilled_by_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${where} AND o.fulfilled_by_id IS NOT NULL
      GROUP BY o.fulfilled_by_id, u.full_name
      ORDER BY revenue DESC
    `);
  }
}
