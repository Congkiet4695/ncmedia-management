import { Injectable } from '@nestjs/common';
import { NotificationEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/** Nhóm tuỳ chọn mà người dùng bật / tắt trên màn hình Cài đặt thông báo. */
export type NotificationCategory = 'NEW_ORDER' | 'FULFILL' | 'RETURN_REFUND';

/**
 * Loại sự kiện (enum DB hiện có — KHÔNG thêm enum trùng) → nhóm tuỳ chọn.
 * Fulfill thành công và huỷ fulfill thành công cùng thuộc nhóm FULFILL.
 */
export const NOTIFICATION_CATEGORY_OF_EVENT: Readonly<Record<NotificationEventType, NotificationCategory>> = {
  ORDER_CREATED: 'NEW_ORDER',
  FULFILLMENT_SUBMITTED: 'FULFILL',
  FULFILLMENT_CANCELLED: 'FULFILL',
  RETURN_REFUND_REQUEST: 'RETURN_REFUND',
};

export interface NotificationPreferences {
  newOrder: boolean;
  fulfillment: boolean;
  returnRefund: boolean;
}

/** Chưa có dòng ⇒ bật tất cả — đúng hành vi trước khi có tuỳ chọn. */
export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = {
  newOrder: true,
  fulfillment: true,
  returnRefund: true,
};

export function allowsEvent(preferences: NotificationPreferences, eventType: NotificationEventType): boolean {
  switch (NOTIFICATION_CATEGORY_OF_EVENT[eventType]) {
    case 'NEW_ORDER':
      return preferences.newOrder;
    case 'RETURN_REFUND':
      return preferences.returnRefund;
    default:
      return preferences.fulfillment;
  }
}

const SELECT = { notifyNewOrder: true, notifyFulfillment: true, notifyReturnRefund: true } as const;

function toPreferences(row: { notifyNewOrder: boolean; notifyFulfillment: boolean; notifyReturnRefund: boolean }): NotificationPreferences {
  return { newOrder: row.notifyNewOrder, fulfillment: row.notifyFulfillment, returnRefund: row.notifyReturnRefund };
}

/**
 * Data access cho `organization_notification_preferences` — MỌI truy vấn theo `organizationId`.
 */
@Injectable()
export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    organizationId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<NotificationPreferences> {
    const row = await client.organizationNotificationPreference.findFirst({
      where: { organizationId, deletedAt: null },
      select: SELECT,
    });
    return row ? toPreferences(row) : { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  async save(
    organizationId: string,
    actorUserId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    const data = {
      notifyNewOrder: preferences.newOrder,
      notifyFulfillment: preferences.fulfillment,
      notifyReturnRefund: preferences.returnRefund,
    };
    const row = await this.prisma.organizationNotificationPreference.upsert({
      where: { organizationId },
      create: { ...data, organizationId, createdBy: actorUserId, updatedBy: actorUserId },
      update: { ...data, deletedAt: null, updatedBy: actorUserId },
      select: SELECT,
    });
    return toPreferences(row);
  }
}
