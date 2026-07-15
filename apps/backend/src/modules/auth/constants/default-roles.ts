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
