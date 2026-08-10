import { z } from 'zod';
import type { TFunction } from 'i18next';

/** Giới hạn lương khớp DECIMAL(15,2) backend. */
const SALARY_MAX = 9_999_999_999_999;

export const EMPLOYEE_STATUSES = ['ACTIVE', 'INACTIVE', 'RESIGNED', 'SUSPENDED'] as const;

export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** Nhãn trạng thái nằm ở `i18n/locales/<lang>/employee.json` (khoá `status.*`). */

type ValidationT = TFunction<'validation'>;

/**
 * Schema form Employee — luật khớp Backend DTO (create-employee.dto.ts).
 * Dùng chung create & edit; ở chế độ edit, email bị vô hiệu & không gửi lên.
 *
 * Tạo qua hàm nhận `t` để thông báo lỗi theo ngôn ngữ đang chọn
 * (cùng cách làm với `features/auth/schemas/auth.schema.ts`).
 */
export function createEmployeeFormSchema(t: ValidationT) {
  const optionalDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, t('invalidDate'))
    .or(z.literal(''));

  const max = (limit: number) =>
    z.string().max(limit, t('maxLength', { count: limit })).or(z.literal(''));

  return z.object({
    fullName: z
      .string()
      .trim()
      .min(2, t('minLength', { count: 2 }))
      .max(255, t('maxLength', { count: 255 })),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, t('required'))
      .email(t('email'))
      .max(255),
    status: z.enum(EMPLOYEE_STATUSES),
    roleId: z.string().uuid(t('invalidRole')).or(z.literal('')),
    larkAccount: max(255),
    startDate: optionalDate,
    resignedAt: optionalDate,
    cccd: z
      .string()
      .regex(/^\d{9,12}$/, t('cccd'))
      .or(z.literal('')),
    cccdImageUrl: max(1024),
    phone: z
      .string()
      .regex(/^[0-9+\-\s]{8,20}$/, t('phone'))
      .or(z.literal('')),
    dateOfBirth: optionalDate,
    address: max(500),
    department: max(255),
    bankAccount: max(100),
    bankQrUrl: max(1024),
    salary: z.coerce
      .number({ invalid_type_error: t('invalidNumber') })
      .min(0, t('minValue', { min: 0 }))
      .max(SALARY_MAX, t('maxValueExceeded')),
    orderKpi: z.coerce
      .number({ invalid_type_error: t('invalidNumber') })
      .int(t('invalidInteger'))
      .min(0, t('minValue', { min: 0 })),
    revenueKpi: z.coerce
      .number({ invalid_type_error: t('invalidNumber') })
      .min(0, t('minValue', { min: 0 }))
      .max(SALARY_MAX, t('maxValueExceeded')),
    avatar: max(1024),
  });
}

export type EmployeeFormInput = z.infer<ReturnType<typeof createEmployeeFormSchema>>;
