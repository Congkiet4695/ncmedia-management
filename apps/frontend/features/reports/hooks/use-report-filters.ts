'use client';

import { useMemo, useState } from 'react';
import type { QuickRange } from '../constants';
import type { DateRangeParams } from '../types';
import { resolveQuickRange } from '../utils/date-range';

/**
 * State bộ lọc thời gian dùng chung cho Dashboard + Reports.
 * Quick range tự suy ra start/end; 'custom' cho phép nhập tay.
 */
export function useReportFilters(initial: QuickRange = 'month') {
  const [quickRange, setQuickRange] = useState<QuickRange>(initial);
  const [custom, setCustom] = useState<DateRangeParams>(() =>
    initial === 'custom' ? {} : resolveQuickRange(initial),
  );

  const range: DateRangeParams = useMemo(
    () => (quickRange === 'custom' ? custom : resolveQuickRange(quickRange)),
    [quickRange, custom],
  );

  const selectQuickRange = (q: QuickRange) => {
    setQuickRange(q);
    if (q !== 'custom') setCustom(resolveQuickRange(q));
  };

  const setStartDate = (startDate?: string) => {
    setQuickRange('custom');
    setCustom((c) => ({ ...c, startDate }));
  };
  const setEndDate = (endDate?: string) => {
    setQuickRange('custom');
    setCustom((c) => ({ ...c, endDate }));
  };

  return {
    quickRange,
    startDate: range.startDate,
    endDate: range.endDate,
    range,
    selectQuickRange,
    setStartDate,
    setEndDate,
  };
}
