import type { NotificationEventType } from '@prisma/client';
import {
  NOTIFICATION_MAX_ITEMS_IN_MESSAGE,
  TELEGRAM_MESSAGE_MAX_LENGTH,
} from '../constants/notification.constants';
import type {
  FulfillmentCancelledPayload,
  FulfillmentSubmittedPayload,
  NotificationOrderItem,
  NotificationPayloadMap,
  OrderCreatedPayload,
} from '../types/notification-payload.types';

/** Ngữ cảnh hiển thị — không phải dữ liệu của sự kiện. */
export interface MessageContext {
  organizationName: string | null;
  /** Chênh lệch múi giờ hiển thị (phút) — `APP_TIMEZONE_OFFSET_MINUTES`. */
  timezoneOffsetMinutes: number;
}

/**
 * Dựng tin nhắn Telegram (parse_mode HTML) từ payload của sự kiện.
 *
 * Hàm THUẦN: không I/O, không đọc DB — test được trực tiếp. Mọi giá trị đến từ dữ liệu thật của
 * đơn / fulfillment; field nào không có thì bỏ dòng đó, không điền giá trị giả.
 *
 * 🔴 Mọi chuỗi động đều được escape HTML (`<`, `>`, `&`): tên sản phẩm của seller là dữ liệu tự do,
 * không escape thì Telegram từ chối cả tin ("can't parse entities").
 */
export function formatTelegramMessage<K extends NotificationEventType>(
  eventType: K,
  payload: NotificationPayloadMap[K],
  context: MessageContext,
): string {
  const lines = (() => {
    switch (eventType) {
      case 'ORDER_CREATED':
        return orderCreatedLines(payload as OrderCreatedPayload, context);
      case 'FULFILLMENT_SUBMITTED':
        return fulfillmentSubmittedLines(payload as FulfillmentSubmittedPayload, context);
      case 'FULFILLMENT_CANCELLED':
        return fulfillmentCancelledLines(payload as FulfillmentCancelledPayload, context);
      default:
        throw new Error(`Chưa có mẫu tin nhắn cho sự kiện ${String(eventType)}`);
    }
  })();

  if (context.organizationName) lines.push('', `🏢 <b>Organization:</b> ${escapeHtml(context.organizationName)}`);
  return clamp(lines.join('\n'));
}

function orderCreatedLines(payload: OrderCreatedPayload, context: MessageContext): string[] {
  if (!payload?.tiktokOrderId) throw new Error('Payload ORDER_CREATED thiếu tiktokOrderId');
  return [
    '🆕 <b>NEW ORDER</b>',
    '',
    ...field('🏪', 'Account', payload.accountName),
    ...field('🛍', 'Shop', payload.shopName !== payload.accountName ? payload.shopName : null),
    ...field('🆔', 'Order ID', payload.tiktokOrderId, true),
    ...itemLines(payload.items, true),
    ...field('💰', 'Total', formatMoney(payload.totalAmount, payload.currency)),
    ...field('📅', 'Order time', formatDateTime(payload.orderCreatedAt, context.timezoneOffsetMinutes)),
    ...field('🏭', 'Fulfillment', payload.fulfillmentProvider),
  ];
}

function fulfillmentSubmittedLines(
  payload: FulfillmentSubmittedPayload,
  context: MessageContext,
): string[] {
  if (!payload?.tiktokOrderId) throw new Error('Payload FULFILLMENT_SUBMITTED thiếu tiktokOrderId');
  return [
    '✅ <b>ORDER FULFILLED</b>',
    '',
    ...field('🏪', 'Account', payload.accountName),
    ...field('🆔', 'Order ID', payload.tiktokOrderId, true),
    ...itemLines(payload.items, false),
    ...field('🏭', 'Fulfillment Provider', providerLabel(payload.provider, payload.fulfilledBy)),
    ...field('🔖', 'Provider Order ID', payload.providerOrderId ?? payload.externalOrderId, true),
    ...field(
      '💵',
      'Base Cost',
      payload.baseCostConfirmed
        ? formatMoney(payload.baseCost, payload.currency)
        : 'Pending — provider has not confirmed the cost yet',
    ),
    ...field('🏗', 'Production line', payload.productionLine),
    ...field('🚚', 'Shipping method', payload.shippingMethod),
    ...field('📮', 'Tracking', payload.trackingNumber, true),
    ...field('📅', 'Fulfilled at', formatDateTime(payload.fulfilledAt, context.timezoneOffsetMinutes)),
  ];
}

