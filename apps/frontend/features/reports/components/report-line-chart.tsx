'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartTheme } from '../hooks/use-chart-theme';
import { ChartTooltip } from './chart-tooltip';

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

interface ReportLineChartProps {
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: ChartSeries[];
  valueFormatter: (v: number) => string;
  tickFormatter: (v: number) => string;
  xTickFormatter?: (v: string) => string;
  labelFormatter?: (v: string) => string;
}

/**
 * ReportLineChart — đường thời gian (single/multi series). Recharts responsive.
 * Marks mảnh (2px), không chấm trên mỗi điểm; legend luôn hiện khi ≥ 2 series.
 * Màu series lấy từ palette CVD-safe theo theme.
 */
export function ReportLineChart({
  data,
  xKey,
  series,
  valueFormatter,
  tickFormatter,
  xTickFormatter,
  labelFormatter,
}: ReportLineChartProps) {
  const theme = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={theme.grid} strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          tickFormatter={xTickFormatter}
          tick={{ fill: theme.axis, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: theme.grid }}
          minTickGap={16}
        />
        <YAxis
          tickFormatter={tickFormatter}
          tick={{ fill: theme.axis, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          content={
            <ChartTooltip theme={theme} valueFormatter={valueFormatter} labelFormatter={labelFormatter} />
          }
          cursor={{ stroke: theme.axis, strokeWidth: 1 }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
