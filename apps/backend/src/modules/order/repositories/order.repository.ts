import { Injectable } from '@nestjs/common';
import { OrderItemStatus, OrderNoteType, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { OrderSortField } from '../constants/order.constants';
import {
  ORDER_INCLUDE,
  ORDER_LIST_INCLUDE,
  OrderListRow,
  OrderWithRelations,
} from '../types/order-with-relations.type';

/** Dữ liệu Account tối thiểu để validate + suy ra platform khi tạo/sửa Order. */
export interface AccountForOrder {
  id: string;
  sellerUserId: string | null;
  platform: string | null;
}

/** Field scalar của Order được phép ghi (không gồm status — dùng riêng updateStatus). */
export interface OrderScalarWrite {
  orderNumber?: string;
  shippingAddress?: string | null;
  currency?: string | null;
  orderedAt?: Date | null;
  status?: OrderStatus;
}

export interface OrderCreateData extends OrderScalarWrite {
  organizationId: string;
  accountId: string;
  platform: string | null;
  orderNumber: string;
  status: OrderStatus;
}

export interface OrderItemWrite {
  productName: string;
  productLink?: string | null;
  color?: string | null;
  size?: string | null;
  quantity?: number;
  unitPrice?: number;
  trackingNumber?: string | null;
  fulfillmentStatus?: OrderItemStatus;
  image?: string | null;
  remark?: string | null;
}

/** Ghi OrderNote (tạo/sửa). */
export interface OrderNoteWrite {
  type?: OrderNoteType;
  content?: string;
}

export interface OrderLogWrite {
  action: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  performedBy: string;
  ipAddress?: string | null;
}

export interface OrderFindManyParams {
  page: number;
  limit: number;
  search?: string;
  platformId?: string;
  accountId?: string;
  status?: OrderStatus;
  sellerUserId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortBy: OrderSortField;
  sortOrder: 'asc' | 'desc';
}

/**
 * OrderRepository — data access. Mọi query nhận `organizationId` (tenant isolation — ADR-004)
 * + optional `sellerScope` (row-level: chỉ Order thuộc Account do user quản lý — account.sellerUserId).
 */
@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Lấy Account (trong Org) để validate + suy ra platform code. */
  async findAccountForOrder(
    organizationId: string,
    accountId: string,
  ): Promise<AccountForOrder | null> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, organizationId, deletedAt: null },
      select: { id: true, sellerUserId: true, platform: { select: { code: true } } },
    });
    if (!account) return null;
    return { id: account.id, sellerUserId: account.sellerUserId, platform: account.platform?.code ?? null };
  }

  /** Trùng Order Number trong (Org, Platform). `excludeId` để bỏ qua chính nó khi update. */
  async duplicateExists(
    organizationId: string,
    platform: string | null,
    orderNumber: string,
    excludeId?: string,
  ): Promise<boolean> {
    const count = await this.prisma.order.count({
      where: {
        organizationId,
        platform,
        orderNumber,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    return count > 0;
  }

  findById(
    organizationId: string,
    id: string,
    sellerScope?: string,
  ): Promise<OrderWithRelations | null> {
    return this.prisma.order.findFirst({
      where: {
        id,
        organizationId,
        deletedAt: null,
        ...(sellerScope ? { account: { sellerUserId: sellerScope } } : {}),
      },
      include: ORDER_INCLUDE,
    });
  }

  create(
    tx: Prisma.TransactionClient,
    data: OrderCreateData,
    actorUserId: string,
  ): Promise<{ id: string }> {
    return tx.order.create({
      data: {
        organizationId: data.organizationId,
        accountId: data.accountId,
        platform: data.platform,
        orderNumber: data.orderNumber,
        shippingAddress: data.shippingAddress ?? null,
        currency: data.currency ?? null,
        status: data.status,
        orderedAt: data.orderedAt ?? null,
        createdBy: actorUserId,
      },
      select: { id: true },
    });
  }

  createItems(
    tx: Prisma.TransactionClient,
    orderId: string,
    items: OrderItemWrite[],
  ): Promise<Prisma.BatchPayload> {
    return tx.orderItem.createMany({
      data: items.map((i) => ({
        orderId,
        productName: i.productName,
        productLink: i.productLink ?? null,
        color: i.color ?? null,
        size: i.size ?? null,
        quantity: i.quantity ?? 1,
        unitPrice: i.unitPrice ?? 0,
        trackingNumber: i.trackingNumber ?? null,
        fulfillmentStatus: i.fulfillmentStatus ?? OrderItemStatus.PENDING,
        image: i.image ?? null,
        remark: i.remark ?? null,
      })),
    });
  }

  /** Thay thế toàn bộ item của Order (dùng khi update có truyền items). */
  async replaceItems(
    tx: Prisma.TransactionClient,
    orderId: string,
    items: OrderItemWrite[],
  ): Promise<void> {
    await tx.orderItem.deleteMany({ where: { orderId } });
    await this.createItems(tx, orderId, items);
  }

  async updateScalar(
    tx: Prisma.TransactionClient,
    id: string,
    data: OrderScalarWrite,
    actorUserId: string,
  ): Promise<void> {
    const patch: Prisma.OrderUpdateInput = { updatedBy: actorUserId };
    if (data.orderNumber !== undefined) patch.orderNumber = data.orderNumber;
    if (data.shippingAddress !== undefined) patch.shippingAddress = data.shippingAddress;
    if (data.currency !== undefined) patch.currency = data.currency;
    if (data.orderedAt !== undefined) patch.orderedAt = data.orderedAt;
    if (data.status !== undefined) patch.status = data.status;
    await tx.order.update({ where: { id }, data: patch });
  }

  async softDelete(
    tx: Prisma.TransactionClient,
    id: string,
    actorUserId: string,
  ): Promise<void> {
    await tx.order.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorUserId },
    });
  }

  addStatusHistory(
    tx: Prisma.TransactionClient,
    orderId: string,
    oldStatus: OrderStatus | null,
    newStatus: OrderStatus,
    changedBy: string,
    note?: string | null,
  ): Promise<{ id: string }> {
    return tx.orderStatusHistory.create({
      data: { orderId, oldStatus, newStatus, changedBy, note: note ?? null },
      select: { id: true },
    });
  }

  addLog(
    tx: Prisma.TransactionClient,
    orderId: string,
    log: OrderLogWrite,
  ): Promise<{ id: string }> {
    return tx.orderLog.create({
      data: {
        orderId,
        action: log.action,
        field: log.field ?? null,
        oldValue: log.oldValue ?? null,
        newValue: log.newValue ?? null,
        performedBy: log.performedBy,
        ipAddress: log.ipAddress?.slice(0, 45) ?? null,
      },
      select: { id: true },
    });
  }

  /** Claim đơn: gán fulfilledById + claimedAt + status (Requirement 2). */
  async claim(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
    status: OrderStatus,
  ): Promise<void> {
    await tx.order.update({
      where: { id },
      data: { fulfilledById: userId, claimedAt: new Date(), status, updatedBy: userId },
    });
  }

  /** Release đơn (Admin): xóa fulfilledById + claimedAt + đưa status về WAITING (Requirement 12). */
  async release(
    tx: Prisma.TransactionClient,
    id: string,
    actorUserId: string,
    status: OrderStatus,
  ): Promise<void> {
    await tx.order.update({
      where: { id },
      data: { fulfilledById: null, claimedAt: null, status, updatedBy: actorUserId },
    });
  }

  async findMany(
    organizationId: string,
    params: OrderFindManyParams,
    sellerScope?: string,
  ): Promise<{ items: OrderListRow[]; total: number }> {
    const accountWhere: Prisma.AccountWhereInput = {};
    const sellerId = sellerScope ?? params.sellerUserId;
    if (sellerId) accountWhere.sellerUserId = sellerId;
    if (params.accountId) accountWhere.id = params.accountId;
    if (params.platformId) accountWhere.platformId = params.platformId;

    const where: Prisma.OrderWhereInput = {
      organizationId,
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(Object.keys(accountWhere).length ? { account: accountWhere } : {}),
      ...(params.dateFrom || params.dateTo
        ? {
            orderedAt: {
              ...(params.dateFrom ? { gte: params.dateFrom } : {}),
              ...(params.dateTo ? { lte: params.dateTo } : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { orderNumber: { contains: params.search, mode: 'insensitive' } },
              { shippingAddress: { contains: params.search, mode: 'insensitive' } },
              {
                items: {
                  some: { trackingNumber: { contains: params.search, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        orderBy: { [params.sortBy]: params.sortOrder },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  // --- OrderNote (1..N theo Order) ---

  /** Danh sách note còn sống của Order. */
  listNotes(orderId: string) {
    return this.prisma.orderNote.findMany({
      where: { orderId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Lấy 1 note (còn sống) theo id. */
  findNoteById(id: string) {
    return this.prisma.orderNote.findFirst({ where: { id, deletedAt: null } });
  }

  createNote(
    tx: Prisma.TransactionClient,
    orderId: string,
    type: OrderNoteType,
    content: string,
    actorUserId: string,
  ): Promise<{ id: string }> {
    return tx.orderNote.create({
      data: { orderId, type, content, createdBy: actorUserId },
      select: { id: true },
    });
  }

  async updateNote(
    tx: Prisma.TransactionClient,
    id: string,
    data: OrderNoteWrite,
  ): Promise<void> {
    const patch: Prisma.OrderNoteUpdateInput = {};
    if (data.type !== undefined) patch.type = data.type;
    if (data.content !== undefined) patch.content = data.content;
    await tx.orderNote.update({ where: { id }, data: patch });
  }

  async softDeleteNote(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.orderNote.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // --- OrderItem fulfillment (tracking + status theo từng item) ---

  /** Lấy item (đảm bảo thuộc order). */
  findItemById(orderId: string, itemId: string) {
    return this.prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
  }

  async updateItemFulfillment(
    tx: Prisma.TransactionClient,
    itemId: string,
    data: { trackingNumber?: string | null; fulfillmentStatus?: OrderItemStatus },
  ): Promise<void> {
    const patch: Prisma.OrderItemUpdateInput = {};
    if (data.trackingNumber !== undefined) patch.trackingNumber = data.trackingNumber;
    if (data.fulfillmentStatus !== undefined) patch.fulfillmentStatus = data.fulfillmentStatus;
    await tx.orderItem.update({ where: { id: itemId }, data: patch });
  }

  /** Danh sách Seller (User quản lý Account) trong Org — cho filter Seller (ADMIN). */
  listSellers(organizationId: string) {
    return this.prisma.user.findMany({
      where: {
        organizationId,
        deletedAt: null,
        sellerAccounts: { some: { deletedAt: null } },
      },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
    });
  }
}
