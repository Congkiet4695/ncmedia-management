'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartTheme } from '../hooks/use-chart-theme';
import { ChartTooltip } from './chart-tooltip';
import type { ChartSeries } from './report-line-chart';

interface ReportBarChartProps {
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: ChartSeries[];
  valueFormatter: (v: number) => string;
  tickFormatter: (v: number) => string;
  xTickFormatter?: (v: string) => string;
  labelFormatter?: (v: string) => string;
  /** 'horizontal' = cột đứng (mặc định); 'vertical' = thanh ngang (ranking). */
  layout?: 'horizontal' | 'vertical';
  stacked?: boolean;
  /** Màu riêng theo từng cột (chỉ khi 1 series) — dùng cho bar phân loại. */
  cellColors?: string[];
  /** Hiện nhãn giá trị trên đầu mỗi cột (dùng formatter rút gọn). */
  showLabels?: boolean;
}

/** Số ký tự tối đa của nhãn trục X trước khi cắt + ellipsis (full name xem ở tooltip). */
const X_LABEL_MAX = 16;
/** Chiều cao vùng nhãn trục X (đủ cho tên xoay -35°, không bị cắt). */
const X_AXIS_HEIGHT = 84;
/** Hệ số nới trần trục số để nhãn trên cột cao nhất không chạm mép (BUG 2). */
const HEADROOM = 1.15;

/** Nới trần trục số: maxValue × 1.15 (≥1 để tránh domain [0,0] khi rỗng). */
function headroom(dataMax: number): number {
  if (!Number.isFinite(dataMax) || dataMax <= 0) return 1;
  return dataMax * HEADROOM;
}

/**
 * Tick trục X danh mục (tên Seller): xoay -35°, cắt + ellipsis khi quá dài, kèm
 * `<title>` để hover xem tên đầy đủ. Đảm bảo LUÔN nhìn được tên, không mất label (BUG 1).
 */
function CategoryTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  fill?: string;
  formatter?: (v: string) => string;
}) {
  const { x = 0, y = 0, payload, fill, formatter } = props;
  const raw = String(payload?.value ?? '');
  const full = formatter ? formatter(raw) : raw;
  const text = full.length > X_LABEL_MAX ? `${full.slice(0, X_LABEL_MAX - 1)}…` : full;
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{full}</title>
      <text
        dy={2}
        dx={-2}
        textAnchor="end"
        transform="rotate(-35)"
        fill={fill}
        fontSize={11}
      >
        {text}
      </text>
    </g>
  );
}

/**
 * ReportBarChart — cột (đứng/ngang), 1 series / nhiều series / stacked. Recharts responsive.
 * Trục X danh mục hiển thị đầy đủ tên (xoay + ellipsis + tooltip). Trục số có headroom để
 * nhãn trên cột cao nhất không bị cắt. Legend khi ≥ 2 series.
 */
export function ReportBarChart({
  data,
  xKey,
  series,
  valueFormatter,
  tickFormatter,
  xTickFormatter,
  labelFormatter,
  layout = 'horizontal',
  stacked,
  cellColors,
  showLabels,
}: ReportBarChartProps) {
  const theme = useChartTheme();
  const vertical = layout === 'vertical';
  const labelColor = theme.isDark ? '#c3c2b7' : '#52514e';

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={layout}
        // margin dưới/phải rộng hơn để nhãn xoay (X) và nhãn bên phải (thanh ngang) không bị cắt.
        margin={{ top: 12, right: vertical && showLabels ? 56 : 16, left: 4, bottom: 8 }}
        barCategoryGap={vertical ? '20%' : '25%'}
      >
        <CartesianGrid
          horizontal={!vertical}
          vertical={vertical}
          stroke={theme.grid}
          strokeDasharray="3 3"
        />
        {/*
          QUAN TRỌNG: XAxis/YAxis phải là CON TRỰC TIẾP của BarChart — Recharts dò axis
          theo type trên children trực tiếp, KHÔNG đi vào React.Fragment. Bọc trong <>…</>
          khiến Recharts không thấy XAxis → mất toàn bộ nhãn trục (root cause BUG tên Seller).
          Vì vậy dùng biểu thức điều kiện trả về MỘT phần tử, không bọc Fragment.
        */}
        {vertical ? (
          <XAxis
            key="x-number"
            type="number"
            domain={[0, showLabels ? headroom : 'auto']}
            tickFormatter={tickFormatter}
            tick={{ fill: theme.axis, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: theme.grid }}
          />
        ) : (
          <XAxis
            key="x-category"
            type="category"
            dataKey={xKey}
            interval={0}
            height={X_AXIS_HEIGHT}
            tickMargin={8}
            tickLine={false}
            axisLine={{ stroke: theme.grid }}
            tick={<CategoryTick fill={theme.axis} formatter={xTickFormatter} />}
          />
        )}
        {vertical ? (
          <YAxis
            key="y-category"
            type="category"
            dataKey={xKey}
            tick={{ fill: theme.axis, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={140}
            interval={0}
            tickFormatter={xTickFormatter}
          />
        ) : (
          <YAxis
            key="y-number"
            type="number"
            domain={[0, showLabels ? headroom : 'auto']}
            tickFormatter={tickFormatter}
            tick={{ fill: theme.axis, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
        )}
        <Tooltip
          content={
            <ChartTooltip theme={theme} valueFormatter={valueFormatter} labelFormatter={labelFormatter} />
          }
          cursor={{ fill: theme.grid, fillOpacity: 0.3 }}
        />
        {series.length > 1 && (
          <Legend verticalAlign="top" align="left" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
        )}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color}
            stackId={stacked ? 'stack' : undefined}
            radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {cellColors && series.length === 1
              ? data.map((_, i) => <Cell key={i} fill={cellColors[i % cellColors.length]} />)
              : null}
            {showLabels && !stacked && (
              <LabelList
                dataKey={s.key}
                position={vertical ? 'right' : 'top'}
                offset={6}
                formatter={(v: number) => tickFormatter(Number(v))}
                style={{ fill: labelColor, fontSize: 11 }}
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
