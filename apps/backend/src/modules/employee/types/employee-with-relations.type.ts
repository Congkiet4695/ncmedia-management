import { Prisma } from '@prisma/client';

/** Include chuẩn khi truy vấn Employee: kèm User (auth info) + Role. */
export const EMPLOYEE_INCLUDE = {
  user: { include: { role: true } },
} as const satisfies Prisma.EmployeeInclude;

/** Employee kèm quan hệ User + Role (fullName/email/status/role lấy từ User). */
export type EmployeeWithRelations = Prisma.EmployeeGetPayload<{ include: typeof EMPLOYEE_INCLUDE }>;
