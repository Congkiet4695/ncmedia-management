/**
 * Reports — hằng số dùng chung. Bộ lọc thời gian + metric + groupBy dùng chung cho
 * Dashboard và toàn bộ Reports (yêu cầu: cùng bộ lọc, cùng cách tính).
 */

export type ReportMetric = 'revenue' | 'order';
export type ReportGroupBy = 'day' | 'month' | 'year';
export type QuickRange = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

export const METRIC_OPTIONS: { value: ReportMetric; label: string }[] = [
  { value: 'revenue', label: 'Doanh thu' },
  { value: 'order', label: 'Đơn hàng' },
];

export const GROUP_BY_OPTIONS: { value: ReportGroupBy; label: string }[] = [
  { value: 'day', label: 'Theo ngày' },
  { value: 'month', label: 'Theo tháng' },
  { value: 'year', label: 'Theo năm' },
];

export const QUICK_RANGE_OPTIONS: { value: QuickRange; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'week', label: 'Tuần này' },
  { value: 'month', label: 'Tháng này' },
  { value: 'year', label: 'Năm nay' },
  { value: 'all', label: 'Tất cả thời gian' },
  { value: 'custom', label: 'Tùy chọn' },
];

/**
 * Palette phân loại (categorical) — đã validate CVD-safe ở cả light & dark
 * (dataviz skill · references/palette.md). Dùng cho biểu đồ nhiều Seller.
 */
export const CATEGORICAL_LIGHT = [
  '#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948',
];
export const CATEGORICAL_DARK = [
  '#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767',
];

/** Màu series đơn (doanh thu/đơn) — blue slot 1. */
export const SERIES_PRIMARY = { light: '#2a78d6', dark: '#3987e5' } as const;

/** Màu trạng thái (status palette — cố định, không theme). */
export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
  muted: '#898781',
} as const;

/** Map trạng thái Account → màu (biểu đồ Account theo Seller). */
export const ACCOUNT_STATUS_STYLE = {
  live: { label: 'Live', color: STATUS_COLORS.good },
  dieTrang: { label: 'Die trắng', color: STATUS_COLORS.warning },
  die: { label: 'Die', color: STATUS_COLORS.critical },
  notApplicable: { label: 'Không áp dụng', color: STATUS_COLORS.muted },
} as const;

/** Map nhóm trạng thái xử lý đơn (Hiệu suất Kho) → màu. */
export const WAREHOUSE_STATUS_STYLE = {
  notProcessed: { label: 'Chưa xử lí', color: SERIES_PRIMARY.light },
  processing: { label: 'Đang xử lí', color: STATUS_COLORS.warning },
  cancelled: { label: 'Đơn hủy', color: STATUS_COLORS.critical },
  completed: { label: 'Hoàn tất', color: STATUS_COLORS.good },
} as const;
