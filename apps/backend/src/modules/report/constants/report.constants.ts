import { OrderStatus } from '@prisma/client';

/**
 * Report module — hằng số dùng chung cho toàn bộ báo cáo (Dashboard + Reports).
 * Doanh thu = SUM(order_item.quantity * order_item.unit_price) (ADR-014 — tính runtime).
 * KHÔNG có Profit (schema không lưu Cost/Fee) — chỉ 2 metric: revenue | order.
 */

/** Chỉ số thống kê được hỗ trợ. */
export const REPORT_METRICS = ['revenue', 'order'] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

/** Mức gom nhóm thời gian (date_trunc). */
export const REPORT_GROUP_BY = ['day', 'month', 'year'] as const;
export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number];

/** Whitelist groupBy → đơn vị date_trunc của Postgres (chống SQL injection khi nội suy literal). */
export const DATE_TRUNC_UNIT: Record<ReportGroupBy, string> = {
  day: 'day',
  month: 'month',
  year: 'year',
};

/**
 * Nhóm trạng thái Order phục vụ Báo cáo hiệu suất Kho (mockup "Tình trạng xử lí đơn hàng").
 * - notProcessed: chưa xử lí (WAITING)
 * - processing:   đang xử lí (các trạng thái active, chưa hoàn tất/hủy)
 * - cancelled:    đơn hủy (CANCELLED + REFUND)
 * - completed:    hoàn tất (COMPLETED + SHIPPED)
 */
export const ORDER_STATUS_GROUPS = {
  notProcessed: [OrderStatus.WAITING],
  processing: [
    OrderStatus.URGENT,
    OrderStatus.TRACK_AVAILABLE,
    OrderStatus.PED,
    OrderStatus.REDO,
    OrderStatus.TRACK_PENDING,
    OrderStatus.TAX,
    OrderStatus.TRACK_IMPORTED,
    OrderStatus.IN_PROGRESS,
    OrderStatus.HAS_TRACKING,
  ],
  cancelled: [OrderStatus.CANCELLED, OrderStatus.REFUND],
  completed: [OrderStatus.COMPLETED, OrderStatus.SHIPPED],
} as const;
