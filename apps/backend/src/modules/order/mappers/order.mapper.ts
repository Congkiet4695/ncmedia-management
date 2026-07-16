import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  OrderItemDto,
  OrderListItemDto,
  OrderResponseDto,
  OrderStatusHistoryDto,
} from '../dto/order-response.dto';
import { OrderListRow, OrderWithRelations } from '../types/order-with-relations.type';

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : Number(value);
}

/**
 * OrderMapper — Entity → Response DTO. Tổng tiền/số lượng tính runtime (ADR-014, không lưu DB).
 */
@Injectable()
export class OrderMapper {
  toResponse(o: OrderWithRelations): OrderResponseDto {
    const items = o.items.map((i) => this.toItem(i));
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
    const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

    return {
      id: o.id,
      orderNumber: o.orderNumber,
      platform: o.platform,
      status: o.status,
      orderedAt: o.orderedAt ? o.orderedAt.toISOString() : null,
      account: {
        id: o.account.id,
        name: o.account.name,
        platform: o.account.platform
          ? { id: o.account.platform.id, code: o.account.platform.code, name: o.account.platform.name }
          : null,
        sellerId: o.account.seller?.id ?? null,
        sellerName: o.account.seller?.fullName ?? null,
      },
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      shippingAddress: o.shippingAddress,
      sellerNote: o.sellerNote,
      warehouseNote: o.warehouseNote,
      warehouseNote2: o.warehouseNote2,
      tracking: o.tracking,
      fulfilledById: o.fulfilledById,
      fulfilledByName: o.fulfilledBy?.fullName ?? null,
      claimedAt: o.claimedAt ? o.claimedAt.toISOString() : null,
      isClaimed: o.fulfilledById != null,
      items,
      statusHistories: o.statusHistories.map((h) => this.toHistory(h)),
      totalQuantity,
      totalAmount,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  toListItem(o: OrderListRow): OrderListItemDto {
    const firstItem = o.items[0];
    const totalQuantity = o.items.reduce((sum, i) => sum + i.quantity, 0);
    const items = o.items.map((i) => ({
      id: i.id,
      productName: i.productName,
      variant: i.variant,
      color: i.color,
      size: i.size,
      quantity: i.quantity,
      unitPrice: toNumber(i.unitPrice),
    }));
    const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      platformName: o.account.platform?.name ?? null,
      accountName: o.account.name,
      sellerName: o.account.seller?.fullName ?? null,
      customerName: o.customerName,
      status: o.status,
      tracking: o.tracking,
      productName: firstItem?.productName ?? null,
      supplier: firstItem?.supplier ?? null,
      itemsCount: o.items.length,
      totalQuantity,
      totalAmount,
      fulfilledById: o.fulfilledById,
      fulfilledByName: o.fulfilledBy?.fullName ?? null,
      isClaimed: o.fulfilledById != null,
      items,
      orderedAt: o.orderedAt ? o.orderedAt.toISOString() : null,
      createdAt: o.createdAt.toISOString(),
    };
  }

  private toItem(i: OrderWithRelations['items'][number]): OrderItemDto {
    return {
      id: i.id,
      productName: i.productName,
      productLink: i.productLink,
      supplier: i.supplier,
      sku: i.sku,
      variant: i.variant,
      color: i.color,
      size: i.size,
      quantity: i.quantity,
      unitPrice: toNumber(i.unitPrice),
      image: i.image,
      remark: i.remark,
    };
  }

  private toHistory(h: OrderWithRelations['statusHistories'][number]): OrderStatusHistoryDto {
    return {
      id: h.id,
      oldStatus: h.oldStatus,
      newStatus: h.newStatus,
      changedBy: h.changedBy,
      note: h.note,
      createdAt: h.createdAt.toISOString(),
    };
  }
}
