/**
 * Reports — hằng số dùng chung. Bộ lọc thời gian + metric + groupBy dùng chung cho
 * Dashboard và toàn bộ Reports (yêu cầu: cùng bộ lọc, cùng cách tính).
 */

export type ReportMetric = 'revenue' | 'order';
export type ReportGroupBy = 'day' | 'month' | 'year';
export type QuickRange = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

/**
 * Danh sách lựa chọn chỉ mang MÃ và KHOÁ DỊCH — nhãn hiển thị nằm ở
 * `i18n/locales/<lang>/report.json`. Nhờ vậy hằng số không phụ thuộc ngôn ngữ.
 */
export const METRIC_OPTIONS: { value: ReportMetric; labelKey: string }[] = [
  { value: 'revenue', labelKey: 'metric.revenue' },
  { value: 'order', labelKey: 'metric.order' },
];

export const GROUP_BY_OPTIONS: { value: ReportGroupBy; labelKey: string }[] = [
  { value: 'day', labelKey: 'groupBy.day' },
  { value: 'month', labelKey: 'groupBy.month' },
  { value: 'year', labelKey: 'groupBy.year' },
];

export const QUICK_RANGE_OPTIONS: { value: QuickRange; labelKey: string }[] = [
  { value: 'today', labelKey: 'quickRange.today' },
  { value: 'week', labelKey: 'quickRange.week' },
  { value: 'month', labelKey: 'quickRange.month' },
  { value: 'year', labelKey: 'quickRange.year' },
  { value: 'all', labelKey: 'quickRange.all' },
  { value: 'custom', labelKey: 'quickRange.custom' },
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
  live: { labelKey: 'accountStatus.live', color: STATUS_COLORS.good },
  dieTrang: { labelKey: 'accountStatus.dieTrang', color: STATUS_COLORS.warning },
  die: { labelKey: 'accountStatus.die', color: STATUS_COLORS.critical },
  notApplicable: { labelKey: 'accountStatus.notApplicable', color: STATUS_COLORS.muted },
} as const;

/** Map nhóm trạng thái xử lý đơn (Hiệu suất Kho) → màu. */
export const WAREHOUSE_STATUS_STYLE = {
  notProcessed: { labelKey: 'warehouseStatus.notProcessed', color: SERIES_PRIMARY.light },
  processing: { labelKey: 'warehouseStatus.processing', color: STATUS_COLORS.warning },
  cancelled: { labelKey: 'warehouseStatus.cancelled', color: STATUS_COLORS.critical },
  completed: { labelKey: 'warehouseStatus.completed', color: STATUS_COLORS.good },
} as const;
