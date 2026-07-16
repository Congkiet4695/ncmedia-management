import { z } from 'zod';

/** Giới hạn lương khớp DECIMAL(15,2) backend. */
const SALARY_MAX = 9_999_999_999_999;

export const EMPLOYEE_STATUSES = ['ACTIVE', 'INACTIVE', 'RESIGNED', 'SUSPENDED'] as const;

export const EMPLOYEE_STATUS_LABELS: Record<(typeof EMPLOYEE_STATUSES)[number], string> = {
  ACTIVE: 'Đang làm việc',
  INACTIVE: 'Ngừng hoạt động',
  RESIGNED: 'Đã nghỉ việc',
  SUSPENDED: 'Tạm khóa',
};

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ')
  .or(z.literal(''));

/**
 * Schema form Employee — luật khớp Backend DTO (create-employee.dto.ts).
 * Dùng chung create & edit; ở chế độ edit, email bị vô hiệu & không gửi lên.
 */
export const employeeFormSchema = z.object({
  fullName: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự').max(255, 'Tối đa 255 ký tự'),
  email: z.string().trim().toLowerCase().min(1, 'Vui lòng nhập email').email('Email không hợp lệ').max(255),
  status: z.enum(EMPLOYEE_STATUSES),
  roleId: z.string().uuid('Role không hợp lệ').or(z.literal('')),
  larkAccount: z.string().max(255, 'Tối đa 255 ký tự').or(z.literal('')),
  startDate: optionalDate,
  resignedAt: optionalDate,
  cccd: z
    .string()
    .regex(/^\d{9,12}$/, 'CCCD gồm 9–12 chữ số')
    .or(z.literal('')),
  cccdImageUrl: z.string().max(1024, 'Tối đa 1024 ký tự').or(z.literal('')),
  phone: z
    .string()
    .regex(/^[0-9+\-\s]{8,20}$/, 'Số điện thoại không hợp lệ')
    .or(z.literal('')),
  dateOfBirth: optionalDate,
  address: z.string().max(500, 'Tối đa 500 ký tự').or(z.literal('')),
  department: z.string().max(255, 'Tối đa 255 ký tự').or(z.literal('')),
  bankAccount: z.string().max(100, 'Tối đa 100 ký tự').or(z.literal('')),
  bankQrUrl: z.string().max(1024, 'Tối đa 1024 ký tự').or(z.literal('')),
  salary: z.coerce
    .number({ invalid_type_error: 'Lương phải là số' })
    .min(0, 'Lương phải >= 0')
    .max(SALARY_MAX, 'Lương vượt giới hạn'),
  avatar: z.string().max(1024, 'Tối đa 1024 ký tự').or(z.literal('')),
});

export type EmployeeFormInput = z.infer<typeof employeeFormSchema>;
