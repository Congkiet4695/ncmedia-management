import type { PaginationMeta } from '@/types/api';

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'RESIGNED' | 'SUSPENDED';

export interface EmployeeRole {
  id: string;
  code: string;
  name: string;
}

/** Hồ sơ Employee đầy đủ (detail). */
export interface Employee {
  id: string;
  fullName: string;
  email: string;
  status: EmployeeStatus;
  larkAccount: string | null;
  startDate: string | null;
  resignedAt: string | null;
  cccd: string | null;
  cccdImageUrl: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  address: string | null;
  department: string | null;
  bankAccount: string | null;
  bankQrUrl: string | null;
  salary: number;
  avatar: string | null;
  role: EmployeeRole;
  createdAt: string;
  updatedAt: string;
}

/** Hàng danh sách (table) — chỉ field hiển thị. */
export interface EmployeeListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  department: string | null;
  status: EmployeeStatus;
  startDate: string | null;
  resignedAt: string | null;
  avatar: string | null;
  role: EmployeeRole;
  createdAt: string;
}

/** Thông tin đăng nhập khởi tạo (hiển thị một lần). */
export interface EmployeeCredentials {
  email: string;
  initialPassword: string;
}

/** Response tạo Employee — kèm credentials hiển thị một lần. */
export interface CreateEmployeeResult extends Employee {
  credentials: EmployeeCredentials;
}

/** Response reset mật khẩu — mật khẩu mới hiển thị một lần. */
export interface ResetPasswordResult {
  newPassword: string;
}

export interface EmployeeListResult {
  items: EmployeeListItem[];
  meta: PaginationMeta;
}

/** Tham số query danh sách (khớp EmployeeQueryDto backend). */
export interface EmployeeQuery {
  page?: number;
  limit?: number;
  fullname?: string;
  email?: string;
  status?: EmployeeStatus;
  department?: string;
  startDate?: string;
  roleId?: string;
  search?: string;
  sortBy?: 'createdAt' | 'fullName' | 'email' | 'salary' | 'status' | 'startDate';
  sortOrder?: 'asc' | 'desc';
}
