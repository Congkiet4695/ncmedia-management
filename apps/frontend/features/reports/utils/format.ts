import { useTranslation } from 'react-i18next';
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

/**
 * Nhãn metric theo ngôn ngữ đang chọn.
 *
 * Là HOOK chứ không phải hàm thuần vì nhãn phụ thuộc ngôn ngữ runtime; component
 * gọi `const metricLabel = useMetricLabel()` rồi dùng như hàm cũ.
 */
export function useMetricLabel(): (metric: ReportMetric) => string {
  const { t } = useTranslation('report');
  return (metric) => t(`metric.${metric}`);
}
