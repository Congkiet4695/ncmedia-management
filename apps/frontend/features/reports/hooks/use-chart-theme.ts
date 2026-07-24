'use client';

import { useThemeStore } from '@/stores/theme.store';
import { useMounted } from '@/hooks/use-mounted';
import { CATEGORICAL_DARK, CATEGORICAL_LIGHT, SERIES_PRIMARY } from '../constants';

export interface ChartTheme {
  isDark: boolean;
  /** Palette phân loại (CVD-safe) theo theme hiện tại. */
  categorical: string[];
  /** Màu series đơn (doanh thu/đơn). */
  primary: string;
  /** Màu lưới / trục / chữ phụ (dùng token hex trung tính từ palette dataviz). */
  grid: string;
  axis: string;
  /** Tooltip surface. */
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

/**
 * useChartTheme — cấp màu biểu đồ theo theme (light/dark). Recharts cần màu cụ thể
 * (không dùng được CSS var cho series), nên chọn hex theo theme store.
 */
export function useChartTheme(): ChartTheme {
  const theme = useThemeStore((s) => s.theme);
  const mounted = useMounted();
  const isDark = mounted && theme === 'dark';
  return {
    isDark,
    categorical: isDark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT,
    primary: isDark ? SERIES_PRIMARY.dark : SERIES_PRIMARY.light,
    grid: isDark ? '#2c2c2a' : '#e1e0d9',
    axis: '#898781',
    tooltipBg: isDark ? '#1a1a19' : '#ffffff',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(11,11,11,0.12)',
    tooltipText: isDark ? '#ffffff' : '#0b0b0b',
  };
}
