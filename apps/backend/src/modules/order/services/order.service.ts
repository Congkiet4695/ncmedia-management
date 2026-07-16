import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ADMIN_ROLE_CODE } from '../../auth/constants/default-roles';
import { ORDER_LOG_ACTION } from '../constants/order.constants';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateTrackingDto, UpdateWarehouseNoteDto } from '../dto/fulfillment.dto';
import { OrderQueryDto } from '../dto/order-query.dto';
import {
  OrderResponseDto,
  OrderSellerOptionDto,
  PaginatedOrderResponseDto,
} from '../dto/order-response.dto';
import { UpdateOrderDto } from '../dto/update-order.dto';
import { UpdateOrderStatusDto } from '../dto/update-status.dto';
import {
  OrderAccountForbiddenException,
  OrderAccountInvalidException,
  OrderDuplicateException,
  OrderItemsRequiredException,
  OrderLockedException,
  OrderNotFoundException,
  OrderTrackingRequiredException,
} from '../exceptions/order.exceptions';
import { OrderMapper } from '../mappers/order.mapper';
import {
  OrderItemWrite,
  OrderLogWrite,
  OrderRepository,
  OrderScalarWrite,
} from '../repositories/order.repository';
import { OrderWithRelations } from '../types/order-with-relations.type';

