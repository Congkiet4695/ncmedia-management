/**
 * Role mặc định seed khi tạo Organization (ADR-009, auth.md BR-17).
 * code viết HOA, nhất quán với prisma/seed.ts.
 */
export const DEFAULT_ROLES = [
  { code: 'ADMIN', displayName: 'Administrator', description: 'Toàn quyền trong Organization' },
  { code: 'EMPLOYEE', displayName: 'Employee', description: 'Nhân viên — quyền theo phân công' },
  { code: 'FULFILLMENT', displayName: 'Fulfillment', description: 'Xử lý fulfillment cho Order được gán' },
] as const;

export const ADMIN_ROLE_CODE = 'ADMIN';
export const EMPLOYEE_ROLE_CODE = 'EMPLOYEE';

/**
 * Permission mặc định của Role EMPLOYEE khi tạo Organization:
 * quản lý Account của mình (read/update), Order, và Profile self-service.
 * ADMIN nhận toàn bộ catalog. Nguồn dùng chung cho register.service & prisma/seed.ts.
 */
export const EMPLOYEE_DEFAULT_PERMISSIONS = [
  'account.read',
  'account.update',
  'order.read',
  'order.create',
  'order.update',
  'order.delete',
  'profile.read',
  'profile.update',
] as const;
