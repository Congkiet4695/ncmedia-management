import type { OrderFormInput, OrderItemInput } from '../schemas/order.schema';
import type { CreateOrderPayload, OrderItemPayload, UpdateOrderPayload } from '../types';

function toItemPayload(item: OrderItemInput): OrderItemPayload {
  const optionalKeys = [
    'productLink',
    'color',
    'size',
    'trackingNumber',
    'image',
    'remark',
  ] as const;
  const optional: Record<string, string> = {};
  for (const key of optionalKeys) {
    const value = item[key];
    if (value) optional[key] = value;
  }
  return {
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    fulfillmentStatus: item.fulfillmentStatus,
    ...optional,
  };
}

/** OrderFormInput → CreateOrderPayload (bỏ field rỗng). */
export function toCreateOrderPayload(values: OrderFormInput): CreateOrderPayload {
  const optionalKeys = ['shippingAddress', 'currency', 'orderedAt'] as const;
  const optional: Record<string, string> = {};
  for (const key of optionalKeys) {
    const value = values[key];
    if (value) optional[key] = value;
  }
  return {
    accountId: values.accountId,
    orderNumber: values.orderNumber,
    items: values.items.map(toItemPayload),
    ...optional,
  };
}

/** OrderFormInput → UpdateOrderPayload (không gồm accountId). */
export function toUpdateOrderPayload(values: OrderFormInput): UpdateOrderPayload {
  const { accountId: _accountId, ...rest } = toCreateOrderPayload(values);
  void _accountId;
  return rest;
}