/** Ngữ cảnh actor cho fulfillment (userId + role code) + metadata request (IP audit). */
export interface OrderActor {
  userId: string;
  role: string;
}
export interface OrderRequestMeta {
  ipAddress?: string | null;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: OrderRepository,
    private readonly mapper: OrderMapper,
  ) {}

  async create(
    organizationId: string,
    actorUserId: string,
    dto: CreateOrderDto,
    sellerScope?: string,
  ): Promise<OrderResponseDto> {
    if (!dto.items?.length) throw new OrderItemsRequiredException();

    const account = await this.repo.findAccountForOrder(organizationId, dto.accountId);
    if (!account) throw new OrderAccountInvalidException();
    // Row-level: Seller chỉ tạo Order cho Account mình quản lý.
    if (sellerScope && account.sellerUserId !== sellerScope) {
      throw new OrderAccountForbiddenException();
    }

    const platform = account.platform;
    if (await this.repo.duplicateExists(organizationId, platform, dto.orderNumber)) {
      throw new OrderDuplicateException();
    }

    const status = dto.status ?? OrderStatus.WAITING;
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const order = await this.repo.create(
          tx,
          {
            organizationId,
            accountId: account.id,
            platform,
            orderNumber: dto.orderNumber,
            customerName: dto.customerName,
            customerPhone: dto.customerPhone,
            shippingAddress: dto.shippingAddress,
            sellerNote: dto.sellerNote,
            warehouseNote: dto.warehouseNote,
            tracking: dto.tracking,
            orderedAt: dto.orderedAt ? new Date(dto.orderedAt) : new Date(),
            status,
          },
          actorUserId,
        );
        await this.repo.createItems(tx, order.id, this.toItemWrites(dto.items));
        await this.repo.addStatusHistory(tx, order.id, null, status, actorUserId, 'Tạo đơn');
        await this.repo.addLog(tx, order.id, {
          action: ORDER_LOG_ACTION.CREATE,
          performedBy: actorUserId,
        });
        return order.id;
      });
      return this.findOne(organizationId, id, sellerScope);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  async findAll(
    organizationId: string,
    query: OrderQueryDto,
    sellerScope?: string,
  ): Promise<PaginatedOrderResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.repo.findMany(
      organizationId,
      {
        page,
        limit,
        search: query.search,
        platformId: query.platformId,
        accountId: query.accountId,
        status: query.status,
        supplier: query.supplier,
        sellerUserId: query.sellerUserId,
        dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
        dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
        sortBy: query.sortBy ?? 'createdAt',
        sortOrder: query.sortOrder ?? 'desc',
      },
      sellerScope,
    );
    return {
      items: items.map((o) => this.mapper.toListItem(o)),
      meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    };
  }

  async findOne(
    organizationId: string,
    id: string,
    sellerScope?: string,
  ): Promise<OrderResponseDto> {
    const order = await this.repo.findById(organizationId, id, sellerScope);
    if (!order) throw new OrderNotFoundException();
    return this.mapper.toResponse(order);
  }

  async update(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpdateOrderDto,
    sellerScope?: string,
    actorRole?: string,
  ): Promise<OrderResponseDto> {
    const existing = await this.repo.findById(organizationId, id, sellerScope);
    if (!existing) throw new OrderNotFoundException();
    // Khoá: đơn đã được Claim → chỉ ADMIN sửa thông tin bán hàng (EMPLOYEE bị 409 — Req 11/14).
    this.assertNotLockedForSales(existing, actorRole);

    // Đổi Order Number → kiểm tra trùng (trong cùng platform hiện tại của đơn).
    if (dto.orderNumber !== undefined && dto.orderNumber !== existing.orderNumber) {
      if (await this.repo.duplicateExists(organizationId, existing.platform, dto.orderNumber, id)) {
        throw new OrderDuplicateException();
      }
    }

    const { data, logs } = this.diffScalar(existing, dto, actorUserId);
    const hasItems = dto.items !== undefined;
    if (hasItems && (!dto.items || dto.items.length === 0)) {
      throw new OrderItemsRequiredException();
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length > 0) {
          await this.repo.updateScalar(tx, id, data, actorUserId);
        }
        for (const log of logs) {
          await this.repo.addLog(tx, id, log);
        }
        if (hasItems && dto.items) {
          await this.repo.replaceItems(tx, id, this.toItemWrites(dto.items));
          await this.repo.addLog(tx, id, {
            action: ORDER_LOG_ACTION.ITEM_CHANGE,
            field: 'items',
            oldValue: String(existing.items.length),
            newValue: String(dto.items.length),
            performedBy: actorUserId,
          });
        }
      });
    } catch (err) {
      throw this.mapWriteError(err);
    }
    return this.findOne(organizationId, id, sellerScope);
  }

  async updateStatus(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpdateOrderStatusDto,
    sellerScope?: string,
    actorRole?: string,
  ): Promise<OrderResponseDto> {
    const existing = await this.repo.findById(organizationId, id, sellerScope);
    if (!existing) throw new OrderNotFoundException();
    this.assertNotLockedForSales(existing, actorRole);

    await this.prisma.$transaction(async (tx) => {
      await this.repo.updateScalar(tx, id, { status: dto.status }, actorUserId);
      await this.repo.addStatusHistory(
        tx,
        id,
        existing.status,
        dto.status,
        actorUserId,
        dto.note,
      );
      await this.repo.addLog(tx, id, {
        action: ORDER_LOG_ACTION.STATUS_CHANGE,
        field: 'status',
        oldValue: existing.status,
        newValue: dto.status,
        performedBy: actorUserId,
      });
    });
    return this.findOne(organizationId, id, sellerScope);
  }

  async remove(
    organizationId: string,
    actorUserId: string,
    id: string,
    sellerScope?: string,
    actorRole?: string,
  ): Promise<void> {
    const existing = await this.repo.findById(organizationId, id, sellerScope);
    if (!existing) throw new OrderNotFoundException();
    this.assertNotLockedForSales(existing, actorRole);
    await this.prisma.$transaction(async (tx) => {
      await this.repo.softDelete(tx, id, actorUserId);
      await this.repo.addLog(tx, id, {
        action: ORDER_LOG_ACTION.DELETE,
        performedBy: actorUserId,
      });
    });
  }

  async listSellers(organizationId: string): Promise<OrderSellerOptionDto[]> {
    const users = await this.repo.listSellers(organizationId);
    return users.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email }));
  }

  // =========================================================================
  // Fulfillment workflow
  // =========================================================================

  /**
   * Claim (Nhận xử lý) — Requirement 2. Đơn chưa có người xử lý → gán fulfilledById = actor,
   * claimedAt = now, status → IN_PROGRESS. Nếu đã có người KHÁC xử lý → 409 (locked).
   * readScope: FULFILLMENT/ADMIN thấy mọi đơn.
   */
  async claim(
    organizationId: string,
    actor: OrderActor,
    id: string,
    readScope: string | undefined,
    meta: OrderRequestMeta,
  ): Promise<OrderResponseDto> {
    const existing = await this.repo.findById(organizationId, id, readScope);
    if (!existing) throw new OrderNotFoundException();

    if (existing.fulfilledById && existing.fulfilledById !== actor.userId) {
      throw new OrderLockedException(existing.fulfilledBy?.fullName ?? null);
    }
    // Đã claim bởi chính mình → idempotent, trả về hiện trạng.
    if (existing.fulfilledById === actor.userId) {
      return this.findOne(organizationId, id, readScope);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.repo.claim(tx, id, actor.userId, OrderStatus.IN_PROGRESS);
      await this.repo.addStatusHistory(
        tx,
        id,
        existing.status,
        OrderStatus.IN_PROGRESS,
        actor.userId,
        'Nhận xử lý (claim)',
      );
      await this.repo.addLog(tx, id, {
        action: ORDER_LOG_ACTION.CLAIM,
        field: 'fulfilledById',
        oldValue: null,
        newValue: actor.userId,
        performedBy: actor.userId,
        ipAddress: meta.ipAddress,
      });
    });
    return this.findOne(organizationId, id, readScope);
  }

  /** Release (Admin) — xóa fulfilledById/claimedAt, status về WAITING (Requirement 12). */
  async release(
    organizationId: string,
    actor: OrderActor,
    id: string,
    meta: OrderRequestMeta,
  ): Promise<OrderResponseDto> {
    const existing = await this.repo.findById(organizationId, id);
    if (!existing) throw new OrderNotFoundException();
    if (!existing.fulfilledById) {
      // Không có gì để release — trả hiện trạng.
      return this.findOne(organizationId, id);
    }

    const prevFulfiller = existing.fulfilledById;
    await this.prisma.$transaction(async (tx) => {
      await this.repo.release(tx, id, actor.userId, OrderStatus.WAITING);
      await this.repo.addStatusHistory(
        tx,
        id,
        existing.status,
        OrderStatus.WAITING,
        actor.userId,
        'Release (Admin)',
      );
      await this.repo.addLog(tx, id, {
        action: ORDER_LOG_ACTION.RELEASE,
        field: 'fulfilledById',
        oldValue: prevFulfiller,
        newValue: null,
        performedBy: actor.userId,
        ipAddress: meta.ipAddress,
      });
    });
    return this.findOne(organizationId, id);
  }

  /** Fulfillment cập nhật Tracking (Requirement 6). Kiểm tra quyền sửa (claimed by self hoặc ADMIN). */
  async updateTracking(
    organizationId: string,
    actor: OrderActor,
    id: string,
    dto: UpdateTrackingDto,
    readScope: string | undefined,
    meta: OrderRequestMeta,
  ): Promise<OrderResponseDto> {
    const existing = await this.repo.findById(organizationId, id, readScope);
    if (!existing) throw new OrderNotFoundException();
    this.assertCanFulfill(existing, actor);

    const next = dto.tracking === '' ? null : dto.tracking;
    if (next !== (existing.tracking ?? null)) {
      await this.prisma.$transaction(async (tx) => {
        await this.repo.updateScalar(tx, id, { tracking: next }, actor.userId);
        await this.repo.addLog(tx, id, {
          action: ORDER_LOG_ACTION.TRACKING_CHANGE,
          field: 'tracking',
          oldValue: existing.tracking ?? null,
          newValue: next,
          performedBy: actor.userId,
          ipAddress: meta.ipAddress,
        });
      });
    }
    return this.findOne(organizationId, id, readScope);
  }

  /** Fulfillment đổi Status (Requirement 8). SHIPPED bắt buộc có Tracking (Requirement 6). */
  async fulfillStatus(
    organizationId: string,
    actor: OrderActor,
    id: string,
    dto: UpdateOrderStatusDto,
    readScope: string | undefined,
    meta: OrderRequestMeta,
  ): Promise<OrderResponseDto> {
    const existing = await this.repo.findById(organizationId, id, readScope);
    if (!existing) throw new OrderNotFoundException();
    this.assertCanFulfill(existing, actor);

    if (dto.status === OrderStatus.SHIPPED && !existing.tracking) {
      throw new OrderTrackingRequiredException();
    }

    await this.prisma.$transaction(async (tx) => {
      await this.repo.updateScalar(tx, id, { status: dto.status }, actor.userId);
      await this.repo.addStatusHistory(tx, id, existing.status, dto.status, actor.userId, dto.note);
      await this.repo.addLog(tx, id, {
        action: ORDER_LOG_ACTION.STATUS_CHANGE,
        field: 'status',
        oldValue: existing.status,
        newValue: dto.status,
        performedBy: actor.userId,
        ipAddress: meta.ipAddress,
      });
    });
    return this.findOne(organizationId, id, readScope);
  }

  /** Fulfillment cập nhật Warehouse Note / Note 2 (Requirement 7). Ghi audit từng field. */
  async updateWarehouseNote(
    organizationId: string,
    actor: OrderActor,
    id: string,
    dto: UpdateWarehouseNoteDto,
    readScope: string | undefined,
    meta: OrderRequestMeta,
  ): Promise<OrderResponseDto> {
    const existing = await this.repo.findById(organizationId, id, readScope);
    if (!existing) throw new OrderNotFoundException();
    this.assertCanFulfill(existing, actor);

    const data: OrderScalarWrite = {};
    const logs: OrderLogWrite[] = [];
    const fields: Array<{ key: 'warehouseNote' | 'warehouseNote2' }> = [
      { key: 'warehouseNote' },
      { key: 'warehouseNote2' },
    ];
    for (const f of fields) {
      if (dto[f.key] === undefined) continue;
      const next = dto[f.key] === '' ? null : (dto[f.key] as string);
      const prev = (existing[f.key]) ?? null;
      if (next === prev) continue;
      data[f.key] = next;
      logs.push({
        action: ORDER_LOG_ACTION.WAREHOUSE_NOTE_CHANGE,
        field: f.key,
        oldValue: prev,
        newValue: next,
        performedBy: actor.userId,
        ipAddress: meta.ipAddress,
      });
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await this.repo.updateScalar(tx, id, data, actor.userId);
        for (const log of logs) await this.repo.addLog(tx, id, log);
      });
    }
    return this.findOne(organizationId, id, readScope);
  }

  // --- helpers ---

  /**
   * Ai được sửa fulfillment: ADMIN (bypass) hoặc chính Fulfillment đã claim đơn.
   * Chưa claim / claim bởi người khác → 409 (Requirement 3/14) — backend luôn kiểm tra.
   */
  private assertCanFulfill(existing: OrderWithRelations, actor: OrderActor): void {
    if (actor.role === ADMIN_ROLE_CODE) return;
    if (existing.fulfilledById && existing.fulfilledById === actor.userId) return;
    throw new OrderLockedException(existing.fulfilledBy?.fullName ?? null);
  }

  /**
   * Khoá sửa "thông tin bán hàng" (PATCH /orders, PATCH status, DELETE) sau khi đơn đã Claim:
   * chỉ ADMIN được phép; EMPLOYEE (Seller) → 409 (Requirement 11).
   */
  private assertNotLockedForSales(existing: OrderWithRelations, actorRole?: string): void {
    if (existing.fulfilledById && actorRole !== ADMIN_ROLE_CODE) {
      throw new OrderLockedException(existing.fulfilledBy?.fullName ?? null);
    }
  }

  // --- helpers (existing) ---

  private toItemWrites(items: CreateOrderDto['items']): OrderItemWrite[] {
    return items.map((i) => ({
      productName: i.productName,
      productLink: i.productLink,
      supplier: i.supplier,
      sku: i.sku,
      variant: i.variant,
      color: i.color,
      size: i.size,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      image: i.image,
      remark: i.remark,
    }));
  }

  /**
   * So sánh field scalar (existing vs dto) → data cần update + logs từng thay đổi.
   * tracking → TRACKING_CHANGE, shippingAddress → ADDRESS_CHANGE, còn lại → UPDATE.
   */
  private diffScalar(
    existing: OrderWithRelations,
    dto: UpdateOrderDto,
    actorUserId: string,
  ): { data: OrderScalarWrite; logs: OrderLogWrite[] } {
    const data: OrderScalarWrite = {};
    const logs: OrderLogWrite[] = [];

    const fields: Array<{
      key: keyof OrderScalarWrite & keyof UpdateOrderDto;
      action: string;
      transform?: (v: string) => Date;
    }> = [
      { key: 'orderNumber', action: ORDER_LOG_ACTION.UPDATE },
      { key: 'customerName', action: ORDER_LOG_ACTION.UPDATE },
      { key: 'customerPhone', action: ORDER_LOG_ACTION.UPDATE },
      { key: 'shippingAddress', action: ORDER_LOG_ACTION.ADDRESS_CHANGE },
      { key: 'sellerNote', action: ORDER_LOG_ACTION.UPDATE },
      { key: 'warehouseNote', action: ORDER_LOG_ACTION.UPDATE },
      { key: 'tracking', action: ORDER_LOG_ACTION.TRACKING_CHANGE },
    ];

    for (const f of fields) {
      const incoming = dto[f.key];
      if (incoming === undefined) continue;
      const nextVal = (incoming) === '' ? null : (incoming);
      const prevVal = (existing[f.key] as string | null) ?? null;
      if (nextVal === prevVal) continue;
      (data[f.key] as string | null) = nextVal;
      logs.push({
        action: f.action,
        field: f.key,
        oldValue: prevVal,
        newValue: nextVal,
        performedBy: actorUserId,
      });
    }

    // orderedAt xử lý riêng (Date).
    if (dto.orderedAt !== undefined) {
      const next = dto.orderedAt ? new Date(dto.orderedAt) : null;
      const prev = existing.orderedAt;
      const changed = (next?.getTime() ?? null) !== (prev?.getTime() ?? null);
      if (changed) {
        data.orderedAt = next;
        logs.push({
          action: ORDER_LOG_ACTION.UPDATE,
          field: 'orderedAt',
          oldValue: prev ? prev.toISOString() : null,
          newValue: next ? next.toISOString() : null,
          performedBy: actorUserId,
        });
      }
    }

    return { data, logs };
  }

  private mapWriteError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.join(',') : typeof target === 'string' ? target : '';
      if (fields.includes('order_number') || fields.includes('platform')) {
        return new OrderDuplicateException();
      }
    }
    return err instanceof Error ? err : new Error('Unknown error');
  }
}
