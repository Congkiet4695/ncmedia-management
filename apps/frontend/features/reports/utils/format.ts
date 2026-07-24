import { formatUSD } from '@/lib/format';
import type { ReportMetric } from '../constants';

/** Định dạng giá trị metric: revenue → USD, order → số nguyên. */
export function formatMetricValue(value: number, metric: ReportMetric): string {
  return metric === 'revenue' ? formatUSD(value) : String(Math.round(value));
}

/** Rút gọn số cho tick trục Y (1.2k, 3.4M…). */
export function formatCompact(value: number, metric: ReportMetric): string {
  const abs = Math.abs(value);
  const prefix = metric === 'revenue' ? '$' : '';
  if (abs >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}${(value / 1_000).toFixed(1)}k`;
  return `${prefix}${metric === 'revenue' ? value.toFixed(0) : Math.round(value)}`;
}

/** Nhãn metric tiếng Việt. */
export function metricLabel(metric: ReportMetric): string {
  return metric === 'revenue' ? 'Doanh thu' : 'Đơn hàng';
}
