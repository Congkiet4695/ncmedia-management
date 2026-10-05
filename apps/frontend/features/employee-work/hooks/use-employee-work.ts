'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { employeeWorkService } from '../services/employee-work.service';
import type { EmployeeWorkFilters, EmployeeWorkQuery } from '../types';

const KEY = 'pod-employee-work';

export function useEmployeeWorkFilterOptions(enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'filters'],
    queryFn: () => employeeWorkService.filters(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** `keepPreviousData`: đổi bộ lọc / trang không làm bảng nhấp nháy về trạng thái rỗng. */
export function useEmployeeWorkPage(query: EmployeeWorkQuery, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'page', query],
    queryFn: () => employeeWorkService.page(query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useExportEmployeeWork() {
  return useMutation({
    mutationFn: (filters: EmployeeWorkFilters) => employeeWorkService.exportExcel(filters),
  });
}
