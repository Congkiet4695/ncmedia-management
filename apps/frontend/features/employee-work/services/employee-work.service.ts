import { apiClient } from '@/services/api-client';
import { downloadXlsx } from '@/features/import-export/service';
import type { ApiResponse } from '@/types/api';
import type {
  EmployeeWorkFilterOptions,
  EmployeeWorkFilters,
  EmployeeWorkPage,
  EmployeeWorkQuery,
} from '../types';

const BASE_PATH = '/pod/employee-work-statistics';

/** Bỏ tham số rỗng — backend coi "không gửi" là "không lọc". */
function params<T extends object>(query: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}

/** API "Thống kê công việc nhân viên" — mọi số liệu tổng hợp ở backend (SQL), giao diện chỉ hiển thị. */
export const employeeWorkService = {
  async filters(): Promise<EmployeeWorkFilterOptions> {
    const res = await apiClient.get<ApiResponse<EmployeeWorkFilterOptions>>(`${BASE_PATH}/filters`);
    return res.data.data;
  },
  async page(query: EmployeeWorkQuery): Promise<EmployeeWorkPage> {
    const res = await apiClient.get<ApiResponse<EmployeeWorkPage>>(BASE_PATH, {
      params: params(query),
    });
    return res.data.data;
  },
  /** Xuất Excel theo CÙNG bộ lọc (không phân trang). Tên file do server đặt. */
  async exportExcel(filters: EmployeeWorkFilters): Promise<void> {
    await downloadXlsx(`${BASE_PATH}/export`, 'employee-work.xlsx', params(filters));
  },
};
