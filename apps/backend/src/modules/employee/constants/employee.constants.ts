import { EmployeeStatus, UserStatus } from '@prisma/client';

/** Cost bcrypt cho mật khẩu auto-generate (Decision-003). */
export const EMPLOYEE_BCRYPT_COST = 12;

/** Trường sort cho danh sách Employee. */
export const EMPLOYEE_SORT_FIELDS = [
  'createdAt',
  'fullName',
  'email',
  'salary',
  'status',
  'startDate',
] as const;
export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

/** Giới hạn lương / KPI Doanh thu theo DECIMAL(15,2) của DB. */
export const EMPLOYEE_SALARY_MAX = 9_999_999_999_999;

/** Giới hạn KPI Đơn hàng (INTEGER). */
export const EMPLOYEE_ORDER_KPI_MAX = 2_000_000_000;

/**
 * Ánh xạ EmployeeStatus (nghiệp vụ) → UserStatus (auth/login).
 * RESIGNED → INACTIVE để chặn đăng nhập mà KHÔNG cần thêm giá trị vào UserStatus (giữ nguyên auth).
 */
export function mapEmployeeStatusToUserStatus(status: EmployeeStatus): UserStatus {
  switch (status) {
    case EmployeeStatus.ACTIVE:
      return UserStatus.ACTIVE;
    case EmployeeStatus.INACTIVE:
      return UserStatus.INACTIVE;
    case EmployeeStatus.SUSPENDED:
      return UserStatus.SUSPENDED;
    case EmployeeStatus.RESIGNED:
      return UserStatus.INACTIVE;
  }
}
