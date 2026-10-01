import type { TiktokOrderStatus } from '../constants/tiktok.constants';

/**
 * Nhóm trạng thái đơn TikTok cho THỐNG KÊ — nguồn sự thật DUY NHẤT (dashboard, xu hướng, bảng seller
 * đều dựng SQL từ đây, không copy-paste điều kiện trạng thái).
 *
 * Ánh xạ theo enum `status` của TikTok Order API (`TIKTOK_ORDER_STATUSES`), KHÔNG theo tên hiển thị:
 *
 * | Nhóm                 | Trạng thái TikTok                       |
 * |----------------------|-----------------------------------------|
 * | UNPAID               | UNPAID                                  |
 * | TO_SHIP              | ON_HOLD · AWAITING_SHIPMENT             |
 * | AWAITING_COLLECTION  | AWAITING_COLLECTION                     |
 * | SHIPPING             | PARTIALLY_SHIPPING · IN_TRANSIT         |
 * | DELIVERED            | DELIVERED · COMPLETED                   |
 * | CANCELLED            | CANCELLED                               |
 * | OTHER                | giá trị TikTok mới chưa được ánh xạ     |
 *
 * 🔴 KHÔNG có nhóm "Đơn hoàn": `pod_orders` không mang thông tin trả hàng/hoàn tiền — hệ thống chưa
 * đồng bộ TikTok Return & Refund API (quyết định PO: hiển thị "chưa có dữ liệu", không suy đoán).
 */
export const ORDER_STATUS_GROUPS = {
  UNPAID: ['UNPAID'],
  TO_SHIP: ['ON_HOLD', 'AWAITING_SHIPMENT'],
  AWAITING_COLLECTION: ['AWAITING_COLLECTION'],
  SHIPPING: ['PARTIALLY_SHIPPING', 'IN_TRANSIT'],
  DELIVERED: ['DELIVERED', 'COMPLETED'],
  CANCELLED: ['CANCELLED'],
} as const satisfies Record<string, readonly TiktokOrderStatus[]>;

export type OrderStatusGroup = keyof typeof ORDER_STATUS_GROUPS | 'OTHER';

export const ORDER_STATUS_GROUP_KEYS = [
  ...(Object.keys(ORDER_STATUS_GROUPS) as Array<keyof typeof ORDER_STATUS_GROUPS>),
  'OTHER',
] as const satisfies readonly OrderStatusGroup[];

/** Nhóm của một trạng thái (dùng ở TS — SQL dựng CASE từ cùng bảng trên). */
export function orderStatusGroupOf(status: string | null | undefined): OrderStatusGroup {
  for (const [group, statuses] of Object.entries(ORDER_STATUS_GROUPS)) {
    if ((statuses as readonly string[]).includes(status ?? '')) return group as OrderStatusGroup;
  }
  return 'OTHER';
}

/** Đơn "đang trên đường xử lý" (chưa giao, chưa huỷ) — dùng cho đường xu hướng. */
export const IN_PROGRESS_GROUPS: readonly OrderStatusGroup[] = [
  'TO_SHIP',
  'AWAITING_COLLECTION',
  'SHIPPING',
];
