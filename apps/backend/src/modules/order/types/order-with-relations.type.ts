import { Prisma } from '@prisma/client';

/** Include chi tiết Order: account (+platform, +seller), items, timeline trạng thái. */
export const ORDER_INCLUDE = {
  account: {
    select: {
      id: true,
      name: true,
      sellerUserId: true,
      platform: { select: { id: true, code: true, name: true } },
      seller: { select: { id: true, fullName: true, email: true } },
    },
  },
  fulfilledBy: { select: { id: true, fullName: true, email: true } },
  items: { orderBy: { createdAt: 'asc' } },
  statusHistories: { orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/** Include nhẹ cho danh sách (không kèm timeline). */
export const ORDER_LIST_INCLUDE = {
  account: {
    select: {
      id: true,
      name: true,
      sellerUserId: true,
      platform: { select: { code: true, name: true } },
      seller: { select: { id: true, fullName: true } },
    },
  },
  fulfilledBy: { select: { id: true, fullName: true } },
  items: {
    select: {
      id: true,
      productName: true,
      variant: true,
      color: true,
      size: true,
      supplier: true,
      quantity: true,
      unitPrice: true,
      image: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.OrderInclude;

export type OrderListRow = Prisma.OrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>;
