import { z } from 'zod';

export const ORDER_STATUSES = [
  'WAITING',
  'URGENT',
  'TRACK_AVAILABLE',
  'PED',
  'REDO',
  'TRACK_PENDING',
  'TAX',
  'TRACK_IMPORTED',
  'REFUND',
  'CANCELLED',
  'IN_PROGRESS',
  'HAS_TRACKING',
  'SHIPPED',
  'COMPLETED',
] as const;

/** Nhãn hiển thị — sheet "Đơn hàng" (order.jpg) + workflow Fulfillment. */
export const ORDER_STATUS_LABELS: Record<(typeof ORDER_STATUSES)[number], string> = {
  WAITING: 'waiting',
  URGENT: 'Ưu tiên làm gấp',
  TRACK_AVAILABLE: 'Có track',
  PED: 'ped',
  REDO: 'Đã Làm Lại',
  TRACK_PENDING: 'Chờ track',
  TAX: 'thuế',
  TRACK_IMPORTED: 'đã nhập track',
  REFUND: 'refund',
  CANCELLED: 'cancel',
  IN_PROGRESS: 'Đang xử lý',
  HAS_TRACKING: 'Có tracking',
  SHIPPED: 'Đã gửi',
  COMPLETED: 'Hoàn thành',
};

/**
 * Trạng thái Fulfillment được phép chuyển (Requirement 8) — dùng cho selector đổi status ở panel fulfillment.
 */
export const FULFILLMENT_STATUSES = [
  'WAITING',
  'PED',
  'IN_PROGRESS',
  'HAS_TRACKING',
  'SHIPPED',
  'COMPLETED',
  'REFUND',
  'CANCELLED',
] as const;

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ')
  .or(z.literal(''));

/** Một dòng sản phẩm (OrderItem) trong form. */
export const orderItemSchema = z.object({
  productName: z.string().trim().min(1, 'Nhập tên sản phẩm').max(1024, 'Tối đa 1024 ký tự'),
  productLink: z.string().max(2048).or(z.literal('')),
  supplier: z.string().max(255).or(z.literal('')),
  sku: z.string().max(255).or(z.literal('')),
  variant: z.string().max(255).or(z.literal('')),
  color: z.string().max(255).or(z.literal('')),
  size: z.string().max(255).or(z.literal('')),
  quantity: z.coerce.number().int('Số nguyên').min(1, 'Tối thiểu 1').max(1_000_000),
  unitPrice: z.coerce.number().min(0, 'Không âm').max(9_999_999_999_999),
  image: z.string().max(2048).or(z.literal('')),
  remark: z.string().max(2000).or(z.literal('')),
});

export type OrderItemInput = z.infer<typeof orderItemSchema>;

/** Form Order (khớp Create/UpdateOrderDto backend). Status tạo mặc định WAITING (đổi qua dialog riêng). */
export const orderFormSchema = z.object({
  accountId: z.string().uuid('Vui lòng chọn Account'),
  orderNumber: z.string().trim().min(1, 'Nhập Order Number').max(120, 'Tối đa 120 ký tự'),
  customerName: z.string().max(255).or(z.literal('')),
  customerPhone: z.string().max(50).or(z.literal('')),
  shippingAddress: z.string().max(2000).or(z.literal('')),
  sellerNote: z.string().max(2000).or(z.literal('')),
  warehouseNote: z.string().max(2000).or(z.literal('')),
  tracking: z.string().max(255).or(z.literal('')),
  orderedAt: optionalDate,
  items: z.array(orderItemSchema).min(1, 'Cần ít nhất 1 sản phẩm'),
});

export type OrderFormInput = z.infer<typeof orderFormSchema>;

/** Giá trị mặc định 1 item trống. */
export const EMPTY_ORDER_ITEM: OrderItemInput = {
  productName: '',
  productLink: '',
  supplier: '',
  sku: '',
  variant: '',
  color: '',
  size: '',
  quantity: 1,
  unitPrice: 0,
  image: '',
  remark: '',
};

/** Form đổi trạng thái. */
export const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().max(2000).or(z.literal('')),
});

export type OrderStatusInput = z.infer<typeof orderStatusSchema>;
