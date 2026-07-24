'use client';

import type { ChartTheme } from '../hooks/use-chart-theme';

interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
}
interface ChartTooltipProps {
  active?: boolean;
  label?: string;
  payload?: TooltipEntry[];
  theme: ChartTheme;
  valueFormatter: (v: number) => string;
  labelFormatter?: (label: string) => string;
}

/**
 * ChartTooltip — nội dung tooltip tùy biến cho Recharts (light/dark qua ChartTheme).
 * Text luôn dùng ink token; chấm màu đứng cạnh mang identity (không tô chữ theo series).
 */
export function ChartTooltip({
  active,
  label,
  payload,
  theme,
  valueFormatter,
  labelFormatter,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs shadow-md"
      style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
    >
      {label != null && (
        <p className="mb-1 font-medium" style={{ color: theme.tooltipText }}>
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li key={`${entry.dataKey}-${i}`} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="flex-1" style={{ color: theme.tooltipText }}>
              {entry.name}
            </span>
            <span className="font-medium tabular-nums" style={{ color: theme.tooltipText }}>
              {valueFormatter(Number(entry.value ?? 0))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