function fulfillmentCancelledLines(
  payload: FulfillmentCancelledPayload,
  context: MessageContext,
): string[] {
  if (!payload?.tiktokOrderId) throw new Error('Payload FULFILLMENT_CANCELLED thiếu tiktokOrderId');
  return [
    '❌ <b>FULFILLMENT CANCELLED</b>',
    '',
    ...field('🏪', 'Account', payload.accountName),
    ...field('🆔', 'Order ID', payload.tiktokOrderId, true),
    ...itemLines(payload.items, false),
    ...field('🏭', 'Fulfillment Provider', providerLabel(payload.provider, payload.fulfilledBy)),
    ...field('🔖', 'Provider Order ID', payload.providerOrderId ?? payload.externalOrderId, true),
    ...field('📅', 'Cancelled at', formatDateTime(payload.cancelledAt, context.timezoneOffsetMinutes)),
    ...field('📝', 'Reason', payload.reason),
  ];
}

/** `🏭 Fulfillment Provider: Mango (Mango US)` — nhà cung cấp + tài khoản thực nhận đơn. */
function providerLabel(provider: string, fulfilledBy: string | null): string {
  return fulfilledBy && fulfilledBy !== provider ? `${provider} (${fulfilledBy})` : provider;
}

/**
 * Một sản phẩm ⇒ các dòng Product / SKU / Variant / Quantity. Nhiều sản phẩm ⇒ danh sách đánh số,
 * tối đa `NOTIFICATION_MAX_ITEMS_IN_MESSAGE` dòng (đơn nhiều dòng không được làm tin vượt 4096 ký tự).
 */
function itemLines(items: NotificationOrderItem[] | undefined, withSku: boolean): string[] {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  if (list.length === 1) {
    const [item] = list;
    return [
      ...field('📦', 'Product', item.productName),
      ...(withSku ? field('🔖', 'SKU', item.sku, true) : []),
      ...field('🎨', 'Variant', item.variant),
      ...field('🔢', 'Quantity', String(item.quantity)),
    ];
  }

  const shown = list.slice(0, NOTIFICATION_MAX_ITEMS_IN_MESSAGE);
  const lines = ['📦 <b>Items:</b>'];
  shown.forEach((item, index) => {
    lines.push(`${index + 1}. ${escapeHtml(item.productName ?? item.sku ?? '—')}`);
    if (withSku && item.sku) lines.push(`   SKU: <code>${escapeHtml(item.sku)}</code>`);
    if (item.variant) lines.push(`   Variant: ${escapeHtml(item.variant)}`);
    lines.push(`   Qty: ${item.quantity}`);
  });
  if (list.length > shown.length) lines.push(`…and ${list.length - shown.length} more item(s)`);
  return lines;
}

/** Một dòng "emoji Nhãn: giá trị" — giá trị trống ⇒ bỏ dòng (không in "null" / "undefined"). */
function field(icon: string, label: string, value: string | null | undefined, code = false): string[] {
  if (value === null || value === undefined || value.trim() === '') return [];
  const text = escapeHtml(value);
  return [`${icon} <b>${label}:</b> ${code ? `<code>${text}</code>` : text}`];
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `$20.45` cho USD; mã tiền khác theo chuẩn ISO của Intl. Thiếu số ⇒ `null` (bỏ dòng). */
export function formatMoney(amount: string | null, currency: string | null): string | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  if (!currency) return value.toFixed(2);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    // Mã tiền tệ lạ ⇒ vẫn hiện số thật kèm mã, không đoán ký hiệu.
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** `dd/MM/yyyy HH:mm` theo múi giờ vận hành (`APP_TIMEZONE_OFFSET_MINUTES`). */
export function formatDateTime(iso: string | null, offsetMinutes: number): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const shifted = new Date(time + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const zone = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ''}`;
  return (
    `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}/${shifted.getUTCFullYear()} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())} (${zone})`
  );
}

/** Cắt tin vượt giới hạn Telegram — tránh bị từ chối cả tin. Chỉ xảy ra với dữ liệu bất thường. */
function clamp(text: string): string {
  if (text.length <= TELEGRAM_MESSAGE_MAX_LENGTH) return text;
  // Cắt ở ranh giới dòng để không để lại thẻ HTML dở dang.
  const cut = text.slice(0, TELEGRAM_MESSAGE_MAX_LENGTH - 2);
  return `${cut.slice(0, cut.lastIndexOf('\n'))}\n…`;
}
