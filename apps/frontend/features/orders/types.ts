import type { PaginationMeta } from '@/types/api';

export type OrderStatus =
  | 'WAITING'
  | 'URGENT'
  | 'TRACK_AVAILABLE'
  | 'PED'
  | 'REDO'
  | 'TRACK_PENDING'
  | 'TAX'
  | 'TRACK_IMPORTED'
  | 'REFUND'
  | 'CANCELLED'
  | 'IN_PROGRESS'
  | 'HAS_TRACKING'
  | 'SHIPPED'
  | 'COMPLETED';

export interface OrderItem {
  id: string;
  productName: string;
  productLink: string | null;
  supplier: string | null;
  sku: string | null;
  variant: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
  image: string | null;
  remark: string | null;
}

export interface OrderStatusHistory {
  id: string;
  oldStatus: OrderStatus | null;
  newStatus: OrderStatus;
  changedBy: string;
  note: string | null;
  createdAt: string;
}

export interface OrderAccountRef {
  id: string;
  name: string;
  platform: { id: string | null; code: string | null; name: string | null } | null;
  sellerId: string | null;
  sellerName: string | null;
}

/** Chi tiết Order (kèm items + timeline). */
export interface Order {
  id: string;
  orderNumber: string;
  platform: string | null;
  status: OrderStatus;
  orderedAt: string | null;
  account: OrderAccountRef;
  customerName: string | null;
  customerPhone: string | null;
  shippingAddress: string | null;
  sellerNote: string | null;
  warehouseNote: string | null;
  warehouseNote2: string | null;
  tracking: string | null;
  fulfilledById: string | null;
  fulfilledByName: string | null;
  claimedAt: string | null;
  isClaimed: boolean;
  items: OrderItem[];
  statusHistories: OrderStatusHistory[];
  totalQuantity: number;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

/** Dòng sản phẩm rút gọn kèm theo Order List — phục vụ Expandable Order Item Grid. */
export interface OrderPreviewItem {
  id: string;
  productName: string;
  variant: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  platformName: string | null;
  accountName: string | null;
  sellerName: string | null;
  customerName: string | null;
  status: OrderStatus;
  tracking: string | null;
  productName: string | null;
  supplier: string | null;
  itemsCount: number;
  totalQuantity: number;
  totalAmount: number;
  fulfilledById: string | null;
  fulfilledByName: string | null;
  isClaimed: boolean;
  items: OrderPreviewItem[];
  orderedAt: string | null;
  createdAt: string;
}

export interface OrderListResult {
  items: OrderListItem[];
  meta: PaginationMeta;
}

export interface OrderQuery {
  page?: number;
  limit?: number;
  search?: string;
  platformId?: string;
  accountId?: string;
  status?: OrderStatus;
  supplier?: string;
  sellerUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'createdAt' | 'orderedAt' | 'orderNumber' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface OrderItemPayload {
  productName: string;
  productLink?: string;
  supplier?: string;
  sku?: string;
  variant?: string;
  color?: string;
  size?: string;
  quantity: number;
  unitPrice: number;
  image?: string;
  remark?: string;
}

export interface CreateOrderPayload {
  accountId: string;
  orderNumber: string;
  customerName?: string;
  customerPhone?: string;
  shippingAddress?: string;
  sellerNote?: string;
  warehouseNote?: string;
  tracking?: string;
  status?: OrderStatus;
  orderedAt?: string;
  items: OrderItemPayload[];
}

export type UpdateOrderPayload = Partial<Omit<CreateOrderPayload, 'accountId' | 'status'>>;

export interface UpdateStatusPayload {
  status: OrderStatus;
  note?: string;
}

export interface UpdateTrackingPayload {
  tracking: string;
}

export interface UpdateWarehouseNotePayload {
  warehouseNote?: string;
  warehouseNote2?: string;
}

export interface OrderSellerOption {
  id: string;
  fullName: string;
  email: string;
}
