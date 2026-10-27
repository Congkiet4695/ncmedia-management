import type { NotificationEventType } from '@prisma/client';

/**
 * CHỦ SỞ HỮU của một kênh thông báo (cấu hình Telegram, loại thông báo, danh sách "Thông báo gần đây").
 *
 *  - `userId = null` ⇒ kênh của TỔ CHỨC (Admin, quyền `notification.config`) — nhận mọi đơn của tổ chức.
 *  - `userId = <id>` ⇒ kênh CÁ NHÂN (quyền `notification.self`) — CHỈ nhận đơn thuộc shop đang được gán
 *    cho người đó.
 *
 * 🔴 Cả hai luôn được dựng từ JWT ở controller — không route nào nhận `organizationId` / `userId` từ client.
 */
export interface NotificationOwner {
  organizationId: string;
  userId: string | null;
}

/** Giá trị `owner_key` / `recipient_key` của kênh tổ chức (thay cho NULL — NULL không trùng nhau trong UNIQUE). */
export const ORGANIZATION_OWNER_KEY = 'ORGANIZATION';

export function ownerKeyOf(owner: NotificationOwner): string {
  return owner.userId ?? ORGANIZATION_OWNER_KEY;
}

export function organizationOwner(organizationId: string): NotificationOwner {
  return { organizationId, userId: null };
}

/** Quyền tự cấu hình kênh cá nhân. */
export const NOTIFICATION_SELF_PERMISSION = 'notification.self';

/** Quyền xem mọi shop của tổ chức — cùng mã với `POD_SHOP_ALL_PERMISSION` (pod-tiktok). */
export const NOTIFICATION_ALL_SHOPS_PERMISSION = 'pod.shop.all';

/**
 * Quyền ĐỌC dữ liệu mà mỗi loại tin nhắn tiết lộ. Người nhận cá nhân phải có quyền này — tin nhắn không
 * được là đường vòng để xem thứ mà màn hình không cho xem (vd role tuỳ biến không có quyền Returns).
 */
export const NOTIFICATION_READ_PERMISSION: Readonly<Record<NotificationEventType, string>> = {
  ORDER_CREATED: 'pod.tiktok.order.read',
  FULFILLMENT_SUBMITTED: 'fulfillment.read',
  FULFILLMENT_CANCELLED: 'fulfillment.read',
  RETURN_REFUND_REQUEST: 'pod.tiktok.return.read',
};
