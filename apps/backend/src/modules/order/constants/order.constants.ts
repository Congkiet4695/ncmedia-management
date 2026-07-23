/** Trường sort cho danh sách Order. */
export const ORDER_SORT_FIELDS = ['createdAt', 'orderedAt', 'orderNumber', 'status'] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

/**
 * Action ghi vào order_logs (nhật ký thay đổi đơn).
 * CREATE/UPDATE/DELETE + các thay đổi trọng yếu: STATUS_CHANGE, TRACKING_CHANGE, ADDRESS_CHANGE, ITEM_CHANGE.
 */
export const ORDER_LOG_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  STATUS_CHANGE: 'STATUS_CHANGE',
  TRACKING_CHANGE: 'TRACKING_CHANGE',
  ADDRESS_CHANGE: 'ADDRESS_CHANGE',
  ITEM_CHANGE: 'ITEM_CHANGE',
  // Fulfillment workflow
  CLAIM: 'CLAIM',
  RELEASE: 'RELEASE',
  ITEM_FULFILLMENT_CHANGE: 'ITEM_FULFILLMENT_CHANGE',
  // OrderNote (Seller/Warehouse) CRUD
  NOTE_CREATE: 'NOTE_CREATE',
  NOTE_UPDATE: 'NOTE_UPDATE',
  NOTE_DELETE: 'NOTE_DELETE',
} as const;
export type OrderLogAction = (typeof ORDER_LOG_ACTION)[keyof typeof ORDER_LOG_ACTION];
