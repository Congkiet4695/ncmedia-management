import { Prisma } from '@prisma/client';

/** Include chuẩn khi truy vấn Account: platform + seller (User) + cờ tồn tại credential. */
export const ACCOUNT_INCLUDE = {
  platform: true,
  seller: { select: { id: true, fullName: true, email: true } },
  credential: { select: { id: true } },
} as const satisfies Prisma.AccountInclude;

export type AccountWithRelations = Prisma.AccountGetPayload<{ include: typeof ACCOUNT_INCLUDE }>;
