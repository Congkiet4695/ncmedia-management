import { apiClient } from '@/services/api-client';
import { downloadXlsx } from '@/features/import-export/service';
import type { ApiResponse } from '@/types/api';
import type {
  CreateEmployeeResult,
  Employee,
  EmployeeListResult,
  EmployeeQuery,
  EmployeeRole,
  EmployeeStatus,
  ResetPasswordResult,
} from '../types';

export interface CreateEmployeePayload {
  fullName: string;
  email: string;
  status?: EmployeeStatus;
  roleId?: string;
  larkAccount?: string;
  startDate?: string;
  resignedAt?: string;
  cccd?: string;
  cccdImageUrl?: string;
  phone?: string;
  dateOfBirth?: string;
  address?: string;
  department?: string;
  bankAccount?: string;
  bankQrUrl?: string;
  salary?: number;
  orderKpi?: number;
  revenueKpi?: number;
  avatar?: string;
}

export type UpdateEmployeePayload = Partial<Omit<CreateEmployeePayload, 'email'>>;

/** Bỏ các key undefined/'' để không gửi query/param rỗng. */
function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

/**
 * employee.service — gọi API Employee, trả `data` đã bóc khỏi envelope chuẩn.
 */
export const employeeService = {
  async list(query: EmployeeQuery): Promise<EmployeeListResult> {
    const res = await apiClient.get<ApiResponse<EmployeeListResult>>('/employees', {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  async get(id: string): Promise<Employee> {
    const res = await apiClient.get<ApiResponse<Employee>>(`/employees/${id}`);
    return res.data.data;
  },

  async create(payload: CreateEmployeePayload): Promise<CreateEmployeeResult> {
    const res = await apiClient.post<ApiResponse<CreateEmployeeResult>>('/employees', payload);
    return res.data.data;
  },

  async update(id: string, payload: UpdateEmployeePayload): Promise<Employee> {
    const res = await apiClient.patch<ApiResponse<Employee>>(`/employees/${id}`, payload);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`/employees/${id}`);
  },

  /** Reset mật khẩu — trả mật khẩu mới (hiển thị một lần). */
  async resetPassword(id: string): Promise<ResetPasswordResult> {
    const res = await apiClient.post<ApiResponse<ResetPasswordResult>>(
      `/employees/${id}/reset-password`,
    );
    return res.data.data;
  },

  /** Danh sách Role để chọn khi tạo/sửa (GET /roles). */
  async listRoles(): Promise<EmployeeRole[]> {
    const res = await apiClient.get<ApiResponse<EmployeeRole[]>>('/roles');
    return res.data.data;
  },

  /**
   * Export danh sách Employee ra Excel — gửi kèm filter hiện tại (bỏ phân trang vì
   * server export toàn bộ kết quả khớp filter). Tên file do server đặt.
   */
  async exportExcel(query: EmployeeQuery): Promise<void> {
    const { page: _page, limit: _limit, ...filters } = query;
    await downloadXlsx('/employees/export', 'employees.xlsx', clean(filters as Record<string, unknown>));
  },

  /** Tải file Excel mẫu để import. */
  async downloadTemplate(): Promise<void> {
    await downloadXlsx('/employees/template', 'employee-import-template.xlsx');
  },
};
