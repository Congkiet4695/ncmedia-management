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

export type OrderItemStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export type OrderNoteType = 'SELLER' | 'WAREHOUSE';

export interface OrderItem {
  id: string;
  productName: string;
  productLink: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
  trackingNumber: string | null;
  fulfillmentStatus: OrderItemStatus;
  image: string | null;
  remark: string | null;
}

export interface OrderNote {
  id: string;
  orderId: string;
  type: OrderNoteType;
  content: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
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
  shippingAddress: string | null;
  currency: string | null;
  fulfilledById: string | null;
  fulfilledByName: string | null;
  claimedAt: string | null;
  isClaimed: boolean;
  items: OrderItem[];
  notes: OrderNote[];
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
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
  trackingNumber: string | null;
  fulfillmentStatus: OrderItemStatus;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  platformName: string | null;
  accountName: string | null;
  sellerName: string | null;
  status: OrderStatus;
  productName: string | null;
  itemsCount: number;
  totalQuantity: number;
  totalAmount: number;
  fulfilledById: string | null;
  fulfilledByName: string | null;
  isClaimed: boolean;
  items: OrderPreviewItem[];
  notes: OrderNote[];
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
  sellerUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'createdAt' | 'orderedAt' | 'orderNumber' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface OrderItemPayload {
  productName: string;
  productLink?: string;
  color?: string;
  size?: string;
  quantity: number;
  unitPrice: number;
  trackingNumber?: string;
  fulfillmentStatus?: OrderItemStatus;
  image?: string;
  remark?: string;
}

export interface CreateOrderPayload {
  accountId: string;
  orderNumber: string;
  shippingAddress?: string;
  currency?: string;
  status?: OrderStatus;
  orderedAt?: string;
  items: OrderItemPayload[];
}

export type UpdateOrderPayload = Partial<Omit<CreateOrderPayload, 'accountId' | 'status'>>;

export interface UpdateStatusPayload {
  status: OrderStatus;
  note?: string;
}

/** Cập nhật fulfillment theo từng Item (Tracking + Status). */
export interface UpdateItemFulfillmentPayload {
  trackingNumber?: string;
  fulfillmentStatus?: OrderItemStatus;
}

export interface CreateOrderNotePayload {
  type: OrderNoteType;
  content: string;
}

export interface UpdateOrderNotePayload {
  type?: OrderNoteType;
  content?: string;
}

export interface OrderSellerOption {
  id: string;
  fullName: string;
  email: string;
}
