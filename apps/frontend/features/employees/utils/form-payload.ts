import type { EmployeeFormInput } from '../schemas/employee.schema';
import type { CreateEmployeePayload, UpdateEmployeePayload } from '../services/employee.service';

/** Các field optional dạng chuỗi rỗng → bỏ khỏi payload. */
function optionalFields(values: EmployeeFormInput) {
  const optionalKeys = [
    'roleId',
    'larkAccount',
    'startDate',
    'resignedAt',
    'cccd',
    'cccdImageUrl',
    'phone',
    'dateOfBirth',
    'address',
    'department',
    'bankAccount',
    'bankQrUrl',
    'avatar',
  ] as const;

  const result: Record<string, string> = {};
  for (const key of optionalKeys) {
    const value = values[key];
    if (value) result[key] = value;
  }
  return result;
}

export function toCreatePayload(values: EmployeeFormInput): CreateEmployeePayload {
  return {
    fullName: values.fullName,
    email: values.email,
    status: values.status,
    salary: values.salary,
    ...optionalFields(values),
  };
}

/** Cập nhật KHÔNG gồm email (định danh — không đổi ở phạm vi này). */
export function toUpdatePayload(values: EmployeeFormInput): UpdateEmployeePayload {
  return {
    fullName: values.fullName,
    status: values.status,
    salary: values.salary,
    ...optionalFields(values),
  };
}
