import { EmployeeStatus } from '@prisma/client';

/**
 * Hằng số Import/Export Excel cho Employee.
 * Tách khỏi employee.constants.ts để không lẫn với hằng số nghiệp vụ CRUD.
 */

/** Tên sheet dữ liệu (export + template + file lỗi). */
export const EMPLOYEE_SHEET = 'Employees';

/** Tên sheet hướng dẫn trong file template. */
export const INSTRUCTIONS_SHEET = 'Instructions';

/** Giới hạn kích thước file import (10MB — yêu cầu nghiệp vụ). */
export const EMPLOYEE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Giới hạn số dòng dữ liệu mỗi lần import (chặn file quá lớn làm treo transaction). */
export const EMPLOYEE_IMPORT_MAX_ROWS = 5000;

/** Timeout/maxWait cho transaction import (ms) — import nhiều dòng nên dài hơn mặc định 5s. */
export const EMPLOYEE_IMPORT_TX_TIMEOUT_MS = 120_000;
export const EMPLOYEE_IMPORT_TX_MAX_WAIT_MS = 15_000;

/** Định dạng số/ngày trong file Excel xuất ra. */
export const EXCEL_DATE_FORMAT = 'yyyy-mm-dd';
export const EXCEL_DATETIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';
export const EXCEL_NUMBER_FORMAT = '#,##0.00';

/** Cột file EXPORT (đúng thứ tự yêu cầu). */
export const EXPORT_COLUMN = {
  id: 'ID',
  fullName: 'Full Name',
  email: 'Email',
  phone: 'Phone',
  dateOfBirth: 'Date Of Birth',
  salary: 'Salary',
  role: 'Role',
  status: 'Status',
  createdAt: 'Created At',
  updatedAt: 'Updated At',
} as const;

export const EXPORT_HEADERS: readonly string[] = Object.values(EXPORT_COLUMN);

/**
 * Một cột của file IMPORT/TEMPLATE.
 * `aliases` cho phép người dùng nạp lại chính file Export (header không có dấu `*`).
 */
export interface ImportColumn {
  /** Nhãn hiển thị trong template (có `*` nếu bắt buộc). */
  header: string;
  /** Tên header khác được chấp nhận khi đọc file. */
  aliases: readonly string[];
  required: boolean;
}

export const IMPORT_COLUMNS = {
  fullName: { header: 'Full Name *', aliases: ['Full Name'], required: true },
  email: { header: 'Email *', aliases: ['Email'], required: true },
  phone: { header: 'Phone', aliases: [], required: false },
  dateOfBirth: { header: 'Date Of Birth', aliases: [], required: false },
  salary: { header: 'Salary', aliases: [], required: false },
  roleCode: { header: 'Role Code *', aliases: ['Role Code', 'Role'], required: true },
  status: { header: 'Status', aliases: [], required: false },
} as const satisfies Record<string, ImportColumn>;

export type ImportColumnKey = keyof typeof IMPORT_COLUMNS;

/** Thứ tự cột trong template (đúng yêu cầu mục II). */
export const IMPORT_COLUMN_ORDER: readonly ImportColumnKey[] = [
  'fullName',
  'email',
  'phone',
  'dateOfBirth',
  'salary',
  'roleCode',
  'status',
];

/** Header của template (theo đúng thứ tự). */
export const TEMPLATE_HEADERS: readonly string[] = IMPORT_COLUMN_ORDER.map(
  (key) => IMPORT_COLUMNS[key].header,
);

/** Cột thêm vào file lỗi. */
export const ERROR_COLUMN = 'Error';

/** Cột "Dòng" trong file lỗi (giúp đối chiếu với file gốc). */
export const ERROR_ROW_COLUMN = 'Row';

/** Danh sách Status hợp lệ (từ Prisma enum — không hardcode chuỗi). */
export const EMPLOYEE_STATUS_CODES: readonly string[] = Object.values(EmployeeStatus);

/** Định dạng ngày chấp nhận khi import (mô tả cho người dùng). */
export const IMPORT_DATE_FORMAT_HINT = 'YYYY-MM-DD';

/** Regex ngày ISO (date-only) dùng khi import. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Giới hạn độ dài họ tên (đồng bộ CreateEmployeeDto). */
export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 255;

/** Giới hạn độ dài email (đồng bộ CreateEmployeeDto). */
export const EMAIL_MAX_LENGTH = 255;

/** Regex email (đồng bộ mức kiểm tra cơ bản của class-validator IsEmail). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Regex số điện thoại (đồng bộ CreateEmployeeDto). */
export const PHONE_RE = /^[0-9+\-\s]{8,20}$/;
